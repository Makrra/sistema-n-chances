import { json } from '../lib/http.js';
import { fromCentavos } from '../lib/money.js';
import { serializeBolao, serializeParticipacaoResumo, serializeSaque } from '../lib/serializers.js';

// Substitui loadDashboard: combina boloes + participações resumidas + saques
// pendentes num round-trip só, mais os indicadores de negócio (all-time,
// sem filtro de período — o card "Caixa do Período" já cobre a visão por data).
export async function getDashboard(env) {
  const [boloesRes, partRes, saquesRes, melhorClientesRes, loteriaVendidaRes, loteriaTicketRes, loteriaCotasRes] = await Promise.all([
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
    // todas as loterias, por faturamento (sem LIMIT — são poucas categorias)
    env.DB.prepare(`
      SELECT b.loteria, SUM(p.valor_total_centavos) AS total_centavos
      FROM participacoes p JOIN boloes b ON b.id = p.bolao_id
      WHERE p.status_pagamento = 'pago' AND b.loteria IS NOT NULL
      GROUP BY b.loteria ORDER BY total_centavos DESC
    `).all(),
    // todas as loterias, por média de valor da cota inteira
    env.DB.prepare(`
      SELECT loteria, AVG(valor_cota_inteira_centavos) AS media_centavos
      FROM boloes WHERE loteria IS NOT NULL
      GROUP BY loteria ORDER BY media_centavos DESC
    `).all(),
    // todas as loterias, por média de cotas por bolão
    env.DB.prepare(`
      SELECT loteria, AVG(quantidade_cotas) AS media_cotas
      FROM boloes WHERE loteria IS NOT NULL
      GROUP BY loteria ORDER BY media_cotas DESC
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
      loteria_mais_vendida: loteriaVendidaRes.results.map(r => ({
        loteria: r.loteria,
        total: fromCentavos(r.total_centavos),
      })),
      loteria_ticket_mais_caro: loteriaTicketRes.results.map(r => ({
        loteria: r.loteria,
        media_valor_cota: fromCentavos(r.media_centavos),
      })),
      loteria_mais_cotas: loteriaCotasRes.results.map(r => ({
        loteria: r.loteria,
        media_cotas: r.media_cotas,
      })),
    },
  });
}
