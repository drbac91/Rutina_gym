/* ==========================================================================
   store.js — Capa de datos
   --------------------------------------------------------------------------
   Es lo ÚNICO que toca localStorage. La UI (app.js) pide y modifica datos
   a través de `Store`. Cada cambio se guarda solo (autoguardado).

   Formato = el de rutina.json, más:
     - ejercicio.id (interno, se agrega al cargar)
     - sesiones: { id, created, date, dayId, dayName, finished,
                   exercises:[{ name, done, target:{sets,reps,weight},
                                sets:[{ weight, reps, note, done }] }] }
   Las sesiones guardan una COPIA del nombre del día/ejercicio y del objetivo,
   así que cambiar la rutina nunca altera el historial.
   ========================================================================== */
(function (global) {
  'use strict';

  const KEY = 'gymapp.v1';
  const BACKUP_KEY = 'gymapp.v1.backup';   // copia previa a importar/restaurar
  let state = null;

  /** Barras disponibles en el gimnasio (kg), en el orden en que se ofrecen en "Barra de hoy". */
  const BARS = [25, 20, 17.5, 7.5];
  /** Peso de cada bloque de las máquinas (kg). */
  const BRICK_KG = 5;

  /* ---------- umbrales de las métricas de Progreso (ajustables) ---------- */
  /** El 1RM estimado solo se calcula con series de hasta estas repeticiones. */
  const E1RM_MAX_REPS = 10;
  /** Semanas sin mejorar el 1RM estimado para avisar "estancado" (3–4 es lo habitual). */
  const STALL_WEEKS = 3;
  /** Cuánto cuenta una serie para cada músculo SECUNDARIO (el principal cuenta 1). */
  const SECONDARY_MUSCLE_FACTOR = 0.5;
  /** Una serie es "efectiva" si te quedaron como mucho estas repeticiones en reserva (RIR). */
  const EFFECTIVE_RIR_MAX = 3;
  /** Duraciones mayores se descartan (probablemente la sesión quedó abierta). */
  const MAX_SESSION_MINUTES = 240;

  /** Grupos musculares que se pueden asignar a cada ejercicio. */
  const MUSCLES = ['Pecho', 'Espalda', 'Hombros', 'B\u00edceps', 'Tr\u00edceps', 'Antebrazos', 'Core',
    'Cu\u00e1driceps', 'Isquiotibiales', 'Gl\u00fateos', 'Aductores', 'Abductores', 'Pantorrillas'];

  /* ---------- utilidades ---------- */

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Nombre normalizado: sin tildes, minúsculas, espacios simples.
   *  Es la clave para que "Banco plano" de Día 1 y Día 3 compartan historial. */
  const normName = (s) =>
    String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();

  /** Convierte texto a número aceptando coma o punto.
   *  Devuelve: número (>=0) | null si está vacío | NaN si es inválido/negativo. */
  function parseNum(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().replace(',', '.');
    if (s === '') return null;
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;   // rechaza "-5", "abc", "1.2.3"
    return Number(s);
  }

  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ---------- normalización / validación de datos ---------- */

  function normExercise(e) {
    e = e || {};
    const muscles = normMuscles(e.muscles);
    const usesBar = !!e.usesBar || (e.bar != null && e.bar !== '');
    const sets = parseInt(e.sets, 10);
    const tw = e.targetWeight == null ? null : Number(e.targetWeight);
    return withOptional({
      id: e.id ? String(e.id) : uid(),
      name: String(e.name || '').trim() || 'Ejercicio',
      sets: sets >= 1 ? sets : 3,
      reps: e.reps == null ? '' : String(e.reps),
      targetWeight: Number.isFinite(tw) && tw >= 0 ? tw : null,
      notes: String(e.notes || ''),
      original: String(e.original || ''),
      group: String(e.group || ''),          // misma marca en ejercicios consecutivos = superserie
      usesBar,                                // lleva barra: se cargan discos por lado
      usesBricks: !usesBar && !!e.usesBricks,  // máquina con bloques (excluyente con barra)
    }, 'muscles', muscles);                   // grupos musculares (opcional)
  }

  /** Músculos de un ejercicio: { primary:[], secondary:[] } o null si no tiene.
   *  Solo nombres de la lista MUSCLES; un músculo no puede ser principal y secundario a la vez. */
  function normMuscles(m) {
    if (!m || typeof m !== 'object') return null;
    const pick = (arr) => (Array.isArray(arr) ? arr : [])
      .map((x) => String(x).normalize('NFC')).filter((x, i, a) => MUSCLES.includes(x) && a.indexOf(x) === i);
    const primary = pick(m.primary);
    const secondary = pick(m.secondary).filter((x) => !primary.includes(x));
    return primary.length || secondary.length ? { primary, secondary } : null;
  }

  /** Agrega un campo opcional SOLO si tiene valor (así los datos viejos y su huella
   *  de sincronización no cambian). */
  function withOptional(obj, key, value) {
    if (value != null) obj[key] = value;
    return obj;
  }

  function normSet(s) {
    s = s || {};
    const num = (v) => { const n = v == null ? null : Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
    // "drop": segunda parte de la MISMA serie, sin pausa, con menos peso (ej.: 10×20 kg + 10×15 kg).
    const drop = s.drop && typeof s.drop === 'object' ? { weight: num(s.drop.weight), reps: num(s.drop.reps), side: num(s.drop.side), bricks: num(s.drop.bricks) } : null;
    const out = {
      weight: num(s.weight),            // SIEMPRE el total (barra + discos): historial y gráficos usan esto
      side: num(s.side),                // discos por lado, solo en ejercicios con barra
      bricks: num(s.bricks),            // bloques, solo en máquinas con bloques (weight = bricks × 5)
      reps: num(s.reps),
      drop: drop && (drop.weight != null || drop.reps != null) ? drop : null,
      note: String(s.note || ''),
      done: s.done !== false,          // datos viejos sin "done" cuentan como hechos
    };
    const rir = num(s.rir);
    return withOptional(out, 'rir', rir != null && rir <= 10 ? Math.round(rir) : null);   // repeticiones en reserva (opcional)
  }

  /** ¿Este ejercicio de la rutina se hace con drop set? Reps tipo "10-10" (dos números
   *  iguales) o la palabra "drop" en las notas. Un rango como "12-15" NO es drop set. */
  function isDropExercise(ex) {
    const m = String(ex.reps || '').match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
    return !!(m && m[1] === m[2]) || /drop/i.test(String(ex.notes || ''));
  }

  /** Segunda parte vacía para una serie con drop: peso a completar, reps = 2º número de "10-10". */
  function blankDrop(reps) {
    const m = String(reps || '').match(/\d+/g);
    return { weight: null, reps: m && m.length > 1 ? Number(m[1]) : (m ? Number(m[0]) : null), side: null, bricks: null };
  }

  /** Volumen de una serie (peso × reps, más la parte drop si la tiene). */
  /** Superseries: rachas de ejercicios CONSECUTIVOS con la misma marca "group".
   *  Devuelve listas de índices; una racha de 1 es un ejercicio normal. */
  function groupRuns(list) {
    const runs = [];
    list.forEach((e, i) => {
      const last = runs[runs.length - 1];
      if (e.group && last && list[last[last.length - 1]].group === e.group) last.push(i);
      else runs.push([i]);
    });
    return runs;
  }

  const setVolume = (st) => (st.weight || 0) * (st.reps || 0) + (st.drop ? (st.drop.weight || 0) * (st.drop.reps || 0) : 0);

  function normSession(s) {
    s = s || {};
    const out = {
      id: s.id ? String(s.id) : uid(),
      created: Number(s.created) || Date.now(),
      updatedAt: Number(s.updatedAt) || 0,                 // marca de tiempo para la sincronización
      date: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : todayStr(),
      dayId: String(s.dayId || ''),
      dayName: String(s.dayName || ''),
      finished: s.finished !== false,
      exercises: (Array.isArray(s.exercises) ? s.exercises : []).map((ex) => {
        const t = (ex && ex.target) || {};
        const w = t.weight == null ? null : Number(t.weight);
        return {
          name: String((ex && ex.name) || 'Ejercicio'),
          done: !!(ex && ex.done),
          drop: !!(ex && ex.drop),             // este ejercicio se registra con drop set
          group: String((ex && ex.group) || ''),   // superserie (misma marca en ejercicios consecutivos)
          usesBar: !!(ex && (ex.usesBar || ex.bar != null)),
          usesBricks: !!(ex && ex.usesBricks) && !(ex.usesBar || ex.bar != null),
          bar: ex && ex.bar != null && Number.isFinite(Number(ex.bar)) ? Number(ex.bar) : null,   // barra elegida ese día (kg)
          target: {
            sets: Number(t.sets) || 0,
            reps: t.reps == null ? '' : String(t.reps),
            weight: Number.isFinite(w) ? w : null,
          },
          sets: (ex && Array.isArray(ex.sets) ? ex.sets : []).map(normSet),
        };
      }),
    };
    const bw = Number(s.bodyweight), fin = Number(s.finishedAt);
    withOptional(out, 'bodyweight', Number.isFinite(bw) && bw > 0 ? bw : null);   // peso corporal ese día (opcional)
    return withOptional(out, 'finishedAt', Number.isFinite(fin) && fin > 0 ? fin : null);   // hora de fin (opcional)
  }

  /** Limpia el mapa de comentarios: claves normalizadas, sin textos vacíos. */
  function normComments(c) {
    const out = {};
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      Object.keys(c).forEach((k) => {
        const v = String(c[k] == null ? '' : c[k]).trim();
        if (v && normName(k)) out[normName(k)] = v.slice(0, 2000);
      });
    }
    return out;
  }

  /** Limpia el registro de peso corporal: fechas válidas, kg razonables, uno por fecha, en orden. */
  function normBodyweights(list) {
    const byDate = new Map();
    (Array.isArray(list) ? list : []).forEach((x) => {
      const kg = Number(x && x.kg);
      if (x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(kg) && kg > 0 && kg < 500) byDate.set(x.date, kg);
    });
    return [...byDate].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, kg]) => ({ date, kg }));
  }

  /** Valida y limpia un objeto con formato rutina.json. Lanza Error en español. */
  function normalize(d) {
    if (!d || typeof d !== 'object') throw new Error('El archivo no es un JSON de rutina válido.');
    const days = d.routine && d.routine.days;
    if (!Array.isArray(days)) throw new Error('Falta "routine.days" en el archivo.');
    return {
      version: 1,
      weightUnit: d.weightUnit || 'kg',
      routineUpdatedAt: Number(d.routineUpdatedAt) || 0,   // marca de tiempo para la sincronización
      // Comentarios por ejercicio para próximas sesiones: { nombreNormalizado: texto }.
      // Viven FUERA de routine.days, así "Importar solo la rutina" no los borra.
      exerciseComments: normComments(d.exerciseComments),
      // Registro de peso corporal [{ date, kg }]: cada valor rige hasta el siguiente. Fuera de routine.
      bodyweights: normBodyweights(d.bodyweights),
      routine: {
        days: days.map((day, i) => ({
          id: String((day && day.id) || uid()),
          name: String((day && day.name) || 'Día ' + (i + 1)),
          exercises: ((day && Array.isArray(day.exercises)) ? day.exercises : []).map(normExercise),
        })),
      },
      sessions: (Array.isArray(d.sessions) ? d.sessions : []).map(normSession),
    };
  }

  /* ---------- persistencia ---------- */

  /** Guarda todo el estado. Se llama después de cada cambio. */
  function commit(silent) {
    let ok = true;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      ok = false;
      if (Store.onSaveError) Store.onSaveError(err);
    }
    // Avisa a cloud.js para que suba los cambios. Los guardados "silenciosos"
    // (los que vienen de la nube) no lo disparan, para no generar un ciclo.
    if (!silent && Store.onCommit) Store.onCommit();
    return ok;
  }

  /** Copia de seguridad local del estado actual (antes de sobrescribirlo). */
  function backup() {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(state)); } catch (e) { /* nada */ }
  }

  /** Carga el seed: primero rutina.json por fetch; si no se puede (por ej. al
   *  abrir index.html con file://), usa seed.js (copia idéntica). */
  async function loadSeed() {
    try {
      const res = await fetch('rutina.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (global.SEED_DATA) return global.SEED_DATA;
      throw new Error('No se pudo cargar rutina.json.');
    }
  }

  /** Inicializa: lee localStorage o, en el primer inicio, carga el seed. */
  async function init() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* sin acceso */ }
    if (raw) {
      try {
        state = normalize(JSON.parse(raw));
        return state;
      } catch (e) {
        // Datos dañados: los guardo aparte y arranco de cero.
        try { localStorage.setItem(KEY + '.corrupt', raw); } catch (e2) { /* nada */ }
      }
    }
    state = normalize(await loadSeed());
    commit();
    return state;
  }

  /* ---------- rutina: días ---------- */

  const find = (arr, id) => arr.find((x) => x.id === id);
  function move(arr, idx, dir) {
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
  }

  function addDay() {
    const day = { id: uid(), name: 'Día ' + (state.routine.days.length + 1), exercises: [] };
    state.routine.days.push(day);
    commit();
    return day;
  }
  function deleteDay(id) {
    state.routine.days = state.routine.days.filter((d) => d.id !== id);
    commit();
  }
  function moveDay(id, dir) {
    move(state.routine.days, state.routine.days.findIndex((d) => d.id === id), dir);
    commit();
  }

  /* ---------- barra: discos por lado ↔ total ---------- */

  const round2 = (n) => Math.round(n * 100) / 100;
  /** Total = barra + 2 × discos por lado. */
  const barTotal = (bar, side) => (side == null || bar == null ? null : round2(bar + 2 * side));
  /** Discos por lado de una serie: el guardado o, si falta (datos viejos), deducido del total. */
  function sideOf(st, bar) {
    if (!st) return null;
    if (st.side != null) return st.side;
    if (st.weight == null || bar == null) return null;
    return st.weight >= bar ? round2((st.weight - bar) / 2) : null;
  }

  /* ---------- bloques: cantidad ↔ total ---------- */

  /** Total de una máquina con bloques: bloques × 5 kg. */
  const bricksTotal = (bricks) => (bricks == null ? null : round2(bricks * BRICK_KG));
  /** Ladrillos de una serie: los guardados o, si faltan (datos viejos), deducidos del total. */
  function bricksOf(st) {
    if (!st) return null;
    if (st.bricks != null) return st.bricks;
    return st.weight != null ? round2(st.weight / BRICK_KG) : null;
  }

  /** Cambia la barra de un ejercicio en la sesión: se conservan los discos por lado
   *  y se recalculan los totales (también los del drop). */
  function setSessionBar(ex, bar) {
    const old = ex.bar;
    ex.bar = bar;
    ex.sets.forEach((st) => {
      st.side = sideOf(st, old);
      if (st.side != null) st.weight = barTotal(bar, st.side);
      if (st.drop) {
        st.drop.side = sideOf(st.drop, old);
        if (st.drop.side != null) st.drop.weight = barTotal(bar, st.drop.side);
      }
    });
    commit();
  }

  /** Barras (kg) ya usadas en un ejercicio, para ofrecerlas como botones. */
  function barsUsed(name) {
    const key = normName(name), out = new Set();
    state.sessions.forEach((s) => s.exercises.forEach((ex) => {
      if (ex.bar != null && normName(ex.name) === key) out.add(ex.bar);
    }));
    return [...out];
  }

  /* ---------- rutina: ejercicios ---------- */

  /** Vincula / desvincula un ejercicio con el SIGUIENTE como superserie. */
  function toggleSuperset(dayId, exId) {
    const day = find(state.routine.days, dayId);
    if (!day) return;
    const list = day.exercises;
    const i = list.findIndex((e) => e.id === exId);
    if (i < 0 || i >= list.length - 1) return;
    const runs = groupRuns(list);
    const run = (k) => runs.find((r) => r.includes(k));
    if (list[i].group && list[i].group === list[i + 1].group) {
      // Desvincular: se corta la racha entre i e i+1 (cada parte con 2+ ejercicios sigue siendo superserie).
      const left = run(i).filter((k) => k <= i), right = run(i).filter((k) => k > i);
      [left, right].forEach((part) => { const g = part.length >= 2 ? uid() : ''; part.forEach((k) => { list[k].group = g; }); });
    } else {
      const g = list[i].group || list[i + 1].group || uid();
      [...run(i), ...run(i + 1)].forEach((k) => { list[k].group = g; });
    }
    commit();
  }

  function addExercise(dayId) {
    const day = find(state.routine.days, dayId);
    if (!day) return null;
    const ex = normExercise({ name: 'Nuevo ejercicio', sets: 3, reps: '10' });
    day.exercises.push(ex);
    commit();
    return ex;
  }
  function deleteExercise(dayId, exId) {
    const day = find(state.routine.days, dayId);
    if (day) { day.exercises = day.exercises.filter((e) => e.id !== exId); commit(); }
  }
  function moveExercise(dayId, exId, dir) {
    const day = find(state.routine.days, dayId);
    if (day) { move(day.exercises, day.exercises.findIndex((e) => e.id === exId), dir); commit(); }
  }

  /* ---------- sesiones ---------- */

  const sortedSessions = () =>
    state.sessions.slice().sort((a, b) => (a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1));

  /** Último registro del ejercicio (por nombre normalizado), excluyendo una sesión.
   *  Prioriza la última sesión del MISMO día de rutina (así "Banco plano" del Día 1
   *  se prellena con lo que hiciste el Día 1, no con el Día 3); si ese día nunca lo
   *  hizo, usa la más reciente de cualquier día. El historial para el gráfico sigue
   *  compartido por nombre. Devuelve { date, dayId, dayName, sets:[...hechas] } o null. */
  function lastEntry(name, excludeId, dayId) {
    const key = normName(name);
    const list = sortedSessions().reverse();
    const search = (onlyDay) => {
      for (const s of list) {
        if (s.id === excludeId) continue;
        if (onlyDay && s.dayId !== dayId) continue;
        for (const ex of s.exercises) {
          if (normName(ex.name) !== key) continue;
          const done = ex.sets.filter((st) => st.done);
          if (done.length) {
            return { date: s.date, dayId: s.dayId, dayName: s.dayName, bar: ex.bar != null ? ex.bar : null,
                     sets: done.map((st) => Object.assign({}, st, { drop: st.drop ? Object.assign({}, st.drop) : null })) };
          }
        }
      }
      return null;
    };
    return (dayId && search(true)) || search(false);
  }

  const firstInt = (txt) => {
    const m = String(txt || '').match(/\d+/);
    return m ? Number(m[0]) : null;
  };

  /** Crea una sesión en curso para el día, prellenando con la última sesión. */
  function startSession(dayId) {
    const day = find(state.routine.days, dayId);
    if (!day) return null;
    const runs = groupRuns(day.exercises);
    const session = {
      id: uid(), created: Date.now(), date: todayStr(),
      dayId: day.id, dayName: day.name, finished: false,
      exercises: day.exercises.map((ex, idx) => {
        const last = lastEntry(ex.name, null, day.id);
        const sets = [];
        // Superserie: los ejercicios de la racha comparten número de series (el mayor) y no usan drop.
        const run = runs.find((r) => r.includes(idx));
        const group = run.length > 1 ? ex.group : '';
        const nSets = run.length > 1 ? Math.max(...run.map((k) => day.exercises[k].sets)) : ex.sets;
        const drop = !group && isDropExercise(ex);
        const lastBar = ex.usesBar && last && last.bar != null ? last.bar : null;
        for (let i = 0; i < nSets; i++) {
          const src = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null;
          const set = {
            weight: src ? src.weight : ex.targetWeight,
            side: null,
            bricks: null,                    // mismo orden de campos que normSet (ver huella de sincronización)
            reps: src ? src.reps : firstInt(ex.reps),
            drop: drop ? (src && src.drop ? Object.assign({}, src.drop) : blankDrop(ex.reps)) : null,
            note: '', done: false,
          };
          if (ex.usesBar) {
            // Con barra se recuerdan los DISCOS por lado. La barra arranca con la última usada
            // en este ejercicio (se cambia al entrenar); sin barra conocida, el total queda pendiente.
            set.side = src ? sideOf(src, lastBar) : null;
            set.weight = set.side != null ? barTotal(lastBar, set.side) : (src ? null : ex.targetWeight);
            if (set.drop) {
              set.drop.side = sideOf(set.drop, lastBar);
              if (set.drop.side != null) set.drop.weight = barTotal(lastBar, set.drop.side);
            }
          } else if (ex.usesBricks) {
            // Máquina con bloques: se recuerdan los LADRILLOS de la última sesión; total = bloques × 5.
            set.bricks = src ? bricksOf(src) : (ex.targetWeight != null ? round2(ex.targetWeight / BRICK_KG) : null);
            set.weight = bricksTotal(set.bricks);
            if (set.drop) {
              set.drop.bricks = bricksOf(set.drop);
              if (set.drop.bricks != null) set.drop.weight = bricksTotal(set.drop.bricks);
            }
          }
          sets.push(set);
        }
        return { name: ex.name, done: false, drop, group, usesBar: !!ex.usesBar,
                 usesBricks: !!ex.usesBricks && !ex.usesBar, bar: lastBar,   // mismo orden que normSession
                 target: { sets: nSets, reps: ex.reps, weight: ex.targetWeight }, sets };
      }),
    };
    state.sessions.push(session);
    commit();
    return session;
  }

  /** Cierra la sesión: descarta series sin marcar y ejercicios vacíos. */
  function finishSession(id) {
    const s = find(state.sessions, id);
    if (!s) return null;
    s.exercises.forEach((ex) => { ex.sets = ex.sets.filter((st) => st.done); });
    s.exercises = s.exercises.filter((ex) => ex.sets.length > 0);
    if (!s.finished && !s.finishedAt) s.finishedAt = Date.now();   // solo la primera vez (no al editar)
    s.finished = true;
    commit();
    return s;
  }

  function deleteSession(id) {
    state.sessions = state.sessions.filter((s) => s.id !== id);
    commit();
  }

  /* ---------- progresión ---------- */

  /** Lista de ejercicios con datos: [{ key, name }] ordenada alfabéticamente. */
  function exerciseNames() {
    const map = new Map();
    sortedSessions().forEach((s) => {
      if (!s.finished) return;
      s.exercises.forEach((ex) => {
        if (ex.sets.some((st) => st.done)) map.set(normName(ex.name), ex.name);  // queda el nombre más reciente
      });
    });
    return Array.from(map, ([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  /** Puntos por sesión terminada: peso máximo y volumen (Σ peso × reps). */
  function progress(key) {
    const points = [];
    let best = null;
    sortedSessions().forEach((s) => {
      if (!s.finished) return;
      let max = 0, maxReps = 0, vol = 0, found = false;
      s.exercises.forEach((ex) => {
        if (normName(ex.name) !== key) return;
        ex.sets.forEach((st) => {
          if (!st.done) return;
          found = true;
          const w = st.weight || 0, r = st.reps || 0;
          vol += setVolume(st);
          if (w > max) { max = w; maxReps = r; } else if (w === max && r > maxReps) maxReps = r;
        });
      });
      if (!found) return;
      points.push({ date: s.date, maxWeight: max, volume: vol });
      if (!best || max > best.weight || (max === best.weight && maxReps > best.reps)) {
        best = { weight: max, reps: maxReps, date: s.date };
      }
    });
    return { points, best };
  }

  /* ---------- comentarios por ejercicio ---------- */

  /** Comentario guardado para un ejercicio (por nombre normalizado, igual que el historial). */
  const getExerciseComment = (name) => (state.exerciseComments || {})[normName(name)] || '';

  /** Guarda (o borra, si queda vacío) el comentario de un ejercicio. Devuelve true si cambió. */
  function setExerciseComment(name, text) {
    const key = normName(name);
    if (!key) return false;
    const v = String(text == null ? '' : text).trim().slice(0, 2000);
    const c = state.exerciseComments || (state.exerciseComments = {});
    if ((c[key] || '') === v) return false;
    if (v) c[key] = v; else delete c[key];
    commit();                                            // se sincroniza junto con la rutina
    return true;
  }

  /* ---------- volumen por sesión, por día y por ciclo ---------- */

  /** Volumen total de una sesión: Σ peso × reps de las series hechas (incluye la parte drop). */
  const sessionVolume = (s) => s.exercises.reduce((a, ex) =>
    a + ex.sets.filter((st) => st.done).reduce((b, st) => b + setVolume(st), 0), 0);

  /** Sesiones terminadas de un día de rutina, en orden: [{ date, volume }]. */
  const dayVolumes = (dayId) => sortedSessions()
    .filter((s) => s.finished && s.dayId === dayId)
    .map((s) => ({ date: s.date, volume: round2(sessionVolume(s)) }));

  /** Ciclos completos: recorre las sesiones terminadas en orden y acumula los días distintos
   *  de la rutina ACTUAL; cuando están todos, cuenta 1 ciclo y reinicia el acumulado.
   *  El volumen del ciclo suma todas las sesiones hechas en ese tramo. */
  function cycles() {
    const dayIds = state.routine.days.map((d) => d.id);
    const total = dayIds.length;
    const list = [];
    if (!total) return { complete: 0, current: 0, total: 0, list };
    let acc = new Set(), tramo = [];
    sortedSessions().forEach((s) => {
      if (!s.finished) return;
      tramo.push(s);
      if (dayIds.includes(s.dayId)) acc.add(s.dayId);
      if (acc.size === total) {
        const volume = round2(tramo.reduce((a, x) => a + sessionVolume(x), 0));
        list.push({ n: list.length + 1, start: tramo[0].date, end: s.date,
                    sessions: tramo.length, volume, avg: round2(volume / tramo.length) });
        acc = new Set(); tramo = [];
      }
    });
    return { complete: list.length, current: acc.size, total, list };
  }

  /* ---------- métricas de Progreso ---------- */

  /** 1RM estimado (fórmula de Epley). Solo con series de 1 a E1RM_MAX_REPS reps. */
  function e1rm(weight, reps) {
    if (!(weight > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
    return reps === 1 ? weight : round2(weight * (1 + reps / 30));
  }

  /** Mejor 1RM estimado de cada sesión terminada de un ejercicio: [{ date, e1rm, weight, reps }].
   *  Usa la parte principal de cada serie (la parte drop se hace con fatiga y no cuenta). */
  function e1rmSeries(key) {
    const out = [];
    sortedSessions().forEach((s) => {
      if (!s.finished) return;
      let best = null;
      s.exercises.forEach((ex) => {
        if (normName(ex.name) !== key) return;
        ex.sets.forEach((st) => {
          const v = st.done ? e1rm(st.weight, st.reps) : null;
          if (v != null && (!best || v > best.e1rm)) best = { date: s.date, e1rm: v, weight: st.weight, reps: st.reps };
        });
      });
      if (best) out.push(best);
    });
    return out;
  }

  /** Récords de un ejercicio: mayor peso, mejor 1RM estimado y mayor volumen en una sesión. */
  function records(key) {
    const { points, best } = progress(key);
    const e = e1rmSeries(key);
    const topE = e.reduce((a, x) => (!a || x.e1rm > a.e1rm ? x : a), null);
    const topV = points.reduce((a, x) => (!a || x.volume > a.volume ? x : a), null);
    return { weight: best, e1rm: topE, volume: topV ? { value: round2(topV.volume), date: topV.date } : null };
  }

  /** "YYYY-MM-DD" de hace n días. */
  function daysAgoStr(n) {
    const d = new Date(); d.setDate(d.getDate() - n);
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /** Ejercicios estancados: entrenados en las últimas STALL_WEEKS semanas pero sin superar
   *  el mejor 1RM estimado de antes. Requiere datos de antes y de después del corte. */
  function stalls() {
    const cut = daysAgoStr(STALL_WEEKS * 7);
    const out = [];
    exerciseNames().forEach(({ key, name }) => {
      const e = e1rmSeries(key);
      const before = e.filter((x) => x.date < cut), after = e.filter((x) => x.date >= cut);
      if (!before.length || !after.length) return;
      const bBefore = Math.max(...before.map((x) => x.e1rm)), bAfter = Math.max(...after.map((x) => x.e1rm));
      if (bAfter <= bBefore) out.push({ key, name, before: bBefore, after: bAfter, sessions: after.length });
    });
    return out;
  }

  /** Lunes (YYYY-MM-DD) de la semana de una fecha. */
  function weekStart(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const p = (x) => String(x).padStart(2, '0');
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
  }

  /** Duración de una sesión en minutos (null si falta la hora de fin o es implausible). */
  function sessionMinutes(s) {
    if (!s.finishedAt || !s.created) return null;
    const m = (s.finishedAt - s.created) / 60000;
    return m >= 1 && m <= MAX_SESSION_MINUTES ? Math.round(m) : null;
  }

  /** Resumen por semana (de lunes a domingo): sesiones, series hechas, volumen,
   *  series efectivas (RIR ≤ EFFECTIVE_RIR_MAX), RIR promedio y duración promedio. */
  function weeklyStats() {
    const map = new Map();
    sortedSessions().forEach((s) => {
      if (!s.finished) return;
      const k = weekStart(s.date);
      const w = map.get(k) || { week: k, sessions: 0, sets: 0, volume: 0, effective: 0, rirSum: 0, rirN: 0, minSum: 0, minN: 0 };
      w.sessions++;
      w.volume += sessionVolume(s);
      s.exercises.forEach((ex) => ex.sets.forEach((st) => {
        if (!st.done) return;
        w.sets++;
        if (st.rir != null) { w.rirN++; w.rirSum += st.rir; if (st.rir <= EFFECTIVE_RIR_MAX) w.effective++; }
      }));
      const mins = sessionMinutes(s);
      if (mins != null) { w.minN++; w.minSum += mins; }
      map.set(k, w);
    });
    return [...map.values()].sort((a, b) => (a.week < b.week ? -1 : 1)).map((w) => ({
      week: w.week, sessions: w.sessions, sets: w.sets, volume: round2(w.volume), effective: w.effective,
      rirN: w.rirN, rirAvg: w.rirN ? round2(w.rirSum / w.rirN) : null, minutesAvg: w.minN ? Math.round(w.minSum / w.minN) : null,
    }));
  }

  /** Músculos de cada ejercicio según la rutina ACTUAL (por nombre normalizado). */
  function muscleMap() {
    const m = new Map();
    state.routine.days.forEach((d) => d.exercises.forEach((e) => {
      const k = normName(e.name);
      if (e.muscles && !m.has(k)) m.set(k, e.muscles);
    }));
    return m;
  }

  /** Series por músculo en una semana: principal = 1, secundario = SECONDARY_MUSCLE_FACTOR.
   *  Los ejercicios sin músculos asignados se suman en "unassigned". */
  function muscleSets(week) {
    const mm = muscleMap(), tot = new Map();
    let unassigned = 0;
    sortedSessions().forEach((s) => {
      if (!s.finished || weekStart(s.date) !== week) return;
      s.exercises.forEach((ex) => {
        const n = ex.sets.filter((st) => st.done).length;
        if (!n) return;
        const mu = mm.get(normName(ex.name));
        if (!mu) { unassigned += n; return; }
        mu.primary.forEach((x) => tot.set(x, (tot.get(x) || 0) + n));
        mu.secondary.forEach((x) => tot.set(x, (tot.get(x) || 0) + n * SECONDARY_MUSCLE_FACTOR));
      });
    });
    return { list: [...tot].map(([muscle, sets]) => ({ muscle, sets: round2(sets) })).sort((a, b) => b.sets - a.sets), unassigned };
  }

  /** Peso corporal registrado en las sesiones: [{ date, kg }] en orden. */
  /** Peso corporal en el tiempo: el registro de Progreso más (por compatibilidad) los pesos
   *  que se hayan cargado dentro de alguna sesión. Si coinciden en fecha, gana el registro. */
  function bodyweightSeries() {
    const byDate = new Map();
    sortedSessions().forEach((s) => { if (s.bodyweight) byDate.set(s.date, s.bodyweight); });
    (state.bodyweights || []).forEach((x) => byDate.set(x.date, x.kg));
    return [...byDate].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, kg]) => ({ date, kg }));
  }

  /** Registra (o corrige) el peso corporal de una fecha. */
  function setBodyweight(date, kg) {
    state.bodyweights = normBodyweights([...(state.bodyweights || []), { date, kg }]);
    commit();                                            // se sincroniza junto con la rutina
  }

  /** Borra el registro de peso de una fecha. */
  function deleteBodyweight(date) {
    state.bodyweights = (state.bodyweights || []).filter((x) => x.date !== date);
    commit();
  }

  /** Último peso corporal registrado en o antes de una fecha (o el primero, si no hay antes). */
  function bodyweightAt(date) {
    const all = bodyweightSeries();
    const prev = all.filter((x) => x.date <= date).pop();
    return prev ? prev.kg : (all[0] ? all[0].kg : null);
  }

  /** Guarda el peso corporal de una sesión (vacío = se borra). Mantiene el orden de campos
   *  de la versión normalizada para no alterar la huella de sincronización. */
  function setSessionBodyweight(s, kg) {
    delete s.bodyweight;
    const fin = s.finishedAt; delete s.finishedAt;
    if (kg != null && kg > 0) s.bodyweight = kg;
    if (fin) s.finishedAt = fin;
    commit();
  }

  /** Guarda el RIR de una serie (vacío = se borra). */
  function setSetRir(st, rir) {
    delete st.rir;
    if (rir != null) st.rir = rir;
    commit();
  }

  /* ---------- exportar / importar ---------- */

  const exportJSON = () => JSON.stringify(state, null, 2);

  /** Valida el texto y devuelve el estado limpio SIN aplicarlo (para confirmar antes). */
  function parseImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('El archivo no es JSON válido.'); }
    return normalize(data);
  }

  /** Reemplaza todo el estado (guardando antes un respaldo del actual). */
  function replaceAll(newState) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(state)); } catch (e) { /* nada */ }
    state = newState;
    commit();
  }

  /** Restaura solo la rutina original conservando el historial. */
  async function resetRoutine() {
    const seed = normalize(await loadSeed());
    replaceAll(Object.assign({}, state, { routine: seed.routine }));
  }

  /* ---------- usados por cloud.js (datos que llegan de la nube) ---------- */

  /** Reemplaza la rutina con la de la nube, sin disparar una nueva subida. */
  function setRoutine(routine, weightUnit, updatedAt, comments, bodyweights) {
    state.routine = normalize({ routine }).routine;
    if (weightUnit) state.weightUnit = weightUnit;
    if (comments !== undefined) state.exerciseComments = normComments(comments);   // si no vienen, se conservan
    if (bodyweights !== undefined) state.bodyweights = normBodyweights(bodyweights); // ídem
    state.routineUpdatedAt = Number(updatedAt) || 0;
    commit(true);
  }

  /** Agrega o reemplaza una sesión que vino de la nube. */
  function upsertSession(raw) {
    const s = normSession(raw);
    const i = state.sessions.findIndex((x) => x.id === s.id);
    if (i >= 0) state.sessions[i] = s; else state.sessions.push(s);
    commit(true);
    return s;
  }

  /** Quita una sesión borrada en otro dispositivo. Devuelve true si existía. */
  function removeSession(id) {
    const n = state.sessions.length;
    state.sessions = state.sessions.filter((s) => s.id !== id);
    if (state.sessions.length === n) return false;
    commit(true);
    return true;
  }

  /** Vuelve al estado inicial (otra persona inició sesión en este dispositivo). */
  async function resetToSeed() {
    backup();
    state = normalize(await loadSeed());
    commit(true);
  }

  /* ---------- importar SOLO la rutina (el historial no se toca) ---------- */

  const ROUTINE_BACKUP_KEY = 'gymapp.v1.routine-backup';

  /** Valida un JSON con la rutina. Acepta el formato completo de rutina.json
   *  ({ routine:{days} }) o solo { days }. Devuelve la rutina limpia SIN aplicarla. */
  function parseRoutineImport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('El texto no es un JSON válido.'); }
    const days = data && (data.routine ? data.routine.days : data.days);
    if (!Array.isArray(days) || !days.length) throw new Error('No encontré días de rutina ("routine.days") en el JSON.');
    if (!days.every((d) => d && Array.isArray(d.exercises))) throw new Error('Cada día tiene que tener una lista "exercises".');
    return normalize({ routine: { days } }).routine;
  }

  /** Reemplaza solo la rutina. Guarda la anterior para poder deshacer. */
  function replaceRoutine(routine) {
    try {
      localStorage.setItem(ROUTINE_BACKUP_KEY, JSON.stringify({ at: Date.now(), routine: state.routine }));
    } catch (e) { /* nada */ }
    state.routine = routine;
    commit();                                  // dispara la subida a la nube
  }

  const hasRoutineBackup = () => { try { return !!localStorage.getItem(ROUTINE_BACKUP_KEY); } catch (e) { return false; } };

  /** Vuelve a la rutina anterior a la última importación. Devuelve true si pudo. */
  function restoreRoutineBackup() {
    try {
      const b = JSON.parse(localStorage.getItem(ROUTINE_BACKUP_KEY));
      state.routine = normalize({ routine: b.routine }).routine;
      localStorage.removeItem(ROUTINE_BACKUP_KEY);
      commit();
      return true;
    } catch (e) { return false; }
  }

  /** CSV (separador ";" y coma decimal para abrir bien en Excel es-AR). */
  function exportCSV() {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const n = (v) => (v == null ? '' : String(v).replace('.', ','));
    const rows = [['Fecha', 'Día', 'Ejercicio', 'Serie', 'Peso (' + state.weightUnit + ')', 'Reps', 'Peso drop (' + state.weightUnit + ')', 'Reps drop', 'Nota'].map(q).join(';')];
    sortedSessions().forEach((s) => {
      if (!s.finished) return;
      s.exercises.forEach((ex) => {
        ex.sets.forEach((st, i) => {
          if (!st.done) return;
          rows.push([q(s.date), q(s.dayName), q(ex.name), i + 1, n(st.weight), n(st.reps),
                     n(st.drop && st.drop.weight), n(st.drop && st.drop.reps), q(st.note)].join(';'));
        });
      });
    });
    return '\ufeff' + rows.join('\r\n');   // BOM para que Excel respete los acentos
  }

  /* ---------- API pública ---------- */

  const Store = {
    init, commit, uid, normName, parseNum, todayStr,
    get state() { return state; },
    sessions: sortedSessions,
    find,
    addDay, deleteDay, moveDay,
    addExercise, deleteExercise, moveExercise,
    BARS, BRICK_KG, MUSCLES, E1RM_MAX_REPS, STALL_WEEKS, SECONDARY_MUSCLE_FACTOR, EFFECTIVE_RIR_MAX,
    e1rm, e1rmSeries, records, stalls, weekStart, weeklyStats, muscleSets, sessionMinutes,
    bodyweightSeries, bodyweightAt, setBodyweight, deleteBodyweight, normBodyweights, setSessionBodyweight, setSetRir, normMuscles,
    isDropExercise, blankDrop, setVolume, groupRuns, toggleSuperset, barTotal, sideOf, setSessionBar, barsUsed,
    bricksTotal, bricksOf, getExerciseComment, setExerciseComment, sessionVolume, dayVolumes, cycles,
    lastEntry, startSession, finishSession, deleteSession,
    exerciseNames, progress,
    exportJSON, parseImport, replaceAll, resetRoutine, exportCSV,
    backup, setRoutine, upsertSession, removeSession, resetToSeed,
    parseRoutineImport, replaceRoutine, hasRoutineBackup, restoreRoutineBackup,
    /** Forma normalizada (para que cloud.js compare CONTENIDO, sin importar orden ni campos vacíos). */
    canonSession: (x) => { const { updatedAt, ...rest } = normSession(x); return rest; },
    canonRoutine: (r) => normalize({ routine: r }).routine,
    normComments,
    onSaveError: null,
    onCommit: null,        // lo asigna cloud.js
  };
  global.Store = Store;
})(window);
