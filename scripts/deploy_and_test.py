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

# 1.5. Forçar redeploy dos serviços via Webhooks para garantir pull da nova imagem
def force_redeploy_services():
    print("\n=== Forçando Re-deploy dos Serviços via Webhooks (Pull da imagem) ===")
    services = {
        "web": "7fmf7uzeuju6cq8bka1donze8",
        "worker": "j2sj3evj7z7dmbu9u3pcjouu7"
    }
    
    # Listar webhooks existentes
    webhooks_url = f"{PORTAINER_URL}/webhooks"
    req_list = urllib.request.Request(webhooks_url)
    req_list.add_header("X-API-Key", PORTAINER_API_KEY)
    
    existing_webhooks = []
    try:
        with urllib.request.urlopen(req_list, context=ctx) as r:
            existing_webhooks = json.loads(r.read().decode('utf-8'))
    except Exception as e:
        print("Aviso: Falha ao obter webhooks existentes:", e)
        
    for name, service_id in services.items():
        webhook_token = None
        # Procurar existente
        for w in existing_webhooks:
            resource_id_val = w.get("ResourceId") or w.get("ResourceID")
            if resource_id_val == service_id:
                webhook_token = w.get("Token")
                break
                
        # Se não existe, criar
        if not webhook_token:
            print(f"Criando novo webhook para {name}...")
            payload = {
                "ResourceID": service_id,
                "EndpointID": int(ENDPOINT_ID),
                "WebhookType": 1
            }
            data = json.dumps(payload).encode('utf-8')
            req_create = urllib.request.Request(webhooks_url, data=data, method="POST")
            req_create.add_header("X-API-Key", PORTAINER_API_KEY)
            req_create.add_header("Content-Type", "application/json")
            try:
                with urllib.request.urlopen(req_create, context=ctx) as r:
                    res = json.loads(r.read().decode('utf-8'))
                    webhook_token = res.get("Token")
            except Exception as e:
                print(f"Erro ao criar webhook para {name}:", e)
                
        # Disparar webhook
        if webhook_token:
            trigger_url = f"{PORTAINER_URL}/webhooks/{webhook_token}"
            req_trigger = urllib.request.Request(trigger_url, method="POST")
            try:
                with urllib.request.urlopen(req_trigger, context=ctx) as r:
                    print(f"Re-deploy disparado com sucesso para {name}!")
            except Exception as e:
                print(f"Erro ao disparar webhook para {name}:", e)
        else:
            print(f"Falha ao obter token de webhook para {name}")

# 2. Testar o status de saúde da aplicação pós-deploy
def monitor_health():
    print("\n=== Iniciando teste de saúde (Health Check) pós-deploy ===")
    print("Aguardando 20 segundos para início do rollout do Docker Swarm...")
    time.sleep(20)
    
    success_count = 0
    attempts = 15
    delay = 6
    
    for i in range(attempts):
        try:
            req = urllib.request.Request(HEALTHCHECK_URL, headers={'User-Agent': 'HealthCheck-DeployBot/1.0'})
            # Timeout curto para detectar travamento
            with urllib.request.urlopen(req, context=ctx, timeout=8) as response:
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
        
        # Se já atingiu 3 sucessos consecutivos, finaliza com sucesso imediatamente
        if success_count >= 3:
            print("\n=== TESTE DE SAÚDE APROVADO! Aplicação está online e estável. ===")
            sys.exit(0)
            
        time.sleep(delay)
        
    print("\n=== FALHA NO TESTE DE SAÚDE! A aplicação não se estabilizou. ===")
    sys.exit(1)

if __name__ == "__main__":
    update_portainer_stack()
    force_redeploy_services()
    monitor_health()
