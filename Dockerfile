FROM python:3.11-slim

WORKDIR /app

# Instalar dependências para o PostgreSQL e compilação
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependências do Python
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar todo o código do projeto
COPY . .

EXPOSE 8000

# Comando padrão (para a API web)
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
