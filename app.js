// ─── app.js — BluTracker PWA ─────────────────────────────────
'use strict';

// ════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════
const S = {
  movies:   {},                                     // { [firestoreId]: movieData }
  tab:      'unwatched',
  view:     localStorage.getItem('bt_view') || 'grid',
  expanded: new Set(),                              // id-uri secțiuni deschise
  loading:  true,
};

// ════════════════════════════════════════════════════
// SHORTCUTS
// ════════════════════════════════════════════════════
const $     = s => document.querySelector(s);
const $$    = s => [...document.querySelectorAll(s)];
const mk    = (tag, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls)  e.className   = cls;
  if (text) e.textContent = text;
  return e;
};
const esc   = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date().toISOString().split('T')[0];
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO') : '';

// ════════════════════════════════════════════════════
// COMPUTED
// ════════════════════════════════════════════════════
const list     = () => Object.entries(S.movies).map(([id, m]) => ({ id, ...m }));
const alpha    = arr => arr.sort((a, b) => a.title.localeCompare(b.title));
const unwatched = () => alpha(list().filter(m => !m.watchHistory?.length));
const watched   = () => alpha(list().filter(m =>  m.watchHistory?.length));
const withComm  = () => list().filter(m => m.commentaryTracks?.length > 0);
const withFeat  = () => list().filter(m => m.hasGenericFeatures || m.specialFeatures?.length > 0);

const commStatus = m => {
  const t = m.commentaryTracks || [];
  if (!t.length) return null;
  const w = t.filter(x => x.watched).length;
  return w === t.length ? 'done' : w > 0 ? 'partial' : 'pending';
};

const pendingComm = () => withComm().filter(m => {
  const t = m.commentaryTracks || [];
  return t.some(x => !x.watched);
});

// ════════════════════════════════════════════════════
// RENDER DISPATCH
// ════════════════════════════════════════════════════
function render() {
  const main = $('#main');
  main.scrollTop = 0;
  switch (S.tab) {
    case 'unwatched':    renderUnwatched(main);    break;
    case 'watched':      renderWatched(main);      break;
    case 'commentaries': renderCommentaries(main); break;
    case 'features':     renderFeatures(main);     break;
  }
  syncNav();
  syncViewBtn();
}

// ════════════════════════════════════════════════════
// TOOLBAR helper
// ════════════════════════════════════════════════════
function toolbar(titleText, ...actionEls) {
  const bar = mk('div', 'toolbar');
  const t = mk('h2', 'toolbar__title', titleText);
  const acts = mk('div', 'toolbar__actions');
  actionEls.forEach(e => acts.appendChild(e));
  bar.appendChild(t);
  bar.appendChild(acts);
  return bar;
}

function emptyState(icon, text) {
  const d = mk('div', 'empty');
  d.innerHTML = `<div class="empty__icon">${icon}</div><p class="empty__text">${esc(text)}</p>`;
  return d;
}

// ════════════════════════════════════════════════════
// TAB: UNWATCHED
// ════════════════════════════════════════════════════
function renderUnwatched(main) {
  main.innerHTML = '';
  const movies = unwatched();
  main.appendChild(toolbar(`📽 Nevăzute (${movies.length})`));

  if (!movies.length) {
    main.appendChild(emptyState('🎉', 'Toate filmele au fost vizionate!'));
    return;
  }

  const grid = mk('div', S.view === 'grid' ? 'grid' : 'grid list');
  movies.forEach(m => {
    const card = movieCard(m);
    const btn = mk('button', 'btn btn--primary btn--full', '▶ Marchează văzut');
    btn.onclick = e => { e.stopPropagation(); openMarkWatchedModal(m.id); };
    card.querySelector('.card__actions').appendChild(btn);
    grid.appendChild(card);
  });
  main.appendChild(grid);
}

// ════════════════════════════════════════════════════
// TAB: WATCHED
// ════════════════════════════════════════════════════
function renderWatched(main) {
  main.innerHTML = '';
  const movies = watched();
  main.appendChild(toolbar(`✓ Văzute (${movies.length})`));

  if (!movies.length) {
    main.appendChild(emptyState('📼', 'Niciun film marcat ca văzut.'));
    return;
  }

  const grid = mk('div', S.view === 'grid' ? 'grid' : 'grid list');
  movies.forEach(m => {
    const card = movieCard(m);
    const meta = card.querySelector('.card__meta');

    // Badge count
    const badge = mk('span', 'badge badge--green', `✓ ${m.watchHistory.length}×`);
    meta.appendChild(badge);

    // Last watch date
    const dates = m.watchHistory.map(w => new Date(w.date + 'T00:00:00')).sort((a, b) => b - a);
    if (dates.length && dates[0].getFullYear() > 2000) {
      meta.appendChild(mk('span', 'card__date', dates[0].toLocaleDateString('ro-RO')));
    }

    // Actions
    const acts = card.querySelector('.card__actions');
    const hist = mk('button', 'btn btn--ghost btn--sm', '📋 Istoric');
    hist.onclick = e => { e.stopPropagation(); openHistoryModal(m.id); };
    const add = mk('button', 'btn btn--primary btn--sm', '+ Vizionare');
    add.onclick = e => { e.stopPropagation(); openAddWatchModal(m.id); };
    acts.appendChild(hist);
    acts.appendChild(add);

    grid.appendChild(card);
  });
  main.appendChild(grid);
}

// ════════════════════════════════════════════════════
// TAB: COMMENTARIES
// ════════════════════════════════════════════════════
function renderCommentaries(main) {
  main.innerHTML = '';

  const rndBtn = mk('button', 'btn btn--accent btn--sm', '🎲 Random');
  rndBtn.onclick = pickRandom;
  main.appendChild(toolbar('🎙 Commentary Tracks', rndBtn));

  const movies = withComm();
  if (!movies.length) {
    main.appendChild(emptyState('🎙', 'Niciun film cu commentary tracks.\nMarchează un film ca văzut și setează tracks.'));
    return;
  }

  // Sort: pending → partial → done
  const order = { pending: 0, partial: 1, done: 2 };
  movies.sort((a, b) => {
    const sa = order[commStatus(a)] ?? 3;
    const sb = order[commStatus(b)] ?? 3;
    return sa - sb || a.title.localeCompare(b.title);
  });

  movies.forEach(m => main.appendChild(commSection(m)));
}

function commSection(m) {
  const status  = commStatus(m);
  const tracks  = m.commentaryTracks || [];
  const nWatched = tracks.filter(t => t.watched).length;
  const key     = `comm-${m.id}`;
  const open    = S.expanded.has(key);

  const section = mk('div', `collapsible${open ? ' collapsible--open' : ''}`);
  section.id = key;

  // Header
  const header = mk('div', 'collapsible__header');
  header.innerHTML = `
    <div class="collapsible__title">
      <span class="status-dot status-dot--${status}"></span>
      <span class="collapsible__name">${esc(m.title)}</span>
    </div>
    <div class="collapsible__meta">
      <span class="badge badge--${status === 'done' ? 'green' : status === 'partial' ? 'amber' : 'red'}">
        ${nWatched}/${tracks.length}
      </span>
      <span class="caret">${open ? '▲' : '▼'}</span>
    </div>`;
  header.onclick = () => { toggle(key); render(); };

  // Body
  const body = mk('div', 'collapsible__body');
  if (open) {
    tracks.forEach((t, i) => {
      const row = mk('div', `track-row${t.watched ? ' track-row--watched' : ''}`);
      const chk = mk('button', `track-check${t.watched ? ' track-check--on' : ''}`, t.watched ? '✓' : '');
      chk.onclick = () => doToggleCommentary(m.id, i);
      const lbl  = mk('span', 'track-label', `Commentary ${i + 1}`);
      const dt   = mk('span', 'track-date', t.watchDate ? fmtDate(t.watchDate) : '');
      row.append(chk, lbl, dt);
      body.appendChild(row);
    });

    const addBtn = mk('button', 'btn btn--ghost btn--sm track-add-btn', '+ Track nou');
    addBtn.onclick = () => doAddCommentaryTrack(m.id);
    body.appendChild(addBtn);
  }

  section.append(header, body);
  return section;
}

// ════════════════════════════════════════════════════
// TAB: FEATURES
// ════════════════════════════════════════════════════
function renderFeatures(main) {
  main.innerHTML = '';
  main.appendChild(toolbar('🎞 Extras & Features'));

  const movies = withFeat();
  if (!movies.length) {
    main.appendChild(emptyState('🎞', 'Niciun film cu features.\nMarchează un film ca văzut și bifează "Has features".'));
    return;
  }

  // Sort: pending → done
  movies.sort((a, b) => {
    const da = allFeatDone(a) ? 1 : 0;
    const db = allFeatDone(b) ? 1 : 0;
    return da - db || a.title.localeCompare(b.title);
  });

  movies.forEach(m => main.appendChild(featSection(m)));
}

function allFeatDone(m) {
  const spec = m.specialFeatures || [];
  return (!m.hasGenericFeatures || m.genericFeaturesWatched)
    && spec.every(f => f.watched);
}

function featSection(m) {
  const done = allFeatDone(m);
  const spec = m.specialFeatures || [];
  const key  = `feat-${m.id}`;
  const open = S.expanded.has(key);

  const section = mk('div', `collapsible${open ? ' collapsible--open' : ''}`);

  const header = mk('div', 'collapsible__header');
  header.innerHTML = `
    <div class="collapsible__title">
      <span class="status-dot status-dot--${done ? 'done' : 'pending'}"></span>
      <span class="collapsible__name">${esc(m.title)}</span>
    </div>
    <div class="collapsible__meta">
      <span class="badge badge--${done ? 'green' : 'amber'}">${done ? 'Complet ✓' : 'Pending'}</span>
      <span class="caret">${open ? '▲' : '▼'}</span>
    </div>`;
  header.onclick = () => { toggle(key); render(); };

  const body = mk('div', 'collapsible__body');
  if (open) {
    // Generic features row
    if (m.hasGenericFeatures) {
      const row = mk('div', `track-row${m.genericFeaturesWatched ? ' track-row--watched' : ''}`);
      const chk = mk('button', `track-check${m.genericFeaturesWatched ? ' track-check--on' : ''}`, m.genericFeaturesWatched ? '✓' : '');
      chk.onclick = () => doToggleGenericFeatures(m.id);
      row.append(chk, mk('span', 'track-label', '🎬 Extras generice'));
      body.appendChild(row);
    }

    // Special / named features
    spec.forEach(f => {
      const row = mk('div', `track-row track-row--special${f.watched ? ' track-row--watched' : ''}`);
      const chk = mk('button', `track-check${f.watched ? ' track-check--on' : ''}`, f.watched ? '✓' : '');
      chk.onclick = () => doToggleSpecialFeature(m.id, f.id);
      const lbl  = mk('span', 'track-label');
      lbl.innerHTML = `<span class="feat-star">★</span> ${esc(f.name)}`;
      const dt = mk('span', 'track-date', f.watchDate ? fmtDate(f.watchDate) : '');
      row.append(chk, lbl, dt);
      body.appendChild(row);
    });

    const addBtn = mk('button', 'btn btn--ghost btn--sm track-add-btn', '+ Feature special');
    addBtn.onclick = () => openAddFeatureModal(m.id);
    body.appendChild(addBtn);
  }

  section.append(header, body);
  return section;
}

// ════════════════════════════════════════════════════
// MOVIE CARD
// ════════════════════════════════════════════════════
function movieCard(m) {
  const card = mk('div', 'card');
  card.dataset.id = m.id;

  const poster = mk('div', 'card__poster');
  const img = mk('img');
  img.alt    = m.title;
  img.loading = 'lazy';
  img.src    = m.posterUrl || posterPlaceholder(m.title);
  img.onerror = () => { img.src = posterPlaceholder(m.title); };
  poster.appendChild(img);

  const info    = mk('div', 'card__info');
  const title   = mk('h3', 'card__title', m.title);
  const meta    = mk('div', 'card__meta');
  const actions = mk('div', 'card__actions');
  info.append(title, meta, actions);
  card.append(poster, info);
  return card;
}

function posterPlaceholder(title) {
  const init = title.trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]).join('').toUpperCase();
  const hue  = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const svg  = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="290">
    <rect width="200" height="290" fill="hsl(${hue},30%,16%)"/>
    <text x="100" y="158" text-anchor="middle" fill="rgba(255,255,255,0.35)"
      font-family="system-ui" font-size="56" font-weight="700">${init}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ════════════════════════════════════════════════════
// MODAL ENGINE
// ════════════════════════════════════════════════════
function openModal(title, bodyHTML, footerHTML) {
  const overlay = $('#overlay');
  $('#modal').innerHTML = `
    <div class="modal__header">
      <span class="modal__title">${esc(title)}</span>
      <button class="modal__close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal__body">${bodyHTML}</div>
    <div class="modal__footer">${footerHTML}</div>`;
  overlay.classList.add('overlay--visible');
  // focus first input
  setTimeout(() => {
    const inp = $('#modal input, #modal textarea, #modal select');
    if (inp) inp.focus();
  }, 50);
}

function closeModal() {
  $('#overlay').classList.remove('overlay--visible');
}

// ── MODAL: Mark Watched (first time) ────────────────

function openMarkWatchedModal(id) {
  const m = S.movies[id];
  openModal(
    'Marchează ca văzut',
    `<p class="modal__subtitle">${esc(m.title)}</p>
     <div class="field">
       <label>Data vizionării</label>
       <input type="date" id="mw-date" value="${today()}">
     </div>
     <div class="field">
       <label>Commentary tracks</label>
       <div class="num-row">
         <button class="num-btn" onclick="adjNum('mw-comm',-1)">−</button>
         <input type="number" id="mw-comm" value="0" min="0" max="20" class="num-input">
         <button class="num-btn" onclick="adjNum('mw-comm', 1)">+</button>
       </div>
     </div>
     <div class="field">
       <div class="toggle-row">
         <div>
           <span class="toggle-label">Are extras / features</span>
         </div>
         <button class="toggle" id="mw-feat-toggle" onclick="toggleBtn(this)"></button>
       </div>
     </div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="confirmMarkWatched('${id}')">✓ Confirmă</button>`
  );
}

async function confirmMarkWatched(id) {
  const date     = $('#mw-date').value || today();
  const commN    = parseInt($('#mw-comm').value) || 0;
  const hasFeat  = $('#mw-feat-toggle').classList.contains('toggle--on');
  closeModal();
  showToast('Se salvează…');
  try {
    let data = await dbAddWatch(id, date);
    if (commN > 0 || hasFeat) {
      data = await dbSetExtras(id, commN, hasFeat);
    }
    S.movies[id] = data;
    render();
    showToast(`${S.movies[id].title} — marcat văzut 🎬`, 'success');
  } catch (e) {
    showToast('Eroare: ' + e.message, 'error');
  }
}

// ── MODAL: Add watch (subsequent) ───────────────────

function openAddWatchModal(id) {
  const m = S.movies[id];
  const n = (m.watchHistory?.length || 0) + 1;
  openModal(
    `+ Vizionare nouă (#${n})`,
    `<p class="modal__subtitle">${esc(m.title)}</p>
     <div class="field">
       <label>Data</label>
       <input type="date" id="aw-date" value="${today()}">
     </div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="confirmAddWatch('${id}')">✓ Adaugă</button>`
  );
}

async function confirmAddWatch(id) {
  const date = $('#aw-date').value || today();
  closeModal();
  try {
    S.movies[id] = await dbAddWatch(id, date);
    render();
    showToast('Vizionare adăugată ✓', 'success');
  } catch (e) { showToast('Eroare: ' + e.message, 'error'); }
}

// ── MODAL: Watch history ─────────────────────────────

function openHistoryModal(id) {
  const m = S.movies[id];
  const history = [...(m.watchHistory || [])]
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const rows = history.map((w, i) => `
    <div class="history-item">
      <div>
        <div class="history-date">${fmtDate(w.date) || '—'}</div>
        ${w.note ? `<div class="history-note">${esc(w.note)}</div>` : ''}
      </div>
      <span class="history-num">#${i + 1}</span>
    </div>`).join('');

  openModal(
    'Istoricul vizionărilor',
    `<p class="modal__subtitle">${esc(m.title)}</p>
     ${rows || '<p class="modal__empty">Niciun watch înregistrat</p>'}`,
    `<button class="btn btn--ghost" onclick="closeModal()">Închide</button>
     <button class="btn btn--primary" onclick="closeModal();openAddWatchModal('${id}')">+ Adaugă</button>`
  );
}

// ── MODAL: Add special feature ───────────────────────

function openAddFeatureModal(id) {
  const m = S.movies[id];
  openModal(
    '+ Feature special',
    `<p class="modal__subtitle">${esc(m.title)}</p>
     <div class="field">
       <label>Denumire feature</label>
       <input type="text" id="af-name" placeholder="ex: Heart of Darkness (1991)">
     </div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="confirmAddFeature('${id}')">✓ Adaugă</button>`
  );
}

async function confirmAddFeature(id) {
  const name = $('#af-name').value.trim();
  if (!name) { showToast('Introdu o denumire.', 'error'); return; }
  closeModal();
  try {
    S.movies[id] = await dbAddSpecialFeature(id, name);
    render();
    showToast(`Feature adăugat: ${name}`, 'success');
  } catch (e) { showToast('Eroare: ' + e.message, 'error'); }
}

// ── Modal toggle helper ──────────────────────────────

function toggleBtn(btn) {
  btn.classList.toggle('toggle--on');
}
function adjNum(id, d) {
  const inp = document.getElementById(id);
  const v   = (parseInt(inp.value) || 0) + d;
  inp.value = Math.max(0, Math.min(20, v));
}

// ════════════════════════════════════════════════════
// ASYNC ACTIONS
// ════════════════════════════════════════════════════

async function doToggleCommentary(id, idx) {
  try {
    S.movies[id] = await dbToggleCommentary(id, idx);
    render();
  } catch (e) { showToast('Eroare: ' + e.message, 'error'); }
}

async function doAddCommentaryTrack(id) {
  try {
    S.movies[id] = await dbAddCommentaryTrack(id);
    render();
    showToast('Track adăugat ✓', 'success');
  } catch (e) { showToast('Eroare: ' + e.message, 'error'); }
}

async function doToggleGenericFeatures(id) {
  try {
    S.movies[id] = await dbToggleGenericFeatures(id);
    render();
  } catch (e) { showToast('Eroare: ' + e.message, 'error'); }
}

async function doToggleSpecialFeature(id, featId) {
  try {
    S.movies[id] = await dbToggleSpecialFeature(id, featId);
    render();
  } catch (e) { showToast('Eroare: ' + e.message, 'error'); }
}

// ════════════════════════════════════════════════════
// SYNC
// ════════════════════════════════════════════════════
async function doSync() {
  const btn = $('#btn-sync');
  btn.textContent = '⏳';
  btn.disabled    = true;

  try {
    const [colResp, seedResp] = await Promise.all([
      fetch('./data/collection.json?t=' + Date.now()),
      fetch('./data/seed.json?t='       + Date.now()),
    ]);
    const colData  = await colResp.json();
    const seedData = await seedResp.json();

    if (colData.movies?.length) {
      const { added, updated, movies } = await dbSync(colData, seedData, S.movies);
      S.movies = movies;
      showToast(`Sync OK — ${added} noi, ${updated} actualizate ✓`, 'success');
    } else {
      // collection.json e gol → aplică doar seed-ul
      const { added, movies } = await dbSeedOnly(seedData, S.movies);
      S.movies = movies;
      showToast(`Seed importat — ${added} filme adăugate ✓`, 'success');
    }

    render();
  } catch (e) {
    showToast('Sync eșuat: ' + e.message, 'error');
  } finally {
    btn.textContent = '⟳';
    btn.disabled    = false;
  }
}

// ════════════════════════════════════════════════════
// RANDOM COMMENTARY PICKER
// ════════════════════════════════════════════════════
function pickRandom() {
  const pending = pendingComm();
  if (!pending.length) {
    showToast('Toate commentary-urile sunt văzute! 🎉');
    return;
  }
  const pick  = pending[Math.floor(Math.random() * pending.length)];
  const key   = `comm-${pick.id}`;
  S.tab = 'commentaries';
  S.expanded.add(key);
  render();

  // Scroll + flash
  requestAnimationFrame(() => {
    const el = document.getElementById(key);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    }
  });
  showToast(`🎲 ${pick.title}`, 'success');
}

// ════════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════════
function toggle(key) {
  S.expanded.has(key) ? S.expanded.delete(key) : S.expanded.add(key);
}

function switchTab(tab) {
  S.tab = tab;
  render();
}

function toggleView() {
  S.view = S.view === 'grid' ? 'list' : 'grid';
  localStorage.setItem('bt_view', S.view);
  render();
}

function syncNav() {
  $$('.nav__item').forEach(btn => {
    btn.classList.toggle('nav__item--active', btn.dataset.tab === S.tab);
  });
}

function syncViewBtn() {
  const btn = $('#btn-view');
  if (btn) btn.textContent = S.view === 'grid' ? '☰' : '⊞';
  // View btn only relevant on collection tabs
  const showView = S.tab === 'unwatched' || S.tab === 'watched';
  if (btn) btn.style.visibility = showView ? '' : 'hidden';
}

function showToast(msg, type = '') {
  const container = $('#toasts');
  const toast = mk('div', `toast${type ? ' toast--' + type : ''}`, msg);
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════
async function initApp() {
  // Nav listeners
  $$('.nav__item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('#btn-view').addEventListener('click', toggleView);
  $('#btn-sync').addEventListener('click', doSync);

  // Close modal on overlay click
  $('#overlay').addEventListener('click', e => {
    if (e.target === $('#overlay')) closeModal();
  });

  try {
    await dbInit();
    S.movies = await dbLoadMovies();

    // Prima rulare: dacă nu avem nimic, importăm seed-ul automat
    if (!Object.keys(S.movies).length) {
      showToast('Prima rulare — se importă datele…');
      await doSync();
    }
  } catch (e) {
    showToast('Firebase error: ' + e.message, 'error');
    console.error(e);
  }

  S.loading = false;
  render();
}

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}

document.addEventListener('DOMContentLoaded', initApp);
