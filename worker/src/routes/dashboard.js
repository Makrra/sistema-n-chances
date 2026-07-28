import { json } from '../lib/http.js';
import { serializeBolao, serializeParticipacaoResumo, serializeSaque } from '../lib/serializers.js';

// Substitui loadDashboard: combina boloes + participações resumidas + saques
// pendentes num round-trip só.
export async function getDashboard(env) {
  const [boloesRes, partRes, saquesRes] = await Promise.all([
    env.DB.prepare(`SELECT * FROM boloes ORDER BY criado_em DESC`).all(),
    env.DB.prepare(`SELECT bolao_id, telefone, cotas_meias, valor_total_centavos, status_pagamento FROM participacoes`).all(),
    env.DB.prepare(`SELECT * FROM saques WHERE status='pendente' ORDER BY criado_em DESC`).all(),
  ]);
  return json({
    boloes: boloesRes.results.map(serializeBolao),
    participacoes: partRes.results.map(serializeParticipacaoResumo),
    saques: saquesRes.results.map(serializeSaque),
  });
}
