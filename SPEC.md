# Lumière Estética — site com agendamento online

Clínica de estética fictícia "Lumière Estética Avançada". Site em português (pt-BR).
Paleta: nude/rosé (#E8CFC4), dourado suave (#C9A27E), off-white (#FAF6F2), grafite (#2E2A28).
Fontes: "Cormorant Garamond" (títulos) + "Inter" (texto), via Google Fonts.

## Estrutura de pastas (cada IA só mexe na sua parte)
```
/server/              -> ANTIGRAVITY (backend)
/package.json         -> ANTIGRAVITY
/public/*.html, /public/css, /public/js  -> SONNET (front-end)
/public/assets/img/   -> DEEPSEEK (imagens SVG)
```
Rodar: `npm install` e `npm start` -> http://localhost:3000

## Stack
- Node.js 24 + Express. Banco: SQLite embutido do Node (`node:sqlite`, DatabaseSync) em `server/data/clinica.db` — sem dependências nativas.
- Express serve `/public` como estático. Front-end em HTML/CSS/JS puro (sem framework, sem build).

## Páginas (front-end)
- `index.html`: hero, sobre, serviços (cards vindos da API), equipe, depoimentos, galeria antes/depois, CTA, contato/mapa, rodapé, botão WhatsApp flutuante.
- `agendar.html`: wizard em 4 passos -> 1) serviço 2) profissional (filtrado pelo serviço) 3) data + horário (horários livres da API) 4) dados (nome, telefone, e-mail, observações) + confirmação. Tela final com código do agendamento.
- `meus-agendamentos.html`: busca por e-mail + telefone, lista agendamentos, permite cancelar.
- `admin.html`: login com senha, lista agendamentos por data, filtrar por status, mudar status (confirmado/concluído/cancelado).

## Contrato da API (JSON) — prefixo /api
| Método | Rota | Corpo/Query | Resposta |
|---|---|---|---|
| GET | /api/services | — | `[{id, name, category, description, duration_min, price, image}]` |
| GET | /api/professionals | `?serviceId=` opcional | `[{id, name, role, bio, photo, serviceIds:[...]}]` |
| GET | /api/availability | `?serviceId=&professionalId=&date=YYYY-MM-DD` | `{date, slots:["09:00","09:30",...]}` (só horários livres) |
| POST | /api/appointments | `{serviceId, professionalId, date, time, name, phone, email, notes}` | 201 `{id, code, status:"confirmado", ...}`; 409 se horário ocupado; 400 se inválido |
| GET | /api/appointments/lookup | `?email=&phone=` | `[{id, code, service, professional, date, time, status}]` |
| PATCH | /api/appointments/:code/cancel | `{email}` | `{ok:true}` |
| POST | /api/contact | `{name, email, phone, message}` | 201 `{ok:true}` |
| POST | /api/admin/login | `{password}` | `{token}` (senha padrão em env ADMIN_PASSWORD, default `lumiere123`) |
| GET | /api/admin/appointments | header `Authorization: Bearer <token>`, `?date=&status=` | lista completa |
| PATCH | /api/admin/appointments/:id | `{status}` | registro atualizado |

Erros sempre como `{error:"mensagem em português"}`.

## Regras de agenda
- Funcionamento: seg–sex 09:00–19:00, sáb 09:00–14:00, domingo fechado. Slots de 30 min.
- Um horário só é livre se cabe toda a duração do serviço sem sobrepor outro agendamento (não cancelado) do mesmo profissional e sem passar do fechamento.
- Não permite datas passadas nem horários que já passaram hoje.

## Dados iniciais (seed)
Serviços (~8): Limpeza de Pele Profunda, Peeling de Diamante, Harmonização Facial, Toxina Botulínica, Preenchimento Labial, Drenagem Linfática, Massagem Modeladora, Depilação a Laser.
Profissionais (4): Dra. Helena Duarte (biomédica esteta), Dra. Camila Rocha (dermatologista), Juliana Prado (esteticista), Marina Alves (fisioterapeuta dermatofuncional) — cada uma ligada a serviços compatíveis.
Campo `image`/`photo` aponta para `/assets/img/<arquivo>.svg` (nomes na seção abaixo).

## Imagens (DeepSeek gera como SVG em /public/assets/img/)
logo.svg, hero.svg, about.svg, svc-limpeza.svg, svc-peeling.svg, svc-harmonizacao.svg, svc-botox.svg, svc-labial.svg, svc-drenagem.svg, svc-massagem.svg, svc-laser.svg, prof-helena.svg, prof-camila.svg, prof-juliana.svg, prof-marina.svg, antes-depois-1.svg, antes-depois-2.svg, antes-depois-3.svg, favicon.svg
Estilo: ilustração flat/linha elegante, usando a paleta acima. Sem texto embutido (exceto logo).
