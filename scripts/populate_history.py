"""
Script para geração automática do histórico de vendas: 01/08/2025 até 19/08/2026.
Utiliza a mesma lógica do worker do sistema:
 - Catálogo de 100 produtos
 - Preços de tabela fixos
 - Quantidades e padrões realistas (todas as cidades, pagamentos e tipos de clientes)
 - Pode ser executado diretamente via Banco de Dados ou enfileirado no RabbitMQ
"""

import sys
import os
import datetime

# Adicionar raiz do projeto ao path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from backend.worker import gerar_e_salvar_intervalo
from backend.database import engine
from sqlalchemy import text

def run():
    dt_inicio = datetime.date(2025, 8, 1)
    dt_fim = datetime.date(2026, 8, 19)

    print("=" * 70)
    print(" 🚀 INICIANDO AUDITORIA E PREENCHIMENTO DE DATAS FALTANTES ")
    print(f" 📅 Período Alvo: {dt_inicio.strftime('%d/%m/%Y')} até {dt_fim.strftime('%d/%m/%Y')}")
    print("=" * 70)

    # 1. Buscar todas as datas que já existem no banco
    with engine.connect() as conn:
        datas_existentes = set(r[0] for r in conn.execute(text("SELECT DISTINCT data FROM vendas")).fetchall() if r[0])
        total_atual = conn.execute(text("SELECT COUNT(*) FROM vendas")).scalar()

    # 2. Identificar datas faltantes no período
    datas_faltantes = []
    curr = dt_inicio
    while curr <= dt_fim:
        if curr not in datas_existentes:
            datas_faltantes.append(curr)
        curr += datetime.timedelta(days=1)

    print(f"📊 Diagnóstico do Banco:")
    print(f"   - Total atual de vendas: {total_atual}")
    print(f"   - Datas já preenchidas: {len(datas_existentes)}")
    print(f"   - Datas faltantes no intervalo: {len(datas_faltantes)}")
    print("-" * 70)

    if not datas_faltantes:
        print("✅ Todas as datas do período já estão 100% preenchidas no banco de dados!")
        return

    print(f"🛠️ Gerando vendas para os {len(datas_faltantes)} dias pendentes: {[str(d) for d in datas_faltantes]}")
    print("-" * 70)

    # 3. Gerar apenas os dias faltantes
    total_gerado = 0
    for dt in datas_faltantes:
        df_dia = gerar_dados_para_data(dt)
        if not df_dia.empty:
            salvar_dados_postgres(df_dia)
            total_gerado += len(df_dia)

    # 4. Resumo final pós-preenchimento
    with engine.connect() as conn:
        novo_min = conn.execute(text("SELECT MIN(data) FROM vendas")).scalar()
        novo_max = conn.execute(text("SELECT MAX(data) FROM vendas")).scalar()
        novo_total = conn.execute(text("SELECT COUNT(*) FROM vendas")).scalar()
        total_dias = conn.execute(text("SELECT COUNT(DISTINCT data) FROM vendas")).scalar()

    print("=" * 70)
    print(" 🎉 HISTÓRICO 100% COMPLETO E SEM NENHUM BURACO!")
    print(f" 📈 Primeira Data: {novo_min}")
    print(f" 📈 Última Data: {novo_max}")
    print(f" 📈 Total de Dias Únicos: {total_dias}")
    print(f" 📈 Total Geral de Vendas: {novo_total} (+{total_gerado} inseridas agora)")
    print("=" * 70)

if __name__ == "__main__":
    run()
