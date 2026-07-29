-- Adiciona SURPRESINHA como tipo de estratégia válido (números gerados pelo
-- terminal, sem escolha do apostador — distinto de SIMPLES, que já é usado
-- pra "jogos avulsos, sem técnica" escolhidos manualmente).
--
-- SQLite não permite ALTER de CHECK constraint diretamente — recria a
-- tabela seguindo o padrão recomendado (novo nome, copia dados, dropa a
-- antiga, renomeia). Tabela é recente (migração 0004) e sem dado real
-- ainda em produção, mas o padrão é seguro de qualquer forma.
CREATE TABLE bolao_estrategias_new (
  bolao_id      TEXT PRIMARY KEY REFERENCES boloes(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'SIMPLES'
                   CHECK (tipo IN ('SIMPLES','DESDOBRAMENTO','FECHAMENTO','SURPRESINHA')),
  dezenas_base  TEXT,
  descricao     TEXT,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT
);
INSERT INTO bolao_estrategias_new SELECT * FROM bolao_estrategias;
DROP TABLE bolao_estrategias;
ALTER TABLE bolao_estrategias_new RENAME TO bolao_estrategias;
