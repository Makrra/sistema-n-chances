# Sessão: Compartilhar bolão no WhatsApp + Replicar bolão

Registro da sessão de 2026-08-14 em `worker/public/index.html` (painel admin) e
`worker/src/routes/boloes.js` / `worker/src/lib/serializers.js` (API). Duas
funcionalidades novas no fluxo de bolões, decididas via brainstorming antes da
implementação.

## 1. Compartilhar bolão formatado no WhatsApp

### Motivação

O organizador já tinha um botão "📲 Compartilhar link no WhatsApp" (modal de Jogos), mas
ele só monta um link `wa.me` com uma frase fixa + link público — não gera o texto
formatado completo (prêmio, cotas, valores, jogos etc.) que o organizador manda
manualmente hoje no grupo. Modelo de referência (mensagem real usada pelo organizador):

```
🟠 LOTOMANIA ACUMULADA

12/08/26 (HOJE) 🥶

Concurso: 2962
Prêmio: 10,5M 💰
Quant Cotas: 20 cotistas

Cota Meia: 7,00 R$ 💵
Premiação: 262k 🤑

Cota Inteira: 13,00 R$ 💵
Premiação: 525k 🤑

> 70 jogos 50 Números

🔗 Bolões e Jogos disponíveis no link abaixo.
👇👇👇👇👇
https://nchances.com.br/jogos_e_resultado/

O pix é o:
👇👇👇
pix@nchances.com.br

Obs.: A divisão dos lucros é um valor estimado...

Joguem com consciência
```

### Decisões (brainstorming com o usuário)

- **Chave PIX**: fixa no código (`pix@nchances.com.br`), não é um campo configurável por
  bolão.
- **Envio ao grupo**: só "Copiar mensagem" (`navigator.clipboard.writeText`) — sem tentar
  abrir o WhatsApp com o texto, já que `wa.me` não permite mirar um grupo específico
  (o organizador cola manualmente). O botão antigo de link continua existindo, sem mudança.
- **Cabeçalho ("🟠 LOTOMANIA ACUMULADA")**: gerado 100% automático a partir de
  `LOTERIA_LABEL` (já tem emoji + nome em caixa alta) e `TIPO_SORTEIO_LABEL` (campo "Tipo de
  Sorteio" que já existia no cadastro — `acumulado`→"ACUMULADA" etc.), sem campo novo.
- **"(HOJE)"**: automático, comparando `data_sorteio` com a data local do dia. O emoji de
  humor (🥶) do exemplo **não** é reproduzido — não dá pra automatizar "humor", ficaria
  sempre igual e destoaria do resto.
- **Premiação por cota** ("Premiação: 525k" / "262k"): o campo `premio_estimado` já
  existente é texto livre (ex. "10,5M"), então não dava pra calcular a partir dele. Foi
  criado um **novo campo numérico opcional**, `premio_estimado_valor` (armazenado como
  `premio_estimado_valor_centavos` — migration `0008_premio_estimado_valor.sql`), usado só
  para esse cálculo (`premio_estimado_valor ÷ quantidade_cotas`, meia = metade). Se não for
  preenchido, as linhas de "Premiação" saem do texto (nunca mostra conta errada). O campo de
  texto `premio_estimado` continua sendo o exibido nas outras telas — nada mudou lá.
- **Negrito**: por pedido do usuário numa iteração seguinte, valores/frases de destaque
  (cabeçalho, data, concurso, prêmio, cotas, valores de cota, premiação por cota, chave pix,
  "Joguem com consciência") são envolvidos em `*asteriscos*` — sintaxe de negrito do
  WhatsApp.

### Implementação

- `textoCompartilhamentoBolao(b, linkPublico)` em `index.html` monta o texto completo.
- Helpers novos: `fmtReaisSufixo` (formato "7,00 R$", sufixo em vez de prefixo — diferente
  do `fmtMoeda` já existente), `fmtDataCurta`/`dataHojeStr` (dd/mm/aa sem passar por
  `Date()`, evita bug de fuso horário) e `fmtValorAbreviado` (10500000 → "10,5M", 525000 →
  "525k").
- Botão "📋 Copiar mensagem para o grupo" no modal de Jogos (`copiarTextoCompartilhamento()`),
  ao lado do botão de link já existente.

## 2. Replicar bolão

### Motivação

Não existia forma de duplicar um bolão — todo bolão novo precisava ser digitado do zero,
mesmo quando é essencialmente o mesmo jogo/estratégia do concurso anterior.

### Decisões (brainstorming com o usuário)

- Botão "🔁 Replicar" no modal de detalhe do bolão (ao lado de Editar/Excluir).
- Reaproveita o modal "Novo Bolão" já existente, pré-preenchido com **todos** os campos do
  bolão de origem — incluindo concurso e data (o usuário pediu explicitamente, em vez de
  deixar em branco, já que muitas vezes só muda 1 dígito) e o **custo do bolão** (ajuste
  numa iteração seguinte, mesmo raciocínio). Tudo fica editável antes de salvar.
- Ao clicar "Criar Bolão" vindo desse fluxo, além de criar o registro, `jogos` e
  `bolao_estrategias` (tipo, dezenas_base, descrição) do bolão de origem são copiados para o
  novo via as rotas já existentes (`PUT /boloes/:id/jogos` e `/estrategia`).
- **Comprovante** (número/horário/data da aposta) **não** é copiado — é específico da aposta
  original, sempre fica em branco no novo bolão.

### Implementação

- `replicarBolao(id)` preenche o form `nb-*` e guarda o id de origem em
  `replicarOrigemId` (variável de estado global).
- `criarBolao()`, depois de criar o bolão, chama `copiarJogosEstrategia(origemId, destinoId)`
  se `replicarOrigemId` estiver setado; a variável é limpa depois (e também ao cancelar o
  modal ou abrir "Novo Bolão" pelo botão "+", pra não vazar estado entre fluxos).

## 3. Estado final / deploy

- Migration `0008_premio_estimado_valor.sql` (`ALTER TABLE boloes ADD COLUMN
  premio_estimado_valor_centavos INTEGER`) aplicada em local, staging
  (`n-chances-db-staging`) e produção (`n-chances-db-prod`).
- `wrangler deploy --env staging` e depois `--env production` executados — ambos os
  ambientes já com as duas funcionalidades e os ajustes de custo pré-preenchido / negrito.
- Testado via preview local (`wrangler dev`) antes de cada deploy: pré-preenchimento do
  form de replicar, cópia de jogos/estratégia sem comprovante, e texto gerado batendo com o
  modelo do organizador (pequena diferença de arredondamento aceitável: R$1 entre "263k"
  calculado e "262k" do exemplo original).

**Atenção para quem for mexer aqui de novo**: como já registrado em
`docs/destaque-acertos-e-web-analytics.md`, `wrangler deploy`/`d1 migrations apply`
**sem** `--env` mira o ambiente placeholder de dev local e falha contra o banco remoto —
sempre usar `--env staging` ou `--env production`.
