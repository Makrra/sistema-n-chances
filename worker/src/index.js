import { ApiError } from './lib/errors.js';
import { json } from './lib/http.js';
import * as dashboard from './routes/dashboard.js';
import * as boloes from './routes/boloes.js';
import * as participacoes from './routes/participacoes.js';
import * as usuarios from './routes/usuarios.js';
import * as extrato from './routes/extrato.js';
import * as saques from './routes/saques.js';
import * as jogos from './routes/jogos.js';
import * as publico from './routes/public.js';

async function healthCheck(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM usuarios').first();
  return json({ ok: true, usuarios: row.n });
}

const routes = [
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/health' }),                        handler: (env) => healthCheck(env) },
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/dashboard' }),                      handler: (env) => dashboard.getDashboard(env) },

  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/boloes' }),                         handler: (env) => boloes.list(env) },
  { method: 'POST',   pattern: new URLPattern({ pathname: '/api/boloes' }),                         handler: (env, req) => boloes.create(env, req) },
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/boloes/:id' }),                     handler: (env, req, p) => boloes.detail(env, p.id) },
  { method: 'PUT',    pattern: new URLPattern({ pathname: '/api/boloes/:id' }),                     handler: (env, req, p) => boloes.update(env, req, p.id) },
  { method: 'DELETE', pattern: new URLPattern({ pathname: '/api/boloes/:id' }),                     handler: (env, req, p) => boloes.remove(env, p.id) },
  { method: 'PATCH',  pattern: new URLPattern({ pathname: '/api/boloes/:id/status' }),              handler: (env, req, p) => boloes.updateStatus(env, req, p.id) },
  { method: 'POST',   pattern: new URLPattern({ pathname: '/api/boloes/:id/sortear' }),             handler: (env, req, p) => boloes.sortear(env, req, p.id) },
  { method: 'POST',   pattern: new URLPattern({ pathname: '/api/boloes/:id/participacoes' }),       handler: (env, req, p) => boloes.addParticipacao(env, req, p.id) },

  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/participacoes/pendentes' }),        handler: (env) => participacoes.listarPendentes(env) },
  { method: 'PATCH',  pattern: new URLPattern({ pathname: '/api/participacoes/:id/pagar' }),        handler: (env, req, p) => participacoes.marcarPago(env, req, p.id) },
  { method: 'PATCH',  pattern: new URLPattern({ pathname: '/api/participacoes/:id/comprovante' }),  handler: (env, req, p) => participacoes.marcarComprovante(env, p.id) },
  { method: 'PUT',    pattern: new URLPattern({ pathname: '/api/participacoes/:id' }),              handler: (env, req, p) => participacoes.update(env, req, p.id) },
  { method: 'DELETE', pattern: new URLPattern({ pathname: '/api/participacoes/:id' }),              handler: (env, req, p) => participacoes.remove(env, p.id) },

  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/usuarios' }),                       handler: (env) => usuarios.list(env) },
  { method: 'POST',   pattern: new URLPattern({ pathname: '/api/usuarios' }),                       handler: (env, req) => usuarios.create(env, req) },
  { method: 'PUT',    pattern: new URLPattern({ pathname: '/api/usuarios/:telefone' }),             handler: (env, req, p) => usuarios.update(env, req, p.telefone) },
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/usuarios/:telefone/saldo' }),       handler: (env, req, p) => usuarios.saldo(env, p.telefone) },
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/usuarios/:telefone/extrato' }),     handler: (env, req, p) => usuarios.extratoDe(env, p.telefone) },
  { method: 'POST',   pattern: new URLPattern({ pathname: '/api/usuarios/:telefone/extrato' }),     handler: (env, req, p) => usuarios.criarLancamento(env, req, p.telefone) },

  { method: 'DELETE', pattern: new URLPattern({ pathname: '/api/extrato/:id' }),                    handler: (env, req, p) => extrato.remove(env, p.id) },

  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/saques' }),                         handler: (env, req) => saques.list(env, req) },
  { method: 'POST',   pattern: new URLPattern({ pathname: '/api/saques' }),                         handler: (env, req) => saques.create(env, req) },
  { method: 'PATCH',  pattern: new URLPattern({ pathname: '/api/saques/:id' }),                     handler: (env, req, p) => saques.process(env, req, p.id) },

  // Jogos / estratégia / resultado do sorteio (organizador — atrás do
  // Cloudflare Access, igual às rotas acima). Ver
  // docs/funcionalidade-jogos-resultado-sorteio.md, seção 7.
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/boloes/:id/estrategia' }),          handler: (env, req, p) => jogos.getEstrategia(env, p.id) },
  { method: 'PUT',    pattern: new URLPattern({ pathname: '/api/boloes/:id/estrategia' }),          handler: (env, req, p) => jogos.putEstrategia(env, req, p.id) },
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/boloes/:id/jogos' }),               handler: (env, req, p) => jogos.getJogos(env, p.id) },
  { method: 'PUT',    pattern: new URLPattern({ pathname: '/api/boloes/:id/jogos' }),               handler: (env, req, p) => jogos.putJogos(env, req, p.id) },
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/boloes/:id/resultado' }),           handler: (env, req, p) => jogos.getResultado(env, p.id) },
  { method: 'PUT',    pattern: new URLPattern({ pathname: '/api/boloes/:id/resultado' }),           handler: (env, req, p) => jogos.putResultado(env, req, p.id) },

  // Rotas públicas (sem Cloudflare Access — ver seção 10: bypass precisa ser
  // configurado à parte no Zero Trust Dashboard para /api/public/* e /c/*).
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/public/boloes' }),                  handler: (env) => publico.listPublico(env) },
  { method: 'GET',    pattern: new URLPattern({ pathname: '/api/public/boloes/:codigo' }),          handler: (env, req, p) => publico.detailPublico(env, p.codigo) },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Página pública (home /c/ e detalhe /c/:codigo) — bundle estático
    // próprio (public/c.html), servido explicitamente aqui em vez de cair no
    // fallback SPA do admin (single-page-application em [assets], que serviria
    // index.html — a tela do organizador — para qualquer caminho
    // desconhecido). '/c/*' precisa estar em run_worker_first no
    // wrangler.toml para as requisições chegarem até aqui; ver seção 10 do
    // documento. O roteamento entre lista e detalhe é feito no próprio
    // client-side de c.html, lendo location.pathname.
    if (url.pathname === '/c' || url.pathname.startsWith('/c/')) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/c.html';
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    if (!url.pathname.startsWith('/api/')) {
      return json({ error: 'not_found' }, 404);
    }

    for (const route of routes) {
      if (route.method !== request.method) continue;
      const match = route.pattern.exec(url);
      if (!match) continue;
      const params = match.pathname.groups;
      try {
        return await route.handler(env, request, params);
      } catch (err) {
        if (err instanceof ApiError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: 'Erro interno do servidor.' }, 500);
      }
    }
    return json({ error: 'not_found' }, 404);
  },
};
