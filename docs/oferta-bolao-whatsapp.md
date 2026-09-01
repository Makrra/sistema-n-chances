# Campanha de oferta de bolão por WhatsApp

Funcionalidade nova em `worker/public/index.html` (painel admin),
`worker/src/routes/ofertas.js`, `worker/src/lib/templates.js` e migration
`0009_ofertas_bolao.sql`. Decidida via brainstorming antes da implementação.

## Motivação

O organizador tinha como divulgar um bolão para o **grupo** (texto formatado
copiado no modal de Jogos — ver `compartilhar-e-replicar-bolao.md`), mas não
tinha nada para abordar **individualmente** quem ainda não comprou cota de um
bolão aberto. Na prática ele precisaria abrir a lista de participantes, comparar
mentalmente com a lista de clientes e mandar mensagem um a um, sem registro de
quem já foi contatado.

## Por que o envio é 1-a-1 (e não em massa)

`wa.me` — o mecanismo que o sistema já usa no botão Comprovante — abre **uma**
conversa por vez; não existe disparo em lote. A alternativa seria a WhatsApp
Cloud API da Meta, descartada porque:

- mensagens de marketing iniciadas pelo negócio exigem **template aprovado pela
  Meta**, o que elimina justamente o requisito de "mensagem que eu possa
  alterar" na hora;
- tem custo por mensagem e risco de bloqueio do número por denúncia de spam.

Decisão: manter o padrão já adotado no projeto (commit `6748d42`, "sem n8n") —
um clique por cliente, com a mensagem já montada e personalizada. O ganho está
em **quem** aparece na lista e em **não perder o controle** de quem já recebeu.

## Segmentação

A lista traz só clientes **sem participação** naquele bolão (o organizador,
`TELEFONE_ORGANIZADOR`, é sempre excluído), ordenados por saldo decrescente —
quem tem dinheiro parado aparece primeiro, porque é a conversa mais fácil.

Cada cliente recebe um segmento, calculado em `routes/ofertas.js`:

| Segmento | Regra |
|---|---|
| `novo` | nunca teve participação **paga** em nenhum bolão |
| `recorrente` | última participação paga há ≤ 30 dias (`DIAS_INATIVIDADE`) |
| `sumido` | já comprou, mas a última compra é mais antiga que isso |

O histórico considera só participações **pagas** de propósito: "nunca comprou"
precisa significar nunca pagou, não "tem uma pendente que nunca virou venda".

O filtro **💳 Com saldo** é ortogonal aos segmentos (um recorrente também pode
ter saldo) e usa `saldo > SALDO_MINIMO_OFERTA` (R$ 2). O corte **não** é o valor
de meia cota, por decisão do organizador: saldo parcial continua sendo argumento
de conversa ("você tem R$ 3 aqui, completa R$ 2 e fecha a meia"). Os R$ 2 servem
só para não poluir a lista com troco de centavos.

## Template de mensagem

Editável no próprio modal e salvo no **servidor** (tabela `templates_mensagem`,
chave `oferta_bolao`), não em `localStorage` — mesmo princípio já registrado no
topo de `lib/negocio.js`: não depender de cache do browser, já que o organizador
alterna entre celular e desktop. O texto padrão vive em `lib/templates.js`;
salvar corpo vazio apaga a personalização e volta ao padrão.

O texto gravado é **um só, global** (não é por bolão): o que estiver salvo é o
que vale em qualquer bolão e em qualquer aparelho, até ser alterado de novo. Um
indicador ao lado do campo mostra em qual dos três estados a mensagem está —
`texto padrão`, `✓ sua mensagem salva` ou `● alterações não salvas` — porque sem
isso não havia como saber, olhando a tela, se o texto no campo já era o que
seria enviado ou uma edição que se perderia ao fechar o modal.

Placeholders suportados por `aplicarTemplate` (client):
`{{nome}}` `{{titulo}}` `{{concurso}}` `{{data_sorteio}}` `{{premio}}`
`{{jogos}}` `{{valor_meia}}` `{{valor_inteira}}` `{{premiacao_meia}}`
`{{premiacao_inteira}}` `{{cotas_restantes}}` `{{saldo}}` `{{link}}`

Blocos condicionais `{{#campo}}...{{/campo}}` são removidos inteiros quando o
dado não existe, e as linhas em branco sobrando são colapsadas (`\n{3,}` →
`\n\n`). Sem isso a mensagem mostraria "você tem R$ 0,00 de saldo" para quem não
tem nada, ou uma linha de "Premiação" vazia. Blocos disponíveis: `saldo`,
`jogos`, `premiacao_meia`, `premiacao_inteira`, `cotas_restantes` e `premiacao`
(este último envolve a ressalva sobre o valor ser estimado).

Origem de cada dado:

- `{{jogos}}` — campo **Jogos do Bolão** (`jogos_descricao`), com cada linha
  prefixada por `> ` (citação do WhatsApp), igual ao texto de grupo.
- `{{premiacao_meia}}` / `{{premiacao_inteira}}` — `premio_estimado_valor ÷
  quantidade_cotas` (meia = metade), abreviado por `fmtValorAbreviado`
  ("8M", "525k"). Mesmo cálculo de `textoCompartilhamentoBolao`. O campo de
  texto `premio_estimado` ("80M") não serve para a conta — por isso existe o
  `premio_estimado_valor` numérico. Sem ele, as linhas de premiação **somem**
  em vez de mostrar conta errada.
- `{{cotas_restantes}}` — `quantidade_cotas - soma das cotas já vendidas`
  (gatilho de escassez); o bloco some em bolão sem quantidade definida.

O texto padrão inclui, junto das premiações, a ressalva de que o valor é
estimado e depende de o jogo alcançar a premiação principal como único
vencedor — mesma obs. já usada no texto de divulgação em grupo. Ela vive dentro
do bloco `{{#premiacao}}`, então só aparece quando há premiação exibida.

## Rastreio de envio

Tabela `ofertas_enviadas (bolao_id, telefone, enviado_em)`, mesma ideia do
`participacoes.comprovante_enviado_em` — mas em tabela própria porque aqui o
cliente ainda **não** tem participação. Comportamento na UI:

- clicar em WhatsApp abre a conversa e marca o envio (atualização otimista,
  igual a `marcarComprovanteEnviado`);
- quem já foi contatado fica esmaecido, ganha ✓ com a data e **vai para o fim da
  lista** — a lista funciona como fila de trabalho;
- "Desmarcar" desfaz o registro (clique errado, ou reabordagem do zero);
- o contador do cabeçalho acompanha os envios sem precisar reabrir o modal.

O par `(bolao_id, telefone)` é PK, então reenviar só atualiza a data. Como o
registro guarda bolão + telefone, dá para medir conversão depois cruzando com
`participacoes` (não implementado ainda — seria a evolução natural).

`ofertas_enviadas` usa `ON DELETE CASCADE` nos dois lados, diferente de
`participacoes` (que usa `RESTRICT` no cliente): oferta é dado descartável de
campanha, não tem valor contábil.

## Rotas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/boloes/:id/ofertas` | candidatos + segmento + saldo + se já recebeu |
| POST | `/api/boloes/:id/ofertas` | marca envio (idempotente) |
| DELETE | `/api/boloes/:id/ofertas/:telefone` | desfaz a marcação |
| GET | `/api/templates/:chave` | corpo salvo, ou o padrão do código |
| PUT | `/api/templates/:chave` | salva; corpo vazio restaura o padrão |

`:chave` é validada contra `TEMPLATES_PADRAO` — a tabela é genérica para caber
outros templates depois, mas a rota não é um key-value store aberto.

## Correção habilitante: editar premiação estimada e jogos

`PUT /api/boloes/:id` **não** atualizava `premio_estimado`,
`premio_estimado_valor_centavos` nem `jogos_descricao` — só o `create` gravava
esses campos, e o modal "Editar Bolão" nem os exibia. Na prática eles só podiam
ser definidos no momento da criação: um bolão já aberto sem premiação estimada
preenchida não tinha como ser corrigido, o que deixaria a oferta (e o texto de
divulgação em grupo) permanentemente sem essas informações.

Corrigido junto com esta funcionalidade: os três campos foram adicionados ao
form de edição (`eb-premio-estimado`, `eb-premio-estimado-valor`,
`eb-jogos-descricao`), a `abrirEditarBolao`/`salvarEdicaoBolao` e ao `UPDATE`
da rota. O comportamento de "campo vazio → NULL" segue o mesmo do `create`.

## Detalhe de implementação que não é óbvio

`enviarOferta` chama `window.open` **antes** de qualquer `await`. Se houvesse um
`await` antes, o browser deixaria de tratar a abertura como resultado direto do
clique e bloquearia como popup. O registro no servidor vai depois, em background.

## Estado / deploy

- Migration `0009_ofertas_bolao.sql` aplicada em **local** e **staging**.
  Ainda **não** aplicada em produção.
- `wrangler deploy --env staging` executado.
- Testado via `wrangler dev`: os 4 segmentos, filtro de saldo, blocos
  condicionais (com e sem jogos/premiação/saldo), cálculo da premiação por cota,
  persistência do template, marcação/desmarcação de envio, edição dos campos
  novos do bolão, e layout em viewport mobile (375px).

**Atenção**, como já registrado nos outros docs: `wrangler deploy` e
`d1 migrations apply` **sem** `--env` miram o ambiente placeholder de dev local
— sempre usar `--env staging` ou `--env production`.
