// Templates de mensagem editáveis pelo organizador (tabela
// `templates_mensagem`). Este arquivo guarda só os textos PADRÃO — o corpo
// salvo pelo organizador sempre tem precedência; o padrão é o que aparece na
// primeira vez e o que o botão "Restaurar padrão" devolve.

export const CHAVES_TEMPLATE = ['oferta_bolao'];

// Oferta pessoal de um bolão ABERTO para quem ainda não comprou cota nele.
// Diferente do texto de divulgação em grupo (textoCompartilhamentoBolao, no
// index.html): aqui a mensagem é 1-a-1, começa pelo nome e usa o saldo do
// cliente como argumento.
//
// Placeholders suportados (ver aplicarTemplate no index.html):
//   {{nome}} {{titulo}} {{concurso}} {{data_sorteio}} {{premio}}
//   {{valor_meia}} {{valor_inteira}} {{premiacao_meia}} {{premiacao_inteira}}
//   {{jogos}} {{cotas_restantes}} {{saldo}} {{link}}
//
// Blocos condicionais {{#campo}}...{{/campo}}, removidos quando o dado não
// existe: {{#saldo}} (cliente sem saldo), {{#premiacao_meia}} /
// {{#premiacao_inteira}} / {{#premiacao}} (bolão sem prêmio estimado numérico
// cadastrado), {{#jogos}} (bolão sem descrição de jogos) e
// {{#cotas_restantes}} (bolão sem quantidade de cotas definida).
export const TEMPLATE_OFERTA_BOLAO = `Opa, {{nome}}! Tudo certo? 👋

Separei uma cota pra você no *{{titulo}}*:

Concurso: *{{concurso}}*
Sorteio: *{{data_sorteio}}*
Prêmio: *{{premio}}* 💰
{{#jogos}}
Nossos jogos:
{{jogos}}
{{/jogos}}
Cota Meia: *{{valor_meia}}* 💵{{#premiacao_meia}}
Premiação: *{{premiacao_meia}}* 🤑{{/premiacao_meia}}

Cota Inteira: *{{valor_inteira}}* 💵{{#premiacao_inteira}}
Premiação: *{{premiacao_inteira}}* 🤑{{/premiacao_inteira}}
{{#cotas_restantes}}
⏳ Restam apenas *{{cotas_restantes}} cota(s)* nesse bolão.
{{/cotas_restantes}}
{{#saldo}}
💳 Você tem *{{saldo}}* de saldo aqui comigo — dá pra garantir sua cota sem tirar nada do bolso.
{{/saldo}}
🔗 Dá uma olhada nos jogos:
{{link}}

O pix é o:
👇👇👇
*pix@nchances.com.br*
{{#premiacao}}
Obs.: A divisão da premiação é um valor estimado e toma como base a quantidade total de cotistas, se o nosso jogo alcançar a premiação principal e se for o único jogo vencedor do dia.
{{/premiacao}}
*Aqui a gente estuda e planeja pra jogar melhor. Isso aumenta as chances, mas não garante o resultado.*

*Joguem com consciência.*`;

export const TEMPLATES_PADRAO = {
  oferta_bolao: TEMPLATE_OFERTA_BOLAO,
};
