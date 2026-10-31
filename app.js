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
    sel: null,           // Historial: ids elegidos para compartir (null = modo normal)
    progKey: null,       // ejercicio elegido en Progreso
    progDay: null,       // día elegido en el gráfico de volumen por día
    progWeek: null,      // semana elegida en series por músculo
    mopen: new Set(),    // ejercicios del editor con los botones de músculos abiertos
    helpOpen: new Set(), // ayudas ya leídas que se volvieron a abrir con ⓘ
    chart: null,
  };

  const $view = document.getElementById('view');

  /* ---------- utilidades ---------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Número a texto con coma decimal (es-AR). */
  const fmt = (n) => (n == null || Number.isNaN(n) ? '' : String(Math.round(n * 100) / 100).replace('.', ','));
  const unit = () => (S.state.weightUnit === 'lb' ? 'lb' : 'kg');   // nunca texto libre: se pega en HTML

  /** "2026-10-05" -> Date local (evita el corrimiento por zona horaria). */
  const toDate = (str) => { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (str) => toDate(str).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtShort = (str) => toDate(str).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });

  const isRevisar = (txt) => /\bREVISAR\b/.test(txt || '');

  /* Íconos de línea (mismo trazo que la barra inferior); el tamaño lo da el texto o el CSS. */
  const icon = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    check: icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
    chevron: icon('<path d="M9.5 5.5L16 12l-6.5 6.5"/>'),
    arrow: icon('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    trash: icon('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>'),
    barbell: icon('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
  };

  /* Ayudas: se ven abiertas hasta tocar "Entendido" (se recuerda en este dispositivo); después
     queda un ⓘ junto al título que las vuelve a abrir. Los avisos (sesión de ayer, backup) no van acá. */
  const helpSeen = (id) => !!S.getPref('help.' + id);
  const helpBox = (id, html) => (S.opt('help') && (!helpSeen(id) || ui.helpOpen.has(id)) ? `
    <div class="help-box"><div>${html}</div><button class="help-ok" data-act="help-ok" data-help="${id}">Entendido</button></div>` : '');
  const helpBtn = (id) => (S.opt('help') && helpSeen(id) && !ui.helpOpen.has(id)
    ? `<button class="info" data-act="help-show" data-help="${id}" aria-label="Ver ayuda">i</button>` : '');

  /** Casillero de RIR de una serie (opcional; se esconde desde Datos → Opciones, sin borrar lo guardado). */
  const rirInput = (st) => (S.opt('rir')
    ? `<input class="rir" inputmode="numeric" data-f="rir" value="${st.rir ?? ''}" placeholder="RIR" aria-label="Repeticiones en reserva (RIR)">` : '');

  /** Vibración muy corta al completar algo (Android; en iPhone no existe y se ignora). */
  const haptic = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* nada */ } };

  let toastTimer;
  /** Aviso breve abajo. Con action ({ label, fn }) suma un botón (ej.: "Deshacer") y dura más. */
  function toast(msg, action) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.toggle('act', !!action);
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => { clearTimeout(toastTimer); t.classList.remove('show'); action.fn(); };
      t.appendChild(b);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
  }

  /** Por encima de esto, antes de marcar se pregunta "¿seguro?" (casi siempre es un error de tipeo). */
  const MAX_KG = 400, MAX_REPS = 100;
  /** "1.000" / "2.500": punto de miles, que se leería como 1 kg. Se rechaza: los decimales van con coma. */
  const isThousands = (txt) => /^\d{1,3}\.\d{3}$/.test(String(txt || '').trim());

  /** Ventana con varias opciones (para cuando confirm(), con solo Aceptar/Cancelar, no alcanza).
   *  options: [{ label, value, cls }]. Devuelve una promesa con el value elegido, o null si se
   *  cierra sin elegir (tocar afuera o Esc). Los toques del primer instante se ignoran: así un
   *  doble toque en el botón que la abrió no elige una opción sin querer. */
  function choose(title, html, options) {
    return new Promise((resolve) => {
      const opened = Date.now();
      const box = document.createElement('div');
      box.className = 'sheet-bg';
      box.innerHTML = `
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">
          <h2 id="sheet-t">${esc(title)}</h2>
          ${html ? `<p class="muted">${html}</p>` : ''}
          <div class="stack">${options.map((o, i) =>
            `<button class="block ${o.cls || ''}" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>
        </div>`;
      const close = (v) => { document.removeEventListener('keydown', key, true); box.remove(); resolve(v); };
      const key = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); close(null); } };
      box.addEventListener('click', (ev) => {
        if (Date.now() - opened < 450) return;
        const b = ev.target.closest('button[data-i]');
        if (b) close(options[+b.dataset.i].value);
        else if (ev.target === box) close(null);
      });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(box);
    });
  }

  /** Recorrido de primer uso: pasos cortos, uno por ventana. Se puede salir en cualquier momento. */
  const TOUR = [
    ['1 de 5 · Entrenar', 'Elegí el día (la app te propone el que toca). Cargá peso y repeticiones de cada serie y tocá ✓. Arriba de cada ejercicio ves "Última vez" para saber qué superar.'],
    ['2 de 5 · Terminar', 'Al final tocá "Terminar". Si quedaron series sin ✓, te pregunto qué hacer con ellas: nada se borra si vos no lo elegís.'],
    ['3 de 5 · Historial y Progreso', 'En Historial ves tus sesiones y podés mandar varios días por WhatsApp. En Progreso hay gráficos, tu 1RM estimado y los ejercicios que se estancaron.'],
    ['4 de 5 · Rutina', 'Cambiá ejercicios, series, repeticiones y notas. Con Enter pasás al campo siguiente. Cambiar la rutina no toca tu historial.'],
    ['5 de 5 · Datos y Opciones', 'Tus datos viven en este dispositivo: exportá un backup de vez en cuando, o entrá con Google para sincronizarlos. En Opciones prendés o apagás RIR, RPE, 1RM y las ayudas.'],
  ];
  async function runTour() {
    for (let i = 0; i < TOUR.length; i++) {
      const last = i === TOUR.length - 1;
      const v = await choose(TOUR[i][0], esc(TOUR[i][1]), [
        { label: last ? 'Listo, empezar' : 'Siguiente', value: 'next', cls: 'primary' },
        ...(i ? [{ label: 'Anterior', value: 'back' }] : []),
        ...(last ? [] : [{ label: 'Salir', value: 'exit' }]),
      ]);
      if (v === 'back') i -= 2;
      else if (v !== 'next') break;
    }
    S.setPref('tour', 1);
    if (ui.tab === 'train') render();
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
  /** Día sugerido: el que hace más tiempo que no se hace (uno que nunca se hizo va primero, en el orden
   *  de la rutina). Con una rotación normal coincide con "el siguiente"; si se saltea un día, lo propone. */
  function suggestedDayId(stats) {
    const days = S.state.routine.days.filter((d) => d.exercises.length);
    if (!days.length) return S.state.routine.days[0] && S.state.routine.days[0].id;
    const st = stats || S.dayStats();
    const order = (d) => (st[d.id].last ? st[d.id].last.order : -1);
    return days.slice().sort((a, b) => order(a) - order(b))[0].id;
  }

  /** "hoy" · "ayer" · "hace 5 días" para una fecha "AAAA-MM-DD". */
  const daysAgo = (date) => Math.round((toDate(S.todayStr()) - toDate(date)) / 864e5);
  const agoText = (date) => { const n = daysAgo(date); return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`; };

  function viewTrain() {
    const s = currentSession();
    return s ? trainSession(s) : trainPicker();
  }

  function trainPicker() {
    const days = S.state.routine.days;
    if (!days.length) return '<h1>Entrenar</h1><p class="empty">No hay días en la rutina. Creá uno en la pestaña Rutina.</p>';
    const stats = S.dayStats();
    const next = suggestedDayId(stats);
    const trained = S.state.sessions.some((s) => s.finished);
    // Debajo de cada día, cuándo se hizo por última vez (así se ve qué día quedó atrás).
    const when = (d) => (!trained ? '' : stats[d.id].last
      ? ` · ${agoText(stats[d.id].last.date)}` : ' · <span class="warn-txt">nunca</span>');
    const tourCard = !trained && !S.getPref('tour') ? `
      <div class="note"><b>¿Primera vez?</b> Hay un recorrido de 1 minuto.
        <div class="row" style="margin-top:8px"><button class="primary" data-act="tour">Ver recorrido</button>
        <button data-act="tour-skip">Ahora no</button></div></div>` : '';
    // El día sugerido es el protagonista; los demás quedan en una lista tranquila.
    const nextDay = days.find((d) => d.id === next);
    const hero = nextDay ? `
      <button class="hero block" data-act="start" data-day="${esc(nextDay.id)}">
        <span class="eyebrow">Sugerido hoy</span>
        <span class="hero-name">${esc(nextDay.name)}</span>
        <span class="hero-meta">${nextDay.exercises.length} ejercicios${when(nextDay)}</span>
        <span class="hero-go">Empezar ${ICON.arrow}</span>
      </button>` : '';
    const others = days.filter((d) => d !== nextDay).map((d) => `
      <button class="day-btn" data-act="start" data-day="${esc(d.id)}">
        <span>${esc(d.name)}<small>${d.exercises.length} ejercicios${when(d)}</small></span>
        ${ICON.chevron}
      </button>`).join('');
    return `<h1>¿Qué día entrenás?</h1>${tourCard}${exampleNote()}${hero}${others ? `<div class="card daylist">${others}</div>` : ''}`;
  }

  /** ¿La rutina es todavía la de fábrica (ejemplo.json, o rutina.json en instalaciones viejas) y nunca
   *  se entrenó? Compara días y ejercicios por nombre. */
  function isExampleRoutine() {
    if (S.state.sessions.some((s) => s.finished)) return false;
    const sig = (days) => JSON.stringify(days.map((d) => d.exercises.map((e) => S.normName(e.name))));
    const mine = sig(S.state.routine.days);
    return [window.EXAMPLE_DATA, window.SEED_DATA].some((d) => d && sig(d.routine.days) === mine);
  }
  const exampleNote = () => (isExampleRoutine()
    ? `<div class="note"><b>Esta es una rutina de ejemplo.</b> Cambiala en la pestaña Rutina o cargá la tuya en Datos → Importar rutina. Tocá un día para empezar a anotar.</div>`
    : '');

  /** RIR de la vez anterior, solo si se cargó y las opciones lo permiten. Igual en todas: "RIR 2 en todas". */
  function prevRir(sets) {
    if (!S.opt('rir') || !S.opt('rirPrev') || !sets.some((st) => st.rir != null)) return null;
    const all = sets.every((st) => st.rir != null && st.rir === sets[0].rir);
    return all ? { all: sets[0].rir } : { each: sets.map((st) => (st.rir != null ? st.rir : null)) };
  }

  /** Texto "Última vez (fecha · otro día): series" de un ejercicio. */
  function prevText(s, ex) {
    const last = S.lastEntry(ex.name, s.id, s.dayId);
    if (!last) return 'Sin registros previos';
    const otherDay = last.dayId !== s.dayId && last.dayName ? ' · ' + esc(last.dayName) : '';
    const r = prevRir(last.sets);
    const body = last.sets.map((st, i) => fmtSet(st) + (r && r.each && r.each[i] != null ? ` (RIR ${r.each[i]})` : '')).join(' · ');
    return `Última vez (${fmtShort(last.date)}${otherDay}): ` + body + (r && r.all != null ? ` · RIR ${r.all} en todas` : '');
  }

  const targetText = (ex) => {
    const t = ex.target || {};
    return `${t.sets || ex.sets.length}×${esc(t.reps)}${t.weight != null ? ' · ' + fmt(t.weight) + ' ' + unit() : ''}`;
  };

  /** Tarjeta de un ejercicio normal. */
  function exerciseCard(s, ex, i) {
    return `
      <section class="card ex ${ex.done ? 'done' : ''}" data-ex="${i}">
        <div class="ex-head"><h3>${esc(ex.name)}${ex.drop ? helpBtn('drop') : ''}</h3><span class="target">${targetText(ex)}</span></div>
        ${exerciseNote(s, i)}
        <p class="prev">${prevText(s, ex)}</p>
        ${barPicker(ex, i)}
        ${ex.drop ? helpBox('drop', '↳ <b>Drop set:</b> cada serie tiene una segunda parte sin descanso, con menos peso.') : ''}
        <div class="set-head"><span>#</span><span>${weightHead(ex)}</span><span>${S.opt('rir') ? 'reps · RIR' : 'reps'}</span><span></span><span></span></div>
        ${ex.sets.map((st, j) => setRow(st, j, ex)).join('')}
        <div class="row" style="margin-top:8px">
          <button data-act="add-set">+ Serie</button>
          <button data-act="complete-ex" class="${ex.done ? '' : 'ok'}">${ex.done ? 'Desmarcar todo' : '✓ Completar'}</button>
        </div>
        <button class="link-btn" data-act="toggle-drop">${ex.drop ? 'Quitar drop set' : 'Activar drop set'}</button>
        ${rpeRow(ex)}
        ${commentBox(ex)}
      </section>`;
  }

  /** Esfuerzo del ejercicio (RPE 1-10). Solo si la opción está prendida. */
  function rpeRow(ex) {
    if (!S.opt('rpe')) return '';
    const vals = []; for (let v = 5; v <= 10; v += 0.5) vals.push(v);
    return `<div class="rpe-row"><label>${esc(ex.name)} · RPE (qué tan duro fue, 10 = al límite)
      <select data-f="rpe" aria-label="RPE de ${esc(ex.name)}"><option value="">–</option>${vals.map((v) => `<option value="${v}" ${ex.rpe === v ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select></label></div>`;
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
            <span class="ssname">${esc(s.exercises[i].name)}${{ bar: ' · discos de UN lado', bricks: ' · cantidad de bloques', plain: '' }[loadMode(s.exercises[i])]}</span>
            <div class="ssinputs">
              ${weightField(st, s.exercises[i], false, 'Peso de ' + esc(s.exercises[i].name))}
              <input class="reps" inputmode="numeric" data-f="reps" value="${st.reps ?? ''}" placeholder="0" aria-label="Repeticiones de ${esc(s.exercises[i].name)}">
              ${totCaption(st, s.exercises[i], false)}
              ${rirInput(st)}
            </div>
          </div>`;
      }).join('');
      const done = exs.every((e) => e.sets[j] && e.sets[j].done);
      rows.push(`
        <div class="setw" data-set="${j}">
          <div class="ssset ${done ? 'done' : ''}">
            <span class="n">${j + 1}</span>
            <div class="sslines">${lines}</div>
            <button class="chk" data-act="toggle-set" aria-label="Serie completa hecha">${ICON.check}</button>
            <button class="x" data-act="del-set" aria-label="Quitar serie">${ICON.close}</button>
          </div>
        </div>`);
    }
    const notes = idxs.map((i) => exerciseNote(s, i, true)).join('');
    const rpes = idxs.map((i) => `<div data-ex="${i}">${rpeRow(s.exercises[i])}</div>`).join('');
    const prevs = exs.map((e) => `<p class="prev"><b>${esc(e.name)}</b> · ${prevText(s, e)}</p>`).join('');
    return `
      <section class="card ex superset ${allDone ? 'done' : ''}" data-ex="${idxs[0]}" data-group="${idxs.join(',')}">
        <div class="ex-head"><h3>Superserie${helpBtn('superset')}</h3><span class="target">${exs.map(targetText).join(' + ')}</span></div>
        ${helpBox('superset', 'Hacé una serie de cada ejercicio, uno tras otro, y recién ahí descansá. El ✓ marca la vuelta completa.')}
        ${notes}
        ${prevs}
        ${idxs.map((i) => barPicker(s.exercises[i], i, s.exercises[i].name)).join('')}
        ${rows.join('')}
        <div class="row" style="margin-top:8px">
          <button data-act="add-set">+ Serie</button>
          <button data-act="complete-ex" class="${allDone ? '' : 'ok'}">${allDone ? 'Desmarcar todo' : '✓ Completar'}</button>
        </div>
        ${rpes}
        ${exs.map((e) => commentBox(e, true)).join('')}
      </section>`;
  }

  /** Barra fija de avance de la sesión: series hechas sobre el total. */
  let sessShown = null;   // sesión dibujada (la usa refreshCard para actualizar la barra)
  function sessCount(s) {
    const sets = s.exercises.flatMap((ex) => ex.sets), done = sets.filter((st) => st.done).length;
    return { done, total: sets.length, pct: sets.length ? Math.round((done / sets.length) * 100) : 0 };
  }
  function sessBarHtml(s) {
    const c = sessCount(s);
    return `<span><b>${c.done}</b> de ${c.total} series</span>
      <span class="sess-track"><i style="width:${c.pct}%"></i></span>`;
  }

  function trainSession(s) {
    const editing = !!ui.editId;
    sessShown = s;
    const exCards = S.groupRuns(s.exercises).map((idxs) =>
      idxs.length > 1 ? supersetCard(s, idxs) : exerciseCard(s, s.exercises[idxs[0]], idxs[0])).join('');

    const anyDone = s.exercises.some((ex) => ex.sets.some((st) => st.done));
    // Se tocó un día por error: mientras no haya nada marcado se puede volver a elegir, sin preguntar.
    const back = !editing && !anyDone ? '<button class="link-btn back-day" data-act="change-day">← Elegir otro día</button>' : '';
    // Quedó abierta desde otro día (se cerró la app a mitad de sesión).
    const stale = !editing && s.date < S.todayStr() ? `
      <div class="note revisar">Esta sesión empezó el <b>${esc(fmtDate(s.date))}</b> y no la terminaste.
        <div class="row" style="margin-top:8px">
          <button data-act="finish">Terminarla</button>
          <button data-act="session-today">Seguir hoy</button>
        </div>
      </div>` : '';
    return `
      ${back}
      <h1>${esc(s.dayName || 'Sesión')} ${editing ? '<span class="badge">editando</span>' : ''}${helpBtn('session')}</h1>
      ${stale}
      <div class="date-row">
        <label for="s-date">Fecha</label>
        <input type="date" id="s-date" data-f="date" value="${esc(s.date)}">
      </div>
      <div class="sess-bar" id="sess-bar">${sessBarHtml(s)}</div>
      ${helpBox('session', 'Marcá con ✓ cada serie que terminás. Al final te pregunto qué hacer con las que queden sin ✓.' + (S.opt('rir') ? ' <b>RIR</b> (opcional) = cuántas repeticiones más podrías haber hecho.' : ''))}
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
    const name = S.exKey(s.exercises[i].name);
    const day = S.state.routine.days.find((d) => d.id === s.dayId);
    const re = day && day.exercises.find((e) => S.exKey(e.name) === name);
    if (!re || !re.notes) return '';
    return `<div class="note ${isRevisar(re.notes) ? 'revisar' : ''}">${withName ? '<b>' + esc(s.exercises[i].name) + ':</b> ' : ''}${esc(re.notes)}</div>`;
  }

  /* ---------- peso: directo, por lado (barra) o en bloques (máquina) ---------- */

  /** Cómo se carga el peso de un ejercicio: 'bar' (discos por lado), 'bricks' (bloques) o 'plain'. */
  const loadMode = (ex) => (ex.usesBar ? 'bar' : ex.usesBricks ? 'bricks' : 'plain');
  /** Campo del modelo según el modo: el total siempre queda en "weight". */
  const LOAD_KEY = { bar: 'side', bricks: 'bricks', plain: 'weight' };

  /** Texto bajo el campo: "= 60 kg" (o qué falta para calcularlo). */
  function totText(st, ex, isDrop) {
    const w = isDrop ? (st.drop && st.drop.weight) : st.weight;
    if (loadMode(ex) === 'bricks') return w != null ? `total ${fmt(w)} ${unit()}` : `${fmt(S.BRICK_KG)} ${unit()} c/bloque`;
    if (ex.bar == null) return 'elegí la barra ↑';
    return w != null ? `total ${fmt(w)} ${unit()}` : `barra ${fmt(ex.bar)} ${unit()}`;
  }

  /** Campo de peso con sus botones −/+. Con barra: discos POR LADO; con bloques: cantidad de BLOQUES. */
  function weightField(st, ex, isDrop, aria) {
    const mode = loadMode(ex);
    const src = isDrop ? (st.drop || {}) : st;
    const f = (isDrop ? 'd' : '') + LOAD_KEY[mode];
    const val = mode === 'bar' ? S.sideOf(src, ex.bar) : mode === 'bricks' ? S.bricksOf(src) : src.weight;
    const ph = mode === 'bar' ? '1 lado' : mode === 'bricks' ? 'cant.' : (isDrop ? 'drop kg' : '0');
    const hint = mode === 'bar' ? ' (discos por lado)' : mode === 'bricks' ? ' (bloques)' : '';
    return `
        <div class="stepper">
          <button data-act="${isDrop ? 'dw-' : 'w-'}" aria-label="Menos peso">−</button>
          <input inputmode="decimal" data-f="${f}" value="${fmt(val)}" placeholder="${ph}" aria-label="${aria}${hint}">
          <button data-act="${isDrop ? 'dw+' : 'w+'}" aria-label="Más peso">+</button>
        </div>`;
  }
  const totCaption = (st, ex, isDrop) => (loadMode(ex) !== 'plain' ? `<span class="tot">${totText(st, ex, isDrop)}</span>` : '');
  /** Encabezado de la columna de peso según el modo. */
  const weightHead = (ex) => ({ bar: unit() + ' de UN lado', bricks: 'cant. de bloques', plain: unit() }[loadMode(ex)]);

  /** Guarda un peso tecleado y recalcula el total:
   *  barra → barra + 2 × lado · bloques → bloques × 5 · directo → tal cual. */
  function setWeight(st, ex, f, v) {
    const isDrop = f.charAt(0) === 'd';
    const key = isDrop ? f.slice(1) : f;
    let t = st;
    if (isDrop) { st.drop = st.drop || S.blankDrop(ex.target && ex.target.reps); t = st.drop; }
    if (key === 'weight') t.weight = v;
    else if (key === 'side') { t.side = v; t.weight = S.barTotal(ex.bar, v); }
    else if (key === 'bricks') { t.bricks = v; t.weight = S.bricksTotal(v); }
  }

  /** Al elegir la barra, las series vacías se completan con lo de la última vez pasado a discos por lado
   *  (si no, al cambiar un ejercicio a "Con barra" se perdía el prellenado). */
  function fillFromLast(s, ex) {
    const last = S.lastEntry(ex.name, s.id, s.dayId);
    if (!last || ex.bar == null) return;
    let changed = false;
    ex.sets.forEach((st, j) => {
      if (st.done || st.side != null || st.weight != null) return;
      const src = last.sets[j] || last.sets[last.sets.length - 1];
      if (!src || src.weight == null || src.weight < ex.bar) return;
      setWeight(st, ex, 'side', Math.round(((src.weight - ex.bar) / 2) * 100) / 100);
      changed = true;
    });
    if (changed) S.commit();
  }

  /** Refresca el "= total" junto al campo, sin redibujar (no se pierde el foco). */
  function updateTot(input, st, ex) {
    const holder = input.closest('.set, .dropline, .ssinputs');
    const t = holder && holder.querySelector('.tot');
    if (t) t.textContent = totText(st, ex, input.dataset.f.charAt(0) === 'd');
  }

  /** Selector de la barra que te tocó hoy: las del gimnasio (BARS) + las ya usadas + otra. */
  function barPicker(ex, i, label) {
    if (!ex.usesBar) return '';
    const extra = S.barsUsed(ex.name).filter((b) => !S.BARS.includes(b)).sort((a, b) => b - a);
    const opts = [...S.BARS, ...extra];
    const other = ex.bar != null && !opts.includes(ex.bar) ? fmt(ex.bar) : '';
    return `
      <div class="barpick ${ex.bar == null ? 'need' : ''}" data-ex="${i}">
        <span class="barlabel">${label ? esc(label) + ' · ' : ''}Barra de hoy</span>
        <div class="chips">
          ${opts.map((b) => `<button class="chip ${ex.bar === b ? 'on' : ''}" data-act="pick-bar" data-bar="${b}">${fmt(b)} kg</button>`).join('')}
          <input class="barother ${other ? 'on' : ''}" data-f="bar" inputmode="decimal" value="${other}" placeholder="otra kg" aria-label="Peso de otra barra">
        </div>
      </div>`;
  }

  /** Comentario persistente del ejercicio (independiente de las notas de la rutina). */
  function commentBox(ex, withName) {
    return `
      <div class="comment">
        <label>${withName ? esc(ex.name) + ' · ' : ''}Comentario para próximas sesiones</label>
        <textarea data-f="comment" data-name="${esc(ex.name)}" rows="2" placeholder="Ej.: la próxima subir 2,5 kg, cuidar la bajada…">${esc(S.getExerciseComment(ex.name))}</textarea>
      </div>`;
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
        <button class="chk" data-act="toggle-set" aria-label="Serie hecha">${ICON.check}</button>
        <button class="x" data-act="del-set" aria-label="Quitar serie">${ICON.close}</button>
        ${totCaption(st, ex, false)}
        ${rirInput(st)}
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
    const back = document.querySelector('.back-day');   // ya hay algo marcado: no se ofrece cambiar de día
    if (back && exs.some((e) => e.sets.some((st) => st.done))) back.remove();
    const btn = card.querySelector('[data-act="complete-ex"]');
    btn.textContent = all ? 'Desmarcar todo' : '✓ Completar';
    btn.classList.toggle('ok', !all);
    const bar = document.getElementById('sess-bar');   // sin redibujar: el teclado y el foco siguen donde estaban
    if (bar && sessShown) {
      const c = sessCount(sessShown);
      bar.querySelector('b').textContent = c.done;
      bar.querySelector('i').style.width = c.pct + '%';
    }
  }

  /** Avisos antes de marcar series con valores que suelen ser un error: pesos o reps enormes, o un
   *  total que salta mucho respecto de la última vez (típico: poner el TOTAL en "kg por lado", o los
   *  kg en "bloques"). Devuelve líneas de texto (vacío = todo bien). */
  function warnings(s, ex, sts) {
    const out = new Set();
    const last = S.lastEntry(ex.name, s.id, s.dayId);
    const lastMax = last ? Math.max(0, ...last.sets.map((x) => x.weight || 0)) : 0;
    const was = lastMax ? ` (la última vez: ${fmt(lastMax)} ${unit()})` : '';
    const mode = loadMode(ex);
    sts.forEach((st) => {
      const w = st.weight;
      if (st.reps > MAX_REPS) out.add(`${ex.name}: ${st.reps} repeticiones`);
      if (st.drop && st.drop.weight > MAX_KG) out.add(`${ex.name}: drop de ${fmt(st.drop.weight)} ${unit()}`);
      if (w == null) return;
      if (w > MAX_KG) out.add(`${ex.name}: ${fmt(w)} ${unit()}`);
      else if (mode === 'bar' && (lastMax ? w > lastMax * 1.5 : S.sideOf(st, ex.bar) >= 50)) {
        out.add(`${ex.name}: quedan ${fmt(w)} ${unit()} en total${was}. En el casillero va solo lo de UN lado, sin la barra`);
      } else if (mode === 'bricks' && (lastMax ? w > lastMax * 1.5 : S.bricksOf(st) > 25)) {
        out.add(`${ex.name}: ${fmt(S.bricksOf(st))} bloques = ${fmt(w)} ${unit()}${was}. En el casillero va la cantidad de bloques, no los kg`);
      } else if (mode === 'plain' && lastMax >= 10 && w > lastMax * 2) {
        out.add(`${ex.name}: ${fmt(w)} ${unit()}${was}`);
      }
    });
    return [...out];
  }

  /** Pregunta antes de marcar si hay algo raro. Devuelve true si se puede seguir. */
  const okToMark = (lines) => !lines.length
    || confirm('Revisá antes de marcar:\n\n• ' + lines.join('\n• ') + '\n\n¿Marcar igual?');

  /** Una serie sin ✓ que se puede guardar como hecha: tiene reps y, si lleva barra, la barra está elegida. */
  const markable = (ex, st) => setValid(st) && !(ex.usesBar && ex.bar == null);

  /** Cuenta las series: con ✓, cargadas sin ✓ (se pueden guardar) y vacías (sin reps).
   *  "where" = "Press inclinado (3) · Aperturas (4)": dónde quedaron las cargadas sin ✓. */
  function countSets(s) {
    const c = { done: 0, loaded: 0, empty: 0 }, by = [];
    s.exercises.forEach((ex) => {
      let n = 0;
      ex.sets.forEach((st) => { if (st.done) c.done++; else if (markable(ex, st)) n++; else c.empty++; });
      if (n) { c.loaded += n; by.push(`${ex.name} (${n})`); }
    });
    c.where = by.slice(0, 4).join(' · ') + (by.length > 4 ? ` y ${by.length - 4} ejercicio(s) más` : '');
    return c;
  }

  /** "Finalizar sesión" (sesión nueva) o "Guardar cambios" (sesión del historial).
   *  Nunca borra lo cargado sin preguntar: las series sin ✓ que tienen datos se pueden guardar
   *  como hechas, y la sesión solo se borra si se elige explícitamente "Descartar" / "Borrar". */
  let finishing = false;
  async function finishSession() {
    const s = currentSession();
    if (!s || finishing) return;
    const editing = !!ui.editId;
    const { done, loaded, empty, where } = countSets(s);
    const emptyTxt = empty ? ` Las ${empty} vacías (sin reps) no se guardan.` : '';
    const loadedTxt = `Sin ✓: ${where}. Revisá si las hiciste: pueden tener los números que la app completó sola.${emptyTxt}`;
    let choice = 'save';

    if (loaded && done) {
      choice = await askFinish(`Hay ${loaded} serie(s) sin ✓`, `Marcaste ${done} con ✓. ${loadedTxt}`, [
        { label: `Guardar las ${done + loaded} series`, value: 'all', cls: 'primary' },
        { label: done === 1 ? 'Guardar solo la serie con ✓' : `Guardar solo las ${done} con ✓`, value: 'save' },
        { label: 'Volver a la sesión', value: null },
      ]);
    } else if (loaded) {
      choice = await askFinish('No marcaste ninguna serie con ✓', loadedTxt, [
          { label: `Guardar las ${loaded} series`, value: 'all', cls: 'primary' },
          { label: 'Volver a la sesión', value: null },
          // Al editar una sesión del historial no se ofrece borrarla: para eso está "Borrar" en Historial.
          ...(editing ? [] : [{ label: 'Descartar la sesión', value: 'delete', cls: 'danger' }]),
        ]);
    } else if (!done) {
      choice = editing
        ? await askFinish('Esta sesión quedó vacía',
          'Ninguna serie tiene repeticiones cargadas. Si la borrás, desaparece del historial y no se puede deshacer.', [
            { label: 'Volver a la sesión', value: null, cls: 'primary' },
            { label: 'Borrar del historial', value: 'delete', cls: 'danger' },
          ])
        : await askFinish('No hay nada para guardar', 'Ninguna serie tiene repeticiones cargadas.', [
          { label: 'Volver a la sesión', value: null, cls: 'primary' },
          { label: 'Descartar la sesión', value: 'delete', cls: 'danger' },
        ]);
    }
    if (!choice) return;

    // Mientras la ventana estaba abierta pudo llegar una versión nueva desde la nube: se usa la actual.
    const live = S.find(S.state.sessions, s.id);
    if (!live) { toast('La sesión ya no existe'); ui.editId = null; go('history'); return; }
    if (choice === 'delete') {
      S.deleteSession(live.id); ui.editId = null;
      toast(editing ? 'Sesión borrada del historial' : 'Sesión descartada');
      go(editing ? 'history' : 'train');
      return;
    }
    if (choice === 'all') {
      const lines = live.exercises.flatMap((ex) => warnings(live, ex, ex.sets.filter((st) => !st.done && markable(ex, st))));
      if (!okToMark(lines)) return;
      live.exercises.forEach((ex) => { ex.sets.forEach((st) => { if (!st.done && markable(ex, st)) st.done = true; }); syncEx(ex); });
    }
    S.finishSession(live.id);
    ui.editId = null;
    toast((editing ? 'Cambios guardados ✓' : 'Sesión guardada ✓') + (empty ? ` · ${empty} vacía(s) sin guardar` : ''));
    go('history');
  }

  /** Abre la ventana de opciones de finalizar, bloqueando un segundo "Finalizar" mientras está abierta. */
  async function askFinish(title, text, options) {
    finishing = true;
    try { return await choose(title, esc(text), options); } finally { finishing = false; }
  }

  /* ======================================================================
     HISTORIAL
     ====================================================================== */

  function viewHistory() {
    const list = S.sessions().reverse();
    if (!list.length) return '<h1>Historial</h1><p class="empty">Todavía no hay sesiones. ¡Empezá a entrenar!</p>';
    // Sin cuenta los datos están solo en este teléfono: cada 10 sesiones sin backup, se recuerda.
    const since = S.sessionsSinceExport();
    const remind = !(window.Cloud && Cloud.user) && since >= 10 ? `
      <div class="note revisar">Hace <b>${since} entrenamientos</b> que no exportás un backup y tus datos están solo en este teléfono.
        <button class="block" style="margin-top:8px" data-act="export-json">Exportar backup ahora</button></div>` : '';
    const sel = ui.sel;
    const bar = sel ? `
      <div class="sharebar"><span><b>${sel.size}</b> elegido(s)</span>
        <button class="primary" data-act="share-go" ${sel.size ? '' : 'disabled'}>Enviar</button>
        <button data-act="share-cancel">Cancelar</button></div>`
      : '<button class="quiet" data-act="share-start">Compartir días por WhatsApp…</button>';
    return '<h1>Historial</h1>' + remind + bar + list.map((s) => {
      const vol = s.exercises.reduce((a, ex) => a + ex.sets.filter((x) => x.done)
        .reduce((b, x) => b + S.setVolume(x), 0), 0);
      const exs = s.exercises.map((ex) => {
        const sets = ex.sets.filter((x) => x.done).map(fmtSet).join(', ');
        if (!sets) return '';
        const best = S.opt('e1rmHist') ? ex.sets.filter((x) => x.done).reduce((m, x) => Math.max(m, S.e1rm(x.weight, x.reps) || 0), 0) : 0;
        const rirs = S.opt('rir') ? ex.sets.filter((x) => x.done && x.rir != null).map((x) => x.rir) : [];
        const rirTxt = rirs.length ? `RIR ${Math.min(...rirs) === Math.max(...rirs) ? Math.min(...rirs) : Math.min(...rirs) + '–' + Math.max(...rirs)}` : '';
        const extra = [best ? `1RM ≈ ${fmt(Math.round(best))} ${unit()}` : '', rirTxt, S.opt('rpe') && ex.rpe != null ? `RPE ${fmt(ex.rpe)}` : ''].filter(Boolean).join(' · ');
        return `<div class="hist-ex"><b>${esc(ex.name)}</b> ${sets}${ex.bar != null ? ` <span class="muted">(barra ${fmt(ex.bar)})</span>` : ''}${extra ? ` <span class="muted hist-extra">${extra}</span>` : ''}</div>`;
      }).join('');
      return `
      <article class="card ${sel && sel.has(s.id) ? 'picked' : ''}" data-sid="${esc(s.id)}">
        <div class="ex-head">
          ${sel ? `<label class="pick"><input type="checkbox" data-pick ${sel.has(s.id) ? 'checked' : ''} aria-label="Elegir esta sesión"></label>` : ''}
          <h3>${esc(s.dayName || 'Sesión')} ${s.finished ? '' : '<span class="badge warn">en curso</span>'}</h3>
          <span class="muted">${esc(fmtDate(s.date))}</span>
        </div>
        <p class="muted">Volumen: ${fmt(vol)} ${unit()}${S.sessionMinutes(s) != null ? ' · ' + S.sessionMinutes(s) + ' min' : ''}${s.bodyweight ? ' · peso corporal ' + fmt(s.bodyweight) + ' ' + unit() : ''}</p>
        ${exs}
        ${sel ? '' : `<div class="row" style="margin-top:10px">
          <button data-act="edit-session">${s.finished ? 'Editar' : 'Continuar'}</button>
          <button data-act="del-session" class="danger">Borrar</button>
        </div>`}
      </article>`;
    }).join('');
  }

  /** Texto corto y legible de las sesiones elegidas (del día más viejo al más nuevo), para WhatsApp. */
  function shareText(ids) {
    const list = S.sessions().filter((x) => ids.has(x.id)).sort((a, b) => (a.date < b.date ? -1 : 1));
    return list.map((s) => {
      const min = S.sessionMinutes(s);
      const head = `*${s.dayName || 'Sesión'}* · ${fmtDate(s.date)}${min != null ? ' · ' + min + ' min' : ''}`;
      const lines = s.exercises.map((ex) => {
        const sets = ex.sets.filter((x) => x.done).map(fmtSet).join(', ');
        return sets ? `• ${ex.name}: ${sets} ${unit()}` : '';
      }).filter(Boolean);
      return [head, ...lines].join('\n');
    }).join('\n\n');
  }

  async function shareSessions() {
    const text = shareText(ui.sel);
    if (!text) return;
    if (navigator.share) {
      try { await navigator.share({ text }); ui.sel = null; render(); return; }
      catch (err) { if (err && err.name === 'AbortError') return; /* otro error: probar copiar */ }
    }
    try { await navigator.clipboard.writeText(text); toast('Texto copiado. Pegalo en WhatsApp.'); ui.sel = null; render(); }
    catch (err) { toast('No se pudo compartir ni copiar en este navegador.'); }
  }

  /* ======================================================================
     PROGRESO
     ====================================================================== */

  /** Ejercicios unidos al elegido, y el botón para unir otro (cuando un ejercicio quedó con dos nombres). */
  function joinBlock() {
    const joined = S.aliasesOf(ui.progKey);
    return `<p class="muted" style="margin-top:8px">${joined.length ? 'Unido con: ' + joined.map((j) =>
        `<b>${esc(j.name)}</b> <button class="link-btn" data-act="split-ex" data-key="${esc(j.key)}">Separar</button>`).join(' · ') + '<br>' : ''}`
      + '<button class="link-btn" data-act="join-ex">¿Es el mismo que otro? Unir…</button></p>';
  }

  function viewProgress() {
    const names = S.exerciseNames();
    if (!names.length) {
      return progPage('<div class="card"><h2>Por ejercicio</h2><p class="muted">Cuando termines tu primera sesión vas a ver acá el gráfico de cada ejercicio.</p></div>');
    }
    if (ui.progKey == null) ui.progKey = S.getPref('progKey');        // el último elegido en este dispositivo
    if (!names.some((n) => n.key === ui.progKey)) {
      // Sin elección guardada: el primer ejercicio de la última sesión terminada (no el primero alfabético).
      const last = S.sessions().filter((s) => s.finished).pop();
      const k = last && last.exercises[0] ? S.exKey(last.exercises[0].name) : null;
      ui.progKey = names.some((n) => n.key === k) ? k : names[0].key;
    }
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

    return progPage(`
      <div class="card">
        <h2>Por ejercicio</h2>
        <label for="p-ex">Ejercicio</label>
        <select id="p-ex" data-f="prog">${names.map((n) =>
          `<option value="${esc(n.key)}" ${n.key === ui.progKey ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select>
        ${joinBlock()}
        <div class="chart-box" style="margin-top:12px"><canvas id="chart"></canvas></div>
        <p class="muted" id="chart-msg"></p>
        <div class="stats">
          <div class="stat"><b>${best ? fmt(best.weight) + ' ' + unit() : '–'}</b><span>Mejor marca${best ? ' · ' + best.reps + ' reps' : ''}</span></div>
          <div class="stat"><b>${last ? fmt(last.maxWeight) + ' ' + unit() : '–'}</b><span>Último peso</span></div>
          <div class="stat"><b class="${varCls}">${varTxt}</b><span>vs. hace 4 sem.${old ? '' : ' (sin datos)'}</span></div>
        </div>
        ${e1rmBlock()}
      </div>`);
  }

  /** Progreso en cuatro secciones, para no recorrer una tira larga (la elegida se recuerda en este dispositivo). */
  const PROG_SECS = [['summary', 'Resumen'], ['exercise', 'Ejercicio'], ['muscles', 'Músculos'], ['body', 'Cuerpo']];
  function progPage(exerciseHtml) {
    if (ui.progSec == null) ui.progSec = S.getPref('progSec');
    if (!PROG_SECS.some(([k]) => k === ui.progSec)) ui.progSec = 'summary';
    const body = {
      summary: () => cyclesCard() + weekCard() + dayChartCard() + cycleChartCard(),
      exercise: () => exerciseHtml + stallsCard(),
      muscles: () => muscleCard() || '<p class="empty">Terminá una sesión para ver tus series por músculo.</p>',
      body: () => bodyweightCard(),
    }[ui.progSec]();
    return `<h1>Progreso</h1>
      <div class="seg" role="group" aria-label="Sección de Progreso">${PROG_SECS.map(([k, label]) =>
        `<button data-act="prog-sec" data-sec="${k}" aria-pressed="${k === ui.progSec}">${label}</button>`).join('')}</div>
      ${body}`;
  }

  /* ---------- 1RM estimado, semana, músculos, estancamientos y peso corporal ---------- */

  /** 1RM estimado del ejercicio elegido: récords, fuerza relativa y su gráfico. */
  function e1rmBlock() {
    const pts = S.e1rmSeries(ui.progKey);
    const rec = S.records(ui.progKey);
    const last = pts[pts.length - 1];
    const bw = last ? S.bodyweightAt(last.date) : null;
    const rel = last && bw ? fmt(Math.round((last.e1rm / bw) * 100) / 100) + '×' : '–';
    const recLine = [
      rec.weight ? `peso ${fmt(rec.weight.weight)} ${unit()} × ${rec.weight.reps} (${fmtShort(rec.weight.date)})` : '',
      rec.e1rm ? `1RM est. ${fmt(rec.e1rm.e1rm)} ${unit()} (${fmtShort(rec.e1rm.date)})` : '',
      rec.volume ? `volumen ${fmt(rec.volume.value)} ${unit()} (${fmtShort(rec.volume.date)})` : '',
    ].filter(Boolean).join(' · ');
    return `
        <h2 style="margin-top:16px">1RM estimado · ${esc((S.exerciseNames().find((n) => n.key === ui.progKey) || {}).name || '')}${helpBtn('1rm')}</h2>
        ${helpBox('1rm', 'El peso máximo que podrías levantar una sola vez, calculado con tus series de este ejercicio.')}
        <div class="stats">
          <div class="stat"><b>${last ? fmt(last.e1rm) + ' ' + unit() : '–'}</b><span>Último</span></div>
          <div class="stat"><b>${rec.e1rm ? fmt(rec.e1rm.e1rm) + ' ' + unit() : '–'}</b><span>Récord</span></div>
          <div class="stat"><b>${rel}</b><span>Fuerza relativa (1RM ÷ tu peso)${bw ? '' : ' · cargá tu peso abajo'}</span></div>
        </div>
        ${pts.length >= 2 ? '<div class="svgchart" data-chart="e1rm"></div>'
          : `<p class="muted chart-empty">${pts.length ? 'Con 1 sesión todavía no hay evolución para mostrar.' : `Sin series de hasta ${S.E1RM_MAX_REPS} reps para estimar el 1RM.`}</p>`}
        <p class="muted">Récords: ${recLine || 'sin datos'}. Se calcula solo con series de hasta ${S.E1RM_MAX_REPS} reps.</p>`;
  }

  /** Resumen semanal: volumen y series por semana, y el detalle de la última semana. */
  function weekCard() {
    const weeks = S.weeklyStats();
    if (!weeks.length) return `<div class="card"><h2>Por semana</h2><p class="muted chart-empty">Sin datos todavía: terminá una sesión para ver tu semana.</p></div>`;
    const w = weeks[weeks.length - 1];
    return `
      <div class="card">
        <h2>Por semana</h2>
        ${weeks.length >= 2 ? '<div class="svgchart" data-chart="week"></div>' : '<p class="muted chart-empty">Con una sola semana registrada todavía no hay evolución.</p>'}
        <p class="muted" style="margin-top:10px">Semana del ${esc(fmtShort(w.week))}:</p>
        <div class="stats">
          <div class="stat"><b>${w.sessions}</b><span>Sesiones</span></div>
          <div class="stat"><b>${w.sets}</b><span>Series hechas</span></div>
          ${S.opt('rir') ? `<div class="stat"><b>${w.rirN ? w.effective : '–'}</b><span>Exigentes (te quedaban ${S.EFFECTIVE_RIR_MAX} o menos)</span></div>
          <div class="stat"><b>${w.rirAvg != null ? fmt(w.rirAvg) : '–'}</b><span>RIR promedio</span></div>` : ''}
          <div class="stat"><b>${w.minutesAvg != null ? w.minutesAvg + ' min' : '–'}</b><span>Duración promedio</span></div>
          <div class="stat"><b>${shortNum(w.volume)}</b><span>Volumen: peso × reps (${unit()})</span></div>
        </div>
        ${S.opt('rir') && w.rirN < w.sets ? `<p class="muted">RIR cargado en ${w.rirN} de ${w.sets} series: las exigentes solo cuentan las que tienen RIR.</p>` : ''}
      </div>`;
  }

  /** Series por grupo muscular en la semana elegida (principal 1, secundario 0,5). */
  function muscleCard() {
    const weeks = S.weeklyStats().map((w) => w.week).reverse();
    if (!weeks.length) return '';
    if (!weeks.includes(ui.progWeek)) ui.progWeek = weeks[0];
    const { list, unassigned } = S.muscleSets(ui.progWeek);
    const max = Math.max(1, ...list.map((x) => x.sets));
    const rows = list.map((x) => `
        <div class="mrow ${x.sets ? '' : 'zero'}"><span class="mname">${esc(x.muscle)}${S.LEGACY_MUSCLES.includes(x.muscle) ? ' (por revisar)' : ''}</span>
          <span class="mbar"><i style="width:${Math.round((x.sets / max) * 100)}%"></i></span>
          <b>${fmt(x.sets)}</b></div>`).join('');
    return `
      <div class="card">
        <h2>Series por músculo</h2>
        <label for="p-week">Semana</label>
        <select id="p-week" data-f="progweek">${weeks.map((w) =>
          `<option value="${esc(w)}" ${w === ui.progWeek ? 'selected' : ''}>Semana del ${esc(fmtShort(w))}</option>`).join('')}</select>
        ${rows ? `<div class="mlist">${rows}</div>` : '<p class="muted chart-empty">Ningún ejercicio de esa semana tiene músculos asignados. Asignalos en Rutina (abrí cada ejercicio).</p>'}
        ${list.some((x) => !x.sets) ? '<p class="muted"><span class="warn-txt">En naranja:</span> músculos de tu rutina que esa semana no entrenaste.</p>' : ''}
        ${unassigned ? `<p class="muted">${unassigned} serie(s) de ejercicios sin músculos asignados no se cuentan.</p>` : ''}
        <p class="muted">Músculo principal = 1 serie · secundario = ${fmt(S.SECONDARY_MUSCLE_FACTOR)}.</p>
      </div>`;
  }

  /** Ejercicios sin mejora del 1RM estimado en las últimas STALL_WEEKS semanas. */
  function stallsCard() {
    const list = S.stalls();
    const body = list.length
      ? list.map((x) => `<div class="hist-ex"><b>${esc(x.name)}:</b> mejor antes ${fmt(x.before)} ${unit()} · últimas ${S.STALL_WEEKS} semanas ${fmt(x.after)} ${unit()} (${x.sessions} sesión/es)</div>`).join('')
      : `<p class="muted">Ninguno: o mejoraste en las últimas ${S.STALL_WEEKS} semanas, o todavía no hay datos de antes y después para comparar.</p>`;
    return `<div class="card"><h2>Estancamientos</h2>${body}<p class="muted">Compara tu mejor 1RM estimado de las últimas ${S.STALL_WEEKS} semanas contra el de antes.</p></div>`;
  }

  /** Peso corporal: se carga acá y cada valor rige como referencia hasta el siguiente. */
  function bodyweightCard() {
    const pts = S.bodyweightSeries();
    const cur = S.bodyweightAt(S.todayStr());
    const curDate = pts.filter((x) => x.date <= S.todayStr()).pop();
    const recent = pts.slice(-5).reverse().map((x) => `
        <div class="bwrow"><span>${esc(fmtDate(x.date))}</span><b>${fmt(x.kg)} ${unit()}</b>
          <button class="x" data-act="bw-del" data-date="${esc(x.date)}" aria-label="Borrar el registro del ${esc(fmtShort(x.date))}">${ICON.close}</button></div>`).join('');
    return `
      <div class="card">
        <h2>Peso corporal</h2>
        <p class="muted">${cur != null ? `Referencia actual: <b>${fmt(cur)} ${unit()}</b>${curDate ? ' (desde el ' + esc(fmtShort(curDate.date)) + ')' : ''}. Se usa hasta que cargues uno nuevo.` : 'Cargalo cuando te peses: se usa como referencia hasta que cargues uno nuevo.'}</p>
        <div class="bwform">
          <div><label for="bw-kg">Peso (${unit()})</label><input id="bw-kg" inputmode="decimal" placeholder="ej.: 78,5"></div>
          <div><label for="bw-date">Fecha</label><input id="bw-date" type="date" value="${esc(S.todayStr())}"></div>
        </div>
        <button class="primary block" style="margin-top:10px" data-act="bw-save">Guardar peso</button>
        ${pts.length >= 2 ? '<div class="svgchart" data-chart="bw"></div>' : ''}
        ${recent ? `<div class="bwlist">${recent}</div>` : ''}
      </div>`;
  }

  /** Gráfico de línea en SVG propio (mismo estilo que los demás): 1RM estimado o peso corporal. */
  function svgLine({ labels, values, name, titles, width }) {
    const W = Math.max(240, Math.floor(width)), H = 210;
    const padL = 40, padR = 12, padT = 30, padB = 30;
    const iw = W - padL - padR, ih = H - padT - padB, n = values.length;
    let lo = Math.min(...values), hi = Math.max(...values);
    if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
    const span = hi - lo; lo = Math.max(0, lo - span * 0.15); hi += span * 0.15;
    const x = (i) => padL + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
    let g = '';
    for (let k = 0; k <= 4; k += 2) {
      const yy = padT + (ih * k) / 4;
      g += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" style="stroke:var(--sep)" stroke-width="1"/>`;
      g += `<text x="${padL - 6}" y="${yy + 3.5}" text-anchor="end" class="ax">${shortNum(hi - ((hi - lo) * k) / 4)}</text>`;
    }
    g += `<path d="${values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')}" class="ln"/>`;
    values.forEach((v, i) => { g += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="pt"><title>${esc(titles[i])}</title></circle>`; });
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 48))));
    labels.forEach((l, i) => {
      const anchor = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
      if (i % every === 0 || i === n - 1) g += `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="${anchor}" class="ax">${esc(l)}</text>`;
    });
    const lg = `<circle cx="${padL + 4}" cy="12" r="4" class="pt"/><text x="${padL + 12}" y="16" class="lg">${esc(name)}</text>`;
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}">${lg}${g}</svg>`;
  }

  /* ---------- ciclos y gráficos generales ---------- */

  /** Resumen de ciclos: un ciclo = hiciste todos los días de la rutina actual. */
  function cyclesCard() {
    const c = S.cycles();
    const stats = S.dayStats(28);
    const days = S.state.routine.days.filter((d) => d.exercises.length);
    const trained = S.state.sessions.some((s) => s.finished);
    // Lo que falta del ciclo en curso y desde cuándo está abierto.
    const open = c.since ? daysAgo(c.since) : 0;
    const lastTxt = (d) => (stats[d.id].last ? agoText(stats[d.id].last.date) : 'nunca');
    const missDays = c.current ? days.filter((d) => c.missing.includes(d.name)) : [];
    const missing = missDays.length ? `
        <div class="note revisar">Falta en este ciclo: ${missDays.map((d) => `<b>${esc(d.name)}</b> (última vez: ${esc(lastTxt(d))})`).join(', ')}${open > 14 ? ` · el ciclo empezó ${esc(agoText(c.since))}` : ''}.</div>` : '';
    // Otros días que quedaron atrás: hace más de 14 días que no se hacen (o nunca).
    const behind = trained ? days.filter((d) => !missDays.includes(d) && (!stats[d.id].last || daysAgo(stats[d.id].last.date) > 14)) : [];
    const behindTxt = behind.length ? `<p class="muted"><span class="warn-txt">Sin hacer hace más de 2 semanas:</span> ${behind.map((d) =>
      `${esc(d.name)} (${esc(lastTxt(d))})`).join(' · ')}</p>` : '';
    const perDay = trained ? `<p class="muted">Últimas 4 semanas: ${days.map((d) => {
      const n = stats[d.id].recent;
      return `${esc(d.name)} <b class="${n ? '' : 'warn-txt'}">×${n}</b>`;
    }).join(' · ')}</p>` : '';
    return `
      <div class="card">
        <h2>Ciclos</h2>
        <div class="stats">
          <div class="stat"><b>${c.complete}</b><span>Completos</span></div>
          <div class="stat"><b class="${c.incomplete ? 'warn-txt' : ''}">${c.incomplete}</b><span>Incompletos</span></div>
          <div class="stat"><b>${c.current}/${c.total}</b><span>En curso</span></div>
        </div>
        ${missing}${behindTxt}${perDay}
        <p class="muted">Un ciclo es una vuelta por todos los días de tu rutina${c.total ? ` (${c.total})` : ''}, en cualquier orden. Si repetís un día antes de hacerlos todos, ese ciclo se cierra como incompleto.</p>
      </div>`;
  }

  /** Gráfico de volumen por sesión de un día de la rutina. */
  function dayChartCard() {
    const days = S.state.routine.days;
    if (!days.length) return '';
    if (!days.some((d) => d.id === ui.progDay)) ui.progDay = days[0].id;
    const pts = S.dayVolumes(ui.progDay);
    const msg = pts.length === 0 ? 'Todavía no terminaste ninguna sesión de este día.'
      : pts.length === 1 ? 'Hay 1 sesión de este día: con la próxima vas a ver cómo evoluciona.' : '';
    return `
      <div class="card">
        <h2>Volumen por día de rutina</h2>
        <label for="p-day">Día</label>
        <select id="p-day" data-f="progday">${days.map((d) =>
          `<option value="${esc(d.id)}" ${d.id === ui.progDay ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        ${msg ? `<p class="muted chart-empty">${msg}</p>` : '<div class="svgchart" data-chart="day"></div>'}
        <p class="muted">Volumen de cada sesión = suma de peso × reps (incluye la parte drop).</p>
      </div>`;
  }

  /** Gráfico por ciclo completo: volumen total (barras) y promedio por sesión (línea). */
  function cycleChartCard() {
    const list = S.cycles().list;
    return `
      <div class="card">
        <h2>Volumen por ciclo</h2>
        ${list.length ? '<div class="svgchart" data-chart="cycle"></div>'
          : '<p class="muted chart-empty">Todavía no se cerró ningún ciclo. Se cierra al hacer todos los días de tu rutina, o al repetir uno antes de terminarlos (incompleto).</p>'}
        ${list.some((c) => !c.complete) ? '<p class="muted"><span class="warn-txt">■</span> Barra naranja = ciclo incompleto (faltó algún día). Debajo de cada ciclo, cuántas sesiones tuvo.</p>' : ''}
      </div>`;
  }

  /** Número corto para ejes: 950 · 4,3k · 12k. */
  const shortNum = (v) => (v >= 10000 ? Math.round(v / 1000) + 'k'
    : v >= 1000 ? fmt(Math.round(v / 100) / 10) + 'k' : v < 10 ? fmt(Math.round(v * 10) / 10) : fmt(Math.round(v)));

  /** Gráfico de barras (+ línea opcional en eje derecho) en SVG propio, al ancho exacto del contenedor.
   *  Usa los mismos colores del gráfico por ejercicio: barras grises, línea del acento. */
  function svgChart({ labels, bars, line, barName, lineName, titles, width, barCls, sub }) {
    const W = Math.max(240, Math.floor(width)), H = sub ? 242 : 230;
    const padL = 40, padR = line ? 40 : 10, padT = 30, padB = sub ? 42 : 30;
    const iw = W - padL - padR, ih = H - padT - padB, n = labels.length;
    const nice = (v) => {
      if (!(v > 0)) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    };
    const maxB = nice(Math.max(0, ...bars)), maxL = line ? nice(Math.max(0, ...line)) : 1;
    const x = (i) => padL + (iw * (i + 0.5)) / n;
    const bw = Math.max(3, Math.min(34, (iw / n) * 0.62));
    const yB = (v) => padT + ih - (v / maxB) * ih, yL = (v) => padT + ih - (v / maxL) * ih;
    let g = '';
    for (let k = 0; k <= 4; k += 2) {                    // líneas guía y escalas
      const y = padT + (ih * k) / 4;
      g += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" style="stroke:var(--sep)" stroke-width="1"/>`;
      g += `<text x="${padL - 6}" y="${y + 3.5}" text-anchor="end" class="ax">${shortNum(maxB * (1 - k / 4))}</text>`;
      if (line) g += `<text x="${W - padR + 6}" y="${y + 3.5}" class="ax acc">${shortNum(maxL * (1 - k / 4))}</text>`;
    }
    bars.forEach((v, i) => {
      g += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${yB(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT + ih - yB(v)).toFixed(1)}" rx="3" class="bar ${barCls ? barCls[i] : ''}"><title>${esc(titles[i])}</title></rect>`;
    });
    if (line) {
      g += `<path d="${line.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yL(v).toFixed(1)).join(' ')}" class="ln"/>`;
      line.forEach((v, i) => { g += `<circle cx="${x(i).toFixed(1)}" cy="${yL(v).toFixed(1)}" r="3" class="pt"><title>${esc(titles[i])}</title></circle>`; });
    }
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 48))));   // etiquetas sin pisarse
    labels.forEach((l, i) => {
      if (i % every === 0 || i === n - 1) {
        g += `<text x="${x(i).toFixed(1)}" y="${H - (sub ? 22 : 10)}" text-anchor="middle" class="ax">${esc(l)}</text>`;
        if (sub) g += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(sub[i])}</text>`;
      }
    });
    let lg = `<circle cx="${padL + 4}" cy="12" r="4" class="bar"/><text x="${padL + 12}" y="16" class="lg">${esc(barName)}</text>`;
    if (line) lg += `<circle cx="${padL + 22 + barName.length * 6.2}" cy="12" r="4" class="pt"/><text x="${padL + 30 + barName.length * 6.2}" y="16" class="lg">${esc(lineName)}</text>`;
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(barName + (line ? ' y ' + lineName : ''))}">${lg}${g}</svg>`;
  }

  /** Dibuja los gráficos SVG de Progreso al ancho real disponible. */
  function drawSvgCharts() {
    document.querySelectorAll('.svgchart[data-chart]').forEach((el) => {
      const width = el.clientWidth;
      if (el.dataset.chart === 'e1rm') {
        const pts = S.e1rmSeries(ui.progKey);
        el.innerHTML = svgLine({ width, labels: pts.map((p) => fmtShort(p.date)), values: pts.map((p) => p.e1rm),
          name: `1RM estimado (${unit()})`,
          titles: pts.map((p) => `${fmtShort(p.date)}: ${fmt(p.e1rm)} ${unit()} (de ${fmt(p.weight)} × ${p.reps})`) });
        return;
      }
      if (el.dataset.chart === 'bw') {
        const pts = S.bodyweightSeries();
        el.innerHTML = svgLine({ width, labels: pts.map((p) => fmtShort(p.date)), values: pts.map((p) => p.kg),
          name: `Peso corporal (${unit()})`, titles: pts.map((p) => `${fmtShort(p.date)}: ${fmt(p.kg)} ${unit()}`) });
        return;
      }
      if (el.dataset.chart === 'week') {
        const ws = S.weeklyStats();
        el.innerHTML = svgChart({ width, labels: ws.map((w) => fmtShort(w.week)), bars: ws.map((w) => w.volume),
          line: ws.map((w) => w.sets), barName: `Volumen (${unit()})`, lineName: 'Series',
          titles: ws.map((w) => `Semana del ${fmtShort(w.week)}: ${fmt(w.volume)} ${unit()} · ${w.sets} series · ${w.sessions} sesión/es`) });
        return;
      }
      if (el.dataset.chart === 'day') {
        const pts = S.dayVolumes(ui.progDay);
        el.innerHTML = svgChart({
          width, labels: pts.map((p) => fmtShort(p.date)), bars: pts.map((p) => p.volume),
          barName: `Volumen de la sesión (${unit()})`,
          titles: pts.map((p) => `${fmtShort(p.date)}: ${fmt(p.volume)} ${unit()}`),
        });
      } else {
        const list = S.cycles().list;
        el.innerHTML = svgChart({
          width, labels: list.map((c) => 'C' + c.n), bars: list.map((c) => c.volume), line: list.map((c) => c.avg),
          sub: list.map((c) => c.sessions + ' ses.'), barCls: list.map((c) => (c.complete ? '' : 'inc')),
          barName: 'Volumen del ciclo', lineName: 'Promedio por sesión',
          titles: list.map((c) => `Ciclo ${c.n} (${fmtShort(c.start)}–${fmtShort(c.end)}): ${fmt(c.volume)} ${unit()} en ${c.sessions} sesiones · promedio ${fmt(c.avg)} ${unit()}`
            + (c.old ? ' · de una rutina anterior' : c.complete ? '' : ` · incompleto, faltó: ${c.missing.join(', ')}`)),
        });
      }
    });
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
            borderColor: c('--accent'), backgroundColor: c('--accent'), borderWidth: 2.25, tension: .3, pointRadius: 3, order: 0 },
          { type: 'bar', label: 'Volumen', data: points.map((x) => x.volume), yAxisID: 'y1',
            backgroundColor: c('--muted') + '44', borderRadius: 3, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { align: 'start', labels: { color: c('--muted'), usePointStyle: true, boxWidth: 7, boxHeight: 7, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: c('--muted'), font: { size: 10 } }, grid: { display: false }, border: { display: false } },
          y: { position: 'left', beginAtZero: true, ticks: { color: c('--accent'), font: { size: 10 }, maxTicksLimit: 4 }, grid: { color: c('--sep') }, border: { display: false } },
          y1: { position: 'right', beginAtZero: true, ticks: { color: c('--muted'), font: { size: 10 }, maxTicksLimit: 4 }, grid: { drawOnChartArea: false }, border: { display: false } },
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
      <p class="muted">Cambiar la rutina no modifica tu historial. El historial se une por nombre de ejercicio: si renombrás uno, el historial viejo queda con el nombre anterior (si te pasa, unilos en Progreso con "Unir…").</p>
      ${nameList()}
      ${pending ? `<div class="note revisar"><b>${pending} nota(s) para revisar.</b> Buscá las marcadas en amarillo.</div>` : ''}
      ${backBanner()}
      ${days.map((d, di) => dayCard(d, di, days.length)).join('')}
      <button class="block primary" data-act="add-day">+ Agregar día</button>`;
  }

  /** Aviso de arriba: ejercicios que todavía dicen "Espalda" (lista vieja de músculos). */
  function backBanner() {
    const found = S.state.routine.days.flatMap((d) => d.exercises.filter((x) => S.hasLegacyMuscle(x)).map((x) => ({ d, x })));
    if (!found.length) return '';
    const fix = found.filter((f) => S.backReplacement(f.x)).length;
    return `<div class="note revisar"><b>${found.length} ejercicio(s) con "Espalda" por revisar.</b> Ahora se separa en Dorsales, Espalda media, Trapecios y Lumbar. Tocá uno para ir a él:
      <div class="chips" style="margin-top:8px">${found.map((f) =>
        `<button class="chip" data-act="go-ex" data-day="${esc(f.d.id)}" data-id="${esc(f.x.id)}">${esc(f.d.name)} · ${esc(f.x.name)}</button>`).join('')}</div>
      ${fix ? `<button class="block" style="margin-top:8px" data-act="muscle-back-all">Usar la sugerencia en ${fix}</button>` : ''}</div>`;
  }

  /** Nombres que ya existen (historial y rutina), para que al escribir un ejercicio se sugiera el mismo nombre. */
  function nameList() {
    const seen = new Map();
    S.exerciseNames().forEach((n) => seen.set(S.exKey(n.name), n.name));
    S.state.routine.days.forEach((d) => d.exercises.forEach((e) => { if (!seen.has(S.exKey(e.name))) seen.set(S.exKey(e.name), e.name); }));
    return `<datalist id="ex-names">${[...seen.values()].map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
  }

  function dayCard(d, di, n) {
    return `
    <section class="card" data-day="${esc(d.id)}">
      <div class="row">
        <input class="day-name" data-df="name" value="${esc(d.name)}" aria-label="Nombre del día">
        <button class="fixed icon" data-act="day-up" ${di === 0 ? 'disabled' : ''} aria-label="Subir día">↑</button>
        <button class="fixed icon" data-act="day-down" ${di === n - 1 ? 'disabled' : ''} aria-label="Bajar día">↓</button>
        <button class="fixed icon danger" data-act="del-day" aria-label="Borrar día">${ICON.trash}</button>
      </div>
      ${(() => {
        const inSS = new Set(S.groupRuns(d.exercises).filter((r) => r.length > 1).flat());
        return d.exercises.map((e, ei) => exerciseEditor(e, ei, d.exercises.length, inSS.has(ei),
          ei < d.exercises.length - 1 && !!e.group && d.exercises[ei + 1].group === e.group)).join('');
      })()}
      <div class="row" style="margin-top:8px">
        <button data-act="open-all">Desplegar todos</button>
        <button data-act="close-all">Plegar todos</button>
      </div>
      <button class="block" style="margin-top:8px" data-act="add-ex">+ Agregar ejercicio</button>
    </section>`;
  }

  /** Resumen de un ejercicio en el editor: "4×5 · 60 kg · barra 20". */
  const exInfo = (e) => `${e.sets}×${e.reps}${e.targetWeight != null ? ' · ' + fmt(e.targetWeight) + ' ' + unit() : ''}${e.usesBar ? ' · con barra' : e.usesBricks ? ' · con bloques' : ''}`;

  /** "Pecho · Hombros, Tríceps": principales, un punto, secundarios. */
  const muscleText = (e) => {
    const m = e.muscles;
    if (!m) return 'Sin músculos · tocá para elegir';
    return [m.primary.join(', '), m.secondary.join(', ')].filter(Boolean).join(' · ');
  };

  /** Línea de músculos de un ejercicio (se toca para abrir los botones) y, si hace falta, el aviso de "Espalda". */
  function muscleBox(e) {
    const open = ui.mopen.has(e.id);
    let rev = '';
    if (S.hasLegacyMuscle(e)) {
      const rep = S.backReplacement(e);
      rev = `<div class="note revisar"><b>"Espalda" se separó en Dorsales, Espalda media, Trapecios y Lumbar.</b>
        ${rep ? `Sugerencia: ${esc([rep.primary.join(', '), rep.secondary.join(', ')].filter(Boolean).join(' · '))}
        <button class="block" style="margin-top:8px" data-act="muscle-back">Usar la sugerencia</button>` : 'Elegí cuáles corresponden.'}</div>`;
    }
    return `
        <label>Músculos</label>
        <button class="mline ${e.muscles ? '' : 'empty'}" data-act="muscle-toggle" aria-expanded="${open}">
          <span class="mtxt">${esc(muscleText(e))}</span><span class="mchg">${open ? 'Cerrar' : 'Cambiar'}</span></button>
        ${rev}
        ${open ? `<p class="muted">1 toque = principal · 2 = secundario (cuenta ${fmt(S.SECONDARY_MUSCLE_FACTOR)}) · 3 = quitar</p>
        <div class="chips">
          ${[...S.MUSCLES, ...S.LEGACY_MUSCLES.filter((m) => e.muscles && (e.muscles.primary.includes(m) || e.muscles.secondary.includes(m)))].map((m) => {
            const k = e.muscles && e.muscles.primary.includes(m) ? 'p' : e.muscles && e.muscles.secondary.includes(m) ? 's' : '';
            return `<button class="chip ${k === 'p' ? 'on' : k === 's' ? 'sec' : ''}" data-act="muscle" data-m="${esc(m)}">${esc(m)}${k === 's' ? ' · ½' : ''}</button>`;
          }).join('')}
        </div>` : ''}`;
  }

  function exerciseEditor(e, ei, n, inSuperset, linkedNext) {
    const rev = isRevisar(e.notes);
    return `
    <details class="exe ${rev ? 'revisar-box' : ''}" data-id="${esc(e.id)}" ${ui.open.has(e.id) ? 'open' : ''}>
      <summary>
        <button class="drag-handle" tabindex="-1" aria-label="Arrastrar para reordenar">⋮⋮</button>
        <span><b data-sum="name">${esc(e.name)}</b>
          <span class="muted" data-sum="info">${esc(exInfo(e))}</span>
          ${inSuperset ? '<span class="badge">Superserie</span>' : ''}
          ${rev ? '<span class="badge warn">REVISAR</span>' : ''}
          ${S.hasLegacyMuscle(e) ? '<span class="badge warn">ESPALDA</span>' : ''}</span>
      </summary>
      <div class="body">
        <label>Nombre</label>
        <input data-rf="name" enterkeyhint="next" list="ex-names" autocomplete="off" value="${esc(e.name)}">
        <div class="grid3">
          <div><label>Series</label><input data-rf="sets" enterkeyhint="next" inputmode="numeric" value="${e.sets}"></div>
          <div><label>Reps (texto)</label><input data-rf="reps" enterkeyhint="next" value="${esc(e.reps)}" placeholder="10-10"></div>
          <div><label>Peso obj. (${unit()})</label><input data-rf="targetWeight" enterkeyhint="next" inputmode="decimal" value="${fmt(e.targetWeight)}" placeholder="–"></div>
        </div>
        <label>¿Cómo se carga el peso? (con barra: discos por lado · con bloques: cantidad × ${fmt(S.BRICK_KG)} kg)</label>
        <div class="chips">
          <button class="chip ${!e.usesBar && !e.usesBricks ? 'on' : ''}" data-act="set-load" data-v="plain">Sin barra</button>
          <button class="chip ${e.usesBar ? 'on' : ''}" data-act="set-load" data-v="bar">Con barra</button>
          <button class="chip ${e.usesBricks ? 'on' : ''}" data-act="set-load" data-v="bricks">Máquina con bloques</button>
        </div>
        <div data-mbox>${muscleBox(e)}</div>
        <label>Notas</label>
        <textarea data-rf="notes" class="${rev ? 'revisar-box' : ''}">${esc(e.notes)}</textarea>
        ${e.original ? `<div class="original">Original del PDF: ${esc(e.original)}</div>` : ''}
        ${ei < n - 1 ? `<button class="block" style="margin-top:10px" data-act="toggle-ss">${linkedNext ? 'Quitar superserie con el siguiente' : 'Hacer superserie con el siguiente'}</button>` : ''}
        <div class="row" style="margin-top:10px">
          <button data-act="ex-up" ${ei === 0 ? 'disabled' : ''}>↑ Subir</button>
          <button data-act="ex-down" ${ei === n - 1 ? 'disabled' : ''}>↓ Bajar</button>
          <button data-act="del-ex" class="danger">Borrar</button>
        </div>
        ${S.state.routine.days.length > 1 ? '<button class="block" style="margin-top:8px" data-act="move-day">Mover a otro día</button>' : ''}
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
        ${deniedText() ? `<p class="err">${esc(deniedText())}</p>` : ''}
        <button class="block" data-act="login">Iniciar sesión con Google</button>
        <p class="muted">Solo para cuentas habilitadas.</p></div>`;
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
        <div class="logo">${ICON.barbell}</div>
        <h1>Mi Rutina</h1>
        <p class="muted">Anotá tus entrenamientos: series, pesos y repeticiones. Tus datos se guardan en este teléfono.</p>
        ${deniedText() ? `<p class="err">${esc(deniedText())}</p>` : ''}
        <button class="primary block" data-act="skip-login">Empezar</button>
        <button class="block" style="margin-top:10px" data-act="login">Entrar con Google</button>
        <p class="muted login-sub">Solo para cuentas habilitadas: guarda también en la nube y sincroniza tus dispositivos.</p>
        <p class="err" id="login-err"></p>
      </div>`;
  }

  /** Aviso si se entró con una cuenta de Google que no está habilitada (cloud.js cerró su sesión). */
  const deniedText = () => (window.Cloud && Cloud.deniedEmail
    ? `${Cloud.deniedEmail} no está habilitada para guardar en la nube. Podés usar la app sin cuenta: tus datos quedan en este teléfono.`
    : '');

  /** Traduce errores de login a mensajes comprensibles. */
  function loginErrorText(e) {
    const m = {
      'auth/unauthorized-domain': 'Esta dirección web no está autorizada en Firebase (Authentication → Configuración → Dominios autorizados).',
      'auth/network-request-failed': 'No hay conexión a internet.',
      'auth/operation-not-allowed': 'El login con Google no está activado en Firebase.',
    };
    return m[e.code] || ('No se pudo iniciar sesión: ' + (e.message || e.code || e));
  }

  /** Opciones de qué ver. Son de ESTE dispositivo: no se sincronizan y esconder algo no borra nada. */
  function optionsCard() {
    const row = (k, title, hint) => `
      <label class="opt"><span><b>${title}</b><small>${hint}</small></span>
        <input type="checkbox" role="switch" data-opt="${k}" ${S.opt(k) ? 'checked' : ''}></label>`;
    return `
      <div class="card stack">
        <h2>Opciones</h2>
        <p class="muted">Elegí qué ver. Son de este dispositivo: en tu otro teléfono o compu se eligen aparte. Esconder algo no borra lo que ya cargaste.</p>
        ${row('rir', 'RIR', 'El casillero para anotar cuántas repeticiones te quedaban, y sus números en Progreso.')}
        ${row('rirPrev', 'RIR de la vez anterior', 'Junto a "Última vez", muestra el RIR que anotaste. Solo se ve si el RIR está prendido.')}
        ${row('rpe', 'RPE por ejercicio', 'Un casillero por ejercicio para anotar qué tan duro fue (1 a 10). También se ve en el Historial.')}
        ${row('e1rmHist', '1RM estimado en el Historial', 'Una cifra chica por ejercicio: el 1RM de tu mejor serie de hasta 10 repeticiones.')}
        ${row('help', 'Ayudas y explicaciones', 'Los cuadros de ayuda y el botón ⓘ. Los avisos importantes se ven siempre.')}
        <button class="block" data-act="tour">Ver el recorrido de primer uso</button>
        <button class="block" data-act="help-reset">Volver a mostrar las ayudas leídas</button>
      </div>`;
  }

  function viewData() {
    const n = S.state.sessions.filter((s) => s.finished).length;
    return `
      <h1>Datos y opciones</h1>
      ${accountCard()}
      ${optionsCard()}
      <div class="card stack">
        <h2>Backup</h2>
        <p class="muted">${n} sesión(es) guardadas. ${window.Cloud && Cloud.user
          ? 'Se guardan en este dispositivo y en la nube. Igual conviene exportar un backup de vez en cuando.'
          : 'Tus datos viven solo en este dispositivo: hacé un backup de vez en cuando.'}</p>
        <button class="primary block" data-act="export-json">Exportar backup (JSON)</button>
        <button class="block" data-act="import-json">Restaurar un backup (reemplaza todo)</button>
        <input type="file" id="file" accept="application/json,.json" hidden>
      </div>
      ${backupsCard()}
      <div class="card stack">
        <h2>Planilla</h2>
        <button class="block" data-act="export-csv">Exportar historial (CSV)</button>
      </div>
      <div class="card stack">
        <h2>Cambiar la rutina</h2>
        <p class="muted">Reemplaza solo los días y ejercicios. <b>Tu historial no se toca.</b> Antes de aplicar te muestra un resumen y se guarda la rutina anterior para poder deshacer.</p>
        <button class="primary block" data-act="import-routine-file">Importar rutina (archivo JSON)</button>
        <input type="file" id="file-routine" accept="application/json,.json" hidden>
        <button class="block" data-act="toggle-paste">${ui.pasteOpen ? 'Cancelar' : 'Importar rutina pegando texto'}</button>
        ${ui.pasteOpen ? `
          <textarea id="paste-json" rows="8" placeholder='Pegá acá el JSON de la rutina' spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>
          <button class="primary block" data-act="apply-paste">Aplicar rutina pegada</button>` : ''}
        ${S.hasRoutineBackup() ? '<button class="block" data-act="undo-routine">Deshacer última importación de rutina</button>' : ''}
      </div>
      <div class="card stack">
        <h2>Rutina de ejemplo</h2>
        <p class="muted">Reemplaza tu rutina por la de ejemplo. No toca el historial y lo de antes queda como copia automática.</p>
        <button class="block danger" data-act="reset-routine">Volver a la rutina de ejemplo</button>
      </div>`;
  }

  const BACKUP_WHY = {
    import: 'antes de restaurar un backup', 'reset-routine': 'antes de volver a la rutina de ejemplo',
    cuenta: 'antes de entrar con otra cuenta', nube: 'antes de usar la rutina de la nube', recuperar: 'antes de recuperar otra copia',
    'borrar sesión': 'antes de borrar una sesión', 'borrar día': 'antes de borrar un día', 'borrar ejercicio': 'antes de borrar un ejercicio', músculos: 'antes de revisar "Espalda" en la rutina',
  };
  /** "copia del 20 oct, 21:40" (las copias de versiones viejas no tienen fecha). */
  const copyName = (at) => (at ? 'copia del ' + new Date(at).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'copia anterior');

  /** Copias automáticas que la app guardó antes de reemplazar datos, con botón para volver a cada una. */
  function backupsCard() {
    const list = S.listBackups().filter((b) => b.mine);
    if (!list.length) return '';
    return `
      <div class="card stack">
        <h2>Copias automáticas</h2>
        <p class="muted">La app guarda lo que tenías antes de reemplazar tus datos. Recuperar una copia reemplaza lo de ahora, que a su vez queda como copia.</p>
        ${list.map((b) => `
          <button class="block" data-act="restore-backup" data-at="${b.at}">Recuperar ${esc(copyName(b.at))}
            <small class="muted btn-sub">${b.sessions} sesión(es) · ${b.days} día(s) de rutina${BACKUP_WHY[b.reason] ? ' · ' + BACKUP_WHY[b.reason] : ''}</small></button>`).join('')}
      </div>`;
  }

  /** Importa solo la rutina desde un texto JSON, con resumen y confirmación. */
  function applyRoutineText(text) {
    try {
      const routine = S.parseRoutineImport(text);
      const nEx = routine.days.reduce((n, d) => n + d.exercises.length, 0);
      const resumen = routine.days.map((d) => `• ${d.name}: ${d.exercises.length} ejercicios${d.exercises.length ? '' : '  ⚠ vacío'}`).join('\n');
      if (!confirm(`Vas a REEMPLAZAR tu rutina actual por esta:\n\n${resumen}\n\nTotal: ${nEx} ejercicios.\nTu historial NO se modifica y podés deshacer desde Datos.\n\n¿Continuar?`)) return;
      S.replaceRoutine(routine);
      ui.pasteOpen = false;
      toast('Rutina actualizada ✓ — revisá las notas marcadas');
      go('routine');
    } catch (err) {
      alert(/JSON válido/.test(err.message)
        ? 'Ese texto no tiene el formato de rutina de esta app. Pedile a quien te armó la rutina el archivo para esta app (termina en .json) e importalo con "Importar rutina (archivo JSON)".'
        : 'No se pudo importar la rutina: ' + err.message);
    }
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const next = S.parseImport(await file.text());
      const nS = next.sessions.length, nD = next.routine.days.length;
      // ¿Qué se perdería? Sesiones de acá que el archivo no trae (ej.: eligieron un archivo de solo rutina).
      const ids = new Set(next.sessions.map((s) => s.id));
      const mine = S.state.sessions.filter((s) => s.finished);
      const lost = mine.filter((s) => !ids.has(s.id)).length;
      const lostBw = S.state.bodyweights.length && !next.bodyweights.length;
      if (lost || lostBw) {
        const what = [lost ? `${lost} sesión(es) de tu historial` : '', lostBw ? 'tu registro de peso corporal' : ''].filter(Boolean).join(' y ');
        const choice = await choose('Este archivo te borraría datos',
          esc(`Tenés ${mine.length} sesión(es) guardadas y el archivo trae ${nS}. Si reemplazás todo, se borran ${what}. `
            + 'Si solo querías cambiar los ejercicios, elegí "Importar solo la rutina": tu historial no se toca.'), [
            ...(nD ? [{ label: 'Importar solo la rutina', value: 'routine', cls: 'primary' }] : []),
            { label: 'Cancelar', value: null, cls: nD ? '' : 'primary' },
            { label: 'Reemplazar todo igual', value: 'all', cls: 'danger' },
          ]);
        if (choice === 'routine') {
          S.replaceRoutine(next.routine);
          toast('Rutina actualizada ✓ — tu historial no se tocó');
          go('routine');
          return;
        }
        if (choice !== 'all') return;
      } else if (!confirm(`Vas a REEMPLAZAR todos tus datos actuales con el archivo:\n\n• ${nD} día(s) de rutina\n• ${nS} sesión(es)\n\nLo que tenés ahora queda como copia automática: se puede recuperar desde Datos. ¿Continuar?`)) return;
      S.replaceAll(next, 'import');
      toast('Backup importado ✓ · lo anterior quedó como copia en Datos');
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

  let shownDay = '';   // día de la última pantalla dibujada (para detectar el cambio de día)
  function render() {
    shownDay = S.todayStr();
    document.body.classList.toggle('gate', gated());
    updateSyncBadge();
    if (gated()) { $view.innerHTML = viewLogin(); return; }
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    $view.innerHTML = views[ui.tab]();
    if (ui.tab === 'progress') { drawChart(); drawSvgCharts(); }
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
    ui.tab = tab; ui.sel = null;
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


  /* ---------- un cambio de peso o reps pasa a las series siguientes ----------
     Regla: solo a las series de ESE ejercicio que vienen después, sin ✓, y mientras sigan valiendo
     lo mismo que la serie editada antes del cambio (se corta en la primera distinta). Así no se
     pisa lo que ya editaste a mano ni se aplanan series escalonadas, y las anteriores no se tocan. */
  const sameVal = (a, b) => (a == null || b == null ? a == null && b == null : Math.abs(a - b) < 1e-9);
  /** Valor actual de un campo de la serie (f: weight|side|bricks|reps, con "d" adelante = drop). */
  function fieldVal(st, ex, f) {
    const isDrop = f.charAt(0) === 'd', key = isDrop ? f.slice(1) : f;
    const t = isDrop ? (st.drop || {}) : st;
    return key === 'side' ? S.sideOf(t, ex.bar) : key === 'bricks' ? S.bricksOf(t) : key === 'reps' ? (t.reps ?? null) : (t.weight ?? null);
  }
  function setField(st, ex, f, v) {
    if (f === 'reps') st.reps = v;
    else if (f === 'dreps') { st.drop = st.drop || S.blankDrop(ex.target && ex.target.reps); st.drop.reps = v; }
    else setWeight(st, ex, f, v);
  }
  /** Copia newV a las series siguientes que seguían a oldV. Anota en rec lo cambiado, para poder deshacer. */
  function propagate(el, c, f, oldV, newV, rec) {
    if (newV == null || Number.isNaN(newV) || sameVal(oldV, newV)) return;
    const exEl = el.closest('[data-ex]');
    for (let k = c.j + 1; k < c.ex.sets.length; k++) {
      const st2 = c.ex.sets[k];
      if (st2.done) continue;
      if (!sameVal(fieldVal(st2, c.ex, f), oldV)) break;
      if (!rec.some((r) => r.st === st2 && r.f === f)) rec.push({ st: st2, f, v: fieldVal(st2, c.ex, f) });
      setField(st2, c.ex, f, newV);
      const w = c.card && c.card.querySelector(`.setw[data-set="${k}"]`);
      const scope = w && ((exEl && w.querySelector(`[data-ex="${exEl.dataset.ex}"]`)) || w);
      const inp = scope && scope.querySelector(`input[data-f="${f}"]`);
      if (inp && inp !== document.activeElement) {
        inp.value = f.endsWith('reps') ? (newV ?? '') : fmt(newV);
        if (!f.endsWith('reps')) updateTot(inp, st2, c.ex);
      }
    }
    if (rec.length) S.commit();
  }
  /** Aviso con "Deshacer" de lo copiado a las series siguientes. */
  function announceCopy(rec, c) {
    if (!rec.length) return;
    const n = new Set(rec.map((r) => r.st)).size;
    const { s, ex } = c;
    toast(`Se copió a ${n} serie${n > 1 ? 's' : ''} siguiente${n > 1 ? 's' : ''}`, { label: 'Deshacer', fn: () => {
      if (currentSession() !== s) { toast('Ya no se puede deshacer'); return; }
      rec.forEach((r) => setField(r.st, ex, r.f, r.v));
      S.commit(); render();
    } });
  }
  /** Seguimiento de lo que se está tecleando: "1" y después "12" siguen siendo UN solo cambio. */
  let prop = null;
  function flushProp() { if (prop) { announceCopy(prop.rec, prop.c); prop = null; } }
  function trackChange(el, c, f, oldBefore, newV) {
    // Si el valor cambió por otro lado desde la última tecla (deshacer, otra pestaña), arranca un cambio nuevo.
    if (!prop || prop.st !== c.st || prop.f !== f || !sameVal(prop.cur, oldBefore)) { flushProp(); prop = { st: c.st, f, val: oldBefore, cur: oldBefore, rec: [], c }; }
    prop.cur = Number.isNaN(newV) ? prop.cur : newV;
    if (newV == null || Number.isNaN(newV)) return;      // campo vacío o inválido: no se copia nada
    propagate(el, c, f, prop.val, newV, prop.rec);
    prop.val = newV;
  }
  $view.addEventListener('focusout', flushProp);

  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    // Editando una sesión vieja, tocar Entrenar sale de la edición (lo cambiado ya quedó guardado).
    if (b.dataset.tab === 'train' && ui.editId) { ui.editId = null; toast('Saliste de la edición: los cambios ya quedaron guardados'); }
    go(b.dataset.tab);
  });

  /* Reordenar ejercicios arrastrando el asa (Pointer Events; funciona con dedo y mouse). */
  $view.addEventListener('click', (e) => {
    if (e.target.closest('.drag-handle')) e.preventDefault();     // que el asa no abra/cierre el ejercicio
  });
  $view.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const el = handle.closest('details.exe'), section = el.closest('[data-day]');
    const list = () => [...section.querySelectorAll(':scope > details.exe')];
    const from = list().indexOf(el);
    const rect = el.getBoundingClientRect();
    const grab = e.clientY - rect.top;
    const ph = document.createElement('div');
    ph.className = 'exe-ph';
    ph.style.height = rect.height + 'px';
    el.before(ph);
    el.classList.add('dragging');
    Object.assign(el.style, { width: rect.width + 'px', left: rect.left + 'px', top: rect.top + 'px' });
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
    let y = e.clientY, raf = 0, slot = from;

    const place = () => {
      el.style.top = (y - grab) + 'px';
      const others = list().filter((x) => x !== el);
      slot = others.filter((x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2 < y; }).length;
      const ref = others[slot] || section.querySelector(':scope > [data-act="add-ex"]');
      if (ph.nextElementSibling !== ref) section.insertBefore(ph, ref);
    };
    const tick = () => {
      const edge = 70, step = 14;
      if (y < edge) window.scrollBy(0, -step * (1 - Math.max(y, 0) / edge) - 2);
      else if (y > window.innerHeight - edge) window.scrollBy(0, step * (1 - Math.max(window.innerHeight - y, 0) / edge) + 2);
      place();
      raf = requestAnimationFrame(tick);
    };
    const end = (commitDrop) => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key, true);
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
      el.classList.remove('dragging');
      el.removeAttribute('style');
      const others = list().filter((x) => x !== el);               // vuelve a su lugar original en el DOM
      section.insertBefore(el, others[from] || section.querySelector(':scope > [data-act="add-ex"]'));
      ph.remove();
      if (commitDrop && slot !== from) {
        S.moveExerciseTo(section.dataset.day, el.dataset.id, slot);
        render();
      }
    };
    const move = (ev) => { y = ev.clientY; };
    const up = (ev) => { y = ev.clientY; place(); end(true); };   // toma la posición final aunque no haya dado tiempo a otro cuadro
    const cancel = () => end(false);
    const key = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); end(false); } };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key, true);
    raf = requestAnimationFrame(tick);
  });

  let lastComplete = { card: null, t: 0 };   // último toque en "✓ Completar" (para ignorar el doble toque)
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
        const f = input.dataset.f;                         // weight | side | bricks (con "d" adelante: drop)
        const key = f.charAt(0) === 'd' ? f.slice(1) : f;
        // por lado: 1,25 (= 2,5 al total) · bloques: 1 · peso directo: 2,5
        const step = key === 'side' ? 1.25 : key === 'bricks' ? 1 : 2.5;
        const cur = S.parseNum(input.value);
        let base = Number.isNaN(cur) ? null : cur;
        if (base == null) {
          // Drop vacío: se parte del peso de la serie principal; si no, de 0.
          base = f.charAt(0) === 'd'
            ? (key === 'side' ? S.sideOf(c.st, c.ex.bar) : key === 'bricks' ? S.bricksOf(c.st) : c.st.weight) || 0
            : 0;
        }
        const next = Math.max(0, Math.round((base + (act.endsWith('+') ? step : -step)) * 100) / 100);
        input.value = fmt(next); input.classList.remove('invalid');
        flushProp();
        const oldV = fieldVal(c.st, c.ex, f);
        setWeight(c.st, c.ex, f, next); S.commit(); updateTot(input, c.st, c.ex);
        const rec = []; propagate(input, c, f, oldV, next, rec); announceCopy(rec, c);
        break;
      }
      case 'pick-bar':
        S.setSessionBar(c.ex, Number(btn.dataset.bar)); fillFromLast(c.s, c.ex); render();
        break;
      case 'change-day':
        if (!c.s.exercises.some((ex) => ex.sets.some((st) => st.done))) { S.deleteSession(c.s.id); render(); window.scrollTo(0, 0); }
        break;
      case 'session-today':
        c.s.date = S.todayStr(); c.s.created = Date.now(); S.commit();   // hoy también es el nuevo inicio: la duración cuenta desde ahora
        render(); toast('Sesión pasada a hoy');
        break;
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
        if (turnOn && c.exs.some((e) => e.usesBar && e.bar == null)) { toast('Primero elegí la barra (arriba)'); break; }
        if (turnOn && !sts.every(setValid)) { toast('Cargá las repeticiones primero'); break; }
        if (turnOn && !okToMark(c.exs.flatMap((e) => (e.sets[c.j] ? warnings(c.s, e, [e.sets[c.j]]) : [])))) break;
        sts.forEach((x) => { x.done = turnOn; });
        c.exs.forEach(syncEx); S.commit(); refreshCard(c.card, c.exs);
        if (turnOn) {                                      // pulso en el tilde, en el mismo instante
          const chk = c.row.querySelector('.chk');
          chk.classList.remove('pop'); void chk.offsetWidth; chk.classList.add('pop');
          haptic(12);
        }
        break;
      }
      case 'del-set': {
        const { s, exs, j } = c;
        const removed = exs.map((e) => e.sets.splice(j, 1)[0]);   // undefined si ese ejercicio tenía menos series
        exs.forEach(syncEx); S.commit(); render();
        toast('Serie borrada', { label: 'Deshacer', fn: () => {
          // Solo si sigue siendo la sesión visible (no se terminó ni la reemplazó una versión de la nube).
          if (currentSession() !== s) { toast('Ya no se puede deshacer'); return; }
          exs.forEach((e, i) => { if (removed[i]) e.sets.splice(Math.min(j, e.sets.length), 0, removed[i]); syncEx(e); });
          S.commit(); render();
        } });
        break;
      }
      case 'add-set':
        c.exs.forEach((e) => {
          const prev = e.sets[e.sets.length - 1];
          e.sets.push({
            weight: prev ? prev.weight : null, side: prev ? prev.side ?? null : null,
            bricks: prev ? prev.bricks ?? null : null, reps: prev ? prev.reps : null,   // mismo orden que normSet
            drop: e.drop ? (prev && prev.drop ? Object.assign({}, prev.drop) : S.blankDrop(e.target && e.target.reps)) : null,
            note: '', done: false,
          });
          e.done = false;
        });
        S.commit(); render();
        break;
      case 'complete-ex': {
        // Un doble toque marcaba y enseguida desmarcaba todo (el botón cambia en el mismo lugar).
        if (lastComplete.card === c.card && Date.now() - lastComplete.t < 800) break;
        lastComplete = { card: c.card, t: Date.now() };
        if (c.exs.every((e) => e.done)) {
          c.exs.forEach((e) => { e.sets.forEach((st) => { st.done = false; }); e.done = false; });
        } else {
          if (c.exs.some((e) => e.usesBar && e.bar == null)) { toast('Primero elegí la barra (arriba)'); break; }
          const lines = c.exs.flatMap((e) => {
            const toMark = e.sets.filter((st) => !st.done && setValid(st));
            const last = S.lastEntry(e.name, c.s.id, c.s.dayId);
            const usesWeight = !last || last.sets.some((x) => x.weight != null);   // sin historial o con peso antes
            const noW = toMark.filter((st) => st.weight == null).length;
            return [...(usesWeight && noW ? [`${e.name}: ${noW} serie(s) sin peso`] : []), ...warnings(c.s, e, toMark)];
          });
          if (!okToMark(lines)) break;
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
      case 'share-start': ui.sel = new Set(); render(); break;
      case 'share-cancel': ui.sel = null; render(); break;
      case 'share-go': shareSessions(); break;
      case 'edit-session': {
        const sid = btn.closest('[data-sid]').dataset.sid;
        const s = S.find(S.state.sessions, sid);
        ui.editId = s.finished ? sid : null;   // las "en curso" se retoman directo
        go('train');
        break;
      }
      case 'del-session': {
        const s = S.find(S.state.sessions, btn.closest('[data-sid]').dataset.sid);
        if (s && confirm('¿Borrar esta sesión del historial? Si te arrepentís, tenés unos segundos para deshacerlo.')) {
          S.backup('borrar sesión');
          S.deleteSession(s.id); render();
          toast('Sesión borrada', { label: 'Deshacer', fn: () => {
            toast(S.reinsertSession(s) ? 'Sesión recuperada ✓' : 'Ya no se puede deshacer'); render();
          } });
        }
        break;
      }

      /* --- rutina --- */
      case 'add-day': S.addDay(); render(); break;
      case 'day-up': case 'day-down': S.moveDay(btn.closest('[data-day]').dataset.day, act === 'day-up' ? -1 : 1); render(); break;
      case 'del-day': {
        const d = S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day);
        if (confirm(`¿Borrar "${d.name}" y sus ${d.exercises.length} ejercicios? El historial no se borra. Si te arrepentís, tenés unos segundos para deshacerlo.`)) {
          const index = S.state.routine.days.findIndex((x) => x.id === d.id);
          S.backup('borrar día');
          S.deleteDay(d.id); render();
          toast(`"${d.name}" borrado`, { label: 'Deshacer', fn: () => {
            toast(S.reinsertDay(d, index) ? 'Día recuperado ✓' : 'Ya no se puede deshacer'); render();
          } });
        }
        break;
      }
      case 'bw-save': {
        const kgEl = document.getElementById('bw-kg'), dEl = document.getElementById('bw-date');
        const kg = S.parseNum(kgEl.value);
        if (kg == null || Number.isNaN(kg) || kg <= 0 || kg >= 500) { kgEl.classList.add('invalid'); toast('Cargá un peso válido'); break; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dEl.value)) { toast('Elegí una fecha'); break; }
        S.setBodyweight(dEl.value, kg); toast('Peso guardado ✓'); render();
        break;
      }
      case 'bw-del':
        if (confirm('¿Borrar este registro de peso?')) { S.deleteBodyweight(btn.dataset.date); render(); }
        break;
      case 'muscle': {                               // ninguno → principal → secundario → ninguno
        const id = btn.closest('[data-id]').dataset.id;
        const ex = S.find(S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day).exercises, id);
        const m = btn.dataset.m, cur = ex.muscles || { primary: [], secondary: [] };
        let p = cur.primary.filter((x) => x !== m), sec = cur.secondary.filter((x) => x !== m);
        if (cur.primary.includes(m)) sec.push(m); else if (!cur.secondary.includes(m)) p.push(m);
        const next = S.normMuscles({ primary: p, secondary: sec });
        delete ex.muscles;
        if (next) ex.muscles = next;                 // se guarda solo si hay alguno
        S.commit(); ui.open.add(id); ui.mopen.add(id); render();
        break;
      }
      case 'muscle-toggle': {
        const id = btn.closest('[data-id]').dataset.id;
        if (ui.mopen.has(id)) ui.mopen.delete(id); else ui.mopen.add(id);
        const ex = S.find(S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day).exercises, id);
        btn.closest('[data-mbox]').innerHTML = muscleBox(ex);
        break;
      }
      case 'muscle-back': {                          // reemplazar "Espalda" por la sugerencia de la base
        const id = btn.closest('[data-id]').dataset.id;
        const ex = S.find(S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day).exercises, id);
        const rep = S.backReplacement(ex);
        if (rep) { S.backup('músculos'); ex.muscles = rep; S.commit(); ui.open.add(id); toast('Músculos actualizados ✓'); render(); }
        break;
      }
      case 'go-ex': {                                // desde el aviso: abre el ejercicio y baja hasta él
        ui.open.add(btn.dataset.id); ui.mopen.add(btn.dataset.id); render();
        const box = document.querySelector(`details.exe[data-id="${CSS.escape(btn.dataset.id)}"]`);
        if (box) setTimeout(() => box.scrollIntoView({ block: 'start' }), 0);
        break;
      }
      case 'muscle-back-all': {
        const todo = S.state.routine.days.flatMap((d) => d.exercises).filter((x) => S.backReplacement(x));
        if (!todo.length) break;
        if (!confirm(`¿Reemplazar "Espalda" en ${todo.length} ejercicio(s) por la sugerencia de la base?\n\nSe guarda una copia automática antes. Lo demás que cargaste no se toca.`)) break;
        S.backup('músculos');
        todo.forEach((x) => { x.muscles = S.backReplacement(x); });
        S.commit(); toast(`Listo: ${todo.length} ejercicio(s) actualizados ✓`); render();
        break;
      }
      case 'set-load': {
        const id = btn.closest('[data-id]').dataset.id;
        const ex = S.find(S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day).exercises, id);
        ex.usesBar = btn.dataset.v === 'bar';                // barra y bloques son excluyentes
        ex.usesBricks = btn.dataset.v === 'bricks';
        S.commit(); ui.open.add(id); render();
        break;
      }
      case 'toggle-ss': {
        const id = btn.closest('[data-id]').dataset.id;
        const day = S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day);
        const i = day.exercises.findIndex((x) => x.id === id), a = day.exercises[i], b = day.exercises[i + 1];
        const linked = a.group && b && a.group === b.group;
        if (!linked && !confirm(`¿Unir "${a.name}" y "${b.name}" en superserie?\n\nSe hacen alternados: una serie de cada uno, uno tras otro, y recién ahí se descansa.`)) break;
        S.toggleSuperset(day.id, id);
        ui.open.add(id); render();
        break;
      }
      case 'open-all': case 'close-all': {
        const day = S.find(S.state.routine.days, btn.closest('[data-day]').dataset.day);
        day.exercises.forEach((x) => (act === 'open-all' ? ui.open.add(x.id) : ui.open.delete(x.id)));
        render(); break;
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
      case 'move-day': {
        const dayId = btn.closest('[data-day]').dataset.day, id = btn.closest('[data-id]').dataset.id;
        const ex = S.find(S.find(S.state.routine.days, dayId).exercises, id);
        const to = await choose(`Mover "${ex.name}"`, 'Pasa al final del día que elijas, con su nombre, series y notas. El historial no se toca.', [
          ...S.state.routine.days.filter((d) => d.id !== dayId).map((d) => ({ label: d.name, value: d.id })),
          { label: 'Cancelar', value: null }]);
        if (to && S.moveExerciseToDay(dayId, id, to)) { ui.open.add(id); toast('Ejercicio movido'); render(); }
        break;
      }
      case 'join-ex': {
        const cur = S.exerciseNames().find((n) => n.key === ui.progKey);
        const others = S.exerciseNames().filter((n) => n.key !== ui.progKey);
        if (!cur || !others.length) { toast('No hay otro ejercicio para unir'); break; }
        const pick = await choose(`Unir con "${cur.name}"`,
          esc('Elegí el ejercicio que es el MISMO pero quedó con otro nombre. Su historial se va a ver junto con el de este. Tus sesiones no se modifican y lo podés separar después.'),
          [...others.map((n) => ({ label: n.name, value: n.key })), { label: 'Cancelar', value: null }]);
        if (pick && S.joinExercises(pick, ui.progKey)) { toast('Ejercicios unidos'); render(); }
        break;
      }
      case 'split-ex':
        if (S.splitExercise(btn.dataset.key)) { toast('Ejercicios separados'); render(); }
        break;
      case 'del-ex': {
        const dayId = btn.closest('[data-day]').dataset.day, id = btn.closest('[data-id]').dataset.id;
        const ex = S.find(S.find(S.state.routine.days, dayId).exercises, id);
        if (confirm(`¿Borrar "${ex.name}" de la rutina? El historial no se borra. Si te arrepentís, tenés unos segundos para deshacerlo.`)) {
          const day = S.find(S.state.routine.days, dayId), index = day.exercises.findIndex((x) => x.id === id);
          S.backup('borrar ejercicio');
          S.deleteExercise(dayId, id); render();
          toast(`"${ex.name}" borrado`, { label: 'Deshacer', fn: () => {
            toast(S.reinsertExercise(dayId, ex, index) ? 'Ejercicio recuperado ✓' : 'Ya no se puede deshacer'); render();
          } });
        }
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
      case 'skip-login': Cloud.deniedEmail = ''; Cloud.skip(); break;
      case 'logout': {
        const pending = Cloud.status === 'syncing' || Cloud.status === 'offline';
        const msg = Cloud.status === 'error'
          ? 'La nube está dando error: puede que tus últimos cambios no se hayan subido. Quedan guardados en este dispositivo. ¿Cerrar sesión?'
          : pending
            ? 'Hay cambios que todavía no se subieron a la nube. Si cerrás sesión ahora se conservan en este dispositivo y se suben la próxima vez que entres. ¿Cerrar sesión?'
            : '¿Cerrar sesión? Tus datos quedan guardados en la nube.';
        if (confirm(msg)) await Cloud.signOut();
        break;
      }

      /* --- datos --- */
      case 'help-reset': S.resetHelp(); ui.helpOpen.clear(); toast(S.opt('help') ? 'Las ayudas vuelven a verse' : 'Listo. Para verlas, prendé "Ayudas y explicaciones"'); render(); break;
      case 'tour': runTour(); break;
      case 'tour-skip': S.setPref('tour', 1); render(); break;
      case 'help-ok': S.setPref('help.' + btn.dataset.help, 1); ui.helpOpen.delete(btn.dataset.help); render(); break;
      case 'help-show': ui.helpOpen.add(btn.dataset.help); render(); break;
      case 'export-json':
        download(`rutina-gym-backup-${S.todayStr()}.json`, S.exportJSON(), 'application/json');
        S.markExported(); toast('Backup descargado'); if (ui.tab === 'history') render();
        break;
      case 'export-csv': download(`historial-gym-${S.todayStr()}.csv`, S.exportCSV(), 'text/csv;charset=utf-8'); toast('CSV descargado'); break;
      case 'prog-sec': ui.progSec = btn.dataset.sec; S.setPref('progSec', ui.progSec); render(); window.scrollTo(0, 0); break;
      case 'import-json': document.getElementById('file').click(); break;
      case 'restore-backup': {
        const at = Number(btn.dataset.at);
        const b = S.listBackups().find((x) => x.at === at);
        const now = S.state.sessions.filter((s) => s.finished).length;
        if (b && confirm(`¿Recuperar la ${copyName(at)}?\n\nTiene ${b.sessions} sesión(es) y ${b.days} día(s) de rutina.\nLo que tenés ahora (${now} sesión(es)) queda guardado como copia.`)) {
          if (S.restoreBackup(at)) { toast('Copia recuperada ✓'); go('history'); } else alert('No se pudo recuperar esa copia.');
        }
        break;
      }
      case 'import-routine-file': document.getElementById('file-routine').click(); break;
      case 'toggle-paste': ui.pasteOpen = !ui.pasteOpen; render(); break;
      case 'apply-paste': applyRoutineText(document.getElementById('paste-json').value); break;
      case 'undo-routine':
        if (confirm('¿Volver a la rutina que tenías antes de la última importación? El historial no se modifica.')) {
          if (S.restoreRoutineBackup()) { toast('Rutina anterior restaurada'); go('routine'); } else alert('No hay rutina anterior guardada.');
        }
        break;
      case 'reset-routine':
        if (confirm('¿Reemplazar tu rutina actual por la de ejemplo? El historial se conserva y lo de antes queda como copia automática en Datos.')) {
          try { await S.resetRoutine(); toast('Rutina de ejemplo cargada'); render(); } catch (err) { alert(err.message); }
        }
        break;
    }
  });

  /* Escritura en inputs: valida y guarda sin redibujar (así no se pierde el foco). */
  $view.addEventListener('input', (e) => {
    const el = e.target;

    // Sesión: peso / reps de una serie
    if (['weight', 'side', 'bricks', 'dweight', 'dside', 'dbricks'].includes(el.dataset.f)) {
      const c = ctx(el), { st, ex } = c;
      if (!st) return;
      const v = isThousands(el.value) ? NaN : S.parseNum(el.value);
      el.classList.toggle('invalid', Number.isNaN(v));
      if (Number.isNaN(v)) return;                 // no guarda valores inválidos
      const oldV = fieldVal(st, ex, el.dataset.f);
      setWeight(st, ex, el.dataset.f, v); S.commit(); updateTot(el, st, ex);
      trackChange(el, c, el.dataset.f, oldV, v);
      return;
    }
    if (el.dataset.f === 'bar') {                  // "otra" barra: se aplica al salir del campo
      const v = S.parseNum(el.value);
      el.classList.toggle('invalid', Number.isNaN(v));
      return;
    }
    if (el.dataset.f === 'rir') {                  // repeticiones en reserva: entero de 0 a 10, opcional
      const { st } = ctx(el);
      if (!st) return;
      let v = S.parseNum(el.value);
      if (v != null && !Number.isNaN(v) && (!Number.isInteger(v) || v > 10)) v = NaN;
      el.classList.toggle('invalid', Number.isNaN(v));
      if (!Number.isNaN(v)) S.setSetRir(st, v);
      return;
    }
    if (el.dataset.f === 'reps') {
      const c = ctx(el), { st } = c;
      if (!st) return;
      let v = S.parseNum(el.value);
      if (!Number.isNaN(v) && v != null && !Number.isInteger(v)) v = NaN;
      el.classList.toggle('invalid', Number.isNaN(v));
      if (Number.isNaN(v)) return;
      const oldV = st.reps ?? null;
      st.reps = v;
      if (st.done && !(v > 0)) { st.done = false; c.exs.forEach(syncEx); refreshCard(c.card, c.exs); }   // sin reps no cuenta como hecha
      S.commit();
      trackChange(el, c, 'reps', oldV, v);
      return;
    }

    // Sesión: peso / reps de la parte drop de una serie
    if (el.dataset.f === 'dreps') {
      const c = ctx(el), { st, ex } = c;
      if (!st) return;
      let v = S.parseNum(el.value);
      if (!Number.isNaN(v) && v != null && !Number.isInteger(v)) v = NaN;
      el.classList.toggle('invalid', Number.isNaN(v));
      if (Number.isNaN(v)) return;
      const oldV = fieldVal(st, ex, 'dreps');
      st.drop = st.drop || S.blankDrop(ex.target && ex.target.reps);
      st.drop.reps = v; S.commit();
      trackChange(el, c, 'dreps', oldV, v);
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
        box.querySelector('[data-sum="info"]').textContent = exInfo(ex);
      }
    }
  });

  /* Al salir de un campo inválido, vuelve al último valor guardado. */
  $view.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches && el.matches('input[data-pick]')) {
      const id = el.closest('[data-sid]').dataset.sid;
      el.checked ? ui.sel.add(id) : ui.sel.delete(id);
      render(); return;
    }
    if (el.dataset.f === 'rpe') {
      const { ex } = ctx(el);
      if (ex) S.setExRpe(ex, el.value === '' ? null : Number(el.value));
      return;
    }
    if (el.dataset.opt) { S.setOpt(el.dataset.opt, el.checked); render(); return; }
    if (el.dataset.f === 'date') {
      const s = currentSession();
      if (s && el.value) { s.date = el.value; S.commit(); }
      return;
    }
    if (el.dataset.f === 'prog') { ui.progKey = el.value; S.setPref('progKey', el.value); render(); return; }
    if (el.dataset.f === 'progday') { ui.progDay = el.value; render(); return; }
    if (el.dataset.f === 'progweek') { ui.progWeek = el.value; render(); return; }
    if (el.dataset.f === 'comment') {                // se guarda al salir del campo
      if (S.setExerciseComment(el.dataset.name, el.value)) toast('Comentario guardado');
      return;
    }
    if (el.dataset.f === 'bar') {
      const { ex } = ctx(el);
      const v = S.parseNum(el.value);
      if (ex && v != null && !Number.isNaN(v)) S.setSessionBar(ex, v);
      else if (Number.isNaN(v)) toast('Peso de barra no válido');
      render();
      return;
    }
    if (el.id === 'file') { importFile(el.files[0]); el.value = ''; return; }
    if (el.id === 'file-routine') {
      const f = el.files[0]; el.value = '';
      if (f) f.text().then(applyRoutineText);
      return;
    }
    if (el.dataset.rf === 'name' && !el.classList.contains('invalid')) {   // nombre repetido: comparten historial
      const id = el.closest('[data-id]').dataset.id, key = S.normName(el.value);
      const dup = S.state.routine.days.find((d) => d.exercises.some((x) => x.id !== id && S.normName(x.name) === key));
      const day = S.find(S.state.routine.days, el.closest('[data-day]').dataset.day), ex = S.find(day.exercises, id), box = el.closest('[data-id]');
      if (!ex.muscles) {                           // sin músculos: se propone lo de la base (nunca pisa lo cargado)
        const sug = S.suggestMuscles(ex.name);
        if (sug) {
          ex.muscles = { primary: sug.primary, secondary: sug.secondary };
          S.commit();
          box.querySelector('[data-mbox]').innerHTML = muscleBox(ex);
          if (!dup) toast('Músculos sugeridos: ' + muscleText(ex), { label: 'Quitar', fn: () => {
            delete ex.muscles; S.commit(); box.querySelector('[data-mbox]').innerHTML = muscleBox(ex);
          } });
        }
      }
      if (dup) toast(`Ya existe "${el.value.trim()}" en ${dup.name}: van a compartir historial y pesos`);
      return;
    }
    if (el.classList.contains('invalid')) {
      const why = isThousands(el.value) ? 'Para decimales usá coma (ej.: 2,5)'
        : el.dataset.f === 'rir' ? 'RIR va de 0 a 10, sin decimales'
        : ['reps', 'dreps'].includes(el.dataset.f) ? 'Las reps van sin decimales'
        : 'Valor no válido';
      toast(why + ': se restauró el anterior');
      const { st, ex } = ctx(el);
      if (st && ['weight', 'side', 'bricks', 'reps', 'dweight', 'dside', 'dbricks', 'dreps', 'rir'].includes(el.dataset.f)) {
        const d = st.drop || {};
        el.value = {
          weight: fmt(st.weight), side: fmt(S.sideOf(st, ex.bar)), bricks: fmt(S.bricksOf(st)), reps: st.reps ?? '',
          dweight: fmt(d.weight), dside: fmt(S.sideOf(d, ex.bar)), dbricks: fmt(S.bricksOf(d)), dreps: d.reps ?? '',
          rir: st.rir ?? '',
        }[el.dataset.f];
        el.classList.remove('invalid');
      } else render();
    }
  });

  /* Al tocar peso o reps se selecciona todo el contenido: se escribe encima, sin borrar antes.
     (El teclado numérico ya se abre solo por inputmode="decimal"/"numeric".) */
  $view.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.matches && el.matches('.setw input[data-f], input[data-rf]')) {
      el.dataset.justFocused = '1';
      setTimeout(() => { try { el.select(); el.setSelectionRange(0, 99); } catch (err) { /* nada */ } }, 0);
    }
  });
  /* En el editor de Rutina, Enter pasa al campo siguiente (nombre → series → reps → peso → notas). */
  $view.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.matches || !el.matches('input[data-rf]')) return;
    const fields = [...el.closest('details.exe').querySelectorAll('[data-rf]')];
    const next = fields[fields.indexOf(el) + 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
  });
  /* El "soltar" del mismo toque que dio el foco movía el cursor y deshacía la selección
     (lo nuevo se mezclaba con lo viejo: "10" → "18.50"). */
  $view.addEventListener('mouseup', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.justFocused) { e.preventDefault(); delete el.dataset.justFocused; }
  });

  /* Recuerda qué ejercicios del editor están desplegados (el evento "toggle" no burbujea). */
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches && d.matches('details.exe')) d.open ? ui.open.add(d.dataset.id) : ui.open.delete(d.dataset.id);
  }, true);

  /* ---------- arranque ---------- */

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (ui.tab === 'progress' && !gated()) drawSvgCharts(); }, 200);
  });

  S.onSaveError = () => toast('⚠ No se pudo guardar (almacenamiento lleno o bloqueado)');

  /* ---------- la app abierta en otra pestaña o ventana ----------
     Guarda una sola a la vez (ver store.js). La que queda en pausa se tapa con un aviso; al
     volver a ella o tocar "Seguir en esta", recarga lo más reciente y pasa a ser la que guarda. */
  function showTabWall() {
    if (document.getElementById('tabwall')) return;
    const w = document.createElement('div');
    w.id = 'tabwall';
    w.className = 'sheet-bg';
    w.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="tabwall-t">
        <h2 id="tabwall-t">La app está abierta en otra pestaña o ventana</h2>
        <p class="muted">Para no pisar tus datos, se guarda en una sola a la vez. Si seguís acá, se cargan los datos más recientes.</p>
        <div class="stack"><button class="primary block" data-act="tab-claim">Seguir en esta</button></div>
      </div>`;
    w.addEventListener('click', (e) => { if (e.target.closest('[data-act="tab-claim"]')) resumeHere(); });
    document.body.appendChild(w);
  }
  function resumeHere() {
    if (!S.state) return;                        // todavía arrancando
    const reloaded = S.claimTab();
    const w = document.getElementById('tabwall');
    if (w) w.remove();
    // Cambió el día mientras la app seguía abierta: se redibuja para que aparezca el aviso de sesión de otro día.
    if (!reloaded) { if (shownDay !== S.todayStr() && !typing()) render(); return; }
    if (window.Cloud && Cloud.resume) Cloud.resume();
    if (ui.editId && !S.find(S.state.sessions, ui.editId)) ui.editId = null;
    render();
    toast('Datos actualizados con los de la otra pestaña');
  }
  S.onInactive = showTabWall;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeHere(); });
  window.addEventListener('focus', resumeHere);
  window.addEventListener('pageshow', (e) => { if (e.persisted) resumeHere(); });

  /* Datos nuevos de la nube (ej.: cargaste algo desde otro dispositivo). Si estás
     escribiendo en un campo se espera a que termines para no cortarte la edición. */
  let renderPending = false;
  const typing = () => {
    const a = document.activeElement;
    return !!(a && $view.contains(a) && a.matches('input, textarea, select'));
  };
  /* iOS: al cerrar el teclado el viewport a veces queda desplazado y la barra fija
     queda flotando. Un scroll mínimo fuerza a Safari a recalcular el borde inferior. */
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.matches && a.matches('input, textarea, select')) return;
      const y = window.scrollY;
      window.scrollTo(0, y + 1); window.scrollTo(0, y);
    }, 120);
  });
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', () => {
      if (Math.abs(visualViewport.offsetTop) > 1 && !typing()) window.scrollTo(0, window.scrollY);
    });
  }

  $view.addEventListener('focusout', () => {
    if (!renderPending) return;
    setTimeout(() => { if (!typing()) { renderPending = false; render(); } }, 350);
  });

  if (window.Cloud) {
    let shownDenied = '';
    Cloud.onChange = () => {
      // Cambió el login o el estado: solo se redibuja si cambió algo visible importante
      // (incluido el aviso de cuenta no habilitada, que aparece en la pantalla de inicio).
      const deniedChanged = Cloud.deniedEmail !== shownDenied;
      shownDenied = Cloud.deniedEmail;
      if (deniedChanged || gated() !== document.body.classList.contains('gate') || ui.tab === 'data') {
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
