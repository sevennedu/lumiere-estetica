// Lumière Estética Avançada — Cloudflare Worker + D1
// Porte fiel de server/index.js seguindo CLOUDFLARE.md e SPEC.md

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const brtFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

// ============================================================================
// Helpers de fuso horário (America/Sao_Paulo), data, horário e validação
// ============================================================================

function getNowBrazilInfo() {
  const parts = brtFormatter.formatToParts(new Date());
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  const year = map.year;
  const month = map.month;
  const day = map.day;
  const hour = map.hour === '24' ? '00' : map.hour;
  const minute = map.minute;
  const second = map.second;

  const todayStr = `${year}-${month}-${day}`;
  const currentMinutes = Number(hour) * 60 + Number(minute);
  const createdAt = `${todayStr} ${hour}:${minute}:${second}`;

  return { todayStr, currentMinutes, createdAt };
}

function parseDateYYYYMMDD(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, dateObj: dt, dayOfWeek: dt.getUTCDay() };
}

function parseTimeHHMM(timeStr) {
  if (typeof timeStr !== 'string' || !/^\d{2}:\d{2}$/.test(timeStr)) {
    return null;
  }
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function minutesToHHMM(totalMinutes) {
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const m = String(totalMinutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// Funcionamento: seg–sex 09:00–19:00, sáb 09:00–14:00, domingo fechado
function getOperatingHours(dayOfWeek) {
  if (dayOfWeek === 0) {
    return null; // Domingo fechado
  }
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    return { openMin: 9 * 60, closeMin: 19 * 60 }; // 09:00 - 19:00
  }
  if (dayOfWeek === 6) {
    return { openMin: 9 * 60, closeMin: 14 * 60 }; // 09:00 - 14:00
  }
  return null;
}

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizePhone(phone) {
  if (typeof phone !== 'string') return '';
  return phone.replace(/\D/g, '');
}

async function generateAppointmentCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = new Uint8Array(6);

  for (let attempt = 0; attempt < 20; attempt++) {
    crypto.getRandomValues(rand);
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars[rand[i] % chars.length];
    }
    const code = `LUM-${suffix}`;
    const existing = await db
      .prepare('SELECT id FROM appointments WHERE code = ?')
      .bind(code)
      .first();
    if (!existing) {
      return code;
    }
  }

  crypto.getRandomValues(rand);
  let fallback = '';
  for (let i = 0; i < 6; i++) {
    fallback += chars[rand[i] % chars.length];
  }
  return `LUM-${fallback}`;
}

// ============================================================================
// Autenticação Admin sem estado (Web Crypto HMAC-SHA256 + base64url, exp 12h)
// ============================================================================

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeString(str) {
  return base64UrlEncodeBytes(encoder.encode(str));
}

function base64UrlDecodeToBytes(b64url) {
  if (typeof b64url !== 'string' || !/^[A-Za-z0-9_-]+$/.test(b64url)) {
    return null;
  }
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const withPad = padded + '='.repeat(padLen);
  try {
    const binary = atob(withPad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function timingSafeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createAdminToken(secret) {
  const payload = { exp: Date.now() + 12 * 60 * 60 * 1000 };
  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
  const key = await importHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(sigBuffer));
  return `${payloadB64}.${sigB64}`;
}

async function isValidAdminToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return false;

  const sigBytes = base64UrlDecodeToBytes(sigB64);
  if (!sigBytes) return false;

  const key = await importHmacKey(secret);
  const expectedBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const expectedBytes = new Uint8Array(expectedBuffer);

  if (!timingSafeEqualBytes(sigBytes, expectedBytes)) {
    return false;
  }

  const payloadBytes = base64UrlDecodeToBytes(payloadB64);
  if (!payloadBytes) return false;

  try {
    const payload = JSON.parse(decoder.decode(payloadBytes));
    if (!payload || typeof payload.exp !== 'number') return false;
    const expMs = payload.exp < 1e12 ? payload.exp * 1000 : payload.exp;
    if (Date.now() >= expMs) return false;
    return true;
  } catch {
    return false;
  }
}

async function checkAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Não autorizado. Token ausente.' }, 401);
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!env || !env.TOKEN_SECRET) {
    return jsonResponse({ error: 'Sessão inválida ou expirada.' }, 401);
  }
  const valid = await isValidAdminToken(token, env.TOKEN_SECRET);
  if (!valid) {
    return jsonResponse({ error: 'Sessão inválida ou expirada.' }, 401);
  }
  return null;
}

// ============================================================================
// Helpers de agenda e leitura de JSON
// ============================================================================

async function parseJsonBody(request, allowEmpty = false) {
  const raw = await request.text();
  if (!raw || raw.trim() === '') {
    if (allowEmpty) return { ok: true, data: {} };
    return { ok: true, data: {} };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        response: jsonResponse({ error: 'Corpo da requisição em formato JSON inválido.' }, 400)
      };
    }
    return { ok: true, data: parsed };
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: 'Corpo da requisição em formato JSON inválido.' }, 400)
    };
  }
}

async function getOccupiedIntervals(db, professionalId, dateStr) {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.time, a.start_min, COALESCE(a.duration_min, s.duration_min) AS duration_min
       FROM appointments a
       LEFT JOIN services s ON s.id = a.service_id
       WHERE a.professional_id = ?
         AND a.date = ?
         AND a.status != 'cancelado'`
    )
    .bind(Number(professionalId), dateStr)
    .all();

  return (results || [])
    .map((r) => {
      const start =
        typeof r.start_min === 'number' && !Number.isNaN(r.start_min)
          ? r.start_min
          : parseTimeHHMM(r.time);
      if (start === null) return null;
      const duration = Number(r.duration_min) || 60;
      return { id: r.id, start, end: start + duration };
    })
    .filter(Boolean);
}

function hasOverlap(startMin, endMin, occupiedIntervals) {
  return occupiedIntervals.some((interval) => startMin < interval.end && endMin > interval.start);
}

async function computeAvailableSlots(db, service, professionalId, dateStr) {
  const parsedDate = parseDateYYYYMMDD(dateStr);
  if (!parsedDate) return [];

  const { todayStr, currentMinutes } = getNowBrazilInfo();
  if (dateStr < todayStr) {
    return [];
  }

  const hours = getOperatingHours(parsedDate.dayOfWeek);
  if (!hours) {
    return [];
  }

  const duration = Number(service.duration_min);
  const occupied = await getOccupiedIntervals(db, professionalId, dateStr);
  const slots = [];

  for (let start = hours.openMin; start + duration <= hours.closeMin; start += 30) {
    if (dateStr === todayStr && start <= currentMinutes) {
      continue;
    }
    const end = start + duration;
    if (!hasOverlap(start, end, occupied)) {
      slots.push(minutesToHHMM(start));
    }
  }

  return slots;
}

// ============================================================================
// Handlers das Rotas (/api)
// ============================================================================

async function handleGetServices(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, category, description, duration_min, price, image
       FROM services
       ORDER BY id ASC`
    ).all();
    return jsonResponse(results || []);
  } catch {
    return jsonResponse({ error: 'Erro ao listar serviços.' }, 500);
  }
}

async function handleGetProfessionals(url, env) {
  try {
    const serviceId = url.searchParams.get('serviceId');
    let profResult;

    if (serviceId !== null && serviceId !== '') {
      const sid = Number(serviceId);
      if (!Number.isInteger(sid) || sid <= 0) {
        return jsonResponse({ error: 'Parâmetro serviceId inválido.' }, 400);
      }
      profResult = await env.DB.prepare(
        `SELECT p.id, p.name, p.role, p.bio, p.photo
         FROM professionals p
         INNER JOIN professional_services ps ON ps.professional_id = p.id
         WHERE ps.service_id = ?
         ORDER BY p.id ASC`
      )
        .bind(sid)
        .all();
    } else {
      profResult = await env.DB.prepare(
        `SELECT id, name, role, bio, photo
         FROM professionals
         ORDER BY id ASC`
      ).all();
    }

    const professionals = profResult.results || [];
    const relResult = await env.DB.prepare(
      `SELECT professional_id, service_id
       FROM professional_services
       ORDER BY service_id ASC`
    ).all();

    const serviceMap = new Map();
    for (const row of relResult.results || []) {
      if (!serviceMap.has(row.professional_id)) {
        serviceMap.set(row.professional_id, []);
      }
      serviceMap.get(row.professional_id).push(row.service_id);
    }

    const result = professionals.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      bio: p.bio,
      photo: p.photo,
      serviceIds: serviceMap.get(p.id) || []
    }));

    return jsonResponse(result);
  } catch {
    return jsonResponse({ error: 'Erro ao listar profissionais.' }, 500);
  }
}

async function handleGetAvailability(url, env) {
  try {
    const serviceId = url.searchParams.get('serviceId');
    const professionalId = url.searchParams.get('professionalId');
    const date = url.searchParams.get('date');

    if (!serviceId || !professionalId || !date) {
      return jsonResponse(
        { error: 'Os parâmetros serviceId, professionalId e date são obrigatórios.' },
        400
      );
    }

    const sid = Number(serviceId);
    const pid = Number(professionalId);
    if (!Number.isInteger(sid) || sid <= 0 || !Number.isInteger(pid) || pid <= 0) {
      return jsonResponse({ error: 'Identificadores de serviço ou profissional inválidos.' }, 400);
    }

    const dateStr = String(date);
    const parsedDate = parseDateYYYYMMDD(dateStr);
    if (!parsedDate) {
      return jsonResponse({ error: 'Data inválida. Use o formato YYYY-MM-DD.' }, 400);
    }

    const service = await env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(sid).first();
    if (!service) {
      return jsonResponse({ error: 'Serviço não encontrado.' }, 400);
    }

    const professional = await env.DB.prepare('SELECT * FROM professionals WHERE id = ?')
      .bind(pid)
      .first();
    if (!professional) {
      return jsonResponse({ error: 'Profissional não encontrada.' }, 400);
    }

    const link = await env.DB.prepare(
      'SELECT 1 AS ok FROM professional_services WHERE professional_id = ? AND service_id = ?'
    )
      .bind(pid, sid)
      .first();
    if (!link) {
      return jsonResponse({ error: 'A profissional selecionada não realiza este serviço.' }, 400);
    }

    const slots = await computeAvailableSlots(env.DB, service, pid, dateStr);
    return jsonResponse({ date: dateStr, slots });
  } catch {
    return jsonResponse({ error: 'Erro ao consultar horários disponíveis.' }, 500);
  }
}

async function handleCreateAppointment(request, env) {
  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { serviceId, professionalId, date, time, name, phone, email, notes } =
      parsedBody.data || {};

    if (!serviceId || !professionalId || !date || !time || !name || !phone || !email) {
      return jsonResponse(
        {
          error:
            'Preencha todos os campos obrigatórios: serviço, profissional, data, horário, nome, telefone e e-mail.'
        },
        400
      );
    }

    const sid = Number(serviceId);
    const pid = Number(professionalId);
    if (!Number.isInteger(sid) || sid <= 0 || !Number.isInteger(pid) || pid <= 0) {
      return jsonResponse({ error: 'Serviço ou profissional inválido.' }, 400);
    }

    const trimmedName = String(name).trim();
    const trimmedPhone = String(phone).trim();
    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedNotes = notes !== undefined && notes !== null ? String(notes).trim() : '';

    if (trimmedName.length < 2) {
      return jsonResponse({ error: 'Informe um nome válido.' }, 400);
    }

    if (normalizePhone(trimmedPhone).length < 8) {
      return jsonResponse({ error: 'Informe um telefone válido.' }, 400);
    }

    if (!isValidEmail(trimmedEmail)) {
      return jsonResponse({ error: 'Informe um endereço de e-mail válido.' }, 400);
    }

    const dateStr = String(date).trim();
    const timeStr = String(time).trim();

    const parsedDate = parseDateYYYYMMDD(dateStr);
    if (!parsedDate) {
      return jsonResponse({ error: 'Data inválida. Utilize o formato YYYY-MM-DD.' }, 400);
    }

    const startMin = parseTimeHHMM(timeStr);
    if (startMin === null || startMin % 30 !== 0) {
      return jsonResponse(
        {
          error:
            'Horário inválido. Os agendamentos devem ser feitos em intervalos de 30 minutos (ex: 09:00, 09:30).'
        },
        400
      );
    }

    // Verificar datas e horários passados no fuso America/Sao_Paulo
    const { todayStr, currentMinutes, createdAt } = getNowBrazilInfo();
    if (dateStr < todayStr || (dateStr === todayStr && startMin <= currentMinutes)) {
      return jsonResponse(
        { error: 'Não é permitido agendar em datas ou horários que já passaram.' },
        400
      );
    }

    const service = await env.DB.prepare('SELECT * FROM services WHERE id = ?').bind(sid).first();
    if (!service) {
      return jsonResponse({ error: 'Serviço não encontrado.' }, 400);
    }

    const professional = await env.DB.prepare('SELECT * FROM professionals WHERE id = ?')
      .bind(pid)
      .first();
    if (!professional) {
      return jsonResponse({ error: 'Profissional não encontrada.' }, 400);
    }

    const link = await env.DB.prepare(
      'SELECT 1 AS ok FROM professional_services WHERE professional_id = ? AND service_id = ?'
    )
      .bind(pid, sid)
      .first();
    if (!link) {
      return jsonResponse({ error: 'A profissional selecionada não realiza este serviço.' }, 400);
    }

    // Verificar horário de funcionamento da clínica e se cabe a duração do serviço
    const hours = getOperatingHours(parsedDate.dayOfWeek);
    if (!hours) {
      return jsonResponse({ error: 'A clínica não funciona aos domingos.' }, 400);
    }

    const duration = Number(service.duration_min);
    const endMin = startMin + duration;

    if (startMin < hours.openMin || endMin > hours.closeMin) {
      return jsonResponse(
        {
          error: `Horário fora do expediente ou duração do serviço (${duration} min) ultrapassa o fechamento (${minutesToHHMM(hours.closeMin)}).`
        },
        400
      );
    }

    const code = await generateAppointmentCode(env.DB);

    // INSERT atômico verificando conflito de intervalo via WHERE NOT EXISTS
    const insertResult = await env.DB.prepare(
      `INSERT INTO appointments (
         code, service_id, professional_id, date, time, start_min, duration_min,
         name, phone, email, notes, status, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM appointments
         WHERE professional_id = ?
           AND date = ?
           AND status != 'cancelado'
           AND start_min < ?
           AND (start_min + duration_min) > ?
       )`
    )
      .bind(
        code,
        sid,
        pid,
        dateStr,
        timeStr,
        startMin,
        duration,
        trimmedName,
        trimmedPhone,
        trimmedEmail,
        trimmedNotes,
        createdAt,
        pid,
        dateStr,
        endMin,
        startMin
      )
      .run();

    if (!insertResult.meta || insertResult.meta.changes === 0) {
      return jsonResponse(
        {
          error:
            'Este horário já está ocupado ou conflita com outro agendamento da profissional selecionada.'
        },
        409
      );
    }

    const newId = Number(insertResult.meta.last_row_id);

    return jsonResponse(
      {
        id: newId,
        code,
        status: 'confirmado',
        serviceId: sid,
        professionalId: pid,
        service: service.name,
        professional: professional.name,
        duration_min: duration,
        price: service.price,
        date: dateStr,
        time: timeStr,
        name: trimmedName,
        phone: trimmedPhone,
        email: trimmedEmail,
        notes: trimmedNotes
      },
      201
    );
  } catch {
    return jsonResponse({ error: 'Erro interno ao criar agendamento.' }, 500);
  }
}

async function handleLookupAppointments(url, env) {
  try {
    const email = url.searchParams.get('email');
    const phone = url.searchParams.get('phone');

    if (!email || !phone) {
      return jsonResponse(
        { error: 'Informe o e-mail e o telefone para consultar seus agendamentos.' },
        400
      );
    }

    const targetEmail = String(email).trim().toLowerCase();
    const rawPhone = String(phone).trim();
    const targetDigits = normalizePhone(rawPhone);

    const { results } = await env.DB.prepare(
      `SELECT
         a.id,
         a.code,
         a.service_id AS serviceId,
         a.professional_id AS professionalId,
         s.name AS service,
         p.name AS professional,
         a.duration_min,
         s.price,
         a.date,
         a.time,
         a.status,
         a.name,
         a.phone,
         a.email,
         a.notes,
         a.created_at
       FROM appointments a
       INNER JOIN services s ON s.id = a.service_id
       INNER JOIN professionals p ON p.id = a.professional_id
       WHERE LOWER(a.email) = ?
       ORDER BY a.date DESC, a.time DESC`
    )
      .bind(targetEmail)
      .all();

    const matched = (results || []).filter((r) => {
      if (r.phone.trim() === rawPhone) return true;
      const rowDigits = normalizePhone(r.phone);
      return targetDigits.length >= 8 && rowDigits === targetDigits;
    });

    return jsonResponse(matched);
  } catch {
    return jsonResponse({ error: 'Erro ao buscar agendamentos.' }, 500);
  }
}

async function handleCancelAppointment(request, url, codeParam, env) {
  const parsedBody = await parseJsonBody(request, true);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const trimmedCode = String(codeParam || '').trim();
    const emailInput =
      (parsedBody.data && parsedBody.data.email) || url.searchParams.get('email');

    if (!trimmedCode) {
      return jsonResponse({ error: 'Código do agendamento é obrigatório.' }, 400);
    }

    if (!emailInput || typeof emailInput !== 'string' || !emailInput.trim()) {
      return jsonResponse(
        { error: 'Informe o e-mail utilizado no agendamento para confirmar o cancelamento.' },
        400
      );
    }

    const appt = await env.DB.prepare('SELECT * FROM appointments WHERE UPPER(code) = UPPER(?)')
      .bind(trimmedCode)
      .first();

    if (!appt) {
      return jsonResponse({ error: 'Agendamento não encontrado.' }, 404);
    }

    if (appt.email.trim().toLowerCase() !== emailInput.trim().toLowerCase()) {
      return jsonResponse(
        { error: 'O e-mail informado não corresponde a este agendamento.' },
        400
      );
    }

    await env.DB.prepare("UPDATE appointments SET status = 'cancelado' WHERE id = ?")
      .bind(appt.id)
      .run();

    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ error: 'Erro ao cancelar agendamento.' }, 500);
  }
}

async function handleContact(request, env) {
  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { name, email, phone, message } = parsedBody.data || {};

    if (!name || !email || !message) {
      return jsonResponse(
        { error: 'Os campos nome, e-mail e mensagem são obrigatórios.' },
        400
      );
    }

    const trimmedName = String(name).trim();
    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedPhone = phone ? String(phone).trim() : '';
    const trimmedMessage = String(message).trim();

    if (trimmedName.length < 2) {
      return jsonResponse({ error: 'Informe um nome válido.' }, 400);
    }

    if (!isValidEmail(trimmedEmail)) {
      return jsonResponse({ error: 'Informe um e-mail válido.' }, 400);
    }

    if (trimmedMessage.length < 3) {
      return jsonResponse({ error: 'A mensagem é muito curta.' }, 400);
    }

    const { createdAt } = getNowBrazilInfo();

    await env.DB.prepare(
      `INSERT INTO contacts (name, email, phone, message, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(trimmedName, trimmedEmail, trimmedPhone, trimmedMessage, createdAt)
      .run();

    return jsonResponse({ ok: true }, 201);
  } catch {
    return jsonResponse({ error: 'Erro ao enviar mensagem de contato.' }, 500);
  }
}

async function handleAdminLogin(request, env) {
  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    if (!env || !env.ADMIN_PASSWORD || !env.TOKEN_SECRET) {
      return jsonResponse({ error: 'Painel admin não configurado.' }, 503);
    }

    const { password } = parsedBody.data || {};

    if (!password || typeof password !== 'string') {
      return jsonResponse({ error: 'Informe a senha de administrador.' }, 400);
    }

    const inputBytes = encoder.encode(password);
    const expectedBytes = encoder.encode(String(env.ADMIN_PASSWORD));
    if (!timingSafeEqualBytes(inputBytes, expectedBytes)) {
      return jsonResponse({ error: 'Senha incorreta.' }, 401);
    }

    const token = await createAdminToken(String(env.TOKEN_SECRET));
    return jsonResponse({ token });
  } catch {
    return jsonResponse({ error: 'Erro ao realizar login.' }, 500);
  }
}

async function handleAdminGetAppointments(request, url, env) {
  const authError = await checkAdminAuth(request, env);
  if (authError) return authError;

  try {
    const date = url.searchParams.get('date');
    const status = url.searchParams.get('status');
    const conditions = [];
    const params = [];

    if (date && String(date).trim() !== '') {
      conditions.push('a.date = ?');
      params.push(String(date).trim());
    }

    if (status && String(status).trim() !== '' && String(status).trim().toLowerCase() !== 'todos') {
      const normalized = String(status).trim().toLowerCase();
      if (normalized === 'concluido' || normalized === 'concluído') {
        conditions.push("a.status IN ('concluído', 'concluido')");
      } else {
        conditions.push('a.status = ?');
        params.push(normalized);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { results } = await env.DB.prepare(
      `SELECT
         a.id,
         a.code,
         a.service_id AS serviceId,
         a.professional_id AS professionalId,
         s.name AS service,
         p.name AS professional,
         a.duration_min,
         s.price,
         a.date,
         a.time,
         a.name,
         a.phone,
         a.email,
         a.notes,
         a.status,
         a.created_at
       FROM appointments a
       INNER JOIN services s ON s.id = a.service_id
       INNER JOIN professionals p ON p.id = a.professional_id
       ${whereClause}
       ORDER BY a.date ASC, a.time ASC`
    )
      .bind(...params)
      .all();

    return jsonResponse(results || []);
  } catch {
    return jsonResponse({ error: 'Erro ao listar agendamentos.' }, 500);
  }
}

async function handleAdminUpdateAppointment(request, idParam, env) {
  const authError = await checkAdminAuth(request, env);
  if (authError) return authError;

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return jsonResponse({ error: 'ID de agendamento inválido.' }, 400);
    }

    const { status } = parsedBody.data || {};
    if (!status || typeof status !== 'string') {
      return jsonResponse({ error: 'O novo status é obrigatório.' }, 400);
    }

    const rawStatus = status.trim().toLowerCase();
    const validMap = {
      confirmado: 'confirmado',
      concluido: 'concluído',
      'concluído': 'concluído',
      cancelado: 'cancelado'
    };

    const normalizedStatus = validMap[rawStatus];
    if (!normalizedStatus) {
      return jsonResponse(
        { error: 'Status inválido. Valores permitidos: confirmado, concluído ou cancelado.' },
        400
      );
    }

    const existing = await env.DB.prepare('SELECT id FROM appointments WHERE id = ?')
      .bind(id)
      .first();
    if (!existing) {
      return jsonResponse({ error: 'Agendamento não encontrado.' }, 404);
    }

    await env.DB.prepare('UPDATE appointments SET status = ? WHERE id = ?')
      .bind(normalizedStatus, id)
      .run();

    const updated = await env.DB.prepare(
      `SELECT
         a.id,
         a.code,
         a.service_id AS serviceId,
         a.professional_id AS professionalId,
         s.name AS service,
         p.name AS professional,
         a.duration_min,
         s.price,
         a.date,
         a.time,
         a.name,
         a.phone,
         a.email,
         a.notes,
         a.status,
         a.created_at
       FROM appointments a
       INNER JOIN services s ON s.id = a.service_id
       INNER JOIN professionals p ON p.id = a.professional_id
       WHERE a.id = ?`
    )
      .bind(id)
      .first();

    return jsonResponse(updated);
  } catch {
    return jsonResponse({ error: 'Erro ao atualizar status do agendamento.' }, 500);
  }
}

// ============================================================================
// Export do Cloudflare Worker
// ============================================================================

export default {
  async fetch(request, env, _ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      const method = request.method.toUpperCase();

      if (!pathname.startsWith('/api')) {
        if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
          return env.ASSETS.fetch(request);
        }
        return jsonResponse({ error: 'Rota da API não encontrada.' }, 404);
      }

      if (method === 'GET' && pathname === '/api/services') {
        return handleGetServices(env);
      }

      if (method === 'GET' && pathname === '/api/professionals') {
        return handleGetProfessionals(url, env);
      }

      if (method === 'GET' && pathname === '/api/availability') {
        return handleGetAvailability(url, env);
      }

      if (method === 'POST' && pathname === '/api/appointments') {
        return handleCreateAppointment(request, env);
      }

      if (method === 'GET' && pathname === '/api/appointments/lookup') {
        return handleLookupAppointments(url, env);
      }

      const cancelMatch = pathname.match(/^\/api\/appointments\/([^/]+)\/cancel$/);
      if (method === 'PATCH' && cancelMatch) {
        let codeParam = cancelMatch[1];
        try {
          codeParam = decodeURIComponent(codeParam);
        } catch {
          // mantém valor bruto se decode falhar
        }
        return handleCancelAppointment(request, url, codeParam, env);
      }

      if (method === 'POST' && pathname === '/api/contact') {
        return handleContact(request, env);
      }

      if (method === 'POST' && pathname === '/api/admin/login') {
        return handleAdminLogin(request, env);
      }

      if (method === 'GET' && pathname === '/api/admin/appointments') {
        return handleAdminGetAppointments(request, url, env);
      }

      const adminPatchMatch = pathname.match(/^\/api\/admin\/appointments\/([^/]+)$/);
      if (method === 'PATCH' && adminPatchMatch) {
        return handleAdminUpdateAppointment(request, adminPatchMatch[1], env);
      }

      return jsonResponse({ error: 'Rota da API não encontrada.' }, 404);
    } catch {
      return jsonResponse({ error: 'Erro interno do servidor.' }, 500);
    }
  }
};
