import os
import json
import datetime
import pandas as pd
from fastapi import FastAPI, Query, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
import pika

from .database import engine, get_db
from .config import RABBITMQ_URL, APP_USER, APP_PASSWORD

app = FastAPI(title="Monitoramento Ativo de Dados API", version="2.0.0")

from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi import status
import secrets

# Configurar middleware de CORS restrito para os domínios reais da aplicação
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://projetodados.2nprogramacao.com.br",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Fábrica de autenticação básica para proteção dos dados comerciais
security = HTTPBasic()

def authenticate(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, APP_USER)
    correct_password = secrets.compare_digest(credentials.password, APP_PASSWORD)
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais incorretas",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

# --- FUNÇÕES AUXILIARES DE LÓGICA DE DADOS ---

def fetch_data_from_db():
    """
    Carrega todos os dados da tabela de vendas do PostgreSQL em um DataFrame do Pandas.
    Renomeia as colunas para coincidir com a estrutura esperada pelo dashboard original.
    """
    query = "SELECT * FROM vendas"
    df = pd.read_sql_query(query, engine)
    
    if df.empty:
        return df

    # Limpeza e mapeamento de colunas para compatibilidade
    df.rename(columns={
        "invoice_id": "Invoice ID",
        "city": "City",
        "customer_type": "Customer type",
        "gender": "Gender",
        "product_line": "Product line",
        "unit_price": "Unit price",
        "quantity": "Quantity",
        "total": "Total",
        "time": "Time",
        "payment": "Payment",
        "rating": "Rating",
        "data": "Data"
    }, inplace=True)

    # Conversões e limpezas típicas
    df["Data"] = pd.to_datetime(df["Data"])
    df["Total"] = pd.to_numeric(df["Total"], errors="coerce")
    df["Quantity"] = pd.to_numeric(df["Quantity"], errors="coerce").astype("Int64")
    df["Rating"] = pd.to_numeric(df["Rating"], errors="coerce")
    
    df.dropna(subset=["Data", "Total", "Quantity"], inplace=True)
    df = df[df["Total"] > 0]
    
    return df

def relatorio_por_dia_com_variacoes(dia_date, df):
    """
    Calcula relatórios agregados e variações percentuais em relação ao dia anterior.
    Idêntico à lógica do proposta-sheets, garantindo compatibilidade.
    """
    dia_timestamp = pd.to_datetime(dia_date)
    dia_anterior_timestamp = dia_timestamp - pd.Timedelta(days=1)

    df_dia = df[df["Data"].dt.date == dia_date].copy()
    df_dia_anterior = df[df["Data"].dt.date == dia_anterior_timestamp.date()].copy()

    if df_dia.empty:
        return {}

    # Limpeza de campos totalizadores na planilha legada, caso existam
    for col in ["City", "Customer type", "Gender", "Product line", "Payment"]:
        if col in df_dia.columns:
            df_dia = df_dia[~df_dia[col].astype(str).str.lower().isin(["total", "quantity"])]
        if col in df_dia_anterior.columns:
            df_dia_anterior = df_dia_anterior[~df_dia_anterior[col].astype(str).str.lower().isin(["total", "quantity"])]

    if df_dia.empty:
        return {}

    # Obter a menor data disponível no DB para ver se é o primeiro dia de dados
    min_date = df["Data"].min().date()
    is_first_day = (dia_date == min_date)

    def calcular_totais_e_variacao(df_atual, df_anterior, col_agrupadora):
        total_atual = df_atual.groupby(col_agrupadora)[["Total", "Quantity"]].sum()
        if is_first_day or df_anterior.empty:
            variacao = pd.DataFrame(index=total_atual.index, columns=total_atual.columns)
            return total_atual, variacao
        else:
            total_anterior = df_anterior.groupby(col_agrupadora)[["Total", "Quantity"]].sum()
            base_idx = total_atual.index.union(total_anterior.index)
            total_atual_reidx = total_atual.reindex(base_idx, fill_value=0)
            total_anterior_reidx = total_anterior.reindex(base_idx, fill_value=0)
            variacao = total_atual_reidx - total_anterior_reidx
            return total_atual_reidx, variacao

    def calcular_crosstab_e_variacao(df_atual, df_anterior, idx_cols, col_cols):
        atual = df_atual.groupby(idx_cols)[col_cols].value_counts().unstack(fill_value=0)
        if is_first_day or df_anterior.empty:
            variacao = pd.DataFrame(index=atual.index, columns=atual.columns)
            return atual, variacao
        else:
            anterior = df_anterior.groupby(idx_cols)[col_cols].value_counts().unstack(fill_value=0)
            idx = atual.index.union(anterior.index)
            cols = atual.columns.union(anterior.columns)
            atual_reidx = atual.reindex(index=idx, columns=cols, fill_value=0)
            anterior_reidx = anterior.reindex(index=idx, columns=cols, fill_value=0)
            variacao = atual_reidx - anterior_reidx
            return atual, variacao

    def calcular_media_e_variacao(df_atual, df_anterior, col_agrupadora, col_valor, nome_metrica):
        media_atual = df_atual.groupby(col_agrupadora)[[col_valor]].mean()
        media_atual.columns = [nome_metrica]
        if is_first_day or df_anterior.empty:
            variacao = pd.DataFrame(index=media_atual.index, columns=media_atual.columns)
            return media_atual, variacao
        else:
            media_anterior = df_anterior.groupby(col_agrupadora)[[col_valor]].mean()
            media_anterior.columns = [nome_metrica]
            base_idx = media_atual.index.union(media_anterior.index)
            media_atual_reidx = media_atual.reindex(base_idx, fill_value=0)
            media_anterior_reidx = media_anterior.reindex(base_idx, fill_value=0)
            variacao = media_atual_reidx - media_anterior_reidx
            return media_atual_reidx, variacao

    def extrair_hora_e_agrupar(df_in):
        if df_in.empty: return pd.DataFrame()
        df_temp = df_in.copy()
        df_temp["Hora"] = df_temp["Time"].astype(str).str.split(":").str[0].astype(int)
        return df_temp.groupby("Hora")[["Total"]].sum()

    # Cálculos
    total_por_cidade, variacao_cidade = calcular_totais_e_variacao(df_dia, df_dia_anterior, "City")
    total_por_tipo_cliente, variacao_tipo_cliente = calcular_totais_e_variacao(df_dia, df_dia_anterior, "Customer type")
    total_por_genero, variacao_genero = calcular_totais_e_variacao(df_dia, df_dia_anterior, "Gender")
    total_por_linha_produto, variacao_linha_produto = calcular_totais_e_variacao(df_dia, df_dia_anterior, "Product line")
    total_por_payment, variacao_payment = calcular_totais_e_variacao(df_dia, df_dia_anterior, "Payment")

    crosstab_cidade_tipo_cliente, variacao_cidade_tipo_cliente = calcular_crosstab_e_variacao(df_dia, df_dia_anterior, "City", "Customer type")
    crosstab_cidade_genero, variacao_cidade_genero = calcular_crosstab_e_variacao(df_dia, df_dia_anterior, ["City", "Gender"], "Customer type")
    crosstab_cidade_product, variacao_cidade_product = calcular_crosstab_e_variacao(df_dia, df_dia_anterior, "City", "Product line")
    crosstab_cidade_payment, variacao_cidade_payment = calcular_crosstab_e_variacao(df_dia, df_dia_anterior, ["City", "Payment"], "Gender")

    ticket_medio_cidade, var_ticket_medio_cidade = calcular_media_e_variacao(df_dia, df_dia_anterior, "City", "Total", "Ticket Médio")
    
    vendas_hora_atual = extrair_hora_e_agrupar(df_dia)
    if is_first_day or df_dia_anterior.empty:
          var_vendas_hora = pd.DataFrame(index=vendas_hora_atual.index, columns=vendas_hora_atual.columns)
    else:
         vendas_hora_anterior = extrair_hora_e_agrupar(df_dia_anterior)
         idx_h = vendas_hora_atual.index.union(vendas_hora_anterior.index)
         atual_h = vendas_hora_atual.reindex(idx_h, fill_value=0)
         ant_h = vendas_hora_anterior.reindex(idx_h, fill_value=0)
         vendas_hora_atual = atual_h
         var_vendas_hora = atual_h - ant_h

    rating_produto, var_rating_produto = calcular_media_e_variacao(df_dia, df_dia_anterior, "Product line", "Rating", "Média_Rating")
    rating_pagamento, var_rating_pagamento = calcular_media_e_variacao(df_dia, df_dia_anterior, "Payment", "Rating", "Média_Rating")

    # --- Novas Métricas de Negócio ---

    # M1. Taxa de Conversão por Tipo de Cliente
    total_geral_dia = df_dia["Total"].sum()
    tx_tipo = df_dia.groupby("Customer type")["Total"].sum()
    tx_tipo_pct = (tx_tipo / total_geral_dia * 100).round(1) if total_geral_dia > 0 else tx_tipo * 0

    # M2. Produto mais lucrativo do dia
    if not df_dia.empty:
        produto_top = df_dia.groupby("Product line")["Total"].sum().idxmax()
        produto_top_valor = df_dia.groupby("Product line")["Total"].sum().max()
    else:
        produto_top = "N/A"
        produto_top_valor = 0.0

    # M3. Hora de pico de vendas
    df_hora = df_dia.copy()
    df_hora["Hora"] = df_hora["Time"].astype(str).str.split(":").str[0].astype(int)
    if not df_hora.empty:
        hora_pico = int(df_hora.groupby("Hora")["Total"].sum().idxmax())
        hora_pico_valor = float(df_hora.groupby("Hora")["Total"].sum().max())
    else:
        hora_pico = 0
        hora_pico_valor = 0.0

    # M4. Taxa de satisfação crítica (% de vendas com rating < 5.0)
    total_vendas_dia = len(df_dia)
    criticas = len(df_dia[df_dia["Rating"] < 5.0])
    taxa_critica = round((criticas / total_vendas_dia * 100), 1) if total_vendas_dia > 0 else 0.0

    # M5. Concentração geográfica (% da cidade top)
    total_cidade = df_dia.groupby("City")["Total"].sum()
    if not total_cidade.empty and total_geral_dia > 0:
        cidade_top = total_cidade.idxmax()
        conc_geo_pct = round((total_cidade.max() / total_geral_dia * 100), 1)
    else:
        cidade_top = "N/A"
        conc_geo_pct = 0.0

    # M6. Preço médio por unidade (UPV = Total / Quantity)
    total_qty_dia = df_dia["Quantity"].sum()
    upv_atual = round((total_geral_dia / total_qty_dia), 2) if total_qty_dia > 0 else 0.0
    if not df_dia_anterior.empty:
        upv_anterior = round((df_dia_anterior["Total"].sum() / df_dia_anterior["Quantity"].sum()), 2)
        upv_variacao = round(upv_atual - upv_anterior, 2)
    else:
        upv_anterior = 0.0
        upv_variacao = None

    # M7. Mix de pagamentos digitais (Pix + Cartão de Crédito + Débito)
    pagamentos_digitais = ["Pix", "Cartao de Credito", "Debito", "Credit card", "Ewallet"]
    total_digital = df_dia[df_dia["Payment"].isin(pagamentos_digitais)]["Total"].sum()
    mix_digital_pct = round((total_digital / total_geral_dia * 100), 1) if total_geral_dia > 0 else 0.0

    # M8. Volume de vendas por gênero
    vol_genero = df_dia.groupby("Gender")["Total"].sum().round(2).to_dict()

    # M9. Linhas de produto sem vendas no dia
    todas_linhas = df["Product line"].unique().tolist()
    linhas_com_venda = df_dia["Product line"].unique().tolist()
    linhas_sem_venda = [l for l in todas_linhas if l not in linhas_com_venda]

    # M10. Eficiência de horário tardio (% do faturamento após 18h)
    df_tardio = df_hora[df_hora["Hora"] >= 18]
    total_tardio = df_tardio["Total"].sum()
    efic_noturna_pct = round((total_tardio / total_geral_dia * 100), 1) if total_geral_dia > 0 else 0.0

    novas_metricas = {
        "taxa_tipo_cliente": {k: float(v) for k, v in tx_tipo_pct.items()},
        "produto_top": {"nome": produto_top, "total": round(float(produto_top_valor), 2)},
        "hora_pico": {"hora": hora_pico, "total": round(hora_pico_valor, 2)},
        "taxa_satisfacao_critica": taxa_critica,
        "concentracao_geografica": {"cidade": cidade_top, "percentual": conc_geo_pct},
        "upv": {"atual": upv_atual, "variacao": upv_variacao},
        "mix_digital_pct": mix_digital_pct,
        "volume_por_genero": vol_genero,
        "linhas_sem_venda": linhas_sem_venda,
        "eficiencia_noturna_pct": efic_noturna_pct
    }

    return {
        "total_por_cidade": total_por_cidade, "variacao_cidade": variacao_cidade,
        "total_por_tipo_cliente": total_por_tipo_cliente, "variacao_tipo_cliente": variacao_tipo_cliente,
        "total_por_genero": total_por_genero, "variacao_genero": variacao_genero,
        "total_por_linha_produto": total_por_linha_produto, "variacao_linha_produto": variacao_linha_produto,
        "total_por_payment": total_por_payment, "variacao_payment": variacao_payment,
        "crosstab_cidade_tipo_cliente": crosstab_cidade_tipo_cliente, "variacao_cidade_tipo_cliente": variacao_cidade_tipo_cliente,
        "crosstab_cidade_genero": crosstab_cidade_genero, "variacao_cidade_genero": variacao_cidade_genero,
        "crosstab_cidade_product": crosstab_cidade_product, "variacao_cidade_product": variacao_cidade_product,
        "crosstab_cidade_payment": crosstab_cidade_payment, "variacao_cidade_payment": variacao_cidade_payment,
        "ticket_medio_cidade": ticket_medio_cidade, "var_ticket_medio_cidade": var_ticket_medio_cidade,
        "vendas_por_hora": vendas_hora_atual, "var_vendas_por_hora": var_vendas_hora,
        "rating_produto": rating_produto, "var_rating_produto": var_rating_produto,
        "rating_pagamento": rating_pagamento, "var_rating_pagamento": var_rating_pagamento,
        "novas_metricas": novas_metricas
    }

def calcular_alertas_dia(relatorio):
    alertas_positivos = []
    alertas_negativos = []

    if not relatorio:
        return {"alertas_positivos": [], "alertas_negativos": [], "total_alertas": 0}

    # 1. Cidades acima de 30k
    if "total_por_cidade" in relatorio:
        cidades_acima_30k = relatorio["total_por_cidade"][relatorio["total_por_cidade"]["Total"] > 30000]
        if not cidades_acima_30k.empty:
            cidades_str = ", ".join(cidades_acima_30k.index)
            alertas_positivos.append(f"As cidades **{cidades_str}** ultrapassaram R$30.000 em vendas totais.")

    # 2. Queda de 30% nas cidades
    if "total_por_cidade" in relatorio and "variacao_cidade" in relatorio:
        total_atual_cidade = relatorio["total_por_cidade"]["Total"]
        variacao_cidade_abs = relatorio["variacao_cidade"]["Total"]
        total_anterior_cidade = total_atual_cidade - variacao_cidade_abs
        
        valid_indices = total_anterior_cidade[total_anterior_cidade > 0].index
        if not valid_indices.empty:
            variacao_perc_cidade = (variacao_cidade_abs.loc[valid_indices] / total_anterior_cidade.loc[valid_indices]) * 100
            cidades_queda = variacao_perc_cidade[variacao_perc_cidade < -30]
            if not cidades_queda.empty:
                cidades_str = ", ".join(cidades_queda.index)
                alertas_negativos.append(f"As cidades **{cidades_str}** tiveram uma queda superior a 30% nas vendas.")

    # 3. Aumento de Pix > 30%
    if "total_por_payment" in relatorio and "variacao_payment" in relatorio:
        if "Pix" in relatorio["total_por_payment"].index:
            total_pix = relatorio["total_por_payment"].loc["Pix", "Total"]
            if "Pix" in relatorio["variacao_payment"].index:
                variacao_pix = relatorio["variacao_payment"].loc["Pix", "Total"]
            else:
                variacao_pix = 0
                
            if pd.notna(variacao_pix):
                total_anterior_pix = total_pix - variacao_pix
                if total_anterior_pix > 0:
                    variacao_perc = (variacao_pix / total_anterior_pix) * 100
                    if variacao_perc > 30:
                        alertas_positivos.append(f"O método de pagamento **Pix** apresentou um aumento superior a 30% ({variacao_perc:.1f}%) nas vendas.")

    # 4. Produtos > 400 vendas
    if "total_por_linha_produto" in relatorio:
        produtos_acima_400 = relatorio["total_por_linha_produto"][relatorio["total_por_linha_produto"]["Quantity"] > 400]
        if not produtos_acima_400.empty:
            produtos_str = ", ".join(produtos_acima_400.index)
            alertas_positivos.append(f"Os produtos **{produtos_str}** tiveram mais de 400 vendas.")

    # --- Novos alertas das 10 métricas ---
    novas = relatorio.get("novas_metricas", {})

    # M1. Taxa de cliente Normal muito baixa
    tx_tipo = novas.get("taxa_tipo_cliente", {})
    perc_normal = tx_tipo.get("Normal", tx_tipo.get("normal", 0))
    if perc_normal > 0 and perc_normal < 30:
        alertas_negativos.append(f"Clientes **Não-Membros** representam apenas **{perc_normal:.1f}%** das vendas — concentração excessiva em membros.")

    # M4. Taxa de satisfação crítica > 15%
    taxa_critica = novas.get("taxa_satisfacao_critica", 0)
    if taxa_critica > 15:
        alertas_negativos.append(f"**{taxa_critica:.1f}%** das vendas tiveram rating abaixo de 5.0 — nível de insatisfação crítico.")

    # M5. Concentração geográfica > 70%
    conc = novas.get("concentracao_geografica", {})
    if conc.get("percentual", 0) > 70:
        alertas_negativos.append(f"A cidade **{conc.get('cidade')}** concentra **{conc.get('percentual')}%** do faturamento — risco de dependência geográfica.")

    # M6. Queda de UPV > 20%
    upv = novas.get("upv", {})
    upv_var = upv.get("variacao")
    upv_atual_val = upv.get("atual", 0)
    if upv_var is not None and upv_atual_val > 0:
        upv_ant = upv_atual_val - upv_var
        if upv_ant > 0:
            queda_upv = (upv_var / upv_ant) * 100
            if queda_upv < -20:
                alertas_negativos.append(f"O Preço Médio por Unidade (UPV) caiu **{abs(queda_upv):.1f}%** em relação ao dia anterior.")

    # M7. Mix digital abaixo de 60%
    mix_digital = novas.get("mix_digital_pct", 100)
    if mix_digital < 60:
        alertas_negativos.append(f"Pagamentos digitais representam apenas **{mix_digital:.1f}%** do faturamento — queda na adesão digital.")

    # M9. Linhas de produto sem vendas
    linhas_sem = novas.get("linhas_sem_venda", [])
    if linhas_sem:
        linhas_str = ", ".join(linhas_sem)
        alertas_negativos.append(f"As linhas **{linhas_str}** não registraram nenhuma venda no dia.")

    # M2. Destaque positivo: produto top do dia
    prod_top = novas.get("produto_top", {})
    if prod_top.get("nome") and prod_top.get("nome") != "N/A":
        alertas_positivos.append(f"🏆 Produto destaque do dia: **{prod_top.get('nome')}** com R$ {prod_top.get('total', 0):,.2f} em faturamento.")

    return {
        "alertas_positivos": alertas_positivos,
        "alertas_negativos": alertas_negativos,
        "total_alertas": len(alertas_positivos) + len(alertas_negativos)
    }

# --- ROTAS DA API ---

@app.get("/api/dates")
def get_available_dates(username: str = Depends(authenticate)):
    """
    Retorna a lista de datas com vendas registradas no banco, ordenadas do mais recente ao mais antigo.
    """
    try:
        df = fetch_data_from_db()
        if df.empty:
            return []
        
        dias_unicos = df["Data"].dt.date.unique()
        dias_unicos_ordenados = sorted(dias_unicos, reverse=True)
        return [dia.strftime("%Y-%m-%d") for dia in dias_unicos_ordenados]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar datas: {str(e)}")

@app.get("/api/report")
def get_full_report(date: str = Query(..., description="Data no formato YYYY-MM-DD"), username: str = Depends(authenticate)):
    """
    Retorna o relatório analítico completo de um dia selecionado (dados + variações + alertas).
    """
    try:
        df = fetch_data_from_db()
        if df.empty:
            raise HTTPException(status_code=404, detail="Banco de dados vazio.")

        target_date = datetime.datetime.strptime(date, "%Y-%m-%d").date()
        relatorio = relatorio_por_dia_com_variacoes(target_date, df)

        if not relatorio:
            raise HTTPException(status_code=404, detail="Nenhum registro para esta data.")

        # Gerar os alertas
        alertas = calcular_alertas_dia(relatorio)

        # Formatar DataFrames para dicionários amigáveis no JSON
        response = {
            "date": date,
            "alertas": alertas,
            "metrics": {
                "cidade": format_dataframe_for_json(relatorio["total_por_cidade"], relatorio["variacao_cidade"]),
                "tipo_cliente": format_dataframe_for_json(relatorio["total_por_tipo_cliente"], relatorio["variacao_tipo_cliente"]),
                "genero": format_dataframe_for_json(relatorio["total_por_genero"], relatorio["variacao_genero"]),
                "linha_produto": format_dataframe_for_json(relatorio["total_por_linha_produto"], relatorio["variacao_linha_produto"]),
                "pagamento": format_dataframe_for_json(relatorio["total_por_payment"], relatorio["variacao_payment"]),
                "ticket_medio_cidade": format_dataframe_for_json(relatorio["ticket_medio_cidade"], relatorio["var_ticket_medio_cidade"]),
                "rating_produto": format_dataframe_for_json(relatorio["rating_produto"], relatorio["var_rating_produto"]),
                "rating_pagamento": format_dataframe_for_json(relatorio["rating_pagamento"], relatorio["var_rating_pagamento"]),
                "vendas_por_hora": format_dataframe_for_json(relatorio["vendas_por_hora"], relatorio["var_vendas_por_hora"]),
                "novas": relatorio["novas_metricas"]
            }
        }
        return response
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de data inválido. Use YYYY-MM-DD.")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

def format_dataframe_for_json(df_main, df_var):
    """
    Une as métricas principais com as variações e preenche NaN com 0 para evitar erros no JSON.
    """
    df_var_renamed = df_var.add_prefix("Var_")
    df_concat = pd.concat([df_main, df_var_renamed], axis=1)
    df_concat = df_concat.fillna(0)
    
    # Arredondar valores monetários e decimais
    for col in df_concat.columns:
        if "Total" in col or "Ticket" in col:
            df_concat[col] = df_concat[col].round(2)
        elif "Rating" in col:
            df_concat[col] = df_concat[col].round(1)
        elif "Quantity" in col:
            df_concat[col] = df_concat[col].astype(int)

    return df_concat.reset_index().to_dict(orient="records")

# --- ROTA DE SIMULAÇÃO (PUBLICAÇÃO EM FILA RABBITMQ) ---

@app.post("/api/simulate")
def trigger_sales_simulation(username: str = Depends(authenticate)):
    """
    Coloca uma mensagem na fila do RabbitMQ para gerar vendas fictícias para o próximo dia em segundo plano.
    Garante tempo de resposta imediato sem prender o servidor web.
    """
    rabbitmq_url = RABBITMQ_URL
    try:
        params = pika.URLParameters(rabbitmq_url)
        # Timeout curto para conexões rápidas
        params.socket_timeout = 3
        
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        
        # Declarar a fila como persistente
        channel.queue_declare(queue="sales_tasks", durable=True)
        
        # Enviar corpo da mensagem
        task_data = {"action": "simulate_next_day"}
        channel.basic_publish(
            exchange="",
            routing_key="sales_tasks",
            body=json.dumps(task_data),
            properties=pika.BasicProperties(
                delivery_mode=2  # Mensagem persistente no disco
            )
        )
        
        connection.close()
        return {"status": "queued", "message": "Simulação do próximo dia enviada para a fila de processamento."}
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Falha ao conectar na fila do RabbitMQ: {str(e)}. Certifique-se de que o contêiner RabbitMQ está rodando."
        )

# --- COMPATIBILIDADE N8N (ROTA LEGADA) ---

@app.get("/api/n8n")
def n8n_compatibility_endpoint(
    request_type: str = Query(..., description="get_report ou get_alerts"),
    target_date: str = Query(..., description="Data YYYY-MM-DD"),
    report_name: str = Query(None, description="Nome da tabela/relatório caso get_report"),
    username: str = Depends(authenticate)
):
    """
    Endpoint de compatibilidade exata com as requisições HTTP enviadas pela ferramenta n8n do proposta-sheets original.
    """
    try:
        df = fetch_data_from_db()
        if df.empty:
            return {"erro": "Banco de dados vazio."}

        target_date_parsed = datetime.datetime.strptime(target_date, "%Y-%m-%d").date()
        relatorio = relatorio_por_dia_com_variacoes(target_date_parsed, df)

        if not relatorio:
            return {"erro": "Nenhum dado encontrado para a data informada."}

        if request_type == "get_alerts":
            return calcular_alertas_dia(relatorio)

        elif request_type == "get_report" and report_name:
            mapping = {
                "total_por_cidade": ("total_por_cidade", "variacao_cidade", "sum"),
                "total_por_linha_produto": ("total_por_linha_produto", "variacao_linha_produto", "sum"),
                "total_por_tipo_cliente": ("total_por_tipo_cliente", "variacao_tipo_cliente", "sum"),
                "total_por_payment": ("total_por_payment", "variacao_payment", "sum"),
                "total_por_genero": ("total_por_genero", "variacao_genero", "sum"),
                "vendas_por_hora": ("vendas_por_hora", "var_vendas_por_hora", "sum"),
                "distribuicao_cidade_tipo": ("crosstab_cidade_tipo_cliente", "variacao_cidade_tipo_cliente", "cross"),
                "distribuicao_cidade_genero_tipo": ("crosstab_cidade_genero", "variacao_cidade_genero", "cross"),
                "ticket_medio_cidade": ("ticket_medio_cidade", "var_ticket_medio_cidade", "metric"),
                "rating_produto": ("rating_produto", "var_rating_produto", "metric"),
                "rating_pagamento": ("rating_pagamento", "var_rating_pagamento", "metric")
            }

            if report_name in mapping:
                key_data, key_var, report_type = mapping[report_name]
                df_main = relatorio[key_data]
                df_var = relatorio[key_var]

                if report_type == "sum":
                    df_final = pd.concat([df_main, df_var.rename(columns={"Total": "Var. Total", "Quantity": "Var. Quantity"})], axis=1)
                elif report_type == "metric":
                    df_final = pd.concat([df_main, df_var.add_prefix("Var. ")], axis=1)
                else: # cross
                    df_final = pd.concat([df_main, df_var.add_suffix(" (Var)")], axis=1).fillna(0)

                # Normalização de tipos
                if report_type == "sum":
                    cols_money = [c for c in df_final.columns if "Total" in c]
                    df_final[cols_money] = df_final[cols_money].round(2)
                    cols_qty = [c for c in df_final.columns if "Quantity" in c]
                    df_final[cols_qty] = df_final[cols_qty].fillna(0).astype(int)
                elif report_type == "metric":
                    is_rating = any("Rating" in c for c in df_final.columns)
                    decimals = 1 if is_rating else 2
                    df_final = df_final.round(decimals)
                else:
                    df_final = df_final.fillna(0).astype(int)

                return df_final.fillna(0).reset_index().to_dict(orient="records")
            else:
                return {"erro": f"Relatório '{report_name}' não encontrado no mapeamento."}

        return {"erro": "Parâmetros incorretos."}

    except Exception as e:
        return {"erro": str(e)}

# --- ROTA DE HEALTHCHECK ---

@app.get("/api/health")
def health_check():
    """
    Endpoint simples de healthcheck para monitoramento e controle do Traefik.
    """
    return {"status": "healthy", "timestamp": datetime.datetime.now().isoformat()}

# --- MONTAR FRONTEND ---
# O frontend estático será servido diretamente a partir do diretório /frontend na raiz do domínio
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
