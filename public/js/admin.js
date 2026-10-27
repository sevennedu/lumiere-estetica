/* Painel administrativo */
(function () {
  const KEY = 'lumiere_admin_token';
  const $ = (id) => document.getElementById(id);
  let token = sessionStorage.getItem(KEY);

  const STATUS = [['confirmado', 'Confirmado'], ['concluído', 'Concluído'], ['cancelado', 'Cancelado']];
  const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // O contrato não detalha os campos de cliente/serviço; aceita variações comuns.
  const pick = (a, ...keys) => { for (const k of keys) if (a[k] != null && a[k] !== '') return a[k]; return ''; };

  function showView(logged) {
    $('login-view').hidden = logged;
    $('panel-view').hidden = !logged;
    $('logout-btn').hidden = !logged;
  }

  function logout(msg) {
    token = null; sessionStorage.removeItem(KEY);
    showView(false);
    $('login-alert').innerHTML = msg ? `<div class="alert alert--error">${esc(msg)}</div>` : '';
  }

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = $('pw').value;
    setFieldError($('pw').closest('.field'), pw ? '' : 'Informe a senha.');
    if (!pw) return;
    const btn = ev.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api('/admin/login', { method: 'POST', body: { password: pw } });
      token = r.token; sessionStorage.setItem(KEY, token);
      $('pw').value = ''; $('login-alert').innerHTML = '';
      showView(true); load();
    } catch (e) {
      $('login-alert').innerHTML = `<div class="alert alert--error">${esc(e.message)}</div>`;
    } finally { btn.disabled = false; }
  });

  $('logout-btn').addEventListener('click', () => logout());

  async function load() {
    const params = new URLSearchParams();
    if ($('f-date').value) params.set('date', $('f-date').value);
    if ($('f-status').value) params.set('status', $('f-status').value);
    $('panel-alert').innerHTML = '';
    try {
      const list = await api('/admin/appointments' + (params.toString() ? '?' + params : ''), { token });
      render(list);
    } catch (e) {
      if (e.status === 401 || e.status === 403) return logout('Sessão expirada. Entre novamente.');
      $('rows').innerHTML = '';
      $('panel-alert').innerHTML = `<div class="alert alert--error">${esc(e.message)}</div>`;
    }
  }

  function render(list) {
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const count = (s) => list.filter((a) => strip(a.status) === s).length;
    $('stats').innerHTML = `
      <div class="stat"><b>${list.length}</b><span>Total listado</span></div>
      <div class="stat"><b>${count('confirmado')}</b><span>Confirmados</span></div>
      <div class="stat"><b>${count('concluido')}</b><span>Concluídos</span></div>
      <div class="stat"><b>${count('cancelado')}</b><span>Cancelados</span></div>`;

    if (!list.length) {
      $('rows').innerHTML = '<tr><td colspan="6" class="empty">Nenhum agendamento encontrado.</td></tr>';
      return;
    }
    $('rows').innerHTML = list.map((a) => {
      const st = strip(a.status);
      const name = pick(a, 'name', 'client_name', 'customer_name', 'client');
      const phone = pick(a, 'phone', 'client_phone');
      const email = pick(a, 'email', 'client_email');
      const service = pick(a, 'service', 'service_name');
      const pro = pick(a, 'professional', 'professional_name');
      return `
      <tr>
        <td data-label="Data / hora"><b>${esc(fmtDateShort(a.date))}</b> ${esc(a.time)}</td>
        <td data-label="Cliente">${esc(name)}<small>${esc(phone)}${email ? ' · ' + esc(email) : ''}</small>${a.notes ? `<small>“${esc(a.notes)}”</small>` : ''}</td>
        <td data-label="Serviço">${esc(service)}</td>
        <td data-label="Profissional">${esc(pro)}</td>
        <td data-label="Código"><span class="appt-code">${esc(a.code)}</span></td>
        <td data-label="Status">
          <select data-id="${esc(a.id)}" data-prev="${esc(st)}" aria-label="Alterar status do agendamento ${esc(a.code)}">
            ${STATUS.map(([v, l]) => `<option value="${v}" ${strip(v) === st ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </td>
      </tr>`;
    }).join('');
  }

  $('rows').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-id]'); if (!sel) return;
    sel.disabled = true;
    try {
      await api('/admin/appointments/' + encodeURIComponent(sel.dataset.id), { method: 'PATCH', body: { status: sel.value }, token });
      toast('Status atualizado.');
      load();
    } catch (err) {
      if (err.status === 401 || err.status === 403) return logout('Sessão expirada. Entre novamente.');
      sel.value = sel.dataset.prev;
      sel.disabled = false;
      toast(err.message, 'error');
    }
  });

  $('f-date').addEventListener('change', load);
  $('f-status').addEventListener('change', load);
  $('refresh-btn').addEventListener('click', load);
  $('clear-btn').addEventListener('click', () => { $('f-date').value = ''; $('f-status').value = ''; load(); });

  if (token) { showView(true); load(); } else showView(false);
})();
