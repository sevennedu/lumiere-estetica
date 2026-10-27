/* Wizard de agendamento em 4 passos */
(function () {
  const state = { step: 1, service: null, pro: null, date: '', time: '' };
  let services = [];

  const $ = (id) => document.getElementById(id);
  const steps = document.querySelectorAll('.step');
  const stepperItems = $('stepper').querySelectorAll('li');
  const backBtn = $('back-btn');
  const nextBtn = $('next-btn');
  const alertBox = $('global-alert');
  const dateInput = $('date');
  const form = $('booking-form');

  dateInput.min = todayISO();
  maskPhone(form.phone);

  function showAlert(msg, type = 'error') {
    alertBox.innerHTML = msg ? `<div class="alert alert--${type}">${esc(msg)}</div>` : '';
  }

  function canAdvance() {
    return (state.step === 1 && state.service) || (state.step === 2 && state.pro) ||
      (state.step === 3 && state.date && state.time);
  }

  function render() {
    steps.forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === state.step));
    stepperItems.forEach((li, i) => {
      li.classList.toggle('active', i + 1 === state.step);
      li.classList.toggle('done', i + 1 < state.step);
      if (i + 1 === state.step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    backBtn.hidden = state.step === 1;
    nextBtn.hidden = state.step === 4;
    nextBtn.disabled = !canAdvance();
    if (state.step === 4) renderSummary($('summary'));
  }

  function go(step) {
    state.step = step;
    showAlert('');
    render();
    window.scrollTo({ top: document.querySelector('.page-head').offsetTop, behavior: 'smooth' });
  }

  function renderSummary(dl) {
    dl.innerHTML = `
      <div><dt>Serviço</dt><dd>${esc(state.service.name)}</dd></div>
      <div><dt>Profissional</dt><dd>${esc(state.pro.name)}</dd></div>
      <div><dt>Data</dt><dd>${esc(fmtDate(state.date))}</dd></div>
      <div><dt>Horário</dt><dd>${esc(state.time)} (${fmtDuration(state.service.duration_min)})</dd></div>
      <div><dt>Valor</dt><dd>${brl(state.service.price)}</dd></div>`;
  }

  /* Passo 1 */
  function renderServices() {
    $('services-list').innerHTML = services.map((s) => `
      <button type="button" class="option" data-id="${esc(s.id)}" aria-pressed="${state.service && state.service.id === s.id}">
        <img src="${esc(s.image)}" alt="">
        <span><b>${esc(s.name)}</b><small>${fmtDuration(s.duration_min)}</small><span class="opt-price">${brl(s.price)}</span></span>
      </button>`).join('');
  }
  $('services-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.option'); if (!btn) return;
    const chosen = services.find((s) => String(s.id) === btn.dataset.id);
    if (!state.service || state.service.id !== chosen.id) { state.pro = null; state.date = ''; state.time = ''; dateInput.value = ''; resetSlots(); }
    state.service = chosen;
    renderServices();
    nextBtn.disabled = false;
  });

  /* Passo 2 */
  async function loadPros() {
    const box = $('pros-list');
    box.innerHTML = '<div class="skeleton" style="min-height:90px"></div>';
    try {
      const pros = await api('/professionals?serviceId=' + encodeURIComponent(state.service.id));
      if (!pros.length) { box.innerHTML = '<p class="empty">Nenhuma profissional disponível para este serviço.</p>'; return; }
      box.innerHTML = pros.map((p) => `
        <button type="button" class="option option--pro" data-id="${esc(p.id)}" aria-pressed="${state.pro && state.pro.id === p.id}">
          <img src="${esc(p.photo)}" alt="">
          <span><b>${esc(p.name)}</b><small>${esc(p.role)}</small></span>
        </button>`).join('');
      box._pros = pros;
    } catch (e) { box.innerHTML = `<div class="alert alert--error">${esc(e.message)}</div>`; }
  }
  $('pros-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.option'); if (!btn) return;
    const pro = $('pros-list')._pros.find((p) => String(p.id) === btn.dataset.id);
    if (!state.pro || state.pro.id !== pro.id) { state.time = ''; resetSlots(); if (state.date) loadSlots(); }
    state.pro = pro;
    $('pros-list').querySelectorAll('.option').forEach((o) => o.setAttribute('aria-pressed', String(o === btn)));
    nextBtn.disabled = false;
  });

  /* Passo 3 */
  function resetSlots() {
    $('slots').innerHTML = '<p class="empty">Selecione uma data para ver os horários.</p>';
    $('slots-title').textContent = 'Horários disponíveis';
  }
  async function loadSlots() {
    const box = $('slots');
    box.innerHTML = '<p class="empty">Carregando horários…</p>';
    $('slots-title').textContent = fmtDate(state.date);
    try {
      const r = await api(`/availability?serviceId=${encodeURIComponent(state.service.id)}&professionalId=${encodeURIComponent(state.pro.id)}&date=${state.date}`);
      if (!r.slots.length) { box.innerHTML = '<p class="empty">Sem horários livres neste dia. Tente outra data.</p>'; return; }
      box.innerHTML = `<div class="slots" role="group" aria-label="Horários livres">${r.slots.map((t) =>
        `<button type="button" class="slot" data-t="${t}" aria-pressed="${state.time === t}">${t}</button>`).join('')}</div>`;
    } catch (e) { box.innerHTML = `<div class="alert alert--error">${esc(e.message)}</div>`; }
  }
  dateInput.addEventListener('change', () => {
    state.time = ''; nextBtn.disabled = true;
    if (!dateInput.value) { state.date = ''; resetSlots(); return; }
    if (dateInput.value < todayISO()) { state.date = ''; $('slots').innerHTML = '<p class="empty">Escolha uma data a partir de hoje.</p>'; return; }
    state.date = dateInput.value;
    loadSlots();
  });
  $('slots').addEventListener('click', (e) => {
    const b = e.target.closest('.slot'); if (!b) return;
    state.time = b.dataset.t;
    $('slots').querySelectorAll('.slot').forEach((s) => s.setAttribute('aria-pressed', String(s === b)));
    nextBtn.disabled = false;
  });

  /* Navegação */
  nextBtn.addEventListener('click', () => {
    if (!canAdvance()) return;
    if (state.step === 1) loadPros();
    go(state.step + 1);
  });
  backBtn.addEventListener('click', () => go(state.step - 1));

  /* Passo 4 — envio */
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showAlert('');
    const d = Object.fromEntries(new FormData(form));
    d.name = d.name.trim(); d.email = d.email.trim(); d.notes = (d.notes || '').trim();
    const f = (n) => form.elements[n].closest('.field');
    let ok = true;
    const check = (n, bad, msg) => { setFieldError(f(n), bad ? msg : ''); if (bad) ok = false; };
    check('name', d.name.length < 3, 'Informe seu nome completo.');
    check('phone', d.phone.replace(/\D/g, '').length < 10, 'Informe um telefone com DDD.');
    check('email', !isEmail(d.email), 'Informe um e-mail válido.');
    if (!ok) return;

    const btn = $('confirm-btn');
    btn.disabled = true; btn.textContent = 'Confirmando…';
    try {
      const r = await api('/appointments', { method: 'POST', body: {
        serviceId: state.service.id, professionalId: state.pro.id, date: state.date, time: state.time,
        name: d.name, phone: d.phone, email: d.email, notes: d.notes,
      } });
      document.querySelector('.wizard').querySelectorAll('.step, #wizard-nav').forEach((el) => { el.hidden = true; el.classList.remove('active'); });
      $('stepper').querySelectorAll('li').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
      $('success-code').textContent = r.code;
      renderSummary($('success-summary'));
      $('success').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      if (e.status === 409) {
        // horário foi ocupado por outra pessoa: volta para escolher outro
        state.time = ''; nextBtn.disabled = true;
        go(3); loadSlots();
        showAlert('Esse horário acabou de ser reservado. Escolha outro, por favor.');
      } else {
        showAlert(e.message);
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Confirmar agendamento';
    }
  });

  /* Início */
  (async function init() {
    try {
      services = await api('/services');
      renderServices();
      const pre = new URLSearchParams(location.search).get('serviceId');
      const found = pre && services.find((s) => String(s.id) === pre);
      if (found) { state.service = found; renderServices(); loadPros(); go(2); return; }
    } catch (e) {
      $('services-list').innerHTML = '';
      showAlert(e.message);
    }
    render();
  })();
})();
