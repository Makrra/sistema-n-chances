// Endpoints públicos (sem Cloudflare Access — ver seção 10 do documento:
// a política de bypass para /api/public/* e /c/* precisa ser criada à parte
// no Zero Trust Dashboard, isso aqui só cuida do código).
//
// Regra de ouro destas rotas: NUNCA retornar telefone, nome ou qualquer dado
// de participação/pagamento. Só o conteúdo do concurso (ver seção 9.2/10).
import { ApiError } from '../lib/errors.js';
import { json } from '../lib/http.js';
import { serializeEstrategia, serializeJogo, serializeResultado, serializePublicoResumo } from '../lib/serializers.js';

// GET /api/public/boloes — home pública (UC11): lista os bolões relevantes,
// mais recentes primeiro. Critério da seção 9.1: ABERTO, FECHADO ou SORTEADO,
// sem paginação na v1.
export async function listPublico(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM boloes
    WHERE status IN ('ABERTO','FECHADO','SORTEADO') AND codigo IS NOT NULL
    ORDER BY data_sorteio DESC
  `).all();
  return json({ boloes: results.map(serializePublicoResumo) });
}

// GET /api/public/boloes/:codigo — detalhe do bolão (UC08-UC10): estratégia,
// jogos (com acertos já calculados, se houver resultado) e resultado
// detalhado do sorteio.
export async function detailPublico(env, codigo) {
  const bolao = await env.DB.prepare(`SELECT * FROM boloes WHERE codigo=?`).bind(codigo).first();
  if (!bolao) throw new ApiError(404, 'Bolão não encontrado.');

  const [estrategiaRow, jogosRes, resultadoRow] = await Promise.all([
    env.DB.prepare(`SELECT * FROM bolao_estrategias WHERE bolao_id=?`).bind(bolao.id).first(),
    env.DB.prepare(`SELECT * FROM jogos WHERE bolao_id=? ORDER BY ordem`).bind(bolao.id).all(),
    env.DB.prepare(`SELECT * FROM resultados_sorteio WHERE bolao_id=?`).bind(bolao.id).first(),
  ]);

  const resultado = serializeResultado(resultadoRow);
  const dezenasSorteadas = resultado?.dezenas_sorteadas || null;
  const jogos = jogosRes.results.map(r => serializeJogo(r, dezenasSorteadas));
  // Mais acertos primeiro (seção 9.2), mas só depois de ter resultado —
  // sem resultado, mantém a ordem de cadastro (ordem crescente).
  if (dezenasSorteadas) jogos.sort((a, b) => b.acertos - a.acertos);

  return json({
    bolao: serializePublicoResumo(bolao),
    estrategia: serializeEstrategia(estrategiaRow),
    jogos,
    resultado,
  });
}
