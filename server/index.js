const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'lumiere123';
const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'lumiere-admin-secret-key-2026';

const activeAdminTokens = new Set();

function createAdminToken() {
  const randomPart = crypto.randomBytes(16).toString('hex');
  const sig = crypto
    .createHmac('sha256', `${TOKEN_SECRET}:${ADMIN_PASSWORD}`)
    .update(randomPart)
    .digest('hex');
  const token = `${randomPart}.${sig}`;
  activeAdminTokens.add(token);
  return token;
}

function isValidAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  if (activeAdminTokens.has(token)) return true;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [randomPart, sig] = parts;
  if (!randomPart || !sig) return false;
  const expectedSig = crypto
    .createHmac('sha256', `${TOKEN_SECRET}:${ADMIN_PASSWORD}`)
    .update(randomPart)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para capturar JSON malformado
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Corpo da requisição em formato JSON inválido.' });
  }
  return next(err);
});

// Servir arquivos estáticos de /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helpers de data, horário e validação
function parseDateYYYYMMDD(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day, dateObj: dt, dayOfWeek: dt.getDay() };
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

function getNowLocalInfo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return { todayStr, currentMinutes };
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

function generateAppointmentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const checkStmt = db.prepare('SELECT id FROM appointments WHERE code = ?');
  for (let attempt = 0; attempt < 20; attempt++) {
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars[crypto.randomInt(0, chars.length)];
    }
    const code = `LUM-${suffix}`;
    if (!checkStmt.get(code)) {
      return code;
    }
  }
  return `LUM-${Date.now().toString(36).toUpperCase()}`;
}

function getOccupiedIntervals(professionalId, dateStr) {
  const rows = db
    .prepare(
      `SELECT a.id, a.time, COALESCE(a.duration_min, s.duration_min) AS duration_min
       FROM appointments a
       LEFT JOIN services s ON s.id = a.service_id
       WHERE a.professional_id = ?
         AND a.date = ?
         AND a.status != 'cancelado'`
    )
    .all(Number(professionalId), dateStr);

  return rows
    .map((r) => {
      const start = parseTimeHHMM(r.time);
      if (start === null) return null;
      const duration = Number(r.duration_min) || 60;
      return { id: r.id, start, end: start + duration };
    })
    .filter(Boolean);
}

function hasOverlap(startMin, endMin, occupiedIntervals) {
  return occupiedIntervals.some((interval) => startMin < interval.end && endMin > interval.start);
}

function computeAvailableSlots(service, professionalId, dateStr) {
  const parsedDate = parseDateYYYYMMDD(dateStr);
  if (!parsedDate) return [];

  const { todayStr, currentMinutes } = getNowLocalInfo();
  if (dateStr < todayStr) {
    return [];
  }

  const hours = getOperatingHours(parsedDate.dayOfWeek);
  if (!hours) {
    return [];
  }

  const duration = Number(service.duration_min);
  const occupied = getOccupiedIntervals(professionalId, dateStr);
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
// ROTAS DA API (/api)
// ============================================================================

// GET /api/services
app.get('/api/services', (_req, res) => {
  try {
    const services = db
      .prepare(
        `SELECT id, name, category, description, duration_min, price, image
         FROM services
         ORDER BY id ASC`
      )
      .all();
    return res.json(services);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao listar serviços.' });
  }
});

// GET /api/professionals?serviceId=
app.get('/api/professionals', (req, res) => {
  try {
    const { serviceId } = req.query;
    let professionals;

    if (serviceId !== undefined && serviceId !== '') {
      const sid = Number(serviceId);
      if (!Number.isInteger(sid) || sid <= 0) {
        return res.status(400).json({ error: 'Parâmetro serviceId inválido.' });
      }
      professionals = db
        .prepare(
          `SELECT p.id, p.name, p.role, p.bio, p.photo
           FROM professionals p
           INNER JOIN professional_services ps ON ps.professional_id = p.id
           WHERE ps.service_id = ?
           ORDER BY p.id ASC`
        )
        .all(sid);
    } else {
      professionals = db
        .prepare(
          `SELECT id, name, role, bio, photo
           FROM professionals
           ORDER BY id ASC`
        )
        .all();
    }

    const relStmt = db.prepare(
      `SELECT service_id FROM professional_services WHERE professional_id = ? ORDER BY service_id ASC`
    );

    const result = professionals.map((p) => {
      const rels = relStmt.all(p.id);
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        bio: p.bio,
        photo: p.photo,
        serviceIds: rels.map((r) => r.service_id)
      };
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao listar profissionais.' });
  }
});

// GET /api/availability?serviceId=&professionalId=&date=YYYY-MM-DD
app.get('/api/availability', (req, res) => {
  try {
    const { serviceId, professionalId, date } = req.query;

    if (!serviceId || !professionalId || !date) {
      return res.status(400).json({
        error: 'Os parâmetros serviceId, professionalId e date são obrigatórios.'
      });
    }

    const sid = Number(serviceId);
    const pid = Number(professionalId);
    if (!Number.isInteger(sid) || sid <= 0 || !Number.isInteger(pid) || pid <= 0) {
      return res.status(400).json({ error: 'Identificadores de serviço ou profissional inválidos.' });
    }

    const parsedDate = parseDateYYYYMMDD(String(date));
    if (!parsedDate) {
      return res.status(400).json({ error: 'Data inválida. Use o formato YYYY-MM-DD.' });
    }

    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(sid);
    if (!service) {
      return res.status(400).json({ error: 'Serviço não encontrado.' });
    }

    const professional = db.prepare('SELECT * FROM professionals WHERE id = ?').get(pid);
    if (!professional) {
      return res.status(400).json({ error: 'Profissional não encontrada.' });
    }

    const link = db
      .prepare('SELECT 1 FROM professional_services WHERE professional_id = ? AND service_id = ?')
      .get(pid, sid);
    if (!link) {
      return res.status(400).json({
        error: 'A profissional selecionada não realiza este serviço.'
      });
    }

    const slots = computeAvailableSlots(service, pid, String(date));
    return res.json({ date: String(date), slots });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao consultar horários disponíveis.' });
  }
});

// POST /api/appointments
app.post('/api/appointments', (req, res) => {
  try {
    const { serviceId, professionalId, date, time, name, phone, email, notes } = req.body || {};

    if (!serviceId || !professionalId || !date || !time || !name || !phone || !email) {
      return res.status(400).json({
        error: 'Preencha todos os campos obrigatórios: serviço, profissional, data, horário, nome, telefone e e-mail.'
      });
    }

    const sid = Number(serviceId);
    const pid = Number(professionalId);
    if (!Number.isInteger(sid) || sid <= 0 || !Number.isInteger(pid) || pid <= 0) {
      return res.status(400).json({ error: 'Serviço ou profissional inválido.' });
    }

    const trimmedName = String(name).trim();
    const trimmedPhone = String(phone).trim();
    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedNotes = notes !== undefined && notes !== null ? String(notes).trim() : '';

    if (trimmedName.length < 2) {
      return res.status(400).json({ error: 'Informe um nome válido.' });
    }

    if (normalizePhone(trimmedPhone).length < 8) {
      return res.status(400).json({ error: 'Informe um telefone válido.' });
    }

    if (!isValidEmail(trimmedEmail)) {
      return res.status(400).json({ error: 'Informe um endereço de e-mail válido.' });
    }

    const dateStr = String(date).trim();
    const timeStr = String(time).trim();

    const parsedDate = parseDateYYYYMMDD(dateStr);
    if (!parsedDate) {
      return res.status(400).json({ error: 'Data inválida. Utilize o formato YYYY-MM-DD.' });
    }

    const startMin = parseTimeHHMM(timeStr);
    if (startMin === null || startMin % 30 !== 0) {
      return res.status(400).json({
        error: 'Horário inválido. Os agendamentos devem ser feitos em intervalos de 30 minutos (ex: 09:00, 09:30).'
      });
    }

    // Verificar datas e horários passados
    const { todayStr, currentMinutes } = getNowLocalInfo();
    if (dateStr < todayStr || (dateStr === todayStr && startMin <= currentMinutes)) {
      return res.status(400).json({
        error: 'Não é permitido agendar em datas ou horários que já passaram.'
      });
    }

    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(sid);
    if (!service) {
      return res.status(400).json({ error: 'Serviço não encontrado.' });
    }

    const professional = db.prepare('SELECT * FROM professionals WHERE id = ?').get(pid);
    if (!professional) {
      return res.status(400).json({ error: 'Profissional não encontrada.' });
    }

    const link = db
      .prepare('SELECT 1 FROM professional_services WHERE professional_id = ? AND service_id = ?')
      .get(pid, sid);
    if (!link) {
      return res.status(400).json({
        error: 'A profissional selecionada não realiza este serviço.'
      });
    }

    // Verificar horário de funcionamento da clínica e se cabe a duração do serviço
    const hours = getOperatingHours(parsedDate.dayOfWeek);
    if (!hours) {
      return res.status(400).json({
        error: 'A clínica não funciona aos domingos.'
      });
    }

    const duration = Number(service.duration_min);
    const endMin = startMin + duration;

    if (startMin < hours.openMin || endMin > hours.closeMin) {
      return res.status(400).json({
        error: `Horário fora do expediente ou duração do serviço (${duration} min) ultrapassa o fechamento (${minutesToHHMM(hours.closeMin)}).`
      });
    }

    // Verificar sobreposição com outros agendamentos (não cancelados) da mesma profissional
    const occupied = getOccupiedIntervals(pid, dateStr);
    if (hasOverlap(startMin, endMin, occupied)) {
      return res.status(409).json({
        error: 'Este horário já está ocupado ou conflita com outro agendamento da profissional selecionada.'
      });
    }

    const code = generateAppointmentCode();
    const insertResult = db
      .prepare(
        `INSERT INTO appointments
          (code, service_id, professional_id, date, time, duration_min, name, phone, email, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado')`
      )
      .run(
        code,
        sid,
        pid,
        dateStr,
        timeStr,
        duration,
        trimmedName,
        trimmedPhone,
        trimmedEmail,
        trimmedNotes
      );

    const newId = Number(insertResult.lastInsertRowid);

    return res.status(201).json({
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
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno ao criar agendamento.' });
  }
});

// GET /api/appointments/lookup?email=&phone=
app.get('/api/appointments/lookup', (req, res) => {
  try {
    const { email, phone } = req.query;

    if (!email || !phone) {
      return res.status(400).json({
        error: 'Informe o e-mail e o telefone para consultar seus agendamentos.'
      });
    }

    const targetEmail = String(email).trim().toLowerCase();
    const rawPhone = String(phone).trim();
    const targetDigits = normalizePhone(rawPhone);

    const rows = db
      .prepare(
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
      .all(targetEmail);

    const matched = rows.filter((r) => {
      if (r.phone.trim() === rawPhone) return true;
      const rowDigits = normalizePhone(r.phone);
      return targetDigits.length >= 8 && rowDigits === targetDigits;
    });

    return res.json(matched);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao buscar agendamentos.' });
  }
});

// PATCH /api/appointments/:code/cancel
app.patch('/api/appointments/:code/cancel', (req, res) => {
  try {
    const codeParam = String(req.params.code || '').trim();
    const emailInput = (req.body && req.body.email) || req.query.email;

    if (!codeParam) {
      return res.status(400).json({ error: 'Código do agendamento é obrigatório.' });
    }

    if (!emailInput || typeof emailInput !== 'string' || !emailInput.trim()) {
      return res.status(400).json({
        error: 'Informe o e-mail utilizado no agendamento para confirmar o cancelamento.'
      });
    }

    const appt = db
      .prepare('SELECT * FROM appointments WHERE UPPER(code) = UPPER(?)')
      .get(codeParam);

    if (!appt) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    if (appt.email.trim().toLowerCase() !== emailInput.trim().toLowerCase()) {
      return res.status(400).json({
        error: 'O e-mail informado não corresponde a este agendamento.'
      });
    }

    db.prepare("UPDATE appointments SET status = 'cancelado' WHERE id = ?").run(appt.id);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao cancelar agendamento.' });
  }
});

// POST /api/contact
app.post('/api/contact', (req, res) => {
  try {
    const { name, email, phone, message } = req.body || {};

    if (!name || !email || !message) {
      return res.status(400).json({
        error: 'Os campos nome, e-mail e mensagem são obrigatórios.'
      });
    }

    const trimmedName = String(name).trim();
    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedPhone = phone ? String(phone).trim() : '';
    const trimmedMessage = String(message).trim();

    if (trimmedName.length < 2) {
      return res.status(400).json({ error: 'Informe um nome válido.' });
    }

    if (!isValidEmail(trimmedEmail)) {
      return res.status(400).json({ error: 'Informe um e-mail válido.' });
    }

    if (trimmedMessage.length < 3) {
      return res.status(400).json({ error: 'A mensagem é muito curta.' });
    }

    db.prepare(
      `INSERT INTO contacts (name, email, phone, message)
       VALUES (?, ?, ?, ?)`
    ).run(trimmedName, trimmedEmail, trimmedPhone, trimmedMessage);

    return res.status(201).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao enviar mensagem de contato.' });
  }
});

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body || {};

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Informe a senha de administrador.' });
    }

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    const token = createAdminToken();
    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao realizar login.' });
  }
});

// Middleware de autenticação do Admin
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado. Token ausente.' });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!isValidAdminToken(token)) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
  return next();
}

// GET /api/admin/appointments?date=&status=
app.get('/api/admin/appointments', requireAdminAuth, (req, res) => {
  try {
    const { date, status } = req.query;
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

    const rows = db
      .prepare(
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
      .all(...params);

    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao listar agendamentos.' });
  }
});

// PATCH /api/admin/appointments/:id
app.patch('/api/admin/appointments/:id', requireAdminAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID de agendamento inválido.' });
    }

    const { status } = req.body || {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ error: 'O novo status é obrigatório.' });
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
      return res.status(400).json({
        error: 'Status inválido. Valores permitidos: confirmado, concluído ou cancelado.'
      });
    }

    const existing = db.prepare('SELECT id FROM appointments WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(normalizedStatus, id);

    const updated = db
      .prepare(
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
      .get(id);

    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao atualizar status do agendamento.' });
  }
});

// Fallback 404 para rotas /api não existentes
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Rota da API não encontrada.' });
});

app.listen(PORT, () => {
  console.log(`Servidor Lumière Estética rodando em http://localhost:${PORT}`);
});
