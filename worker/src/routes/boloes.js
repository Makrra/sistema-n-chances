import { json, readJson, requireString, requireNumber } from '../lib/http.js';
import { ApiError, classifyD1Error } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { toCentavos, fromCentavos } from '../lib/money.js';
import { toCotasMeias, valorPorCotasMeias } from '../lib/cotas.js';
import { serializeBolao, serializeParticipacao, serializeParticipacaoResumo } from '../lib/serializers.js';
import {
  TELEFONE_ORGANIZADOR, planReconciliacaoDebito, planDistribuicaoPremio,
  recomputeSaldoStmt, resolverSaldo, gerarCodigoBolao,
} from '../lib/negocio.js';

// Substitui loadBoloes: boloes + participações resumidas (p/ cotas ocupadas/lucro).
export async function list(env) {
  const [boloesRes, partRes] = await Promise.all([
    env.DB.prepare(`SELECT * FROM boloes ORDER BY criado_em DESC`).all(),
    env.DB.prepare(`SELECT bolao_id, telefone, cotas_meias, valor_total_centavos, status_pagamento FROM participacoes`).all(),
  ]);
  return json({
    boloes: boloesRes.results.map(serializeBolao),
    participacoes: partRes.results.map(serializeParticipacaoResumo),
  });
}

// Substitui abrirBolao: bolão + participações (com saldo do cliente anexado).
export async function detail(env, id) {
  const bolao = await env.DB.prepare(`SELECT * FROM boloes WHERE id=?`).bind(id).first();
  if (!bolao) throw new ApiError(404, 'Bolão não encontrado.');
  const { results: parts } = await env.DB.prepare(`
    SELECT p.*, u.saldo_centavos AS saldo_centavos
    FROM participacoes p JOIN usuarios u ON u.telefone = p.telefone
    WHERE p.bolao_id = ? ORDER BY p.criado_em
  `).bind(id).all();
  return json({
    bolao: serializeBolao(bolao),
    participacoes: parts.map(serializeParticipacao),
  });
}

// Substitui criarBolao (composto #1): insert boloes + insert opcional da
// participação de cortesia do organizador, atômico.
export async function create(env, request) {
  const body = await readJson(request);
  const nome = requireString(body, 'nome');
  const concurso = requireNumber(body, 'concurso');
  const dataSorteio = requireString(body, 'data_sorteio');
  const cotasReservadas = Number(body.cotas_reservadas) || 0;
  const quantidadeCotas = body.quantidade_cotas != null ? Number(body.quantidade_cotas) : null;
  if (quantidadeCotas != null && cotasReservadas > quantidadeCotas) {
    throw new ApiError(400, 'Cotas reservadas não podem ser maiores que o nº de cotas.');
  }

  const id = newId();
  const criadoEm = nowIso();
  const codigo = await gerarCodigoBolao(env.DB, body.loteria || null, concurso);
  const statements = [
    env.DB.prepare(`
      INSERT INTO boloes (id, nome, loteria, tipo_sorteio, concurso, data_sorteio,
        valor_cota_inteira_centavos, valor_cota_meia_centavos, quantidade_cotas,
        custo_centavos, status, observacao, premio_estimado, jogos_descricao, criado_em, codigo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id, nome, body.loteria || null, body.tipo_sorteio || null, concurso, dataSorteio,
      toCentavos(body.valor_cota_inteira), toCentavos(body.valor_cota_meia), quantidadeCotas,
      toCentavos(body.custo), 'ABERTO', body.observacao || null,
      body.premio_estimado || null, body.jogos_descricao || null, criadoEm, codigo
    ),
  ];

  if (cotasReservadas > 0) {
    statements.push(env.DB.prepare(`
      INSERT INTO participacoes (id, bolao_id, telefone, cotas_meias, valor_total_centavos,
        status_pagamento, pago_em, criado_em, forma_pagamento, posicao, valor_saldo_usado_centavos)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).bind(newId(), id, TELEFONE_ORGANIZADOR, toCotasMeias(cotasReservadas), 0,
      'pago', criadoEm, criadoEm, 'pix', 1, 0));
  }

  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }

  return json({ id, criado_em: criadoEm, codigo }, 201);
}

// Substitui salvarEdicaoBolao. Preserva o comportamento original: NÃO
// redistribui prêmio ao editar (só marcarPago/marcarSorteado/editar
// participação/excluir participação fazem isso — inconsistência já existente
// no app original, preservada de propósito).
export async function update(env, request, id) {
  const body = await readJson(request);
  const nome = requireString(body, 'nome');
  const concurso = requireNumber(body, 'concurso');
  const dataSorteio = requireString(body, 'data_sorteio');

  let result;
  try {
    result = await env.DB.prepare(`
      UPDATE boloes SET nome=?, loteria=?, tipo_sorteio=?, concurso=?, data_sorteio=?,
        valor_cota_inteira_centavos=?, valor_cota_meia_centavos=?, quantidade_cotas=?,
        premio_ganho_centavos=?, custo_centavos=?, observacao=?
      WHERE id=?
    `).bind(
      nome, body.loteria || null, body.tipo_sorteio || null, concurso, dataSorteio,
      toCentavos(body.valor_cota_inteira), toCentavos(body.valor_cota_meia),
      body.quantidade_cotas != null ? Number(body.quantidade_cotas) : null,
      toCentavos(body.premio_ganho), toCentavos(body.custo), body.observacao || null, id
    ).run();
  } catch (err) { throw classifyD1Error(err); }

  if (result.meta.changes === 0) throw new ApiError(404, 'Bolão não encontrado.');
  return json({ ok: true });
}

// Substitui updateBolaoStatus (usado por confirmarFecharBolao -> 'FECHADO').
export async function updateStatus(env, request, id) {
  const body = await readJson(request);
  const status = requireString(body, 'status');
  let result;
  try {
    result = await env.DB.prepare(`UPDATE boloes SET status=? WHERE id=?`).bind(status, id).run();
  } catch (err) { throw classifyD1Error(err); }
  if (result.meta.changes === 0) throw new ApiError(404, 'Bolão não encontrado.');
  return json({ ok: true });
}

// Substitui confirmarExcluirBolao (composto #6): a cascata real do D1
// (extrato/participacoes ON DELETE CASCADE) substitui o delete manual do
// extrato que o Postgres original precisava fazer à parte.
export async function remove(env, id) {
  const { results: telefones } = await env.DB.prepare(
    `SELECT DISTINCT telefone FROM extrato WHERE bolao_id=?`
  ).bind(id).all();

  const statements = [env.DB.prepare(`DELETE FROM boloes WHERE id=?`).bind(id)];
  telefones.forEach(({ telefone }) => statements.push(recomputeSaldoStmt(env.DB, telefone)));

  let results;
  try {
    results = await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }
  if (results[0].meta.changes === 0) throw new ApiError(404, 'Bolão não encontrado.');
  return json({ ok: true });
}

// Substitui marcarSorteado (composto #7). Sem staleness: nada nesta mesma
// requisição altera a tabela participacoes antes da leitura de pagantes,
// então dá pra manter tudo num batch único.
export async function sortear(env, request, id) {
  const body = await readJson(request);
  const premiado = !!body.premiado;
  let premioTotalCentavos = 0;

  const bolao = await env.DB.prepare(`SELECT * FROM boloes WHERE id=?`).bind(id).first();
  if (!bolao) throw new ApiError(404, 'Bolão não encontrado.');

  if (premiado) {
    premioTotalCentavos = toCentavos(requireNumber(body, 'premio_total'));
    if (premioTotalCentavos <= 0) throw new ApiError(400, 'Valor de prêmio inválido.');
    const pagantesCount = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM participacoes WHERE bolao_id=? AND status_pagamento='pago'`
    ).bind(id).first();
    if (!pagantesCount.n) throw new ApiError(400, 'Nenhum participante pago para receber o prêmio.');
  }

  const statements = [
    env.DB.prepare(`UPDATE boloes SET status='SORTEADO', premio_ganho_centavos=? WHERE id=?`)
      .bind(premiado ? premioTotalCentavos : 0, id),
  ];

  if (premiado) {
    const { statements: premioStmts, telefonesAfetados } = await planDistribuicaoPremio(env.DB, {
      bolaoId: id, premioTotalCentavos, bolaoNome: bolao.nome, bolaoConcurso: bolao.concurso,
      quantidadeCotas: bolao.quantidade_cotas, newId, nowIso,
    });
    statements.push(...premioStmts);
    telefonesAfetados.forEach(t => statements.push(recomputeSaldoStmt(env.DB, t)));
  } else {
    statements.push(env.DB.prepare(`DELETE FROM extrato WHERE bolao_id=? AND tipo='premio'`).bind(id));
  }

  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }
  return json({ ok: true });
}

// Substitui adicionarParticipante (composto #3).
export async function addParticipacao(env, request, bolaoId) {
  const body = await readJson(request);
  const telefone = requireString(body, 'telefone');
  const cotasMeias = toCotasMeias(requireNumber(body, 'cotas'));
  if (cotasMeias <= 0) throw new ApiError(400, 'Informe a quantidade de cotas (mín. 0,5).');

  const bolao = await env.DB.prepare(`SELECT * FROM boloes WHERE id=?`).bind(bolaoId).first();
  if (!bolao) throw new ApiError(404, 'Bolão não encontrado.');

  const isOrganizador = telefone === TELEFONE_ORGANIZADOR;
  let valorTotalCentavos, status, formaPagamento, valorSaldoUsadoCentavos = 0;

  if (isOrganizador) {
    valorTotalCentavos = 0; status = 'pago'; formaPagamento = 'pix';
  } else {
    valorTotalCentavos = valorPorCotasMeias(cotasMeias, bolao.valor_cota_inteira_centavos, bolao.valor_cota_meia_centavos);
    if (valorTotalCentavos <= 0) throw new ApiError(400, 'Informe o valor total.');
    status = requireString(body, 'status_pagamento');
    formaPagamento = requireString(body, 'forma_pagamento');
    if (status === 'pago' && formaPagamento === 'saldo') {
      const resolved = await resolverSaldo(env.DB, telefone, valorTotalCentavos, body.valor_saldo_usado_desejado);
      formaPagamento = resolved.formaPagamento;
      valorSaldoUsadoCentavos = resolved.valorSaldoUsadoCentavos;
    }
  }

  // Guard de limite de cotas + posição (leitura não-mutante; participação é
  // nova, então não há corrida com nenhuma escrita desta mesma requisição).
  const somaAtual = await env.DB.prepare(
    `SELECT COALESCE(SUM(cotas_meias),0) AS soma, COALESCE(MAX(posicao),0) AS maxPos FROM participacoes WHERE bolao_id=?`
  ).bind(bolaoId).first();
  if (bolao.quantidade_cotas != null && somaAtual.soma + cotasMeias > bolao.quantidade_cotas * 2) {
    throw new ApiError(409, `Limite de cotas excedido (${somaAtual.soma / 2}/${bolao.quantidade_cotas} já preenchidas).`);
  }
  const posicao = somaAtual.maxPos + 1;

  const id = newId();
  const criadoEm = nowIso();
  const pagoEm = status === 'pago' ? criadoEm : null;

  const statements = [
    env.DB.prepare(`
      INSERT INTO participacoes (id, bolao_id, telefone, cotas_meias, valor_total_centavos,
        status_pagamento, pago_em, criado_em, forma_pagamento, posicao, valor_saldo_usado_centavos)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).bind(id, bolaoId, telefone, cotasMeias, valorTotalCentavos, status, pagoEm, criadoEm,
      formaPagamento, posicao, valorSaldoUsadoCentavos),
  ];
  const debitoStmts = await planReconciliacaoDebito(env.DB, {
    telefone, bolaoId, statusPagamento: status, formaPagamento, valorTotalCentavos,
    valorSaldoUsadoCentavos, bolaoNome: bolao.nome, nowIso, newId,
  });
  statements.push(...debitoStmts);
  if (debitoStmts.length > 0) statements.push(recomputeSaldoStmt(env.DB, telefone));

  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }

  const saldoRow = await env.DB.prepare(`SELECT saldo_centavos FROM usuarios WHERE telefone=?`).bind(telefone).first();

  return json({
    id, posicao, cotas: cotasMeias / 2, valor_total: fromCentavos(valorTotalCentavos),
    forma_pagamento: formaPagamento, valor_saldo_usado: fromCentavos(valorSaldoUsadoCentavos),
    status_pagamento: status, pago_em: pagoEm,
    saldo: fromCentavos(saldoRow?.saldo_centavos ?? 0),
  }, 201);
}
