import { json, readJson, requireNumber } from '../lib/http.js';
import { ApiError, classifyD1Error } from '../lib/errors.js';
import { nowIso, newId } from '../lib/ids.js';
import { toCotasMeias, valorPorCotasMeias } from '../lib/cotas.js';
import { serializePendente } from '../lib/serializers.js';
import {
  TELEFONE_ORGANIZADOR, planReconciliacaoDebito, planDistribuicaoPremio,
  recomputeSaldoStmt, resolverSaldo,
} from '../lib/negocio.js';

// Substitui a necessidade de entrar em cada bolão pra achar quem não pagou —
// lista todas as participações pendentes, de qualquer bolão, num lugar só.
export async function listarPendentes(env) {
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.bolao_id, p.cotas_meias, p.valor_total_centavos, p.criado_em,
           p.telefone, p.forma_pagamento, u.nome_completo, u.apelido,
           b.nome AS bolao_nome, b.loteria, b.concurso
    FROM participacoes p
    JOIN usuarios u ON u.telefone = p.telefone
    JOIN boloes b ON b.id = p.bolao_id
    WHERE p.status_pagamento = 'pendente'
    ORDER BY p.criado_em DESC
  `).all();
  return json({ pendentes: results.map(serializePendente) });
}

async function loadParticipacaoComBolao(db, id) {
  const row = await db.prepare(`
    SELECT p.*, b.nome AS bolao_nome, b.concurso AS bolao_concurso, b.status AS bolao_status,
           b.premio_ganho_centavos AS bolao_premio_ganho_centavos,
           b.valor_cota_inteira_centavos, b.valor_cota_meia_centavos, b.quantidade_cotas
    FROM participacoes p JOIN boloes b ON b.id = p.bolao_id
    WHERE p.id = ?
  `).bind(id).first();
  if (!row) throw new ApiError(404, 'Participação não encontrada.');
  return row;
}

// Se o bolão já estiver SORTEADO e premiado, redistribui o prêmio. Precisa
// rodar DEPOIS que a mutação principal desta requisição já foi commitada
// (a lista de pagantes é lida do banco, então tem que refletir o estado novo).
async function redistribuirSeNecessario(env, bolao) {
  if (bolao.bolao_status !== 'SORTEADO' || !(bolao.bolao_premio_ganho_centavos > 0)) return;
  const { statements: premioStmts, telefonesAfetados } = await planDistribuicaoPremio(env.DB, {
    bolaoId: bolao.bolao_id, premioTotalCentavos: bolao.bolao_premio_ganho_centavos,
    bolaoNome: bolao.bolao_nome, bolaoConcurso: bolao.bolao_concurso,
    quantidadeCotas: bolao.quantidade_cotas, newId, nowIso,
  });
  telefonesAfetados.forEach(t => premioStmts.push(recomputeSaldoStmt(env.DB, t)));
  try {
    await env.DB.batch(premioStmts);
  } catch (err) { throw classifyD1Error(err); }
}

// Substitui marcarPago (composto #2). Duas fases: (A) marca pago + reconcilia
// débito no extrato, atômico; (B) se o bolão já foi sorteado e premiado,
// redistribui o prêmio já vendo esta participação como paga.
export async function marcarPago(env, request, id) {
  let body = {};
  try { body = await readJson(request); } catch { /* corpo opcional */ }
  const p = await loadParticipacaoComBolao(env.DB, id);

  let formaPagamento = p.forma_pagamento || 'pix';
  let valorSaldoUsadoCentavos = p.valor_saldo_usado_centavos || 0;
  if (formaPagamento === 'saldo') {
    const resolved = await resolverSaldo(env.DB, p.telefone, p.valor_total_centavos, body.valor_saldo_usado_desejado);
    formaPagamento = resolved.formaPagamento;
    valorSaldoUsadoCentavos = resolved.valorSaldoUsadoCentavos;
  }

  const pagoEm = nowIso();
  const statements = [
    env.DB.prepare(`
      UPDATE participacoes SET status_pagamento='pago', pago_em=?, forma_pagamento=?, valor_saldo_usado_centavos=?
      WHERE id=?
    `).bind(pagoEm, formaPagamento, valorSaldoUsadoCentavos, id),
  ];
  statements.push(...await planReconciliacaoDebito(env.DB, {
    telefone: p.telefone, bolaoId: p.bolao_id, statusPagamento: 'pago', formaPagamento,
    valorTotalCentavos: p.valor_total_centavos, valorSaldoUsadoCentavos,
    bolaoNome: p.bolao_nome, nowIso, newId,
  }));
  statements.push(recomputeSaldoStmt(env.DB, p.telefone));

  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }

  await redistribuirSeNecessario(env, p);
  return json({ ok: true });
}

export async function marcarComprovante(env, id) {
  const result = await env.DB.prepare(
    `UPDATE participacoes SET comprovante_enviado_em=? WHERE id=?`
  ).bind(nowIso(), id).run();
  if (result.meta.changes === 0) throw new ApiError(404, 'Participação não encontrada.');
  return json({ ok: true });
}

// Substitui salvarEdicaoPart (composto #4). Mesma estrutura de duas fases de
// marcarPago. valor_total é sempre recalculado no servidor a partir de
// cotas × valor da cota do bolão (o client não tem mais autoridade sobre
// esse valor). Igual ao original: forma_pagamento 'saldo' aqui sempre debita
// o valor_total inteiro (a edição não passa pelo fluxo de saldo parcial).
export async function update(env, request, id) {
  const body = await readJson(request);
  const p = await loadParticipacaoComBolao(env.DB, id);
  const isOrganizador = p.telefone === TELEFONE_ORGANIZADOR;

  const cotasMeias = toCotasMeias(requireNumber(body, 'cotas'));
  if (cotasMeias <= 0) throw new ApiError(400, 'Informe a quantidade de cotas (mín. 0,5).');

  let valorTotalCentavos, status, formaPagamento;
  if (isOrganizador) {
    valorTotalCentavos = 0; status = 'pago'; formaPagamento = 'pix';
  } else {
    valorTotalCentavos = valorPorCotasMeias(cotasMeias, p.valor_cota_inteira_centavos, p.valor_cota_meia_centavos);
    status = body.status_pagamento || p.status_pagamento;
    formaPagamento = body.forma_pagamento || p.forma_pagamento;
  }

  const somaOutros = await env.DB.prepare(
    `SELECT COALESCE(SUM(cotas_meias),0) AS soma FROM participacoes WHERE bolao_id=? AND id != ?`
  ).bind(p.bolao_id, id).first();
  if (p.quantidade_cotas != null && somaOutros.soma + cotasMeias > p.quantidade_cotas * 2) {
    throw new ApiError(409, `Limite de cotas excedido (${somaOutros.soma / 2}/${p.quantidade_cotas} já preenchidas pelos demais).`);
  }

  let pagoEm = p.pago_em;
  if (status === 'pago' && !p.pago_em) pagoEm = nowIso();
  if (status === 'pendente') pagoEm = null;

  const statements = [
    env.DB.prepare(`
      UPDATE participacoes SET cotas_meias=?, valor_total_centavos=?, status_pagamento=?, forma_pagamento=?, pago_em=?
      WHERE id=?
    `).bind(cotasMeias, valorTotalCentavos, status, formaPagamento, pagoEm, id),
  ];
  statements.push(...await planReconciliacaoDebito(env.DB, {
    telefone: p.telefone, bolaoId: p.bolao_id, statusPagamento: status, formaPagamento,
    valorTotalCentavos, valorSaldoUsadoCentavos: 0, bolaoNome: p.bolao_nome, nowIso, newId,
  }));
  statements.push(recomputeSaldoStmt(env.DB, p.telefone));

  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }

  await redistribuirSeNecessario(env, p);
  return json({ ok: true });
}

// Substitui excluirParticipacao (composto #5).
export async function remove(env, id) {
  const p = await loadParticipacaoComBolao(env.DB, id);

  const statements = [
    env.DB.prepare(`DELETE FROM extrato WHERE bolao_id=? AND telefone=?`).bind(p.bolao_id, p.telefone),
    env.DB.prepare(`DELETE FROM participacoes WHERE id=?`).bind(id),
    recomputeSaldoStmt(env.DB, p.telefone),
  ];

  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }

  await redistribuirSeNecessario(env, p);
  return json({ ok: true });
}
