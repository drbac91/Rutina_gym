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

  /* ---------- utilidades ---------- */

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Nombre normalizado: sin tildes, minúsculas, espacios simples.
   *  Es la clave para que "Banco plano" de Día 1 y Día 3 compartan historial. */
  const normName = (s) =>
    String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
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
    const sets = parseInt(e.sets, 10);
    const tw = e.targetWeight == null ? null : Number(e.targetWeight);
    return {
      id: e.id ? String(e.id) : uid(),
      name: String(e.name || '').trim() || 'Ejercicio',
      sets: sets >= 1 ? sets : 3,
      reps: e.reps == null ? '' : String(e.reps),
      targetWeight: Number.isFinite(tw) && tw >= 0 ? tw : null,
      notes: String(e.notes || ''),
      original: String(e.original || ''),
    };
  }

  function normSet(s) {
    s = s || {};
    const w = s.weight == null ? null : Number(s.weight);
    const r = s.reps == null ? null : Number(s.reps);
    return {
      weight: Number.isFinite(w) && w >= 0 ? w : null,
      reps: Number.isFinite(r) && r >= 0 ? r : null,
      note: String(s.note || ''),
      done: s.done !== false,          // datos viejos sin "done" cuentan como hechos
    };
  }

  function normSession(s) {
    s = s || {};
    return {
      id: s.id ? String(s.id) : uid(),
      created: Number(s.created) || Date.now(),
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
          target: {
            sets: Number(t.sets) || 0,
            reps: t.reps == null ? '' : String(t.reps),
            weight: Number.isFinite(w) ? w : null,
          },
          sets: (ex && Array.isArray(ex.sets) ? ex.sets : []).map(normSet),
        };
      }),
    };
  }

  /** Valida y limpia un objeto con formato rutina.json. Lanza Error en español. */
  function normalize(d) {
    if (!d || typeof d !== 'object') throw new Error('El archivo no es un JSON de rutina válido.');
    const days = d.routine && d.routine.days;
    if (!Array.isArray(days)) throw new Error('Falta "routine.days" en el archivo.');
    return {
      version: 1,
      weightUnit: d.weightUnit || 'kg',
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
  function commit() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      if (Store.onSaveError) Store.onSaveError(err);
      return false;
    }
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

  /* ---------- rutina: ejercicios ---------- */

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
   *  Devuelve { date, sets:[...hechas] } o null. */
  function lastEntry(name, excludeId) {
    const key = normName(name);
    const list = sortedSessions().reverse();
    for (const s of list) {
      if (s.id === excludeId) continue;
      for (const ex of s.exercises) {
        if (normName(ex.name) !== key) continue;
        const done = ex.sets.filter((st) => st.done);
        if (done.length) return { date: s.date, sets: done.map((st) => Object.assign({}, st)) };
      }
    }
    return null;
  }

  const firstInt = (txt) => {
    const m = String(txt || '').match(/\d+/);
    return m ? Number(m[0]) : null;
  };

  /** Crea una sesión en curso para el día, prellenando con la última sesión. */
  function startSession(dayId) {
    const day = find(state.routine.days, dayId);
    if (!day) return null;
    const session = {
      id: uid(), created: Date.now(), date: todayStr(),
      dayId: day.id, dayName: day.name, finished: false,
      exercises: day.exercises.map((ex) => {
        const last = lastEntry(ex.name);
        const sets = [];
        for (let i = 0; i < ex.sets; i++) {
          const src = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null;
          sets.push({
            weight: src ? src.weight : ex.targetWeight,
            reps: src ? src.reps : firstInt(ex.reps),
            note: '', done: false,
          });
        }
        return { name: ex.name, done: false,
                 target: { sets: ex.sets, reps: ex.reps, weight: ex.targetWeight }, sets };
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
          vol += w * r;
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

  /** CSV (separador ";" y coma decimal para abrir bien en Excel es-AR). */
  function exportCSV() {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const n = (v) => (v == null ? '' : String(v).replace('.', ','));
    const rows = [['Fecha', 'Día', 'Ejercicio', 'Serie', 'Peso (' + state.weightUnit + ')', 'Reps', 'Nota'].map(q).join(';')];
    sortedSessions().forEach((s) => {
      if (!s.finished) return;
      s.exercises.forEach((ex) => {
        ex.sets.forEach((st, i) => {
          if (!st.done) return;
          rows.push([q(s.date), q(s.dayName), q(ex.name), i + 1, n(st.weight), n(st.reps), q(st.note)].join(';'));
        });
      });
    });
    return '﻿' + rows.join('\r\n');   // BOM para que Excel respete los acentos
  }

  /* ---------- API pública ---------- */

  const Store = {
    init, commit, uid, normName, parseNum, todayStr,
    get state() { return state; },
    sessions: sortedSessions,
    find,
    addDay, deleteDay, moveDay,
    addExercise, deleteExercise, moveExercise,
    lastEntry, startSession, finishSession, deleteSession,
    exerciseNames, progress,
    exportJSON, parseImport, replaceAll, resetRoutine, exportCSV,
    onSaveError: null,
  };
  global.Store = Store;
})(window);
