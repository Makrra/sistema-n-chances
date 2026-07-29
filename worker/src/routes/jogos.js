// Estratégia, jogos e resultado do sorteio de um bolão — organizador
// (autenticado via Cloudflare Access). Ver
// docs/funcionalidade-jogos-resultado-sorteio.md, seções 5-8.
import { json, readJson } from '../lib/http.js';
import { ApiError, classifyD1Error } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { toCentavos } from '../lib/money.js';
import { validarJogo } from '../lib/loterias.js';
import { serializeEstrategia, serializeJogo, serializeResultado } from '../lib/serializers.js';

async function getBolaoOrThrow(env, bolaoId) {
  const bolao = await env.DB.prepare(`SELECT * FROM boloes WHERE id=?`).bind(bolaoId).first();
  if (!bolao) throw new ApiError(404, 'Bolão não encontrado.');
  return bolao;
}

// ============================================================
// ESTRATÉGIA
// ============================================================
export async function getEstrategia(env, bolaoId) {
  const row = await env.DB.prepare(`SELECT * FROM bolao_estrategias WHERE bolao_id=?`).bind(bolaoId).first();
  return json({ estrategia: serializeEstrategia(row) });
}

export async function putEstrategia(env, request, bolaoId) {
  await getBolaoOrThrow(env, bolaoId);
  const body = await readJson(request);
  const tipo = body.tipo || 'SIMPLES';
  if (!['SIMPLES', 'DESDOBRAMENTO', 'FECHAMENTO', 'SURPRESINHA'].includes(tipo)) {
    throw new ApiError(400, 'Tipo de estratégia inválido.');
  }
  const dezenasBase = Array.isArray(body.dezenas_base) && body.dezenas_base.length
    ? JSON.stringify(body.dezenas_base.map(Number))
    : null;
  const descricao = body.descricao || null;
  const agora = nowIso();

  const existente = await env.DB.prepare(`SELECT bolao_id FROM bolao_estrategias WHERE bolao_id=?`).bind(bolaoId).first();
  try {
    if (existente) {
      await env.DB.prepare(`
        UPDATE bolao_estrategias SET tipo=?, dezenas_base=?, descricao=?, atualizado_em=?
        WHERE bolao_id=?
      `).bind(tipo, dezenasBase, descricao, agora, bolaoId).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO bolao_estrategias (bolao_id, tipo, dezenas_base, descricao, criado_em)
        VALUES (?,?,?,?,?)
      `).bind(bolaoId, tipo, dezenasBase, descricao, agora).run();
    }
  } catch (err) { throw classifyD1Error(err); }

  return json({ ok: true });
}

// ============================================================
// JOGOS
// ============================================================
export async function getJogos(env, bolaoId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM jogos WHERE bolao_id=? ORDER BY ordem`
  ).bind(bolaoId).all();
  return json({ jogos: results.map(r => serializeJogo(r)) });
}

// Substitui a lista inteira de jogos de um bolão (fluxo "colar e salvar" do
// UC02). Body: { jogos: [[1,2,3,4,5,6], [7,8,9,10,11,12], ...] } — cada item
// já é um array de dezenas (o parse de texto colado acontece no client, mas
// o servidor sempre revalida contra as regras da loteria: não confia no
// client, mesmo padrão de resolverSaldo em negocio.js).
export async function putJogos(env, request, bolaoId) {
  const bolao = await getBolaoOrThrow(env, bolaoId);
  const body = await readJson(request);
  const jogosInput = body.jogos;
  if (!Array.isArray(jogosInput) || jogosInput.length === 0) {
    throw new ApiError(400, 'Informe ao menos um jogo.');
  }

  const erros = [];
  jogosInput.forEach((dezenas, i) => {
    const { valido, erro } = validarJogo(bolao.loteria, dezenas);
    if (!valido) erros.push(`Linha ${i + 1}: ${erro}`);
  });
  if (erros.length) throw new ApiError(400, erros.join(' | '));

  const agora = nowIso();
  const statements = [
    env.DB.prepare(`DELETE FROM jogos WHERE bolao_id=?`).bind(bolaoId),
    ...jogosInput.map((dezenas, i) => env.DB.prepare(`
      INSERT INTO jogos (id, bolao_id, ordem, dezenas, criado_em) VALUES (?,?,?,?,?)
    `).bind(newId(), bolaoId, i + 1, JSON.stringify(dezenas.map(Number)), agora)),
  ];

  try {
    await env.DB.batch(statements);
  } catch (err) { throw classifyD1Error(err); }

  return json({ ok: true, total: jogosInput.length });
}

// ============================================================
// RESULTADO DO SORTEIO
// ============================================================
export async function getResultado(env, bolaoId) {
  const row = await env.DB.prepare(`SELECT * FROM resultados_sorteio WHERE bolao_id=?`).bind(bolaoId).first();
  return json({ resultado: serializeResultado(row) });
}

export async function putResultado(env, request, bolaoId) {
  await getBolaoOrThrow(env, bolaoId);
  const body = await readJson(request);
  const dezenasSorteadas = body.dezenas_sorteadas;
  if (!Array.isArray(dezenasSorteadas) || dezenasSorteadas.length === 0) {
    throw new ApiError(400, 'Informe as dezenas sorteadas.');
  }
  const premiacoes = Array.isArray(body.premiacoes) ? body.premiacoes.map(p => ({
    faixa: p.faixa || null,
    acertos_necessarios: p.acertos_necessarios != null ? Number(p.acertos_necessarios) : null,
    ganhadores: p.ganhadores != null ? Number(p.ganhadores) : null,
    valor_rateio_centavos: p.valor_rateio != null ? toCentavos(p.valor_rateio) : null,
  })) : [];
  const dataApuracao = body.data_apuracao || null;
  const fonte = body.fonte === 'api_caixa' ? 'api_caixa' : 'manual';
  const agora = nowIso();

  const existente = await env.DB.prepare(`SELECT bolao_id FROM resultados_sorteio WHERE bolao_id=?`).bind(bolaoId).first();
  try {
    if (existente) {
      await env.DB.prepare(`
        UPDATE resultados_sorteio
        SET dezenas_sorteadas=?, data_apuracao=?, premiacoes=?, fonte=?, atualizado_em=?
        WHERE bolao_id=?
      `).bind(
        JSON.stringify(dezenasSorteadas.map(Number)), dataApuracao,
        JSON.stringify(premiacoes), fonte, agora, bolaoId,
      ).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO resultados_sorteio (bolao_id, dezenas_sorteadas, data_apuracao, premiacoes, fonte, criado_em)
        VALUES (?,?,?,?,?,?)
      `).bind(
        bolaoId, JSON.stringify(dezenasSorteadas.map(Number)), dataApuracao,
        JSON.stringify(premiacoes), fonte, agora,
      ).run();
    }
  } catch (err) { throw classifyD1Error(err); }

  return json({ ok: true });
}
