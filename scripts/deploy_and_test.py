import urllib.request
import json
import ssl
import time
import os
import sys

# Desabilitar verificação SSL para requisições se necessário
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Ler variáveis de ambiente com defaults
PORTAINER_API_KEY = os.environ.get("PORTAINER_API_KEY")
PORTAINER_URL = os.environ.get("PORTAINER_URL", "https://portainer.2nprogramacao.com.br/api")
STACK_ID = os.environ.get("PORTAINER_STACK_ID", "11")
ENDPOINT_ID = os.environ.get("PORTAINER_ENDPOINT_ID", "1")
HEALTHCHECK_URL = os.environ.get("HEALTHCHECK_URL", "https://projetodados.2nprogramacao.com.br/api/health")

if not PORTAINER_API_KEY:
    print("ERRO: PORTAINER_API_KEY não foi configurada nas variáveis de ambiente.")
    sys.exit(1)

# 1. Atualizar Stack no Portainer
def update_portainer_stack():
    url = f"{PORTAINER_URL}/stacks/{STACK_ID}?endpointId={ENDPOINT_ID}"
    
    # Ler o docker-compose.yml local
    compose_path = "docker-compose.yml"
    if not os.path.exists(compose_path):
        print(f"ERRO: {compose_path} não encontrado no diretório atual.")
        sys.exit(1)
        
    with open(compose_path, "r", encoding="utf-8") as f:
        compose_content = f.read()
        
    payload = {
        "stackFileContent": compose_content,
        "env": [],
        "prune": True
    }
    
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("X-API-Key", PORTAINER_API_KEY)
    req.add_header("Content-Type", "application/json")
    
    print("=== Enviando requisição de deploy para o Portainer ===")
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("Deploy disparado com sucesso no Portainer!")
            print(f"Stack ID: {result.get('Id')}, Swarm ID: {result.get('SwarmId')}")
    except Exception as e:
        print("ERRO: Falha ao atualizar a stack no Portainer:")
        if hasattr(e, 'read'):
            print(e.read().decode('utf-8'))
        else:
            print(e)
        sys.exit(1)

# 2. Testar o status de saúde da aplicação pós-deploy
def monitor_health():
    print("\n=== Iniciando teste de saúde (Health Check) pós-deploy ===")
    print("Aguardando 15 segundos para início do rollout do Docker Swarm...")
    time.sleep(15)
    
    success_count = 0
    attempts = 8
    delay = 5
    
    for i in range(attempts):
        try:
            req = urllib.request.Request(HEALTHCHECK_URL)
            # Timeout curto para detectar travamento
            with urllib.request.urlopen(req, context=ctx, timeout=5) as response:
                data = json.loads(response.read().decode('utf-8'))
                status = data.get("status")
                timestamp = data.get("timestamp")
                print(f"[{i+1}/{attempts}] Status: {status}, Horário: {timestamp}")
                if status == "healthy":
                    success_count += 1
                else:
                    success_count = 0  # Reseta se falhar para exigir estabilidade
        except Exception as e:
            print(f"[{i+1}/{attempts}] ERRO na resposta da API: {e}")
            success_count = 0
        
        time.sleep(delay)
        
    # Exige que as últimas 3 requisições consecutivas tenham sido saudáveis
    if success_count >= 3:
        print("\n=== TESTE DE SAÚDE APROVADO! Aplicação está online e estável. ===")
        sys.exit(0)
    else:
        print("\n=== FALHA NO TESTE DE SAÚDE! A aplicação não se estabilizou. ===")
        sys.exit(1)

if __name__ == "__main__":
    update_portainer_stack()
    monitor_health()
