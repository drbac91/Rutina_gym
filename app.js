/* ==========================================================================
   app.js — Interfaz. Todo el acceso a datos pasa por `Store` (store.js).
   Secciones: utilidades · Entrenar · Historial · Progreso · Rutina · Datos · eventos
   ========================================================================== */
(function () {
  'use strict';
  const S = window.Store;

  /* Estado de la interfaz (no se guarda). */
  const ui = {
    tab: 'train',
    editId: null,        // id de una sesión ya terminada que se está editando
    open: new Set(),     // ejercicios del editor que están desplegados
    progKey: null,       // ejercicio elegido en Progreso
    chart: null,
  };

  const $view = document.getElementById('view');

  /* ---------- utilidades ---------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Número a texto con coma decimal (es-AR). */
  const fmt = (n) => (n == null || Number.isNaN(n) ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
  const unit = () => S.state.weightUnit;

  /** "2026-10-05" -> Date local (evita el corrimiento por zona horaria). */
  const toDate = (str) => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (str) => toDate(str).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtShort = (str) => toDate(str).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

  const isRevisar = (txt) => /\bREVISAR\b/.test(txt || '');

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /** Descarga un archivo generado en el navegador. */
  function download(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Una serie es válida para marcarla si tiene reps > 0 y peso vacío o >= 0. */
  const setValid = (st) => st.reps > 0 && (st.weight == null || st.weight >= 0);

  /** Sincroniza el flag "done" del ejercicio con sus series. */
  const syncEx = (ex) => { ex.done = ex.sets.length > 0 && ex.sets.every((st) => st.done); };

  /* ======================================================================
     ENTRENAR
     ====================================================================== */

  /** Sesión visible: la que se está editando, o la que está en curso. */
  function currentSession() {
    if (ui.editId) return S.find(S.state.sessions, ui.editId) || null;
    return S.state.sessions.find((s) => !s.finished) || null;
  }

  /** Día sugerido: el siguiente al de la última sesión terminada. */
  function suggestedDayId() {
    const days = S.state.routine.days;
    const last = S.sessions().filter((s) => s.finished).pop();
    if (!last || !days.length) return days[0] && days[0].id;
    const i = days.findIndex((d) => d.id === last.dayId);
    return days[(i + 1) % days.length].id;
  }

  function viewTrain() {
    const s = currentSession();
    return s ? trainSession(s) : trainPicker();
  }

  function trainPicker() {
    const days = S.state.routine.days;
    if (!days.length) return '<h1>Entrenar</h1><p class="empty">No hay días en la rutina. Creá uno en la pestaña Rutina.</p>';
    const next = suggestedDayId();
    return `<h1>¿Qué día entrenás?</h1>` + days.map((d) => `
      <button class="day-btn block ${d.id === next ? 'primary' : ''}" style="margin-bottom:10px" data-act="start" data-day="${esc(d.id)}">
        <span>${esc(d.name)}<small>${d.exercises.length} ejercicios</small></span>
        <span>${d.id === next ? 'Toca hoy ▸' : '▸'}</span>
      </button>`).join('');
  }

  function trainSession(s) {
    const editing = !!ui.editId;
    const exCards = s.exercises.map((ex, i) => {
      const last = S.lastEntry(ex.name, s.id);
      const prev = last
        ? `Última vez (${fmtShort(last.date)}): ` + last.sets.map((st) => `${fmt(st.weight) || '–'}×${st.reps ?? '–'}`).join(' · ')
        : 'Sin registros previos';
      const t = ex.target || {};
      const target = `${t.sets || ex.sets.length}×${esc(t.reps)}${t.weight != null ? ' · ' + fmt(t.weight) + ' ' + unit() : ''}`;
      return `
      <section class="card ex ${ex.done ? 'done' : ''}" data-ex="${i}">
        <div class="ex-head"><h3>${esc(ex.name)}</h3><span class="target">${target}</span></div>
        ${exerciseNote(s, i)}
        <p class="prev">${prev}</p>
        <div class="set-head"><span>#</span><span>${unit()}</span><span>reps</span><span></span><span></span></div>
        ${ex.sets.map((st, j) => setRow(st, j)).join('')}
        <div class="row" style="margin-top:8px">
          <button data-act="add-set">+ Serie</button>
          <button data-act="complete-ex" class="${ex.done ? '' : 'ok'}">${ex.done ? 'Deshacer' : '✓ Completar'}</button>
        </div>
      </section>`;
    }).join('');

    return `
      <h1>${esc(s.dayName || 'Sesión')} ${editing ? '<span class="badge">editando</span>' : ''}</h1>
      <div class="card">
        <label for="s-date">Fecha</label>
        <input type="date" id="s-date" data-f="date" value="${esc(s.date)}">
      </div>
      ${exCards || '<p class="empty">Esta sesión no tiene ejercicios.</p>'}
      <div class="stack">
        <button class="primary block" data-act="finish">${editing || s.finished ? 'Guardar cambios' : 'Finalizar sesión'}</button>
        ${editing
          ? '<button class="block" data-act="back">Volver al historial</button>'
          : '<button class="block danger" data-act="discard">Descartar sesión</button>'}
      </div>`;
  }

  /** Notas del ejercicio de la rutina (si existe una con el mismo nombre). */
  function exerciseNote(s, i) {
    const name = S.normName(s.exercises[i].name);
    const day = S.state.routine.days.find((d) => d.id === s.dayId);
    const re = day && day.exercises.find((e) => S.normName(e.name) === name);
    if (!re || !re.notes) return '';
    return `<div class="note ${isRevisar(re.notes) ? 'revisar' : ''}">${esc(re.notes)}</div>`;
  }

  function setRow(st, j) {
    return `
    <div class="set ${st.done ? 'done' : ''}" data-set="${j}">
      <span class="n">${j + 1}</span>
      <div class="stepper">
        <button data-act="w-" aria-label="Menos peso">−</button>
        <input inputmode="decimal" data-f="weight" value="${fmt(st.weight)}" placeholder="0" aria-label="Peso">
        <button data-act="w+" aria-label="Más peso">+</button>
      </div>
      <input class="reps" inputmode="numeric" data-f="reps" value="${st.reps ?? ''}" placeholder="0" aria-label="Repeticiones">
      <button class="chk" data-act="toggle-set" aria-label="Serie hecha">✓</button>
      <button class="x" data-act="del-set" aria-label="Quitar serie">×</button>
    </div>`;
  }

  /** Actualiza solo las clases de una fila/tarjeta, sin redibujar (no pierde el foco). */
  function refreshDone(card, ex) {
    card.classList.toggle('done', ex.done);
    card.querySelectorAll('.set').forEach((row, j) => row.classList.toggle('done', !!ex.sets[j].done));
    const btn = card.querySelector('[data-act="complete-ex"]');
    btn.textContent = ex.done ? 'Deshacer' : '✓ Completar';
    btn.classList.toggle('ok', !ex.done);
  }

  function finishSession() {
    const s = currentSession();
    if (!s) return;
    const pending = s.exercises.reduce((n, ex) => n + ex.sets.filter((st) => !st.done).length, 0);
    const total = s.exercises.reduce((n, ex) => n + ex.sets.filter((st) => st.done).length, 0);
    if (total === 0) {
      if (confirm('No marcaste ninguna serie como hecha. ¿Descartar la sesión?')) {
        S.deleteSession(s.id); ui.editId = null; toast('Sesión descartada'); go('train');
      }
      return;
    }
    if (pending && !confirm(`Hay ${pending} serie(s) sin marcar con ✓. Se van a descartar. ¿Continuar?`)) return;
    S.finishSession(s.id);
    ui.editId = null;
    toast('Sesión guardada ✓');
    go('history');
  }

  /* ======================================================================
     HISTORIAL
     ====================================================================== */

  function viewHistory() {
    const list = S.sessions().reverse();
    if (!list.length) return '<h1>Historial</h1><p class="empty">Todavía no hay sesiones. ¡Empezá a entrenar!</p>';
    return '<h1>Historial</h1>' + list.map((s) => {
      const vol = s.exercises.reduce((a, ex) => a + ex.sets.filter((x) => x.done)
        .reduce((b, x) => b + (x.weight || 0) * (x.reps || 0), 0), 0);
      const exs = s.exercises.map((ex) => {
        const sets = ex.sets.filter((x) => x.done).map((x) => `${fmt(x.weight) || '–'}×${x.reps ?? '–'}`).join(', ');
        return sets ? `<div class="hist-ex"><b>${esc(ex.name)}:</b> ${sets}</div>` : '';
      }).join('');
      return `
      <article class="card" data-sid="${esc(s.id)}">
        <div class="ex-head">
          <h3>${esc(s.dayName || 'Sesión')} ${s.finished ? '' : '<span class="badge warn">en curso</span>'}</h3>
          <span class="muted">${esc(fmtDate(s.date))}</span>
        </div>
        <p class="muted">Volumen: ${fmt(vol)} ${unit()}</p>
        ${exs}
        <div class="row" style="margin-top:10px">
          <button data-act="edit-session">${s.finished ? 'Editar' : 'Continuar'}</button>
          <button data-act="del-session" class="danger">Borrar</button>
        </div>
      </article>`;
    }).join('');
  }

  /* ======================================================================
     PROGRESO
     ====================================================================== */

  function viewProgress() {
    const names = S.exerciseNames();
    if (!names.length) return '<h1>Progreso</h1><p class="empty">Cuando termines tu primera sesión vas a ver acá los gráficos.</p>';
    if (!names.some((n) => n.key === ui.progKey)) ui.progKey = names[0].key;
    const { points, best } = S.progress(ui.progKey);
    const last = points[points.length - 1];

    // Variación % vs. la última sesión de hace 4 semanas o más.
    const ref = new Date(); ref.setDate(ref.getDate() - 28);
    const p = (n) => String(n).padStart(2, '0');
    const refStr = `${ref.getFullYear()}-${p(ref.getMonth() + 1)}-${p(ref.getDate())}`;
    const old = points.filter((x) => x.date <= refStr).pop();
    let varTxt = '–', varCls = '';
    if (old && old !== last && old.maxWeight > 0) {
      const pct = ((last.maxWeight - old.maxWeight) / old.maxWeight) * 100;
      varTxt = (pct > 0 ? '+' : '') + fmt(Math.round(pct * 10) / 10) + '%';
      varCls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
    }

    return `
      <h1>Progreso</h1>
      <div class="card">
        <label for="p-ex">Ejercicio</label>
        <select id="p-ex" data-f="prog">${names.map((n) =>
          `<option value="${esc(n.key)}" ${n.key === ui.progKey ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select>
        <div class="chart-box" style="margin-top:12px"><canvas id="chart"></canvas></div>
        <p class="muted" id="chart-msg"></p>
        <div class="stats">
          <div class="stat"><b>${best ? fmt(best.weight) + ' ' + unit() : '–'}</b><span>Mejor marca${best ? ' · ' + best.reps + ' reps' : ''}</span></div>
          <div class="stat"><b>${last ? fmt(last.maxWeight) + ' ' + unit() : '–'}</b><span>Último peso</span></div>
          <div class="stat"><b class="${varCls}">${varTxt}</b><span>vs. hace 4 sem.${old ? '' : ' (sin datos)'}</span></div>
        </div>
      </div>`;
  }

  /** Dibuja el gráfico: peso máximo (línea) y volumen (barras). */
  function drawChart() {
    const canvas = document.getElementById('chart');
    if (ui.chart) { ui.chart.destroy(); ui.chart = null; }
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      document.getElementById('chart-msg').textContent = 'No se pudo cargar Chart.js (¿sin conexión?). Las estadísticas de abajo funcionan igual.';
      return;
    }
    const { points } = S.progress(ui.progKey);
    const css = getComputedStyle(document.documentElement);
    const c = (v) => css.getPropertyValue(v).trim();
    ui.chart = new Chart(canvas, {
      data: {
        labels: points.map((x) => fmtShort(x.date)),
        datasets: [
          { type: 'line', label: `Peso máx (${unit()})`, data: points.map((x) => x.maxWeight), yAxisID: 'y',
            borderColor: c('--accent'), backgroundColor: c('--accent'), tension: .25, pointRadius: 4, order: 0 },
          { type: 'bar', label: 'Volumen', data: points.map((x) => x.volume), yAxisID: 'y1',
            backgroundColor: c('--muted') + '55', order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: c('--text') } } },
        scales: {
          x: { ticks: { color: c('--muted') }, grid: { color: c('--border') } },
          y: { position: 'left', beginAtZero: true, ticks: { color: c('--accent') }, grid: { color: c('--border') } },
          y1: { position: 'right', beginAtZero: true, ticks: { color: c('--muted') }, grid: { drawOnChartArea: false } },
        },
      },
    });
  }

  /* ======================================================================
     RUTINA (editor)
     ====================================================================== */

  function viewRoutine() {
    const days = S.state.routine.days;
    const pending = days.reduce((n, d) => n + d.exercises.filter((e) => isRevisar(e.notes)).length, 0);
    return `
      <h1>Rutina</h1>
      <p class="muted">Cambiar la rutina no modifica tu historial. El historial se une por nombre de ejercicio: si renombrás uno, el historial viejo queda con el nombre anterior.</p>
      ${pending ? `<div class="note revisar"><b>${pending} nota(s) para revisar.</b> Buscá las marcadas en amarillo.</div>` : ''}
      ${days.map((d, di) => dayCard(d, di, days.length)).join('')}
      <button class="block primary" data-act="add-day">+ Agregar día</button>`;
  }

  function dayCard(d, di, n) {
    return `
    <section class="card" data-day="${esc(d.id)}">
      <div class="row">
        <input class="day-name" data-df="name" value="${esc(d.name)}" aria-label="Nombre del día">
        <button class="fixed icon" data-act="day-up" ${di === 0 ? 'disabled' : ''} aria-label="Subir día">↑</button>
        <button class="fixed icon" data-act="day-down" ${di === n - 1 ? 'disabled' : ''} aria-label="Bajar día">↓</button>
        <button class="fixed icon danger" data-act="del-day" aria-label="Borrar día">🗑</button>
      </div>
      ${d.exercises.map((e, ei) => exerciseEditor(e, ei, d.exercises.length)).join('')}
      <button class="block" style="margin-top:8px" data-act="add-ex">+ Agregar ejercicio</button>
    </section>`;
  }

  function exerciseEditor(e, ei, n) {
    const rev = isRevisar(e.notes);
    return `
    <details class="exe ${rev ? 'revisar-box' : ''}" data-id="${esc(e.id)}" ${ui.open.has(e.id) ? 'open' : ''}>
      <summary>
        <span><b data-sum="name">${esc(e.name)}</b>
          <span class="muted" data-sum="info">${e.sets}×${esc(e.reps)}${e.targetWeight != null ? ' · ' + fmt(e.targetWeight) + ' ' + unit() : ''}</span>
          ${rev ? '<span class="badge warn">REVISAR</span>' : ''}</span>
      </summary>
      <div class="body">
        <label>Nombre</label>
        <input data-rf="name" value="${esc(e.name)}">
        <div class="grid3">
          <div><label>Series</label><input data-rf="sets" inputmode="numeric" value="${e.sets}"></div>
          <div><label>Reps (texto)</label><input data-rf="reps" value="${esc(e.reps)}" placeholder="10-10"></div>
          <div><label>Peso obj. (${unit()})</label><input data-rf="targetWeight" inputmode="decimal" value="${fmt(e.targetWeight)}" placeholder="–"></div>
        </div>
        <label>Notas</label>
        <textarea data-rf="notes" class="${rev ? 'revisar-box' : ''}">${esc(e.notes)}</textarea>
        ${e.original ? `<div class="original">Original del PDF: ${esc(e.original)}</div>` : ''}
        <div class="row" style="margin-top:10px">
          <button data-act="ex-up" ${ei === 0 ? 'disabled' : ''}>↑ Subir</button>
          <button data-act="ex-down" ${ei === n - 1 ? 'disabled' : ''}>↓ Bajar</button>
          <button data-act="del-ex" class="danger">Borrar</button>
        </div>
      </div>
    </details>`;
  }

  /* ======================================================================
     DATOS (exportar / importar)
     ====================================================================== */

  const STATUS_TXT = {
    synced: '☁ Sincronizado', syncing: '☁ Sincronizando…',
    offline: '☁ Sin conexión (se sube al volver)', error: '☁ Error de sincronización',
  };

  /** Tarjeta de cuenta: estado del login y de la sincronización. */
  function accountCard() {
    if (!window.Cloud || !Cloud.available) {
      return `<div class="card stack"><h2>Cuenta</h2>
        <p class="muted">La sincronización en la nube no está disponible (sin conexión al cargar la app o abierta como archivo). Los datos se guardan solo en este dispositivo.</p></div>`;
    }
    if (!Cloud.user) {
      return `<div class="card stack"><h2>Cuenta</h2>
        <p class="muted">Sin sesión: los datos se guardan solo en este dispositivo.</p>
        <button class="primary block" data-act="login">Iniciar sesión con Google</button></div>`;
    }
    return `<div class="card stack"><h2>Cuenta</h2>
      <p>${esc(Cloud.user.email)}</p>
      <p class="muted">${STATUS_TXT[Cloud.status] || ''}</p>
      ${Cloud.lastError ? `<p class="err">${esc(Cloud.lastError)}</p>` : ''}
      <button class="block" data-act="logout">Cerrar sesión</button></div>`;
  }

  function viewLogin() {
    return `
      <div class="login">
        <div class="logo">🏋️</div>
        <h1>Mi Rutina</h1>
        <p class="muted">Iniciá sesión para guardar tus entrenamientos en la nube y no perderlos nunca.</p>
        <button class="primary block" data-act="login">Entrar con Google</button>
        <p class="err" id="login-err"></p>
        <button class="link-btn" data-act="skip-login">Usar sin cuenta (solo en este dispositivo)</button>
      </div>`;
  }

  /** Traduce errores de login a mensajes comprensibles. */
  function loginErrorText(e) {
    const m = {
      'auth/unauthorized-domain': 'Esta dirección web no está autorizada en Firebase (Authentication → Configuración → Dominios autorizados).',
      'auth/network-request-failed': 'No hay conexión a internet.',
      'auth/operation-not-allowed': 'El login con Google no está activado en Firebase.',
    };
    return m[e.code] || ('No se pudo iniciar sesión: ' + (e.message || e.code || e));
  }

  function viewData() {
    const n = S.state.sessions.filter((s) => s.finished).length;
    return `
      <h1>Datos y backup</h1>
      ${accountCard()}
      <div class="card stack">
        <h2>Backup</h2>
        <p class="muted">${n} sesión(es) guardadas. Tus datos viven solo en este dispositivo: hacé un backup de vez en cuando.</p>
        <button class="primary block" data-act="export-json">⬇ Exportar backup (JSON)</button>
        <button class="block" data-act="import-json">⬆ Importar backup (JSON)</button>
        <input type="file" id="file" accept="application/json,.json" hidden>
      </div>
      <div class="card stack">
        <h2>Planilla</h2>
        <button class="block" data-act="export-csv">⬇ Exportar historial (CSV)</button>
      </div>
      <div class="card stack">
        <h2>Rutina original</h2>
        <p class="muted">Vuelve a cargar la rutina de rutina.json. No toca el historial.</p>
        <button class="block danger" data-act="reset-routine">Restaurar rutina original</button>
      </div>`;
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const next = S.parseImport(await file.text());
      const nS = next.sessions.length, nD = next.routine.days.length;
      if (!confirm(`Vas a SOBRESCRIBIR todos tus datos actuales con el archivo:\n\n• ${nD} día(s) de rutina\n• ${nS} sesión(es)\n\nSe guarda una copia de seguridad automática del estado anterior. ¿Continuar?`)) return;
      S.replaceAll(next);
      toast('Backup importado ✓');
      go('train');
    } catch (err) {
      alert('No se pudo importar: ' + err.message);
    }
  }

  /* ======================================================================
     NAVEGACIÓN Y RENDER
     ====================================================================== */

  const views = { train: viewTrain, history: viewHistory, progress: viewProgress, routine: viewRoutine, data: viewData };

  /** Hay nube disponible pero todavía no inició sesión ni eligió "sin cuenta". */
  const gated = () => !!(window.Cloud && Cloud.available && !Cloud.user && !Cloud.skipped);

  function render() {
    document.body.classList.toggle('gate', gated());
    updateSyncBadge();
    if (gated()) { $view.innerHTML = viewLogin(); return; }
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    $view.innerHTML = views[ui.tab]();
    if (ui.tab === 'progress') drawChart();
  }

  /** Indicador chico arriba a la derecha con el estado de la sincronización. */
  function updateSyncBadge() {
    const el = document.getElementById('sync');
    const st = window.Cloud && Cloud.user ? Cloud.status : 'off';
    el.hidden = st === 'off';
    el.className = st;
    el.textContent = STATUS_TXT[st] || '';
  }

  function go(tab) {
    if (tab !== 'train') ui.editId = null;   // salir de Entrenar cierra la edición
    ui.tab = tab;
    render();
    window.scrollTo(0, 0);
  }

  /* ======================================================================
     EVENTOS (delegación: un solo listener por tipo)
     ====================================================================== */

  /** Datos de la serie/ejercicio bajo el elemento clickeado (pestaña Entrenar). */
  function ctx(el) {
    const s = currentSession();
    const card = el.closest('[data-ex]');
    const row = el.closest('[data-set]');
    const ex = s && card ? s.exercises[+card.dataset.ex] : null;
    const st = ex && row ? ex.sets[+row.dataset.set] : null;
    return { s, card, row, ex, st, j: row ? +row.dataset.set : -1 };
  }

  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });

  $view.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const c = ctx(btn);

    switch (act) {
      /* --- entrenar --- */
      case 'start': S.startSession(btn.dataset.day); render(); window.scrollTo(0, 0); break;
      case 'w-': case 'w+': {
        const input = btn.parentElement.querySelector('input');
        const cur = S.parseNum(input.value);
        const base = Number.isNaN(cur) || cur == null ? 0 : cur;
        const next = Math.max(0, Math.round((base + (act === 'w+' ? 2.5 : -2.5)) * 100) / 100);
        input.value = fmt(next); input.classList.remove('invalid');
        c.st.weight = next; S.commit();
        break;
      }
      case 'toggle-set':
        if (!c.st.done && !setValid(c.st)) { toast('Cargá las repeticiones primero'); break; }
        c.st.done = !c.st.done; syncEx(c.ex); S.commit(); refreshDone(c.card, c.ex);
        break;
      case 'del-set':
        c.ex.sets.splice(c.j, 1); syncEx(c.ex); S.commit(); render();
        break;
      case 'add-set': {
        const prev = c.ex.sets[c.ex.sets.length - 1];
        c.ex.sets.push({ weight: prev ? prev.weight : null, reps: prev ? prev.reps : null, note: '', done: false });
        c.ex.done = false; S.commit(); render();
        break;
      }
      case 'complete-ex':
        if (c.ex.done) {
          c.ex.sets.forEach((st) => { st.done = false; }); c.ex.done = false;
        } else {
          let skipped = 0;
          c.ex.sets.forEach((st) => { if (setValid(st)) st.done = true; else skipped++; });
          syncEx(c.ex);
          if (skipped) toast(`${skipped} serie(s) sin reps quedaron sin marcar`);
        }
        S.commit(); refreshDone(c.card, c.ex);
        break;
      case 'finish': finishSession(); break;
      case 'discard':
        if (confirm('¿Descartar esta sesión? Se pierde lo cargado.')) { S.deleteSession(c.s.id); toast('Sesión descartada'); render(); }
        break;
      case 'back': ui.editId = null; go('history'); break;

      /* --- historial --- */
      case 'edit-session': {
        const sid = btn.closest('[data-sid]').dataset.sid;
        const s = S.find(S.state.sessions, sid);
        ui.editId = s.finished ? sid : null;   // las "en curso" se retoman directo
        go('train');
        break;
      }
      case 'del-session':
        if (confirm('¿Borrar esta sesión del historial? No se puede deshacer.')) {
          S.deleteSession(btn.closest('[data-sid]').dataset.sid); toast('Sesión borrada'); render();
        }
        break;

      /* --- rutina --- */
      case 'add-day': S.addDay(); render(); break;
      case 'day-up': case 'day-down': S.moveDay(btn.closest('[data-day]').dataset.day, act === 'day-up' ? -1 : 1); render(); break;
      case 'del-day': {
        const d = S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day);
        if (confirm(`¿Borrar "${d.name}" y sus ${d.exercises.length} ejercicios? El historial no se borra.`)) { S.deleteDay(d.id); render(); }
        break;
      }
      case 'add-ex': {
        const ex = S.addExercise(btn.closest('[data-day]').dataset.day);
        ui.open.add(ex.id); render();
        break;
      }
      case 'ex-up': case 'ex-down':
        S.moveExercise(btn.closest('[data-day]').dataset.day, btn.closest('[data-id]').dataset.id, act === 'ex-up' ? -1 : 1);
        render();
        break;
      case 'del-ex': {
        const dayId = btn.closest('[data-day]').dataset.day, id = btn.closest('[data-id]').dataset.id;
        const ex = S.find(S.find(S.state.routine.days, dayId).exercises, id);
        if (confirm(`¿Borrar "${ex.name}" de la rutina? El historial no se borra.`)) { S.deleteExercise(dayId, id); render(); }
        break;
      }

      /* --- cuenta --- */
      case 'login':
        btn.disabled = true;
        try { await Cloud.signIn(); } catch (err) {
          const box = document.getElementById('login-err');
          if (box) box.textContent = loginErrorText(err); else alert(loginErrorText(err));
        }
        btn.disabled = false;
        break;
      case 'skip-login': Cloud.skip(); break;
      case 'logout': {
        const pending = Cloud.status === 'syncing' || Cloud.status === 'offline';
        const msg = pending
          ? 'Hay cambios que todavía no se subieron a la nube. Si cerrás sesión ahora se conservan en este dispositivo y se suben la próxima vez que entres. ¿Cerrar sesión?'
          : '¿Cerrar sesión? Tus datos quedan guardados en la nube.';
        if (confirm(msg)) await Cloud.signOut();
        break;
      }

      /* --- datos --- */
      case 'export-json': download(`rutina-gym-backup-${S.todayStr()}.json`, S.exportJSON(), 'application/json'); toast('Backup descargado'); break;
      case 'export-csv': download(`historial-gym-${S.todayStr()}.csv`, S.exportCSV(), 'text/csv;charset=utf-8'); toast('CSV descargado'); break;
      case 'import-json': document.getElementById('file').click(); break;
      case 'reset-routine':
        if (confirm('¿Reemplazar tu rutina actual por la original de rutina.json? El historial se conserva.')) {
          try { await S.resetRoutine(); toast('Rutina restaurada'); render(); } catch (err) { alert(err.message); }
        }
        break;
    }
  });

  /* Escritura en inputs: valida y guarda sin redibujar (así no se pierde el foco). */
  $view.addEventListener('input', (e) => {
    const el = e.target;

    // Sesión: peso / reps de una serie
    if (el.dataset.f === 'weight' || el.dataset.f === 'reps') {
      const { st } = ctx(el);
      if (!st) return;
      let v = S.parseNum(el.value);
      if (el.dataset.f === 'reps' && !Number.isNaN(v) && v != null && !Number.isInteger(v)) v = NaN;
      el.classList.toggle('invalid', Number.isNaN(v));
      if (Number.isNaN(v)) return;                 // no guarda valores inválidos
      st[el.dataset.f] = v; S.commit();
      return;
    }

    // Rutina: nombre del día
    if (el.dataset.df === 'name') {
      const d = S.find(S.state.routine.days, el.closest('[data-day]').dataset.day);
      el.classList.toggle('invalid', !el.value.trim());
      if (el.value.trim()) { d.name = el.value.trim(); S.commit(); }
      return;
    }

    // Rutina: campos de un ejercicio
    if (el.dataset.rf) {
      const day = S.find(S.state.routine.days, el.closest('[data-day]').dataset.day);
      const box = el.closest('[data-id]');
      const ex = S.find(day.exercises, box.dataset.id);
      const f = el.dataset.rf;
      let ok = true;
      if (f === 'name') { ok = el.value.trim() !== ''; if (ok) ex.name = el.value.trim(); }
      else if (f === 'sets') { const n = Number(el.value); ok = Number.isInteger(n) && n >= 1 && n <= 20; if (ok) ex.sets = n; }
      else if (f === 'reps') { ex.reps = el.value; }
      else if (f === 'targetWeight') { const v = S.parseNum(el.value); ok = !Number.isNaN(v); if (ok) ex.targetWeight = v; }
      else if (f === 'notes') {
        ex.notes = el.value;
        const rev = isRevisar(ex.notes);
        el.classList.toggle('revisar-box', rev); box.classList.toggle('revisar-box', rev);
      }
      el.classList.toggle('invalid', !ok);
      if (ok) {
        S.commit();
        box.querySelector('[data-sum="name"]').textContent = ex.name;
        box.querySelector('[data-sum="info"]').textContent =
          `${ex.sets}×${ex.reps}${ex.targetWeight != null ? ' · ' + fmt(ex.targetWeight) + ' ' + unit() : ''}`;
      }
    }
  });

  /* Al salir de un campo inválido, vuelve al último valor guardado. */
  $view.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.f === 'date') {
      const s = currentSession();
      if (s && el.value) { s.date = el.value; S.commit(); }
      return;
    }
    if (el.dataset.f === 'prog') { ui.progKey = el.value; render(); return; }
    if (el.id === 'file') { importFile(el.files[0]); el.value = ''; return; }
    if (el.classList.contains('invalid')) {
      toast('Valor no válido: se restauró el anterior');
      const { st } = ctx(el);
      if (st && (el.dataset.f === 'weight' || el.dataset.f === 'reps')) {
        el.value = el.dataset.f === 'weight' ? fmt(st.weight) : (st.reps ?? '');
        el.classList.remove('invalid');
      } else render();
    }
  });

  /* Recuerda qué ejercicios del editor están desplegados (el evento "toggle" no burbujea). */
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches && d.matches('details.exe')) d.open ? ui.open.add(d.dataset.id) : ui.open.delete(d.dataset.id);
  }, true);

  /* ---------- arranque ---------- */

  S.onSaveError = () => toast('⚠ No se pudo guardar (almacenamiento lleno o bloqueado)');

  /* Datos nuevos de la nube (ej.: cargaste algo desde otro dispositivo). Si estás
     escribiendo en un campo se espera a que termines para no cortarte la edición. */
  let renderPending = false;
  const typing = () => {
    const a = document.activeElement;
    return !!(a && $view.contains(a) && a.matches('input, textarea, select'));
  };
  $view.addEventListener('focusout', () => {
    if (!renderPending) return;
    setTimeout(() => { if (!typing()) { renderPending = false; render(); } }, 350);
  });

  if (window.Cloud) {
    Cloud.onChange = () => {
      // Cambió el login o el estado: solo se redibuja si cambió algo visible importante.
      if (gated() !== document.body.classList.contains('gate') || ui.tab === 'data') {
        if (typing()) renderPending = true; else render();
      } else updateSyncBadge();
    };
    Cloud.onRemote = () => { if (typing()) renderPending = true; else render(); };
  }

  S.init()
    .then(() => (window.Cloud ? Cloud.init() : null))
    .then(render)
    .catch((err) => {
      $view.innerHTML = `<p class="empty">Error al iniciar: ${esc(err.message)}</p>`;
    });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin offline, pero la app sigue */ });
  }
})();
