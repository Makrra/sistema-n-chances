-- Número do comprovante da aposta (registrado na casa lotérica) e horário em
-- que os jogos foram realizados — mesma tabela da estratégia porque é
-- metadado 1:1 por bolão sobre como/quando os jogos foram registrados,
-- mostrado tanto no admin quanto na página pública (ver serializeEstrategia).
ALTER TABLE bolao_estrategias ADD COLUMN comprovante_numero TEXT;
ALTER TABLE bolao_estrategias ADD COLUMN comprovante_horario TEXT;
