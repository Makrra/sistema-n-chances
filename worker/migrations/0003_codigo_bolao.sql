-- Código único do bolão (ex: QN-70750001 = sigla da loteria + concurso +
-- sequência de 4 dígitos que reinicia por loteria+concurso). Gerado pelo
-- Worker na criação (ver worker/src/routes/boloes.js); bolões já existentes
-- (migrados do Supabase) ficam com codigo NULL, sem backfill — não pedido.
ALTER TABLE boloes ADD COLUMN codigo TEXT;
CREATE UNIQUE INDEX idx_boloes_codigo ON boloes(codigo);
