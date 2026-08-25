// Cache global para instâncias dos gráficos (evita erro de Canvas já utilizado)
const chartInstances = {};

// Configuração padrão de fontes e estilo do Chart.js para combinar com o tema escuro
if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";
}

// Estado global de dados e período
let todasAsDatas = [];
let pacoteAlertasGlobal = {
    alertas_diarios: { alertas_positivos: [], alertas_negativos: [], total_alertas: 0 },
    alertas_semanais: { alertas_positivos: [], alertas_negativos: [], total_alertas: 0 },
    alertas_mensais: { alertas_positivos: [], alertas_negativos: [], total_alertas: 0 }
};
let abaAlertaAtiva = 'diario';
let periodoAtual = {
    type: 'daily',
    startDate: null,
    endDate: null,
    date: null
};

document.addEventListener('DOMContentLoaded', () => {
    inicializarApp();
});

function inicializarApp() {
    carregarDatas();

    // Event Listener do Seletor de Período (Diário, 7 Dias, 30 Dias, Personalizado)
    const periodSelect = document.getElementById('period-mode-select');
    if (periodSelect) {
        periodSelect.addEventListener('change', (e) => {
            configurarModoPeriodo(e.target.value);
        });
    }

    // Event Listener da Data Específica (Modo Diário)
    document.getElementById('date-select').addEventListener('change', (e) => {
        if (e.target.value) {
            periodoAtual.date = e.target.value;
            periodoAtual.startDate = e.target.value;
            periodoAtual.endDate = e.target.value;
            carregarRelatorioPorPeriodo();
        }
    });

    document.getElementById('simulate-btn').addEventListener('click', executarSimulacao);
    
    // Injetar tooltips de explicação de negócio
    inicializarHelpers();
}

function configurarModoPeriodo(modo) {
    const singleDateWrapper = document.getElementById('single-date-wrapper');
    const customDatesWrapper = document.getElementById('custom-dates-wrapper');
    
    periodoAtual.type = modo;

    if (modo === 'daily') {
        if (singleDateWrapper) singleDateWrapper.style.display = 'flex';
        if (customDatesWrapper) customDatesWrapper.style.display = 'none';
        const dateSelect = document.getElementById('date-select');
        periodoAtual.date = dateSelect.value || todasAsDatas[0];
        periodoAtual.startDate = periodoAtual.date;
        periodoAtual.endDate = periodoAtual.date;
        carregarRelatorioPorPeriodo();
    } 
    else if (modo === 'weekly') {
        if (singleDateWrapper) singleDateWrapper.style.display = 'none';
        if (customDatesWrapper) customDatesWrapper.style.display = 'none';
        
        if (todasAsDatas.length > 0) {
            const dataFim = new Date(todasAsDatas[0] + 'T00:00:00');
            const dataInicio = new Date(dataFim);
            dataInicio.setDate(dataFim.getDate() - 6);
            
            periodoAtual.startDate = dataInicio.toISOString().split('T')[0];
            periodoAtual.endDate = todasAsDatas[0];
            carregarRelatorioPorPeriodo();
        }
    } 
    else if (modo === 'monthly') {
        if (singleDateWrapper) singleDateWrapper.style.display = 'none';
        if (customDatesWrapper) customDatesWrapper.style.display = 'none';
        
        if (todasAsDatas.length > 0) {
            const dataFim = new Date(todasAsDatas[0] + 'T00:00:00');
            const dataInicio = new Date(dataFim);
            dataInicio.setDate(dataFim.getDate() - 29);
            
            periodoAtual.startDate = dataInicio.toISOString().split('T')[0];
            periodoAtual.endDate = todasAsDatas[0];
            carregarRelatorioPorPeriodo();
        }
    } 
    else if (modo === 'custom') {
        if (singleDateWrapper) singleDateWrapper.style.display = 'none';
        if (customDatesWrapper) customDatesWrapper.style.display = 'flex';
        
        if (todasAsDatas.length > 0) {
            const dtFimInput = document.getElementById('custom-end-date');
            const dtInicioInput = document.getElementById('custom-start-date');
            if (dtFimInput && !dtFimInput.value) dtFimInput.value = todasAsDatas[0];
            if (dtInicioInput && !dtInicioInput.value) {
                const dMin = new Date(todasAsDatas[0] + 'T00:00:00');
                dMin.setDate(dMin.getDate() - 6);
                dtInicioInput.value = dMin.toISOString().split('T')[0];
            }
        }
    }
}

function aplicarPeriodoCustomizado() {
    const dtInicio = document.getElementById('custom-start-date').value;
    const dtFim = document.getElementById('custom-end-date').value;

    if (!dtInicio || !dtFim) {
        showToast('Selecione as datas inicial e final.', 'warning');
        return;
    }

    if (dtInicio > dtFim) {
        showToast('A data inicial não pode ser posterior à data final.', 'danger');
        return;
    }

    periodoAtual.type = 'custom';
    periodoAtual.startDate = dtInicio;
    periodoAtual.endDate = dtFim;
    carregarRelatorioPorPeriodo();
}

// --- FUNÇÕES DE API ---

async function carregarDatas(dataParaSelecionar = null) {
    try {
        const response = await fetch('/api/dates');
        if (!response.ok) throw new Error('Falha ao carregar datas.');
        
        todasAsDatas = await response.json();
        const select = document.getElementById('date-select');
        select.innerHTML = '';

        if (todasAsDatas.length === 0) {
            select.innerHTML = '<option value="">Sem dados registrados</option>';
            showToast('Nenhum dado encontrado. Clique em Simular para gerar.', 'warning');
            return;
        }

        todasAsDatas.forEach(data => {
            const option = document.createElement('option');
            option.value = data;
            option.textContent = formatarDataBR(data);
            select.appendChild(option);
        });

        // Selecionar a data especificada ou a mais recente por padrão
        const dataAtiva = dataParaSelecionar || todasAsDatas[0];
        select.value = dataAtiva;
        periodoAtual.date = dataAtiva;
        periodoAtual.startDate = dataAtiva;
        periodoAtual.endDate = dataAtiva;

        carregarRelatorioPorPeriodo();

    } catch (error) {
        console.error(error);
        showToast('Erro ao carregar lista de datas do servidor.', 'danger');
    }
}

async function carregarRelatorioPorPeriodo() {
    try {
        let url = '/api/report';
        if (periodoAtual.type === 'daily') {
            url += `?date=${periodoAtual.date}&period_type=daily`;
        } else {
            url += `?start_date=${periodoAtual.startDate}&end_date=${periodoAtual.endDate}&period_type=${periodoAtual.type}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Erro ao carregar dados do período.');

        const dataPayload = await response.json();
        
        // Guardar os alertas dos 3 períodos
        pacoteAlertasGlobal.alertas_diarios = dataPayload.alertas_diarios || { alertas_positivos: [], alertas_negativos: [], total_alertas: 0 };
        pacoteAlertasGlobal.alertas_semanais = dataPayload.alertas_semanais || { alertas_positivos: [], alertas_negativos: [], total_alertas: 0 };
        pacoteAlertasGlobal.alertas_mensais = dataPayload.alertas_mensais || { alertas_positivos: [], alertas_negativos: [], total_alertas: 0 };

        // Atualizar interface
        atualizarKPIs(dataPayload.metrics);
        renderizarGraficos(dataPayload.metrics);
        renderizarAlertasPorAba();

    } catch (error) {
        console.error(error);
        showToast('Erro ao carregar dados do período selecionado.', 'danger');
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
    
    document.getElementById('kpi-avg-rating').textContent = formatarNumero(avgRating, 1) + ' / 10';
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
                    pctSpan.textContent = `(${formatarNumero(pctHoje, 1)}%)`;
                    
                    cityInfoDiv.appendChild(nameSpan);
                    cityInfoDiv.appendChild(pctSpan);
                    
                    const varSpan = document.createElement('span');
                    varSpan.className = 'kpi-variation';
                    
                    if (variacaoPct > 0) {
                        varSpan.classList.add('variation-up');
                        varSpan.innerHTML = `<i class="fa-solid fa-caret-up"></i> +${formatarNumero(variacaoPct, 1)}%`;
                    } else if (variacaoPct < 0) {
                        varSpan.classList.add('variation-down');
                        varSpan.innerHTML = `<i class="fa-solid fa-caret-down"></i> ${formatarNumero(variacaoPct, 1)}%`;
                    } else {
                        varSpan.classList.add('variation-neutral');
                        varSpan.innerHTML = `<i class="fa-solid fa-minus"></i> 0,0%`;
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
                noturnoEl.textContent = formatarNumero(atual, 1) + '%';
            }
            const noturnoSubEl = document.getElementById('kpi-noturno-sub');
            if (noturnoSubEl) noturnoSubEl.textContent = 'Do faturamento diário';

            // Itens por Compra (KPI 11)
            const itensCompraEl = document.getElementById('kpi-itens-compra');
            if (itensCompraEl && novas.itens_por_compra) {
                itensCompraEl.textContent = formatarNumero(novas.itens_por_compra.atual, 1);
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
    // Inicializar helpers após atualizar os KPIs
    setTimeout(inicializarHelpers, 100);
}

// --- GLOSSÁRIO COMPLETO DE ALERTAS (30 REGRAS: DIÁRIOS, SEMANAIS E MENSAIS) ---
const alertasGlossario = [
    // === 1. ALERTAS DIÁRIOS (10 REGRAS) ===
    {
        key: 'ultrapassaram R$',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-bullseye',
        title: 'Meta Diária de Faturamento por Cidade',
        desc: 'Sinaliza quando uma ou mais filiais atingem marcos expressivos de faturamento (acima de R$ 30.000,00) no dia.',
        dor: 'Permite parabenizar equipes de alto desempenho e identificar rapidamente praças com tração acelerada.'
    },
    {
        key: 'queda superior a 30%',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-arrow-trend-down',
        title: 'Queda Brusca de Vendas Diárias',
        desc: 'Disparado se o faturamento de uma cidade cair mais de 30% em relação ao dia anterior.',
        dor: 'Permite intervenção tática imediata da gerência para investigar problemas de estoque, equipe ou concorrência local.'
    },
    {
        key: 'Pix',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-bolt',
        title: 'Aumento de Pagamentos via Pix no Dia',
        desc: 'Notifica se o volume financeiro transacionado via Pix cresceu de forma expressiva frente ao dia anterior.',
        dor: 'Avalia a eficácia de campanhas de incentivo ao Pix, reduzindo taxas de cartão de crédito e aumentando margem líquida.'
    },
    {
        key: '400 vendas',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-boxes-stacked',
        title: 'Alta Demanda de Linhas de Produto (400+ un)',
        desc: 'Alerta para categorias que ultrapassaram a marca crítica de 400 unidades vendidas no dia.',
        dor: 'Evita a ruptura de estoque (desabastecimento), permitindo reposição ágil de mercadorias no dia seguinte.'
    },
    {
        key: 'Não-Membros',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-user-group',
        title: 'Baixa Aquisição Diária de Novos Clientes',
        desc: 'Avisa quando clientes normais (não membros) representam menos de 20% das vendas totais do dia.',
        dor: 'Sinaliza que o negócio parou de atrair público novo, dependendo exclusivamente da base já fidelizada.'
    },
    {
        key: 'rating abaixo de 5.0',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-triangle-exclamation',
        title: 'Alerta Crítico de Satisfação Diária',
        desc: 'Dispara quando mais de 5% das vendas recebem avaliação abaixo de 5.0 (escala de 1 a 10).',
        dor: 'Identifica dias pontuais de mau atendimento, falhas operacionais graves ou lotes de produtos com defeito.'
    },
    {
        key: 'dependência geográfica',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-globe',
        title: 'Risco de Concentração Geográfica Diária',
        desc: 'Alerta quando uma única filial concentra mais de 60% de todo o faturamento da empresa no dia.',
        dor: 'Sinaliza alta vulnerabilidade da operação a imprevistos, paralisações ou feriados locais nessa praça.'
    },
    {
        key: '(UPV)',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-tags',
        title: 'Queda Diária de Preço Médio (UPV)',
        desc: 'Avisa quando o valor unitário médio por produto vendido cai em relação à média histórica.',
        dor: 'Evidencia retração no poder de compra dos clientes ou ineficácia da equipe de vendas em cross-selling.'
    },
    {
        key: 'digitais',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-credit-card',
        title: 'Queda Diária de Pagamentos Digitais',
        desc: 'Alerta quando menos de 70% das transações são efetuadas por meios eletrônicos (Pix e Cartões).',
        dor: 'Maior circulação de dinheiro em espécie aumenta o risco de perdas, fraudes e custos com transporte de valores.'
    },
    {
        key: 'destaque do dia',
        categoria: 'diario',
        badge: 'Diário',
        icon: 'fa-trophy',
        title: 'Produto Campeão de Vendas do Dia',
        desc: 'Destaca o produto específico que gerou a maior receita bruta no fechamento diário.',
        dor: 'Informa a liderança com precisão sobre qual produto é a locomotiva de receita no momento.'
    },

    // === 2. ALERTAS SEMANAIS (10 REGRAS) ===
    {
        key: 'Meta Semanal',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-bullseye',
        title: 'Meta Semanal por Filial Batida',
        desc: 'Dispara quando filiais superam a meta semanal consolidada de R$ 180.000,00 de faturamento nos últimos 7 dias.',
        dor: 'Reconhece consistência operacional semanal e embasa a distribuição de metas para os próximos ciclos.'
    },
    {
        key: 'Recuo Semanal',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-arrow-trend-down',
        title: 'Recuo Semanal de Vendas por Cidade',
        desc: 'Notifica filiais que apresentaram queda superior a 20% no faturamento consolidado frente à semana anterior.',
        dor: 'Evita a consolidação de perdas no mês, permitindo reajuste de estoque e campanhas promocionais locais na semana seguinte.'
    },
    {
        key: 'Campeão da Semana',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-trophy',
        title: 'Produto Campeão da Semana',
        desc: 'Evidencia o produto com maior faturamento acumulado no bloco de 7 dias.',
        dor: 'Garante que o produto mais rentável da semana tenha reposição prioritária no centro de distribuição.'
    },
    {
        key: 'Aceleração Pix',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-bolt',
        title: 'Aceleração Semanal do Volume via Pix',
        desc: 'Alerta quando o faturamento via Pix cresce mais de 20% em comparação com a semana anterior.',
        dor: 'Comprova ganho de eficiência no fluxo de caixa semanal e redução de despesas com adquirentes de cartão.'
    },
    {
        key: 'Alta Rotação Semanal',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-boxes-stacked',
        title: 'Alta Rotação Semanal de Estoque (2.000+ un)',
        desc: 'Sinaliza categorias que venderam mais de 2.000 unidades durante a semana.',
        dor: 'Permite planejar pedidos antecipados aos fornecedores antes do desabastecimento na loja física.'
    },
    {
        key: 'Baixa Entrada Semanal',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-user-plus',
        title: 'Baixa Aquisição Semanal de Clientes (< 25%)',
        desc: 'Avisa quando clientes novos representam menos de 25% do faturamento da semana.',
        dor: 'Alerta sobre perda de força no topo do funil de marketing e estagnação na atração de novos consumidores.'
    },
    {
        key: 'Qualidade Semanal',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-star-half-stroke',
        title: 'Alerta de Qualidade Semanal (> 5% notas < 5.0)',
        desc: 'Notifica se mais de 5% de todas as compras da semana receberam notas críticas de avaliação.',
        dor: 'Evita a degradação da reputação da marca e direciona treinamentos de atendimento para as equipes.'
    },
    {
        key: 'Concentração Semanal',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-chart-pie',
        title: 'Concentração Semanal de Risco (> 55%)',
        desc: 'Dispara se uma única cidade responder por mais de 55% da receita líquida da semana.',
        dor: 'Aponta dependência estrutural semanal de uma praça, sinalizando necessidade de estímulo nas demais filiais.'
    },
    {
        key: 'Erosão de Preço Semanal',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-tag',
        title: 'Erosão Semanal de Preço Médio (UPV)',
        desc: 'Sinaliza quando o Preço Médio por Unidade cai mais de 15% em relação à semana anterior.',
        dor: 'Detecta concessão excessiva de descontos ou migração forçada de clientes para linhas de baixa margem.'
    },
    {
        key: 'Caixa Físico Semanal',
        categoria: 'semanal',
        badge: 'Semanal',
        icon: 'fa-money-bill-wave',
        title: 'Alerta de Caixa Físico Semanal (< 75% digital)',
        desc: 'Avisa se o mix de meios digitais (Pix/Cartão) ficar abaixo de 75% no consolidado semanal.',
        dor: 'Avisa sobre excesso de dinheiro físico nos cofres das filiais, mitigando riscos de segurança e sangria.'
    },

    // === 3. ALERTAS MENSAIS (10 REGRAS) ===
    {
        key: 'Meta Mensal',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-bullseye',
        title: 'Meta Mensal por Filial Batida (> R$ 750k)',
        desc: 'Reconhece filiais que ultrapassaram a meta global de R$ 750.000,00 faturados no mês.',
        dor: 'Valida o plano de negócios e fundamenta o cálculo de bonificações e metas do próximo mês.'
    },
    {
        key: 'Recuo Mensal',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-arrow-trend-down',
        title: 'Recuo Mensal Consolidado de Filial',
        desc: 'Notifica filiais com retração superior a 15% no faturamento mensal frente ao mês anterior.',
        dor: 'Permite auditoria estratégica profunda para reestruturar estratégias regionais e rever custos fixos.'
    },
    {
        key: 'Campeão do Mês',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-trophy',
        title: 'Campeão Absoluto de Vendas do Mês',
        desc: 'Destaca o produto de maior faturamento acumulado nos 30 dias de fechamento.',
        dor: 'Direciona contratos de longo prazo e negociações de volume com os fabricantes principais.'
    },
    {
        key: 'Expansão Mensal do Pix',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-bolt',
        title: 'Expansão Mensal Consolidada do Pix',
        desc: 'Alerta sobre crescimento superior a 15% no uso de Pix no volume fechado do mês.',
        dor: 'Mede a economia direta obtida em taxas bancárias no fechamento contábil mensal.'
    },
    {
        key: 'Alta Demanda Mensal',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-boxes-stacked',
        title: 'Alta Demanda Mensal de Categorias (8.000+ un)',
        desc: 'Sinaliza linhas de produto que venderam mais de 8.000 unidades no ciclo mensal.',
        dor: 'Base para o planejamento anual de compras (S&OP) e dimensionamento da capacidade logística.'
    },
    {
        key: 'Estagnação de Base',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-users-slash',
        title: 'Estagnação Mensal de Base (< 20% novos)',
        desc: 'Avisa quando clientes normais representam menos de 20% do faturamento mensal.',
        dor: 'Sinaliza envelhecimento da base de clientes e risco futuro de sustentabilidade do negócio.'
    },
    {
        key: 'CSAT Mensal',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-face-frown',
        title: 'Índice Crítico de CSAT Mensal (> 6% < 5.0)',
        desc: 'Dispara se mais de 6% das avaliações do mês consolidado forem insatisfatórias.',
        dor: 'Prevenção de churn (perda de clientes) e revisão obrigatória dos processos de pós-venda.'
    },
    {
        key: 'Dependência Regional Mensal',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-globe-americas',
        title: 'Dependência Regional Mensal (> 50%)',
        desc: 'Alerta quando uma única cidade responde por mais de 50% de toda a receita da rede no mês.',
        dor: 'Identifica concentração de risco corporativo, orientando investimentos de expansão em outras regiões.'
    },
    {
        key: 'Queda Estrutural de UPV',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-hand-holding-dollar',
        title: 'Queda Estrutural de Preço Médio (UPV)',
        desc: 'Avisa se o Preço Médio Unitário cair mais de 10% no acumulado mensal.',
        dor: 'Audita a política de precificação da empresa, evitando erosão perigosa das margens de lucro líquidas.'
    },
    {
        key: 'Oportunidade Noturna',
        categoria: 'mensal',
        badge: 'Mensal',
        icon: 'fa-moon',
        title: 'Oportunidade em Vendas Noturnas (< 25%)',
        desc: 'Sinaliza quando o faturamento após as 18h representa menos de 25% da receita mensal.',
        dor: 'Apoia a decisão sobre horário de funcionamento de lojas, escalas de funcionários e campanhas noturnas.'
    }
];

let filtroGlossarioAtivo = 'diario';
let termoBuscaGlossario = '';
let modoGlossario = 'menu'; // 'menu' ou 'list'

function toggleGlossary() {
    const modal = document.getElementById('glossary-modal');
    if (!modal) return;
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    } else {
        voltarAoMenuGlossario();
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

function fecharGlossarioModal(event) {
    if (event && event.target && event.target.closest('.glossary-modal-card') && !event.target.closest('.modal-close-btn')) {
        return; // Não fecha se clicou no conteúdo interno do modal
    }
    const modal = document.getElementById('glossary-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function voltarAoMenuGlossario() {
    modoGlossario = 'menu';
    const menuView = document.getElementById('glossary-menu-view');
    const listView = document.getElementById('glossary-list-view');
    const titleEl = document.getElementById('glossary-modal-title');
    const subTitleEl = document.getElementById('glossary-modal-subtitle');
    const searchInput = document.getElementById('glossary-search-input');

    if (menuView) menuView.style.display = 'grid';
    if (listView) listView.style.display = 'none';
    if (searchInput) searchInput.value = '';
    termoBuscaGlossario = '';

    if (titleEl) titleEl.textContent = 'Glossário de Alertas Inteligentes';
    if (subTitleEl) subTitleEl.textContent = 'Selecione uma categoria para explorar os critérios de disparo e dores solucionadas';
}

function selecionarCategoriaGlossario(categoria) {
    modoGlossario = 'list';
    const menuView = document.getElementById('glossary-menu-view');
    const listView = document.getElementById('glossary-list-view');
    const titleEl = document.getElementById('glossary-modal-title');
    const subTitleEl = document.getElementById('glossary-modal-subtitle');

    if (menuView) menuView.style.display = 'none';
    if (listView) listView.style.display = 'flex';

    if (categoria === 'diario') {
        if (titleEl) titleEl.textContent = 'Alertas Diários (10 Regras)';
        if (subTitleEl) subTitleEl.textContent = 'Critérios de monitoramento diário de metas, faturamento, anomalias e satisfação';
    } else if (categoria === 'semanal') {
        if (titleEl) titleEl.textContent = 'Alertas Semanais (10 Regras)';
        if (subTitleEl) subTitleEl.textContent = 'Critérios consolidados a cada 7 dias para avaliação de consistência e estoque';
    } else if (categoria === 'mensal') {
        if (titleEl) titleEl.textContent = 'Alertas Mensais (10 Regras)';
        if (subTitleEl) subTitleEl.textContent = 'Critérios de fechamento mensal para planejamento S&OP e metas globais';
    }

    filtrarGlossario(categoria);
}

function filtrarGlossario(categoria) {
    filtroGlossarioAtivo = categoria;
    
    document.querySelectorAll('.glossary-tab-btn').forEach(btn => {
        if (btn.dataset.filter === categoria) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const titleEl = document.getElementById('glossary-modal-title');
    const subTitleEl = document.getElementById('glossary-modal-subtitle');
    if (categoria === 'diario') {
        if (titleEl) titleEl.textContent = 'Alertas Diários (10 Regras)';
        if (subTitleEl) subTitleEl.textContent = 'Critérios de monitoramento diário de metas, faturamento, anomalias e satisfação';
    } else if (categoria === 'semanal') {
        if (titleEl) titleEl.textContent = 'Alertas Semanais (10 Regras)';
        if (subTitleEl) subTitleEl.textContent = 'Critérios consolidados a cada 7 dias para avaliação de consistência e estoque';
    } else if (categoria === 'mensal') {
        if (titleEl) titleEl.textContent = 'Alertas Mensais (10 Regras)';
        if (subTitleEl) subTitleEl.textContent = 'Critérios de fechamento mensal para planejamento S&OP e metas globais';
    }

    renderGlossary();
}

function pesquisarGlossario(termo) {
    termoBuscaGlossario = (termo || '').toLowerCase().trim();
    renderGlossary();
}

function renderGlossary() {
    const body = document.getElementById('glossary-body');
    if (!body) return;

    let itens = alertasGlossario;

    // Filtro por frequência (todos, diario, semanal, mensal)
    if (filtroGlossarioAtivo !== 'todos') {
        itens = itens.filter(a => a.categoria === filtroGlossarioAtivo);
    }

    // Filtro por busca textual
    if (termoBuscaGlossario) {
        itens = itens.filter(a => 
            a.title.toLowerCase().includes(termoBuscaGlossario) ||
            a.desc.toLowerCase().includes(termoBuscaGlossario) ||
            a.dor.toLowerCase().includes(termoBuscaGlossario) ||
            a.badge.toLowerCase().includes(termoBuscaGlossario)
        );
    }

    if (itens.length === 0) {
        body.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #94a3b8;">
                <i class="fa-solid fa-magnifying-glass" style="font-size: 2rem; margin-bottom: 0.75rem; color: #64748b;"></i>
                <p style="font-size: 0.95rem; margin: 0;">Nenhum alerta encontrado para o filtro aplicado.</p>
            </div>
        `;
        return;
    }

    body.innerHTML = itens.map(alerta => `
        <div class="glossary-item">
            <div class="glossary-item-header">
                <div class="glossary-item-title">
                    <i class="fa-solid ${alerta.icon || 'fa-bell'}" style="color: var(--color-accent, #6366f1);"></i>
                    <span>${alerta.title}</span>
                </div>
                <span class="glossary-item-badge ${alerta.categoria}">${alerta.badge}</span>
            </div>
            <div class="glossary-item-desc">${adaptarTextoPorPeriodo(alerta.desc)}</div>
            <div class="glossary-item-pain">
                <strong>Dor Solucionada:</strong> ${adaptarTextoPorPeriodo(alerta.dor)}
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
        text = `<i class="fa-solid fa-caret-up"></i> ${sign}${formatarNumero(percentual, 1)}%`;
    } else if (valorVar < 0) {
        el.className = 'kpi-variation variation-down';
        text = `<i class="fa-solid fa-caret-down"></i> ${formatarNumero(percentual, 1)}%`;
    } else {
        el.className = 'kpi-variation variation-neutral';
        text = '<i class="fa-solid fa-minus"></i> 0,0%';
    }
    
    el.innerHTML = text;
}

function gerarHelperHtmlParaAlerta(alertaTexto) {
    const cleanTexto = alertaTexto.toLowerCase();
    const alertaDef = alertasGlossario.find(a => cleanTexto.includes(a.key.toLowerCase()));
    const keyAttr = alertaDef ? alertaDef.key : 'destaque do dia';
    const customDesc = alertaDef ? alertaDef.desc : 'Notificação automática do motor de inteligência analítica.';
    const customDor = alertaDef ? alertaDef.dor : 'Alerta preventivo para ação operacional rápida e redução de riscos.';
    const customTitle = alertaDef ? alertaDef.title : 'Alerta de Desempenho';
    
    return `<button type="button" class="helper-btn alert-helper-btn" data-alert-key="${keyAttr}" data-title="${customTitle}" data-custom-desc="${customDesc}" data-custom-dor="${customDor}" aria-label="Explicação do alerta" title="Ver explicação">?</button>`;
}

function trocarAbaAlertas(aba) {
    abaAlertaAtiva = aba;
    
    // Atualizar classe active nos botões
    document.querySelectorAll('.alert-tab-btn').forEach(btn => {
        if (btn.dataset.tab === aba) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    renderizarAlertasPorAba();
}

function renderizarAlertasPorAba() {
    let alertas;
    let tituloAba = 'Alertas Inteligentes';

    if (abaAlertaAtiva === 'semanal') {
        alertas = pacoteAlertasGlobal.alertas_semanais;
        const info = (alertas && alertas.bloco_info) ? ` (${alertas.bloco_info})` : '';
        tituloAba = `Alertas Semanais${info}`;
    } else if (abaAlertaAtiva === 'mensal') {
        alertas = pacoteAlertasGlobal.alertas_mensais;
        const info = (alertas && alertas.bloco_info) ? ` (${alertas.bloco_info})` : '';
        tituloAba = `Alertas Mensais${info}`;
    } else {
        alertas = pacoteAlertasGlobal.alertas_diarios;
        const info = (alertas && alertas.bloco_info) ? ` (${alertas.bloco_info})` : '';
        tituloAba = `Alertas do Dia${info}`;
    }

    const titleEl = document.getElementById('alerts-section-title');
    if (titleEl) titleEl.textContent = tituloAba;

    atualizarAlertas(alertas || { alertas_positivos: [], alertas_negativos: [], total_alertas: 0 });
}

function atualizarAlertas(alertas) {
    const container = document.getElementById('alerts-container');
    const badge = document.getElementById('alerts-count-badge');
    container.innerHTML = '';
    
    const { alertas_positivos = [], alertas_negativos = [], total_alertas = 0 } = alertas;
    const total = total_alertas || (alertas_positivos.length + alertas_negativos.length);
    badge.textContent = `${total} alertas`;
    
    if (total === 0) {
        container.innerHTML = `
            <div class="no-alerts">
                <i class="fa-regular fa-circle-check"></i>
                Nenhum alerta crítico para este período.
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
    const coresVariacaoCidades = variacaoCidades.map(v => v < 0 ? '#D60700' : '#00CF42');

    criarGrafico('chart-city', {
        type: 'bar',
        data: {
            labels: cidades,
            datasets: [
                {
                    label: 'Faturamento Total (R$)',
                    data: faturamentoCidades,
                    backgroundColor: '#0040F0', // Azul Real
                    borderRadius: 6,
                },
                {
                    label: 'Variação vs. Dia Anterior (R$)',
                    data: variacaoCidades,
                    backgroundColor: coresVariacaoCidades, // Vermelho se negativo, Verde se positivo
                    borderRadius: 6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        font: { size: 12 },
                        boxWidth: 12,
                        padding: 15,
                        generateLabels: function(chart) {
                            return [
                                { text: 'Faturamento Total (R$)', fillStyle: '#0040F0', fontColor: '#94a3b8', strokeStyle: '#0040F0', lineWidth: 0 },
                                { text: 'Variação Positiva (R$)', fillStyle: '#00CF42', fontColor: '#94a3b8', strokeStyle: '#00CF42', lineWidth: 0 },
                                { text: 'Variação Negativa / Queda (R$)', fillStyle: '#D60700', fontColor: '#94a3b8', strokeStyle: '#D60700', lineWidth: 0 }
                            ];
                        }
                    }
                }
            },
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
                borderColor: '#00CF42', // Verde Esmeralda
                backgroundColor: 'rgba(0, 207, 66, 0.08)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#00CF42'
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
                    backgroundColor: '#00B6E3', // Ciano Elétrico
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
                backgroundColor: ['#00CF42', '#DFC900', '#9100EB', '#DD00BC', '#00B6E3', '#0040F0'],
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
                backgroundColor: ['#DD00BC', '#0040F0'], // Magenta & Azul Real
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
                    backgroundColor: ['#DD00BC', '#0040F0', '#76D700'],
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
                    backgroundColor: '#DFC900', // Amarelo Dourado
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
                    backgroundColor: ['#DFC900', '#9100EB'], // Amarelo Dia / Roxo Noite
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

        const prodAnalises = metrics.novas.produtos_analises || {};

        // 9. Detecção de Anomalias / Queda de Vendas (Barra de Variação %)
        if (prodAnalises.anomalias_linhas && prodAnalises.anomalias_linhas.length > 0) {
            const labelsAnomalias = prodAnalises.anomalias_linhas.map(a => a.linha);
            const varsAnomalias = prodAnalises.anomalias_linhas.map(a => a.variacao_pct);
            // Vermelho (#D60700) exclusivo para variação negativa (< 0) e Verde (#00CF42) para crescimento positivo (>= 0)
            const coresAnomalias = varsAnomalias.map(v => v < 0 ? '#D60700' : '#00CF42');

            criarGrafico('chart-anomalias', {
                type: 'bar',
                data: {
                    labels: labelsAnomalias,
                    datasets: [{
                        label: 'Variação vs. Dia Anterior (%)',
                        data: varsAnomalias,
                        backgroundColor: coresAnomalias,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: {
                                color: '#94a3b8',
                                font: { size: 12 },
                                boxWidth: 12,
                                padding: 15,
                                generateLabels: function(chart) {
                                    return [
                                        { text: 'Crescimento Positivo (>= 0%)', fillStyle: '#00CF42', fontColor: '#94a3b8', strokeStyle: '#00CF42', lineWidth: 0 },
                                        { text: 'Variação Negativa / Queda (< 0%)', fillStyle: '#D60700', fontColor: '#94a3b8', strokeStyle: '#D60700', lineWidth: 0 }
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        y: { grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        // 10. Curva ABC de Produtos (Barra Horizontal com Cores por Classe)
        if (prodAnalises.curva_abc && prodAnalises.curva_abc.length > 0) {
            const labelsAbc = prodAnalises.curva_abc.map(p => (p['Product name'] || p['Product line'] || p.produto || '').substring(0, 26));
            const totaisAbc = prodAnalises.curva_abc.map(p => p.Total);
            // Classe A: Verde #00CF42, Classe B: Ciano #00B6E3, Classe C: Roxo #9100EB
            const coresAbc = prodAnalises.curva_abc.map(p => p.Classe === 'A' ? '#00CF42' : (p.Classe === 'B' ? '#00B6E3' : '#9100EB'));
            
            criarGrafico('chart-curva-abc', {
                type: 'bar',
                data: {
                    labels: labelsAbc,
                    datasets: [{
                        label: 'Faturamento (R$)',
                        data: totaisAbc,
                        backgroundColor: coresAbc,
                        borderRadius: 5
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: {
                                color: '#94a3b8',
                                font: { size: 12 },
                                boxWidth: 12,
                                padding: 15,
                                generateLabels: function(chart) {
                                    return [
                                        { text: 'Classe A (Até 80% da Receita)', fillStyle: '#00CF42', fontColor: '#94a3b8', strokeStyle: '#00CF42', lineWidth: 0 },
                                        { text: 'Classe B (Próximos 15%)', fillStyle: '#00B6E3', fontColor: '#94a3b8', strokeStyle: '#00B6E3', lineWidth: 0 },
                                        { text: 'Classe C (Últimos 5%)', fillStyle: '#9100EB', fontColor: '#94a3b8', strokeStyle: '#9100EB', lineWidth: 0 }
                                    ];
                                }
                            }
                        }
                    },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' } },
                        y: { grid: { display: false } }
                    }
                }
            });
        }

        // 11. Matriz Preço Médio vs Volume (Barra Mista)
        if (prodAnalises.matriz_elasticidade && prodAnalises.matriz_elasticidade.length > 0) {
            const labelsElasticidade = prodAnalises.matriz_elasticidade.map(e => e.linha);
            const precosMedios = prodAnalises.matriz_elasticidade.map(e => e.preco_medio);
            const qtds = prodAnalises.matriz_elasticidade.map(e => e.quantidade);

            criarGrafico('chart-elasticidade', {
                type: 'bar',
                data: {
                    labels: labelsElasticidade,
                    datasets: [
                        {
                            label: 'Preço Médio Unitário (R$)',
                            data: precosMedios,
                            backgroundColor: '#9100EB', // Roxo
                            borderRadius: 4,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Volume Vendido (Qtd)',
                            data: qtds,
                            backgroundColor: '#00B6E3', // Ciano
                            borderRadius: 4,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 15 }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            position: 'left',
                            grid: { color: 'rgba(255,255,255,0.05)' }
                        },
                        y1: {
                            type: 'linear',
                            position: 'right',
                            grid: { display: false }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        // 12. Perfil do Comprador por Categoria (Membro vs Normal Empilhado)
        if (prodAnalises.perfil_comprador_categoria && prodAnalises.perfil_comprador_categoria.length > 0) {
            const labelsMembro = prodAnalises.perfil_comprador_categoria.map(p => p.linha);
            const faturamentoMembros = prodAnalises.perfil_comprador_categoria.map(p => p.membro);
            const faturamentoNormais = prodAnalises.perfil_comprador_categoria.map(p => p.normal);

            criarGrafico('chart-perfil-membro', {
                type: 'bar',
                data: {
                    labels: labelsMembro,
                    datasets: [
                        {
                            label: 'Membros do Clube (R$)',
                            data: faturamentoMembros,
                            backgroundColor: '#DD00BC', // Magenta
                            borderRadius: 4
                        },
                        {
                            label: 'Clientes Normais (R$)',
                            data: faturamentoNormais,
                            backgroundColor: '#0040F0', // Azul Real
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 15 }
                        }
                    },
                    scales: {
                        x: { stacked: true, grid: { display: false } },
                        y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // 13. Horários de Pico por Categoria (Turnos)
        if (prodAnalises.horarios_categoria && prodAnalises.horarios_categoria.length > 0) {
            const labelsHorarios = prodAnalises.horarios_categoria.map(h => h['Product line']);
            const manha = prodAnalises.horarios_categoria.map(h => h['Manhã (até 12h)'] || 0);
            const tarde = prodAnalises.horarios_categoria.map(h => h['Tarde (13h-17h)'] || 0);
            const noite = prodAnalises.horarios_categoria.map(h => h['Noite (18h+)'] || 0);

            criarGrafico('chart-horarios-categoria', {
                type: 'bar',
                data: {
                    labels: labelsHorarios,
                    datasets: [
                        { label: 'Manhã (até 12h)', data: manha, backgroundColor: '#DFC900', borderRadius: 4 }, // Amarelo
                        { label: 'Tarde (13h-17h)', data: tarde, backgroundColor: '#00B6E3', borderRadius: 4 }, // Ciano
                        { label: 'Noite (18h+)', data: noite, backgroundColor: '#9100EB', borderRadius: 4 }  // Roxo
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 15 }
                        }
                    },
                    scales: {
                        x: { grid: { display: false } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // 14. Índice de Satisfação (Rating) por Categoria
        if (prodAnalises.satisfacao_categoria && prodAnalises.satisfacao_categoria.length > 0) {
            const labelsSatisfacao = prodAnalises.satisfacao_categoria.map(s => s.linha);
            const ratings = prodAnalises.satisfacao_categoria.map(s => s.rating_medio);

            criarGrafico('chart-satisfacao-categoria', {
                type: 'bar',
                data: {
                    labels: labelsSatisfacao,
                    datasets: [{
                        label: 'Avaliação Média do Cliente (Escala 1 a 10)',
                        data: ratings,
                        backgroundColor: '#0040F0', // Azul Real (sem usar vermelho para notas absolutas)
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 15 }
                        }
                    },
                    scales: {
                        y: { min: 0, max: 10, grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        // 15. Preferência de Pagamento por Categoria (Barras Empilhadas)
        if (prodAnalises.pagamento_categoria && prodAnalises.pagamento_categoria.length > 0) {
            const labelsPagtoCat = prodAnalises.pagamento_categoria.map(p => p['Product line']);
            const pixData = prodAnalises.pagamento_categoria.map(p => p['Pix'] || 0);
            const cartaoData = prodAnalises.pagamento_categoria.map(p => (p['Cartao de Credito'] || p['Credit card'] || 0));
            const debitoData = prodAnalises.pagamento_categoria.map(p => (p['Debito'] || p['Ewallet'] || 0));

            criarGrafico('chart-pagamento-categoria', {
                type: 'bar',
                data: {
                    labels: labelsPagtoCat,
                    datasets: [
                        { label: 'Pix', data: pixData, backgroundColor: '#00CF42', borderRadius: 4 }, // Verde Pix
                        { label: 'Cartão de Crédito', data: cartaoData, backgroundColor: '#9100EB', borderRadius: 4 }, // Roxo Cartão
                        { label: 'Débito', data: debitoData, backgroundColor: '#00B6E3', borderRadius: 4 } // Ciano Débito
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 15 }
                        }
                    },
                    scales: {
                        x: { stacked: true, grid: { display: false } },
                        y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // 16. Cesta de Compras e Itens por Cupom
        if (prodAnalises.cesta_produtos && prodAnalises.cesta_produtos.length > 0) {
            const labelsCesta = prodAnalises.cesta_produtos.map(c => c.linha);
            const mediasCesta = prodAnalises.cesta_produtos.map(c => c.media_itens_cupom);
            const maxCesta = prodAnalises.cesta_produtos.map(c => c.max_itens_cupom);

            criarGrafico('chart-cesta-produtos', {
                type: 'bar',
                data: {
                    labels: labelsCesta,
                    datasets: [
                        { label: 'Média de Itens por Compra', data: mediasCesta, backgroundColor: '#76D700', borderRadius: 4 }, // Verde Lima
                        { label: 'Pico de Itens em 1 Compra', data: maxCesta, backgroundColor: '#00B6E3', borderRadius: 4 } // Ciano
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 15 }
                        }
                    },
                    scales: {
                        x: { grid: { display: false } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // 17. Performance Regional por Cidade
        if (prodAnalises.regional_categoria && prodAnalises.regional_categoria.length > 0) {
            const labelsRegional = prodAnalises.regional_categoria.map(r => r['Product line']);
            const cidadesDisponiveis = ['São Paulo', 'Rio de Janeiro', 'Manaus', 'Brasília', 'Curitiba'].filter(c => {
                return prodAnalises.regional_categoria.some(r => r[c] !== undefined);
            });
            const coresCidades = ['#0040F0', '#DD00BC', '#00CF42', '#DFC900', '#00B6E3'];

            const datasetsRegional = cidadesDisponiveis.map((cidade, idx) => ({
                label: cidade,
                data: prodAnalises.regional_categoria.map(r => r[cidade] || 0),
                backgroundColor: coresCidades[idx % coresCidades.length],
                borderRadius: 4
            }));

            criarGrafico('chart-regional-categoria', {
                type: 'bar',
                data: {
                    labels: labelsRegional,
                    datasets: datasetsRegional
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 15 }
                        }
                    },
                    scales: {
                        x: { grid: { display: false } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' } }
                    }
                }
            });
        }

        // 18. Ritmo de Saída / Burn Rate (Top Produtos e Projeção 30d)
        if (prodAnalises.burn_rate_produtos && prodAnalises.burn_rate_produtos.length > 0) {
            const labelsBurn = prodAnalises.burn_rate_produtos.map(b => (b.produto || '').substring(0, 24));
            const saidaDiaria = prodAnalises.burn_rate_produtos.map(b => b.saida_diaria);
            const projecao30d = prodAnalises.burn_rate_produtos.map(b => b.estoque_estimado_30d);

            criarGrafico('chart-burn-rate', {
                type: 'bar',
                data: {
                    labels: labelsBurn,
                    datasets: [
                        {
                            label: 'Saída Diária (Unidades/Dia)',
                            data: saidaDiaria,
                            backgroundColor: '#DD00BC', // Magenta
                            borderRadius: 4,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Projeção Reposição 30 Dias (Unidades)',
                            data: projecao30d,
                            backgroundColor: '#0040F0', // Azul Real
                            borderRadius: 4,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 15 }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            position: 'left',
                            grid: { color: 'rgba(255,255,255,0.05)' }
                        },
                        y1: {
                            type: 'linear',
                            position: 'right',
                            grid: { display: false }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    }
}

function criarGrafico(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el) {
        console.warn(`Canvas element #${canvasId} não foi encontrado no DOM.`);
        return;
    }
    // Destruir instância antiga se já existir
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }
    const ctx = el.getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, config);
}

// --- UTILS ---

function formatarDataBR(dataStr) {
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) return 'R$ 0,00';
    return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarNumero(valor, casas = 1) {
    if (valor === null || valor === undefined || isNaN(valor)) return '0,0';
    return Number(valor).toLocaleString('pt-BR', {
        minimumFractionDigits: casas,
        maximumFractionDigits: casas
    });
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
    // 1. KPIs
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
    'satisfaogeral': {
        desc: 'Média das notas de avaliação (escala de 1,0 a 10,0) atribuídas pelos clientes às compras do dia.',
        dor: 'Ausência de termômetro sobre a percepção de qualidade do atendimento e dos produtos.'
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
        desc: 'Linha ou produto que registrou a maior receita bruta no dia.',
        dor: 'Dificuldade em identificar rapidamente qual departamento lidera a geração de receita.'
    },
    'pagamentosdigitais': {
        desc: 'Percentual do faturamento transacionado via meios eletrônicos (Pix, Cartão de Crédito e Débito).',
        dor: 'Risco operacional e custos elevados no manuseio de dinheiro em espécie no caixa físico.'
    },
    'divisaogeogrfica': {
        desc: 'Participação percentual e variação de cada praça ou filial no faturamento total do dia selecionado.',
        dor: 'Risco de dependência excessiva do faturamento corporativo em uma única região.'
    },
    'concentraogeogrfica': {
        desc: 'Participação percentual e variação de cada praça ou filial no faturamento total do dia selecionado.',
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

    // 2. Gráficos (1 a 18)
    'vendastotaisporcidade': {
        desc: 'Comparativo de faturamento e volume entre filiais, com indicadores de variação diária.',
        dor: 'Desconhecimento sobre o desempenho individual e o ritmo de crescimento de cada praça.'
    },
    'faturamentoporhora': {
        desc: 'Distribuição temporal da receita e das vendas ao longo de cada hora do dia.',
        dor: 'Dificuldade em compreender a dinâmica do fluxo de caixa e os períodos de pico intra-dia.'
    },
    'faturamentoporhorrio': {
        desc: 'Distribuição temporal da receita e das vendas ao longo de cada hora do dia.',
        dor: 'Dificuldade em compreender a dinâmica do fluxo de caixa e os períodos de pico intra-dia.'
    },
    'categoriasdeprodutos': {
        desc: 'Volume de itens vendidos e receita gerada por cada categoria de produto.',
        dor: 'Falta de clareza sobre o giro de estoque e as categorias com maior aderência de mercado.'
    },
    'volumeporlinhadeproduto': {
        desc: 'Volume de itens vendidos e receita gerada por cada categoria de produto.',
        dor: 'Falta de clareza sobre o giro de estoque e as categorias com maior aderência de mercado.'
    },
    'mtodosdepagamento': {
        desc: 'Receita segmentada pelas diferentes modalidades e canais de pagamento utilizados.',
        dor: 'Ausência de dados concretos para renegociação de taxas operacionais com credenciadoras.'
    },
    'perfildocliente': {
        desc: 'Proporção de compradores segundo o gênero e a categoria de cliente (Normal versus Membro).',
        dor: 'Falta de clareza demográfica para direcionar campanhas e posicionamento de marca.'
    },
    'perfildoconsumidor': {
        desc: 'Proporção de compras realizadas de acordo com o gênero do comprador.',
        dor: 'Falta de clareza demográfica para direcionar campanhas e posicionamento de marca.'
    },
    'faturamentoporgnero': {
        desc: 'Volume financeiro (R$) e representatividade de receita por gênero de cliente.',
        dor: 'Risco de concentrar investimentos de marketing em perfis com alto volume, mas baixo retorno financeiro.'
    },
    'preomdioporlinha': {
        desc: 'Preço médio praticado por unidade em cada linha de produtos (UPV = Faturamento / Quantidade).',
        dor: 'Dificuldade em calibrar a precificação e identificar categorias com margens subvalorizadas.'
    },
    'preomdioporprodutoupv': {
        desc: 'Preço médio praticado por unidade em cada linha de produtos (UPV = Faturamento / Quantidade).',
        dor: 'Dificuldade em calibrar a precificação e identificar categorias com margens subvalorizadas.'
    },
    'turnodiurnovsnoturno': {
        desc: 'Comparativo da receita obtida antes das 18h (Diurno) versus a partir das 18h (Noturno).',
        dor: 'Falta de subsídios analíticos para otimizar escalas de trabalho e turnos de atendimento.'
    },
    'faturamentodiurnovsnoturno': {
        desc: 'Comparativo da receita obtida antes das 18h (Diurno) versus a partir das 18h (Noturno).',
        dor: 'Falta de subsídios analíticos para otimizar escalas de trabalho e turnos de atendimento.'
    },
    'variaodevendasporlinha': {
        desc: 'Comparativo percentual de vendas diárias de cada linha de produto em relação ao dia anterior.',
        dor: 'Detecta quedas bruscas de vendas de forma imediata para correção de preços, reposição ou campanhas de marketing.'
    },
    'variaodedesempenhoporcategoria': {
        desc: 'Comparativo percentual de vendas diárias de cada linha de produto em relação ao dia anterior.',
        dor: 'Detecta quedas bruscas de vendas de forma imediata para correção de preços, reposição ou campanhas de marketing.'
    },
    'curvaabcdeprodutos': {
        desc: 'Classificação dos produtos que representam até 80% do faturamento diário (Classe A), identificando os carros-chefe.',
        dor: 'Evita focar esforços de reposição e marketing em itens secundários, prevenindo falta de estoque nos itens mais rentáveis.'
    },
    'curvaabcdeprodutostopfaturamento': {
        desc: 'Classificação dos produtos que representam até 80% do faturamento diário (Classe A), identificando os carros-chefe.',
        dor: 'Evita focar esforços de reposição e marketing em itens secundários, prevenindo falta de estoque nos itens mais rentáveis.'
    },
    'preomdiovsvolumevendido': {
        desc: 'Cruzamento do preço médio praticado por categoria com o volume total de unidades comercializadas.',
        dor: 'Avalia elasticidade e comprova se promoções e descontos realmente alavancam o faturamento líquido.'
    },
    'comportamentoportipodecliente': {
        desc: 'Participação do faturamento de membros do programa de fidelidade comparado a clientes normais em cada linha.',
        dor: 'Permite calibrar campanhas de retenção e benefícios exclusivos para o público mais fiel em cada setor.'
    },
    'adesodemembrosforcategoria': {
        desc: 'Participação do faturamento de membros do programa de fidelidade comparado a clientes casuais em cada linha.',
        dor: 'Permite calibrar campanhas de retenção e benefícios exclusivos para o público mais fiel em cada setor.'
    },
    'turnosdevendaporcategoria': {
        desc: 'Distribuição da receita gerada por cada categoria nos turnos da Manhã, Tarde e Noite.',
        dor: 'Otimiza escalas da equipe de vendas e viabiliza promoções relâmpago nos horários de menor movimento.'
    },
    'avaliaomdiaporlinha': {
        desc: 'Média de satisfação dos clientes (escala de 1 a 10) segmentada por linha de produto comercializada.',
        dor: 'Identifica departamentos com problemas de qualidade, atendimento ou devoluções antes que afetem a reputação da loja.'
    },
    'avaliaomdiaratingporlinha': {
        desc: 'Média de satisfação dos clientes (escala de 1 a 10) segmentada por linha de produto comercializada.',
        dor: 'Identifica departamentos com problemas de qualidade, atendimento ou devoluções antes que afetem a reputação da loja.'
    },
    'meiosdepagamentoporcategoria': {
        desc: 'Métodos de pagamento (Pix, Cartão, Débito) preferidos pelos clientes em cada linha de produto.',
        dor: 'Auxilia na estratégia de incentivo ao Pix em linhas de margem apertada e negociação de taxas de cartão.'
    },
    'densidadedacestadecompras': {
        desc: 'Média e quantidade máxima de itens comprados em um único cupom para cada departamento da loja.',
        dor: 'Oferece base de dados sólida para criação de combos promocionais e técnicas de cross-selling no caixa.'
    },
    'mixdecategoriasporcidade': {
        desc: 'Volume de vendas e faturamento de cada categoria de produto em cada praça ou filial regional.',
        dor: 'Evita alocação inadequada de estoque entre praças com perfis de consumo e preferências distintas.'
    },
    'ritmodesadaburnratetopprodutos': {
        desc: 'Velocidade diária de unidades vendidas por produto e projeção de necessidade de reposição para 30 dias.',
        dor: 'Elimina o achismo na compra com fornecedores, evitando ruptura de gôndola e dinheiro parado em excesso de estoque.'
    },

    // 3. Seções e Alertas
    'alertasimportantesdodia': {
        desc: 'Painel inteligente que destaca anomalias críticas, metas batidas e destaques diários.',
        dor: 'Sobrecarga de tempo gasto procurando problemas manualmente nos relatórios diários.'
    },
    'insightsealertasautomticos': {
        desc: 'Motor analítico de regras que monitora metas, anomalias e variações operacionais críticas.',
        dor: 'Sobrecarga cognitiva ao auditar manualmente múltiplos relatórios e indicadores dispersos.'
    }
};

function inicializarHelpers() {
    const targetElements = document.querySelectorAll('.kpi-info h3, .chart-header h3, .section-title h2');
    
    targetElements.forEach(el => {
        // Evita reinjetar múltiplos botões
        const existingBtn = el.querySelector('.helper-btn');
        if (existingBtn) return;

        // Limpar o texto de acentos e caracteres especiais para casar perfeitamente
        const rawText = (el.textContent || "").trim();
        const cleanKey = rawText.replace(/[^a-zA-Z]/g, '').toLowerCase();
        
        // Tentar encontrar mapping exato ou parcial
        let mapping = helperMappings[cleanKey];
        
        if (!mapping) {
            // Tentar busca por substring/inclusão
            const matchedKey = Object.keys(helperMappings).find(k => cleanKey.includes(k) || k.includes(cleanKey));
            if (matchedKey) {
                mapping = helperMappings[matchedKey];
            }
        }
        
        // Fallback dinâmico: se houver subtítulo ou descrição associada no card
        const subtitleEl = el.closest('.chart-header')?.querySelector('.chart-subtitle, p') || el.closest('.kpi-info')?.querySelector('.kpi-variation');
        const descTexto = mapping?.desc || (subtitleEl ? subtitleEl.textContent.trim() : `Métrica analítica de ${rawText}.`);
        const dorTexto = mapping?.dor || 'Permite o acompanhamento preciso das operações diárias e tomada de decisão estratégica.';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'helper-btn';
        btn.dataset.helperKey = cleanKey;
        btn.dataset.title = rawText;
        btn.dataset.customDesc = descTexto;
        btn.dataset.customDor = dorTexto;
        btn.title = 'Ver explicação';
        btn.textContent = '?';
        btn.setAttribute('aria-label', `Informações sobre ${rawText}`);
        el.appendChild(btn);
    });
}

/* --- SISTEMA GLOBAL DE POPOVER & MODAL TOUCH (DESKTOP, NOTEBOOK, ANDROID E IOS) --- */
let helperHideTimeout = null;

function adaptarTextoPorPeriodo(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    
    const tipo = periodoAtual.type || 'daily';
    
    if (tipo === 'weekly') {
        return texto
            .replace(/na data selecionada/gi, 'no período de 7 dias selecionado')
            .replace(/no dia selecionado/gi, 'nos últimos 7 dias')
            .replace(/do dia selecionado/gi, 'dos últimos 7 dias')
            .replace(/ao dia anterior/gi, 'aos 7 dias anteriores')
            .replace(/do dia anterior/gi, 'do período anterior')
            .replace(/frente ao dia anterior/gi, 'frente aos 7 dias anteriores')
            .replace(/em relação ao dia anterior/gi, 'em relação aos 7 dias anteriores')
            .replace(/ao longo do dia/gi, 'ao longo dos 7 dias')
            .replace(/às compras do dia/gi, 'às compras do período semanal')
            .replace(/no dia/gi, 'no período semanal')
            .replace(/do dia/gi, 'da semana')
            .replace(/receita financeira diária/gi, 'receita financeira semanal')
            .replace(/saída de estoque diário/gi, 'saída de estoque semanal')
            .replace(/diária/gi, 'semanal')
            .replace(/diário/gi, 'semanal');
    } else if (tipo === 'monthly') {
        return texto
            .replace(/na data selecionada/gi, 'no período de 30 dias selecionado')
            .replace(/no dia selecionado/gi, 'nos últimos 30 dias')
            .replace(/do dia selecionado/gi, 'dos últimos 30 dias')
            .replace(/ao dia anterior/gi, 'aos 30 dias anteriores')
            .replace(/do dia anterior/gi, 'do mês anterior')
            .replace(/frente ao dia anterior/gi, 'frente aos 30 dias anteriores')
            .replace(/em relação ao dia anterior/gi, 'em relação aos 30 dias anteriores')
            .replace(/ao longo do dia/gi, 'ao longo dos 30 dias')
            .replace(/às compras do dia/gi, 'às compras do período mensal')
            .replace(/no dia/gi, 'no período mensal')
            .replace(/do dia/gi, 'do mês')
            .replace(/receita financeira diária/gi, 'receita financeira mensal')
            .replace(/saída de estoque diário/gi, 'saída de estoque mensal')
            .replace(/diária/gi, 'mensal')
            .replace(/diário/gi, 'mensal');
    } else if (tipo === 'custom') {
        const intervalo = (periodoAtual.startDate && periodoAtual.endDate) 
            ? ` (${formatarDataBR(periodoAtual.startDate)} a ${formatarDataBR(periodoAtual.endDate)})`
            : '';
        return texto
            .replace(/na data selecionada/gi, `no período selecionado${intervalo}`)
            .replace(/no dia selecionado/gi, `no período selecionado${intervalo}`)
            .replace(/do dia selecionado/gi, 'do período selecionado')
            .replace(/ao dia anterior/gi, 'ao período anterior equivalente')
            .replace(/do dia anterior/gi, 'do período anterior equivalente')
            .replace(/frente ao dia anterior/gi, 'frente ao período anterior equivalente')
            .replace(/em relação ao dia anterior/gi, 'em relação ao período anterior equivalente')
            .replace(/ao longo do dia/gi, 'ao longo do período selecionado')
            .replace(/às compras do dia/gi, 'às compras do período selecionado')
            .replace(/no dia/gi, 'no período selecionado')
            .replace(/do dia/gi, 'do período')
            .replace(/receita financeira diária/gi, 'receita financeira do período')
            .replace(/saída de estoque diário/gi, 'saída de estoque do período')
            .replace(/diária/gi, 'do período')
            .replace(/diário/gi, 'do período');
    }
    
    return texto;
}

function exibirHelperGlobal(btnElement) {
    clearTimeout(helperHideTimeout);
    
    const helperKey = btnElement.dataset.helperKey;
    const alertKey = btnElement.dataset.alertKey;
    
    let desc = btnElement.dataset.customDesc || '';
    let dor = btnElement.dataset.customDor || '';
    let title = btnElement.dataset.title || 'Informação';
    let label = 'O QUE É';
    
    if (helperKey && helperMappings[helperKey]) {
        desc = helperMappings[helperKey].desc;
        dor = helperMappings[helperKey].dor;
    } else if (alertKey) {
        // Encontrar o alerta por match exato ou por palavras-chave
        const alertaDef = alertasGlossario.find(a => alertKey.includes(a.key) || a.key.includes(alertKey));
        if (alertaDef) {
            desc = alertaDef.desc;
            dor = alertaDef.dor;
            title = alertaDef.title;
            label = 'POR QUE AVISAMOS?';
        }
    }
    
    if (!desc) return;

    // Adaptar dinamicamente os termos de período (diário, 7 dias, 30 dias, personalizado)
    desc = adaptarTextoPorPeriodo(desc);
    dor = adaptarTextoPorPeriodo(dor);

    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // Smartphone (Android / iOS): abre bottom-sheet seguro e touch-friendly
        const modal = document.getElementById('helper-mobile-modal');
        const titleEl = document.getElementById('helper-mobile-title');
        const descEl = document.getElementById('helper-mobile-desc');
        const painEl = document.getElementById('helper-mobile-pain');
        
        if (modal && titleEl && descEl && painEl) {
            titleEl.textContent = title;
            descEl.textContent = desc;
            painEl.textContent = dor;
            modal.classList.add('show');
            document.body.style.overflow = 'hidden'; // Trava scroll de fundo
        }
    } else {
        // Desktop / Notebook: posiciona popover flutuante no body sem cortes
        const popover = document.getElementById('global-helper-popover');
        const descEl = document.getElementById('global-helper-desc');
        const painEl = document.getElementById('global-helper-pain');
        const headerTitleEl = popover.querySelector('.helper-popover-title');
        
        if (headerTitleEl) headerTitleEl.textContent = label;
        if (descEl) descEl.textContent = desc;
        if (painEl) painEl.textContent = dor;
        
        // Calcular posição no viewport
        const rect = btnElement.getBoundingClientRect();
        const popoverWidth = 280;
        
        // Posição horizontal centralizada com clamp nas bordas da tela
        let left = rect.left + (rect.width / 2) - (popoverWidth / 2);
        if (left < 15) left = 15;
        if (left + popoverWidth > window.innerWidth - 15) {
            left = window.innerWidth - popoverWidth - 15;
        }
        
        popover.style.left = `${left}px`;
        popover.classList.add('show');
        
        const popoverHeight = popover.offsetHeight || 160;
        
        // Posição vertical: se estiver muito perto do topo do viewport, abre para baixo
        if (rect.top < popoverHeight + 20) {
            popover.style.top = `${rect.bottom + 8}px`;
            popover.style.bottom = 'auto';
        } else {
            popover.style.top = `${rect.top - popoverHeight - 8}px`;
            popover.style.bottom = 'auto';
        }
    }
}

function ocultarHelperGlobal() {
    helperHideTimeout = setTimeout(() => {
        const popover = document.getElementById('global-helper-popover');
        if (popover) popover.classList.remove('show');
    }, 150);
}

function fecharHelperMobile(event) {
    if (event && event.target && event.target.closest('.helper-mobile-sheet') && !event.target.closest('.helper-mobile-close')) {
        return; // Não fecha se clicou no conteúdo da folha
    }
    const modal = document.getElementById('helper-mobile-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// Event delegation global para todos os botões de ajuda
document.addEventListener('mouseover', e => {
    const btn = e.target.closest('.helper-btn');
    if (btn && window.innerWidth > 768) {
        exibirHelperGlobal(btn);
    }
});

document.addEventListener('mouseout', e => {
    const btn = e.target.closest('.helper-btn');
    if (btn && window.innerWidth > 768) {
        ocultarHelperGlobal();
    }
});

document.addEventListener('click', e => {
    const btn = e.target.closest('.helper-btn');
    if (btn) {
        e.preventDefault();
        e.stopPropagation();
        exibirHelperGlobal(btn);
    } else if (!e.target.closest('.global-helper-popover')) {
        const popover = document.getElementById('global-helper-popover');
        if (popover) popover.classList.remove('show');
    }
});

window.addEventListener('scroll', () => {
    const popover = document.getElementById('global-helper-popover');
    if (popover && popover.classList.contains('show') && window.innerWidth > 768) {
        popover.classList.remove('show');
    }
}, { passive: true });

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
