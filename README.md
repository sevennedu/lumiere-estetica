# Lumière Estética — site com agendamento online

## Como rodar
```
npm install
npm start
```
Abra http://localhost:3000

- Agendar: /agendar.html
- Meus agendamentos (consulta/cancelamento): /meus-agendamentos.html
- Painel admin: /admin.html — senha padrão `lumiere123` (mude com a variável ADMIN_PASSWORD)

O banco (SQLite) é criado sozinho em `server/data/` com serviços e profissionais de exemplo.
Detalhes da API e regras de agenda: veja SPEC.md.

Equipe: backend por Antigravity (Gemini), front-end por Sonnet 5.5, imagens por DeepSeek V4.1, integração e testes por Claude Opus.

## Publicar no Cloudflare
O site roda como um Worker (`worker/index.js`) com arquivos estáticos de `public/` e banco D1. A versão Express em `server/` continua valendo para uso local.

1. **Login** (uma vez): `npx wrangler login`
2. **Criar o banco D1**: `npx wrangler d1 create lumiere-db` — copie o `database_id` exibido e coloque em `wrangler.jsonc` no lugar de `PREENCHER`.
3. **Aplicar a migration** (schema + dados iniciais):
   ```
   npx wrangler d1 migrations apply lumiere-db --remote
   ```
4. **Definir os segredos** (sem eles `/api/admin/login` responde 503 "Painel admin não configurado."):
   ```
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put TOKEN_SECRET
   ```
   Use uma senha forte e um `TOKEN_SECRET` longo e aleatório (ex.: `openssl rand -hex 32`).
5. **Deploy**: `npx wrangler deploy` — a URL `https://lumiere-estetica.<sua-conta>.workers.dev` é exibida ao final.

Teste local com D1 simulado: `npx wrangler d1 migrations apply lumiere-db --local` e `npx wrangler dev` (porta 8787). Para os segredos locais, crie um arquivo `.dev.vars` (fora do git) com `ADMIN_PASSWORD=...` e `TOKEN_SECRET=...`.
