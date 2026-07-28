import { ApiError } from './errors.js';

export function json(data, status = 200) {
  return Response.json(data, { status });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, 'Corpo da requisição inválido (JSON esperado).');
  }
}

export function requireString(body, field) {
  const v = body?.[field];
  if (v == null || String(v).trim() === '') {
    throw new ApiError(400, `Campo obrigatório: ${field}`);
  }
  return String(v).trim();
}

export function requireNumber(body, field) {
  const v = body?.[field];
  if (v == null || v === '') {
    throw new ApiError(400, `Campo obrigatório: ${field}`);
  }
  const n = Number(v);
  if (Number.isNaN(n)) throw new ApiError(400, `Campo numérico inválido: ${field}`);
  return n;
}
