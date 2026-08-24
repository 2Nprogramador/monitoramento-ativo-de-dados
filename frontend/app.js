// Cache global para instâncias dos gráficos (evita erro de Canvas já utilizado)
const chartInstances = {};

// Configuração padrão de fontes e estilo do Chart.js para combinar com o tema escuro
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', sans-serif";

document.addEventListener('DOMContentLoaded', () => {
    inicializarApp();
});

function inicializarApp() {
    carregarDatas();

    // Event Listeners
    document.getElementById('date-select').addEventListener('change', (e) => {
        if (e.target.value) {
            carregarRelatorio(e.target.value);
        }
    });

    document.getElementById('simulate-btn').addEventListener('click', executarSimulacao);
    
    // Injetar tooltips de explicacao de negocio
    inicializarHelpers();
}

// --- FUNÇÕES DE API ---

async function carregarDatas(dataParaSelecionar = null) {
    try {
        const response = await fetch('/api/dates');
        if (!response.ok) throw new Error('Falha ao carregar datas.');
        
        const datas = await response.json();
        const select = document.getElementById('date-select');
        select.innerHTML = '';

        if (datas.length === 0) {
            select.innerHTML = '<option value="">Sem dados registrados</option>';
            showToast('Nenhum dado encontrado. Clique em Simular para gerar.', 'warning');
            return;
        }

        datas.forEach(data => {
            const option = document.createElement('option');
            option.value = data;
            option.textContent = formatarDataBR(data);
            select.appendChild(option);
        });

        // Selecionar a data especificada ou a mais recente por padrão
        const dataAtiva = dataParaSelecionar || datas[0];
        select.value = dataAtiva;
        carregarRelatorio(dataAtiva);

    } catch (error) {
        console.error(error);
        showToast('Erro ao carregar lista de datas do servidor.', 'danger');
    }
}

async function carregarRelatorio(data) {
    try {
        const response = await fetch(`/api/report?date=${data}`);
        if (!response.ok) throw new Error('Erro ao carregar dados do dia.');

        const dataPayload = await response.json();
        
        // Atualizar interface
        atualizarKPIs(dataPayload.metrics);
        atualizarAlertas(dataPayload.alertas);
        renderizarGraficos(dataPayload.metrics);

    } catch (error) {
        console.error(error);
        showToast(`Erro ao carregar dados para o dia ${formatarDataBR(data)}`, 'danger');
    }
}

async function executarSimulacao() {
    const btn = document.getElementById('simulate-btn');
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando para a Fila...';

    try {
        const response = await fetch('/api/simulate', { method: 'POST' });
        const result = await response.json();

        if (response.ok) {
            showToast('Simulação agendada! O processamento está sendo executado via RabbitMQ.', 'success');
            
            // Aguardar 2 segundos para o worker rodar e então recarregar as datas
            setTimeout(async () => {
                // Obter a lista mais recente e selecionar a última data inserida
                await carregarDatas();
                btn.disabled = false;
                btn.innerHTML = originalText;
            }, 2500);
        } else {
            throw new Error(result.detail || 'Erro na fila.');
        }

    } catch (error) {
        console.error(error);
        showToast(`Erro ao iniciar simulação: ${error.message}`, 'danger');
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// --- ATUALIZAÇÕES DA INTERFACE ---

function atualizarKPIs(metrics) {
    // 1. Calcular Faturamento Total e Variação
    const totalRevenue = metrics.cidade.reduce((sum, item) => sum + item.Total, 0);
    const varRevenue = metrics.cidade.reduce((sum, item) => sum + item.Var_Total, 0);
    document.getElementById('kpi-total-revenue').textContent = formatarMoeda(totalRevenue);
    atualizarVariacaoElement('kpi-var-revenue', varRevenue, totalRevenue, true);

    // 2. Calcular Quantidade Total e Variação
    const totalSales = metrics.cidade.reduce((sum, item) => sum + item.Quantity, 0);
    const varSales = metrics.cidade.reduce((sum, item) => sum + item.Var_Quantity, 0);
    document.getElementById('kpi-total-sales').textContent = totalSales.toLocaleString();
    atualizarVariacaoElement('kpi-var-sales', varSales, totalSales, false);

    // 3. Calcular Ticket Médio e Variação
    const avgTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
    const prevSales = totalSales - varSales;
    const prevRevenue = totalRevenue - varRevenue;
    const prevAvgTicket = prevSales > 0 ? prevRevenue / prevSales : 0;
    const varTicket = prevAvgTicket > 0 ? avgTicket - prevAvgTicket : 0;
    
    document.getElementById('kpi-avg-ticket').textContent = formatarMoeda(avgTicket);
    atualizarVariacaoElement('kpi-var-ticket', varTicket, avgTicket, true);

    // 4. Calcular Satisfação (Rating) e Variação
    const ratings = metrics.rating_produto;
    const avgRating = ratings.length > 0 ? ratings.reduce((sum, item) => sum + item.Média_Rating, 0) / ratings.length : 0;
    const varRating = ratings.length > 0 ? ratings.reduce((sum, item) => sum + item.Var_Média_Rating, 0) / ratings.length : 0;
    
    document.getElementById('kpi-avg-rating').textContent = avgRating.toFixed(1) + ' / 10';
    atualizarVariacaoElement('kpi-var-rating', varRating, avgRating, false, true);

    // Variação dos Métodos de Pagamento Digitais
    try {
        const pagamentos = metrics.pagamento || [];
        
        const findPaymentData = (names) => {
            let total = 0;
            let varTotal = 0;
            let found = false;
            pagamentos.forEach(p => {
                if (names.includes(p.Payment)) {
                    total += p.Total || 0;
                    varTotal += p.Var_Total || 0;
                    found = true;
                }
            });
            return found ? { Total: total, Var_Total: varTotal } : null;
        };

        const pixData = findPaymentData(['Pix']);
        const cartaoData = findPaymentData(['Cartao de Credito', 'Credit card']);
        const debitoData = findPaymentData(['Debito', 'Ewallet']);

        if (pixData) {
            atualizarVariacaoElement('kpi-var-pix', pixData.Var_Total, pixData.Total, false);
        } else {
            const el = document.getElementById('kpi-var-pix');
            if (el) el.innerHTML = '<i class="fa-solid fa-minus"></i> N/A';
        }

        if (cartaoData) {
            atualizarVariacaoElement('kpi-var-cartao', cartaoData.Var_Total, cartaoData.Total, false);
        } else {
            const el = document.getElementById('kpi-var-cartao');
            if (el) el.innerHTML = '<i class="fa-solid fa-minus"></i> N/A';
        }

        if (debitoData) {
            atualizarVariacaoElement('kpi-var-debito', debitoData.Var_Total, debitoData.Total, false);
        } else {
            const el = document.getElementById('kpi-var-debito');
            if (el) el.innerHTML = '<i class="fa-solid fa-minus"></i> N/A';
        }
    } catch (e) {
        console.warn('Erro ao atualizar variacao de pagamentos digitais:', e);
    }

    // --- Novas Metricas (integradas aqui para garantir execucao) ---
    try {
        const novas = metrics.novas;
        if (novas) {
            // Clientes Fidelizados
            const fidEl = document.getElementById('kpi-fidelizados');
            if (fidEl && novas.taxa_tipo_cliente) {
                fidEl.textContent = (novas.taxa_tipo_cliente.Membro || 0).toFixed(1) + '%';
            }

            // Hora de Pico
            const horaEl = document.getElementById('kpi-hora-pico');
            const horaSubEl = document.getElementById('kpi-hora-pico-sub');
            if (horaEl) horaEl.textContent = (novas.hora_pico ? novas.hora_pico.hora : '--') + 'h';
            if (horaSubEl) horaSubEl.textContent = formatarMoeda(novas.hora_pico ? novas.hora_pico.total : 0) + ' nesta hora';

            // Produto Destaque
            const prodEl = document.getElementById('kpi-produto-top');
            const prodValorEl = document.getElementById('kpi-produto-top-valor');
            if (prodEl) prodEl.textContent = (novas.produto_top && novas.produto_top.nome) ? novas.produto_top.nome : '--';
            if (prodValorEl) prodValorEl.textContent = formatarMoeda(novas.produto_top ? novas.produto_top.total : 0);

            // Concentracao Geografica Dinamica por Cidade
            const cidadesList = [...(metrics.cidade || [])];
            
            // Ordenar cidades do maior para o menor faturamento
            cidadesList.sort((a, b) => (b.Total || 0) - (a.Total || 0));
            
            const totalGeralHoje = cidadesList.reduce((sum, item) => sum + (item.Total || 0), 0);
            const totalGeralOntem = cidadesList.reduce((sum, item) => sum + ((item.Total || 0) - (item.Var_Total || 0)), 0);
            
            const geoContainer = document.getElementById('geo-cities-container');
            if (geoContainer) {
                geoContainer.innerHTML = '';
                
                cidadesList.forEach(c => {
                    const totalHoje = c.Total || 0;
                    const totalOntem = totalHoje - (c.Var_Total || 0);
                    
                    const pctHoje = totalGeralHoje > 0 ? (totalHoje / totalGeralHoje) * 100 : 0;
                    const pctOntem = totalGeralOntem > 0 ? (totalOntem / totalGeralOntem) * 100 : 0;
                    const variacaoPct = pctHoje - pctOntem;
                    
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.justifyContent = 'space-between';
                    row.style.alignItems = 'center';
                    row.style.gap = '0.5rem';
                    
                    // Container para o nome da cidade e porcentagem (coluna esquerda)
                    const cityInfoDiv = document.createElement('div');
                    cityInfoDiv.style.display = 'flex';
                    cityInfoDiv.style.flexDirection = 'column';
                    cityInfoDiv.style.alignItems = 'flex-start';
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.style.fontSize = '0.8rem';
                    nameSpan.style.fontWeight = '500';
                    nameSpan.style.color = 'var(--text-secondary)';
                    nameSpan.textContent = c.City;
                    
                    const pctSpan = document.createElement('span');
                    pctSpan.style.fontSize = '0.75rem';
                    pctSpan.style.color = 'var(--text-muted)';
                    pctSpan.textContent = `(${pctHoje.toFixed(1)}%)`;
                    
                    cityInfoDiv.appendChild(nameSpan);
                    cityInfoDiv.appendChild(pctSpan);
                    
                    const varSpan = document.createElement('span');
                    varSpan.className = 'kpi-variation';
                    
                    if (variacaoPct > 0) {
                        varSpan.classList.add('variation-up');
                        varSpan.innerHTML = `<i class="fa-solid fa-caret-up"></i> +${variacaoPct.toFixed(1)}%`;
                    } else if (variacaoPct < 0) {
                        varSpan.classList.add('variation-down');
                        varSpan.innerHTML = `<i class="fa-solid fa-caret-down"></i> ${variacaoPct.toFixed(1)}%`;
                    } else {
                        varSpan.classList.add('variation-neutral');
                        varSpan.innerHTML = `<i class="fa-solid fa-minus"></i> 0.0%`;
                    }
                    
                    row.appendChild(cityInfoDiv);
                    row.appendChild(varSpan);
                    geoContainer.appendChild(row);
                });
            }

            // Eficiencia Noturna (KPI 10)
            const noturnoEl = document.getElementById('kpi-noturno');
            if (noturnoEl) {
                // Suporta o formato antigo (numero) e o novo (objeto com atual e variacao)
                const atual = (typeof novas.eficiencia_noturna_pct === 'object' && novas.eficiencia_noturna_pct !== null) 
                    ? novas.eficiencia_noturna_pct.atual 
                    : (novas.eficiencia_noturna_pct || 0);
                noturnoEl.textContent = atual.toFixed(1) + '%';
            }
            const noturnoSubEl = document.getElementById('kpi-noturno-sub');
            if (noturnoSubEl) noturnoSubEl.textContent = 'Do faturamento diario';

            // Itens por Compra (KPI 11)
            const itensCompraEl = document.getElementById('kpi-itens-compra');
            if (itensCompraEl && novas.itens_por_compra) {
                itensCompraEl.textContent = novas.itens_por_compra.atual.toFixed(1);
                atualizarVariacaoElement('kpi-var-itens', novas.itens_por_compra.variacao, novas.itens_por_compra.atual, false);
            }

            // Maior Venda (KPI 12)
            const maiorVendaEl = document.getElementById('kpi-maior-venda');
            if (maiorVendaEl && novas.maior_venda) {
                maiorVendaEl.textContent = formatarMoeda(novas.maior_venda.atual);
                atualizarVariacaoElement('kpi-var-maior-venda', novas.maior_venda.variacao, novas.maior_venda.atual, true);
            }
        }
    } catch(e) {
        console.warn('Erro ao atualizar novas metricas:', e);
    }
}

function atualizarMetricasNovas(novas) {
    // Mantida para compatibilidade - novas metricas    // Inicializar tooltips aps atualizar os KPIs
    setTimeout(inicializarHelpers, 100);
}

function inicializarHelpers() {
    const titulos = document.querySelectorAll('h3, h2');
    
    titulos.forEach(titulo => {
        // Remover span/ícones que possam existir dentro do h3/h2 antes de pegar o texto
        let textoOriginal = '';
        titulo.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                textoOriginal += node.textContent;
            }
        });
        
        textoOriginal = textoOriginal.trim();
        const cleanKey = textoOriginal.replace(/[^a-zA-Z0-9 ]/g, '').toLowerCase();

        let helperHtml = '';
        let found = false;

        // Buscar no mapeamento usando a chave normalizada
        for (const [key, value] of Object.entries(helperMappings)) {
            const mapCleanKey = key.replace(/[^a-zA-Z0-9 ]/g, '').toLowerCase();
            if (cleanKey === mapCleanKey) {
                helperHtml = `
                    <div class="helper-wrapper tooltip-wrapper">
                        <i class="fa-solid fa-circle-question helper-icon"></i>
                        <div class="helper-tooltip">
                            <div class="helper-tooltip-label">O que é</div>
                            <div class="helper-tooltip-text">${value.desc}</div>
                            <div class="helper-tooltip-pain">
                                <div class="helper-tooltip-label">Dor Solucionada</div>
                                <div class="helper-tooltip-text">${value.dor}</div>
                            </div>
                        </div>
                    </div>
                `;
                found = true;
                break;
            }
        }

        if (found && !titulo.querySelector('.helper-wrapper')) {
            titulo.innerHTML = titulo.innerHTML + helperHtml;
        }
    });
}

// --- GLOSSÁRIO DE ALERTAS ---
const alertasGlossario = [
    {
        key: 'ultrapassaram R$30.000',
        title: 'Meta de Vendas por Cidade',
        desc: 'Sinaliza quando uma cidade ultrapassa a marca de R$ 30.000,00 em um único dia.',
        dor: 'Permite bonificar equipes locais ou aumentar o investimento em marketing na região.'
    },
    {
        key: 'queda superior a 30% nas vendas',
        title: 'Queda Brusca de Vendas (Cidade)',
        desc: 'Alerta disparado se o faturamento de uma cidade cair mais de 30% em relação ao dia anterior.',
        dor: 'Possibilita ação rápida para investigar problemas operacionais na filial ou instabilidades regionais.'
    },
    {
        key: 'apresentou um aumento superior a 30%',
        title: 'Aumento de Pagamentos via Pix',
        desc: 'Notifica se o uso do Pix subiu mais de 30% frente ao dia anterior.',
        dor: 'Indica sucesso em campanhas de incentivo a meios de menor custo, melhorando a margem líquida.'
    },
    {
        key: 'mais de 400 vendas',
        title: 'Alta Demanda de Produto',
        desc: 'Alerta para categorias que ultrapassaram a marca crítica de 400 unidades vendidas no dia.',
        dor: 'Previne ruptura de estoque (desabastecimento), permitindo reposição ágil de mercadorias.'
    },
    {
        key: 'Não-Membros',
        title: 'Baixa Aquisição de Novos Clientes',
        desc: 'Avisa quando clientes normais (não membros) representam menos de 20% das vendas totais.',
        dor: 'Sinaliza que o negócio parou de atrair público novo, dependendo exclusivamente da base recorrente.'
    },
    {
        key: 'rating abaixo de 5.0',
        title: 'Alerta Crítico de Satisfação',
        desc: 'Dispara quando mais de 5% das vendas recebem avaliação abaixo de 5 (escala de 1 a 10).',
        dor: 'Permite identificar dias de mau atendimento, falhas operacionais ou produtos com defeito.'
    },
    {
        key: 'risco de depend',
        title: 'Risco de Concentração Geográfica',
        desc: 'Alerta quando uma única cidade representa mais de 60% de todo o faturamento da empresa.',
        dor: 'Sinaliza vulnerabilidade: imprevistos ou feriados nessa praça comprometem a receita global.'
    },
    {
        key: '(UPV) caiu',
        title: 'Queda de Preço Médio (UPV)',
        desc: 'Avisa quando o cliente passa a comprar produtos de menor valor unitário em relação à média.',
        dor: 'Evidencia retração no poder de compra ou ineficácia nas campanhas de up-selling dos vendedores.'
    },
    {
        key: 'Pagamentos digitais representam',
        title: 'Queda de Pagamentos Digitais',
        desc: 'Alerta quando menos de 70% das transações são efetuadas por canais digitais (Pix/Cartões).',
        dor: 'Maior circulação de dinheiro em espécie eleva o risco de segurança e os custos de transporte de valores.'
    },
    {
        key: 'nenhuma venda no dia',
        title: 'Linha de Produto Zerada',
        desc: 'Sinaliza categorias que não registraram nenhuma transação durante todo o expediente.',
        dor: 'Giro de estoque zero representa capital parado, demandando promoções ou reposicionamento de vitrine.'
    },
    {
        key: 'Produto destaque do dia',
        title: 'Campeão de Vendas',
        desc: 'Destaca o produto ou linha que gerou a maior receita bruta no dia selecionado.',
        dor: 'Informa a liderança com precisão sobre qual produto é o principal motor de faturamento no momento.'
    }
];

function toggleGlossary() {
    const modal = document.getElementById('glossary-modal');
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        renderGlossary();
        modal.classList.add('show');
    }
}

function renderGlossary() {
    const body = document.getElementById('glossary-body');
    body.innerHTML = alertasGlossario.map(alerta => `
        <div class="glossary-item">
            <div class="glossary-item-title">
                <i class="fa-solid fa-bell"></i> ${alerta.title}
            </div>
            <div class="glossary-item-desc">${alerta.desc}</div>
            <div class="glossary-item-pain">
                <strong>Dor Solucionada:</strong> ${alerta.dor}
            </div>
        </div>
    `).join('');
}

function atualizarVariacaoElement(elementId, valorVar, valorAtual, isMoeda, isRating = false) {
    const el = document.getElementById(elementId);
    
    // Se o valor de variação for zero ou nulo (ex: primeiro dia de dados)
    if (valorVar === null || valorVar === undefined || isNaN(valorVar) || (valorAtual - valorVar) <= 0) {
        el.className = 'kpi-variation variation-neutral';
        el.innerHTML = '<i class="fa-solid fa-minus"></i> N/A';
        return;
    }

    const valorAnterior = valorAtual - valorVar;
    const percentual = (valorVar / valorAnterior) * 100;
    
    let text = '';
    let sign = '';
    
    if (valorVar > 0) {
        el.className = 'kpi-variation variation-up';
        sign = '+';
        text = `<i class="fa-solid fa-caret-up"></i> ${sign}${percentual.toFixed(1)}%`;
    } else if (valorVar < 0) {
        el.className = 'kpi-variation variation-down';
        text = `<i class="fa-solid fa-caret-down"></i> ${percentual.toFixed(1)}%`; // Sinal de menos já vem no float
    } else {
        el.className = 'kpi-variation variation-neutral';
        text = '<i class="fa-solid fa-minus"></i> 0.0%';
    }
    
    el.innerHTML = text;
}

function gerarHelperHtmlParaAlerta(alertaTexto) {
    const alertaDef = alertasGlossario.find(a => alertaTexto.includes(a.key));
    if (!alertaDef) return '';
    return `
        <div class="helper-wrapper alert-helper tip-left">
            <i class="helper-icon">?</i>
            <div class="helper-tooltip">
                <div class="helper-tooltip-label">Por que avisamos?</div>
                <div class="helper-tooltip-text">${alertaDef.desc}</div>
                <div class="helper-tooltip-pain">
                    <div class="helper-tooltip-label">Dor Solucionada</div>
                    <div class="helper-tooltip-text">${alertaDef.dor}</div>
                </div>
            </div>
        </div>
    `;
}

function atualizarAlertas(alertas) {
    const container = document.getElementById('alerts-container');
    const badge = document.getElementById('alerts-count-badge');
    container.innerHTML = '';
    
    const { alertas_positivos, alertas_negativos, total_alertas } = alertas;
    badge.textContent = `${total_alertas} alertas`;
    
    if (total_alertas === 0) {
        container.innerHTML = `
            <div class="no-alerts">
                <i class="fa-regular fa-circle-check"></i>
                Nenhum alerta crítico para a data selecionada.
            </div>
        `;
        badge.className = 'badge';
        return;
    }

    badge.className = 'badge badge-active';

    // Adicionar Alertas Negativos (Erros/Quedas) Primeiro
    alertas_negativos.forEach(alerta => {
        const item = document.createElement('div');
        item.className = 'alert-item negative';
        item.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${formatarMarkdownNegrito(alerta)}</span> ${gerarHelperHtmlParaAlerta(alerta)}`;
        container.appendChild(item);
    });

    // Adicionar Alertas Positivos (Altas/Sucessos)
    alertas_positivos.forEach(alerta => {
        const item = document.createElement('div');
        item.className = 'alert-item positive';
        item.innerHTML = `<i class="fa-solid fa-circle-arrow-up"></i> <span>${formatarMarkdownNegrito(alerta)}</span> ${gerarHelperHtmlParaAlerta(alerta)}`;
        container.appendChild(item);
    });
}

// --- RENDERIZAÇÃO DOS GRÁFICOS (CHART.JS) ---

function renderizarGraficos(metrics) {
    // 1. Gráfico de Vendas por Cidade (Barra Dupla)
    const cidades = metrics.cidade.map(item => item.City);
    const faturamentoCidades = metrics.cidade.map(item => item.Total);
    const variacaoCidades = metrics.cidade.map(item => item.Var_Total);

    criarGrafico('chart-city', {
        type: 'bar',
        data: {
            labels: cidades,
            datasets: [
                {
                    label: 'Faturamento Total (R$)',
                    data: faturamentoCidades,
                    backgroundColor: '#6366f1',
                    borderRadius: 6,
                },
                {
                    label: 'Variação do Dia (R$)',
                    data: variacaoCidades,
                    backgroundColor: '#ec4899',
                    borderRadius: 6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    // 2. Gráfico Temporal por Hora (Linha)
    // Garantir que as horas estão ordenadas
    const dadosHora = metrics.vendas_por_hora.sort((a, b) => a.Hora - b.Hora);
    const horas = dadosHora.map(item => `${item.Hora}h`);
    const faturamentoHora = dadosHora.map(item => item.Total);

    criarGrafico('chart-hourly', {
        type: 'line',
        data: {
            labels: horas,
            datasets: [{
                label: 'Vendas por Hora (R$)',
                data: faturamentoHora,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.05)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#10b981'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    // 3. Categorias de Produtos (Barra Horizontal)
    const categorias = metrics.linha_produto.map(item => item['Product line']);
    const quantCategorias = metrics.linha_produto.map(item => item.Quantity);
    const faturamentoCategorias = metrics.linha_produto.map(item => item.Total);

    criarGrafico('chart-product-line', {
        type: 'bar',
        data: {
            labels: categorias,
            datasets: [
                {
                    label: 'Quantidade Vendida',
                    data: quantCategorias,
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: 'rgba(255, 255, 255, 0.05)' } },
                y: { grid: { display: false } }
            }
        }
    });

    // 4. Métodos de Pagamento (Doughnut)
    const pagamentos = metrics.pagamento.map(item => item.Payment);
    const faturamentoPagamento = metrics.pagamento.map(item => item.Total);

    criarGrafico('chart-payment', {
        type: 'doughnut',
        data: {
            labels: pagamentos,
            datasets: [{
                data: faturamentoPagamento,
                backgroundColor: ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#3b82f6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, padding: 15 }
                }
            }
        }
    });

    // 5. Perfil de Clientes (Pizza Gênero)
    const totalMulheres = metrics.genero.find(item => item.Gender === 'Mulher')?.Total || 0;
    const totalHomens = metrics.genero.find(item => item.Gender === 'Homem')?.Total || 0;

    criarGrafico('chart-customer', {
        type: 'pie',
        data: {
            labels: ['Mulher', 'Homem'],
            datasets: [{
                data: [totalMulheres, totalHomens],
                backgroundColor: ['#ec4899', '#3b82f6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, padding: 15 }
                }
            }
        }
    });

    // 6. Faturamento por Gênero (Barra Horizontal)
    if (metrics.novas) {
        const generoLabels = Object.keys(metrics.novas.volume_por_genero || {});
        const generoVals = Object.values(metrics.novas.volume_por_genero || {});
        criarGrafico('chart-gender-revenue', {
            type: 'bar',
            data: {
                labels: generoLabels,
                datasets: [{
                    label: 'Faturamento (R$)',
                    data: generoVals,
                    backgroundColor: ['#ec4899', '#3b82f6', '#10b981'],
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { grid: { display: false } }
                }
            }
        });

        // 7. UPV por Linha de Produto
        const upvLabels = metrics.linha_produto.map(item => item['Product line']);
        const upvVals = metrics.linha_produto.map(item => {
            const qty = item.Quantity || 0;
            const total = item.Total || 0;
            return qty > 0 ? parseFloat((total / qty).toFixed(2)) : 0;
        });
        criarGrafico('chart-upv', {
            type: 'bar',
            data: {
                labels: upvLabels,
                datasets: [{
                    label: 'Preço Médio / Unidade (R$)',
                    data: upvVals,
                    backgroundColor: '#f59e0b',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' } },
                    x: { grid: { display: false } }
                }
            }
        });

        // 8. Diurno vs Noturno (Doughnut)
        const eficNot = metrics.novas.eficiencia_noturna_pct;
        const pctNoturno = (typeof eficNot === 'object' && eficNot !== null) ? eficNot.atual : (eficNot || 0);
        const pctDiurno = parseFloat((100 - pctNoturno).toFixed(1));
        criarGrafico('chart-nocturnal', {
            type: 'doughnut',
            data: {
                labels: ['Diurno (até 17h)', 'Noturno (18h+)'],
                datasets: [{
                    data: [pctDiurno, pctNoturno],
                    backgroundColor: ['#f59e0b', '#6366f1'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15 } }
                }
            }
        });
    }
}

function criarGrafico(canvasId, config) {
    // Destruir instância antiga se já existir
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }
    const ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, config);
}

// --- UTILS ---

function formatarDataBR(dataStr) {
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarMarkdownNegrito(texto) {
    // Converte **texto** do markdown em <strong>texto</strong> no HTML
    return texto.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    const icon = toast.querySelector('.toast-icon');

    toastMsg.textContent = message;
    
    // Reset classes
    toast.className = 'toast';
    icon.className = 'fa-solid toast-icon';

    if (type === 'success') {
        toast.classList.add('show');
        toast.style.borderColor = 'var(--color-success)';
        icon.classList.add('fa-circle-check');
        icon.style.color = 'var(--color-success)';
    } else if (type === 'danger') {
        toast.classList.add('show');
        toast.style.borderColor = 'var(--color-danger)';
        icon.classList.add('fa-circle-xmark');
        icon.style.color = 'var(--color-danger)';
    } else {
        toast.classList.add('show');
        toast.style.borderColor = 'var(--color-accent)';
        icon.classList.add('fa-circle-info');
        icon.style.color = 'var(--color-accent)';
    }

    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// --- HELPERS DE NEGÓCIO ---
const helperMappings = {
    'faturamentototal': {
        desc: 'Soma total de todas as vendas brutas realizadas na data selecionada.',
        dor: 'Falta de visibilidade imediata sobre a receita financeira diária do negócio.'
    },
    'quantidadevendida': {
        desc: 'Número total de unidades de produtos vendidas no dia selecionado.',
        dor: 'Desconhecimento do volume real de saída de estoque diário.'
    },
    'ticketmdio': {
        desc: 'Faturamento total dividido pelo número de transações efetuadas no dia.',
        dor: 'Dificuldade em compreender quanto cada cliente gasta, em média, por compra.'
    },
    'satisfaogeralrating': {
        desc: 'Média das notas de avaliação (escala de 1,0 a 10,0) atribuídas pelos clientes às compras do dia.',
        dor: 'Ausência de termômetro sobre a percepção de qualidade do atendimento e dos produtos.'
    },
    'clientesfidelizados': {
        desc: 'Percentual do faturamento originado por clientes cadastrados no programa de fidelidade (Membros).',
        dor: 'Dificuldade em mensurar a eficácia de retenção e a adesão da base de clientes recorrentes.'
    },
    'horadepico': {
        desc: 'Faixa horária do dia (0h às 23h) com o maior volume financeiro faturado.',
        dor: 'Incapacidade de dimensionar e alocar a equipe de vendas de forma eficiente nos momentos de maior movimento.'
    },
    'produtodestaque': {
        desc: 'Linha ou categoria de produtos que registrou a maior receita bruta no dia.',
        dor: 'Dificuldade em identificar rapidamente qual departamento lidera a geração de receita.'
    },
    'pagamentosdigitais': {
        desc: 'Percentual do faturamento transacionado via meios eletrônicos (Pix, Cartão de Crédito e Débito).',
        dor: 'Risco operacional e custos elevados no manuseio de dinheiro em espécie no caixa físico.'
    },
    'concentraogeogrfica': {
        desc: 'Participação percentual de cada praça ou filial no faturamento total do dia selecionado.',
        dor: 'Risco de dependência excessiva do faturamento corporativo em uma única região.'
    },
    'vendasapsh': { // 'Vendas após 18h'
        desc: 'Percentual do faturamento diário obtido a partir das 18h00 (período noturno).',
        dor: 'Dúvidas sobre a viabilidade econômica e o dimensionamento da operação no turno da noite.'
    },
    'itensporcompra': { // 'Itens por Compra'
        desc: 'Quantidade média de itens adquiridos por cliente em um único cupom fiscal (cesta média).',
        dor: 'Ausência de métricas para estruturar campanhas de cross-selling e ofertas combinadas.'
    },
    'maiorvendaticket': { // 'Maior Venda (Ticket)'
        desc: 'Valor da nota fiscal individual mais alta faturada na data selecionada.',
        dor: 'Dificuldade em mapear o teto de gastos do público-alvo para ofertas de produtos premium.'
    },
    // Gráficos
    'vendastotaisporcidade': { // 'Vendas Totais por Cidade'
        desc: 'Comparativo de faturamento e volume entre filiais, com indicadores de variação diária.',
        dor: 'Desconhecimento sobre o desempenho individual e o ritmo de crescimento de cada praça.'
    },
    'faturamentoporhora': { // 'Faturamento por Hora'
        desc: 'Distribuição temporal da receita e das vendas ao longo de cada hora do dia.',
        dor: 'Dificuldade em compreender a dinâmica do fluxo de caixa e os períodos de pico intra-dia.'
    },
    'categoriasdeprodutos': { // 'Categorias de Produtos'
        desc: 'Volume de itens vendidos e receita gerada por cada categoria de produto.',
        dor: 'Falta de clareza sobre o giro de estoque e as categorias com maior aderência de mercado.'
    },
    'mtodosdepagamento': { // 'Métodos de Pagamento'
        desc: 'Receita segmentada pelas diferentes modalidades e canais de pagamento utilizados.',
        dor: 'Ausência de dados concretos para renegociação de taxas operacionais com credenciadoras.'
    },
    'perfildocliente': {
        desc: 'Proporção de compradores segundo o gênero e a categoria de cliente (Normal versus Membro).',
        dor: 'Falta de clareza demográfica para direcionar campanhas e posicionamento de marca.'
    },
    'faturamentoporgnero': {
        desc: 'Volume financeiro (R$) e representatividade de receita por gênero de cliente.',
        dor: 'Risco de concentrar investimentos de marketing em perfis com alto volume, mas baixo retorno financeiro.'
    },
    'preomdioporprodutoupv': {
        desc: 'Preço médio praticado por unidade em cada linha de produtos (UPV = Faturamento / Quantidade).',
        dor: 'Dificuldade em calibrar a precificação e identificar categorias com margens subvalorizadas.'
    },
    'faturamentodiurnovsnoturno': {
        desc: 'Comparativo da receita obtida antes das 18h (Diurno) versus a partir das 18h (Noturno).',
        dor: 'Falta de subsídios analíticos para otimizar escalas de trabalho e turnos de atendimento.'
    },
    // Alertas
    'insightsealertasautomticos': {
        desc: 'Motor analítico de regras que monitora metas, anomalias e variações operacionais críticas.',
        dor: 'Sobrecarga cognitiva ao auditar manualmente múltiplos relatórios e indicadores dispersos.'
    }
};

function inicializarHelpers() {
    const targetElements = document.querySelectorAll('.kpi-info h3, .chart-header h3, .section-title h2');
    
    targetElements.forEach(el => {
        // Limpar o texto de acentos e caracteres especiais para casar perfeitamente
        // Usa textContent para ignorar transformacoes CSS como UPPERCASE no innerText
        const rawText = el.textContent || "";
        const cleanKey = rawText.replace(/[^a-zA-Z]/g, '').toLowerCase();
        
        const mapping = helperMappings[cleanKey];
        
        if (mapping) {
            const isLeftEdge = el.closest('.chart-card:nth-child(even)'); 
            const tipClass = isLeftEdge ? ' tip-left' : '';
            
            const helperHtml = `
                <div class="helper-wrapper${tipClass}">
                    <i class="helper-icon">?</i>
                    <div class="helper-tooltip">
                        <div class="helper-tooltip-label">O que é</div>
                        <div class="helper-tooltip-text">${mapping.desc}</div>
                        <div class="helper-tooltip-pain">
                            <div class="helper-tooltip-label">Dor Solucionada</div>
                            <div class="helper-tooltip-text">${mapping.dor}</div>
                        </div>
                    </div>
                </div>
            `;
            // Append do HTML do helper
            el.innerHTML = el.innerHTML + ' ' + helperHtml;
        }
    });
}

/* --- CARROSSEL DE KPIS --- */
let currentKpiSlide = 0;
function moveKpiCarousel(direction) {
    const track = document.getElementById('kpi-track');
    const slides = document.querySelectorAll('.kpi-slide');
    if (!track || slides.length === 0) return;
    
    currentKpiSlide += direction;
    if (currentKpiSlide < 0) currentKpiSlide = slides.length - 1;
    if (currentKpiSlide >= slides.length) currentKpiSlide = 0;
    
    track.style.transform = `translateX(-${currentKpiSlide * 100}%)`;
}
