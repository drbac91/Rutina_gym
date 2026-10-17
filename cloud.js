/* ==========================================================================
   cloud.js — Login con Google y sincronización con Firestore
   --------------------------------------------------------------------------
   Es lo ÚNICO que habla con Firebase. Si Firebase no está disponible (sin
   SDK, sin config, abierto con file://) la app sigue funcionando solo local.

   Modelo en la nube (por usuario):
     users/{uid}/routine/main        → { routine, weightUnit, updatedAt }
     users/{uid}/sessions/{id}       → la sesión + updatedAt

   Cómo sincroniza:
   - localStorage sigue siendo la copia local que usa la app (rápida y offline).
   - Cada cambio local se compara con lo último subido (por "hash") y se suben
     solo los documentos que cambiaron (con un pequeño retraso para agrupar).
   - Los cambios que llegan de la nube se aplican si son más nuevos
     (gana el cambio más reciente de cada documento).
   - Lo que se borra en un lado se borra en el otro.
   ========================================================================== */
(function (global) {
  'use strict';
  const S = global.Store;

  const OWNER_KEY = 'gymapp.owner';      // uid dueño de los datos locales
  const PUSHED_KEY = 'gymapp.pushed';    // { clave: hash } de lo ya subido
  const SKIP_KEY = 'gymapp.skipLogin';   // eligió "usar sin cuenta"
  const PUSH_DELAY = 1200;               // ms de espera para agrupar cambios

  const Cloud = {
    available: false,       // hay Firebase y config
    user: null,             // { uid, email, name } si inició sesión
    status: 'off',          // off | syncing | synced | offline | error
    lastError: '',
    skipped: false,
    onChange: null,         // la UI se entera de cambios de login/estado
    onRemote: null,         // la UI se entera de datos nuevos de la nube
    confirm: (msg) => global.confirm(msg),
  };

  let auth = null, db = null, uid = null;
  let unsubs = [];
  let pushed = {};                         // lo último subido: 'routine' y 's:<id>'
  let remoteIds = new Set();               // sesiones que existen en la nube
  let remoteRoutine = null;
  let serverSeen = { routine: false, sessions: false };
  let reconciled = false;                  // ya se hizo la primera conciliación con el servidor
  let pushTimer = null, pendingToken = 0, hasPending = false, hadError = false;

  /* ---------- utilidades ---------- */

  /** Hash corto de un texto (para saber si algo cambió desde la última subida). */
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + str.length.toString(36);
  }
  /** Huella del documento de rutina. Los comentarios por ejercicio entran SOLO si hay alguno:
   *  así, para quien no tiene comentarios la huella es idéntica a la de versiones anteriores
   *  y un dispositivo recién actualizado no cree que su rutina cambió (y no pisa la de la nube). */
  /** Texto canónico: claves ordenadas, sin campos vacíos (null, false, ''), textos en NFC.
   *  Así dos versiones con el mismo CONTENIDO dan la misma huella aunque los campos
   *  estén en otro orden o falte un campo opcional. */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort()
        .filter((k) => v[k] != null && v[k] !== false && v[k] !== '')
        .map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return typeof v === 'string' ? JSON.stringify(v.normalize('NFC')) : JSON.stringify(v);
  }
  /** Huella del documento de rutina (comentarios incluidos si hay alguno). */
  const routineDocHash = (routine, weightUnit, comments) => {
    const doc = { routine: S.canonRoutine(routine), weightUnit: weightUnit || 'kg' };
    if (comments && Object.keys(comments).length) doc.exerciseComments = S.normComments(comments);
    return hash(canon(doc));
  };
  const routineHash = () => routineDocHash(S.state.routine, S.state.weightUnit, S.state.exerciseComments);
  /** Huella de una sesión (sin updatedAt, que es solo la marca de tiempo de la subida). */
  const sessionHash = (s) => hash(canon(S.canonSession(s)));

  /* Huellas de la versión anterior (texto crudo, sensible al orden). Solo se usan UNA vez,
     en la transición, para saber qué estaba realmente sincronizado. */
  const HASH_VERSION = '2';
  const HASHV_KEY = 'gymapp.hashv';
  const CONFLICTS_KEY = 'gymapp.v1.conflicts';
  const oldSessionHash = (s) => { const { updatedAt, ...rest } = s; return hash(JSON.stringify(rest)); };
  const oldRoutineHash = () => {
    const doc = { routine: S.state.routine, weightUnit: S.state.weightUnit };
    const c = S.state.exerciseComments;
    if (c && Object.keys(c).length) doc.exerciseComments = c;
    return hash(JSON.stringify(doc));
  };
  /** Documentos cuya huella vieja no coincidía al pasar a la nueva: se resuelven al ver la nube. */
  let transitional = new Set();

  /** Copia de seguridad local de lo que se reemplaza por la nube en la transición (últimas 20). */
  function backupConflict(kind, data) {
    let list = [];
    try { list = JSON.parse(store.get(CONFLICTS_KEY)) || []; } catch (e) { list = []; }
    list.push({ at: Date.now(), kind, data: JSON.parse(JSON.stringify(data)) });
    store.set(CONFLICTS_KEY, JSON.stringify(list.slice(-20)));
  }
  /** Firma de una rutina ignorando los ids (para detectar la rutina de fábrica). */
  const sig = (r) => JSON.stringify(r.days.map((d) => [d.name, d.exercises.map((e) => [e.name, e.sets, e.reps, e.targetWeight, e.notes])])).normalize('NFC');

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* nada */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* nada */ } },
  };
  const loadPushed = () => { try { return JSON.parse(store.get(PUSHED_KEY)) || {}; } catch (e) { return {}; } };
  const savePushed = () => store.set(PUSHED_KEY, JSON.stringify(pushed));

  const base = () => db.collection('users').doc(uid);
  const routineRef = () => base().collection('routine').doc('main');
  const sessionRef = (id) => base().collection('sessions').doc(id);

  const notify = () => { if (Cloud.onChange) Cloud.onChange(); };
  const notifyRemote = () => { if (Cloud.onRemote) Cloud.onRemote(); };

  function refreshStatus() {
    let s = 'off';
    if (Cloud.user) {
      s = hadError ? 'error'
        : !navigator.onLine ? 'offline'
        : (hasPending || !reconciled) ? 'syncing' : 'synced';
    }
    if (s !== Cloud.status) { Cloud.status = s; notify(); }
  }

  /* ---------- inicio ---------- */

  /** Devuelve una promesa que se resuelve cuando se sabe si hay sesión iniciada. */
  Cloud.init = function () {
    return new Promise((resolve) => {
      const fb = global.firebase, cfg = global.FIREBASE_CONFIG;
      if (!fb || !cfg || !cfg.apiKey || !/^https?:$/.test(location.protocol)) { resolve(); return; }
      try {
        fb.initializeApp(cfg);
        auth = fb.auth();
        db = fb.firestore();
        // Caché offline de Firestore; si el navegador no la soporta, igual funciona.
        Promise.resolve(db.enablePersistence({ synchronizeTabs: true })).catch(() => {});
        Cloud.available = true;
      } catch (e) {
        console.warn('Firebase no se pudo iniciar:', e);
        resolve();
        return;
      }
      Cloud.skipped = store.get(SKIP_KEY) === '1';

      let first = true;
      auth.onAuthStateChanged(async (user) => {
        try {
          if (user) await startSync(user); else stopSync();
        } catch (e) {
          console.error(e);
          Cloud.lastError = e.message || String(e);
          hadError = true;
          refreshStatus();
        }
        if (first) { first = false; resolve(); }
        notify();
      });

      global.addEventListener('online', () => { refreshStatus(); schedulePush(); });
      global.addEventListener('offline', refreshStatus);
      // Al ocultar la app (cambiar de app, bloquear) se sube lo pendiente ya mismo.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pushDiff(); });
    });
  };

  Cloud.signIn = async function () {
    const provider = new global.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await auth.signInWithRedirect(provider);          // plan B si el navegador bloquea el popup
        return;
      }
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      throw e;
    }
  };

  Cloud.signOut = async function () {
    pushDiff();                                           // intenta subir lo pendiente antes de salir
    await auth.signOut();
  };

  Cloud.skip = function () {
    Cloud.skipped = true;
    store.set(SKIP_KEY, '1');
    notify();
  };

  /** Fuerza la subida inmediata (la usa la app al cerrar sesión). */
  Cloud.flush = () => pushDiff();

  /* ---------- sesión iniciada / cerrada ---------- */

  async function startSync(user) {
    stopSync();
    uid = user.uid;
    Cloud.user = { uid: user.uid, email: user.email || '', name: user.displayName || '' };
    Cloud.skipped = false;
    store.del(SKIP_KEY);
    Cloud.lastError = '';
    hadError = false;

    // Si los datos locales son de otra persona, no se mezclan: se parte de cero.
    const owner = store.get(OWNER_KEY);
    if (owner && owner !== uid) {
      await S.resetToSeed();
      pushed = {};
      savePushed();
    } else {
      pushed = owner === uid ? loadPushed() : {};
    }
    store.set(OWNER_KEY, uid);

    // Transición a las huellas por contenido (una sola vez por dispositivo): lo que estaba
    // sincronizado según la huella vieja se marca como sincronizado con la nueva, sin subir nada.
    transitional = new Set();
    if (store.get(HASHV_KEY) !== HASH_VERSION) {
      Object.keys(pushed).forEach((k) => {
        if (k === 'routine') {
          if (pushed.routine === oldRoutineHash()) pushed.routine = routineHash(); else transitional.add('routine');
          return;
        }
        const s = S.find(S.state.sessions, k.slice(2));
        if (!s) return;                                  // borrada acá: se sigue borrando en la nube
        if (pushed[k] === oldSessionHash(s)) pushed[k] = sessionHash(s); else transitional.add(k);
      });
      savePushed();
    }

    S.onCommit = schedulePush;

    unsubs.push(routineRef().onSnapshot({ includeMetadataChanges: true }, onRoutineSnap, onListenError));
    unsubs.push(base().collection('sessions').onSnapshot({ includeMetadataChanges: true }, onSessionsSnap, onListenError));
    refreshStatus();
  }

  function stopSync() {
    unsubs.forEach((u) => { try { u(); } catch (e) { /* nada */ } });
    unsubs = [];
    clearTimeout(pushTimer);
    S.onCommit = null;
    reconciled = false;
    serverSeen = { routine: false, sessions: false };
    remoteIds = new Set();
    remoteRoutine = null;
    hasPending = false;
    Cloud.user = null;
    uid = null;
    refreshStatus();
  }

  function onListenError(err) {
    console.error('Firestore:', err);
    hadError = true;
    Cloud.lastError = err.code === 'permission-denied'
      ? 'Esta cuenta no tiene permiso para guardar datos.'
      : (err.message || String(err));
    refreshStatus();
  }

  /* ---------- datos que llegan de la nube ---------- */

  function onRoutineSnap(snap) {
    if (!snap.metadata.fromCache) serverSeen.routine = true;
    if (!snap.metadata.hasPendingWrites) {               // con cambios pendientes es el eco de lo que escribimos nosotros
      remoteRoutine = snap.exists ? snap.data() : null;
      if (remoteRoutine && reconciled && handleRoutine(remoteRoutine)) notifyRemote();
    }
    maybeReconcile();
  }

  function onSessionsSnap(snap) {
    let changed = false;
    snap.docChanges().forEach((ch) => {
      if (ch.doc.metadata.hasPendingWrites) return;                      // eco de nuestros propios cambios
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        remoteIds.delete(id);
        if (reconciled && S.removeSession(id)) { delete pushed['s:' + id]; changed = true; }
      } else {
        remoteIds.add(id);
        if (applyRemoteSession(id, ch.doc.data())) changed = true;
      }
    });
    snap.docs.forEach((d) => remoteIds.add(d.id));
    if (!snap.metadata.fromCache) serverSeen.sessions = true;
    if (changed) { savePushed(); if (reconciled) notifyRemote(); }
    maybeReconcile();
  }

  /** Aplica una sesión de la nube. Si acá hay cambios sin subir, gana lo local. */
  function applyRemoteSession(id, data) {
    const local = S.find(S.state.sessions, id);
    const k = 's:' + id;
    if (local) {
      const remoteNewer = (Number(data.updatedAt) || 0) > (Number(local.updatedAt) || 0);
      if (pushed[k] !== sessionHash(local)) {
        // Mismo contenido que la nube: ya está sincronizada (no se vuelve a subir).
        if (sessionHash(Object.assign({}, data, { id })) === sessionHash(local)) {
          pushed[k] = sessionHash(local); transitional.delete(k); return false;
        }
        if (!transitional.has(k)) return false;          // edición local real: gana lo local
        transitional.delete(k);
        if (!remoteNewer) return false;                  // la local es la más nueva: se sube
        backupConflict('session', local);                // transición: gana la nube, copia local de respaldo
      } else if (!remoteNewer) return false;
    }
    const s = S.upsertSession(Object.assign({}, data, { id }));
    pushed[k] = sessionHash(s);
    return true;
  }

  /** Decide si la rutina de la nube reemplaza a la local. Devuelve true si la reemplazó. */
  function handleRoutine(data) {
    if (!data || !data.routine || !Array.isArray(data.routine.days)) return false;
    const st = S.state;
    let dirty = pushed.routine !== routineHash();
    const remoteNewer = (Number(data.updatedAt) || 0) > (Number(st.routineUpdatedAt) || 0);
    let take = false;

    // Mismo contenido que la nube (los comentarios solo se comparan si la nube los trae): sincronizada.
    if (dirty && routineDocHash(data.routine, data.weightUnit,
      data.exerciseComments !== undefined ? data.exerciseComments : st.exerciseComments) === routineHash()) {
      pushed.routine = routineHash(); transitional.delete('routine'); savePushed();
      dirty = false;
    }
    if (dirty && transitional.has('routine')) {
      transitional.delete('routine');
      if (!remoteNewer) return false;                    // la local es la más nueva: se sube
      backupConflict('routine', { routine: st.routine, weightUnit: st.weightUnit, exerciseComments: st.exerciseComments });
      dirty = false;                                     // transición: gana la nube (con copia local)
    }

    if (!dirty) {
      take = remoteNewer;
    } else if (global.SEED_DATA && sig(st.routine) === sig(global.SEED_DATA.routine)) {
      take = true;                                       // rutina de fábrica sin tocar: gana la de la nube
    } else if ((Number(st.routineUpdatedAt) || 0) > 0) {
      take = false;                                      // ya sincronizada antes y editada acá: gana lo local
    } else {
      // Rutina personalizada que nunca se subió y la nube ya tiene otra: preguntar.
      take = Cloud.confirm('En la nube ya hay una rutina guardada y en este dispositivo hay otra distinta.\n\nAceptar = usar la de la nube\nCancelar = quedarse con la de este dispositivo y subirla');
      if (take) S.backup();
    }
    if (!take) return false;
    S.setRoutine(data.routine, data.weightUnit, data.updatedAt, data.exerciseComments);   // sin el campo, se conservan los locales
    pushed.routine = routineHash();
    savePushed();
    return true;
  }

  /** Primera conciliación: cuando ya se vio el estado real del servidor. */
  function maybeReconcile() {
    if (reconciled || !serverSeen.routine || !serverSeen.sessions) return;
    reconciled = true;
    let changed = false;

    // Sesiones que ya habíamos subido y ya no están en la nube: se borraron en otro dispositivo.
    S.state.sessions.slice().forEach((s) => {
      const k = 's:' + s.id;
      const clean = pushed[k] === sessionHash(s);
      if (pushed[k] && !remoteIds.has(s.id) && (clean || transitional.has(k))) {
        if (!clean) backupConflict('session', s);        // transición: se respeta el borrado, con copia local
        S.removeSession(s.id);
        delete pushed[k];
        transitional.delete(k);
        changed = true;
      }
    });
    if (remoteRoutine && handleRoutine(remoteRoutine)) changed = true;

    transitional.clear();                               // la transición terminó: de acá en más, reglas normales
    store.set(HASHV_KEY, HASH_VERSION);
    savePushed();
    pushDiff();                                          // sube todo lo local que falte (primer login, cambios offline)
    refreshStatus();
    if (changed) notifyRemote();
  }

  /* ---------- subir cambios ---------- */

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushDiff, PUSH_DELAY);
  }

  /** Sube solo lo que cambió desde la última vez. */
  function pushDiff() {
    clearTimeout(pushTimer);
    if (!Cloud.user || !reconciled) return;
    const st = S.state;
    const ops = [];                                      // { key, ref, data } | { key, ref, del:true }
    const now = Date.now();

    const rh = routineHash();
    if (pushed.routine !== rh) {
      st.routineUpdatedAt = now;
      ops.push({ key: 'routine', hash: rh, ref: routineRef(),
                 data: { routine: st.routine, weightUnit: st.weightUnit, updatedAt: now,
                         exerciseComments: st.exerciseComments || {} } });
    }
    const seen = new Set();
    st.sessions.forEach((s) => {
      const k = 's:' + s.id;
      seen.add(k);
      const h = sessionHash(s);
      if (pushed[k] !== h) {
        s.updatedAt = now;
        ops.push({ key: k, hash: h, ref: sessionRef(s.id), data: JSON.parse(JSON.stringify(s)) });
      }
    });
    Object.keys(pushed).forEach((k) => {
      if (k.startsWith('s:') && !seen.has(k)) ops.push({ key: k, ref: sessionRef(k.slice(2)), del: true });
    });
    if (!ops.length) return;

    // Se marca como subido ya mismo (así un segundo aviso no duplica el trabajo).
    ops.forEach((o) => { if (o.del) delete pushed[o.key]; else pushed[o.key] = o.hash; });
    savePushed();
    S.commit(true);                                      // guarda los updatedAt sin disparar otra subida

    // Firestore permite hasta 500 operaciones por lote; se usan lotes de 400.
    const commits = [];
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach((o) => (o.del ? batch.delete(o.ref) : batch.set(o.ref, o.data)));
      commits.push(batch.commit());
    }

    const token = ++pendingToken;
    hasPending = true;
    refreshStatus();
    Promise.all(commits).then(() => {
      if (token !== pendingToken) return;
      hasPending = false; hadError = false; Cloud.lastError = '';
      refreshStatus();
    }, (err) => {
      console.error('Error al subir:', err);
      ops.forEach((o) => { if (!o.del) delete pushed[o.key]; });   // se reintenta en el próximo cambio
      savePushed();
      hasPending = false; hadError = true;
      Cloud.lastError = err.code === 'permission-denied'
        ? 'Esta cuenta no tiene permiso para guardar datos.'
        : (err.message || String(err));
      refreshStatus();
    });
  }

  global.Cloud = Cloud;
})(window);
