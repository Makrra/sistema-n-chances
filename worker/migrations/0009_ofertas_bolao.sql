-- Campanha de oferta de bolão (UC: oferecer um bolão ABERTO aos clientes que
-- ainda não têm participação nele, via WhatsApp).
--
-- Rastreia quais clientes já receberam a oferta de qual bolão, para o
-- organizador não abordar a mesma pessoa duas vezes e para medir conversão
-- depois (cruzando com `participacoes`). Mesma ideia do
-- `participacoes.comprovante_enviado_em`, mas aqui o cliente ainda NÃO tem
-- participação — por isso precisa de tabela própria.
--
-- CASCADE nos dois lados: oferta é dado descartável de campanha, não tem
-- valor contábil (diferente de `participacoes`, que usa RESTRICT no cliente
-- justamente para não perder histórico financeiro).
CREATE TABLE ofertas_enviadas (
  bolao_id   TEXT NOT NULL REFERENCES boloes(id) ON DELETE CASCADE,
  telefone   TEXT NOT NULL REFERENCES usuarios(telefone)
                ON UPDATE CASCADE ON DELETE CASCADE,
  enviado_em TEXT NOT NULL,
  PRIMARY KEY (bolao_id, telefone)
);
CREATE INDEX idx_ofertas_bolao ON ofertas_enviadas(bolao_id);

-- Templates de mensagem editáveis pelo organizador. Tabela genérica (chave →
-- corpo) para caber outros templates no futuro; hoje só a chave
-- 'oferta_bolao' é usada. Quando não há linha para a chave, a API devolve o
-- texto padrão embutido no código (lib/templates.js) — a tabela guarda
-- apenas a personalização feita pelo organizador.
CREATE TABLE templates_mensagem (
  chave         TEXT PRIMARY KEY,
  corpo         TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
