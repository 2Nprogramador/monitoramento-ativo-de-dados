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
    print(" 🚀 INICIANDO GERAÇÃO DE HISTÓRICO DE VENDAS AUTOMÁTICO ")
    print(f" 📅 Período Alvo: {dt_inicio.strftime('%d/%m/%Y')} até {dt_fim.strftime('%d/%m/%Y')}")
    print("=" * 70)

    # Verificar estado atual do banco
    with engine.connect() as conn:
        min_dt = conn.execute(text("SELECT MIN(data) FROM vendas")).scalar()
        max_dt = conn.execute(text("SELECT MAX(data) FROM vendas")).scalar()
        total_vendas = conn.execute(text("SELECT COUNT(*) FROM vendas")).scalar()
        print(f"📊 Estado Atual do Banco:")
        print(f"   - Primeira data: {min_dt}")
        print(f"   - Última data: {max_dt}")
        print(f"   - Total de vendas: {total_vendas}")
        print("-" * 70)

    # Executar a geração dia a dia usando as funções nativas do worker
    gerar_e_salvar_intervalo(dt_inicio, dt_fim)

    # Resumo final
    with engine.connect() as conn:
        novo_min_dt = conn.execute(text("SELECT MIN(data) FROM vendas")).scalar()
        novo_max_dt = conn.execute(text("SELECT MAX(data) FROM vendas")).scalar()
        novo_total = conn.execute(text("SELECT COUNT(*) FROM vendas")).scalar()
        print("=" * 70)
        print(" 🎉 GERAÇÃO CONCLUÍDA COM SUCESSO!")
        print(f" 📈 Nova Primeira Data: {novo_min_dt}")
        print(f" 📈 Nova Última Data: {novo_max_dt}")
        print(f" 📈 Total Geral de Vendas: {novo_total}")
        print("=" * 70)

if __name__ == "__main__":
    run()
