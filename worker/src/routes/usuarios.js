import { json, readJson, requireString } from '../lib/http.js';
import { ApiError, classifyD1Error } from '../lib/errors.js';
import { nowIso, newId } from '../lib/ids.js';
import { toCentavos, fromCentavos } from '../lib/money.js';
import { serializeUsuario, serializeExtrato } from '../lib/serializers.js';
import { recomputeSaldoStmt } from '../lib/negocio.js';

function normalizarTelefone(v) {
  return String(v || '').replace(/\D/g, '');
}

// Substitui loadClientes.
export async function list(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM usuarios`).all();
  const sorted = [...results].sort((a, b) =>
    (a.apelido || a.nome_completo || '').localeCompare(b.apelido || b.nome_completo || '', 'pt-BR', { sensitivity: 'base' })
  );
  return json({ usuarios: sorted.map(serializeUsuario) });
}

// Substitui criarCliente.
export async function create(env, request) {
  const body = await readJson(request);
  const nomeCompleto = requireString(body, 'nome_completo');
  const telefone = normalizarTelefone(requireString(body, 'telefone'));
  if (!telefone) throw new ApiError(400, 'Telefone inválido.');

  try {
    await env.DB.prepare(`
      INSERT INTO usuarios (telefone, nome_completo, apelido, email, saldo_centavos, criado_em)
      VALUES (?,?,?,?,0,?)
    `).bind(telefone, nomeCompleto, body.apelido || null, body.email || null, nowIso()).run();
  } catch (err) { throw classifyD1Error(err); }
  return json({ telefone }, 201);
}

// Substitui salvarEdicaoCliente. Como telefone é PK física com FK
// ON UPDATE CASCADE, trocar o telefone aqui agora recasca de verdade nas
// tabelas dependentes (corrige o gap do Postgres, onde era só FK lógica).
export async function update(env, request, telefoneOriginal) {
  const body = await readJson(request);
  const nomeCompleto = requireString(body, 'nome_completo');
  const telefone = normalizarTelefone(requireString(body, 'telefone'));
  if (!telefone) throw new ApiError(400, 'Telefone inválido.');

  let result;
  try {
    result = await env.DB.prepare(`
      UPDATE usuarios SET nome_completo=?, apelido=?, telefone=?, email=? WHERE telefone=?
    `).bind(nomeCompleto, body.apelido || null, telefone, body.email || null, telefoneOriginal).run();
  } catch (err) { throw classifyD1Error(err); }
  if (result.meta.changes === 0) throw new ApiError(404, 'Cliente não encontrado.');
  return json({ ok: true });
}

export async function saldo(env, telefone) {
  const row = await env.DB.prepare(`SELECT saldo_centavos FROM usuarios WHERE telefone=?`).bind(telefone).first();
  if (!row) throw new ApiError(404, 'Cliente não encontrado.');
  return json({ telefone, saldo: fromCentavos(row.saldo_centavos) });
}

// Substitui abrirExtrato. Mescla os pagamentos Pix sintéticos (que nunca
// geram lançamento em 'extrato') no servidor ANTES de cortar em 50 itens —
// corrige o bug do original, que buscava só os 50 últimos de 'extrato' e
// SÓ DEPOIS mesclava os itens Pix, podendo esconder Pix antigos válidos.
export async function extratoDe(env, telefone) {
  const [extratoRes, saldoRow, partsRes] = await Promise.all([
    env.DB.prepare(`SELECT * FROM extrato WHERE telefone=? ORDER BY criado_em DESC LIMIT 200`).bind(telefone).all(),
    env.DB.prepare(`SELECT saldo_centavos FROM usuarios WHERE telefone=?`).bind(telefone).first(),
    env.DB.prepare(`
      SELECT p.*, b.nome AS bolao_nome, b.concurso AS bolao_concurso
      FROM participacoes p JOIN boloes b ON b.id = p.bolao_id
      WHERE p.telefone=? AND p.status_pagamento='pago'
    `).bind(telefone).all(),
  ]);
  if (!saldoRow) throw new ApiError(404, 'Cliente não encontrado.');

  const extratoItems = extratoRes.results.map(serializeExtrato);
  const debitoBolaoIds = new Set(
    extratoItems.filter(e => e.tipo === 'debito' && e.bolao_id).map(e => e.bolao_id)
  );

  const pagamentosPix = partsRes.results
    .map(p => ({
      forma: p.forma_pagamento || 'pix',
      valorTotal: fromCentavos(p.valor_total_centavos),
      valorSaldoUsado: fromCentavos(p.valor_saldo_usado_centavos),
      bolaoId: p.bolao_id,
      bolaoNome: p.bolao_nome,
      bolaoConcurso: p.bolao_concurso,
      criadoEm: p.pago_em || p.criado_em,
    }))
    .filter(p => {
      if (p.forma === 'saldo') return false;
      if (p.valorTotal <= 0) return false;
      if (p.forma === 'misto') return p.valorTotal - p.valorSaldoUsado > 0.001;
      return !debitoBolaoIds.has(p.bolaoId);
    })
    .map(p => ({
      tipo: 'pix',
      valor: p.forma === 'misto' ? p.valorTotal - p.valorSaldoUsado : p.valorTotal,
      descricao: `Pagamento Pix - ${p.bolaoNome || 'Bolão'}${p.bolaoConcurso ? ' #' + p.bolaoConcurso : ''}`,
      criado_em: p.criadoEm,
      naoAfetaSaldo: true,
    }));

  const items = [...extratoItems, ...pagamentosPix]
    .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
    .slice(0, 50);

  return json({ saldo: fromCentavos(saldoRow.saldo_centavos), items });
}

// Substitui criarLancamento (composto #9).
export async function criarLancamento(env, request, telefone) {
  const body = await readJson(request);
  const tipo = requireString(body, 'tipo');
  const valorCentavos = toCentavos(body.valor);
  if (!valorCentavos) throw new ApiError(400, 'Informe o valor.');

  const statements = [
    env.DB.prepare(`
      INSERT INTO extrato (id, telefone, tipo, valor_centavos, descricao, bolao_id, criado_em)
      VALUES (?,?,?,?,?,NULL,?)
    `).bind(newId(), telefone, tipo, valorCentavos, body.descricao || null, nowIso()),
    recomputeSaldoStmt(env.DB, telefone),
  ];
  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }
  return json({ ok: true }, 201);
}
