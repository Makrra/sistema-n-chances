import { json } from '../lib/http.js';
import { ApiError, classifyD1Error } from '../lib/errors.js';
import { recomputeSaldoStmt } from '../lib/negocio.js';

// Substitui excluirLancamento (composto #10).
export async function remove(env, id) {
  const row = await env.DB.prepare(`SELECT telefone FROM extrato WHERE id=?`).bind(id).first();
  if (!row) throw new ApiError(404, 'Lançamento não encontrado.');

  const statements = [
    env.DB.prepare(`DELETE FROM extrato WHERE id=?`).bind(id),
    recomputeSaldoStmt(env.DB, row.telefone),
  ];
  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }
  return json({ ok: true });
}
