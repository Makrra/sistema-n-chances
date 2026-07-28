-- Schema inicial D1 (SQLite) — migração de Supabase/Postgres.
-- Ver plano completo em: C:\Users\neyds\.claude\plans\synthetic-growing-patterson.md
--
-- Decisões de tipo:
--   * IDs: TEXT (crypto.randomUUID() gerado no Worker)
--   * Timestamps: TEXT ISO 8601, escrito explicitamente pelo Worker
--   * Dinheiro: INTEGER em centavos (elimina bug de arredondamento float)
--   * Cotas: INTEGER em meias-cotas (cotas_meias; 1 cota inteira = 2)
--   * telefone é PK física de usuarios, com FK ON UPDATE CASCADE nas
--     tabelas dependentes (corrige troca de telefone sem cascade do Postgres)

CREATE TABLE usuarios (
  telefone       TEXT PRIMARY KEY,
  nome_completo  TEXT NOT NULL,
  apelido        TEXT,
  email          TEXT,
  saldo_centavos INTEGER NOT NULL DEFAULT 0,   -- materializado a partir de extrato
  criado_em      TEXT NOT NULL
);

CREATE TABLE boloes (
  id                            TEXT PRIMARY KEY,
  nome                          TEXT,
  loteria                       TEXT,
  tipo_sorteio                  TEXT,
  concurso                      INTEGER,
  data_sorteio                  TEXT NOT NULL,
  valor_cota_inteira_centavos   INTEGER NOT NULL DEFAULT 0,
  valor_cota_meia_centavos      INTEGER NOT NULL DEFAULT 0,
  quantidade_cotas              INTEGER,
  cotas_disponiveis             INTEGER,        -- não usada pelo app hoje; mantida por decisão do usuário
  custo_centavos                INTEGER NOT NULL DEFAULT 0,
  premio_concurso_centavos      INTEGER,        -- não usada pelo app hoje; mantida por decisão do usuário
  premio_ganho_centavos         INTEGER NOT NULL DEFAULT 0,
  divisao_lucro                 TEXT,           -- tipo original desconhecido (sem CREATE TABLE no repo); não usada hoje
  observacao                    TEXT,
  premio_estimado                TEXT,
  jogos_descricao                TEXT,
  status                        TEXT NOT NULL DEFAULT 'ABERTO'
                                   CHECK (status IN ('ABERTO','FECHADO','SORTEADO')),
  criado_em                     TEXT NOT NULL
);

CREATE TABLE participacoes (
  id                            TEXT PRIMARY KEY,
  bolao_id                      TEXT NOT NULL REFERENCES boloes(id) ON DELETE CASCADE,
  telefone                      TEXT NOT NULL REFERENCES usuarios(telefone)
                                   ON UPDATE CASCADE ON DELETE RESTRICT,
  cotas_meias                   INTEGER NOT NULL DEFAULT 2,
  valor_total_centavos          INTEGER NOT NULL DEFAULT 0,
  status_pagamento              TEXT NOT NULL DEFAULT 'pendente'
                                   CHECK (status_pagamento IN ('pendente','pago','cancelado')),
  pago_em                       TEXT,
  criado_em                     TEXT NOT NULL,
  forma_pagamento                TEXT NOT NULL DEFAULT 'pix'
                                   CHECK (forma_pagamento IN ('pix','saldo','misto')),
  posicao                       INTEGER,
  valor_saldo_usado_centavos    INTEGER NOT NULL DEFAULT 0,
  comprovante_enviado_em         TEXT,
  UNIQUE (bolao_id, telefone)
);
CREATE INDEX idx_participacoes_bolao    ON participacoes(bolao_id);
CREATE INDEX idx_participacoes_telefone ON participacoes(telefone);

CREATE TABLE extrato (
  id             TEXT PRIMARY KEY,
  telefone       TEXT NOT NULL REFERENCES usuarios(telefone)
                    ON UPDATE CASCADE ON DELETE RESTRICT,
  tipo           TEXT NOT NULL CHECK (tipo IN ('credito','debito','premio','saque')),
  valor_centavos INTEGER NOT NULL,
  descricao      TEXT,
  bolao_id       TEXT REFERENCES boloes(id) ON DELETE CASCADE,  -- CASCADE real, corrige gap do Postgres
  criado_em      TEXT NOT NULL
);
CREATE INDEX idx_extrato_telefone ON extrato(telefone);
CREATE INDEX idx_extrato_bolao    ON extrato(bolao_id);

CREATE TABLE saques (
  id             TEXT PRIMARY KEY,
  telefone       TEXT NOT NULL REFERENCES usuarios(telefone)
                    ON UPDATE CASCADE ON DELETE RESTRICT,
  valor_centavos INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','aprovado','pago','rejeitado')),
  chave_pix      TEXT,
  observacao     TEXT,
  criado_em      TEXT NOT NULL,
  processado_em  TEXT
);
CREATE INDEX idx_saques_status ON saques(status);
