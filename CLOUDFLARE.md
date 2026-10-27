# Migração para Cloudflare Workers + D1

Objetivo: o mesmo site (public/) e a mesma API (contrato em SPEC.md) rodando no Cloudflare.
A versão Express em server/ continua existindo para uso local — NÃO apague nem altere server/.

## Arquitetura
- Um Worker em `worker/index.js` (ES module, `export default { async fetch(request, env, ctx) }`), sem frameworks e sem dependências npm.
- Arquivos estáticos de `public/` servidos pelo Workers Static Assets (binding `ASSETS`). O Worker só recebe `/api/*` (`run_worker_first: ["/api/*"]`).
- Banco D1, binding `DB`, nome `lumiere-db`. Schema + seed em `migrations/0001_init.sql` (JÁ EXISTE, não altere sem avisar).
  - Diferença do schema local: `appointments` tem a coluna extra `start_min INTEGER` (minutos desde 00:00) e `created_at` é preenchido pelo Worker (sem default).
- Segredos (env): `ADMIN_PASSWORD` e `TOKEN_SECRET`. Se algum não estiver definido, /api/admin/login responde 503 `{error:"Painel admin não configurado."}`. NÃO existe senha padrão.

## Regras obrigatórias do Worker
1. Mesmas rotas, validações, mensagens e formatos de resposta de `server/index.js` (é a referência — porte fiel).
2. Fuso: o Worker roda em UTC. "Hoje" e "agora" devem ser calculados em `America/Sao_Paulo` com `Intl.DateTimeFormat`. `created_at` também em horário de Brasília (`YYYY-MM-DD HH:MM:SS`).
3. Conflito atômico: o INSERT de agendamento deve ser um único `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE professional_id=? AND date=? AND status!='cancelado' AND start_min < ?novoFim AND start_min+duration_min > ?novoInicio)`. Se `meta.changes === 0` -> 409.
4. Token admin sem estado: `base64url(payload).base64url(hmacSHA256)` via Web Crypto, payload `{exp}` com validade de 12h; comparar assinatura em tempo constante.
5. JSON inválido -> 400 `{error:"Corpo da requisição em formato JSON inválido."}`. Rota /api inexistente -> 404. Erro inesperado -> 500 com mensagem em português (sem stack).
6. Código do agendamento `LUM-XXXXXX` com `crypto.getRandomValues`.

## Arquivos e donos
| Arquivo | Dono |
|---|---|
| worker/index.js | Antigravity |
| wrangler.jsonc, ajustes em public/ (se precisar), seção de deploy no README.md | Sonnet (Claude Code #2) |
| tests/api-test.mjs | DeepSeek (OpenCode) |
| criar D1, segredos, `wrangler dev`, deploy | Claude Code (líder) |

## Teste local
`npx.cmd wrangler d1 migrations apply lumiere-db --local` e `npx.cmd wrangler dev` (porta 8787).
`node tests/api-test.mjs http://localhost:8787` deve passar 100%.
