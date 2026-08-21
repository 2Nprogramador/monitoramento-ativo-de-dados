import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Carregar variáveis de ambiente do arquivo .env se existir
load_dotenv()

# Obter a URL de conexão do banco de dados (padrão local caso não definida)
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql://postgres:sua_senha_segura@localhost:5432/vendas"
)

# Configurações de conexão estáveis e seguras:
# - pool_size: Mantém um pool de 10 conexões abertas
# - max_overflow: Permite abrir até mais 20 conexões temporárias se houver sobrecarga
# - pool_pre_ping=True: Executa um comando "SELECT 1" antes de usar a conexão, reconectando se tiver caído
# - pool_recycle=3600: Descarta conexões que ficaram inativas por mais de 1 hora (previne queda por firewall da VPS)
engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600
)

# Fábrica de sessões do banco de dados
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Classe base para os modelos declarativos (caso necessário no futuro)
Base = declarative_base()

def get_db():
    """
    Dependency helper para injetar sessões do banco de dados nas rotas do FastAPI.
    Garante o encerramento correto da conexão após o uso.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
