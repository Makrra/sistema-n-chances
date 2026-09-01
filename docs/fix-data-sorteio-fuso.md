# Fix: data do sorteio aparecia um dia antes nos cards

Correção em `worker/public/index.html` (painel admin). Bug pré-existente,
encontrado ao validar a mensagem da campanha de oferta
(`docs/oferta-bolao-whatsapp.md`), onde a data gerada divergia da mostrada no
card do mesmo bolão.

## Sintoma

O card da lista de bolões mostrava a data do sorteio **um dia antes** da
cadastrada. Quando a data caía no primeiro dia do mês, mudava também o mês:

| `data_sorteio` no banco | Exibido no card | Correto |
|---|---|---|
| `2026-08-20` | 19/08/2026 | 20/08/2026 |
| `2026-08-01` | **31/07/2026** | 01/08/2026 |

## Causa

```js
const fmtData = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
```

`new Date('2026-08-20')` — string de data **sem horário** — é interpretada pelo
JS como meia-noite **UTC**. Convertida para o fuso local (UTC-3), vira
`2026-08-19T21:00`, e o dia retrocede.

Isso não afetava os timestamps ISO completos (`criado_em`, `pago_em`,
`comprovante_enviado_em`, `oferta_enviada_em`, `processado_em`), que carregam
horário e fuso — para esses, a conversão para o fuso local é justamente o
comportamento desejado.

## Por que só os cards

`fmtDataCurta` e `fmtDataExtenso` já contornavam o problema (a primeira faz
split da string, a segunda concatena `T00:00:00` para forçar leitura local), e
a página pública (`jogos-e-resultado.html`) tem a sua própria `fmtData`, que já
fazia `slice(0,10).split('-')`. Ou seja: o texto de divulgação em grupo, a
mensagem de comprovante e a página que o cliente vê sempre mostraram a data
certa — só o painel do organizador divergia, o que tornava o bug fácil de
passar despercebido.

## Correção

`fmtData` passa a distinguir os dois formatos:

```js
const fmtData = d => {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;   // data pura: sem passar por Date()
  return new Date(d).toLocaleDateString('pt-BR');  // timestamp: converte p/ fuso local
};
```

Uma correção que simplesmente concatenasse `T00:00:00` em tudo teria quebrado
os timestamps; por isso a detecção de formato.

## Verificação

- Os 4 bolões da base local passaram a bater exatamente com `data_sorteio` do
  banco, incluindo o caso de virada de mês (`2026-08-01`).
- Timestamps preservados: `2026-08-20T12:00:00Z` → 20/08 e
  `2026-08-20T02:00:00Z` → 19/08 (correto em UTC-3, madrugada UTC ainda é o dia
  anterior no Brasil).
- Telas de Pagamentos Pendentes ("Cadastrado em") e Extrato conferidas contra o
  valor da API — sem alteração.
- `null` / `''` / `undefined` continuam retornando `—`.
