-- Colunas descobertas nos dados reais do Supabase durante a migração (Fase 4)
-- que não são lidas/escritas pelo app hoje, mas têm dados reais de clientes —
-- mantidas por decisão do usuário (mesmo critério já aplicado a
-- cotas_disponiveis/premio_concurso/divisao_lucro em 0001_init.sql).

ALTER TABLE usuarios ADD COLUMN data_nascimento TEXT; -- AAAA-MM-DD

ALTER TABLE boloes ADD COLUMN promocao_percentual REAL;
ALTER TABLE boloes ADD COLUMN atualizado_em TEXT; -- ISO 8601, igual criado_em
