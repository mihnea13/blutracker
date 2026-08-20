// ─── db.js — toate operațiunile Firestore ───────────────────
'use strict';

let _db;

// ── INIT ────────────────────────────────────────────────────

async function dbInit() {
  firebase.initializeApp(FIREBASE_CONFIG);
  _db = firebase.firestore();

  // Persistence offline (esențial pentru PWA)
  try {
    await _db.enablePersistence({ synchronizeTabs: false });
  } catch (e) {
    if (e.code !== 'failed-precondition' && e.code !== 'unimplemented')
      console.warn('Persistence:', e.code);
  }

  // Auth anonim — persistent pe dispozitiv
  const auth = firebase.auth();
  await new Promise((ok, fail) => {
    auth.onAuthStateChanged(user => {
      if (user) { ok(user); return; }
      auth.signInAnonymously().then(c => ok(c.user)).catch(fail);
    });
  });
}

// ── READ ────────────────────────────────────────────────────

async function dbLoadMovies() {
  const snap = await _db.collection('movies').get();
  const out = {};
  snap.forEach(d => { out[d.id] = d.data(); });
  return out;
}

// ── WATCH HISTORY ────────────────────────────────────────────

async function dbAddWatch(id, date) {
  const ref = _db.collection('movies').doc(id);
  await ref.update({
    watchHistory: firebase.firestore.FieldValue.arrayUnion({
      date,
      addedAt: new Date().toISOString(),
    }),
  });
  return (await ref.get()).data();
}

// ── SETUP DISC EXTRAS (prima data cand filmul e marcat vazut) ─

async function dbSetExtras(id, commentaryCount, hasGenericFeatures, genericFeaturesWatched = false) {
  const ref = _db.collection('movies').doc(id);
  const tracks = Array.from({ length: commentaryCount }, () => ({
    watched: false, watchDate: null,
  }));
  await ref.update({
    commentaryTracks: tracks,
    hasGenericFeatures,
    genericFeaturesWatched,
    specialFeatures: [],
  });
  return (await ref.get()).data();
}

// ── COMMENTARY TRACKS ────────────────────────────────────────

async function dbToggleCommentary(id, idx) {
  const ref = _db.collection('movies').doc(id);
  const data = (await ref.get()).data();
  const tracks = [...(data.commentaryTracks || [])];
  if (!tracks[idx]) return data;
  tracks[idx] = {
    watched:   !tracks[idx].watched,
    watchDate: !tracks[idx].watched ? new Date().toISOString().split('T')[0] : null,
  };
  await ref.update({ commentaryTracks: tracks });
  return { ...data, commentaryTracks: tracks };
}

async function dbAddCommentaryTrack(id) {
  const ref = _db.collection('movies').doc(id);
  await ref.update({
    commentaryTracks: firebase.firestore.FieldValue.arrayUnion({
      watched: false, watchDate: null,
    }),
  });
  return (await ref.get()).data();
}

// ── GENERIC FEATURES ─────────────────────────────────────────

async function dbToggleGenericFeatures(id) {
  const ref = _db.collection('movies').doc(id);
  const data = (await ref.get()).data();
  const next = !data.genericFeaturesWatched;
  const upd = {
    genericFeaturesWatched: next,
    genericFeaturesWatchDate: next ? new Date().toISOString().split('T')[0] : null,
  };
  await ref.update(upd);
  return { ...data, ...upd };
}

// ── SPECIAL (NAMED) FEATURES ─────────────────────────────────

async function dbAddSpecialFeature(id, name) {
  const ref = _db.collection('movies').doc(id);
  const featId = 'sf_' + Date.now();
  await ref.update({
    specialFeatures: firebase.firestore.FieldValue.arrayUnion({
      id: featId, name, watched: false, watchDate: null,
    }),
  });
  return (await ref.get()).data();
}

async function dbToggleSpecialFeature(id, featId) {
  const ref = _db.collection('movies').doc(id);
  const data = (await ref.get()).data();
  const feats = (data.specialFeatures || []).map(f => f.id !== featId ? f : {
    ...f,
    watched:   !f.watched,
    watchDate: !f.watched ? new Date().toISOString().split('T')[0] : null,
  });
  await ref.update({ specialFeatures: feats });
  return { ...data, specialFeatures: feats };
}

// ── SYNC ─────────────────────────────────────────────────────

/**
 * Importă collection.json + aplică seed.json pe documentele existente.
 * Apelat la primul sync și la fiecare apăsare a butonului Sync.
 */
async function dbSync(collectionData, seedData, existingMovies) {
  const moviesRef = _db.collection('movies');
  const BATCH_SIZE = 400;
  let batch = _db.batch();
  let ops = 0;
  const flushBatch = async () => { await batch.commit(); batch = _db.batch(); ops = 0; };

  // Filme excluse manual (sterse de user) — nu se re-adauga la sync
  let excludedIds = new Set();
  try {
    const exDoc = await _db.collection('config').doc('excludedIds').get();
    if (exDoc.exists) excludedIds = new Set(exDoc.data().ids || []);
  } catch(e) {}

  // Lookup PRIMAR: blurayComId (sigur, unic)
  // Lookup FALLBACK: grupare pe titlu normalizat (FARA an in cheie) — anul din
  // Firestore vine adesea de la imbogatirea automata cu TMDB (an real, ex 1979),
  // in timp ce scraper-ul aproape mereu are anul gol pe pagina de listare.
  // Compararea stricta "titlu+an" esua sistematic pentru orice film deja imbogatit.
  const byBlurayId = {};
  const titleGroups = {};
  Object.entries(existingMovies).forEach(([docId, m]) => {
    if (m.blurayComId) byBlurayId[m.blurayComId] = docId;
    const norm = normTitle(m.title);
    if (!titleGroups[norm]) titleGroups[norm] = [];
    titleGroups[norm].push({ docId, year: m.year || '' });
  });

  /**
   * - Un singur candidat cu acel titlu -> match direct, indiferent daca anii difera.
   * - Mai multi candidati (ex: Graveyard of Honor 1975+2002) -> anul disambigueaza;
   *   daca nu se potriveste niciunul, film nou (editie diferita).
   * - Mai multi candidati, an necunoscut pe ambele parti -> ambiguu, null (nu ghicim).
   */
  function findExistingMatch(title, year) {
    const norm = normTitle(title);
    const group = titleGroups[norm];
    if (!group || !group.length) return null;
    if (year) {
      const exact = group.find(g => g.year === year);
      if (exact) return exact.docId;
      if (group.length === 1 && !group[0].year) return group[0].docId;
      return null;
    }
    if (group.length === 1) return group[0].docId;
    return null;
  }

  const seedMap = {};
  (seedData || []).forEach(s => { seedMap[normTitle(s.title)] = s; });

  const result = { ...existingMovies };
  let added = 0, updated = 0, skipped = 0, ambiguous = 0;
  const addedTitles = [];

  for (const movie of (collectionData.movies || [])) {
    if (movie.blurayComId && excludedIds.has(movie.blurayComId)) { skipped++; continue; }

    const norm = normTitle(movie.title);
    const existingId = byBlurayId[movie.blurayComId] || findExistingMatch(movie.title, movie.year);
    const seed = seedMap[norm];

    const group = titleGroups[norm];
    if (!existingId && group && group.length > 1) {
      // Ambiguu: mai multi candidati cu acelasi titlu, nu am putut disambigua sigur.
      // Sarim peste (nu cream duplicat gresit) in loc sa ghicim.
      ambiguous++;
      continue;
    }

    if (!existingId) {
      const ref = moviesRef.doc();
      const doc = buildNewMovie(movie, seed);
      batch.set(ref, doc);
      result[ref.id] = doc;
      added++;
      addedTitles.push(movie.title);
    } else {
      const ref = moviesRef.doc(existingId);
      const ex = existingMovies[existingId];
      const upd = {
        isOwned: true,
        lastSynced: ts(),
        blurayComId: movie.blurayComId || ex.blurayComId || '',
        ...(movie.posterUrl ? { posterUrl: movie.posterUrl } : {}),
        ...(movie.year && !ex.year ? { year: movie.year } : {}),
      };
      if (seed && (!ex.commentaryTracks || !ex.commentaryTracks.length)) {
        upd.commentaryTracks = seed.commentaryTracks.map(t => ({
          watched: t.watched, watchDate: null,
        }));
      }
      batch.update(ref, upd);
      result[existingId] = { ...ex, ...upd };
      updated++;
    }

    ops++;
    if (ops >= BATCH_SIZE) await flushBatch();
  }

  if (ops > 0) await flushBatch();
  return { added, updated, skipped, ambiguous, addedTitles, movies: result };
}

/**
 * Seed-only import: creează documente pentru filmele din seed.json
 * care nu au fost găsite în collection.json.
 * Apelat automat la primul sync dacă colecția bluray.com nu e încă disponibilă.
 */
async function dbSeedOnly(seedData, existingMovies) {
  const moviesRef = _db.collection('movies');
  const byNorm = {};
  Object.entries(existingMovies).forEach(([docId, m]) => {
    byNorm[normTitle(m.title)] = docId;
  });

  const result = { ...existingMovies };
  let added = 0;
  const addedTitles = [];

  for (const s of (seedData || [])) {
    if (byNorm[normTitle(s.title)]) continue; // deja există
    const ref = moviesRef.doc();
    const doc = {
      title:                 s.title,
      blurayComId:           '',
      posterUrl:             '',
      isOwned:               true,
      watchHistory:          [{ date: '', note: 'Pre-existent (import seed)', addedAt: ts() }],
      commentaryTracks:      s.commentaryTracks.map(t => ({ watched: t.watched, watchDate: null })),
      hasGenericFeatures:    false,
      genericFeaturesWatched: false,
      specialFeatures:       [],
      lastSynced:            ts(),
      addedAt:               ts(),
    };
    await ref.set(doc);
    result[ref.id] = doc;
    added++;
    addedTitles.push(s.title);
  }

  return { added, addedTitles, movies: result };
}

// ── HELPERS ──────────────────────────────────────────────────

function normTitle(t) {
  return (t || '')
    .normalize('NFKD')              // descompune caractere unicode: "³" → "3", diacritice → litera+accent separat
    .replace(/[\u0300-\u036f]/g, '') // elimina semnele diacritice ramase dupa descompunere
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^the/, '');
}

function ts() { return new Date().toISOString(); }

function buildNewMovie(movie, seed) {
  return {
    title:              movie.title,
    year:               movie.year || '',
    blurayComId:        movie.blurayComId || '',
    posterUrl:          movie.posterUrl   || '',
    isOwned:            true,
    watchHistory:       (movie.watchDates || []).map(d => ({
      date: d, note: 'Import blu-ray.com', addedAt: ts(),
    })),
    commentaryTracks:   seed
      ? seed.commentaryTracks.map(t => ({ watched: t.watched, watchDate: null }))
      : [],
    hasGenericFeatures:    movie.hasFeatures    || false,
    genericFeaturesWatched: movie.featuresWatched || false,
    specialFeatures:       [],
    lastSynced:            ts(),
    addedAt:               ts(),
  };
}

/**
 * Actualizează configurația discului (commentary + features)
 * fără să reseteze trackurile deja bifate.
 * - Dacă newCount > curent: adaugă trackuri noi (goale)
 * - Dacă newCount < curent: șterge de la final (doar cele nevăzute)
 * - hasGenericFeatures: setează toggle-ul
 */
async function dbUpdateDisc(id, newCommCount, hasGenericFeatures) {
  const ref  = _db.collection('movies').doc(id);
  const data = (await ref.get()).data();
  const existing = data.commentaryTracks || [];
  const curCount = existing.length;

  let tracks = [...existing];

  if (newCommCount > curCount) {
    // Adaugă trackuri noi
    for (let i = curCount; i < newCommCount; i++) {
      tracks.push({ watched: false, watchDate: null });
    }
  } else if (newCommCount < curCount) {
    // Scurtează — păstrează cele watched, taie de la final
    tracks = tracks.slice(0, newCommCount);
  }

  const upd = {
    commentaryTracks:   tracks,
    hasGenericFeatures: hasGenericFeatures,
  };
  // Dacă features a fost dezactivat, resetează și watched-ul
  if (!hasGenericFeatures) upd.genericFeaturesWatched = false;

  await ref.update(upd);
  return { ...data, ...upd };
}

/**
 * Sterge o intrare specifica din watchHistory.
 * entry trebuie sa fie obiectul exact (cu addedAt) pentru arrayRemove.
 */
async function dbRemoveWatch(id, entry) {
  const ref = _db.collection('movies').doc(id);
  await ref.update({
    watchHistory: firebase.firestore.FieldValue.arrayRemove(entry)
  });
  return (await ref.get()).data();
}

/**
 * Salveaza date TMDB in Firestore.
 */
async function dbSaveTmdb(id, tmdb) {
  const ref = _db.collection('movies').doc(id);
  await ref.update(tmdb);
  return (await ref.get()).data();
}

/**
 * Sterge definitiv un film din Firestore.
 * Daca filmul are blurayComId, il adauga la lista de excluse,
 * ca sa nu fie re-adaugat automat la urmatorul sync cu blu-ray.com.
 */
async function dbDeleteMovie(id, excludeFromSync = true) {
  const ref = _db.collection('movies').doc(id);
  const doc = await ref.get();
  const data = doc.data();
  await ref.delete();

  // excludeFromSync=false se foloseste cand stergi o COPIE DUPLICATA — filmul
  // legitim trebuie sa ramana sincronizabil. Daca s-ar adauga pe lista de excluse,
  // ar fi blocat permanent la toate sincronizarile viitoare.
  if (excludeFromSync && data?.blurayComId) {
    try {
      await _db.collection('config').doc('excludedIds').set({
        ids: firebase.firestore.FieldValue.arrayUnion(data.blurayComId)
      }, { merge: true });
    } catch(e) { console.warn('Nu s-a putut salva exclusion list:', e); }
  }
}

/**
 * Editeaza data unei intrari specifice din watchHistory (dupa index).
 */
async function dbEditWatchDate(id, idx, newDate) {
  const ref = _db.collection('movies').doc(id);
  const data = (await ref.get()).data();
  const wh = [...(data.watchHistory||[])];
  if (!wh[idx]) throw new Error('Intrare inexistenta');
  wh[idx] = { ...wh[idx], date: newDate };
  await ref.update({ watchHistory: wh });
  return { ...data, watchHistory: wh };
}

/**
 * Elimina un blurayComId din lista de excluse — filmul va putea
 * fi re-adaugat la urmatorul sync daca mai exista pe blu-ray.com.
 */
async function dbUnexclude(blurayComId) {
  if (!blurayComId) return;
  await _db.collection('config').doc('excludedIds').set({
    ids: firebase.firestore.FieldValue.arrayRemove(blurayComId)
  }, { merge: true });
}

/**
 * Returneaza lista curenta de blurayComId excluse (pentru afisare in UI).
 */
async function dbGetExcludedIds() {
  try {
    const doc = await _db.collection('config').doc('excludedIds').get();
    return doc.exists ? (doc.data().ids || []) : [];
  } catch(e) { return []; }
}
