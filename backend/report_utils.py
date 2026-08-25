import os
import datetime
import pandas as pd

try:
    from .database import engine
except ImportError:
    from database import engine

def fetch_data_from_db(target_date=None, start_date=None, end_date=None):
    """
    Carrega dados da tabela de vendas do PostgreSQL em um DataFrame do Pandas.
    
    Suporta busca por target_date (1 dia + D-1) ou por intervalo start_date..end_date
    (período atual + período anterior equivalente de mesma duração para comparação).
    """
    from sqlalchemy import text as sa_text

    if start_date and end_date:
        if isinstance(start_date, str):
            start_date = datetime.datetime.strptime(start_date, "%Y-%m-%d").date()
        if isinstance(end_date, str):
            end_date = datetime.datetime.strptime(end_date, "%Y-%m-%d").date()
        
        duration_days = (end_date - start_date).days + 1
        prev_start = start_date - datetime.timedelta(days=duration_days)
        query = sa_text("SELECT * FROM vendas WHERE data >= :d_inicio AND data <= :d_fim")
        df = pd.read_sql_query(query, engine, params={"d_inicio": prev_start, "d_fim": end_date})
    elif target_date:
        if isinstance(target_date, str):
            target_date = datetime.datetime.strptime(target_date, "%Y-%m-%d").date()
        dia_anterior = target_date - datetime.timedelta(days=1)
        query = sa_text("SELECT * FROM vendas WHERE data >= :d_inicio AND data <= :d_fim")
        df = pd.read_sql_query(query, engine, params={"d_inicio": dia_anterior, "d_fim": target_date})
    else:
        df = pd.read_sql_query("SELECT * FROM vendas", engine)
    
    if df.empty:
        return df

    # Limpeza e mapeamento de colunas para compatibilidade
    df.rename(columns={
        "invoice_id": "Invoice ID",
        "city": "City",
        "customer_type": "Customer type",
        "gender": "Gender",
        "product_line": "Product line",
        "product_name": "Product name",
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
    Função de compatibilidade: calcula relatório de 1 dia delegando para relatorio_por_periodo.
    """
    if isinstance(dia_date, str):
        dia_date = datetime.datetime.strptime(dia_date, "%Y-%m-%d").date()
    return relatorio_por_periodo(dia_date, dia_date, df)

def relatorio_por_periodo(start_date, end_date, df):
    """
    Calcula relatórios agregados e variações percentuais para qualquer período de análise
    (diário, semanal, mensal ou personalizado), comparando com o período anterior de igual duração.
    """
    if isinstance(start_date, str):
        start_date = datetime.datetime.strptime(start_date, "%Y-%m-%d").date()
    if isinstance(end_date, str):
        end_date = datetime.datetime.strptime(end_date, "%Y-%m-%d").date()

    duration_days = (end_date - start_date).days + 1
    prev_end = start_date - datetime.timedelta(days=1)
    prev_start = prev_end - datetime.timedelta(days=duration_days - 1)

    df_dia = df[(df["Data"].dt.date >= start_date) & (df["Data"].dt.date <= end_date)].copy()
    df_dia_anterior = df[(df["Data"].dt.date >= prev_start) & (df["Data"].dt.date <= prev_end)].copy()

    if df_dia.empty:
        return {}

    # Limpeza de campos totalizadores na planilha legada, caso existam
    for col in ["City", "Customer type", "Gender", "Product line", "Product name", "Payment"]:
        if col in df_dia.columns:
            df_dia = df_dia[~df_dia[col].astype(str).str.lower().isin(["total", "quantity"])]
        if col in df_dia_anterior.columns:
            df_dia_anterior = df_dia_anterior[~df_dia_anterior[col].astype(str).str.lower().isin(["total", "quantity"])]

    if df_dia.empty:
        return {}

    # Obter a menor data disponível no DB para ver se é o primeiro dia de dados
    min_date = df["Data"].min().date()
    is_first_day = (start_date <= min_date)

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

    # M2. Produto mais lucrativo do dia (Usa Product name se disponível, senão Product line)
    col_prod_top = "Product name" if "Product name" in df_dia.columns else "Product line"
    if not df_dia.empty:
        produto_top = df_dia.groupby(col_prod_top)["Total"].sum().idxmax()
        produto_top_valor = df_dia.groupby(col_prod_top)["Total"].sum().max()
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
        if not df_dia_anterior.empty:
            total_cidade_ant = df_dia_anterior.groupby("City")["Total"].sum()
            total_geral_ant = df_dia_anterior["Total"].sum()
            conc_geo_ant = round((total_cidade_ant.get(cidade_top, 0.0) / total_geral_ant * 100), 1) if total_geral_ant > 0 else 0.0
            conc_geo_var = round(conc_geo_pct - conc_geo_ant, 1)
        else:
            conc_geo_var = 0.0
    else:
        cidade_top = "N/A"
        conc_geo_pct = 0.0
        conc_geo_var = 0.0

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
    
    # Variação das vendas digitais em relação ao dia anterior
    if not df_dia_anterior.empty:
        total_digital_anterior = df_dia_anterior[df_dia_anterior["Payment"].isin(pagamentos_digitais)]["Total"].sum()
        mix_digital_variacao = round(float(total_digital - total_digital_anterior), 2)
    else:
        mix_digital_variacao = 0.0

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
    
    if not df_dia_anterior.empty:
        df_hora_ant = df_dia_anterior.copy()
        df_hora_ant["Hora"] = pd.to_datetime(df_hora_ant["Time"], format='%H:%M').dt.hour
        total_tardio_ant = df_hora_ant[df_hora_ant["Hora"] >= 18]["Total"].sum()
        total_geral_ant = df_dia_anterior["Total"].sum()
        efic_noturna_ant = round((total_tardio_ant / total_geral_ant * 100), 1) if total_geral_ant > 0 else 0.0
        efic_variacao = round(efic_noturna_pct - efic_noturna_ant, 1)
    else:
        efic_variacao = None

    # M11. Itens por Compra (Cesta Media)
    itens_compra_atual = round(float(df_dia["Quantity"].mean()), 1) if not df_dia.empty and not pd.isna(df_dia["Quantity"].mean()) else 0.0
    if not df_dia_anterior.empty:
        itens_compra_ant = round(float(df_dia_anterior["Quantity"].mean()), 1) if not pd.isna(df_dia_anterior["Quantity"].mean()) else 0.0
        itens_compra_var = round(itens_compra_atual - itens_compra_ant, 1)
    else:
        itens_compra_var = None

    # M12. Maior Venda do Dia
    maior_venda_atual = round(float(df_dia["Total"].max()), 2) if not df_dia.empty and not pd.isna(df_dia["Total"].max()) else 0.0
    if not df_dia_anterior.empty:
        maior_venda_ant = round(float(df_dia_anterior["Total"].max()), 2) if not pd.isna(df_dia_anterior["Total"].max()) else 0.0
        maior_venda_var = round(maior_venda_atual - maior_venda_ant, 2)
    else:
        maior_venda_var = None

    # =========================================================================
    # 10 ANÁLISES ESTRATÉGICAS DE PRODUTOS PARA COMERCIANTES
    # =========================================================================
    
    # 1. Curva ABC de Produtos (Faturamento vs. Volume)
    col_prod = "Product name" if "Product name" in df_dia.columns else "Product line"
    prod_grouped = df_dia.groupby(col_prod).agg({"Total": "sum", "Quantity": "sum"}).sort_values(by="Total", ascending=False)
    if not prod_grouped.empty and total_geral_dia > 0:
        prod_grouped["Perc_Total"] = (prod_grouped["Total"] / total_geral_dia) * 100
        prod_grouped["Perc_Acum"] = prod_grouped["Perc_Total"].cumsum()
        prod_grouped["Classe"] = prod_grouped["Perc_Acum"].apply(lambda x: "A" if x <= 80 else ("B" if x <= 95 else "C"))
        curva_abc = prod_grouped.head(10).reset_index().to_dict(orient="records")
        for item in curva_abc:
            item["Total"] = round(float(item["Total"]), 2)
            item["Perc_Total"] = round(float(item["Perc_Total"]), 1)
            item["Perc_Acum"] = round(float(item["Perc_Acum"]), 1)
    else:
        curva_abc = []

    # 2. Detecção de Anomalias / Queda Repentina de Vendas (Linhas de Produto)
    anomalias_linhas = []
    for linha in total_por_linha_produto.index:
        tot_atual = float(total_por_linha_produto.loc[linha, "Total"])
        var_tot = float(variacao_linha_produto.loc[linha, "Total"]) if linha in variacao_linha_produto.index and pd.notna(variacao_linha_produto.loc[linha, "Total"]) else 0.0
        tot_ant = tot_atual - var_tot
        pct_var = round((var_tot / tot_ant * 100), 1) if tot_ant > 0 else 0.0
        anomalias_linhas.append({
            "linha": linha,
            "total_atual": round(tot_atual, 2),
            "total_anterior": round(tot_ant, 2),
            "variacao_pct": pct_var,
            "status": "Queda Crítica" if pct_var <= -30 else ("Alerta" if pct_var < 0 else "Crescimento")
        })

    # 3. Matriz Preço Médio vs. Volume (Elasticidade e Ticket por Linha)
    matriz_elasticidade = []
    for linha, row in total_por_linha_produto.iterrows():
        qtd = int(row["Quantity"])
        tot = float(row["Total"])
        preco_med = round(tot / qtd, 2) if qtd > 0 else 0.0
        matriz_elasticidade.append({
            "linha": linha,
            "preco_medio": preco_med,
            "quantidade": qtd,
            "total": round(tot, 2)
        })

    # 4. Perfil do Comprador por Categoria (Membro vs Normal e Gênero)
    crosstab_prod_membro = df_dia.groupby(["Product line", "Customer type"])["Total"].sum().unstack(fill_value=0)
    perfil_comprador_categoria = []
    for linha in crosstab_prod_membro.index:
        tot_membro = float(crosstab_prod_membro.loc[linha].get("Membro", 0.0))
        tot_normal = float(crosstab_prod_membro.loc[linha].get("Normal", 0.0))
        tot_categoria = tot_membro + tot_normal
        pct_membro = round((tot_membro / tot_categoria * 100), 1) if tot_categoria > 0 else 0.0
        perfil_comprador_categoria.append({
            "linha": linha,
            "membro": round(tot_membro, 2),
            "normal": round(tot_normal, 2),
            "pct_membro": pct_membro
        })

    # 5. Horários de Pico por Categoria (Manhã: até 12h, Tarde: 13-17h, Noite: 18h+)
    df_horario = df_dia.copy()
    df_horario["Hora_Num"] = df_horario["Time"].astype(str).str.split(":").str[0].astype(int)
    df_horario["Turno"] = df_horario["Hora_Num"].apply(lambda h: "Manhã (até 12h)" if h < 13 else ("Tarde (13h-17h)" if h < 18 else "Noite (18h+)"))
    horarios_categoria = df_horario.groupby(["Product line", "Turno"])["Total"].sum().unstack(fill_value=0).reset_index().to_dict(orient="records")
    for row in horarios_categoria:
        for k in ["Manhã (até 12h)", "Tarde (13h-17h)", "Noite (18h+)"]:
            row[k] = round(float(row.get(k, 0.0)), 2)

    # 6. Índice de Satisfação (Rating) por Categoria de Produto
    satisfacao_categoria = []
    for linha in rating_produto.index:
        nota_med = float(rating_produto.loc[linha, "Média_Rating"])
        qtd_avaliacoes = int(df_dia[df_dia["Product line"] == linha]["Rating"].count())
        satisfacao_categoria.append({
            "linha": linha,
            "rating_medio": round(nota_med, 1),
            "total_avaliacoes": qtd_avaliacoes,
            "nivel": "Excelente" if nota_med >= 8.5 else ("Bom" if nota_med >= 7.0 else "Crítico")
        })

    # 7. Performance Regional / Por Filial (Linhas por Cidade)
    regional_categoria = df_dia.groupby(["Product line", "City"])["Total"].sum().unstack(fill_value=0).reset_index().to_dict(orient="records")
    for row in regional_categoria:
        for c in ["São Paulo", "Rio de Janeiro", "Manaus", "Brasília", "Curitiba"]:
            if c in row:
                row[c] = round(float(row[c]), 2)

    # 8. Preferência de Pagamento por Linha de Produto
    pagamento_categoria = df_dia.groupby(["Product line", "Payment"])["Total"].sum().unstack(fill_value=0).reset_index().to_dict(orient="records")
    for row in pagamento_categoria:
        for p in ["Pix", "Cartao de Credito", "Debito", "Credit card", "Ewallet"]:
            if p in row:
                row[p] = round(float(row[p]), 2)

    # 9. Índice de Penetração / Cesta de Compras (Itens Médios por Linha)
    cesta_produtos = []
    for linha, group in df_dia.groupby("Product line"):
        media_qtd_cupom = float(group["Quantity"].mean())
        maior_cupom = float(group["Quantity"].max())
        cesta_produtos.append({
            "linha": linha,
            "media_itens_cupom": round(media_qtd_cupom, 1),
            "max_itens_cupom": int(maior_cupom)
        })

    # 10. Ritmo de Saída / Burn Rate (Velocidade diária de unidades vendidas)
    burn_rate_produtos = []
    for prod_name, group in df_dia.groupby(col_prod):
        unidades_dia = int(group["Quantity"].sum())
        receita_prod = float(group["Total"].sum())
        linha_prod = group["Product line"].iloc[0] if "Product line" in group.columns else "Geral"
        burn_rate_produtos.append({
            "produto": prod_name,
            "linha": linha_prod,
            "saida_diaria": unidades_dia,
            "receita": round(receita_prod, 2),
            "estoque_estimado_30d": unidades_dia * 30
        })
    burn_rate_produtos = sorted(burn_rate_produtos, key=lambda x: x["saida_diaria"], reverse=True)[:10]

    produtos_analises = {
        "curva_abc": curva_abc,
        "anomalias_linhas": anomalias_linhas,
        "matriz_elasticidade": matriz_elasticidade,
        "perfil_comprador_categoria": perfil_comprador_categoria,
        "horarios_categoria": horarios_categoria,
        "satisfacao_categoria": satisfacao_categoria,
        "regional_categoria": regional_categoria,
        "pagamento_categoria": pagamento_categoria,
        "cesta_produtos": cesta_produtos,
        "burn_rate_produtos": burn_rate_produtos
    }

    novas_metricas = {
        "taxa_tipo_cliente": {k: float(v) for k, v in tx_tipo_pct.items()},
        "produto_top": {"nome": produto_top, "total": round(float(produto_top_valor), 2)},
        "hora_pico": {"hora": hora_pico, "total": round(hora_pico_valor, 2)},
        "taxa_satisfacao_critica": taxa_critica,
        "concentracao_geografica": {"cidade": cidade_top, "percentual": conc_geo_pct, "variacao": conc_geo_var},
        "upv": {"atual": upv_atual, "variacao": upv_variacao},
        "mix_digital_pct": mix_digital_pct,
        "mix_digital": {
            "atual": float(total_digital),
            "variacao": mix_digital_variacao
        },
        "volume_por_genero": vol_genero,
        "linhas_sem_venda": linhas_sem_venda,
        "eficiencia_noturna_pct": {"atual": efic_noturna_pct, "variacao": efic_variacao},
        "itens_por_compra": {"atual": itens_compra_atual, "variacao": itens_compra_var},
        "maior_venda": {"atual": maior_venda_atual, "variacao": maior_venda_var},
        "produtos_analises": produtos_analises
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

def formatar_numero_br(valor, casas=1):
    """Formata número no padrão brasileiro: 1.234,5"""
    try:
        val = float(valor)
        texto = f"{val:,.{casas}f}"
        return texto.replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return str(valor)

def formatar_moeda_br(valor):
    """Formata moeda no padrão brasileiro: R$ 1.234,56"""
    return f"R$ {formatar_numero_br(valor, casas=2)}"

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
            alertas_positivos.append(f"As cidades **{cidades_str}** ultrapassaram R$ 30.000,00 em vendas totais.")

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
                        alertas_positivos.append(f"O método de pagamento **Pix** apresentou um aumento superior a 30% ({formatar_numero_br(variacao_perc, 1)}%) nas vendas.")

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
    if perc_normal > 0 and perc_normal < 20:
        alertas_negativos.append(f"Clientes **Não-Membros** representam apenas **{formatar_numero_br(perc_normal, 1)}%** das vendas — a loja parou de atrair público novo.")

    # M4. Taxa de satisfação crítica > 5%
    taxa_critica = novas.get("taxa_satisfacao_critica", 0)
    if taxa_critica > 5:
        alertas_negativos.append(f"**{formatar_numero_br(taxa_critica, 1)}%** das vendas tiveram rating abaixo de 5.0 — nível de insatisfação crítico.")

    # M5. Concentração geográfica > 60%
    conc = novas.get("concentracao_geografica", {})
    if conc.get("percentual", 0) > 60:
        alertas_negativos.append(f"A cidade **{conc.get('cidade')}** concentra **{formatar_numero_br(conc.get('percentual', 0), 1)}%** do faturamento — risco de dependência geográfica.")

    # M6. Queda de UPV > 20%
    upv = novas.get("upv", {})
    upv_var = upv.get("variacao")
    upv_atual_val = upv.get("atual", 0)
    if upv_var is not None and upv_atual_val > 0:
        upv_ant = upv_atual_val - upv_var
        if upv_ant > 0:
            queda_upv = (upv_var / upv_ant) * 100
            if queda_upv < -20:
                alertas_negativos.append(f"O Preço Médio por Unidade (UPV) caiu **{formatar_numero_br(abs(queda_upv), 1)}%** em relação ao dia anterior.")

    # M7. Mix digital abaixo de 70%
    mix_digital = novas.get("mix_digital_pct", 100)
    if mix_digital < 70:
        alertas_negativos.append(f"Pagamentos digitais representam apenas **{formatar_numero_br(mix_digital, 1)}%** do faturamento — maior risco de segurança e custo com transporte de valores.")

    # M9. Linhas de produto sem vendas
    linhas_sem = novas.get("linhas_sem_venda", [])
    if linhas_sem:
        linhas_str = ", ".join(linhas_sem)
        alertas_negativos.append(f"As linhas **{linhas_str}** não registraram nenhuma venda no dia.")

    # M2. Destaque positivo: produto top do dia
    prod_top = novas.get("produto_top", {})
    if prod_top.get("nome") and prod_top.get("nome") != "N/A":
        alertas_positivos.append(f"🏆 Produto destaque do dia: **{prod_top.get('nome')}** com {formatar_moeda_br(prod_top.get('total', 0))} em faturamento.")

    return {
        "alertas_positivos": alertas_positivos,
        "alertas_negativos": alertas_negativos,
        "total_alertas": len(alertas_positivos) + len(alertas_negativos)
    }

def calcular_alertas_semanais(relatorio):
    """
    Calcula os 10 alertas semanais (consolidados nos domingos ou ciclo de 7 dias).
    """
    alertas_positivos = []
    alertas_negativos = []

    if not relatorio:
        return {"alertas_positivos": [], "alertas_negativos": [], "total_alertas": 0}

    # 1. Meta Semanal por Filial (> R$ 180.000,00)
    if "total_por_cidade" in relatorio:
        cidades_meta = relatorio["total_por_cidade"][relatorio["total_por_cidade"]["Total"] > 180000]
        if not cidades_meta.empty:
            cidades_str = ", ".join(cidades_meta.index)
            alertas_positivos.append(f"🎯 **Meta Semanal Batida:** As filiais **{cidades_str}** ultrapassaram R$ 180.000,00 em faturamento na semana.")

    # 2. Queda Semanal de Filial (> 20%)
    if "total_por_cidade" in relatorio and "variacao_cidade" in relatorio:
        tot_atual = relatorio["total_por_cidade"]["Total"]
        var_abs = relatorio["variacao_cidade"]["Total"]
        tot_ant = tot_atual - var_abs
        valid = tot_ant[tot_ant > 0].index
        if not valid.empty:
            var_pct = (var_abs.loc[valid] / tot_ant.loc[valid]) * 100
            quedas = var_pct[var_pct < -20]
            if not quedas.empty:
                cidades_str = ", ".join(quedas.index)
                alertas_negativos.append(f"📉 **Recuo Semanal:** As filiais **{cidades_str}** tiveram queda superior a 20% frente à semana anterior.")

    # 3. Campeão de Vendas da Semana
    novas = relatorio.get("novas_metricas", {})
    prod_top = novas.get("produto_top", {})
    if prod_top.get("nome") and prod_top.get("nome") != "N/A":
        alertas_positivos.append(f"🏆 **Campeão da Semana:** O produto **{prod_top.get('nome')}** liderou as vendas acumulando {formatar_moeda_br(prod_top.get('total', 0))}.")

    # 4. Aceleração de Pix Semanal (+20%)
    if "total_por_payment" in relatorio and "variacao_payment" in relatorio:
        if "Pix" in relatorio["total_por_payment"].index:
            tot_pix = relatorio["total_por_payment"].loc["Pix", "Total"]
            var_pix = relatorio["variacao_payment"].loc["Pix", "Total"] if "Pix" in relatorio["variacao_payment"].index else 0
            ant_pix = tot_pix - var_pix
            if ant_pix > 0:
                pct_pix = (var_pix / ant_pix) * 100
                if pct_pix > 20:
                    alertas_positivos.append(f"⚡ **Aceleração Pix:** Uso de Pix cresceu **{formatar_numero_br(pct_pix, 1)}%** no volume financeiro da semana.")

    # 5. Alta Rotação Semanal (> 2.000 unidades)
    if "total_por_linha_produto" in relatorio:
        linhas_altas = relatorio["total_por_linha_produto"][relatorio["total_por_linha_produto"]["Quantity"] > 2000]
        if not linhas_altas.empty:
            linhas_str = ", ".join(linhas_altas.index)
            alertas_positivos.append(f"📦 **Alta Rotação Semanal:** As categorias **{linhas_str}** superaram 2.000 unidades vendidas — programar reposição.")

    # 6. Baixa Aquisição Semanal de Clientes (< 25% novos clientes)
    tx_tipo = novas.get("taxa_tipo_cliente", {})
    perc_normal = tx_tipo.get("Normal", tx_tipo.get("normal", 0))
    if perc_normal > 0 and perc_normal < 25:
        alertas_negativos.append(f"👥 **Baixa Entrada de Clientes:** Clientes novos representaram apenas **{formatar_numero_br(perc_normal, 1)}%** das vendas da semana.")

    # 7. Índice Crítico de Insatisfação Semanal (> 5% rating < 5.0)
    taxa_critica = novas.get("taxa_satisfacao_critica", 0)
    if taxa_critica > 5:
        alertas_negativos.append(f"⚠️ **Alerta de Qualidade Semanal:** **{formatar_numero_br(taxa_critica, 1)}%** das compras da semana receberam avaliações críticas (< 5.0).")

    # 8. Concentração Semanal de Risco Regional (> 55%)
    conc = novas.get("concentracao_geografica", {})
    if conc.get("percentual", 0) > 55:
        alertas_negativos.append(f"🌐 **Concentração Semanal de Risco:** A filial **{conc.get('cidade')}** concentrou **{formatar_numero_br(conc.get('percentual', 0), 1)}%** da receita da semana.")

    # 9. Queda de UPV Semanal (> 15%)
    upv = novas.get("upv", {})
    upv_var = upv.get("variacao")
    upv_atual = upv.get("atual", 0)
    if upv_var is not None and upv_atual > 0:
        upv_ant = upv_atual - upv_var
        if upv_ant > 0:
            queda = (upv_var / upv_ant) * 100
            if queda < -15:
                alertas_negativos.append(f"🏷️ **Erosão de Preço Semanal:** O Preço Médio por Unidade (UPV) caiu **{formatar_numero_br(abs(queda), 1)}%** frente à semana anterior.")

    # 10. Queda de Pagamentos Digitais Semanal (< 75%)
    mix_dig = novas.get("mix_digital_pct", 100)
    if mix_dig < 75:
        alertas_negativos.append(f"💳 **Alerta de Caixa Físico:** Pagamentos digitais somaram apenas **{formatar_numero_br(mix_dig, 1)}%** na semana — risco operacional com dinheiro.")

    return {
        "alertas_positivos": alertas_positivos,
        "alertas_negativos": alertas_negativos,
        "total_alertas": len(alertas_positivos) + len(alertas_negativos)
    }

def calcular_alertas_mensais(relatorio):
    """
    Calcula os 10 alertas mensais (consolidados nos dias 30/31 ou fechamento de ciclo de 30 dias).
    """
    alertas_positivos = []
    alertas_negativos = []

    if not relatorio:
        return {"alertas_positivos": [], "alertas_negativos": [], "total_alertas": 0}

    # 1. Superação de Meta Mensal por Filial (> R$ 750.000,00)
    if "total_por_cidade" in relatorio:
        cidades_meta = relatorio["total_por_cidade"][relatorio["total_por_cidade"]["Total"] > 750000]
        if not cidades_meta.empty:
            cidades_str = ", ".join(cidades_meta.index)
            alertas_positivos.append(f"🎯 **Meta Mensal Batida:** As filiais **{cidades_str}** superaram a meta mensal com mais de R$ 750.000,00 faturados.")

    # 2. Recuo Mensal de Vendas por Cidade (> 15%)
    if "total_por_cidade" in relatorio and "variacao_cidade" in relatorio:
        tot_atual = relatorio["total_por_cidade"]["Total"]
        var_abs = relatorio["variacao_cidade"]["Total"]
        tot_ant = tot_atual - var_abs
        valid = tot_ant[tot_ant > 0].index
        if not valid.empty:
            var_pct = (var_abs.loc[valid] / tot_ant.loc[valid]) * 100
            quedas = var_pct[var_pct < -15]
            if not quedas.empty:
                cidades_str = ", ".join(quedas.index)
                alertas_negativos.append(f"📉 **Recuo Mensal:** As filiais **{cidades_str}** registraram queda superior a 15% no faturamento consolidado do mês.")

    # 3. Produto Campeão do Mês
    novas = relatorio.get("novas_metricas", {})
    prod_top = novas.get("produto_top", {})
    if prod_top.get("nome") and prod_top.get("nome") != "N/A":
        alertas_positivos.append(f"🏆 **Campeão do Mês:** O produto **{prod_top.get('nome')}** foi o líder absoluto de faturamento mensal gerando {formatar_moeda_br(prod_top.get('total', 0))}.")

    # 4. Crescimento Consolidado de Pix no Mês (+15%)
    if "total_por_payment" in relatorio and "variacao_payment" in relatorio:
        if "Pix" in relatorio["total_por_payment"].index:
            tot_pix = relatorio["total_por_payment"].loc["Pix", "Total"]
            var_pix = relatorio["variacao_payment"].loc["Pix", "Total"] if "Pix" in relatorio["variacao_payment"].index else 0
            ant_pix = tot_pix - var_pix
            if ant_pix > 0:
                pct_pix = (var_pix / ant_pix) * 100
                if pct_pix > 15:
                    alertas_positivos.append(f"🚀 **Expansão Mensal do Pix:** O volume via Pix cresceu **{formatar_numero_br(pct_pix, 1)}%** no consolidado do mês.")

    # 5. Alta Demanda Mensal (> 8.000 unidades)
    if "total_por_linha_produto" in relatorio:
        linhas_altas = relatorio["total_por_linha_produto"][relatorio["total_por_linha_produto"]["Quantity"] > 8000]
        if not linhas_altas.empty:
            linhas_str = ", ".join(linhas_altas.index)
            alertas_positivos.append(f"📦 **Alta Demanda Mensal:** As categorias **{linhas_str}** ultrapassaram 8.000 unidades vendidas — planejar compras com fornecedores.")

    # 6. Alerta Mensal de Aquisição de Clientes (< 20% novos clientes)
    tx_tipo = novas.get("taxa_tipo_cliente", {})
    perc_normal = tx_tipo.get("Normal", tx_tipo.get("normal", 0))
    if perc_normal > 0 and perc_normal < 20:
        alertas_negativos.append(f"👥 **Estagnação de Base:** Clientes novos representaram apenas **{formatar_numero_br(perc_normal, 1)}%** das vendas mensais — necessidade de novas campanhas.")

    # 7. Satisfação Crítica Mensal (> 6% rating < 5.0)
    taxa_critica = novas.get("taxa_satisfacao_critica", 0)
    if taxa_critica > 6:
        alertas_negativos.append(f"⚠️ **Índice Crítico de CSAT Mensal:** **{formatar_numero_br(taxa_critica, 1)}%** das avaliações do mês foram negativas (< 5.0) — revisar processos de atendimento.")

    # 8. Dependência Geográfica Mensal (> 50%)
    conc = novas.get("concentracao_geografica", {})
    if conc.get("percentual", 0) > 50:
        alertas_negativos.append(f"🌐 **Dependência Regional Mensal:** A filial **{conc.get('cidade')}** respondeu por **{formatar_numero_br(conc.get('percentual', 0), 1)}%** de toda a receita da rede no mês.")

    # 9. Queda Estrutural de UPV Mensal (> 10%)
    upv = novas.get("upv", {})
    upv_var = upv.get("variacao")
    upv_atual = upv.get("atual", 0)
    if upv_var is not None and upv_atual > 0:
        upv_ant = upv_atual - upv_var
        if upv_ant > 0:
            queda = (upv_var / upv_ant) * 100
            if queda < -10:
                alertas_negativos.append(f"🏷️ **Queda Estrutural de UPV:** O Preço Médio por Unidade caiu **{formatar_numero_br(abs(queda), 1)}%** no mês — auditar política de descontos.")

    # 10. Queda de Eficiência Noturna Mensal (< 25%)
    efic = novas.get("eficiencia_noturna_pct", {})
    efic_val = efic.get("atual", 0) if isinstance(efic, dict) else efic
    if efic_val < 25:
        alertas_negativos.append(f"🌙 **Oportunidade Noturna:** Apenas **{formatar_numero_br(efic_val, 1)}%** da receita do mês ocorreu após as 18h — reavaliar horários de pico e escalas.")

    return {
        "alertas_positivos": alertas_positivos,
        "alertas_negativos": alertas_negativos,
        "total_alertas": len(alertas_positivos) + len(alertas_negativos)
    }

def calcular_pacote_alertas_com_blocos(ref_date, min_date):
    """
    Calcula os alertas Diários (do dia ref_date),
    Alertas Semanais (baseados estritamente em blocos de 7 dias a partir de min_date) e
    Alertas Mensais (baseados estritamente em blocos de 30 dias a partir de min_date).
    """
    if isinstance(ref_date, str):
        ref_date = datetime.datetime.strptime(ref_date, "%Y-%m-%d").date()
    if isinstance(min_date, str):
        min_date = datetime.datetime.strptime(min_date, "%Y-%m-%d").date()

    dias_decorridos = (ref_date - min_date).days + 1
    
    # 1. Alertas Diários
    df_dia = fetch_data_from_db(target_date=ref_date)
    rel_dia = relatorio_por_dia_com_variacoes(ref_date, df_dia) if not df_dia.empty else {}
    alertas_d = calcular_alertas_dia(rel_dia)
    alertas_d["bloco_info"] = f"Dia {ref_date.strftime('%d/%m/%Y')}"

    # 2. Alertas Semanais (Blocos de 7 dias a partir do início da base)
    num_blocos_sem = dias_decorridos // 7
    if num_blocos_sem == 0:
        alertas_s = {
            "alertas_positivos": [],
            "alertas_negativos": [f"ℹ️ Os alertas semanais são consolidados a cada 7 dias completos a partir do início da base ({min_date.strftime('%d/%m/%Y')}). Mínimo de 7 dias necessário."],
            "total_alertas": 0,
            "bloco_completo": False,
            "bloco_info": f"Em formação (Dia {dias_decorridos}/7 do Bloco #1)"
        }
    else:
        fim_sem = min_date + datetime.timedelta(days=(num_blocos_sem * 7) - 1)
        ini_sem = fim_sem - datetime.timedelta(days=6)
        df_sem = fetch_data_from_db(start_date=ini_sem, end_date=fim_sem)
        rel_sem = relatorio_por_periodo(ini_sem, fim_sem, df_sem) if not df_sem.empty else {}
        alertas_s = calcular_alertas_semanais(rel_sem)
        alertas_s["bloco_completo"] = True
        alertas_s["bloco_info"] = f"Bloco #{num_blocos_sem} ({ini_sem.strftime('%d/%m/%Y')} a {fim_sem.strftime('%d/%m/%Y')})"

    # 3. Alertas Mensais (Blocos de 30 dias a partir do início da base)
    num_blocos_mes = dias_decorridos // 30
    if num_blocos_mes == 0:
        alertas_m = {
            "alertas_positivos": [],
            "alertas_negativos": [f"ℹ️ Os alertas mensais são consolidados a cada 30 dias completos a partir do início da base ({min_date.strftime('%d/%m/%Y')}). Mínimo de 30 dias necessário."],
            "total_alertas": 0,
            "bloco_completo": False,
            "bloco_info": f"Em formação (Dia {dias_decorridos}/30 do Mês #1)"
        }
    else:
        fim_mes = min_date + datetime.timedelta(days=(num_blocos_mes * 30) - 1)
        ini_mes = fim_mes - datetime.timedelta(days=29)
        df_mes = fetch_data_from_db(start_date=ini_mes, end_date=fim_mes)
        rel_mes = relatorio_por_periodo(ini_mes, fim_mes, df_mes) if not df_mes.empty else {}
        alertas_m = calcular_alertas_mensais(rel_mes)
        alertas_m["bloco_completo"] = True
        alertas_m["bloco_info"] = f"Mês #{num_blocos_mes} ({ini_mes.strftime('%d/%m/%Y')} a {fim_mes.strftime('%d/%m/%Y')})"

    return alertas_d, alertas_s, alertas_m
