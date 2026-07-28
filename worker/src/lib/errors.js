export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function classifyD1Error(err) {
  const msg = String(err?.message || err);
  if (/UNIQUE constraint failed/i.test(msg)) return new ApiError(409, 'Registro duplicado.');
  if (/CHECK constraint failed/i.test(msg)) return new ApiError(400, 'Valor inválido para um dos campos.');
  if (/FOREIGN KEY constraint failed/i.test(msg)) return new ApiError(400, 'Referência inválida (bolão ou cliente inexistente).');
  return new ApiError(500, 'Erro interno: ' + msg);
}
