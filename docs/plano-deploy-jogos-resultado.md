# Plano de Deploy: Jogos, Estratégia e Resultado do Sorteio (MVP)

Este arquivo é pra você colar no Claude Code (ele tem acesso real ao terminal,
ao `wrangler` autenticado na sua conta Cloudflare, e pode rodar tudo sozinho —
eu, no Cowork, não tenho essas credenciais). Cole o conteúdo abaixo como
prompt e peça pra ele executar passo a passo, parando e te avisando se algo
falhar ou se precisar de uma decisão sua.

## Contexto (já feito, não precisa reimplementar)

O código já foi escrito e testado localmente (migração aplicada num SQLite
real, rotas testadas ponta a ponta, JS/HTML sem erro de sintaxe). Arquivos
novos/alterados:

- `worker/migrations/0004_jogos_estrategia_resultado.sql` (novo)
- `worker/src/lib/loterias.js` (novo)
- `worker/src/lib/serializers.js` (alterado — serializers novos)
- `worker/src/routes/jogos.js` (novo)
- `worker/src/routes/public.js` (novo)
- `worker/src/index.js` (alterado — rotas novas + roteamento de `/c/*`)
- `worker/wrangler.toml` (alterado — `/c/*` em `run_worker_first`)
- `worker/public/c.html` (novo — página pública)
- `worker/public/index.html` (alterado — tela "🎱 Jogos" no admin)

Documentação de referência completa: `docs/funcionalidade-jogos-resultado-sorteio.md`.

Nada foi commitado ainda.

## Pré-deploy

- [ ] `cd worker && npm install` (garante binários certos pra sua máquina — os
  que estavam no repo foram instalados no Windows, confirme que ainda batem
  ou reinstale).
- [ ] Revisar o diff: `git status` e `git diff` na raiz do repo.
- [ ] Migração local: `npm run db:migrate:local` (dentro de `worker/`).
- [ ] Smoke test local: `wrangler dev --local`, e testar manualmente (ou via
  curl) pelo menos: `PUT /api/boloes/:id/estrategia`, `PUT /api/boloes/:id/jogos`
  (com um jogo inválido de propósito, pra confirmar que rejeita), `GET
  /api/public/boloes`, `GET /api/public/boloes/:codigo`.
- [ ] Confirmar autenticação: `wrangler whoami` (conta certa da Cloudflare).

## Deploy — staging primeiro

1. Migração remota: `wrangler d1 migrations apply n-chances-db-staging --remote --env staging`
2. Deploy: `wrangler deploy --env staging`
3. Smoke test com login (Access ainda vai pedir login no admin, normal):
   abrir um bolão ABERTO em staging, clicar "🎱 Jogos", cadastrar estratégia,
   colar 2-3 jogos, salvar, registrar um resultado de teste.
4. Tentar abrir `https://staging.nchances.com.br/c/` numa aba anônima (sem
   login). **Vai pedir login do Access ainda** — isso é esperado até o passo
   da seção seguinte ser feito. Não é bug.
5. Fazer o bypass do Access (seção abaixo).
6. Repetir o passo 4 — agora `/c/` deve abrir a lista de bolões sem pedir
   login, e `/c/{codigo}` deve mostrar os jogos com as bolas coloridas.

## Bypass do Cloudflare Access para `/c/*` e `/api/public/*`

Sem isso, ninguém de fora consegue abrir o link público — ele fica atrás do
mesmo login do admin. Duas formas:

**Opção A — via API (Claude Code faz sozinho, se você tiver o token certo)**

Precisa de uma variável `CLOUDFLARE_API_TOKEN` com permissão "Zero Trust ›
Access: Apps and Policies › Edit" e o `account_id` da conta. Com isso, peça
pro Claude Code:
1. `GET /accounts/{account_id}/access/apps` — achar a Access Application que
   protege `nchances.com.br` / `staging.nchances.com.br`.
2. Criar uma Access Application nova (tipo `self_hosted`) restrita ao
   domínio + caminho `/c/*`, com uma única Policy de `decision: "bypass"`
   (sem regra de include — bypass ignora o Access nesse caminho).
3. Repetir para `/api/public/*`.
4. Confirmar a sintaxe exata do payload na doc atual antes de montar a
   chamada (campos mudam entre versões da API):
   https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/

**Opção B — manual (se não tiver token com essa permissão)**

Isso aqui só você faz — é clique em painel, Claude Code não abre navegador:
1. `one.dash.cloudflare.com` → Access → Applications.
2. Na Application que protege `nchances.com.br` (ou numa nova, tipo
   Self-hosted, mesmo domínio, path `/c/*`), adicionar uma Policy no topo da
   lista: Ação = **Bypass**, sem regra de Include — path `/c/*`.
3. Repetir para `/api/public/*`.
4. Repetir tudo isso pra staging e pra produção (domínios diferentes).

## Deploy — produção

7. Migração remota: `wrangler d1 migrations apply n-chances-db-prod --remote --env production`
8. Deploy: `wrangler deploy --env production`
9. Bypass do Access pra `nchances.com.br` / `www.nchances.com.br` (se ainda
   não coberto por uma regra comum da conta).
10. Smoke test final em produção — inclusive abrindo o link `/c/{codigo}`
    pelo celular, simulando o fluxo real de quem recebe pelo WhatsApp.

## Pós-deploy

- [ ] Cadastrar os jogos do próximo concurso já pela tela nova (não mais
  pelo campo `jogos_descricao` livre).
- [ ] Divulgar o link `/c/{codigo}` real.
- [ ] Commit: `git add -A && git commit -m "feat: jogos, estratégia e resultado do sorteio + página pública"`
  (revisar a lista de arquivos no topo antes de commitar).

## Rollback

- Worker quebrado em produção (erro 500, tela branca em `/c/*`):
  `wrangler rollback` — reverte só o Worker, não mexe no D1. As tabelas
  novas não têm dado ainda nesse ponto, sem risco de perda.
- Migração falhar em produção (ex.: "table already exists"): não rodar de
  novo — o D1 rastreia migrações já aplicadas; investigar antes de repetir
  o comando.
- Bypass do Access configurado errado (expondo rota que não devia, tipo
  `/api/boloes/*` sem querer): remover a Policy de bypass na hora, é
  reversível imediatamente pelo dashboard.
