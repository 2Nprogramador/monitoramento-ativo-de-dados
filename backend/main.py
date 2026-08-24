import os
import json
import datetime
from sqlalchemy import text as sa_text
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

try:
    from .report_utils import fetch_data_from_db, relatorio_por_dia_com_variacoes, calcular_alertas_dia
except ImportError:
    from report_utils import fetch_data_from_db, relatorio_por_dia_com_variacoes, calcular_alertas_dia

# --- ROTAS DA API ---

@app.get("/api/dates")
def get_available_dates(username: str = Depends(authenticate)):
    """
    Retorna a lista de datas com vendas registradas no banco, ordenadas do mais recente ao mais antigo.
    Utiliza query SQL direta e leve em vez de carregar toda a tabela.
    """
    try:
        query = sa_text("SELECT DISTINCT data FROM vendas ORDER BY data DESC")
        with engine.connect() as conn:
            result = conn.execute(query).fetchall()
        return [row[0].strftime("%Y-%m-%d") for row in result]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar datas: {str(e)}")

@app.get("/api/report")
def get_full_report(date: str = Query(..., description="Data no formato YYYY-MM-DD"), username: str = Depends(authenticate)):
    """
    Retorna o relatório analítico completo de um dia selecionado (dados + variações + alertas).
    """
    try:
        target_date = datetime.datetime.strptime(date, "%Y-%m-%d").date()
        df = fetch_data_from_db(target_date=target_date)
        if df.empty:
            raise HTTPException(status_code=404, detail="Banco de dados vazio.")

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
        target_date_parsed = datetime.datetime.strptime(target_date, "%Y-%m-%d").date()
        df = fetch_data_from_db(target_date=target_date_parsed)
        if df.empty:
            return {"erro": "Banco de dados vazio."}
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
