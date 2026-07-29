-- Jogos do concurso, estratégia (Desdobramento/Fechamento) e resultado oficial
-- do sorteio, para a página pública do bolão (ver
-- docs/funcionalidade-jogos-resultado-sorteio.md).
--
-- Convenções seguidas (mesmas de 0001_init.sql): IDs TEXT via
-- crypto.randomUUID() gerado no Worker; timestamps TEXT ISO 8601 escritos
-- explicitamente pelo Worker; sem tipo JSON nativo no D1/SQLite — arrays
-- guardados como TEXT contendo JSON, serializados/desserializados no Worker.

CREATE TABLE bolao_estrategias (
  bolao_id      TEXT PRIMARY KEY REFERENCES boloes(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL DEFAULT 'SIMPLES'
                   CHECK (tipo IN ('SIMPLES','DESDOBRAMENTO','FECHAMENTO')),
  dezenas_base  TEXT,           -- JSON: ex. "[1,4,7,12,...]" (opcional)
  descricao     TEXT,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT
);

CREATE TABLE jogos (
  id         TEXT PRIMARY KEY,
  bolao_id   TEXT NOT NULL REFERENCES boloes(id) ON DELETE CASCADE,
  ordem      INTEGER NOT NULL,
  dezenas    TEXT NOT NULL,     -- JSON: ex. "[3,7,15,22,41,44]"
  criado_em  TEXT NOT NULL
);
CREATE INDEX idx_jogos_bolao ON jogos(bolao_id);
CREATE UNIQUE INDEX idx_jogos_bolao_ordem ON jogos(bolao_id, ordem);

CREATE TABLE resultados_sorteio (
  bolao_id          TEXT PRIMARY KEY REFERENCES boloes(id) ON DELETE CASCADE,
  dezenas_sorteadas TEXT NOT NULL,   -- JSON: ex. "[3,9,15,22,41,44]"
  data_apuracao     TEXT,
  premiacoes        TEXT,            -- JSON: [{faixa, acertos_necessarios, ganhadores, valor_rateio_centavos}]
  fonte             TEXT NOT NULL DEFAULT 'manual' CHECK (fonte IN ('manual','api_caixa')),
  criado_em         TEXT NOT NULL,
  atualizado_em     TEXT
);
