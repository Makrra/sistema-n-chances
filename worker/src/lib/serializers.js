import { fromCentavos } from './money.js';
import { fromCotasMeias } from './cotas.js';

export function serializeBolao(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    loteria: row.loteria,
    tipo_sorteio: row.tipo_sorteio,
    concurso: row.concurso,
    data_sorteio: row.data_sorteio,
    valor_cota_inteira: fromCentavos(row.valor_cota_inteira_centavos),
    valor_cota_meia: fromCentavos(row.valor_cota_meia_centavos),
    quantidade_cotas: row.quantidade_cotas,
    cotas_disponiveis: row.cotas_disponiveis,
    custo: fromCentavos(row.custo_centavos),
    premio_concurso: row.premio_concurso_centavos != null ? fromCentavos(row.premio_concurso_centavos) : null,
    premio_ganho: fromCentavos(row.premio_ganho_centavos),
    divisao_lucro: row.divisao_lucro,
    observacao: row.observacao,
    premio_estimado: row.premio_estimado,
    jogos_descricao: row.jogos_descricao,
    status: row.status,
    criado_em: row.criado_em,
    promocao_percentual: row.promocao_percentual,
    atualizado_em: row.atualizado_em,
  };
}

// Espelha o select resumido usado por loadDashboard/loadBoloes.
export function serializeParticipacaoResumo(row) {
  return {
    bolao_id: row.bolao_id,
    telefone: row.telefone,
    cotas: fromCotasMeias(row.cotas_meias),
    valor_total: fromCentavos(row.valor_total_centavos),
    status_pagamento: row.status_pagamento,
  };
}

export function serializeParticipacao(row) {
  const out = {
    id: row.id,
    bolao_id: row.bolao_id,
    telefone: row.telefone,
    cotas: fromCotasMeias(row.cotas_meias),
    valor_total: fromCentavos(row.valor_total_centavos),
    status_pagamento: row.status_pagamento,
    pago_em: row.pago_em,
    criado_em: row.criado_em,
    forma_pagamento: row.forma_pagamento,
    posicao: row.posicao,
    valor_saldo_usado: fromCentavos(row.valor_saldo_usado_centavos),
    comprovante_enviado_em: row.comprovante_enviado_em,
  };
  if (row.saldo_centavos != null) out.saldo = fromCentavos(row.saldo_centavos);
  if (row.bolao_nome !== undefined) out.boloes = { nome: row.bolao_nome, concurso: row.bolao_concurso };
  return out;
}

// Usado por GET /api/participacoes/pendentes — participação + dados do
// cliente e do bolão já resolvidos (evita round-trip extra no client).
export function serializePendente(row) {
  return {
    id: row.id,
    bolao_id: row.bolao_id,
    telefone: row.telefone,
    nome: row.apelido || row.nome_completo,
    bolao_nome: row.bolao_nome,
    loteria: row.loteria,
    concurso: row.concurso,
    cotas: fromCotasMeias(row.cotas_meias),
    valor_total: fromCentavos(row.valor_total_centavos),
    forma_pagamento: row.forma_pagamento,
    criado_em: row.criado_em,
  };
}

export function serializeUsuario(row) {
  return {
    telefone: row.telefone,
    nome_completo: row.nome_completo,
    apelido: row.apelido,
    email: row.email,
    data_nascimento: row.data_nascimento,
    saldo: fromCentavos(row.saldo_centavos),
    criado_em: row.criado_em,
  };
}

export function serializeExtrato(row) {
  return {
    id: row.id,
    telefone: row.telefone,
    tipo: row.tipo,
    valor: fromCentavos(row.valor_centavos),
    descricao: row.descricao,
    bolao_id: row.bolao_id,
    criado_em: row.criado_em,
  };
}

export function serializeSaque(row) {
  return {
    id: row.id,
    telefone: row.telefone,
    valor: fromCentavos(row.valor_centavos),
    status: row.status,
    chave_pix: row.chave_pix,
    observacao: row.observacao,
    criado_em: row.criado_em,
    processado_em: row.processado_em,
  };
}

// ============================================================
// Jogos / Estratégia / Resultado do sorteio
// (ver docs/funcionalidade-jogos-resultado-sorteio.md)
// ============================================================

export function serializeEstrategia(row) {
  if (!row) return null;
  return {
    bolao_id: row.bolao_id,
    tipo: row.tipo,
    dezenas_base: row.dezenas_base ? JSON.parse(row.dezenas_base) : null,
    descricao: row.descricao,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  };
}

export function serializeJogo(row, dezenasSorteadas = null) {
  const dezenas = JSON.parse(row.dezenas);
  const out = { id: row.id, bolao_id: row.bolao_id, ordem: row.ordem, dezenas };
  if (dezenasSorteadas) {
    const sorteadasSet = new Set(dezenasSorteadas);
    out.acertos = dezenas.filter(d => sorteadasSet.has(d)).length;
  }
  return out;
}

export function serializeResultado(row) {
  if (!row) return null;
  return {
    bolao_id: row.bolao_id,
    dezenas_sorteadas: JSON.parse(row.dezenas_sorteadas),
    data_apuracao: row.data_apuracao,
    premiacoes: row.premiacoes ? JSON.parse(row.premiacoes) : [],
    fonte: row.fonte,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
  };
}

// Serializer público do bolão: só os campos que a página pública (/c/) pode
// mostrar — nunca telefone, nome ou valores de participação (ver seção 9.2/10
// do documento). Usado tanto na home pública (lista) quanto no detalhe.
export function serializePublicoResumo(row) {
  return {
    codigo: row.codigo,
    loteria: row.loteria,
    concurso: row.concurso,
    data_sorteio: row.data_sorteio,
    status: row.status,
    valor_cota_inteira: fromCentavos(row.valor_cota_inteira_centavos),
    valor_cota_meia: fromCentavos(row.valor_cota_meia_centavos),
  };
}
