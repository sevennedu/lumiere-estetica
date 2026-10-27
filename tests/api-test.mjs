#!/usr/bin/env node
/**
 * Lumière Estética — teste de fumaça da API.
 *
 * Requer Node.js 24+ (fetch nativo), sem dependências externas.
 *
 * Uso:
 *   node tests/api-test.mjs http://localhost:8787
 *   ADMIN_PASSWORD=segredo node tests/api-test.mjs https://exemplo.workers.dev
 *
 * Sem ADMIN_PASSWORD, os testes que exigem token são marcados como SKIP.
 * Sai com código 1 se qualquer caso falhar.
 */

const BASE_URL = (process.argv[2] || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TIME_ZONE = 'America/Sao_Paulo';
const REQUEST_TIMEOUT_MS = 20000;

if (!BASE_URL) {
  console.error('Uso: node tests/api-test.mjs <url-base>');
  console.error('Ex.: node tests/api-test.mjs http://localhost:8787');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Infra mínima de teste
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    const message = err && err.message ? err.message : String(err);
    failures.push({ name, message });
    console.log(`FAIL  ${name}`);
    console.log(`      ${message.replace(/\n/g, '\n      ')}`);
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`SKIP  ${name} (${reason})`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(res, expected, label) {
  assert(
    res.status === expected,
    `${label}: esperado HTTP ${expected}, recebido HTTP ${res.status} — ${preview(res.text)}`
  );
}

function assertErrorBody(res, label) {
  assert(
    res.json && typeof res.json.error === 'string' && res.json.error.trim().length > 0,
    `${label}: resposta deveria conter {error: "..."} — ${preview(res.text)}`
  );
}

function preview(text, max = 220) {
  if (typeof text !== 'string') return String(text);
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat || '(corpo vazio)';
}

async function api(method, path, { body, rawBody, token, headers = {} } = {}) {
  const url = `${BASE_URL.replace(/\/+$/, '')}${path}`;
  const init = {
    method,
    headers: { ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  };

  if (rawBody !== undefined) {
    init.body = rawBody;
    init.headers['content-type'] = 'application/json';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }

  if (token) init.headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------------------
// Datas no fuso America/Sao_Paulo
// ---------------------------------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, '0');
}

function spTodayYmd() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function dayOfWeekYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function minutesToHHMM(total) {
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function hhmmToMinutes(value) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function nextSundayYmd(today) {
  const dow = dayOfWeekYmd(today);
  const ahead = (7 - dow) % 7 || 7;
  return addDaysYmd(today, ahead);
}

// ---------------------------------------------------------------------------
// Estado compartilhado entre os casos
// ---------------------------------------------------------------------------

const state = {
  services: null,
  professionals: null,
  service: null,
  professional: null,
  slotDate: null,
  slotTime: null,
  payload: null,
  appointment: null,
  adminToken: null
};

function pickPair() {
  const service = state.services.find((s) => Number(s.duration_min) >= 60);
  if (!service) return null;
  const professional = state.professionals.find(
    (p) => Array.isArray(p.serviceIds) && p.serviceIds.includes(service.id)
  );
  if (!professional) return null;
  return { service, professional };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function main() {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const today = spTodayYmd();
  const yesterday = addDaysYmd(today, -1);

  const contact = {
    name: `Teste API ${unique}`,
    email: `teste.api.${unique}@example.com`,
    phone: `(11) 9${String(Date.now()).slice(-8)}`,
    message: `Mensagem automática de teste — acentuação ção ${unique}`
  };

  console.log('');
  console.log(`Lumière Estética — teste da API`);
  console.log(`Base: ${BASE_URL}`);
  console.log(`Hoje (${TIME_ZONE}): ${today}`);
  console.log('');

  // Conectividade -----------------------------------------------------------
  try {
    const res = await api('GET', '/api/services');
    assert(res.status === 200, `GET /api/services respondeu HTTP ${res.status}`);
  } catch (err) {
    console.log('FAIL  Conectividade com a API');
    console.log(`      ${err.message}`);
    console.log('');
    console.log('Resumo: 0 PASS · 1 FAIL · 0 SKIP');
    console.log('A API não está acessível na URL informada.');
    process.exit(1);
  }

  // Serviços ----------------------------------------------------------------
  await test('GET /api/services retorna 8 serviços com todos os campos', async () => {
    const res = await api('GET', '/api/services');
    assertStatus(res, 200, 'GET /api/services');
    assert(Array.isArray(res.json), 'resposta deveria ser um array');
    assert(res.json.length === 8, `esperados 8 serviços, recebidos ${res.json.length}`);

    for (const [index, service] of res.json.entries()) {
      const where = `serviço #${index} (id=${service && service.id})`;
      assert(service && typeof service === 'object', `${where}: item inválido`);
      assert(Number.isInteger(service.id) && service.id > 0, `${where}: id inválido`);
      assert(typeof service.name === 'string' && service.name.trim(), `${where}: name ausente`);
      assert(typeof service.category === 'string' && service.category.trim(), `${where}: category ausente`);
      assert(
        typeof service.description === 'string' && service.description.trim(),
        `${where}: description ausente`
      );
      assert(
        Number.isFinite(service.duration_min) && service.duration_min > 0,
        `${where}: duration_min inválido`
      );
      assert(Number.isFinite(service.price) && service.price >= 0, `${where}: price inválido`);
      assert(
        typeof service.image === 'string' && service.image.startsWith('/assets/img/'),
        `${where}: image deveria apontar para /assets/img/ (recebido: ${service.image})`
      );
    }

    state.services = res.json;
  });

  // Profissionais -----------------------------------------------------------
  await test('GET /api/professionals retorna 4 profissionais com serviceIds', async () => {
    const res = await api('GET', '/api/professionals');
    assertStatus(res, 200, 'GET /api/professionals');
    assert(Array.isArray(res.json), 'resposta deveria ser um array');
    assert(res.json.length === 4, `esperados 4 profissionais, recebidos ${res.json.length}`);

    for (const [index, pro] of res.json.entries()) {
      const where = `profissional #${index} (id=${pro && pro.id})`;
      assert(Number.isInteger(pro.id) && pro.id > 0, `${where}: id inválido`);
      assert(typeof pro.name === 'string' && pro.name.trim(), `${where}: name ausente`);
      assert(typeof pro.role === 'string' && pro.role.trim(), `${where}: role ausente`);
      assert(typeof pro.bio === 'string' && pro.bio.trim(), `${where}: bio ausente`);
      assert(
        typeof pro.photo === 'string' && pro.photo.startsWith('/assets/img/'),
        `${where}: photo deveria apontar para /assets/img/`
      );
      assert(Array.isArray(pro.serviceIds) && pro.serviceIds.length > 0, `${where}: serviceIds ausente`);
      assert(
        pro.serviceIds.every((id) => Number.isInteger(id) && id > 0),
        `${where}: serviceIds contém valores inválidos`
      );
    }

    state.professionals = res.json;
  });

  await test('GET /api/professionals?serviceId= filtra por serviço', async () => {
    assert(state.services && state.professionals, 'depende dos testes anteriores');
    const pair = pickPair();
    assert(pair, 'nenhum serviço com duração >= 60 min vinculado a uma profissional');
    state.service = pair.service;
    state.professional = pair.professional;

    const res = await api(
      'GET',
      `/api/professionals?serviceId=${encodeURIComponent(pair.service.id)}`
    );
    assertStatus(res, 200, 'GET /api/professionals?serviceId');
    assert(Array.isArray(res.json), 'resposta deveria ser um array');
    assert(res.json.length > 0, `nenhuma profissional retornada para o serviço ${pair.service.id}`);
    for (const pro of res.json) {
      assert(
        pro.serviceIds.includes(pair.service.id),
        `profissional ${pro.id} retornada mas não realiza o serviço ${pair.service.id}`
      );
    }
  });

  // Disponibilidade ---------------------------------------------------------
  await test('GET /api/availability retorna slots em dia útil futuro', async () => {
    assert(state.service && state.professional, 'depende dos testes anteriores');

    const duration = Number(state.service.duration_min);
    const closeMin = 19 * 60; // seg–sex, 09:00–19:00
    let chosen = null;

    // Procura um dia útil futuro (seg–sex) com pelo menos um slot que permita
    // também testar sobreposição parcial de 30 min dentro do expediente.
    for (let offset = 1; offset <= 21 && !chosen; offset++) {
      const date = addDaysYmd(today, offset);
      const dow = dayOfWeekYmd(date);
      if (dow === 0 || dow === 6) continue;

      const res = await api(
        'GET',
        `/api/availability?serviceId=${state.service.id}` +
          `&professionalId=${state.professional.id}&date=${date}`
      );
      if (res.status !== 200) continue;
      const slots = res.json && res.json.slots;
      if (!Array.isArray(slots) || slots.length === 0) continue;

      for (const slot of slots) {
        assert(
          typeof slot === 'string' && /^\d{2}:\d{2}$/.test(slot),
          `slot em formato inesperado: ${JSON.stringify(slot)}`
        );
      }

      const usable = slots.find((slot) => hhmmToMinutes(slot) + duration + 30 <= closeMin);
      if (usable) chosen = { date, slots, usable };
    }

    assert(
      chosen,
      'nenhum dia útil futuro com horário livre nos próximos 21 dias (verifique seed e agenda)'
    );

    const parsed = chosen.slots.map(hhmmToMinutes);
    for (let i = 1; i < parsed.length; i++) {
      assert(parsed[i] > parsed[i - 1], `slots fora de ordem em ${chosen.date}: ${chosen.slots.join(', ')}`);
    }
    assert(
      parsed.every((min) => min % 30 === 0),
      `slots fora do intervalo de 30 min: ${chosen.slots.join(', ')}`
    );
    assert(parsed.every((min) => min >= 9 * 60 && min < closeMin), 'slots fora do expediente');

    state.slotDate = chosen.date;
    state.slotTime = chosen.usable;
  });

  await test('GET /api/availability em domingo retorna lista vazia', async () => {
    assert(state.service && state.professional, 'depende dos testes anteriores');
    const sunday = nextSundayYmd(today);

    const res = await api(
      'GET',
      `/api/availability?serviceId=${state.service.id}` +
        `&professionalId=${state.professional.id}&date=${sunday}`
    );
    assertStatus(res, 200, 'GET /api/availability (domingo)');
    assert(res.json && res.json.date === sunday, `campo date deveria ser ${sunday}`);
    assert(Array.isArray(res.json.slots), 'campo slots deveria ser um array');
    assert(res.json.slots.length === 0, `domingo deveria estar vazio, recebidos: ${res.json.slots.join(', ')}`);
  });

  await test('GET /api/availability sem parâmetros retorna 400', async () => {
    const noParams = await api('GET', '/api/availability');
    assertStatus(noParams, 400, 'GET /api/availability sem parâmetros');
    assertErrorBody(noParams, 'GET /api/availability sem parâmetros');

    const missingDate = await api(
      'GET',
      `/api/availability?serviceId=${state.service.id}&professionalId=${state.professional.id}`
    );
    assertStatus(missingDate, 400, 'GET /api/availability sem date');
    assertErrorBody(missingDate, 'GET /api/availability sem date');
  });

  // Agendamento -------------------------------------------------------------
  await test('POST /api/appointments cria agendamento (201, código LUM-)', async () => {
    assert(state.slotDate && state.slotTime, 'depende dos testes anteriores');

    state.payload = {
      serviceId: state.service.id,
      professionalId: state.professional.id,
      date: state.slotDate,
      time: state.slotTime,
      name: `Teste API ${unique}`,
      phone: contact.phone,
      email: contact.email,
      notes: `Agendamento automático — acentuação ção ${unique}`
    };

    const res = await api('POST', '/api/appointments', { body: state.payload });
    assertStatus(res, 201, 'POST /api/appointments');
    assert(res.json && typeof res.json === 'object', 'resposta deveria ser um objeto');

    const appt = res.json;
    assert(typeof appt.code === 'string' && appt.code.startsWith('LUM-'), `código inválido: ${appt.code}`);
    assert(/^LUM-[A-Z0-9]{4,10}$/.test(appt.code), `formato de código inesperado: ${appt.code}`);
    assert(Number.isInteger(appt.id) && appt.id > 0, `id inválido: ${appt.id}`);
    assert(appt.status === 'confirmado', `status inicial deveria ser "confirmado", recebido "${appt.status}"`);
    assert(appt.date === state.payload.date, `date divergente: ${appt.date}`);
    assert(appt.time === state.payload.time, `time divergente: ${appt.time}`);
    assert(
      String(appt.email).toLowerCase() === contact.email,
      `e-mail deveria ser normalizado para minúsculas: ${appt.email}`
    );

    state.appointment = appt;
  });

  await test('POST /api/appointments no mesmo horário retorna 409', async () => {
    assert(state.appointment, 'depende dos testes anteriores');
    const res = await api('POST', '/api/appointments', { body: state.payload });
    assertStatus(res, 409, 'duplicado');
    assertErrorBody(res, 'duplicado');
  });

  await test('POST /api/appointments com sobreposição parcial (30 min) retorna 409', async () => {
    assert(state.appointment, 'depende dos testes anteriores');
    const overlapping = {
      ...state.payload,
      time: minutesToHHMM(hhmmToMinutes(state.payload.time) + 30),
      email: `overlap.${unique}@example.com`
    };
    const res = await api('POST', '/api/appointments', { body: overlapping });
    assertStatus(res, 409, 'sobreposição parcial');
    assertErrorBody(res, 'sobreposição parcial');
  });

  await test('POST /api/appointments em data passada retorna 400', async () => {
    const res = await api('POST', '/api/appointments', {
      body: { ...state.payload, date: yesterday, time: '10:00', email: `passado.${unique}@example.com` }
    });
    assertStatus(res, 400, 'data passada');
    assertErrorBody(res, 'data passada');
  });

  await test('POST /api/appointments com horário fora de 30 min retorna 400', async () => {
    const res = await api('POST', '/api/appointments', {
      body: { ...state.payload, time: '10:15', email: `fora30.${unique}@example.com` }
    });
    assertStatus(res, 400, 'horário 10:15');
    assertErrorBody(res, 'horário 10:15');
  });

  // Consulta e cancelamento -------------------------------------------------
  await test('GET /api/appointments/lookup encontra por e-mail + telefone', async () => {
    assert(state.appointment, 'depende dos testes anteriores');
    const query =
      `?email=${encodeURIComponent(contact.email)}` +
      `&phone=${encodeURIComponent(contact.phone)}`;

    const res = await api('GET', `/api/appointments/lookup${query}`);
    assertStatus(res, 200, 'GET /api/appointments/lookup');
    assert(Array.isArray(res.json), 'resposta deveria ser um array');

    const found = res.json.find((item) => item.code === state.appointment.code);
    assert(found, `agendamento ${state.appointment.code} não apareceu no lookup`);
    assert(found.status === 'confirmado', `status no lookup deveria ser "confirmado": ${found.status}`);
    assert(typeof found.service === 'string' && found.service.trim(), 'campo service ausente');
    assert(
      typeof found.professional === 'string' && found.professional.trim(),
      'campo professional ausente'
    );
  });

  await test('PATCH /api/appointments/:code/cancel com e-mail errado retorna 400', async () => {
    assert(state.appointment, 'depende dos testes anteriores');
    const res = await api('PATCH', `/api/appointments/${state.appointment.code}/cancel`, {
      body: { email: `outro.${unique}@example.com` }
    });
    assertStatus(res, 400, 'cancelamento com e-mail errado');
    assertErrorBody(res, 'cancelamento com e-mail errado');
  });

  await test('PATCH /api/appointments/:code/cancel com e-mail correto retorna 200', async () => {
    assert(state.appointment, 'depende dos testes anteriores');
    const res = await api('PATCH', `/api/appointments/${state.appointment.code}/cancel`, {
      body: { email: contact.email }
    });
    assertStatus(res, 200, 'cancelamento com e-mail correto');
    assert(res.json && res.json.ok === true, `resposta deveria ser {ok:true} — ${preview(res.text)}`);
  });

  await test('Horário volta a ficar livre após o cancelamento', async () => {
    assert(state.appointment, 'depende dos testes anteriores');
    const res = await api(
      'GET',
      `/api/availability?serviceId=${state.service.id}` +
        `&professionalId=${state.professional.id}&date=${state.slotDate}`
    );
    assertStatus(res, 200, 'GET /api/availability após cancelar');
    assert(Array.isArray(res.json && res.json.slots), 'campo slots deveria ser um array');
    assert(
      res.json.slots.includes(state.appointment.time),
      `horário ${state.appointment.time} não voltou à lista de livres: ${res.json.slots.join(', ')}`
    );
  });

  // Contato -----------------------------------------------------------------
  await test('POST /api/contact válido retorna 201', async () => {
    const res = await api('POST', '/api/contact', { body: contact });
    assertStatus(res, 201, 'POST /api/contact');
    assert(res.json && res.json.ok === true, `resposta deveria ser {ok:true} — ${preview(res.text)}`);
  });

  await test('POST /api/contact sem mensagem retorna 400', async () => {
    const res = await api('POST', '/api/contact', {
      body: { name: contact.name, email: contact.email, phone: contact.phone }
    });
    assertStatus(res, 400, 'POST /api/contact inválido');
    assertErrorBody(res, 'POST /api/contact inválido');
  });

  // Admin -------------------------------------------------------------------
  await test('POST /api/admin/login com senha errada retorna 401', async () => {
    const res = await api('POST', '/api/admin/login', {
      body: { password: `senha-errada-${unique}` }
    });
    assertStatus(res, 401, 'login com senha errada');
    assertErrorBody(res, 'login com senha errada');
  });

  await test('GET /api/admin/appointments sem token retorna 401', async () => {
    const res = await api('GET', '/api/admin/appointments');
    assertStatus(res, 401, 'admin sem token');
    assertErrorBody(res, 'admin sem token');
  });

  if (ADMIN_PASSWORD) {
    await test('POST /api/admin/login com ADMIN_PASSWORD retorna token', async () => {
      const res = await api('POST', '/api/admin/login', { body: { password: ADMIN_PASSWORD } });
      assertStatus(res, 200, 'login admin');
      assert(res.json && typeof res.json.token === 'string', 'resposta deveria conter token');
      assert(res.json.token.trim().length > 0, 'token vazio');
      state.adminToken = res.json.token;
    });

    await test('GET /api/admin/appointments com token lista agendamentos', async () => {
      assert(state.adminToken, 'depende do login admin');
      assert(state.appointment, 'depende do agendamento criado');
      const res = await api(
        'GET',
        `/api/admin/appointments?date=${encodeURIComponent(state.slotDate)}`,
        { token: state.adminToken }
      );
      assertStatus(res, 200, 'admin listar');
      assert(Array.isArray(res.json), 'resposta deveria ser um array');
      const found = res.json.find((item) => item.code === state.appointment.code);
      assert(found, `agendamento ${state.appointment.code} não apareceu na listagem`);
    });

    await test('PATCH /api/admin/appointments/:id muda status para "concluído"', async () => {
      assert(state.adminToken && state.appointment, 'depende dos testes anteriores');
      const res = await api('PATCH', `/api/admin/appointments/${state.appointment.id}`, {
        token: state.adminToken,
        body: { status: 'concluído' }
      });
      assertStatus(res, 200, 'admin mudar status');
      assert(res.json && res.json.status === 'concluído', `status deveria ser "concluído", recebido "${res.json && res.json.status}"`);
      assert(res.json.id === state.appointment.id, 'id divergente no retorno');
    });

    await test('PATCH /api/admin/appointments/:id com status inválido retorna 400', async () => {
      assert(state.adminToken && state.appointment, 'depende dos testes anteriores');
      const res = await api('PATCH', `/api/admin/appointments/${state.appointment.id}`, {
        token: state.adminToken,
        body: { status: 'pendente' }
      });
      assertStatus(res, 400, 'admin status inválido');
      assertErrorBody(res, 'admin status inválido');
    });
  } else {
    skip('Admin: login com senha, listar, mudar status e status inválido', 'ADMIN_PASSWORD não definido');
  }

  // Rotas e JSON ------------------------------------------------------------
  await test('Rota /api inexistente retorna 404', async () => {
    const res = await api('GET', `/api/rota-inexistente-${unique}`);
    assertStatus(res, 404, 'rota inexistente');
    assertErrorBody(res, 'rota inexistente');
  });

  await test('JSON inválido retorna 400', async () => {
    const res = await api('POST', '/api/contact', { rawBody: '{"name": "Teste",' });
    assertStatus(res, 400, 'JSON inválido');
    assertErrorBody(res, 'JSON inválido');
  });

  // Resumo ------------------------------------------------------------------
  const total = passed + failed + skipped;
  console.log('');
  console.log(
    `Resumo: ${passed} PASS · ${failed} FAIL · ${skipped} SKIP (${total} casos)`
  );
  if (failures.length > 0) {
    console.log('');
    console.log('Falhas:');
    for (const f of failures) console.log(`- ${f.name}: ${f.message.split('\n')[0]}`);
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('');
  console.error(`Erro inesperado no teste: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
