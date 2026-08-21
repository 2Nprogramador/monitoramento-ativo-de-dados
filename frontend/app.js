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

    // --- Novas Metricas (integradas aqui para garantir execucao) ---
    try {
        const novas = metrics.novas;
        if (novas) {
            // UPV
            const upvEl = document.getElementById('kpi-upv');
            if (upvEl) upvEl.textContent = formatarMoeda(novas.upv ? novas.upv.atual : 0);
            const upvVarEl = document.getElementById('kpi-var-upv');
            if (upvVarEl) {
                const upvVar = novas.upv ? novas.upv.variacao : null;
                if (upvVar === null || upvVar === undefined) {
                    upvVarEl.className = 'kpi-variation variation-neutral';
                    upvVarEl.innerHTML = '<i class="fa-solid fa-minus"></i> N/A';
                } else {
                    const upvAnt = (novas.upv.atual || 0) - upvVar;
                    if (upvAnt > 0) {
                        const pct = ((upvVar / upvAnt) * 100).toFixed(1);
                        if (upvVar > 0) {
                            upvVarEl.className = 'kpi-variation variation-up';
                            upvVarEl.innerHTML = '<i class="fa-solid fa-caret-up"></i> +' + pct + '%';
                        } else if (upvVar < 0) {
                            upvVarEl.className = 'kpi-variation variation-down';
                            upvVarEl.innerHTML = '<i class="fa-solid fa-caret-down"></i> ' + pct + '%';
                        } else {
                            upvVarEl.className = 'kpi-variation variation-neutral';
                            upvVarEl.innerHTML = '<i class="fa-solid fa-minus"></i> 0.0%';
                        }
                    } else {
                        upvVarEl.className = 'kpi-variation variation-neutral';
                        upvVarEl.innerHTML = '<i class="fa-solid fa-minus"></i> N/A';
                    }
                }
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

            // Mix Digital
            const mixPct = novas.mix_digital_pct !== undefined ? novas.mix_digital_pct : 0;
            const mixEl = document.getElementById('kpi-mix-digital');
            if (mixEl) mixEl.textContent = mixPct + '%';
            const mixSubEl = document.getElementById('kpi-mix-digital-sub');
            if (mixSubEl) {
                mixSubEl.className = mixPct < 60 ? 'kpi-variation variation-down' : 'kpi-variation variation-up';
                mixSubEl.textContent = mixPct < 60 ? 'Abaixo do ideal (60%)' : 'Pix + Cartao + Debito';
            }

            // Concentracao Geografica
            const concGeo = novas.concentracao_geografica || {};
            const concPct = concGeo.percentual || 0;
            const concCidade = concGeo.cidade || '--';
            const concEl = document.getElementById('kpi-conc-geo');
            if (concEl) concEl.textContent = concPct + '%';
            const concSubEl = document.getElementById('kpi-conc-geo-sub');
            if (concSubEl) {
                concSubEl.className = concPct > 70 ? 'kpi-variation variation-down' : 'kpi-variation variation-neutral';
                concSubEl.textContent = concCidade + (concPct > 70 ? ' - Risco!' : ' - Estavel');
            }

            // Eficiencia Noturna
            const noturnoEl = document.getElementById('kpi-noturno');
            if (noturnoEl) noturnoEl.textContent = (novas.eficiencia_noturna_pct || 0) + '%';
            const noturnoSubEl = document.getElementById('kpi-noturno-sub');
            if (noturnoSubEl) noturnoSubEl.textContent = 'Do faturamento diario';
        }
    } catch(e) {
        console.warn('Erro ao atualizar novas metricas:', e);
    }
}

function atualizarMetricasNovas(novas) {
    // Mantida para compatibilidade - novas metricas ja integradas em atualizarKPIs
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
        item.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${formatarMarkdownNegrito(alerta)}</span>`;
        container.appendChild(item);
    });

    // Adicionar Alertas Positivos (Altas/Sucessos)
    alertas_positivos.forEach(alerta => {
        const item = document.createElement('div');
        item.className = 'alert-item positive';
        item.innerHTML = `<i class="fa-solid fa-circle-arrow-up"></i> <span>${formatarMarkdownNegrito(alerta)}</span>`;
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
        const pctNoturno = metrics.novas.eficiencia_noturna_pct || 0;
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
