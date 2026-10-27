/* Home: serviços, equipe e formulário de contato */
(async function () {
  const sGrid = document.getElementById('services-grid');
  const tGrid = document.getElementById('team-grid');

  try {
    const services = await api('/services');
    sGrid.innerHTML = services.map((s, i) => `
      <article class="card reveal" data-delay="${i % 3}">
        <div class="card-img"><img src="${esc(s.image)}" alt="${esc(s.name)}" loading="lazy"></div>
        <div class="card-body">
          <span class="card-cat">${esc(s.category)}</span>
          <h3>${esc(s.name)}</h3>
          <p>${esc(s.description)}</p>
          <div class="card-meta"><span>⏱ ${fmtDuration(s.duration_min)}</span><span class="price">${brl(s.price)}</span></div>
          <a class="btn btn--ghost btn--sm" href="/agendar.html?serviceId=${encodeURIComponent(s.id)}">Agendar</a>
        </div>
      </article>`).join('');
    initReveal(sGrid);
  } catch (e) {
    sGrid.innerHTML = `<div class="alert alert--error" style="grid-column:1/-1">${esc(e.message)}</div>`;
  }

  try {
    const pros = await api('/professionals');
    tGrid.innerHTML = pros.map((p, i) => `
      <article class="team-card reveal" data-delay="${i % 3}">
        <div class="avatar"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></div>
        <h3>${esc(p.name)}</h3>
        <div class="role">${esc(p.role)}</div>
        <p>${esc(p.bio)}</p>
      </article>`).join('');
    initReveal(tGrid);
  } catch (e) {
    tGrid.innerHTML = `<div class="alert alert--error" style="grid-column:1/-1">${esc(e.message)}</div>`;
  }

  /* Contato */
  const form = document.getElementById('contact-form');
  const box = document.getElementById('contact-alert');
  maskPhone(form.phone);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    d.name = d.name.trim(); d.message = d.message.trim(); d.email = d.email.trim();
    const f = (n) => form.elements[n].closest('.field');
    let ok = true;
    const check = (n, bad, msg) => { setFieldError(f(n), bad ? msg : ''); if (bad) ok = false; };
    check('name', d.name.length < 2, 'Informe seu nome.');
    check('email', !isEmail(d.email), 'Informe um e-mail válido.');
    check('message', d.message.length < 5, 'Escreva sua mensagem.');
    if (!ok) return;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Enviando…';
    box.innerHTML = '';
    try {
      await api('/contact', { method: 'POST', body: d });
      box.innerHTML = '<div class="alert alert--ok">Mensagem enviada! Entraremos em contato em breve.</div>';
      form.reset();
    } catch (e) {
      box.innerHTML = `<div class="alert alert--error">${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Enviar mensagem';
    }
  });
})();
