-- Valor numérico (opcional) do prêmio estimado, em centavos — complementa o
-- `premio_estimado` em texto livre (ex: "10,5M") já existente, que continua
-- sendo o exibido nas telas. Este novo campo serve só para calcular a
-- premiação estimada por cota na mensagem de compartilhamento no WhatsApp.
ALTER TABLE boloes ADD COLUMN premio_estimado_valor_centavos INTEGER;
