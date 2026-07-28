import { json, readJson, requireString } from '../lib/http.js';
import { ApiError, classifyD1Error } from '../lib/errors.js';
import { nowIso, newId } from '../lib/ids.js';
import { toCentavos } from '../lib/money.js';
import { serializeSaque } from '../lib/serializers.js';
import { recomputeSaldoStmt } from '../lib/negocio.js';

// Substitui loadSaques (e a contagem de pendentes do dashboard).
export async function list(env, request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pendente';
  const { results } = await env.DB.prepare(
    `SELECT * FROM saques WHERE status=? ORDER BY criado_em DESC`
  ).bind(status).all();
  return json({ saques: results.map(serializeSaque) });
}

// Substitui solicitarSaque.
export async function create(env, request) {
  const body = await readJson(request);
  const telefone = requireString(body, 'telefone');
  const valorCentavos = toCentavos(body.valor);
  if (!valorCentavos) throw new ApiError(400, 'Informe o valor.');

  try {
    await env.DB.prepare(`
      INSERT INTO saques (id, telefone, valor_centavos, status, chave_pix, observacao, criado_em)
      VALUES (?,?,?,?,?,?,?)
    `).bind(newId(), telefone, valorCentavos, 'pendente', body.chave_pix || null, body.observacao || null, nowIso()).run();
  } catch (err) { throw classifyD1Error(err); }
  return json({ ok: true }, 201);
}

// Substitui processarSaque (composto #8).
export async function process(env, request, id) {
  const body = await readJson(request);
  const novoStatus = requireString(body, 'status');

  const saque = await env.DB.prepare(`SELECT telefone, valor_centavos FROM saques WHERE id=?`).bind(id).first();
  if (!saque) throw new ApiError(404, 'Saque não encontrado.');

  const statements = [
    env.DB.prepare(`UPDATE saques SET status=?, processado_em=? WHERE id=?`).bind(novoStatus, nowIso(), id),
  ];
  if (novoStatus === 'pago') {
    statements.push(env.DB.prepare(`
      INSERT INTO extrato (id, telefone, tipo, valor_centavos, descricao, bolao_id, criado_em)
      VALUES (?,?,?,?,?,NULL,?)
    `).bind(newId(), saque.telefone, 'saque', saque.valor_centavos, 'Saque processado', nowIso()));
    statements.push(recomputeSaldoStmt(env.DB, saque.telefone));
  }

  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }
  return json({ ok: true });
}
