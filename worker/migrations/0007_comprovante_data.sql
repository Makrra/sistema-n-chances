-- Data em que o comprovante/aposta foi realizado, complementando número e
-- horário (0006) — mesma tabela, mesmo motivo (metadado 1:1 por bolão sobre
-- como/quando os jogos foram registrados, mostrado no admin e na página
-- pública via serializeEstrategia).
ALTER TABLE bolao_estrategias ADD COLUMN comprovante_data TEXT;
