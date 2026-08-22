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
    from report_utils import fetch_data_from_db, relatorio_por_dia_com_variacoes, calcular_alertas_dia
except ImportError:
    from .report_utils import fetch_data_from_db, relatorio_por_dia_com_variacoes, calcular_alertas_dia


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

def gerar_dados_proximo_dia():
    """
    Gera novas vendas aleatórias para o próximo dia subsequente à última data do DB.
    Mesma lógica do gerador original proposta-sheets.
    """
    ultima_data = obter_ultima_data_db()
    proximo_dia = ultima_data + datetime.timedelta(days=1)
    
    qtd_transacoes = random.randint(100, 300)
    novas_linhas = []
    
    cidades = ['Rio de Janeiro', 'São Paulo', 'Manaus']
    tipos_cliente = ['Normal', 'Membro']
    generos = ['Homem', 'Mulher']
    linhas_produto = ['Saude e Beleza', 'Acessorios Eletronicos', 'Casa e Estilo de Vida', 'Esportes e Viagens', 'Moda']
    pagamentos = ['Pix', 'Cartao de Credito', 'Debito']
    
    print(f"[Worker] Gerando {qtd_transacoes} transações para a data {proximo_dia}...")

    for _ in range(qtd_transacoes):
        invoice_id = f"{random.randint(100, 999)}-{random.randint(10, 99)}-{random.randint(1000, 9999)}"
        city = random.choice(cidades)
        customer_type = random.choice(tipos_cliente)
        gender = random.choice(generos)
        product_line = random.choice(linhas_produto)
        
        unit_price = round(random.uniform(10.00, 130.00), 2)
        quantity = random.randint(1, 15)
        total = round(unit_price * quantity, 2)
        
        hora = random.randint(7, 23)
        minuto = random.randint(0, 59)
        time_str = f"{hora:02d}:{minuto:02d}"
        
        payment = random.choice(pagamentos)
        rating = round(random.uniform(3.0, 10.0), 1)
        
        # Mapeando os nomes das colunas diretamente para snake_case do banco de dados
        linha = {
            "invoice_id": invoice_id,
            "city": city,
            "customer_type": customer_type,
            "gender": gender,
            "product_line": product_line,
            "unit_price": unit_price,
            "quantity": int(quantity),
            "total": total,
            "time": time_str,
            "payment": payment,
            "rating": rating,
            "data": proximo_dia
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
    Carrega dados do banco, gera alertas para dia_date e dispara para o Webhook do n8n.
    """
    if not N8N_WEBHOOK_URL:
        print("[Worker] N8N_WEBHOOK_URL não configurado. Pulando disparo de alertas.")
        return

    try:
        print(f"[Worker] Calculando alertas para o dia {dia_date}...")
        df = fetch_data_from_db()
        if df.empty:
            print("[Worker] Nenhum dado retornado do banco para cálculo de alertas.")
            return

        relatorio = relatorio_por_dia_com_variacoes(dia_date, df)
        if not relatorio:
            print(f"[Worker] Relatório vazio para o dia {dia_date}.")
            return

        alertas = calcular_alertas_dia(relatorio)
        total_alertas = alertas.get("total_alertas", 0)

        # Formatação amigável para o WhatsApp
        dia_formatado = dia_date.strftime("%d/%m/%Y") if hasattr(dia_date, "strftime") else str(dia_date)
        mensagem = f"📊 *Relatório de Alertas - Dia {dia_formatado}* 📊\n\n"

        positivos = alertas.get("alertas_positivos", [])
        negativos = alertas.get("alertas_negativos", [])

        if positivos:
            mensagem += "🟢 *Alertas Positivos:*\n"
            for p in positivos:
                mensagem += f"- {p}\n"
            mensagem += "\n"

        if negativos:
            mensagem += "🔴 *Alertas Negativos:*\n"
            for n in negativos:
                mensagem += f"- {n}\n"
            mensagem += "\n"

        if not positivos and not negativos:
            mensagem += "Nenhum alerta relevante foi gerado para esta data."

        # Montar o payload
        payload = {
            "date": str(dia_date),
            "total_alertas": total_alertas,
            "alertas": alertas,
            "message": mensagem
        }

        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            N8N_WEBHOOK_URL,
            data=data_bytes,
            headers={"Content-Type": "application/json"}
        )

        print(f"[Worker] Enviando {total_alertas} alerta(s) para o n8n: {N8N_WEBHOOK_URL}")
        with urllib.request.urlopen(req, timeout=10) as response:
            res_body = response.read().decode("utf-8")
            print(f"[Worker] Webhook n8n respondido com sucesso (Status {response.status}): {res_body}")

    except urllib.error.URLError as ue:
        print(f"[Worker] Falha ao conectar ao Webhook do n8n: {ue}")
    except Exception as e:
        print(f"[Worker] Erro ao processar ou disparar alertas: {e}")

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
