// Campanha de oferta de bolão: lista os clientes que ainda NÃO têm
// participação num bolão e rastreia quem já recebeu a oferta por WhatsApp.
// O envio em si é feito pelo organizador (link wa.me aberto pelo client) —
// o servidor só registra que a conversa foi aberta, igual ao
// `participacoes.comprovante_enviado_em`.
import { json, readJson, requireString } from '../lib/http.js';
import { ApiError, classifyD1Error } from '../lib/errors.js';
import { nowIso } from '../lib/ids.js';
import { fromCentavos } from '../lib/money.js';
import { TELEFONE_ORGANIZADOR } from '../lib/negocio.js';
import { TEMPLATES_PADRAO } from '../lib/templates.js';

// Um cliente que já comprou alguma vez, mas cuja última compra é mais antiga
// que isto, é classificado como 'sumido' (merece mensagem de reativação, com
// tom diferente de quem comprou semana passada).
const DIAS_INATIVIDADE = 30;

function classificarSegmento(totalParticipacoes, ultimaParticipacaoEm, limiteInatividade) {
  if (!totalParticipacoes) return 'novo';
  if (ultimaParticipacaoEm && ultimaParticipacaoEm >= limiteInatividade) return 'recorrente';
  return 'sumido';
}

// GET /api/boloes/:id/ofertas — candidatos à oferta deste bolão.
//
// O histórico (total/última participação) considera só participações PAGAS:
// "nunca comprou" precisa significar nunca pagou, não "tem uma pendente que
// nunca virou venda".
export async function listarCandidatos(env, bolaoId) {
  const bolao = await env.DB.prepare(`SELECT id FROM boloes WHERE id=?`).bind(bolaoId).first();
  if (!bolao) throw new ApiError(404, 'Bolão não encontrado.');

  const { results } = await env.DB.prepare(`
    SELECT u.telefone, u.nome_completo, u.apelido, u.saldo_centavos,
           COUNT(p.id)        AS total_participacoes,
           MAX(p.criado_em)   AS ultima_participacao_em,
           o.enviado_em       AS oferta_enviada_em
    FROM usuarios u
    LEFT JOIN participacoes p
           ON p.telefone = u.telefone AND p.status_pagamento = 'pago'
    LEFT JOIN ofertas_enviadas o
           ON o.telefone = u.telefone AND o.bolao_id = ?
    WHERE u.telefone != ?
      AND NOT EXISTS (
        SELECT 1 FROM participacoes px
        WHERE px.bolao_id = ? AND px.telefone = u.telefone
      )
    GROUP BY u.telefone
    ORDER BY u.saldo_centavos DESC, ultima_participacao_em DESC
  `).bind(bolaoId, TELEFONE_ORGANIZADOR, bolaoId).all();

  const limiteInatividade = new Date(Date.now() - DIAS_INATIVIDADE * 86400000).toISOString();

  const candidatos = results.map(r => ({
    telefone: r.telefone,
    nome: r.apelido || r.nome_completo,
    nome_completo: r.nome_completo,
    saldo: fromCentavos(r.saldo_centavos),
    total_participacoes: r.total_participacoes,
    ultima_participacao_em: r.ultima_participacao_em,
    oferta_enviada_em: r.oferta_enviada_em,
    segmento: classificarSegmento(r.total_participacoes, r.ultima_participacao_em, limiteInatividade),
  }));

  return json({
    candidatos,
    resumo: {
      total: candidatos.length,
      enviadas: candidatos.filter(c => c.oferta_enviada_em).length,
    },
  });
}

// POST /api/boloes/:id/ofertas — marca que a oferta foi enviada ao cliente.
// Idempotente: reenviar só atualiza a data.
export async function registrarEnvio(env, request, bolaoId) {
  const body = await readJson(request);
  const telefone = requireString(body, 'telefone');
  const enviadoEm = nowIso();
  try {
    await env.DB.prepare(`
      INSERT INTO ofertas_enviadas (bolao_id, telefone, enviado_em) VALUES (?,?,?)
      ON CONFLICT(bolao_id, telefone) DO UPDATE SET enviado_em = excluded.enviado_em
    `).bind(bolaoId, telefone, enviadoEm).run();
  } catch (err) { throw classifyD1Error(err); }
  return json({ ok: true, enviado_em: enviadoEm }, 201);
}

// DELETE /api/boloes/:id/ofertas/:telefone — desfaz a marcação (o organizador
// clicou sem querer, ou quer abordar o cliente de novo do zero).
export async function removerEnvio(env, bolaoId, telefone) {
  await env.DB.prepare(`DELETE FROM ofertas_enviadas WHERE bolao_id=? AND telefone=?`)
    .bind(bolaoId, telefone).run();
  return json({ ok: true });
}

// GET /api/templates/:chave — corpo salvo pelo organizador, ou o padrão
// embutido no código quando ele nunca personalizou.
export async function getTemplate(env, chave) {
  if (!(chave in TEMPLATES_PADRAO)) throw new ApiError(404, 'Template desconhecido.');
  const row = await env.DB.prepare(`SELECT corpo FROM templates_mensagem WHERE chave=?`).bind(chave).first();
  return json({
    chave,
    corpo: row?.corpo ?? TEMPLATES_PADRAO[chave],
    padrao: TEMPLATES_PADRAO[chave],
    personalizado: !!row,
  });
}

// PUT /api/templates/:chave — salva a personalização. Corpo vazio remove a
// personalização (volta ao padrão) em vez de gravar uma mensagem em branco.
export async function putTemplate(env, request, chave) {
  if (!(chave in TEMPLATES_PADRAO)) throw new ApiError(404, 'Template desconhecido.');
  const body = await readJson(request);
  const corpo = String(body?.corpo ?? '').trim();

  try {
    if (!corpo) {
      await env.DB.prepare(`DELETE FROM templates_mensagem WHERE chave=?`).bind(chave).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO templates_mensagem (chave, corpo, atualizado_em) VALUES (?,?,?)
        ON CONFLICT(chave) DO UPDATE SET corpo = excluded.corpo, atualizado_em = excluded.atualizado_em
      `).bind(chave, corpo, nowIso()).run();
    }
  } catch (err) { throw classifyD1Error(err); }

  return json({ ok: true, corpo: corpo || TEMPLATES_PADRAO[chave], personalizado: !!corpo });
}
