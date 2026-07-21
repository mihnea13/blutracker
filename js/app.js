// BluTracker v0.3
const BT_VERSION = '0.3';

// ─── app.js — BluTracker PWA ─────────────────────────────────
'use strict';

// ════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════
const S = {
  movies:  {},
  tab:     'unwatched',
  view:    localStorage.getItem('bt_view') || 'grid',
  expanded: new Set(),
  search:  '',
  activeFilters: new Set(),
  collapsed: new Set(['csect-done']),
  randomN: 1,
  randomMaxRuntime: 999,
  randomDecade: null,
  sort:    'az',   // az | za | year-desc | year-asc | runtime-desc | runtime-asc
  loading: true,
};

// ── FILTER DEFINITIONS per tab ─────────────────────────────
const TAB_FILTERS = {
  unwatched: [
    { id:'com',  label:'🎙 Cu commentary', fn: m => m.commentaryTracks?.length > 0 },
    { id:'feat', label:'🎞 Cu features',   fn: m => m.hasGenericFeatures || m.specialFeatures?.length > 0 },
  ],
  watched: [
    { id:'com-pending',  label:'🎙 Com. nevăzute',     fn: m => (m.commentaryTracks||[]).some(t=>!t.watched) },
    { id:'feat-pending', label:'🎞 Features pending',  fn: m => (m.hasGenericFeatures&&!m.genericFeaturesWatched)||(m.specialFeatures||[]).some(f=>!f.watched) },
  ],
  commentaries: [],
  features: [
    { id:'feat-pending', label:'Pending', fn: m => !allFeatDone(m) },
    { id:'feat-done',    label:'Complete ✓', fn: m => allFeatDone(m) },
  ],
};

// Sort options per tab
const SORT_OPTIONS = {
  all: [
    { value:'az',           label:'A → Z' },
    { value:'za',           label:'Z → A' },
    { value:'year-desc',    label:'An: nou → vechi' },
    { value:'year-asc',     label:'An: vechi → nou' },
    { value:'runtime-desc', label:'Durată: lung → scurt' },
    { value:'runtime-asc',  label:'Durată: scurt → lung' },
  ],
  watched: [
    { value:'az',                label:'A → Z' },
    { value:'za',                label:'Z → A' },
    { value:'year-desc',         label:'An: nou → vechi' },
    { value:'year-asc',          label:'An: vechi → nou' },
    { value:'runtime-desc',      label:'Durată: lung → scurt' },
    { value:'runtime-asc',       label:'Durată: scurt → lung' },
    { value:'watch-count-desc',  label:'Nr. vizionări ↓' },
    { value:'watch-count-asc',   label:'Nr. vizionări ↑' },
    { value:'last-watch-desc',   label:'Ultima vizionare ↓' },
    { value:'first-watch-asc',   label:'Prima vizionare ↑' },
  ],
};
const lastDate  = m => [...(m.watchHistory||[])].sort((a,b)=>b.date>a.date?1:-1)[0]?.date||'';
const firstDate = m => [...(m.watchHistory||[])].sort((a,b)=>a.date>b.date?1:-1)[0]?.date||'';
const TMDB_IMG    = 'https://image.tmdb.org/t/p/w500';
const TMDB_BASE   = 'https://api.themoviedb.org/3';

// ════════════════════════════════════════════════════
// SHORTCUTS
// ════════════════════════════════════════════════════
const $   = s => document.querySelector(s);
const mk  = (tag, cls='', text='') => { const e=document.createElement(tag); if(cls)e.className=cls; if(text)e.textContent=text; return e; };
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today   = () => new Date().toISOString().split('T')[0];
const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString('ro-RO') : '';

// ════════════════════════════════════════════════════
// COMPUTED + FILTERS
// ════════════════════════════════════════════════════
const list      = () => Object.entries(S.movies).map(([id,m])=>({id,...m}));
const unwatched = () => list().filter(m => !m.watchHistory?.length);
const watched   = () => list().filter(m =>  m.watchHistory?.length);
const withComm  = () => list().filter(m =>  m.commentaryTracks?.length > 0);
const withFeat  = () => list().filter(m =>  m.hasGenericFeatures || m.specialFeatures?.length > 0);

const commStatus = m => {
  const t = m.commentaryTracks||[]; if(!t.length) return null;
  const w = t.filter(x=>x.watched).length;
  return w===t.length?'done':w>0?'partial':'pending';
};
const pendingComm = () => withComm().filter(m=>(m.commentaryTracks||[]).some(t=>!t.watched));

function filterSort(arr) {
  let out = arr;
  // Text search
  if (S.search) {
    const q = S.search.toLowerCase();
    out = out.filter(m => m.title.toLowerCase().includes(q) ||
                          (m.directors||[]).some(d=>d.toLowerCase().includes(q)));
  }
  // Active chip filters
  const tabF = TAB_FILTERS[S.tab] || [];
  for (const f of tabF) {
    if (S.activeFilters.has(f.id)) out = out.filter(f.fn);
  }
  switch (S.sort) {
    case 'za':           return out.sort((a,b)=>b.title.localeCompare(a.title));
    case 'year-desc':    return out.sort((a,b)=>(b.year||'0').localeCompare(a.year||'0'));
    case 'year-asc':     return out.sort((a,b)=>(a.year||'9999').localeCompare(b.year||'9999'));
    case 'runtime-desc': return out.sort((a,b)=>(b.runtime||0)-(a.runtime||0));
    case 'runtime-asc':  return out.sort((a,b)=>(a.runtime||0)-(b.runtime||0));
    case 'last-watch-desc':  return out.sort((a,b)=>lastDate(b).localeCompare(lastDate(a)));
    case 'first-watch-asc':  return out.sort((a,b)=>firstDate(a).localeCompare(firstDate(b)));
    case 'watch-count-desc': return out.sort((a,b)=>(b.watchHistory?.length||0)-(a.watchHistory?.length||0));
    case 'watch-count-asc':  return out.sort((a,b)=>(a.watchHistory?.length||0)-(b.watchHistory?.length||0));
    default:             return out.sort((a,b)=>a.title.localeCompare(b.title));
  }
}

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
  syncNav(); syncViewBtn();
}

// ════════════════════════════════════════════════════
// TOOLBAR
// ════════════════════════════════════════════════════
function makeToolbar(count, tab, extraBtns=[]) {
  const bar  = mk('div','toolbar');
  const countEl = mk('span','toolbar__count', count + ' filme');
  bar.appendChild(countEl);

  const acts = mk('div','toolbar__actions');

  // Extra buttons (e.g. Random picker)
  extraBtns.forEach(b => acts.appendChild(b));

  bar.appendChild(acts);
  return bar;
}

function openSortSheet(tab) {
  const opts = (tab === 'watched' ? SORT_OPTIONS.watched : SORT_OPTIONS.all);
  const rows = opts.map(o => {
    const active = S.sort === o.value;
    return '<label class="sort-option' + (active ? ' sort-option--active' : '') + '">' +
      '<input type="radio" name="sort-pick" value="' + o.value + '"' + (active ? ' checked' : '') + '>' +
      '<span class="sort-option__label">' + o.label + '</span>' +
      (active ? '<span class="sort-option__check">✓</span>' : '') +
      '</label>';
  }).join('');
  openModal('Sortare', '<div class="sort-options">' + rows + '</div>', '');
  setTimeout(() => {
    document.querySelectorAll('input[name="sort-pick"]').forEach(inp => {
      inp.addEventListener('change', () => { S.sort = inp.value; closeModal(); render(); });
    });
  }, 50);
}

function emptyState(icon, text) {
  const d = mk('div','empty');
  d.innerHTML = `<div class="empty__icon">${icon}</div><p class="empty__text">${esc(text)}</p>`;
  return d;
}

// ════════════════════════════════════════════════════
// TAB: UNWATCHED
// ════════════════════════════════════════════════════
function renderUnwatched(main) {
  main.innerHTML = '';
  const all = unwatched(); const movies = filterSort(all);
  const rndPickBtn = mk('button','toolbar__icon-btn');
  rndPickBtn.title='Ce văd în seara asta?'; rndPickBtn.innerHTML='🎲';
  rndPickBtn.onclick = openRandomPicker;
  main.appendChild(makeToolbar(all.length, 'unwatched', [rndPickBtn]));
  if (!movies.length) { main.appendChild(emptyState('🎉', S.search?'Niciun rezultat.':'Toate filmele au fost vizionate!')); return; }
  const grid = mk('div', S.view==='grid'?'grid':'grid list');
  movies.forEach(m => {
    const card = movieCard(m);
    const btn  = mk('button','btn btn--primary btn--full','▶ Marchează văzut');
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
  const all = watched(); const movies = filterSort(all);
  main.appendChild(makeToolbar(all.length, 'watched'));
  if (!movies.length) { main.appendChild(emptyState('📼', S.search?'Niciun rezultat.':'Niciun film văzut.')); return; }
  if (S.view === 'diary') { renderDiary(main, movies); return; }
  const grid = mk('div', S.view==='grid'?'grid':'grid list');
  movies.forEach(m => {
    const card  = movieCard(m);
    const meta  = card.querySelector('.card__meta');
    meta.appendChild(mk('span','badge badge--green',`✓ ${m.watchHistory.length}×`));
    const dates = m.watchHistory.map(w=>new Date(w.date+'T12:00:00')).sort((a,b)=>b-a);
    if (dates.length && dates[0].getFullYear()>2000)
      meta.appendChild(mk('span','card__date',dates[0].toLocaleDateString('ro-RO')));
    grid.appendChild(card);
  });
  main.appendChild(grid);
}

// ════════════════════════════════════════════════════
// TAB: COMMENTARIES
// ════════════════════════════════════════════════════
function renderCommentaries(main) {
  main.innerHTML = '';
  const rndBtn = mk('button','toolbar__icon-btn');
  rndBtn.title = 'Film random'; rndBtn.innerHTML = '🎲';
  rndBtn.onclick = pickRandom;
  main.appendChild(makeToolbar(withComm().length, 'commentaries', [rndBtn]));

  const all = filterSort(withComm());
  if (!all.length) { main.appendChild(emptyState('🎙','Niciun film cu commentary tracks.')); return; }

  const GROUPS = [
    { key:'csect-pending', label:'Niciun track văzut', dotCls:'status-dot--pending', filter: m=>commStatus(m)==='pending' },
    { key:'csect-partial', label:'Parțial văzute',      dotCls:'status-dot--partial', filter: m=>commStatus(m)==='partial' },
    { key:'csect-done',    label:'Complet văzute',       dotCls:'status-dot--done',    filter: m=>commStatus(m)==='done' },
  ];

  GROUPS.forEach(g => {
    const movies = all.filter(g.filter);
    if (!movies.length) return;
    const isOpen = !S.collapsed.has(g.key);
    const section = mk('div','comm-section' + (isOpen ? ' comm-section--open' : ''));

    const hdr = mk('div','comm-section-hdr');
    hdr.innerHTML =
      '<div class="comm-section-left">' +
        '<span class="status-dot ' + g.dotCls + '"></span>' +
        '<span class="comm-section-label">' + esc(g.label) + '</span>' +
      '</div>' +
      '<div class="comm-section-right">' +
        '<span class="comm-section-count">' + movies.length + '</span>' +
        '<span class="comm-section-arrow">›</span>' +
      '</div>';
    hdr.onclick = () => {
      if (S.collapsed.has(g.key)) S.collapsed.delete(g.key);
      else S.collapsed.add(g.key);
      render();
    };
    section.appendChild(hdr);

    const body = mk('div','comm-section-body');
    if (isOpen) movies.forEach(m => body.appendChild(commCard(m)));
    section.appendChild(body);
    main.appendChild(section);
  });
}

function commCard(m) {
  const tracks = m.commentaryTracks || [];
  const nW = tracks.filter(t=>t.watched).length;
  const key = 'ccard-' + m.id;
  const isExpanded = S.expanded.has(key);

  const card = mk('div','comm-card' + (isExpanded ? ' comm-card--expanded' : ''));

  const hdr = mk('div','comm-card__header');
  hdr.onclick = () => { toggle(key); render(); };

  const poster = mk('div','comm-card__poster');
  const img = mk('img'); img.alt = m.title; img.loading='lazy';
  img.src = m.tmdbPosterUrl || m.posterUrl || posterPlaceholder(m.title);
  img.onerror = () => { img.src = posterPlaceholder(m.title); };
  poster.appendChild(img);

  const info = mk('div','comm-card__info');
  info.appendChild(mk('div','comm-card__title', m.title));
  if (m.year || m.runtime) {
    info.appendChild(mk('div','comm-card__meta',
      [m.year, m.runtime ? m.runtime+'m' : ''].filter(Boolean).join(' · ')));
  }

  const prog = mk('div','comm-card__progress');
  const dots = mk('div','track-dots');
  tracks.forEach(t => dots.appendChild(mk('span','track-dot'+(t.watched?' track-dot--on':''))));
  prog.append(dots, mk('span','track-count', nW+'/'+tracks.length));
  info.appendChild(prog);

  hdr.append(poster, info);
  card.appendChild(hdr);

  if (isExpanded) {
    const expand = mk('div','comm-card__expand');
    tracks.forEach((t,i) => {
      const row = mk('div','track-row'+(t.watched?' track-row--watched':''));
      const chk = mk('button','track-check'+(t.watched?' track-check--on':''),t.watched?'✓':'');
      chk.onclick = e => { e.stopPropagation(); doToggleCommentary(m.id,i); };
      row.append(chk, mk('span','track-label','Commentary '+(i+1)),
                 mk('span','track-date', t.watchDate?fmtDate(t.watchDate):''));
      expand.appendChild(row);
    });
    const addBtn = mk('button','btn btn--ghost btn--sm track-add-btn','+ Track nou');
    addBtn.onclick = e => { e.stopPropagation(); doAddCommentaryTrack(m.id); };
    expand.appendChild(addBtn);
    card.appendChild(expand);
  }
  return card;
}

// ════════════════════════════════════════════════════
// TAB: FEATURES
// ════════════════════════════════════════════════════
function renderFeatures(main) {
  main.innerHTML = '';
  main.appendChild(makeToolbar(withFeat().length, 'features'));
  const allFeat = withFeat();
  if (!allFeat.length) { main.appendChild(emptyState('🎞','Niciun film cu features.\nDin tab-ul Văzute → ⚙ Disc pe fiecare film.')); return; }
  const movies = [...allFeat].sort((a,b)=>{
    const da=allFeatDone(a)?1:0, db=allFeatDone(b)?1:0;
    return da-db || a.title.localeCompare(b.title);
  });
  movies.forEach(m => main.appendChild(featSection(m)));
}

const allFeatDone = m => (!m.hasGenericFeatures||m.genericFeaturesWatched) && (m.specialFeatures||[]).every(f=>f.watched);

function featSection(m) {
  const done = allFeatDone(m), spec = m.specialFeatures||[];
  const key = `feat-${m.id}`, open = S.expanded.has(key);
  const section = mk('div',`collapsible${open?' collapsible--open':''}`);
  const header  = mk('div','collapsible__header');
  header.innerHTML = `
    <div class="collapsible__title">
      <span class="status-dot status-dot--${done?'done':'pending'}"></span>
      <span class="collapsible__name">${esc(m.title)}</span>
    </div>
    <div class="collapsible__meta">
      <span class="badge badge--${done?'green':'amber'}">${done?'Complet ✓':'Pending'}</span>
      <span class="caret">${open?'▲':'▼'}</span>
    </div>`;
  header.onclick = () => { toggle(key); render(); };
  const body = mk('div','collapsible__body');
  if (open) {
    if (m.hasGenericFeatures) {
      const row = mk('div',`track-row${m.genericFeaturesWatched?' track-row--watched':''}`);
      const chk = mk('button',`track-check${m.genericFeaturesWatched?' track-check--on':''}`,m.genericFeaturesWatched?'✓':'');
      chk.onclick = () => doToggleGenericFeatures(m.id);
      row.append(chk, mk('span','track-label','🎬 Extras generice'));
      body.appendChild(row);
    }
    spec.forEach(f => {
      const row = mk('div',`track-row track-row--special${f.watched?' track-row--watched':''}`);
      const chk = mk('button',`track-check${f.watched?' track-check--on':''}`,f.watched?'✓':'');
      chk.onclick = () => doToggleSpecialFeature(m.id,f.id);
      const lbl = mk('span','track-label'); lbl.innerHTML = `<span class="feat-star">★</span> ${esc(f.name)}`;
      const dt  = mk('span','track-date', f.watchDate?fmtDate(f.watchDate):'');
      row.append(chk,lbl,dt); body.appendChild(row);
    });
    const addBtn = mk('button','btn btn--ghost btn--sm track-add-btn','+ Feature special');
    addBtn.onclick = () => openAddFeatureModal(m.id);
    body.appendChild(addBtn);
  }
  section.append(header,body); return section;
}

// ════════════════════════════════════════════════════
// MOVIE CARD
// ════════════════════════════════════════════════════
function movieCard(m) {
  const card   = mk('div','card'); card.dataset.id = m.id;
  const poster = mk('div','card__poster');
  const img    = mk('img'); img.alt=''; img.loading='lazy';
  img.src = m.tmdbPosterUrl || m.posterUrl || posterPlaceholder(m.title);
  img.onerror = () => { img.src = posterPlaceholder(m.title); };
  poster.appendChild(img);
  const info    = mk('div','card__info');
  const title   = mk('h3','card__title',m.title);
  const meta    = mk('div','card__meta');
  if (m.year)    meta.appendChild(mk('span','card__year', m.year));
  if (m.runtime) meta.appendChild(mk('span','card__rt',   m.runtime+'m'));
  const actions = mk('div','card__actions');
  info.append(title,meta,actions);
  card.append(poster,info);
  // Click opens film detail panel
  card.addEventListener('click', () => openFilmDetail(m.id));
  return card;
}

function posterPlaceholder(title) {
  const init = title.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  const hue  = [...title].reduce((a,c)=>a+c.charCodeAt(0),0)%360;
  const svg  = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="290"><rect width="200" height="290" fill="hsl(${hue},30%,16%)"/><text x="100" y="158" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-family="system-ui" font-size="56" font-weight="700">${init}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ════════════════════════════════════════════════════
// FILM DETAIL PANEL
// ════════════════════════════════════════════════════
async function openFilmDetail(id) {
  renderDetailModal(id);
  // Enrich with TMDB in background if missing
  if (!S.movies[id].tmdbId && TMDB_API_KEY) {
    enrichWithTmdb(id).then(() => {
      if ($('#overlay').classList.contains('overlay--visible'))
        renderDetailModal(id);
    });
  }
}

function renderDetailModal(id) {
  const m        = S.movies[id];
  const poster   = m.tmdbPosterUrl || m.posterUrl || posterPlaceholder(m.title);
  const wCount   = m.watchHistory?.length || 0;
  const lastDate = wCount
    ? [...m.watchHistory].sort((a,b)=>b.date.localeCompare(a.date))[0]?.date
    : null;
  const commN    = (m.commentaryTracks||[]).length;
  const pendingN = (m.commentaryTracks||[]).filter(t=>!t.watched).length;

  const body = `
    <div class="detail-poster"><img src="${esc(poster)}" alt="${esc(m.title)}" onerror="this.src='${posterPlaceholder(m.title)}'"></div>
    <div class="detail-chips">
      ${m.year    ? `<span class="chip">${esc(m.year)}</span>` : ''}
      ${m.runtime ? `<span class="chip">${m.runtime} min</span>` : ''}
      ${m.voteAverage ? `<span class="chip">★ ${m.voteAverage}</span>` : ''}
    </div>
    ${m.directors?.length ? `<div class="detail-director">${esc(m.directors.join(', '))}</div>` : ''}
    ${m.overview ? `<p class="detail-overview">${esc(m.overview)}</p>` : (!m.tmdbId&&TMDB_API_KEY?'<p class="detail-loading">Se caută informații…</p>':'')}
    <div class="detail-section">
      <div class="detail-stat">${wCount ? `Văzut <strong>${wCount}×</strong>${lastDate&&lastDate>''?` · ultimul: ${fmtDate(lastDate)}`:''}` : '<em style="color:var(--text-2)">Nevăzut</em>'}</div>
      ${commN ? `<div class="detail-stat">🎙 ${commN-pendingN}/${commN} commentary</div>` : ''}
    </div>
    <div class="detail-actions-row">
      <button class="btn btn--ghost btn--sm" onclick="closeModal();openSetupDiscModal('${id}')">⚙ Disc</button>
      ${commN ? `<button class="btn btn--ghost btn--sm" onclick="closeModal();S.tab='commentaries';S.expanded.add('comm-${id}');render()">🎙 Comentarii</button>` : ''}
      ${m.hasGenericFeatures||(m.specialFeatures?.length>0) ? `<button class="btn btn--ghost btn--sm" onclick="closeModal();S.tab='features';S.expanded.add('feat-${id}');render()">🎞 Extras</button>` : ''}
    </div>
    ${!wCount ? `<button class="btn btn--primary btn--full" style="margin-top:10px" onclick="closeModal();openMarkWatchedModal('${id}')">▶ Marchează văzut</button>` : `<button class="btn btn--ghost btn--sm" style="margin-top:6px" onclick="closeModal();openAddWatchModal('${id}')">+ Vizionare nouă</button>`}
    <div class="detail-danger">
      <button class="btn btn--danger btn--full" onclick="confirmDeleteModal('${id}')">🗑 Șterge din colecție</button>
    </div>`;

  openModal(m.title, body, '');
}

function confirmDeleteModal(id) {
  const m = S.movies[id];
  $('#modal .modal__body').innerHTML = `
    <p>Ștergi definitiv <strong>${esc(m.title)}</strong>?</p>
    <p style="font-size:13px;color:var(--text-2);margin-top:8px">Se șterg și toate datele de tracking.</p>`;
  $('#modal .modal__footer').innerHTML = `
    <button class="btn btn--ghost" onclick="renderDetailModal('${id}')">Anulează</button>
    <button class="btn btn--danger" onclick="doDelete('${id}')">🗑 Șterge</button>`;
}

async function doDelete(id) {
  closeModal();
  try {
    await dbDeleteMovie(id);
    delete S.movies[id];
    render();
    showToast('Film șters ✓');
  } catch(e) { showToast('Eroare: '+e.message,'error'); }
}

// ════════════════════════════════════════════════════
// TMDB
// ════════════════════════════════════════════════════
async function enrichWithTmdb(id) {
  if (!TMDB_API_KEY) return;
  const m = S.movies[id];
  if (m.tmdbId) return;
  try {
    const q  = encodeURIComponent(m.title);
    const r1 = await fetch(`${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${q}&language=en-US`);
    const d1 = await r1.json();
    const hit = d1.results?.[0];
    if (!hit) return;
    const r2 = await fetch(`${TMDB_BASE}/movie/${hit.id}?api_key=${TMDB_API_KEY}&append_to_response=credits&language=en-US`);
    const d2 = await r2.json();
    const tmdb = {
      tmdbId:       hit.id,
      tmdbPosterUrl: hit.poster_path ? TMDB_IMG+hit.poster_path : '',
      year:          (hit.release_date||'').slice(0,4),
      runtime:       d2.runtime||0,
      overview:      hit.overview||'',
      voteAverage:   Math.round((hit.vote_average||0)*10)/10,
      directors:     (d2.credits?.crew||[]).filter(c=>c.job==='Director').map(c=>c.name).slice(0,2),
    };
    S.movies[id] = await dbSaveTmdb(id, tmdb);
  } catch(e) { console.warn('TMDB error',m.title,e); }
}

// Preîncarcă TMDB pentru toate filmele fără date (în fundal, throttled)
async function prefetchTmdb() {
  if (!TMDB_API_KEY) return;
  const missing = Object.keys(S.movies).filter(id => !S.movies[id].tmdbId);
  for (const id of missing) {
    await enrichWithTmdb(id);
    await new Promise(r => setTimeout(r, 300)); // 300ms între request-uri
  }
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
    ${footerHTML!==undefined?`<div class="modal__footer">${footerHTML}</div>`:''}`;
  overlay.classList.add('overlay--visible');
  setTimeout(() => { const inp = $('#modal input,#modal textarea'); if(inp) inp.focus(); }, 50);
}

function closeModal() { $('#overlay').classList.remove('overlay--visible'); }

// ── Mark Watched (prima dată) ─────────────────────
function openMarkWatchedModal(id) {
  const m = S.movies[id];
  openModal('Marchează ca văzut',
    `<p class="modal__subtitle">${esc(m.title)}</p>
     <div class="field"><label>Data vizionării</label><input type="date" id="mw-date" value="${today()}"></div>
     <div class="field"><label>Commentary tracks</label>
       <div class="num-row">
         <button class="num-btn" onclick="adjNum('mw-comm',-1)">−</button>
         <input type="number" id="mw-comm" value="0" min="0" max="20" class="num-input">
         <button class="num-btn" onclick="adjNum('mw-comm',1)">+</button>
       </div>
     </div>
     <div class="field"><div class="toggle-row">
       <span class="toggle-label">Are extras / features</span>
       <button class="toggle" id="mw-feat-toggle" onclick="toggleBtn(this)"></button>
     </div></div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="confirmMarkWatched('${id}')">✓ Confirmă</button>`);
}

async function confirmMarkWatched(id) {
  const date=($('#mw-date').value||today()), commN=parseInt($('#mw-comm').value)||0, hasFeat=$('#mw-feat-toggle').classList.contains('toggle--on');
  closeModal(); showToast('Se salvează…');
  try {
    let data = await dbAddWatch(id, date);
    if (commN>0||hasFeat) data = await dbSetExtras(id, commN, hasFeat);
    S.movies[id]=data; render(); showToast(`${S.movies[id].title} — văzut 🎬`,'success');
  } catch(e) { showToast('Eroare: '+e.message,'error'); }
}

// ── Add watch ─────────────────────────────────────
function openAddWatchModal(id) {
  const m=S.movies[id], n=(m.watchHistory?.length||0)+1;
  openModal(`+ Vizionare nouă (#${n})`,
    `<p class="modal__subtitle">${esc(m.title)}</p>
     <div class="field"><label>Data</label><input type="date" id="aw-date" value="${today()}"></div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="confirmAddWatch('${id}')">✓ Adaugă</button>`);
}
async function confirmAddWatch(id) {
  const date=$('#aw-date').value||today(); closeModal();
  try { S.movies[id]=await dbAddWatch(id,date); render(); showToast('Vizionare adăugată ✓','success'); }
  catch(e) { showToast('Eroare: '+e.message,'error'); }
}

// ── Watch history ──────────────────────────────────
function openHistoryModal(id) {
  const m=S.movies[id];
  const sorted=[...(m.watchHistory||[])].sort((a,b)=>a.date<b.date?-1:1);
  const rows=sorted.map((w,i)=>`
    <div class="history-item">
      <div>
        <div class="history-date">${fmtDate(w.date)||'—'}</div>
        ${w.note?`<div class="history-note">${esc(w.note)}</div>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="history-num">#${i+1}</span>
        <button class="del-watch-btn" onclick="doDeleteWatch('${id}',${i})" title="Șterge">✕</button>
      </div>
    </div>`).join('');
  openModal('Istoricul vizionărilor',
    `<p class="modal__subtitle">${esc(m.title)}</p>${rows||'<p class="modal__empty">Niciun watch</p>'}`,
    `<button class="btn btn--ghost" onclick="closeModal()">Închide</button>
     <button class="btn btn--primary" onclick="closeModal();openAddWatchModal('${id}')">+ Adaugă</button>`);
}

async function doDeleteWatch(id, sortedIndex) {
  const m = S.movies[id];
  const sorted = [...(m.watchHistory||[])].sort((a,b)=>a.date<b.date?-1:1);
  const entry  = sorted[sortedIndex];
  if (!entry) return;
  if (!confirm('Ștergi vizionarea din ' + (fmtDate(entry.date)||'—') + '?')) return;
  try {
    S.movies[id] = await dbRemoveWatch(id, entry);
    openHistoryModal(id); // Re-render history
    render();
    showToast('Vizionare ștearsă ✓');
  } catch(e) { showToast('Eroare: '+e.message,'error'); }
}

// ── Setup disc (pentru filme deja watched) ─────────
function openSetupDiscModal(id) {
  const m=S.movies[id], tracks=m.commentaryTracks?.length||0, hasFeat=m.hasGenericFeatures||false;
  openModal('⚙ Configurează disc',
    `<p class="modal__subtitle">${esc(m.title)}</p>
     <div class="field"><label>Commentary tracks</label>
       <div class="num-row">
         <button class="num-btn" onclick="adjNum('sd-comm',-1)">−</button>
         <input type="number" id="sd-comm" value="${tracks}" min="0" max="20" class="num-input">
         <button class="num-btn" onclick="adjNum('sd-comm',1)">+</button>
       </div>
       <p style="font-size:12px;color:var(--text-2);margin-top:6px">Trackurile deja bifate sunt păstrate.</p>
     </div>
     <div class="field"><div class="toggle-row">
       <span class="toggle-label">Are extras / features</span>
       <button class="toggle ${hasFeat?'toggle--on':''}" id="sd-feat-toggle" onclick="toggleBtn(this)"></button>
     </div></div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="confirmSetupDisc('${id}')">✓ Salvează</button>`);
}
async function confirmSetupDisc(id) {
  const commN=parseInt($('#sd-comm').value)||0, hasFeat=$('#sd-feat-toggle').classList.contains('toggle--on');
  closeModal();
  try { S.movies[id]=await dbUpdateDisc(id,commN,hasFeat); render(); showToast('Disc configurat ✓','success'); }
  catch(e) { showToast('Eroare: '+e.message,'error'); }
}

// ── Add special feature ────────────────────────────
function openAddFeatureModal(id) {
  const m=S.movies[id];
  openModal('+ Feature special',
    `<p class="modal__subtitle">${esc(m.title)}</p>
     <div class="field"><label>Denumire feature</label><input type="text" id="af-name" placeholder="ex: Heart of Darkness (1991)"></div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="confirmAddFeature('${id}')">✓ Adaugă</button>`);
}
async function confirmAddFeature(id) {
  const name=$('#af-name').value.trim();
  if(!name){showToast('Introdu o denumire.','error');return;}
  closeModal();
  try { S.movies[id]=await dbAddSpecialFeature(id,name); render(); showToast(`Feature adăugat: ${name}`,'success'); }
  catch(e) { showToast('Eroare: '+e.message,'error'); }
}

function toggleBtn(btn) { btn.classList.toggle('toggle--on'); }
function adjNum(id,d) { const inp=document.getElementById(id); inp.value=Math.max(0,Math.min(20,(parseInt(inp.value)||0)+d)); }

// ════════════════════════════════════════════════════
// ASYNC ACTIONS
// ════════════════════════════════════════════════════
async function doToggleCommentary(id,idx) {
  try { S.movies[id]=await dbToggleCommentary(id,idx); render(); } catch(e){showToast('Eroare: '+e.message,'error');}
}
async function doAddCommentaryTrack(id) {
  try { S.movies[id]=await dbAddCommentaryTrack(id); render(); showToast('Track adăugat ✓','success'); } catch(e){showToast('Eroare: '+e.message,'error');}
}
async function doToggleGenericFeatures(id) {
  try { S.movies[id]=await dbToggleGenericFeatures(id); render(); } catch(e){showToast('Eroare: '+e.message,'error');}
}
async function doToggleSpecialFeature(id,featId) {
  try { S.movies[id]=await dbToggleSpecialFeature(id,featId); render(); } catch(e){showToast('Eroare: '+e.message,'error');}
}

// ════════════════════════════════════════════════════
// SYNC
// ════════════════════════════════════════════════════

function openSyncMenu() {
  const storedToken = localStorage.getItem('bt_github_token');
  const hasToken = storedToken && storedToken.startsWith('ghp_');
  const btnUpdate = hasToken
    ? `<button class="btn btn--accent btn--full" style="margin-bottom:10px" onclick="closeModal();triggerAndSync()">
         🔄 Actualizează de pe blu-ray.com
         <span style="display:block;font-size:11px;font-weight:400;opacity:.7;margin-top:2px">Pornește scraper-ul (~3 min), sync automat</span>
       </button>
       <button class="btn btn--ghost btn--sm btn--full" onclick="closeModal();openSetGithubToken()">🔑 Schimbă token</button>`
    : `<button class="btn btn--ghost btn--full" onclick="closeModal();openSetGithubToken()">
         🔑 Configurează token GitHub
         <span style="display:block;font-size:11px;font-weight:400;opacity:.7;margin-top:2px">Pentru actualizare din telefon (o singură dată)</span>
       </button>`;
  openModal('Actualizare colecție',
    `<p style="color:var(--text-2);font-size:14px;margin-bottom:16px">Alege ce vrei să faci:</p>
    <button class="btn btn--primary btn--full" style="margin-bottom:10px" onclick="closeModal();syncFromFile()">
      ⟳ Sync rapid
      <span style="display:block;font-size:11px;font-weight:400;opacity:.7;margin-top:2px">Preia collection.json deja generat</span>
    </button>
    ${btnUpdate}`,
    '');
}

function openSetGithubToken() {
  const current = localStorage.getItem('bt_github_token') || '';
  openModal('🔑 GitHub Token',
    `<p style="color:var(--text-2);font-size:13px;margin-bottom:14px">
      Creează la <strong>github.com/settings/tokens</strong> un token Classic cu scope <strong>workflow</strong>.
      Se salvează local în browser, nu ajunge pe GitHub.
    </p>
    <div class="field">
      <label>Personal Access Token</label>
      <input type="password" id="gh-token" placeholder="ghp_..." value="${current ? '••••••••' : ''}">
    </div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="saveGithubToken()">✓ Salvează</button>`);
}

function saveGithubToken() {
  const val = $('#gh-token').value.trim();
  if (!val || val === '••••••••') { closeModal(); return; }
  if (!val.startsWith('ghp_')) { showToast('Token invalid — trebuie să înceapă cu ghp_', 'error'); return; }
  localStorage.setItem('bt_github_token', val);
  closeModal();
  showToast('Token salvat ✓', 'success');
}

async function syncFromFile() {
  const btn=$('#btn-sync'); btn.textContent='⏳'; btn.disabled=true;
  try {
    const [colResp,seedResp]=await Promise.all([
      fetch('./data/collection.json?t='+Date.now()),
      fetch('./data/seed.json?t='+Date.now()),
    ]);
    const colData=await colResp.json(), seedData=await seedResp.json();
    if (colData.movies?.length) {
      const {added,updated,movies}=await dbSync(colData,seedData,S.movies);
      S.movies=movies;
      showToast(`Sync OK — ${added} noi, ${updated} actualizate ✓`,'success');
    } else {
      const {added,movies}=await dbSeedOnly(seedData,S.movies);
      S.movies=movies;
      showToast(`Seed importat — ${added} filme ✓`,'success');
    }
    render();
    prefetchTmdb();
  } catch(e){showToast('Sync eșuat: '+e.message,'error');}
  finally { btn.textContent='⟳'; btn.disabled=false; }
}

async function triggerAndSync() {
  const token = localStorage.getItem('bt_github_token');
  if (!token) { openSetGithubToken(); return; }
  const btn=$('#btn-sync'); btn.textContent='⏳'; btn.disabled=true;
  try {
    const r = await fetch(
      'https://api.github.com/repos/' + GITHUB_REPO + '/actions/workflows/sync.yml/dispatches',
      { method:'POST',
        headers:{ 'Authorization':'Bearer ' + token,
                  'Accept':'application/vnd.github+json',
                  'Content-Type':'application/json' },
        body: JSON.stringify({ref:'main'}) }
    );
    if (r.status === 401) { localStorage.removeItem('bt_github_token'); showToast('Token invalid','error'); btn.textContent='⟳'; btn.disabled=false; return; }
    if (r.status !== 204) { showToast('Eroare GitHub: ' + r.status,'error'); btn.textContent='⟳'; btn.disabled=false; return; }
    showToast('Scraper pornit! Sync automat în 3 minute 🚀','success');
    let secs = 180;
    const iv = setInterval(() => {
      secs--;
      btn.textContent = Math.floor(secs/60) + ':' + String(secs%60).padStart(2,'0');
      if (secs <= 0) { clearInterval(iv); syncFromFile().finally(()=>{btn.textContent='⟳';btn.disabled=false;}); }
    }, 1000);
  } catch(e) { showToast('Eroare: '+e.message,'error'); btn.textContent='⟳'; btn.disabled=false; }
}

function doSync() { openSyncMenu(); }

// ════════════════════════════════════════════════════
// RANDOM COMMENTARY
// ════════════════════════════════════════════════════
function pickRandom() {
  const pending=pendingComm();
  if (!pending.length){showToast('Toate commentary-urile văzute! 🎉');return;}
  const pick=pending[Math.floor(Math.random()*pending.length)];
  const key=`comm-${pick.id}`;
  S.tab='commentaries'; S.expanded.add(key); render();
  requestAnimationFrame(()=>{
    const el=document.getElementById(key);
    if(el){el.scrollIntoView({behavior:'smooth',block:'center'}); el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'),1200);}
  });
  showToast(`🎲 ${pick.title}`,'success');
}

// ════════════════════════════════════════════════════
// UI UTILS
// ════════════════════════════════════════════════════
function toggle(key) { S.expanded.has(key)?S.expanded.delete(key):S.expanded.add(key); }
function switchTab(tab) {
  S.tab=tab;
  S.activeFilters.clear();
  renderFilterChips();
  render();
}
// toggleView removed — use setView() via drawer
function syncNav() { $$('.nav__item').forEach(b=>b.classList.toggle('nav__item--active',b.dataset.tab===S.tab)); }
function syncViewBtn() { syncViewButtons(); }
function $$(s) { return [...document.querySelectorAll(s)]; }
function showToast(msg,type='') {
  const t=mk('div',`toast${type?' toast--'+type:''}`,msg);
  $('#toasts').appendChild(t); setTimeout(()=>t.remove(),3000);
}

// ════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
// SEARCH PANEL
// ════════════════════════════════════════════════════
function openSearch() {
  document.body.classList.add('search-open');
  setTimeout(() => { $('#search-input')?.focus(); }, 300);
  renderFilterChips();
}

function closeSearch() {
  S.search = '';
  S.activeFilters.clear();
  document.body.classList.remove('search-open','has-search');
  const inp = $('#search-input');
  if (inp) inp.value = '';
  render();
}

function renderFilterChips() {
  const container = $('#filter-chips');
  if (!container) return;
  const filters = TAB_FILTERS[S.tab] || [];
  container.innerHTML = '';
  filters.forEach(f => {
    const chip = mk('button', 'chip-filter' + (S.activeFilters.has(f.id) ? ' chip-filter--active' : ''), f.label);
    chip.onclick = () => {
      if (S.activeFilters.has(f.id)) S.activeFilters.delete(f.id);
      else S.activeFilters.add(f.id);
      renderFilterChips();
      render();
    };
    container.appendChild(chip);
  });
}

// ════════════════════════════════════════════════════
// DIARY VIEW
// ════════════════════════════════════════════════════
function renderDiary(main, movies) {
  // Expand watchHistory entries, sort by date desc
  const entries = [];
  movies.forEach(m => {
    (m.watchHistory||[]).forEach(w => {
      if (w.date && w.date > '') entries.push({...m, watchDate: w.date});
    });
  });
  entries.sort((a,b) => b.watchDate.localeCompare(a.watchDate));

  if (!entries.length) { main.appendChild(emptyState('📅','Nicio dată de vizionare înregistrată.')); return; }

  let lastMonth = '';
  entries.forEach(e => {
    const month = e.watchDate.substring(0,7);
    if (month !== lastMonth) {
      const d = new Date(month+'-15T12:00:00');
      const hdr = mk('div','diary-month-header',
        d.toLocaleDateString('ro-RO',{month:'long',year:'numeric'})
          .replace(/^[a-z]/, c=>c.toUpperCase()));
      main.appendChild(hdr);
      lastMonth = month;
    }
    const day = parseInt(e.watchDate.substring(8,10));
    const row = mk('div','diary-row');
    row.onclick = () => openFilmDetail(e.id);

    const dayEl = mk('div','diary-day', String(day));
    const poster = mk('div','diary-poster');
    const img = mk('img'); img.alt=e.title; img.loading='lazy';
    img.src = e.tmdbPosterUrl||e.posterUrl||posterPlaceholder(e.title);
    img.onerror=()=>{img.src=posterPlaceholder(e.title);};
    poster.appendChild(img);

    const info = mk('div','diary-info');
    info.appendChild(mk('div','diary-title',e.title));
    const metaParts = [e.year, e.runtime?e.runtime+'m':'', e.voteAverage?'★ '+e.voteAverage:''].filter(Boolean);
    info.appendChild(mk('div','diary-meta',metaParts.join(' · ')));
    row.append(dayEl,poster,info);
    main.appendChild(row);
  });
}

// ════════════════════════════════════════════════════
// RANDOM PICKER
// ════════════════════════════════════════════════════
function openRandomPicker() {
  const decades = [...new Set(
    list().filter(m=>m.year&&!m.watchHistory?.length)
          .map(m=>Math.floor(parseInt(m.year)/10)*10)
          .filter(d=>!isNaN(d))
  )].sort();

  renderRandomPickerModal(decades, []);
}

function renderRandomPickerModal(decades, results) {
  const maxR = S.randomMaxRuntime;
  const labelR = maxR >= 999 ? 'Orice durată' : maxR + ' min';
  const decadeChips = decades.map(d => {
    const active = S.randomDecade === d;
    return '<button class="decade-chip'+(active?' decade-chip--active':'')+
           '" onclick="setRandomDecade('+d+','+JSON.stringify(decades)+')">'+(d>0?d+'s':'?')+'</button>';
  }).join('');

  const resultHTML = results.length ? results.map(m => {
    const poster = m.tmdbPosterUrl||m.posterUrl||'';
    return '<div class="random-film-card">' +
      '<div class="random-film-card__poster"><img src="'+esc(poster)+'" alt="'+esc(m.title)+'"></div>' +
      '<div class="random-film-card__info">' +
        '<div class="random-film-card__title">'+esc(m.title)+'</div>' +
        '<div class="random-film-card__meta">'+ [m.year, m.runtime?m.runtime+'m':'', m.voteAverage?'★ '+m.voteAverage:''].filter(Boolean).join(' · ') +'</div>' +
        '<button class="btn btn--primary btn--sm" style="margin-top:8px" onclick=\"closeModal();openMarkWatchedModal(\"+m.id+\")">▶ Marchează văzut</button>' +
      '</div></div>';
  }).join('') : '';

  openModal('🎲 Ce văd în seara asta?',
    '<div class="field"><label>Câte filme</label>' +
      '<div class="random-n-row">' +
        '<button class="random-n-btn" onclick="adjRandomN(-1)">−</button>' +
        '<span class="random-n-val" id="rnd-n">'+S.randomN+'</span>' +
        '<button class="random-n-btn" onclick="adjRandomN(1)">+</button>' +
      '</div></div>' +
    '<div class="field"><label>Durată maximă</label>' +
      '<div class="range-wrap">' +
        '<div class="range-label"><span>60 min</span><span class="range-val" id="rnd-r-lbl">'+labelR+'</span><span>4h+</span></div>' +
        '<input type="range" id="rnd-runtime" min="60" max="300" step="30" value="'+(maxR>=999?300:maxR)+'" oninput="updateRuntimeLabel(this)">' +
      '</div></div>' +
    (decades.length ? '<div class="field"><label>Decadă (opțional)</label><div class="decade-chips">'+decadeChips+'</div></div>' : '') +
    (resultHTML ? '<div class="random-results">'+resultHTML+'</div>' : ''),
    '<button class="btn btn--ghost" onclick="closeModal()">Închide</button>' +
    '<button class="btn btn--accent" onclick="doPickRandom()">🎲 Alege!</button>'
  );
}

function adjRandomN(d) {
  S.randomN = Math.max(1, Math.min(5, S.randomN + d));
  $('#rnd-n') && ($('#rnd-n').textContent = S.randomN);
}

function updateRuntimeLabel(el) {
  const v = parseInt(el.value);
  S.randomMaxRuntime = v >= 300 ? 999 : v;
  const lbl = $('#rnd-r-lbl');
  if (lbl) lbl.textContent = v >= 300 ? 'Orice durată' : v + ' min';
}

function setRandomDecade(d, decades) {
  S.randomDecade = S.randomDecade === d ? null : d;
  const maxR = parseInt($('#rnd-runtime')?.value||300);
  S.randomMaxRuntime = maxR >= 300 ? 999 : maxR;
  renderRandomPickerModal(decades, []);
}

function doPickRandom() {
  const maxR = parseInt($('#rnd-runtime')?.value||300);
  S.randomMaxRuntime = maxR >= 300 ? 999 : maxR;
  const decades = [...new Set(
    list().filter(m=>m.year&&!m.watchHistory?.length)
          .map(m=>Math.floor(parseInt(m.year)/10)*10).filter(d=>!isNaN(d))
  )].sort();

  let pool = unwatched();
  if (S.randomMaxRuntime < 999) pool = pool.filter(m=>!m.runtime||m.runtime<=S.randomMaxRuntime);
  if (S.randomDecade) pool = pool.filter(m=>m.year&&Math.floor(parseInt(m.year)/10)*10===S.randomDecade);

  if (!pool.length) { showToast('Niciun film cu aceste criterii 😕','error'); return; }

  const picks = [];
  const copy = [...pool];
  for (let i=0; i<S.randomN && copy.length; i++) {
    const idx = Math.floor(Math.random()*copy.length);
    picks.push(copy.splice(idx,1)[0]);
  }
  renderRandomPickerModal(decades, picks);
}

// ════════════════════════════════════════════════════
// DRAWER
// ════════════════════════════════════════════════════
function openDrawer() {
  document.body.classList.add('drawer-open');
  // Update sort label
  const allOpts = [...SORT_OPTIONS.all, ...SORT_OPTIONS.watched];
  const found = allOpts.find(o => o.value === S.sort);
  const lbl = $('#drawer-sort-label');
  if (lbl && found) lbl.textContent = found.label;
}

function closeDrawer() {
  document.body.classList.remove('drawer-open');
}

function setView(v) {
  S.view = v;
  localStorage.setItem('bt_view', v);
  syncViewButtons();
  render();
}

function syncViewButtons() {
  $('#view-grid-btn')?.classList.toggle('view-btn--active', S.view === 'grid');
  $('#view-list-btn')?.classList.toggle('view-btn--active', S.view === 'list');
  $('#view-diary-btn')?.classList.toggle('view-btn--active', S.view === 'diary');
}

// ════════════════════════════════════════════════════

async function initApp() {
  $$('.nav__item').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));
  $('#btn-menu').addEventListener('click', openDrawer);
  $('#btn-search').addEventListener('click', () => {
    if (document.body.classList.contains('search-open')) closeSearch();
    else openSearch();
  });
  $('#search-input')?.addEventListener('input', e => {
    S.search = e.target.value;
    document.body.classList.toggle('has-search', !!S.search);
    render();
  });
  $('#btn-search-clear')?.addEventListener('click', closeSearch);
  $('#overlay').addEventListener('click',e=>{ if(e.target===$('#overlay'))closeModal(); });

  try {
    await dbInit();
    S.movies = await dbLoadMovies();
    if (!Object.keys(S.movies).length) { showToast('Prima rulare — se importă datele…'); await doSync(); }
    else prefetchTmdb(); // Enrich în fundal la fiecare pornire
  } catch(e) { showToast('Firebase error: '+e.message,'error'); console.error(e); }

  S.loading=false;
  try { render(); }
  catch(e) {
    console.error('Render error v' + BT_VERSION + ':', e);
    $('#main').innerHTML = `<div class="empty"><div class="empty__icon">⚠️</div><p class="empty__text">Eroare la încărcare.<br>Deschide consola pentru detalii.</p></div>`;
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
document.addEventListener('DOMContentLoaded', initApp);
