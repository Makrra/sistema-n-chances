-- ============================================================
-- SETUP SISTEMA DE BOLOES - N-Chances
-- Execute no SQL Editor do Supabase Dashboard
-- ============================================================

-- 1. Adicionar colunas novas em BOLOES (apenas as que não existiam)
ALTER TABLE boloes
  ADD COLUMN IF NOT EXISTS nome       TEXT,
  ADD COLUMN IF NOT EXISTS observacao TEXT;

-- Remove colunas duplicadas criadas por engano (a tabela já tinha
-- valor_cota_inteira, valor_cota_meia, quantidade_cotas, premio_concurso)
ALTER TABLE boloes
  DROP COLUMN IF EXISTS valor_cota,
  DROP COLUMN IF EXISTS valor_meia_cota,
  DROP COLUMN IF EXISTS total_cotas,
  DROP COLUMN IF EXISTS premio_total;

-- Colunas existentes usadas pelo app:
--   valor_cota_inteira, valor_cota_meia, quantidade_cotas,
--   cotas_disponiveis, premio_concurso, premio_ganho, divisao_lucro,
--   tipo_sorteio, concurso, data_sorteio (NOT NULL), status
-- Status possíveis (CHECK constraint, MAIÚSCULAS): 'ABERTO', 'FECHADO', 'SORTEADO'

-- 2. PARTICIPACOES - quem está em qual bolão e se pagou
CREATE TABLE IF NOT EXISTS participacoes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bolao_id         UUID NOT NULL REFERENCES boloes(id) ON DELETE CASCADE,
  telefone         TEXT NOT NULL,   -- FK lógica p/ usuarios.telefone
  cotas            INTEGER NOT NULL DEFAULT 1,
  valor_total      NUMERIC(10,2) NOT NULL DEFAULT 0,
  status_pagamento TEXT NOT NULL DEFAULT 'pendente',  -- 'pendente','pago','cancelado'
  pago_em          TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_participacao UNIQUE (bolao_id, telefone)
);

-- 3. EXTRATO - livro caixa por cliente
CREATE TABLE IF NOT EXISTS extrato (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone    TEXT NOT NULL,
  tipo        TEXT NOT NULL,          -- 'credito','debito','premio','saque'
  valor       NUMERIC(10,2) NOT NULL,
  descricao   TEXT,
  bolao_id    UUID REFERENCES boloes(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. SAQUES - fila de retiradas
CREATE TABLE IF NOT EXISTS saques (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone       TEXT NOT NULL,
  valor          NUMERIC(10,2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendente', -- 'pendente','aprovado','pago','rejeitado'
  chave_pix      TEXT,
  observacao     TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_em  TIMESTAMPTZ
);

-- 5. Índices
CREATE INDEX IF NOT EXISTS idx_participacoes_bolao    ON participacoes(bolao_id);
CREATE INDEX IF NOT EXISTS idx_participacoes_telefone ON participacoes(telefone);
CREATE INDEX IF NOT EXISTS idx_extrato_telefone       ON extrato(telefone);
CREATE INDEX IF NOT EXISTS idx_saques_status          ON saques(status);

-- 6. RLS - exige usuário autenticado via Supabase Auth (login no app)
-- Aplicado nas tabelas financeiras NOVAS e em 'boloes' (100% controladas por este app).
-- 'usuarios' NÃO foi alterada aqui de propósito: é usada por um bot/automação (n8n)
-- com a anon key sem login. Avalie separadamente antes de restringi-la.
ALTER TABLE participacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE extrato       ENABLE ROW LEVEL SECURITY;
ALTER TABLE saques        ENABLE ROW LEVEL SECURITY;
ALTER TABLE boloes        ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas, se existirem (abertas ou de execuções anteriores
-- deste script), para o CREATE POLICY abaixo não dar erro de duplicidade
DROP POLICY IF EXISTS "allow_all_participacoes" ON participacoes;
DROP POLICY IF EXISTS "allow_all_extrato"       ON extrato;
DROP POLICY IF EXISTS "allow_all_saques"        ON saques;
DROP POLICY IF EXISTS "allow_all_boloes"        ON boloes;
DROP POLICY IF EXISTS "auth_only_participacoes" ON participacoes;
DROP POLICY IF EXISTS "auth_only_extrato"       ON extrato;
DROP POLICY IF EXISTS "auth_only_saques"        ON saques;
DROP POLICY IF EXISTS "auth_only_boloes"        ON boloes;
-- NÃO mexemos em policies de usuarios (ver comentário acima)

-- Apenas usuários autenticados (logados no app) podem ler/escrever
CREATE POLICY "auth_only_participacoes" ON participacoes FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_only_extrato" ON extrato FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_only_saques" ON saques FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_only_boloes" ON boloes FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- 7. VIEW: saldo por cliente (soma do extrato)
-- security_invoker = true: a view passa a respeitar a RLS de quem está
-- consultando (e não a do dono da view). Sem isso, qualquer pessoa com a
-- anon key conseguia ler o saldo de TODOS os clientes mesmo sem login,
-- porque a view "ignorava" a RLS da tabela extrato.
DROP VIEW IF EXISTS saldo_clientes;
CREATE VIEW saldo_clientes WITH (security_invoker = true) AS
SELECT
  u.telefone,
  u.nome_completo,
  u.apelido,
  COALESCE(SUM(CASE WHEN e.tipo IN ('credito','premio') THEN e.valor ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN e.tipo IN ('debito','saque')  THEN e.valor ELSE 0 END), 0)
  AS saldo
FROM usuarios u
LEFT JOIN extrato e ON e.telefone = u.telefone
GROUP BY u.telefone, u.nome_completo, u.apelido;

-- 8. Suporte a meia cota (ex: 0.5, 1.5, 2.5...)
-- 'cotas' era INTEGER; passa a aceitar uma casa decimal.
ALTER TABLE participacoes ALTER COLUMN cotas TYPE NUMERIC(6,1) USING cotas::numeric;
ALTER TABLE participacoes ALTER COLUMN cotas SET DEFAULT 1;

-- 9. Custo do bolão (controle interno de lucro)
ALTER TABLE boloes ADD COLUMN IF NOT EXISTS custo NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 10. Forma de pagamento da participação.
-- 'pix'   -> pagamento direto, registrado na participação, NÃO gera débito
--            no extrato (não mexe no saldo do cliente).
-- 'saldo' -> abatido do saldo/crédito do cliente, gera um lançamento de
--            débito no extrato.
ALTER TABLE participacoes ADD COLUMN IF NOT EXISTS forma_pagamento TEXT NOT NULL DEFAULT 'pix';

-- 11. E-mail do cliente (cadastro de novos clientes pelo app)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT;
