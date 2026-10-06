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
    pasteOpen: false,    // caja para pegar el JSON de una rutina
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

  /** Vibración muy corta al completar algo (Android; en iPhone no existe y se ignora). */
  const haptic = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* nada */ } };

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

  /** Texto de una serie: "20×10" o, con drop set, "20×10 + 15×10". */
  const fmtSet = (st) => `${fmt(st.weight) || '–'}×${st.reps ?? '–'}`
    + (st.drop ? ` + ${fmt(st.drop.weight) || '–'}×${st.drop.reps ?? '–'}` : '');

  /** Una serie es válida para marcarla si tiene reps > 0 y peso vacío o >= 0.
   *  Si tiene parte drop con datos, también necesita reps > 0 (el drop vacío se ignora). */
  const setValid = (st) => st.reps > 0 && (st.weight == null || st.weight >= 0)
    && (!st.drop || (st.drop.weight == null && st.drop.reps == null) || st.drop.reps > 0);

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

  /** Texto "Última vez (fecha · otro día): series" de un ejercicio. */
  function prevText(s, ex) {
    const last = S.lastEntry(ex.name, s.id, s.dayId);
    if (!last) return 'Sin registros previos';
    const otherDay = last.dayId !== s.dayId && last.dayName ? ' · ' + esc(last.dayName) : '';
    return `Última vez (${fmtShort(last.date)}${otherDay}): ` + last.sets.map(fmtSet).join(' · ');
  }

  const targetText = (ex) => {
    const t = ex.target || {};
    return `${t.sets || ex.sets.length}×${esc(t.reps)}${t.weight != null ? ' · ' + fmt(t.weight) + ' ' + unit() : ''}`;
  };

  /** Tarjeta de un ejercicio normal. */
  function exerciseCard(s, ex, i) {
    return `
      <section class="card ex ${ex.done ? 'done' : ''}" data-ex="${i}">
        <div class="ex-head"><h3>${esc(ex.name)}</h3><span class="target">${targetText(ex)}</span></div>
        ${exerciseNote(s, i)}
        <p class="prev">${prevText(s, ex)}</p>
        <div class="set-head"><span>#</span><span>${ex.bar != null ? unit() + ' por lado' : unit()}</span><span>reps</span><span></span><span></span></div>
        ${ex.sets.map((st, j) => setRow(st, j, ex)).join('')}
        <div class="row" style="margin-top:8px">
          <button data-act="add-set">+ Serie</button>
          <button data-act="complete-ex" class="${ex.done ? '' : 'ok'}">${ex.done ? 'Deshacer' : '✓ Completar'}</button>
        </div>
        <button class="link-btn" data-act="toggle-drop">${ex.drop ? 'Quitar drop set' : 'Activar drop set'}</button>
      </section>`;
  }

  /** Tarjeta de superserie: 2+ ejercicios que se alternan. Cada serie lleva una línea por
   *  ejercicio (con su peso y reps) y UN solo tilde para la serie completa. */
  function supersetCard(s, idxs) {
    const exs = idxs.map((i) => s.exercises[i]);
    const allDone = exs.every((e) => e.done);
    const nSets = Math.max(...exs.map((e) => e.sets.length));
    const rows = [];
    for (let j = 0; j < nSets; j++) {
      const lines = idxs.map((i) => {
        const st = s.exercises[i].sets[j];
        if (!st) return '';
        return `
          <div class="ssline" data-ex="${i}">
            <span class="ssname">${esc(s.exercises[i].name)}${s.exercises[i].bar != null ? ' · discos por lado' : ''}</span>
            <div class="ssinputs">
              ${weightField(st, s.exercises[i], false, 'Peso de ' + esc(s.exercises[i].name))}
              <input class="reps" inputmode="numeric" data-f="reps" value="${st.reps ?? ''}" placeholder="0" aria-label="Repeticiones de ${esc(s.exercises[i].name)}">
              ${totCaption(st, s.exercises[i], false)}
            </div>
          </div>`;
      }).join('');
      const done = exs.every((e) => e.sets[j] && e.sets[j].done);
      rows.push(`
        <div class="setw" data-set="${j}">
          <div class="ssset ${done ? 'done' : ''}">
            <span class="n">${j + 1}</span>
            <div class="sslines">${lines}</div>
            <button class="chk" data-act="toggle-set" aria-label="Serie completa hecha">✓</button>
            <button class="x" data-act="del-set" aria-label="Quitar serie">×</button>
          </div>
        </div>`);
    }
    const notes = idxs.map((i) => exerciseNote(s, i, true)).join('');
    const prevs = exs.map((e) => `<p class="prev"><b>${esc(e.name)}</b> · ${prevText(s, e)}</p>`).join('');
    return `
      <section class="card ex superset ${allDone ? 'done' : ''}" data-ex="${idxs[0]}" data-group="${idxs.join(',')}">
        <div class="ex-head"><h3>Superserie</h3><span class="target">${exs.map(targetText).join(' + ')}</span></div>
        ${notes}
        ${prevs}
        ${rows.join('')}
        <div class="row" style="margin-top:8px">
          <button data-act="add-set">+ Serie</button>
          <button data-act="complete-ex" class="${allDone ? '' : 'ok'}">${allDone ? 'Deshacer' : '✓ Completar'}</button>
        </div>
      </section>`;
  }

  function trainSession(s) {
    const editing = !!ui.editId;
    const exCards = S.groupRuns(s.exercises).map((idxs) =>
      idxs.length > 1 ? supersetCard(s, idxs) : exerciseCard(s, s.exercises[idxs[0]], idxs[0])).join('');

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
  function exerciseNote(s, i, withName) {
    const name = S.normName(s.exercises[i].name);
    const day = S.state.routine.days.find((d) => d.id === s.dayId);
    const re = day && day.exercises.find((e) => S.normName(e.name) === name);
    if (!re || !re.notes) return '';
    return `<div class="note ${isRevisar(re.notes) ? 'revisar' : ''}">${withName ? '<b>' + esc(s.exercises[i].name) + ':</b> ' : ''}${esc(re.notes)}</div>`;
  }

  /* ---------- peso: directo, o por lado si el ejercicio usa barra ---------- */

  /** Texto del total bajo el campo: "= 60 kg" (o el peso de la barra si todavía está vacío). */
  function totText(st, ex, isDrop) {
    const w = isDrop ? (st.drop && st.drop.weight) : st.weight;
    return w != null ? `= ${fmt(w)} ${unit()}` : `barra ${fmt(ex.bar)} ${unit()}`;
  }

  /** Campo de peso con sus botones −/+. Con barra se cargan los discos POR LADO. */
  function weightField(st, ex, isDrop, aria) {
    const perSide = ex.bar != null;
    const src = isDrop ? (st.drop || {}) : st;
    const f = (isDrop ? 'd' : '') + (perSide ? 'side' : 'weight');
    const val = perSide ? S.sideOf(src, ex.bar) : src.weight;
    const ph = perSide ? 'x lado' : (isDrop ? 'drop kg' : '0');
    return `
        <div class="stepper">
          <button data-act="${isDrop ? 'dw-' : 'w-'}" aria-label="Menos peso">−</button>
          <input inputmode="decimal" data-f="${f}" value="${fmt(val)}" placeholder="${ph}" aria-label="${aria}${perSide ? ' (discos por lado)' : ''}">
          <button data-act="${isDrop ? 'dw+' : 'w+'}" aria-label="Más peso">+</button>
        </div>`;
  }
  const totCaption = (st, ex, isDrop) => (ex.bar != null ? `<span class="tot">${totText(st, ex, isDrop)}</span>` : '');

  /** Guarda un peso tecleado. Con barra: discos por lado → total = barra + 2 × lado. */
  function setWeight(st, ex, f, v) {
    if (f === 'weight') { st.weight = v; return; }
    if (f === 'side') { st.side = v; st.weight = S.barTotal(ex.bar, v); return; }
    st.drop = st.drop || S.blankDrop(ex.target && ex.target.reps);
    if (f === 'dweight') st.drop.weight = v;
    else { st.drop.side = v; st.drop.weight = S.barTotal(ex.bar, v); }
  }

  /** Refresca el "= total" junto al campo, sin redibujar (no se pierde el foco). */
  function updateTot(input, st, ex) {
    const holder = input.closest('.set, .dropline, .ssinputs');
    const t = holder && holder.querySelector('.tot');
    if (t) t.textContent = totText(st, ex, input.dataset.f.startsWith('d'));
  }

  /** Una serie = fila principal + (si el ejercicio es drop set) una segunda línea
   *  "↳" con el peso menor y las reps que se hacen enseguida, sin pausa. */
  function setRow(st, j, ex) {
    const drop = ex.drop ? `
      <div class="dropline">
        <span class="arrow" title="Drop set: sin pausa, con menos peso">↳</span>
        ${weightField(st, ex, true, 'Peso del drop')}
        <input class="reps" inputmode="numeric" data-f="dreps" value="${st.drop && st.drop.reps != null ? st.drop.reps : ''}" placeholder="reps" aria-label="Repeticiones del drop">
        <span></span><span></span>
        ${totCaption(st, ex, true)}
      </div>` : '';
    return `
    <div class="setw" data-set="${j}">
      <div class="set ${st.done ? 'done' : ''}">
        <span class="n">${j + 1}</span>
        ${weightField(st, ex, false, 'Peso')}
        <input class="reps" inputmode="numeric" data-f="reps" value="${st.reps ?? ''}" placeholder="0" aria-label="Repeticiones">
        <button class="chk" data-act="toggle-set" aria-label="Serie hecha">✓</button>
        <button class="x" data-act="del-set" aria-label="Quitar serie">×</button>
        ${totCaption(st, ex, false)}
      </div>${drop}
    </div>`;
  }

  /** Actualiza solo las clases de una tarjeta (ejercicio o superserie), sin redibujar
   *  (así no se pierde el foco ni el teclado). */
  function refreshCard(card, exs) {
    const all = exs.every((e) => e.done);
    card.classList.toggle('done', all);
    card.querySelectorAll('.setw').forEach((w, j) => {
      const done = exs.every((e) => e.sets[j] && e.sets[j].done);
      const row = w.querySelector('.set, .ssset');
      if (row) row.classList.toggle('done', done);
    });
    const btn = card.querySelector('[data-act="complete-ex"]');
    btn.textContent = all ? 'Deshacer' : '✓ Completar';
    btn.classList.toggle('ok', !all);
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
        .reduce((b, x) => b + S.setVolume(x), 0), 0);
      const exs = s.exercises.map((ex) => {
        const sets = ex.sets.filter((x) => x.done).map(fmtSet).join(', ');
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
        plugins: { legend: { labels: { color: c('--text'), usePointStyle: true, boxWidth: 8, boxHeight: 8 } } },
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
      ${(() => {
        const inSS = new Set(S.groupRuns(d.exercises).filter((r) => r.length > 1).flat());
        return d.exercises.map((e, ei) => exerciseEditor(e, ei, d.exercises.length, inSS.has(ei),
          ei < d.exercises.length - 1 && !!e.group && d.exercises[ei + 1].group === e.group)).join('');
      })()}
      <button class="block" style="margin-top:8px" data-act="add-ex">+ Agregar ejercicio</button>
    </section>`;
  }

  /** Resumen de un ejercicio en el editor: "4×5 · 60 kg · barra 20". */
  const exInfo = (e) => `${e.sets}×${e.reps}${e.targetWeight != null ? ' · ' + fmt(e.targetWeight) + ' ' + unit() : ''}${e.bar != null ? ' · barra ' + fmt(e.bar) : ''}`;
  const BAR_CHIPS = [['', 'Sin barra'], ['20', '20 kg'], ['17.5', '17,5 kg']];

  function exerciseEditor(e, ei, n, inSuperset, linkedNext) {
    const rev = isRevisar(e.notes);
    return `
    <details class="exe ${rev ? 'revisar-box' : ''}" data-id="${esc(e.id)}" ${ui.open.has(e.id) ? 'open' : ''}>
      <summary>
        <span><b data-sum="name">${esc(e.name)}</b>
          <span class="muted" data-sum="info">${esc(exInfo(e))}</span>
          ${inSuperset ? '<span class="badge">Superserie</span>' : ''}
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
        <label>Barra: cargás los discos por lado y la app suma el total</label>
        <div class="chips">
          ${BAR_CHIPS.map(([v, l]) => `<button class="chip ${String(e.bar ?? '') === v ? 'on' : ''}" data-act="set-bar" data-bar="${v}">${l}</button>`).join('')}
        </div>
        <input data-rf="bar" inputmode="decimal" value="${fmt(e.bar)}" placeholder="Otra barra: sus kg (0 si no sabés el peso)" aria-label="Peso de la barra">
        <label>Notas</label>
        <textarea data-rf="notes" class="${rev ? 'revisar-box' : ''}">${esc(e.notes)}</textarea>
        ${e.original ? `<div class="original">Original del PDF: ${esc(e.original)}</div>` : ''}
        ${ei < n - 1 ? `<button class="block" style="margin-top:10px" data-act="toggle-ss">${linkedNext ? '⛓ Quitar superserie con el siguiente' : '⛓ Hacer superserie con el siguiente'}</button>` : ''}
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
        <h2>Cambiar la rutina</h2>
        <p class="muted">Reemplaza solo los días y ejercicios. <b>Tu historial no se toca.</b> Antes de aplicar te muestra un resumen y se guarda la rutina anterior para poder deshacer.</p>
        <button class="primary block" data-act="import-routine-file">⬆ Importar rutina (archivo JSON)</button>
        <input type="file" id="file-routine" accept="application/json,.json" hidden>
        <button class="block" data-act="toggle-paste">${ui.pasteOpen ? 'Cancelar' : '📋 Importar rutina pegando texto'}</button>
        ${ui.pasteOpen ? `
          <textarea id="paste-json" rows="8" placeholder='Pegá acá el JSON de la rutina' spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>
          <button class="primary block" data-act="apply-paste">Aplicar rutina pegada</button>` : ''}
        ${S.hasRoutineBackup() ? '<button class="block" data-act="undo-routine">↩ Deshacer última importación de rutina</button>' : ''}
      </div>
      <div class="card stack">
        <h2>Rutina original</h2>
        <p class="muted">Vuelve a cargar la rutina de rutina.json. No toca el historial.</p>
        <button class="block danger" data-act="reset-routine">Restaurar rutina original</button>
      </div>`;
  }

  /** Importa solo la rutina desde un texto JSON, con resumen y confirmación. */
  function applyRoutineText(text) {
    try {
      const routine = S.parseRoutineImport(text);
      const nEx = routine.days.reduce((n, d) => n + d.exercises.length, 0);
      const resumen = routine.days.map((d) => `• ${d.name}: ${d.exercises.length} ejercicios`).join('\n');
      if (!confirm(`Vas a REEMPLAZAR tu rutina actual por esta:\n\n${resumen}\n\nTotal: ${nEx} ejercicios.\nTu historial NO se modifica y podés deshacer desde Datos.\n\n¿Continuar?`)) return;
      S.replaceRoutine(routine);
      ui.pasteOpen = false;
      toast('Rutina actualizada ✓ — revisá las notas marcadas');
      go('routine');
    } catch (err) {
      alert('No se pudo importar la rutina: ' + err.message);
    }
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
    $view.classList.remove('enter'); void $view.offsetWidth; $view.classList.add('enter');
    window.scrollTo(0, 0);
  }

  /* ======================================================================
     EVENTOS (delegación: un solo listener por tipo)
     ====================================================================== */

  /** Datos de la serie/ejercicio bajo el elemento clickeado (pestaña Entrenar). */
  function ctx(el) {
    const s = currentSession();
    const card = el.closest('.ex');                 // tarjeta (puede agrupar varios ejercicios: superserie)
    const exEl = el.closest('[data-ex]');           // el ejercicio exacto (en superseries, cada línea)
    const row = el.closest('[data-set]');
    const g = card && card.dataset.group;
    const idxs = card ? (g ? g.split(',').map(Number) : [+card.dataset.ex]) : [];
    const ex = s && exEl ? s.exercises[+exEl.dataset.ex] : null;
    const st = ex && row ? ex.sets[+row.dataset.set] : null;
    const exs = s ? idxs.map((i) => s.exercises[i]) : [];
    return { s, card, row, ex, st, j: row ? +row.dataset.set : -1, idxs, exs };
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
      case 'w-': case 'w+': case 'dw-': case 'dw+': {
        const input = btn.parentElement.querySelector('input');
        const f = input.dataset.f;                         // weight | side | dweight | dside
        const perSide = f.endsWith('side');
        const step = perSide ? 1.25 : 2.5;                 // por lado: 1,25 (= 2,5 al total)
        const cur = S.parseNum(input.value);
        let base = Number.isNaN(cur) ? null : cur;
        if (base == null) {
          // Drop vacío: se parte del peso de la serie principal; si no, de 0.
          base = f.startsWith('d') ? (perSide ? S.sideOf(c.st, c.ex.bar) : c.st.weight) || 0 : 0;
        }
        const next = Math.max(0, Math.round((base + (act.endsWith('+') ? step : -step)) * 100) / 100);
        input.value = fmt(next); input.classList.remove('invalid');
        setWeight(c.st, c.ex, f, next); S.commit(); updateTot(input, c.st, c.ex);
        break;
      }
      case 'toggle-drop':
        c.ex.drop = !c.ex.drop;
        c.ex.sets.forEach((st) => {
          st.drop = c.ex.drop ? (st.drop || S.blankDrop(c.ex.target && c.ex.target.reps)) : null;
        });
        S.commit(); render();
        break;
      case 'toggle-set': {
        // Una serie (o la serie completa de una superserie): todos los ejercicios del grupo a la vez.
        const sts = c.exs.map((e) => e.sets[c.j]).filter(Boolean);
        const turnOn = !sts.every((x) => x.done);
        if (turnOn && !sts.every(setValid)) { toast('Cargá las repeticiones primero'); break; }
        sts.forEach((x) => { x.done = turnOn; });
        c.exs.forEach(syncEx); S.commit(); refreshCard(c.card, c.exs);
        if (turnOn) {                                      // pulso en el tilde, en el mismo instante
          const chk = c.row.querySelector('.chk');
          chk.classList.remove('pop'); void chk.offsetWidth; chk.classList.add('pop');
          haptic(12);
        }
        break;
      }
      case 'del-set':
        c.exs.forEach((e) => { e.sets.splice(c.j, 1); syncEx(e); });
        S.commit(); render();
        break;
      case 'add-set':
        c.exs.forEach((e) => {
          const prev = e.sets[e.sets.length - 1];
          e.sets.push({
            weight: prev ? prev.weight : null, side: prev ? prev.side ?? null : null, reps: prev ? prev.reps : null,
            drop: e.drop ? (prev && prev.drop ? Object.assign({}, prev.drop) : S.blankDrop(e.target && e.target.reps)) : null,
            note: '', done: false,
          });
          e.done = false;
        });
        S.commit(); render();
        break;
      case 'complete-ex': {
        if (c.exs.every((e) => e.done)) {
          c.exs.forEach((e) => { e.sets.forEach((st) => { st.done = false; }); e.done = false; });
        } else {
          let skipped = 0;
          c.exs.forEach((e) => { e.sets.forEach((st) => { if (setValid(st)) st.done = true; else skipped++; }); syncEx(e); });
          if (skipped) toast(`${skipped} serie(s) sin reps quedaron sin marcar`);
        }
        S.commit(); refreshCard(c.card, c.exs);
        if (c.exs.every((e) => e.done)) haptic(18);
        break;
      }
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
      case 'set-bar': {
        const id = btn.closest('[data-id]').dataset.id;
        const ex = S.find(S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day).exercises, id);
        ex.bar = btn.dataset.bar === '' ? null : Number(btn.dataset.bar);
        S.commit(); ui.open.add(id); render();
        break;
      }
      case 'toggle-ss': {
        const id = btn.closest('[data-id]').dataset.id;
        S.toggleSuperset(btn.closest('[data-day]').dataset.day, id);
        ui.open.add(id); render();
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
      case 'import-routine-file': document.getElementById('file-routine').click(); break;
      case 'toggle-paste': ui.pasteOpen = !ui.pasteOpen; render(); break;
      case 'apply-paste': applyRoutineText(document.getElementById('paste-json').value); break;
      case 'undo-routine':
        if (confirm('¿Volver a la rutina que tenías antes de la última importación? El historial no se modifica.')) {
          if (S.restoreRoutineBackup()) { toast('Rutina anterior restaurada'); go('routine'); } else alert('No hay rutina anterior guardada.');
        }
        break;
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
    if (['weight', 'side', 'dweight', 'dside'].includes(el.dataset.f)) {
      const { st, ex } = ctx(el);
      if (!st) return;
      const v = S.parseNum(el.value);
      el.classList.toggle('invalid', Number.isNaN(v));
      if (Number.isNaN(v)) return;                 // no guarda valores inválidos
      setWeight(st, ex, el.dataset.f, v); S.commit(); updateTot(el, st, ex);
      return;
    }
    if (el.dataset.f === 'reps') {
      const { st } = ctx(el);
      if (!st) return;
      let v = S.parseNum(el.value);
      if (!Number.isNaN(v) && v != null && !Number.isInteger(v)) v = NaN;
      el.classList.toggle('invalid', Number.isNaN(v));
      if (Number.isNaN(v)) return;
      st.reps = v; S.commit();
      return;
    }

    // Sesión: peso / reps de la parte drop de una serie
    if (el.dataset.f === 'dreps') {
      const { st, ex } = ctx(el);
      if (!st) return;
      let v = S.parseNum(el.value);
      if (!Number.isNaN(v) && v != null && !Number.isInteger(v)) v = NaN;
      el.classList.toggle('invalid', Number.isNaN(v));
      if (Number.isNaN(v)) return;
      st.drop = st.drop || S.blankDrop(ex.target && ex.target.reps);
      st.drop.reps = v; S.commit();
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
      else if (f === 'bar') {
        const v = S.parseNum(el.value); ok = !Number.isNaN(v);
        if (ok) {
          ex.bar = v;
          box.querySelectorAll('[data-act="set-bar"]').forEach((b) => b.classList.toggle('on', b.dataset.bar === String(ex.bar ?? '')));
        }
      }
      else if (f === 'notes') {
        ex.notes = el.value;
        const rev = isRevisar(ex.notes);
        el.classList.toggle('revisar-box', rev); box.classList.toggle('revisar-box', rev);
      }
      el.classList.toggle('invalid', !ok);
      if (ok) {
        S.commit();
        box.querySelector('[data-sum="name"]').textContent = ex.name;
        box.querySelector('[data-sum="info"]').textContent = exInfo(ex);
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
    if (el.id === 'file-routine') {
      const f = el.files[0]; el.value = '';
      if (f) f.text().then(applyRoutineText);
      return;
    }
    if (el.classList.contains('invalid')) {
      toast('Valor no válido: se restauró el anterior');
      const { st, ex } = ctx(el);
      if (st && ['weight', 'side', 'reps', 'dweight', 'dside', 'dreps'].includes(el.dataset.f)) {
        const d = st.drop || {};
        el.value = {
          weight: fmt(st.weight), side: fmt(S.sideOf(st, ex.bar)), reps: st.reps ?? '',
          dweight: fmt(d.weight), dside: fmt(S.sideOf(d, ex.bar)), dreps: d.reps ?? '',
        }[el.dataset.f];
        el.classList.remove('invalid');
      } else render();
    }
  });

  /* Al tocar peso o reps se selecciona todo el contenido: se escribe encima, sin borrar antes.
     (El teclado numérico ya se abre solo por inputmode="decimal"/"numeric".) */
  $view.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.matches && el.matches('.setw input[data-f]')) {
      setTimeout(() => { try { el.select(); el.setSelectionRange(0, 99); } catch (err) { /* nada */ } }, 0);
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
