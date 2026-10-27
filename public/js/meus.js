/* Meus agendamentos: busca e cancelamento */
(function () {
  const form = document.getElementById('lookup-form');
  const alertBox = document.getElementById('lookup-alert');
  const results = document.getElementById('results');
  const modal = document.getElementById('modal');
  let query = null;
  let pendingCode = null;
  let lastFocus = null;

  maskPhone(form.phone);

  const norm = (s) => String(s || '').toLowerCase();
  const canCancel = (a) => norm(a.status) === 'confirmado' && (a.date + ' ' + a.time) > (todayISO() + ' 00:00');

  function renderList(list) {
    if (!list.length) {
      results.innerHTML = '<div class="alert alert--info">Nenhum agendamento encontrado para esses dados.</div>';
      return;
    }
    results.innerHTML = list.map((a) => `
      <article class="appt ${esc(norm(a.status))}">
        <div class="appt-top">
          <div><h3>${esc(a.service)}</h3><span class="appt-code">${esc(a.code)}</span></div>
          <span class="badge ${esc(norm(a.status))}">${esc(a.status)}</span>
        </div>
        <div class="meta">
          📅 <b>${esc(fmtDateShort(a.date))}</b> às <b>${esc(a.time)}</b><br>
          👩‍⚕️ ${esc(a.professional)}
        </div>
        ${canCancel(a) ? `<div><button class="btn btn--ghost btn--sm" data-cancel="${esc(a.code)}" data-label="${esc(a.service)} em ${esc(fmtDateShort(a.date))} às ${esc(a.time)}">Cancelar</button></div>` : ''}
      </article>`).join('');
  }

  async function search() {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Buscando…';
    alertBox.innerHTML = '';
    try {
      const list = await api(`/appointments/lookup?email=${encodeURIComponent(query.email)}&phone=${encodeURIComponent(query.phone)}`);
      renderList(list);
    } catch (e) {
      results.innerHTML = '';
      alertBox.innerHTML = `<div class="alert alert--error">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Buscar agendamentos';
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();
    let ok = true;
    setFieldError(form.email.closest('.field'), isEmail(email) ? '' : 'Informe um e-mail válido.'); if (!isEmail(email)) ok = false;
    const badPhone = phone.replace(/\D/g, '').length < 10;
    setFieldError(form.phone.closest('.field'), badPhone ? 'Informe um telefone com DDD.' : ''); if (badPhone) ok = false;
    if (!ok) return;
    query = { email, phone };
    search();
  });

  /* Modal de confirmação */
  function openModal(code, label) {
    pendingCode = code;
    lastFocus = document.activeElement;
    document.getElementById('modal-text').textContent = `${label} (código ${code}). Essa ação não pode ser desfeita.`;
    modal.classList.add('open');
    document.getElementById('modal-no').focus();
  }
  function closeModal() { modal.classList.remove('open'); pendingCode = null; if (lastFocus) lastFocus.focus(); }

  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cancel]');
    if (b) openModal(b.dataset.cancel, b.dataset.label);
  });
  document.getElementById('modal-no').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

  document.getElementById('modal-yes').addEventListener('click', async () => {
    const code = pendingCode;
    const yes = document.getElementById('modal-yes');
    yes.disabled = true;
    try {
      await api(`/appointments/${encodeURIComponent(code)}/cancel`, { method: 'PATCH', body: { email: query.email } });
      toast('Agendamento cancelado com sucesso.');
      closeModal();
      await search();
    } catch (e) {
      closeModal();
      toast(e.message, 'error');
    } finally {
      yes.disabled = false;
    }
  });
})();
