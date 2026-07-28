import { json } from '../lib/http.js';
import { fromCentavos } from '../lib/money.js';
import { serializeBolao, serializeParticipacaoResumo, serializeSaque } from '../lib/serializers.js';

// Substitui loadDashboard: combina boloes + participações resumidas + saques
// pendentes num round-trip só, mais os indicadores de negócio (all-time,
// sem filtro de período — o card "Caixa do Período" já cobre a visão por data).
export async function getDashboard(env) {
  const [boloesRes, partRes, saquesRes, melhorClientesRes, loteriasRes] = await Promise.all([
    env.DB.prepare(`SELECT * FROM boloes ORDER BY criado_em DESC`).all(),
    env.DB.prepare(`SELECT bolao_id, telefone, cotas_meias, valor_total_centavos, status_pagamento FROM participacoes`).all(),
    env.DB.prepare(`SELECT * FROM saques WHERE status='pendente' ORDER BY criado_em DESC`).all(),
    // top 5 clientes por faturamento
    env.DB.prepare(`
      SELECT p.telefone, u.nome_completo, u.apelido, SUM(p.valor_total_centavos) AS total_centavos
      FROM participacoes p JOIN usuarios u ON u.telefone = p.telefone
      WHERE p.status_pagamento = 'pago'
      GROUP BY p.telefone ORDER BY total_centavos DESC LIMIT 5
    `).all(),
    // uma linha por loteria com as 3 métricas juntas (faturamento via subquery
    // correlacionada, ticket/cotas direto de boloes) — vira uma tabela
    // comparativa única no front, em vez de 3 rankings repetidos.
    env.DB.prepare(`
      SELECT
        b.loteria,
        AVG(b.valor_cota_inteira_centavos) AS ticket_medio_centavos,
        AVG(b.quantidade_cotas) AS media_cotas,
        COALESCE((
          SELECT SUM(p.valor_total_centavos)
          FROM participacoes p JOIN boloes b2 ON b2.id = p.bolao_id
          WHERE b2.loteria = b.loteria AND p.status_pagamento = 'pago'
        ), 0) AS faturamento_centavos
      FROM boloes b
      WHERE b.loteria IS NOT NULL
      GROUP BY b.loteria
      ORDER BY faturamento_centavos DESC
    `).all(),
  ]);

  return json({
    boloes: boloesRes.results.map(serializeBolao),
    participacoes: partRes.results.map(serializeParticipacaoResumo),
    saques: saquesRes.results.map(serializeSaque),
    insights: {
      melhor_clientes: melhorClientesRes.results.map(r => ({
        telefone: r.telefone,
        nome: r.apelido || r.nome_completo,
        total: fromCentavos(r.total_centavos),
      })),
      loterias: loteriasRes.results.map(r => ({
        loteria: r.loteria,
        faturamento: fromCentavos(r.faturamento_centavos),
        ticket_medio: fromCentavos(r.ticket_medio_centavos),
        media_cotas: r.media_cotas,
      })),
    },
  });
}
