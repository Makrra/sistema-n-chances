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
-- Aplicado apenas nas tabelas financeiras NOVAS (100% controladas por este app).
-- 'boloes' e 'usuarios' NÃO foram alteradas aqui de propósito: já existiam antes
-- deste projeto e podem ser usadas por outras integrações (ex: bot do WhatsApp/n8n)
-- com a anon key sem login. Avalie separadamente antes de restringi-las.
ALTER TABLE participacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE extrato       ENABLE ROW LEVEL SECURITY;
ALTER TABLE saques        ENABLE ROW LEVEL SECURITY;

-- Remove políticas abertas antigas, se existirem (apenas das tabelas novas)
DROP POLICY IF EXISTS "allow_all_participacoes" ON participacoes;
DROP POLICY IF EXISTS "allow_all_extrato"       ON extrato;
DROP POLICY IF EXISTS "allow_all_saques"        ON saques;
-- NÃO mexemos em policies de boloes/usuarios (ver comentário acima)

-- Apenas usuários autenticados (logados no app) podem ler/escrever
CREATE POLICY "auth_only_participacoes" ON participacoes FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_only_extrato" ON extrato FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_only_saques" ON saques FOR ALL
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- 7. VIEW: saldo por cliente (soma do extrato)
DROP VIEW IF EXISTS saldo_clientes;
CREATE VIEW saldo_clientes AS
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
