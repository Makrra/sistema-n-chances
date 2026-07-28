import { fromCentavos } from './money.js';
import { fromCotasMeias } from './cotas.js';

export function serializeBolao(row) {
  return {
    id: row.id,
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
