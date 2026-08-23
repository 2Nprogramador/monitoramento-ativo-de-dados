import os
from dotenv import load_dotenv

# Carregar variáveis de ambiente locais do .env
load_dotenv()

def get_secret(env_key, default=None):
    """
    Retorna o valor de uma variável de ambiente.
    Se a chave correspondente com sufixo '_FILE' estiver definida (ex: DB_PASSWORD_FILE)
    e apontar para um arquivo válido, lê o valor de dentro do arquivo (Docker Secrets).
    """
    file_path = os.getenv(f"{env_key}_FILE")
    if file_path and os.path.exists(file_path):
        try:
            with open(file_path, "r") as f:
                return f.read().strip()
        except Exception as e:
            print(f"[Config] Erro ao ler segredo de {file_path}: {e}")
    
    return os.getenv(env_key, default)

# --- 1. CONFIGURAÇÃO DO POSTGRESQL ---
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    db_user = get_secret("DB_USER", "postgres")
    db_pass = get_secret("DB_PASSWORD")
    db_host = get_secret("DB_HOST", "localhost")
    db_port = get_secret("DB_PORT", "5432")
    db_name = get_secret("DB_NAME", "projeto")
    
    if db_pass:
        DATABASE_URL = f"postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"
    else:
        DATABASE_URL = f"postgresql://{db_user}@{db_host}:{db_port}/{db_name}"

# --- 2. CONFIGURAÇÃO DO RABBITMQ ---
RABBITMQ_URL = os.getenv("RABBITMQ_URL")
if not RABBITMQ_URL:
    rmq_user = get_secret("RABBITMQ_USER", "guest")
    rmq_pass = get_secret("RABBITMQ_PASSWORD", "guest")
    rmq_host = get_secret("RABBITMQ_HOST", "localhost")
    rmq_port = get_secret("RABBITMQ_PORT", "5672")
    
    RABBITMQ_URL = f"amqp://{rmq_user}:{rmq_pass}@{rmq_host}:{rmq_port}/"

# --- 3. DADOS DE LOGIN DA APLICAÇÃO ---
APP_USER = get_secret("APP_USER", "admin")
APP_PASSWORD = get_secret("APP_PASSWORD", "m2n_seguro_app_pass")

# --- 4. CONFIGURAÇÃO DO WEBHOOK N8N ---
N8N_WEBHOOK_URL = get_secret("N8N_WEBHOOK_URL", "")

# --- 5. VALIDAÇÃO DE SEGURANÇA (SANITY CHECK EM PRODUÇÃO) ---
DB_HOST_CHECK = get_secret("DB_HOST", "localhost")
if DB_HOST_CHECK != "localhost":
    # 1. Garante que a senha do banco de dados não seja o valor padrão de teste
    db_pass_check = get_secret("DB_PASSWORD")
    if db_pass_check == "sua_senha_segura" or not db_pass_check:
         raise ValueError("[Segurança] ERRO CRÍTICO: Senha do banco de dados está usando o valor padrão ou está ausente!")

    # 2. Garante que as credenciais do admin da aplicação foram alteradas em relação ao padrão
    if APP_PASSWORD == "m2n_seguro_app_pass" or not APP_PASSWORD:
         raise ValueError("[Segurança] ERRO CRÍTICO: Senha padrão do administrador (APP_PASSWORD) não foi alterada!")

