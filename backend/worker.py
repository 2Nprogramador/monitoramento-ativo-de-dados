import os
import sys
import json
import random
import datetime
import time
import pandas as pd
import pika
from sqlalchemy import text

import urllib.request
import urllib.error

# Importar o engine de banco de dados e URL do RabbitMQ
from database import engine
from config import RABBITMQ_URL, N8N_WEBHOOK_URL

try:
    from report_utils import (
        fetch_data_from_db,
        relatorio_por_dia_com_variacoes,
        relatorio_por_periodo,
        calcular_alertas_dia,
        calcular_alertas_semanais,
        calcular_alertas_mensais
    )
except ImportError:
    from .report_utils import (
        fetch_data_from_db,
        relatorio_por_dia_com_variacoes,
        relatorio_por_periodo,
        calcular_alertas_dia,
        calcular_alertas_semanais,
        calcular_alertas_mensais
    )


def obter_ultima_data_db():
    """
    Consulta o banco de dados para encontrar a data mais recente de vendas.
    Caso o banco esteja vazio, assume o dia anterior ao atual.
    """
    query = "SELECT MAX(data) FROM vendas"
    with engine.connect() as conn:
        result = conn.execute(text(query)).fetchone()
        if result and result[0]:
            return result[0]
    return datetime.date.today() - datetime.timedelta(days=1)

def obter_primeira_data_db():
    """
    Consulta o banco de dados para encontrar a primeira data (início histórico) de vendas.
    """
    query = "SELECT MIN(data) FROM vendas"
    with engine.connect() as conn:
        result = conn.execute(text(query)).fetchone()
        if result and result[0]:
            return result[0]
    return datetime.date.today()

# ==============================================================================
# CATÁLOGO DE 100 PRODUTOS (20 PRODUTOS POR SETOR COM DIVERSAS MODALIDADES)
# ==============================================================================
CATALOGO_PRODUTOS = [
    # 1. Saúde e Beleza (20 produtos)
    {"line": "Saude e Beleza", "name": "Sérum Facial Vitamina C 30ml", "price": 89.90},
    {"line": "Saude e Beleza", "name": "Creme Anti-Idade Ácido Hialurônico", "price": 115.00},
    {"line": "Saude e Beleza", "name": "Perfume Eau de Parfum Floral 100ml", "price": 129.00},
    {"line": "Saude e Beleza", "name": "Escova Secadora e Modeladora 1200W", "price": 125.00},
    {"line": "Saude e Beleza", "name": "Kit Pincéis de Maquiagem Profissional", "price": 79.90},
    {"line": "Saude e Beleza", "name": "Protetor Solar Facial FPS 50", "price": 54.90},
    {"line": "Saude e Beleza", "name": "Hidratante Corporal Ceramidas 400ml", "price": 42.50},
    {"line": "Saude e Beleza", "name": "Shampoo Reparador Óleo de Argan 300ml", "price": 36.90},
    {"line": "Saude e Beleza", "name": "Condicionador Nutritivo Queratina", "price": 38.90},
    {"line": "Saude e Beleza", "name": "Máscara de Tratamento Capilar 500g", "price": 49.90},
    {"line": "Saude e Beleza", "name": "Base Líquida Alta Cobertura", "price": 58.00},
    {"line": "Saude e Beleza", "name": "Batom Matte Longa Duração", "price": 29.90},
    {"line": "Saude e Beleza", "name": "Paleta de Sombras 12 Cores", "price": 64.90},
    {"line": "Saude e Beleza", "name": "Sabonete Facial Pele Oleosa 150ml", "price": 32.00},
    {"line": "Saude e Beleza", "name": "Tônico Micelar Purificante 200ml", "price": 35.00},
    {"line": "Saude e Beleza", "name": "Óleo Essencial Puro Lavanda 15ml", "price": 45.00},
    {"line": "Saude e Beleza", "name": "Esfoliante Corporal Café e Açúcar", "price": 39.90},
    {"line": "Saude e Beleza", "name": "Desodorante Antitranspirante Roll-On", "price": 14.90},
    {"line": "Saude e Beleza", "name": "Gel Dental Branqueador Avançado", "price": 18.50},
    {"line": "Saude e Beleza", "name": "Protetor Labial Manteiga de Cacau", "price": 12.00},

    # 2. Acessórios Eletrônicos (20 produtos)
    {"line": "Acessorios Eletronicos", "name": "Fone de Ouvido Bluetooth Noise Cancelling Pro", "price": 129.90},
    {"line": "Acessorios Eletronicos", "name": "Smartwatch Monitor Cardíaco AMOLED", "price": 125.00},
    {"line": "Acessorios Eletronicos", "name": "Teclado Mecânico Gamer RGB Switch Blue", "price": 119.00},
    {"line": "Acessorios Eletronicos", "name": "Headset Gamer Surround 7.1", "price": 98.00},
    {"line": "Acessorios Eletronicos", "name": "Hub USB-C 7 em 1 HDMI 4K", "price": 89.90},
    {"line": "Acessorios Eletronicos", "name": "Mousepad Gamer Speed Extra Grande", "price": 49.90},
    {"line": "Acessorios Eletronicos", "name": "Mouse Sem Fio Ergonômico 4000 DPI", "price": 65.00},
    {"line": "Acessorios Eletronicos", "name": "Carregador Turbo USB-C GaN 65W", "price": 79.90},
    {"line": "Acessorios Eletronicos", "name": "Power Bank 20.000mAh Rápido", "price": 89.00},
    {"line": "Acessorios Eletronicos", "name": "Caixa de Som Bluetooth Portátil IPX7", "price": 75.00},
    {"line": "Acessorios Eletronicos", "name": "Webcam Full HD 1080p com Microfone", "price": 85.00},
    {"line": "Acessorios Eletronicos", "name": "Carregador por Indução Sem Fio 15W", "price": 59.90},
    {"line": "Acessorios Eletronicos", "name": "Suporte Articulado para Notebook Alumínio", "price": 55.00},
    {"line": "Acessorios Eletronicos", "name": "Tripé Flexível com Ring Light LED", "price": 45.00},
    {"line": "Acessorios Eletronicos", "name": "Cabo USB-C Reforçado Nylon 2m", "price": 25.00},
    {"line": "Acessorios Eletronicos", "name": "Cartão de Memória MicroSD 128GB Classe 10", "price": 49.90},
    {"line": "Acessorios Eletronicos", "name": "Película Protetora Vidro 9H", "price": 15.00},
    {"line": "Acessorios Eletronicos", "name": "Capa Protetora Anti-Impacto", "price": 29.90},
    {"line": "Acessorios Eletronicos", "name": "Adaptador Bluetooth 5.0 USB", "price": 22.00},
    {"line": "Acessorios Eletronicos", "name": "Suporte Veicular Magnético Smartphone", "price": 19.90},

    # 3. Casa e Estilo de Vida (20 produtos)
    {"line": "Casa e Estilo de Vida", "name": "Fritadeira Air Fryer Digital 4.5L", "price": 129.00},
    {"line": "Casa e Estilo de Vida", "name": "Aspirador de Pó Robô Inteligente Wi-Fi", "price": 130.00},
    {"line": "Casa e Estilo de Vida", "name": "Cafeteira Expresso Elétrica 15 Bar", "price": 125.00},
    {"line": "Casa e Estilo de Vida", "name": "Liquidificador Potente 1200W Copo Vidro", "price": 89.90},
    {"line": "Casa e Estilo de Vida", "name": "Jogo de Panelas Cerâmica Antiaderente 5 Peças", "price": 128.00},
    {"line": "Casa e Estilo de Vida", "name": "Jogo de Lençol 100% Algodão 300 Fios", "price": 95.00},
    {"line": "Casa e Estilo de Vida", "name": "Toalha de Banho Fio Penteado Extra Macia", "price": 45.00},
    {"line": "Casa e Estilo de Vida", "name": "Manta Soft Aveludada Microfibra", "price": 55.00},
    {"line": "Casa e Estilo de Vida", "name": "Faqueiro Inox 24 Peças com Estojo", "price": 78.00},
    {"line": "Casa e Estilo de Vida", "name": "Conjunto Pratos Porcelana 16 Peças", "price": 110.00},
    {"line": "Casa e Estilo de Vida", "name": "Difusor Aromatizador Ultrassônico RGB", "price": 59.90},
    {"line": "Casa e Estilo de Vida", "name": "Luminária de Mesa LED Articulada Touch", "price": 48.00},
    {"line": "Casa e Estilo de Vida", "name": "Garrafa Térmica Aço Inox 1L", "price": 42.00},
    {"line": "Casa e Estilo de Vida", "name": "Pote Hermético Vidro com Tampa Bambu", "price": 28.00},
    {"line": "Casa e Estilo de Vida", "name": "Balança Digital Cozinha Alta Precisão", "price": 32.00},
    {"line": "Casa e Estilo de Vida", "name": "Organizador Multiuso Gavetas Acrílico", "price": 24.90},
    {"line": "Casa e Estilo de Vida", "name": "Tapete Antiderrapante Sala Geométrico", "price": 68.00},
    {"line": "Casa e Estilo de Vida", "name": "Quadro Decorativo Minimalista Moldura", "price": 49.00},
    {"line": "Casa e Estilo de Vida", "name": "Cesto Roupas Dobrável Impermeável", "price": 34.90},
    {"line": "Casa e Estilo de Vida", "name": "Cortador e Fatiador Legumes Multiuso", "price": 22.00},

    # 4. Esportes e Viagens (20 produtos)
    {"line": "Esportes e Viagens", "name": "Mala de Viagem Rígida Bordo 360 Graus TSA", "price": 129.00},
    {"line": "Esportes e Viagens", "name": "Mochila Impermeável Notebook e Viagem 40L", "price": 98.00},
    {"line": "Esportes e Viagens", "name": "Kit Organizador de Malas Viagem 6 Peças", "price": 39.90},
    {"line": "Esportes e Viagens", "name": "Almofada de Pescoço Espuma Viscoelástica", "price": 34.00},
    {"line": "Esportes e Viagens", "name": "Cadeado TSA com Segredo para Bagagem", "price": 25.00},
    {"line": "Esportes e Viagens", "name": "Tênis de Corrida Amortecimento Avançado", "price": 125.00},
    {"line": "Esportes e Viagens", "name": "Garrafa Térmica Esportiva Inox 750ml", "price": 45.00},
    {"line": "Esportes e Viagens", "name": "Tapete Yoga Mat Antiderrapante TPE 6mm", "price": 62.00},
    {"line": "Esportes e Viagens", "name": "Kit Faixas Elásticas Extensoras Mini Bands", "price": 32.00},
    {"line": "Esportes e Viagens", "name": "Corda de Pular Crossfit Rolamento Duplo", "price": 28.00},
    {"line": "Esportes e Viagens", "name": "Luva de Musculação com Munhequeira", "price": 36.00},
    {"line": "Esportes e Viagens", "name": "Óculos de Natação Anti-Embaçante UV", "price": 42.00},
    {"line": "Esportes e Viagens", "name": "Colchonete Ginástica Alta Densidade", "price": 48.00},
    {"line": "Esportes e Viagens", "name": "Pochete de Corrida Slim Impermeável", "price": 24.00},
    {"line": "Esportes e Viagens", "name": "Bolsa Esportiva Térmica Treino", "price": 55.00},
    {"line": "Esportes e Viagens", "name": "Barraca de Camping 4 Pessoas Impermeável", "price": 128.00},
    {"line": "Esportes e Viagens", "name": "Saco de Dormir Térmico Compacto", "price": 85.00},
    {"line": "Esportes e Viagens", "name": "Lanterna Tática Recarregável LED Forte", "price": 45.00},
    {"line": "Esportes e Viagens", "name": "Canivete Suíço Multiuso Inox", "price": 49.90},
    {"line": "Esportes e Viagens", "name": "Bastão de Caminhada Retrátil Trilha", "price": 39.00},

    # 5. Moda (20 produtos)
    {"line": "Moda", "name": "Blazer Slim Fit Alfaiataria", "price": 128.00},
    {"line": "Moda", "name": "Camisa Social Manga Longa Algodão Nobre", "price": 89.90},
    {"line": "Moda", "name": "Macacão Longo Alfaiataria com Cinto", "price": 115.00},
    {"line": "Moda", "name": "Calça Pantalona Tecido Fluido", "price": 85.00},
    {"line": "Moda", "name": "Cinto Couro Legítimo Fivela Metálica", "price": 45.00},
    {"line": "Moda", "name": "Jaqueta Jeans Oversized Estonada", "price": 119.00},
    {"line": "Moda", "name": "Calça Jeans Skinny Alta Elasticidade", "price": 88.00},
    {"line": "Moda", "name": "Vestido Midi Canelado Elegante", "price": 72.00},
    {"line": "Moda", "name": "Cardigan Tricot Macio Botões", "price": 68.00},
    {"line": "Moda", "name": "Bermuda Sarja Casual com Bolsos", "price": 59.90},
    {"line": "Moda", "name": "Shorts Jeans Cintura Alta Desfiado", "price": 54.00},
    {"line": "Moda", "name": "Saia Plissada Cintura Alta", "price": 62.00},
    {"line": "Moda", "name": "Jaqueta Corta-Vento Estilo Esportivo", "price": 85.00},
    {"line": "Moda", "name": "Polo Masculina Algodão Piquet", "price": 58.00},
    {"line": "Moda", "name": "Vestido Floral Verão Tecido Leve", "price": 69.00},
    {"line": "Moda", "name": "Camiseta Básica Premium 100% Algodão Pima", "price": 39.90},
    {"line": "Moda", "name": "Calça Moletom Confort com Punho", "price": 64.00},
    {"line": "Moda", "name": "Top Cropped Faixa Canelado", "price": 26.00},
    {"line": "Moda", "name": "Pijama Cetim Manga Curta Confort", "price": 52.00},
    {"line": "Moda", "name": "Meia Cano Médio Algodão Kit 3 Pares", "price": 19.90}
]

def gerar_dados_proximo_dia():
    """
    Gera novas vendas aleatórias para o próximo dia subsequente à última data do DB
    utilizando o catálogo de 100 produtos cadastrados.
    """
    ultima_data = obter_ultima_data_db()
    proximo_dia = ultima_data + datetime.timedelta(days=1)
    return gerar_dados_para_data(proximo_dia)

def gerar_dados_para_data(data_alvo):
    """
    Gera transações de vendas realistas para uma data específica utilizando o catálogo de 100 produtos.
    """
    qtd_transacoes = random.randint(120, 280)
    novas_linhas = []
    
    cidades = ['Rio de Janeiro', 'São Paulo', 'Manaus']
    tipos_cliente = ['Normal', 'Membro']
    generos = ['Homem', 'Mulher']
    pagamentos = ['Pix', 'Cartao de Credito', 'Debito']
    
    print(f"[Worker] Gerando {qtd_transacoes} transações para a data {data_alvo}...")

    for _ in range(qtd_transacoes):
        invoice_id = f"{random.randint(100, 999)}-{random.randint(10, 99)}-{random.randint(1000, 9999)}"
        city = random.choice(cidades)
        customer_type = random.choice(tipos_cliente)
        gender = random.choice(generos)
        
        # Sortear produto do catálogo de 100 itens
        prod = random.choice(CATALOGO_PRODUTOS)
        product_line = prod["line"]
        product_name = prod["name"]
        
        # Preço rigorosamente fixo de catálogo para o produto
        unit_price = round(float(prod["price"]), 2)
        
        quantity = random.randint(1, 12)
        total = round(unit_price * quantity, 2)
        
        hora = random.randint(7, 23)
        minuto = random.randint(0, 59)
        time_str = f"{hora:02d}:{minuto:02d}"
        
        payment = random.choice(pagamentos)
        rating = round(random.uniform(3.5, 10.0), 1)
        
        linha = {
            "invoice_id": invoice_id,
            "city": city,
            "customer_type": customer_type,
            "gender": gender,
            "product_line": product_line,
            "product_name": product_name,
            "unit_price": unit_price,
            "quantity": int(quantity),
            "total": total,
            "time": time_str,
            "payment": payment,
            "rating": rating,
            "data": data_alvo
        }
        novas_linhas.append(linha)
        
    return pd.DataFrame(novas_linhas)

def salvar_dados_postgres(df_novos_dados):
    """
    Grava os novos dados gerados diretamente no PostgreSQL usando pandas.to_sql.
    """
    try:
        df_novos_dados.to_sql("vendas", con=engine, if_exists="append", index=False)
        print(f"[Worker] Gravados com sucesso {len(df_novos_dados)} registros no banco.")
        return True
    except Exception as e:
        print(f"[Worker] Erro ao gravar dados no PostgreSQL: {e}")
        return False

def disparar_alertas_webhook(dia_date):
    """
    Carrega dados do banco, gera alertas para dia_date (diários) e, quando aplicável,
    dispara também os relatórios consolidados semanais (aos domingos) e mensais (fechamento de mês) para o n8n.
    """
    if not N8N_WEBHOOK_URL:
        print("[Worker] N8N_WEBHOOK_URL não configurado. Pulando disparo de alertas.")
        return

    import re

    def formatar_para_whatsapp(texto):
        try:
            emoji_pattern = re.compile(
                "["
                "\U0001f600-\U0001f64f|"
                "\U0001f300-\U0001f5ff|"
                "\U0001f680-\U0001f6ff|"
                "\U0001f1e0-\U0001f1ff|"
                "\U00002700-\U000027bf|"
                "\U00002600-\U000026ff|"
                "\U0001f900-\U0001f9ff|"
                "\U0001fa00-\U0001faff"
                "]+", flags=re.UNICODE
            )
            texto = emoji_pattern.sub(r"", texto).strip()
        except Exception:
            for em in ["🏆", "⭐", "📊", "📅", "🟢", "🔴", "✅", "⚠️", "💡", "🚨", "🎯", "📉", "⚡", "📦", "👥", "🌐", "🏷️", "💳", "🚀", "🌙"]:
                texto = texto.replace(em, "")
        
        return texto.replace("**", "*").strip()

    def enviar_para_n8n(tipo_relatorio, titulo, periodo_str, alertas_dict):
        positivos = alertas_dict.get("alertas_positivos", [])
        negativos = alertas_dict.get("alertas_negativos", [])
        total = alertas_dict.get("total_alertas", len(positivos) + len(negativos))

        msg = f"*{titulo}*\n"
        msg += f"*Período:* {periodo_str}\n\n"
        msg += "────────────────────────\n\n"

        if positivos:
            msg += "*HIGHLIGHTS POSITIVOS*\n\n"
            for p in positivos:
                msg += f"- {formatar_para_whatsapp(p)}\n\n"
            msg += "────────────────────────\n\n"

        if negativos:
            msg += "*PONTOS DE ATENÇÃO*\n\n"
            for n in negativos:
                msg += f"- {formatar_para_whatsapp(n)}\n\n"
            msg += "────────────────────────\n\n"

        if not positivos and not negativos:
            msg += "Nenhum alerta crítico gerado para este período.\n\n"
            msg += "────────────────────────\n\n"

        msg += "_Acesse o painel web para ver o dashboard interativo completo._"

        payload = {
            "date": str(dia_date),
            "period_type": tipo_relatorio,
            "period_label": periodo_str,
            "total_alertas": total,
            "alertas": alertas_dict,
            "message": msg
        }

        try:
            data_bytes = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                N8N_WEBHOOK_URL,
                data=data_bytes,
                headers={"Content-Type": "application/json"}
            )
            print(f"[Worker] Enviando {tipo_relatorio} ({total} alertas) para o n8n...")
            with urllib.request.urlopen(req, timeout=10) as response:
                res_body = response.read().decode("utf-8")
                print(f"[Worker] Webhook n8n ({tipo_relatorio}) respondido com status {response.status}: {res_body}")
        except Exception as err:
            print(f"[Worker] Erro ao enviar {tipo_relatorio} ao n8n: {err}")

    try:
        min_date = obter_primeira_data_db()
        dias_decorridos = (dia_date - min_date).days + 1
        print(f"[Worker] Processando alertas para {dia_date} (Dia {dias_decorridos} desde início em {min_date})...")

        # 1. Alertas Diários (sempre disparados para o dia atual)
        df_dia = fetch_data_from_db(target_date=dia_date)
        if not df_dia.empty:
            rel_dia = relatorio_por_dia_com_variacoes(dia_date, df_dia)
            if rel_dia:
                alertas_dia = calcular_alertas_dia(rel_dia)
                dia_fmt = dia_date.strftime("%d/%m/%Y") if hasattr(dia_date, "strftime") else str(dia_date)
                enviar_para_n8n("daily", "RELATÓRIO DE ALERTAS DIÁRIOS", dia_fmt, alertas_dia)

        # 2. Alertas Semanais (Disparados estritamente ao fechar blocos de 7 dias: dia 7, 14, 21, 28...)
        if dias_decorridos >= 7 and (dias_decorridos % 7 == 0):
            num_bloco_s = dias_decorridos // 7
            s_sem = dia_date - datetime.timedelta(days=6)
            print(f"[Worker] Fechamento de Bloco Semanal #{num_bloco_s}! Calculando alertas ({s_sem} até {dia_date})...")
            df_sem = fetch_data_from_db(start_date=s_sem, end_date=dia_date)
            if not df_sem.empty:
                rel_sem = relatorio_por_periodo(s_sem, dia_date, df_sem)
                if rel_sem:
                    alertas_sem = calcular_alertas_semanais(rel_sem)
                    sem_fmt = f"{s_sem.strftime('%d/%m/%Y')} a {dia_date.strftime('%d/%m/%Y')}"
                    enviar_para_n8n("weekly", f"CONSOLIDADO DE ALERTAS SEMANAIS (BLOCO #{num_bloco_s})", sem_fmt, alertas_sem)

        # 3. Alertas Mensais (Disparados estritamente ao fechar blocos de 30 dias: dia 30, 60...)
        dia_seguinte = dia_date + datetime.timedelta(days=1)
        is_fim_de_mes = (dia_seguinte.day == 1) or (dias_decorridos >= 30 and dias_decorridos % 30 == 0)
        if is_fim_de_mes and dias_decorridos >= 30:
            num_bloco_m = dias_decorridos // 30
            s_mes = dia_date - datetime.timedelta(days=29)
            print(f"[Worker] Fechamento de Mês #{num_bloco_m}! Calculando alertas ({s_mes} até {dia_date})...")
            df_mes = fetch_data_from_db(start_date=s_mes, end_date=dia_date)
            if not df_mes.empty:
                rel_mes = relatorio_por_periodo(s_mes, dia_date, df_mes)
                if rel_mes:
                    alertas_mes = calcular_alertas_mensais(rel_mes)
                    mes_fmt = f"{s_mes.strftime('%d/%m/%Y')} a {dia_date.strftime('%d/%m/%Y')}"
                    enviar_para_n8n("monthly", f"FECHAMENTO DE ALERTAS MENSAIS (MÊS #{num_bloco_m})", mes_fmt, alertas_mes)

    except Exception as e:
        print(f"[Worker] Erro ao processar fluxo de alertas: {e}")

def gerar_e_salvar_intervalo(data_inicio, data_fim):
    """
    Gera e salva dados de vendas para cada dia dentro do intervalo especificado [data_inicio, data_fim].
    """
    print(f"[Worker] Iniciando população de histórico de {data_inicio} até {data_fim}...")
    curr = data_inicio
    total_gerado = 0
    dias_processados = 0
    
    while curr <= data_fim:
        df_dia = gerar_dados_para_data(curr)
        if not df_dia.empty:
            salvar_dados_postgres(df_dia)
            total_gerado += len(df_dia)
            dias_processados += 1
        curr += datetime.timedelta(days=1)
        
    print(f"[Worker] População histórica concluída com sucesso: {dias_processados} dias e {total_gerado} vendas geradas!")
    return True

def callback(ch, method, properties, body):
    """
    Função de processamento chamada sempre que uma nova mensagem chega na fila.
    """
    print(f"[Worker] Mensagem recebida: {body.decode()}")
    try:
        data = json.loads(body.decode())
        action = data.get("action")
        
        if action == "simulate_next_day":
            df_simulado = gerar_dados_proximo_dia()
            sucesso = salvar_dados_postgres(df_simulado)
            if sucesso:
                print(f"[Worker] Tarefa de simulação executada com sucesso!")
                try:
                    if not df_simulado.empty:
                        dia_gerado = df_simulado["data"].iloc[0]
                        if hasattr(dia_gerado, "date"):
                            dia_gerado = dia_gerado.date()
                        elif isinstance(dia_gerado, str):
                            dia_gerado = datetime.datetime.strptime(dia_gerado[:10], "%Y-%m-%d").date()
                        disparar_alertas_webhook(dia_gerado)
                except Exception as ex:
                    print(f"[Worker] Erro ao disparar alertas pós-simulação: {ex}")
            else:
                print(f"[Worker] Falha ao processar simulação.")

        elif action == "populate_history":
            dt_inicio_str = data.get("start_date", "2025-08-01")
            dt_fim_str = data.get("end_date", "2026-08-19")
            dt_inicio = datetime.datetime.strptime(dt_inicio_str, "%Y-%m-%d").date()
            dt_fim = datetime.datetime.strptime(dt_fim_str, "%Y-%m-%d").date()
            gerar_e_salvar_intervalo(dt_inicio, dt_fim)

        else:
            print(f"[Worker] Ação '{action}' não reconhecida.")
            
    except Exception as e:
        print(f"[Worker] Erro no callback de processamento: {e}")
    
    # Confirmar recebimento e remoção da mensagem da fila
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    """
    Inicializa o consumidor RabbitMQ. Roda indefinidamente aguardando novas tarefas.
    """
    rabbitmq_url = RABBITMQ_URL
    print(f"[Worker] Iniciando conexão com o RabbitMQ em {rabbitmq_url}...")
    
    while True:
        try:
            params = pika.URLParameters(rabbitmq_url)
            # Reconexão resiliente em caso de instabilidades na rede da VPS
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            
            # Garantir que a fila existe
            channel.queue_declare(queue="sales_tasks", durable=True)
            
            # Configurar para entregar apenas 1 mensagem por vez a este worker (QoS)
            channel.basic_qos(prefetch_count=1)
            
            # Definir o callback de consumo
            channel.basic_consume(queue="sales_tasks", on_message_callback=callback)
            
            print("[Worker] Aguardando mensagens. Para sair pressione CTRL+C")
            channel.start_consuming()
            
        except pika.exceptions.AMQPConnectionError:
            print("[Worker] Conexão com o RabbitMQ perdida. Tentando reconectar em 5 segundos...")
            time.sleep(5)
        except KeyboardInterrupt:
            print("[Worker] Encerrando...")
            break
        except Exception as e:
            print(f"[Worker] Erro inesperado: {e}. Reiniciando em 5 segundos...")
            time.sleep(5)

if __name__ == "__main__":
    main()
