-- Script de criação e população inicial da tabela de vendas no PostgreSQL

-- Criar a tabela 'vendas' caso não exista
CREATE TABLE IF NOT EXISTS vendas (
    invoice_id VARCHAR(50) PRIMARY KEY,
    city VARCHAR(100) NOT NULL,
    customer_type VARCHAR(50) NOT NULL,
    gender VARCHAR(20) NOT NULL,
    product_line VARCHAR(100) NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    quantity INTEGER NOT NULL,
    total NUMERIC(10, 2) NOT NULL,
    time VARCHAR(10) NOT NULL, -- Formato HH:MM
    payment VARCHAR(50) NOT NULL,
    rating NUMERIC(3, 1) NOT NULL,
    data DATE NOT NULL
);

-- Criar índice por data para otimizar as consultas do Dashboard e relatórios
CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas(data);

-- Inserir alguns dados fictícios iniciais para teste (se a tabela estiver vazia)
INSERT INTO vendas (invoice_id, city, customer_type, gender, product_line, unit_price, quantity, total, time, payment, rating, data)
VALUES 
('123-45-6789', 'São Paulo', 'Membro', 'Mulher', 'Acessorios Eletronicos', 120.00, 2, 240.00, '14:30', 'Pix', 9.5, CURRENT_DATE),
('987-65-4321', 'Rio de Janeiro', 'Normal', 'Homem', 'Esportes e Viagens', 85.50, 1, 85.50, '10:15', 'Cartao de Credito', 8.2, CURRENT_DATE),
('456-78-9012', 'Manaus', 'Membro', 'Mulher', 'Saude e Beleza', 45.00, 3, 135.00, '18:45', 'Debito', 7.0, CURRENT_DATE),
('789-01-2345', 'São Paulo', 'Normal', 'Mulher', 'Moda', 60.00, 1, 60.00, '09:20', 'Pix', 8.8, CURRENT_DATE - INTERVAL '1 day'),
('234-56-7890', 'Rio de Janeiro', 'Membro', 'Homem', 'Casa e Estilo de Vida', 150.00, 2, 300.00, '16:10', 'Cartao de Credito', 9.0, CURRENT_DATE - INTERVAL '1 day')
ON CONFLICT (invoice_id) DO NOTHING;
