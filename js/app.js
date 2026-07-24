// BluTracker v2.0
const BT_VERSION = '2.0';

// ─── app.js — BluTracker PWA ─────────────────────────────────
'use strict';

// ════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════
const S = {
  movies:  {},
  tab:     'unwatched',
  view:    (localStorage.getItem('bt_view')==='diary' ? 'grid' : localStorage.getItem('bt_view')) || 'grid',
  diaryMode: false,
  expanded: new Set(),
  search:  '',
  activeFilters: new Set(),
  filterDecades: new Set(),
  filterRuntimeMin: 0,
  filterRuntimeMax: 999,
  collapsed: new Set(['csect-done']),
  randomN: 1,
  randomMaxRuntime: 999,
  randomDecades: new Set(),
  achievedMilestones: null,
  activityLog: [],
  lastUndo: null,
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

// Strip leading "The"/"A"/"An" for alphabetical sorting (display unaffected)
function sortTitle(title) {
  return (title||'').replace(/^(the|a|an)\s+/i, '').toLowerCase();
}

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
  // Advanced: decade (OR logic across selected decades)
  if (S.filterDecades.size > 0) {
    out = out.filter(m => {
      const yr = parseInt(m.year);
      if (isNaN(yr)) return false;
      return S.filterDecades.has(Math.floor(yr/10)*10);
    });
  }
  // Advanced: runtime range
  if (S.filterRuntimeMin > 0 || S.filterRuntimeMax < 999) {
    out = out.filter(m => {
      if (!m.runtime) return false;
      return m.runtime >= S.filterRuntimeMin && m.runtime <= S.filterRuntimeMax;
    });
  }
  switch (S.sort) {
    case 'za':           return out.sort((a,b)=>sortTitle(b.title).localeCompare(sortTitle(a.title)));
    case 'year-desc':    return out.sort((a,b)=>(b.year||'0').localeCompare(a.year||'0'));
    case 'year-asc':     return out.sort((a,b)=>(a.year||'9999').localeCompare(b.year||'9999'));
    case 'runtime-desc': return out.sort((a,b)=>(b.runtime||0)-(a.runtime||0));
    case 'runtime-asc':  return out.sort((a,b)=>(a.runtime||0)-(b.runtime||0));
    case 'last-watch-desc':  return out.sort((a,b)=>lastDate(b).localeCompare(lastDate(a)));
    case 'first-watch-asc':  return out.sort((a,b)=>firstDate(a).localeCompare(firstDate(b)));
    case 'watch-count-desc': return out.sort((a,b)=>(b.watchHistory?.length||0)-(a.watchHistory?.length||0));
    case 'watch-count-asc':  return out.sort((a,b)=>(a.watchHistory?.length||0)-(b.watchHistory?.length||0));
    default:             return out.sort((a,b)=>sortTitle(a.title).localeCompare(sortTitle(b.title)));
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
  if (S.diaryMode) { renderDiary(main, movies); return; }
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

  const del = mk('button','comm-card__del','🗑');
  del.title = 'Șterge film din colecție';
  del.onclick = e => { e.stopPropagation(); openFilmDetail(m.id); };
  hdr.append(poster, info, del);
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
const allFeatDone = m => (!m.hasGenericFeatures||m.genericFeaturesWatched) && (m.specialFeatures||[]).every(f=>f.watched);

function renderFeatures(main) {
  main.innerHTML = '';
  main.appendChild(makeToolbar(withFeat().length, 'features'));
  const all = filterSort(withFeat());
  if (!all.length) { main.appendChild(emptyState('🎞', S.search?'Niciun rezultat.':'Niciun film cu features.\nDin tab-ul Văzute → ⚙ Disc pe fiecare film.')); return; }

  const featStatus = m => {
    const spec = m.specialFeatures||[];
    const genOK = !m.hasGenericFeatures || m.genericFeaturesWatched;
    const specDone = spec.filter(f=>f.watched).length;
    if (genOK && specDone===spec.length) return 'done';
    if ((m.hasGenericFeatures&&m.genericFeaturesWatched) || specDone>0) return 'partial';
    return 'pending';
  };

  const GROUPS = [
    { key:'fsect-pending', label:'Niciun feature bifat', dotCls:'status-dot--pending', filter:m=>featStatus(m)==='pending' },
    { key:'fsect-partial', label:'Parțial bifate',        dotCls:'status-dot--partial', filter:m=>featStatus(m)==='partial' },
    { key:'fsect-done',    label:'Complet bifate',        dotCls:'status-dot--done',    filter:m=>featStatus(m)==='done' },
  ];

  GROUPS.forEach(g => {
    const movies = all.filter(g.filter);
    if (!movies.length) return;
    const isOpen = !S.collapsed.has(g.key);
    const section = mk('div','comm-section'+(isOpen?' comm-section--open':''));
    const hdr = mk('div','comm-section-hdr');
    hdr.innerHTML =
      '<div class="comm-section-left">'+
        '<span class="status-dot '+g.dotCls+'"></span>'+
        '<span class="comm-section-label">'+esc(g.label)+'</span>'+
      '</div>'+
      '<div class="comm-section-right">'+
        '<span class="comm-section-count">'+movies.length+'</span>'+
        '<span class="comm-section-arrow">›</span>'+
      '</div>';
    hdr.onclick = () => { S.collapsed.has(g.key)?S.collapsed.delete(g.key):S.collapsed.add(g.key); render(); };
    section.appendChild(hdr);
    const body = mk('div','comm-section-body');
    if (isOpen) movies.forEach(m => body.appendChild(featCard(m)));
    section.appendChild(body);
    main.appendChild(section);
  });
}

function featCard(m) {
  const spec = m.specialFeatures||[];
  const genDone = !m.hasGenericFeatures || m.genericFeaturesWatched;
  const specDone = spec.filter(f=>f.watched).length;
  const totalItems = (m.hasGenericFeatures?1:0) + spec.length;
  const doneItems  = (genDone&&m.hasGenericFeatures?1:0) + specDone;
  const key = 'fcard-'+m.id;
  const isExpanded = S.expanded.has(key);

  const card = mk('div','comm-card'+(isExpanded?' comm-card--expanded':''));
  const hdr = mk('div','comm-card__header');
  hdr.onclick = () => { toggle(key); render(); };

  const poster = mk('div','comm-card__poster');
  const img = mk('img'); img.alt=m.title; img.loading='lazy';
  img.src = m.tmdbPosterUrl||m.posterUrl||posterPlaceholder(m.title);
  img.onerror=()=>{img.src=posterPlaceholder(m.title);};
  poster.appendChild(img);

  const info = mk('div','comm-card__info');
  info.appendChild(mk('div','comm-card__title', m.title));
  if (m.year||m.runtime) info.appendChild(mk('div','comm-card__meta',
    [m.year, m.runtime?m.runtime+'m':''].filter(Boolean).join(' · ')));

  const prog = mk('div','comm-card__progress');
  const dots = mk('div','track-dots');
  if (m.hasGenericFeatures) dots.appendChild(mk('span','track-dot'+(m.genericFeaturesWatched?' track-dot--on':'')));
  spec.forEach(f=>dots.appendChild(mk('span','track-dot'+(f.watched?' track-dot--on':''))));
  prog.append(dots, mk('span','track-count', doneItems+'/'+totalItems));
  info.appendChild(prog);

  const del = mk('button','comm-card__del','🗑');
  del.title='Șterge film din colecție';
  del.onclick = e => { e.stopPropagation(); openFilmDetail(m.id); };
  hdr.append(poster, info, del);
  card.appendChild(hdr);

  if (isExpanded) {
    const expand = mk('div','comm-card__expand');
    if (m.hasGenericFeatures) {
      const row = mk('div','track-row'+(m.genericFeaturesWatched?' track-row--watched':''));
      const chk = mk('button','track-check'+(m.genericFeaturesWatched?' track-check--on':''),m.genericFeaturesWatched?'✓':'');
      chk.onclick = e => { e.stopPropagation(); doToggleGenericFeatures(m.id); };
      row.append(chk, mk('span','track-label','🎬 Extras generice'));
      expand.appendChild(row);
    }
    spec.forEach(f => {
      const row = mk('div','track-row track-row--special'+(f.watched?' track-row--watched':''));
      const chk = mk('button','track-check'+(f.watched?' track-check--on':''),f.watched?'✓':'');
      chk.onclick = e => { e.stopPropagation(); doToggleSpecialFeature(m.id,f.id); };
      const lbl = mk('span','track-label'); lbl.innerHTML='<span class="feat-star">★</span> '+esc(f.name);
      row.append(chk, lbl, mk('span','track-date', f.watchDate?fmtDate(f.watchDate):''));
      expand.appendChild(row);
    });
    const addBtn = mk('button','btn btn--ghost btn--sm track-add-btn','+ Feature special');
    addBtn.onclick = e => { e.stopPropagation(); openAddFeatureModal(m.id); };
    expand.appendChild(addBtn);
    card.appendChild(expand);
  }
  return card;
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

function refetchBtn(id) {
  // Return HTML string with data-id to avoid JS event listener loss via outerHTML
  return '<button class="btn btn--ghost btn--sm" style="margin-bottom:6px;width:100%" ' +
         'onclick="openRefetchModal(this.dataset.id)" data-id="' + esc(id) + '">' +
         '🔄 Re-fetch TMDB</button>';
}

function renderDetailModal(id) {
  const m        = S.movies[id];
  const poster   = m.tmdbPosterUrl || m.posterUrl || posterPlaceholder(m.title);
  const history  = [...(m.watchHistory||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const commN    = (m.commentaryTracks||[]).length;
  const pendingN = (m.commentaryTracks||[]).filter(t=>!t.watched).length;

  const historyRows = history.map((w,i) => {
    const idx = m.watchHistory.indexOf(w); // original index for edit/delete
    return '<div class="wh-row">'+
      '<button class="wh-date-btn" onclick="openEditWatchDate(\''+id+'\','+idx+')">'+
        '<span class="wh-date">'+(fmtDate(w.date)||'— fără dată —')+'</span>'+
        '<span class="wh-edit-icon">✎</span>'+
      '</button>'+
      '<button class="wh-del-btn" onclick="confirmDeleteWatchEntry(\''+id+'\','+idx+')" title="Șterge">✕</button>'+
    '</div>';
  }).join('');

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
      ${history.length ? `
        <div class="detail-stat" style="margin-bottom:8px">Vizionări (${history.length}):</div>
        <div class="wh-list">${historyRows}</div>
      ` : '<div class="detail-stat"><em style="color:var(--text-2)">Nevăzut</em></div>'}
      ${commN ? `<div class="detail-stat" style="margin-top:10px">🎙 ${commN-pendingN}/${commN} commentary</div>` : ''}
    </div>
    <div class="detail-actions-row">
      <button class="btn btn--ghost btn--sm" onclick="closeModal();openSetupDiscModal('${id}')">⚙ Disc</button>
      ${commN ? `<button class="btn btn--ghost btn--sm" onclick="closeModal();S.tab='commentaries';S.expanded.add('comm-${id}');render()">🎙 Comentarii</button>` : ''}
      ${m.hasGenericFeatures||(m.specialFeatures?.length>0) ? `<button class="btn btn--ghost btn--sm" onclick="closeModal();S.tab='features';S.expanded.add('fcard-${id}');render()">🎞 Extras</button>` : ''}
    </div>
    ${!history.length ? `<button class="btn btn--primary btn--full" style="margin-top:10px" onclick="closeModal();openMarkWatchedModal('${id}')">▶ Marchează văzut</button>` : `<button class="btn btn--ghost btn--sm" style="margin-top:6px" onclick="closeModal();openAddWatchModal('${id}')">+ Vizionare nouă</button>`}
    <div class="detail-danger">
      ${m.tmdbId ? '<button class="btn btn--ghost btn--sm" style="margin-bottom:6px;width:100%" onclick="refetchTmdb(&quot;'+id+'&quot;)">🔄 Re-fetch TMDB</button>' : ''}
      <button class="btn btn--danger btn--full" onclick="confirmDeleteModal('${id}')">🗑 Șterge din colecție</button>
    </div>`;

  openModal(m.title, body, '');
}

function openEditWatchDate(id, idx) {
  const m = S.movies[id];
  const entry = m.watchHistory[idx];
  if (!entry) return;
  openModal('Editează data',
    `<p class="modal__subtitle">${esc(m.title)}</p>
     <div class="field"><label>Data vizionării</label><input type="date" id="ewd-date" value="${entry.date||today()}"></div>`,
    `<button class="btn btn--ghost" onclick="renderDetailModal('${id}')">Anulează</button>
     <button class="btn btn--accent" onclick="confirmEditWatchDate('${id}',${idx})">✓ Salvează</button>`);
}

async function confirmEditWatchDate(id, idx) {
  const newDate = $('#ewd-date').value;
  if (!newDate) { showToast('Introdu o dată.','error'); return; }
  try {
    S.movies[id] = await dbEditWatchDate(id, idx, newDate);
    logAction('✎', S.movies[id].title, 'Dată vizionare editată → '+fmtDate(newDate), null);
    renderDetailModal(id);
    showToast('Dată actualizată ✓','success');
  } catch(e) { showToast('Eroare: '+e.message,'error'); }
}

function confirmDeleteWatchEntry(id, idx) {
  const m = S.movies[id];
  const entry = m.watchHistory[idx];
  if (!entry) return;
  openModal('Șterge vizionare',
    `<p>Ștergi vizionarea din <strong>${fmtDate(entry.date)||'—'}</strong>?</p>`,
    `<button class="btn btn--ghost" onclick="renderDetailModal('${id}')">Anulează</button>
     <button class="btn btn--danger" onclick="doDeleteWatchEntry('${id}',${idx})">🗑 Șterge</button>`);
}

async function doDeleteWatchEntry(id, idx) {
  const m = S.movies[id];
  const entry = m.watchHistory[idx];
  try {
    S.movies[id] = await dbRemoveWatch(id, entry);
    logAction('🗑', S.movies[id].title, 'Vizionare ștearsă ('+ (fmtDate(entry.date)||'—') +')', null);
    renderDetailModal(id);
    render();
    showToast('Vizionare ștearsă ✓','success');
  } catch(e) { showToast('Eroare: '+e.message,'error'); }
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
    const title = S.movies[id].title;
    await dbDeleteMovie(id);
    delete S.movies[id];
    logAction('🗑', title, 'Șters din colecție', null); // no undo for delete
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
    const yr = m.year || '';  // year saved from blu-ray.com or manually entered
    let hit = null;

    // Search with year for accurate matching (avoids wrong decade remakes)
    if (yr) {
      const r = await fetch(TMDB_BASE+'/search/movie?api_key='+TMDB_API_KEY+'&query='+q+'&year='+yr+'&language=en-US');
      const d = await r.json();
      if (d.results?.length) {
        const target = parseInt(yr);
        hit = d.results.reduce((best, r) => {
          const ry = parseInt(r.release_date?.substring(0,4)||'0');
          const by = parseInt(best.release_date?.substring(0,4)||'0');
          return Math.abs(ry-target) < Math.abs(by-target) ? r : best;
        });
      }
    }
    // Fallback: without year
    if (!hit) {
      const r1 = await fetch(TMDB_BASE+'/search/movie?api_key='+TMDB_API_KEY+'&query='+q+'&language=en-US');
      const d1 = await r1.json();
      hit = d1.results?.[0];
    }
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

function openRefetchModal(id) {
  const m = S.movies[id];
  openModal(
    '🔄 Re-fetch TMDB',
    '<p class="modal__subtitle">' + esc(m.title) + '</p>' +
    '<p style="font-size:13px;color:var(--text-2);margin-bottom:14px">' +
    'Introdu anul de producție pentru matching precis (ex: 1989 pentru Cold Light of Day).</p>' +
    '<div class="field"><label>Anul filmului</label>' +
    '<input type="number" id="refetch-year" value="' + (m.year||'') + '" min="1900" max="2030" placeholder="ex: 1989">' +
    '</div>',
    '<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>' +
    '<button class="btn btn--accent" onclick="doRefetchTmdb(&quot;' + id + '&quot;)">✓ Caută</button>'
  );
}

async function doRefetchTmdb(id) {
  // Read value BEFORE closeModal removes the DOM
  const year = ($('#refetch-year')?.value || '').trim();
  closeModal();
  showToast('Se caută pe TMDB…');
  try {
    // Save year first so enrichWithTmdb uses it
    const upd = { tmdbId: firebase.firestore.FieldValue.delete(),
                  tmdbPosterUrl: firebase.firestore.FieldValue.delete(),
                  overview: firebase.firestore.FieldValue.delete(),
                  voteAverage: firebase.firestore.FieldValue.delete(),
                  directors: firebase.firestore.FieldValue.delete(),
                  runtime: firebase.firestore.FieldValue.delete() };
    if (year) upd.year = year;
    await _db.collection('movies').doc(id).update(upd);
    const doc = await _db.collection('movies').doc(id).get();
    S.movies[id] = doc.data();
    await enrichWithTmdb(id);
    render();
    showToast('TMDB actualizat ✓', 'success');
  } catch(e) { showToast('Eroare: ' + e.message, 'error'); }
}

// Legacy alias
async function refetchTmdb(id) { openRefetchModal(id); }

// Preîncarcă TMDB pentru toate filmele fără date (în fundal, throttled)
async function prefetchTmdb() {
  if (!TMDB_API_KEY) return;
  const missing = Object.keys(S.movies).filter(id => !S.movies[id].tmdbId);
  if (!missing.length) return; // all enriched, skip
  console.log('TMDB prefetch:', missing.length, 'films to enrich');
  for (const id of missing) {
    if (!S.movies[id]) continue; // film might have been deleted
    await enrichWithTmdb(id);
    await new Promise(r => setTimeout(r, 350));
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
       <button class="toggle" id="mw-feat-toggle" onclick="toggleFeatInline(this)"></button>
     </div></div>
     <div class="field" id="mw-special-wrap" style="display:none">
       <label>Feature special (opțional)</label>
       <input type="text" id="mw-special-name" placeholder="ex: Heart of Darkness (1991)">
     </div>`,
    `<button class="btn btn--ghost" onclick="closeModal()">Anulează</button>
     <button class="btn btn--accent" onclick="confirmMarkWatched('${id}')">✓ Confirmă</button>`);
}

function toggleFeatInline(btn) {
  btn.classList.toggle('toggle--on');
  const wrap = $('#mw-special-wrap');
  if (wrap) wrap.style.display = btn.classList.contains('toggle--on') ? '' : 'none';
}

async function confirmMarkWatched(id) {
  const date=($('#mw-date').value||today()), commN=parseInt($('#mw-comm').value)||0, hasFeat=$('#mw-feat-toggle').classList.contains('toggle--on');
  const specialName = ($('#mw-special-name')?.value||'').trim();
  closeModal(); showToast('Se salvează…');
  try {
    let data = await dbAddWatch(id, date);
    if (commN>0||hasFeat) data = await dbSetExtras(id, commN, hasFeat);
    if (hasFeat && specialName) data = await dbAddSpecialFeature(id, specialName);
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
  try { 
    S.movies[id]=await dbAddWatch(id,date);
    const wh=S.movies[id].watchHistory;
    logAction('✓', S.movies[id].title, 'Vizionare adăugată — '+fmtDate(date), async () => {
      await doDeleteWatch(id, wh[wh.length-1]);
    });
    render(); showToast('Vizionare adăugată ✓','success'); setTimeout(checkAndFireMilestones,500); }
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
  try {
    const title = S.movies[id].title;
    S.movies[id]=await dbToggleCommentary(id,idx);
    const t = S.movies[id].commentaryTracks[idx];
    logAction('🎙', title, 'Commentary '+(idx+1)+' '+(t.watched?'bifat ✓':'debifat'),
      async () => { S.movies[id]=await dbToggleCommentary(id,idx); render(); });
    render();
  } catch(e){showToast('Eroare: '+e.message,'error');}
}
async function doAddCommentaryTrack(id) {
  try { S.movies[id]=await dbAddCommentaryTrack(id); render(); showToast('Track adăugat ✓','success'); } catch(e){showToast('Eroare: '+e.message,'error');}
}
async function doToggleGenericFeatures(id) {
  try {
    const title = S.movies[id].title;
    S.movies[id]=await dbToggleGenericFeatures(id);
    const done = S.movies[id].genericFeaturesWatched;
    logAction('🎞', title, 'Extras generice '+(done?'bifate ✓':'debifate'),
      async () => { S.movies[id]=await dbToggleGenericFeatures(id); render(); });
    render();
  } catch(e){showToast('Eroare: '+e.message,'error');}
}
async function doToggleSpecialFeature(id,featId) {
  try {
    const title = S.movies[id].title;
    S.movies[id]=await dbToggleSpecialFeature(id,featId);
    const feat = (S.movies[id].specialFeatures||[]).find(f=>f.id===featId);
    if (feat) logAction('★', title, '"'+feat.name+'" '+(feat.watched?'bifat ✓':'debifat'),
      async () => { S.movies[id]=await dbToggleSpecialFeature(id,featId); render(); });
    render();
  } catch(e){showToast('Eroare: '+e.message,'error');}
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
      const {added,updated,addedTitles,movies}=await dbSync(colData,seedData,S.movies);
      S.movies=movies;
      (addedTitles||[]).forEach(title => logAction('📦', title, 'Adăugat în colecție (sync blu-ray.com)', null));
      showToast(`Sync OK — ${added} noi, ${updated} actualizate ✓`,'success');
    } else {
      const {added,addedTitles,movies}=await dbSeedOnly(seedData,S.movies);
      S.movies=movies;
      (addedTitles||[]).forEach(title => logAction('📦', title, 'Adăugat din seed', null));
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
  S.diaryMode = false; // navigarea prin bara de jos arata mereu lista alfabetica normala
  S.activeFilters.clear();
  syncFilterBadge();
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
// STATS — CALUP E
// ════════════════════════════════════════════════════

function openStats() {
  const panel = $('#stats-panel');
  if (!panel) return;
  if (panel.classList.contains('visible')) { closeStats(); return; }
  panel.classList.add('visible');
  document.body.classList.add('stats-open');
  setTimeout(renderStats, 80);
}

function closeStats() {
  $('#stats-panel')?.classList.remove('visible');
  document.body.classList.remove('stats-open');
}

// ── Data aggregation ─────────────────────────────────
function computeStats() {
  const all = list();
  const w = watched();
  const allTracks = all.flatMap(m => m.commentaryTracks||[]);
  const watchedTracks = allTracks.filter(t => t.watched);
  const watchEvents = [];
  w.forEach(m => (m.watchHistory||[]).forEach(wh => {
    if (wh.date && wh.date.length >= 10) watchEvents.push({date:wh.date, title:m.title, runtime:m.runtime||0});
  }));
  watchEvents.sort((a,b)=>a.date.localeCompare(b.date));

  // Decade map
  const decadeMap = {};
  all.forEach(m => {
    const yr = parseInt(m.year);
    const key = isNaN(yr) ? '?' : String(Math.floor(yr/10)*10);
    if (!decadeMap[key]) decadeMap[key] = {total:0, watched:0};
    decadeMap[key].total++;
    if (m.watchHistory?.length) decadeMap[key].watched++;
  });

  // Monthly (last 18 months)
  const monthMap = {};
  const now = new Date();
  for (let i=11;i>=0;i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    monthMap[d.toISOString().substring(0,7)] = 0;
  }
  watchEvents.forEach(e => { const k=e.date.substring(0,7); if(k in monthMap) monthMap[k]++; });

  // Runtime buckets
  const rb = {'sub 90m':0,'90-120m':0,'120-150m':0,'150m+':0,'?':0};
  all.forEach(m => {
    const r = m.runtime||0;
    if (!r) rb['?']++;
    else if (r<90) rb['sub 90m']++;
    else if (r<120) rb['90-120m']++;
    else if (r<150) rb['120-150m']++;
    else rb['150m+']++;
  });

  // Top directors
  const dm = {};
  all.forEach(m => (m.directors||[]).forEach(d => {
    if (!dm[d]) dm[d]={total:0,watched:0};
    dm[d].total++;
    if (m.watchHistory?.length) dm[d].watched++;
  }));
  const directors = Object.entries(dm).sort((a,b)=>b[1].total-a[1].total).slice(0,7)
    .map(([name,data])=>({name,...data}));

  // Features
  const withGenFeat = all.filter(m=>m.hasGenericFeatures);
  const allSpecial = all.flatMap(m=>m.specialFeatures||[]);
  const fullDisc = all.filter(m => {
    const t=m.commentaryTracks||[];
    return m.watchHistory?.length && t.length>=4 && t.every(x=>x.watched);
  }).length;

  // Heatmap (last 365 days)
  const heatmap = {};
  const yr = new Date(); yr.setFullYear(yr.getFullYear()-1);
  watchEvents.forEach(e => { if(new Date(e.date+'T12:00:00')>=yr) heatmap[e.date]=(heatmap[e.date]||0)+1; });

  // Longest films
  const longestWatched = [...w].filter(m=>m.runtime).sort((a,b)=>b.runtime-a.runtime).slice(0,3);
  const longestUnwatched = [...unwatched()].filter(m=>m.runtime).sort((a,b)=>b.runtime-a.runtime).slice(0,3);

  // Favorite decade
  const watchedDecades = Object.entries(decadeMap).filter(([k])=>k!=='?').sort((a,b)=>b[1].watched-a[1].watched);
  const favDecade = watchedDecades[0];

  // Max month
  const maxMonth = Object.entries(monthMap).reduce((mx,[k,v])=>v>mx[1]?[k,v]:mx, ['',0]);

  // Comm status counts
  const cByStatus = {pending:0,partial:0,done:0,none:0};
  all.forEach(m => { const s=commStatus(m); if(s) cByStatus[s]++; else cByStatus.none++; });

  const totalMin = w.reduce((s,m)=>s+(m.runtime||0),0);
  return {
    total:all.length, watched:w.length, unwatched:unwatched().length,
    watchedPct: all.length?Math.round(w.length/all.length*100):0,
    totalMin, totalHours:Math.floor(totalMin/60), totalDays:Math.floor(totalMin/60/24),
    commTotal:allTracks.length, commWatched:watchedTracks.length,
    watchEvents, cByStatus, decadeMap, monthMap, rb, directors,
    withGenFeat:withGenFeat.length, genFeatWatched:withGenFeat.filter(m=>m.genericFeaturesWatched).length,
    allSpecial:allSpecial.length, specialWatched:allSpecial.filter(f=>f.watched).length,
    fullDisc, heatmap, longestWatched, longestUnwatched, favDecade, maxMonth,
    firstWatch:watchEvents[0]?.date, lastWatch:watchEvents[watchEvents.length-1]?.date,
  };
}

// ── Render ───────────────────────────────────────────
function renderStats() {
  const el = $('#stats-content');
  if (!el) return;
  el.innerHTML = '';
  let s;
  try { s = computeStats(); }
  catch(e) { el.innerHTML='<div class="empty"><p class="empty__text">Eroare la calcul statistici: '+esc(String(e.message))+'</p></div>'; console.error('computeStats error:',e); return; }

  const addSection = (fn, name) => {
    try { const sec = fn(s); if(sec) el.appendChild(sec); }
    catch(e) {
      console.error('Stats section error ('+name+'):', e);
      const err=mk('div','stats-section');
      err.innerHTML='<p style="color:var(--red);font-size:13px">⚠ '+name+': '+esc(e.message)+'</p>';
      el.appendChild(err);
    }
  };

  // Hero cards
  try { el.appendChild(makeStatsHero(s)); } catch(e) { console.error('hero error:',e); }

  addSection(s => {
    const sec=mk('div','stats-section');
    sec.appendChild(mk('div','stats-section-title','Progres colecție'));
    const w=mk('div','chart-wrap'); w.appendChild(makeDonutsRow(s)); sec.appendChild(w); return sec;
  }, 'donuts');

  addSection(s => {
    const sec=mk('div','stats-section');
    sec.appendChild(mk('div','stats-section-title','Distribuție pe decadă'));
    const w=mk('div','chart-wrap'); w.appendChild(makeDecadeChart(s)); sec.appendChild(w); return sec;
  }, 'decade');

  addSection(s => {
    const sec=mk('div','stats-section');
    sec.appendChild(mk('div','stats-section-title','Activitate lunară (12 luni)'));
    sec.appendChild(makeMonthlyChart(s)); return sec;
  }, 'monthly');

  addSection(s => {
    const sec=mk('div','stats-section');
    sec.appendChild(mk('div','stats-section-title','Calendar activitate (3 luni)'));
    const w=mk('div','heatmap-wrap'); w.appendChild(makeHeatmap(s.heatmap)); sec.appendChild(w); return sec;
  }, 'heatmap');

  addSection(s => {
    const sec=mk('div','stats-section');
    sec.appendChild(mk('div','stats-section-title','Distribuție durată'));
    const w=mk('div','chart-wrap'); w.appendChild(makeRuntimeChart(s)); sec.appendChild(w); return sec;
  }, 'runtime');

  if (s.directors.length) addSection(s => {
    const sec=mk('div','stats-section');
    sec.appendChild(mk('div','stats-section-title','Top regizori'));
    const w=mk('div','chart-wrap'); w.appendChild(makeDirectorsChart(s)); sec.appendChild(w); return sec;
  }, 'directors');

  addSection(makeFeaturesStats, 'features');
  addSection(makeFunStats, 'funstats');
  addSection(makeAchievementsSection, 'achievements');
  addSection(()=>makeActivityLogSection(), 'activitylog');
}

// ── Hero ─────────────────────────────────────────────
function makeStatsHero(s) {
  const wrap = mk('div','stats-hero');
  const cards = [
    { val: s.watched + ' / ' + s.total, lbl: 'filme văzute (' + s.watchedPct + '%)', accent: true },
    { val: s.totalDays + 'z ' + (s.totalHours%24) + 'h', lbl: 'timp total' },
    { val: s.commWatched + ' / ' + s.commTotal, lbl: 'commentary tracks' },
    { val: s.watchEvents.length, lbl: 'vizionări totale (cu rewatches)' },
  ];
  cards.forEach(c => {
    const card = mk('div','stats-hero-card'+(c.accent?' stats-hero-card--accent':''));
    const v = mk('div','stats-hero-val',String(c.val));
    const l = mk('div','stats-hero-lbl',c.lbl);
    card.append(v,l); wrap.appendChild(card);
  });
  return wrap;
}

// ── Donut chart (SVG) ─────────────────────────────────
function makeSVGDonut(segments, label, sublabel) {
  const r = 54, cx = 80, cy = 80, thick = 18, circ = 2*Math.PI*r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 160 160');
  svg.style.cssText = 'width:100%;max-width:150px;display:block;';

  const bg = document.createElementNS(ns,'circle');
  bg.setAttribute('cx',cx); bg.setAttribute('cy',cy); bg.setAttribute('r',r);
  bg.setAttribute('fill','none'); bg.setAttribute('stroke','var(--surface-2)');
  bg.setAttribute('stroke-width',thick);
  svg.appendChild(bg);

  let offset = 0;
  segments.forEach((seg,i) => {
    if (!seg.pct) return;
    const arc = document.createElementNS(ns,'circle');
    arc.setAttribute('cx',cx); arc.setAttribute('cy',cy); arc.setAttribute('r',r);
    arc.setAttribute('fill','none'); arc.setAttribute('stroke',seg.color);
    arc.setAttribute('stroke-width',thick);
    arc.setAttribute('stroke-dasharray','0 '+circ);
    arc.style.cssText = 'transform:rotate(-90deg);transform-origin:'+cx+'px '+cy+'px;transition:stroke-dasharray 0.9s ease '+(i*0.15)+'s;';
    arc.setAttribute('stroke-dashoffset',(-offset/100*circ));
    svg.appendChild(arc);
    const dash = seg.pct/100*circ;
    setTimeout(()=>{arc.setAttribute('stroke-dasharray',dash+' '+circ);},120+i*100);
    offset += seg.pct;
  });

  const t1 = document.createElementNS(ns,'text');
  t1.setAttribute('x',cx); t1.setAttribute('y',cy-6);
  t1.setAttribute('text-anchor','middle'); t1.setAttribute('font-size','20');
  t1.setAttribute('font-weight','800'); t1.setAttribute('fill','var(--text)');
  t1.textContent = label;
  const t2 = document.createElementNS(ns,'text');
  t2.setAttribute('x',cx); t2.setAttribute('y',cy+14);
  t2.setAttribute('text-anchor','middle'); t2.setAttribute('font-size','10');
  t2.setAttribute('fill','var(--text-2)');
  t2.textContent = sublabel;
  svg.append(t1,t2);
  return svg;
}

function makeDonutsRow(s) {
  const row = mk('div','donuts-row');
  const p = s.total ? Math.round(s.watched/s.total*100) : 0;

  // Donut 1: watched vs unwatched
  const d1 = mk('div','donut-item');
  d1.appendChild(makeSVGDonut(
    [{pct:p,color:'var(--green)'},{pct:100-p,color:'var(--surface-2)'}],
    p+'%','văzut'
  ));
  const l1 = mk('div','donut-legend');
  [{c:'var(--green)',t:'Văzute'},{c:'var(--surface-2)',t:'Nevăzute'}].forEach(({c,t})=>{
    const li=mk('div','legend-item');
    const dot=mk('span','legend-dot'); dot.style.background=c;
    li.append(dot,document.createTextNode(t)); l1.appendChild(li);
  });
  d1.appendChild(l1); row.appendChild(d1);

  // Donut 2: commentary status
  if (s.commTotal > 0) {
    const cPct = Math.round(s.commWatched/s.commTotal*100);
    const pendN = s.cByStatus.pending, partN = s.cByStatus.partial, doneN = s.cByStatus.done;
    const tot2 = pendN+partN+doneN||1;
    const d2 = mk('div','donut-item');
    d2.appendChild(makeSVGDonut([
      {pct:Math.round(doneN/tot2*100),color:'var(--green)'},
      {pct:Math.round(partN/tot2*100),color:'var(--amber)'},
      {pct:Math.round(pendN/tot2*100),color:'var(--red)'},
    ], cPct+'%','tracks'));
    const l2 = mk('div','donut-legend');
    [{c:'var(--green)',t:'Complete'},{c:'var(--amber)',t:'Parțial'},{c:'var(--red)',t:'Niciun track'}].forEach(({c,t})=>{
      const li=mk('div','legend-item');
      const dot=mk('span','legend-dot'); dot.style.background=c;
      li.append(dot,document.createTextNode(t)); l2.appendChild(li);
    });
    d2.appendChild(l2); row.appendChild(d2);
  }
  return row;
}

// ── Decade chart ─────────────────────────────────────
function makeDecadeChart(s) {
  const wrap = mk('div');
  const entries = Object.entries(s.decadeMap)
    .sort((a,b) => a[0]==='?'?1:b[0]==='?'?-1:parseInt(a[0])-parseInt(b[0]));
  const maxTotal = Math.max(...entries.map(([,d])=>d.total),1);
  entries.forEach(([decade,d]) => {
    const row = mk('div','bar-h-row');
    const lbl = mk('div','bar-h-label', decade==='?' ? '?' : decade+'s');
    const track = mk('div','bar-h-track');
    const fillTotal = mk('div','bar-h-fill-sub');
    fillTotal.style.background='var(--text-3)';
    fillTotal.style.width='0%';
    const fill = mk('div','bar-h-fill');
    fill.style.background='var(--accent)';
    fill.style.width='0%';
    track.append(fillTotal,fill);
    const val = mk('div','bar-h-val', d.watched+'/'+d.total);
    row.append(lbl,track,val);
    wrap.appendChild(row);
    const pTotal = d.total/maxTotal*100;
    const pWatched = d.watched/maxTotal*100;
    setTimeout(()=>{ fillTotal.style.width=pTotal+'%'; fill.style.width=pWatched+'%'; },120);
  });
  return wrap;
}

// ── Monthly chart ─────────────────────────────────────
function makeMonthlyChart(s) {
  const container = mk('div','bar-v-container');
  const entries = Object.entries(s.monthMap);
  const maxVal = Math.max(...entries.map(([,v])=>v),1);
  const wrap = mk('div','bar-v-wrap');
  const labelsEl = mk('div','bar-v-labels');
  const MO = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'];
  entries.forEach(([month,count]) => {
    const col = mk('div','bar-v-col');
    const bar = mk('div','bar-v-bar'+(count===0?' bar-v-bar--zero':''));
    bar.style.height='0px';
    if (count > 0) {
      bar.style.cursor = 'pointer';
      bar.onclick = () => openMonthFilmsModal(month, s.watchEvents);
    }
    col.appendChild(bar); wrap.appendChild(col);
    setTimeout(()=>{ bar.style.height = (count/maxVal*88)+'px'; },120);
    const lbl = mk('div','bar-v-label', MO[parseInt(month.substring(5,7))-1]);
    labelsEl.appendChild(lbl);
  });
  container.append(wrap,labelsEl);
  return container;
}

function openMonthFilmsModal(monthKey, watchEvents) {
  const films = watchEvents.filter(e => e.date.substring(0,7) === monthKey)
    .sort((a,b)=>a.date.localeCompare(b.date));
  const d = new Date(monthKey+'-15T12:00:00');
  const monthName = d.toLocaleDateString('ro-RO',{month:'long',year:'numeric'});
  const rows = films.map(f =>
    '<div class="month-film-row">'+
      '<span class="month-film-date">'+fmtDate(f.date)+'</span>'+
      '<span class="month-film-title">'+esc(f.title)+'</span>'+
      (f.runtime?'<span class="month-film-rt">'+f.runtime+'m</span>':'')+
    '</div>'
  ).join('');
  openModal('📅 '+monthName.charAt(0).toUpperCase()+monthName.slice(1),
    '<div class="month-films-list">'+rows+'</div>',
    '<button class="btn btn--ghost" onclick="closeModal()">Închide</button>');
}

// ── Heatmap ───────────────────────────────────────────
function makeHeatmap(heatmapData) {
  const CELL=24, GAP=4, ROWS=7, ns='http://www.w3.org/2000/svg';
  const today=new Date();
  const start=new Date(today); start.setMonth(start.getMonth()-3);
  start.setDate(start.getDate()-start.getDay());
  const cols=Math.ceil((today-start)/(7*24*3600000))+1;
  const W=cols*(CELL+GAP)+1, H=ROWS*(CELL+GAP)+26;
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 '+W+' '+H);
  svg.style.cssText='width:'+W+'px;min-width:'+W+'px;display:block;';

  const COLORS=['var(--surface-2)','#1c3a2e','#2d6b47','var(--green)'];
  const MO=['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec'];
  let cur=new Date(start), col=0, row=0, lastM=-1;

  while(cur<=today) {
    if(row===0 && cur.getMonth()!==lastM) {
      const t=document.createElementNS(ns,'text');
      t.setAttribute('x',col*(CELL+GAP)); t.setAttribute('y',12);
      t.setAttribute('font-size','11'); t.setAttribute('fill','var(--text-2)');
      t.setAttribute('font-weight','600');
      t.textContent=MO[cur.getMonth()]; svg.appendChild(t);
      lastM=cur.getMonth();
    }
    const ds=cur.toISOString().substring(0,10);
    const cnt=heatmapData[ds]||0;
    const lvl=cnt===0?0:cnt===1?1:cnt<=3?2:3;
    const rect=document.createElementNS(ns,'rect');
    rect.setAttribute('x',col*(CELL+GAP)); rect.setAttribute('y',row*(CELL+GAP)+18);
    rect.setAttribute('width',CELL); rect.setAttribute('height',CELL);
    rect.setAttribute('rx',4); rect.setAttribute('fill',COLORS[lvl]);
    svg.appendChild(rect);
    cur.setDate(cur.getDate()+1); row++;
    if(row===7){row=0;col++;}
  }
  return svg;
}

// ── Runtime chart ─────────────────────────────────────
function makeRuntimeChart(s) {
  const wrap = mk('div');
  const keys = ['sub 90m','90-120m','120-150m','150m+','?'];
  const maxVal = Math.max(...keys.map(k=>s.rb[k]),1);
  keys.forEach(k => {
    const val = s.rb[k];
    if (!val) return;  // skip empty buckets
    const row = mk('div','runtime-row');
    const lbl = mk('div','runtime-label',k);
    const track = mk('div','runtime-track');
    const fill = mk('div','runtime-fill'); fill.style.width='0%';
    track.appendChild(fill);
    const v = mk('div','runtime-val',String(val));
    row.append(lbl,track,v); wrap.appendChild(row);
    setTimeout(()=>{ fill.style.width=(val/maxVal*100)+'%'; },120);
  });
  return wrap;
}

// ── Directors chart ───────────────────────────────────
function makeDirectorsChart(s) {
  const wrap = mk('div');
  const dirs = [...s.directors].sort((a,b)=>b.total-a.total); // sort by collection size
  const maxTotal = Math.max(...dirs.map(d=>d.total), 1);
  dirs.forEach(d => {
    const row = mk('div','director-row');
    const nm  = mk('div','director-name', d.name);
    const track = mk('div','director-track');
    const fill  = mk('div','director-fill');
    fill.style.width = '100%'; // fill the entire track
    fill.style.background = 'transparent';
    track.appendChild(fill);
    const v = mk('div','director-val', d.watched+'/'+d.total);
    v.title = d.watched+' văzute din '+d.total+' în colecție';
    row.append(nm, track, v);
    wrap.appendChild(row);
    // CSS gradient: purple=watched, dim=rest of collection, transparent=beyond
    const wPct = (d.watched/maxTotal*100).toFixed(1);
    const tPct = (d.total/maxTotal*100).toFixed(1);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      fill.style.background =
        'linear-gradient(90deg,'+
        '#7c6fcd '+wPct+'%,'+
        'rgba(255,255,255,0.09) '+wPct+'%,'+
        'rgba(255,255,255,0.09) '+tPct+'%,'+
        'transparent '+tPct+'%)';
    }));
  });
  return wrap;
}

// ── Features stats ────────────────────────────────────
function makeFeaturesStats(s) {
  const sec = mk('div','stats-section');
  sec.appendChild(mk('div','stats-section-title','Extras & Features'));
  const wrap = mk('div','chart-wrap');

  const items = [
    { label:'Extras generice', val:s.genFeatWatched, total:s.withGenFeat },
    { label:'Features speciale', val:s.specialWatched, total:s.allSpecial },
  ];
  items.forEach(item => {
    if (!item.total) return;
    const div = mk('div','feat-progress');
    const lbl = mk('div','feat-progress-label');
    lbl.innerHTML = '<span>'+esc(item.label)+'</span><span>'+item.val+'/'+item.total+'</span>';
    const track = mk('div','feat-progress-track');
    const fill = mk('div','feat-progress-fill'); fill.style.width='0%';
    track.appendChild(fill);
    div.append(lbl,track); wrap.appendChild(div);
    const pct = item.total?Math.round(item.val/item.total*100):0;
    setTimeout(()=>{ fill.style.width=pct+'%'; },120);
  });
  if (s.fullDisc > 0) {
    const txt = mk('div','fun-stat');
    txt.innerHTML = '<span class="fun-stat__icon">💿</span><span class="fun-stat__text">Filme cu disc 100% complet (watched + 4+ commentary): <strong>'+s.fullDisc+'</strong></span>';
    wrap.appendChild(txt);
  }
  sec.appendChild(wrap);
  return sec;
}

// ── Fun stats ─────────────────────────────────────────
function makeFunStats(s) {
  const sec = mk('div','stats-section');
  sec.appendChild(mk('div','stats-section-title','Fapte'));
  const wrap = mk('div');

  const fmtDate2 = d => d ? new Date(d+'T12:00:00').toLocaleDateString('ro-RO',{month:'long',year:'numeric'}) : '—';
  const items = [];

  if (s.totalDays > 0) items.push({icon:'⏱',text:'Ai petrecut <strong>'+s.totalDays+' zile și '+s.totalHours%24+' ore</strong> urmărind filme.'});
  if (s.favDecade) items.push({icon:'🗓',text:'Decada favorită: <strong>'+s.favDecade[0]+'s</strong> ('+s.favDecade[1].watched+' filme văzute).'});
  if (s.longestWatched.length) {
    const tops = s.longestWatched.map(m=>esc(m.title)+' ('+m.runtime+'m)').join(', ');
    items.push({icon:'🎬',text:'Cele mai lungi văzute: <strong>'+tops+'</strong>.'});
  }
  if (s.longestUnwatched.length) {
    const tops = s.longestUnwatched.map(m=>esc(m.title)+' ('+m.runtime+'m)').join(', ');
    items.push({icon:'📼',text:'Cele mai lungi nevăzute: <strong>'+tops+'</strong>.'});
  }
  if (s.maxMonth[1] > 0) {
    const d=new Date(s.maxMonth[0]+'-15T12:00:00');
    const ml=d.toLocaleDateString('ro-RO',{month:'long',year:'numeric'});
    items.push({icon:'🔥',text:'Luna cea mai activă: <strong>'+ml+'</strong> ('+s.maxMonth[1]+' vizionări).'});
  }
  if (s.firstWatch) items.push({icon:'📅',text:'Prima vizionare înregistrată: <strong>'+fmtDate2(s.firstWatch)+'</strong>.'});
  const toGo = s.total - s.watched;
  if (toGo > 0) items.push({icon:'🎯',text:'Ești la <strong>'+toGo+' filme</strong> distanță de colecție 100% văzută.'});
  if (s.watchedPct === 100) items.push({icon:'🏆',text:'<strong>Colecție 100% văzută!</strong> Legendă.'});
  
  // Runtime stats
  const avgRuntime = s.watched > 0 
    ? Math.round(s.watchEvents.reduce((a,e)=>a+e.runtime,0) / Math.max(s.watchEvents.length,1))
    : 0;
  if (avgRuntime > 0) items.push({icon:'⏱',text:'Durată medie vizionată: <strong>'+avgRuntime+' minute</strong>.'});
  
  // Commentary dedication
  const commPct = s.commTotal ? Math.round(s.commWatched/s.commTotal*100) : 0;
  if (commPct > 0) items.push({icon:'🎓',text:'Ai văzut <strong>'+commPct+'%</strong> din toate commentary tracks disponibile.'});
  if (s.fullDisc > 0) items.push({icon:'💿',text:'<strong>'+s.fullDisc+' disc'+(s.fullDisc>1?'uri':'')+' consumate 100%</strong> (watched + toate commentary-urile, minim 4 tracks).'});
  
  // Collector badge
  if (s.total >= 100) items.push({icon:'📦',text:'Colecție de <strong>'+s.total+' titluri</strong> — cinefil serios.'});

  items.forEach(({icon,text}) => {
    const row = mk('div','fun-stat');
    row.innerHTML = '<span class="fun-stat__icon">'+icon+'</span><span class="fun-stat__text">'+text+'</span>';
    wrap.appendChild(row);
  });
  sec.appendChild(wrap);
  return sec;
}


// ════════════════════════════════════════════════════
// ACTIVITY LOG
// ════════════════════════════════════════════════════
const MAX_LOG = 60;

function logAction(icon, movieTitle, actionDesc, undoFn = null) {
  const entry = {
    id: String(Date.now()),
    ts: new Date().toISOString(),
    icon, movieTitle, actionDesc
  };
  S.activityLog.unshift({...entry, undoFn});
  S.lastUndo = undoFn ? {fn: undoFn, desc: actionDesc, title: movieTitle} : null;
  if (S.activityLog.length > MAX_LOG) S.activityLog.length = MAX_LOG;
  // Persist (best-effort, no await)
  const toSave = S.activityLog.slice(0,MAX_LOG).map(({undoFn:_,...e})=>e);
  firebase.firestore().collection('config').doc('activityLog')
    .set({entries: toSave}).catch(()=>{});
}

async function loadActivityLog() {
  try {
    const doc = await firebase.firestore().collection('config').doc('activityLog').get();
    if (doc.exists) {
      const entries = doc.data().entries || [];
      // Merge with any in-memory entries (keep undoFn for recent actions)
      const inMemIds = new Set(S.activityLog.map(e=>e.id));
      const remote = entries.filter(e=>!inMemIds.has(e.id)).map(e=>({...e,undoFn:null}));
      S.activityLog = [...S.activityLog, ...remote].slice(0,MAX_LOG);
    }
  } catch(e) {}
}

async function undoLast() {
  if (!S.lastUndo?.fn) { showToast('Nimic de anulat.'); return; }
  try {
    await S.lastUndo.fn();
    showToast('Anulat: ' + S.lastUndo.title + ' — ' + S.lastUndo.desc, 'success');
    S.lastUndo = null;
    S.movies = await dbLoadMovies();
    render();
  } catch(e) { showToast('Eroare la anulare: ' + e.message, 'error'); }
}

function fmtRelTime(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const min = Math.floor(diff/60000);
  const h = Math.floor(min/60);
  const d = Math.floor(h/24);
  if (min < 2) return 'acum';
  if (min < 60) return 'acum ' + min + ' min';
  if (h < 24) return 'acum ' + h + 'h';
  if (d < 7) return d === 1 ? 'ieri' : 'acum ' + d + ' zile';
  return new Date(isoStr).toLocaleDateString('ro-RO');
}

function makeActivityLogSection() {
  const sec = mk('div','stats-section');
  const title = mk('div','stats-section-title');
  title.innerHTML = '📋 Activitate recentă';
  
  const undoBtn = mk('button','btn btn--ghost btn--sm');
  undoBtn.style.cssText='margin-left:auto;font-size:12px;';
  undoBtn.textContent = '↩ Anulează ultima';
  undoBtn.disabled = !S.lastUndo;
  undoBtn.onclick = undoLast;
  title.appendChild(undoBtn);
  sec.appendChild(title);

  if (!S.activityLog.length) {
    const empty = mk('div','log-empty','Nicio activitate înregistrată în această sesiune.');
    sec.appendChild(empty);
    return sec;
  }

  const list = mk('div');
  S.activityLog.slice(0,30).forEach(entry => {
    const row = mk('div','log-entry');
    const icon = mk('div','log-icon', entry.icon);
    const body = mk('div','log-body');
    const t = mk('div','log-title', entry.movieTitle);
    const a = mk('div','log-action', entry.actionDesc);
    const tm = mk('div','log-time', fmtRelTime(entry.ts));
    body.append(t, a, tm);
    row.append(icon, body);
    if (entry.undoFn) {
      const ud = mk('div','log-undo');
      const b = mk('button','log-undo-btn','↩');
      b.onclick = async () => {
        try { await entry.undoFn(); entry.undoFn=null;
          S.movies = await dbLoadMovies(); render(); showToast('Anulat ✓','success');
        } catch(e) { showToast('Eroare: '+e.message,'error'); }
      };
      ud.appendChild(b); row.appendChild(ud);
    }
    list.appendChild(row);
  });
  sec.appendChild(list);
  return sec;
}


// ════════════════════════════════════════════════════
// ACHIEVEMENTS — CALUP F
// ════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────
// MILESTONE TRACKING FLAG
// false = achievements vizibile dar nu se declanșează notificări
// true  = notificările se activează pentru acțiuni noi
// Schimbă în GitHub: js/app.js → caută MILESTONES_TRACKING_ENABLED
// ─────────────────────────────────────────────────────────────
const MILESTONES_TRACKING_ENABLED = true;

function getAchievementDefs(stats) {
  const monthsProductiv = Object.values(stats.monthMap||{}).filter(v=>v>=5).length;
  const decadesExplored = Object.entries(stats.decadeMap||{})
    .filter(([k,v])=>k!=='?'&&v.watched>0).length;

  const defs = [
    { id:'watched', icon:'🎬', name:'Cineast în formare', desc:'Filme văzute',
      val:stats.watched,
      levels:[{t:'🥉',n:50},{t:'🥈',n:150},{t:'🥇',n:400},{t:'💎',n:1000}] },
    { id:'rewatches', icon:'🔄', name:'Văzut și iar văzut', desc:'Vizionări totale cu rewatches',
      val:stats.watchEvents.length,
      levels:[{t:'🥉',n:1},{t:'🥈',n:10},{t:'🥇',n:30},{t:'💎',n:75},{t:'⭐',n:150},{t:'♾️',n:300}] },
    { id:'productive', icon:'📅', name:'Luna productivă', desc:'Luni cu 5+ filme văzute',
      val:monthsProductiv,
      levels:[{t:'🥉',n:1},{t:'🥈',n:5},{t:'🥇',n:10},{t:'💎',n:20}] },
    { id:'comm_pct', icon:'🎙', name:'Audiofil', desc:'Commentary tracks văzute (număr)',
      val:stats.commWatched,
      levels:[{t:'🥉',n:10},{t:'🥈',n:50},{t:'🥇',n:150},{t:'💎',n:300},{t:'⭐',n:500}] },
    { id:'comm_serious', icon:'🎓', name:'Commentary serios', desc:'Filme cu 4+ tracks toate bifate',
      val:stats.fullDisc,
      levels:[{t:'🥉',n:1},{t:'🥈',n:3},{t:'🥇',n:5},{t:'💎',n:10}] },
    { id:'decades_exp', icon:'🗓', name:'Explorator de epoci', desc:'Decade diferite explorate',
      val:decadesExplored,
      levels:[{t:'🥉',n:2},{t:'🥈',n:4},{t:'🥇',n:6},{t:'💎',n:8}] },
    { id:'features', icon:'🌟', name:'Features hunter', desc:'Features speciale văzute',
      val:stats.specialWatched,
      levels:[{t:'🥉',n:1},{t:'🥈',n:5},{t:'🥇',n:10},{t:'💎',n:25}] },
    { id:'collection', icon:'📦', name:'Colecționar', desc:'Titluri în colecție',
      val:stats.total,
      levels:[{t:'🥉',n:50},{t:'🥈',n:150},{t:'🥇',n:300},{t:'💎',n:500},{t:'⭐',n:1000}] },
  ];

  // Per-decade achievements (dynamic)
  Object.entries(stats.decadeMap||{}).filter(([k])=>k!=='?').sort().forEach(([decade,data])=>{
    defs.push({
      id:'dec_'+decade, icon:'📽', name:'Ani '+decade+'s',
      desc:'Văzute din '+decade+'s: '+data.watched+'/'+data.total,
      val:data.watched, small:true,
      levels:[{t:'🥉',n:5},{t:'🥈',n:10},{t:'🥇',n:25}],
    });
  });

  return defs.map(a=>{
    let curLvl=-1;
    a.levels.forEach((l,i)=>{ if(a.val>=l.n) curLvl=i; });
    const nextLvl = curLvl<a.levels.length-1 ? a.levels[curLvl+1] : null;
    const pct = nextLvl ? Math.min(100,Math.round(a.val/nextLvl.n*100)) : 100;
    const tier = curLvl>=0 ? a.levels[curLvl].t : null;
    const cls = !tier?'--locked':tier==='💎'||tier==='⭐'||tier==='♾️'?'--diamond':tier==='🥇'?'--gold':'';
    return {...a, curLvl, curTier:tier, nextLvl, pct, cls};
  });
}

function makeAchCard(a) {
  const card = mk('div','ach-card ach-card'+a.cls);
  card.style.cursor = 'pointer';
  card.onclick = () => openAchievementHistory(a.id);
  const icon = mk('div','ach-icon',a.icon);
  const body = mk('div','ach-body');
  const hdr  = mk('div','ach-header');
  hdr.append(mk('div','ach-name',a.name), mk('div','ach-tier',a.curTier||'🔒'));
  if (!a.small) body.appendChild(mk('div','ach-desc',a.desc));
  const track = mk('div','ach-progress-track');
  const fill  = mk('div','ach-progress-fill'); fill.style.width='0%';
  track.appendChild(fill);
  const lbl = mk('div','ach-progress-label');
  const sx = a.suffix||'';
  lbl.textContent = a.nextLvl
    ? a.val+sx+' / '+a.nextLvl.n+sx+' → '+a.nextLvl.t
    : a.val+sx+' — MAX '+a.curTier;
  body.append(hdr, track, lbl);
  card.append(icon, body);
  setTimeout(()=>{ fill.style.width=a.pct+'%'; }, 150);
  return card;
}

function makeAchievementsSection(stats) {
  const achs = getAchievementDefs(stats);
  const sec  = mk('div','stats-section');
  const ttl  = mk('div','stats-section-title'); ttl.innerHTML='🏆 Achievements';
  sec.appendChild(ttl);

  const unlocked = achs.filter(a=>a.curTier).length;
  sec.appendChild(mk('div','ach-summary', unlocked+'/'+achs.length+' deblocate'));

  // Main achievements grid
  const grid = mk('div','ach-grid');
  achs.filter(a=>!a.small).forEach(a=>grid.appendChild(makeAchCard(a)));
  sec.appendChild(grid);

  // Per-decade (compact)
  const dec = achs.filter(a=>a.small);
  if (dec.length) {
    sec.appendChild(mk('div','ach-subsection-title','📅 Per decadă'));
    const dg = mk('div','ach-grid');
    dec.forEach(a=>dg.appendChild(makeAchCard(a)));
    sec.appendChild(dg);
  }
  return sec;
}

// ── MILESTONES ─────────────────────────────────────────────
const MILESTONES = [
  {id:'w_first', icon:'🎬', title:'Primul film! 🎬', desc:'Prima vizionare înregistrată.', check:s=>s.watched>=1},
  {id:'w_50',    icon:'🍿', title:'Abia te-ai încălzit 🍿', desc:'50 filme văzute.', check:s=>s.watched>=50},
  {id:'w_150',   icon:'⚡', title:'Un start serios ⚡', desc:'150 filme văzute.', check:s=>s.watched>=150},
  {id:'w_400',   icon:'🎓', title:'Cinefil confirmat 🎓', desc:'400 filme văzute.', check:s=>s.watched>=400},
  {id:'w_50pct', icon:'🏁', title:'Jumătatea drumului 🏁', desc:'50% din colecție văzută.', check:s=>s.watchedPct>=50},
  {id:'w_100pct',icon:'🏆', title:'Colecție completă. Legendă. 🏆', desc:'Ai văzut tot!', check:s=>s.watchedPct>=100},
  {id:'rw_first',icon:'🔄', title:'Nu te-ai săturat? Bine! 🔄', desc:'Prima re-vizionare.', check:s=>s.watchEvents.length>s.watched&&s.watched>0},
  {id:'rw_10',   icon:'🔄', title:'Se vede că ai favorite 🔄', desc:'10 re-vizionări totale.', check:s=>s.watchEvents.length>=s.watched+10},
  {id:'rw_30',   icon:'🔄', title:'Colecție trăită, nu decorativă 🎬', desc:'30 re-vizionări totale.', check:s=>s.watchEvents.length>=s.watched+30},
  {id:'c_first', icon:'🎙', title:'Ai auzit și ce au de zis 🎙', desc:'Primul commentary track bisat.', check:s=>s.commWatched>=1},
  {id:'c_50',    icon:'🎙', title:'Audiofil în devenire 🎙', desc:'50 commentary tracks văzute.', check:s=>s.commWatched>=50},
  {id:'c_150',   icon:'🎙', title:'Audiofil convins 🎙', desc:'150 commentary tracks văzute.', check:s=>s.commWatched>=150},
  {id:'c_4plus', icon:'🎓', title:'Cinefil serios 🎓', desc:'Ai terminat toate tracks la un film cu minim 4 commentaries.', check:s=>s.fullDisc>=1},
  {id:'c_5film', icon:'🎓', title:'Commentary dedicat 🎓', desc:'5 filme cu toate comentariile văzute.', check:s=>s.fullDisc>=5},
  {id:'pm_first',icon:'📅', title:'Luna productivă 📅', desc:'5+ filme vizionate într-o singură lună.', check:s=>Object.values(s.monthMap).some(v=>v>=5)},
  {id:'f_first', icon:'★',  title:'Dincolo de film ★', desc:'Primul feature special terminat.', check:s=>s.specialWatched>=1},
  {id:'f_10',    icon:'🌟', title:'Features completionist 🌟', desc:'10 features speciale văzute.', check:s=>s.specialWatched>=10},
  {id:'disc_100',icon:'💿', title:'Zero neexplorat 💿', desc:'Disc 100% complet (watched + 4+ commentary).', check:s=>s.fullDisc>=1},
  {id:'col_50',  icon:'📦', title:'Cincizeci 📦', desc:'50 de titluri în colecție.', check:s=>s.total>=50},
  {id:'col_150', icon:'📦', title:'O sută cincizeci 📦', desc:'150 de titluri în colecție.', check:s=>s.total>=150},
  {id:'col_300', icon:'💯', title:'Trei sute. Respect. 💯', desc:'300 de titluri în colecție.', check:s=>s.total>=300},
  {id:'col_1000',icon:'👑', title:'Colecție de nețintuit 👑', desc:'1000 de titluri în colecție.', check:s=>s.total>=1000},
];

async function loadAchievedMilestones() {
  S.achievedMilestones = new Set();
  try {
    const doc = await firebase.firestore().collection('config').doc('milestones').get();
    if (doc.exists) (doc.data().achieved||[]).forEach(id=>S.achievedMilestones.add(id));
  } catch(e) {}
}

async function loadAchievementHistory() {
  S.achievementHistory = {};
  try {
    const doc = await firebase.firestore().collection('config').doc('achievementHistory').get();
    if (doc.exists) S.achievementHistory = doc.data().history || {};
  } catch(e) {}
}

/**
 * Ruleaza O SINGURA DATA (verificat prin flag-ul baselineApplied in Firestore):
 * marcheaza tot ce e deja atins — milestones si nivele de achievement — ca "deja
 * cunoscut", FARA sa declanseze toast-uri de celebrare. Asta evita un "potop"
 * de notificari retroactive cand se activeaza tracking-ul pe o colectie deja avansata.
 */
async function ensureMilestoneBaseline() {
  try {
    const ref = firebase.firestore().collection('config').doc('milestones');
    const doc = await ref.get();
    const data = doc.exists ? doc.data() : {};
    if (data.baselineApplied) return; // deja aplicat candva, nu se repeta

    const stats = computeStats();

    // Baseline milestones (one-time toasts)
    const achieved = new Set(data.achieved || []);
    MILESTONES.forEach(m => { if (m.check(stats)) achieved.add(m.id); });
    await ref.set({ achieved:[...achieved], baselineApplied:true, ts:new Date().toISOString() });
    S.achievedMilestones = achieved;

    // Baseline achievement history (nivele deja atinse, data necunoscuta -> null)
    const achs = getAchievementDefs(stats);
    const hist = {};
    achs.forEach(a => {
      const h = {};
      for (let i=0;i<=a.curLvl;i++) h[String(i)] = null; // "atins candva inainte de activare"
      if (Object.keys(h).length) hist[a.id] = h;
    });
    S.achievementHistory = hist;
    await firebase.firestore().collection('config').doc('achievementHistory').set({ history: hist });

    console.log('Milestone baseline aplicat:', achieved.size, 'praguri deja marcate silentios.');
  } catch(e) { console.warn('Eroare baseline milestones:', e); }
}

// Coada de milestone-uri de afisat — daca se declanseaza mai multe simultan,
// se afiseaza pe rand, nu toate deodata
let _milestoneQueue = [];

function checkAndFireMilestones() {
  if (!S.achievedMilestones) return;
  if (!MILESTONES_TRACKING_ENABLED) return;
  const stats = computeStats();
  let changed = false;

  MILESTONES.forEach(m => {
    if (!S.achievedMilestones.has(m.id) && m.check(stats)) {
      S.achievedMilestones.add(m.id);
      _milestoneQueue.push(m);
      logAction('🏆', m.title, m.desc, null);
      changed = true;
    }
  });
  if (changed) {
    firebase.firestore().collection('config').doc('milestones')
      .set({achieved:[...S.achievedMilestones], ts:new Date().toISOString()}, {merge:true}).catch(()=>{});
  }

  // Verifica si nivele noi de achievement (tiered), inregistreaza data atingerii
  checkAchievementLevelUps(stats);

  if (_milestoneQueue.length && !document.body.classList.contains('milestone-visible')) {
    showNextMilestone();
  }
}

function checkAchievementLevelUps(stats) {
  if (!S.achievementHistory) return;
  const achs = getAchievementDefs(stats);
  const today = new Date().toISOString().split('T')[0];
  let changed = false;

  achs.forEach(a => {
    if (a.curLvl < 0) return;
    const hist = S.achievementHistory[a.id] || {};
    for (let i=0; i<=a.curLvl; i++) {
      const k = String(i);
      if (!(k in hist)) { hist[k] = today; changed = true; }
    }
    S.achievementHistory[a.id] = hist;
  });

  if (changed) {
    firebase.firestore().collection('config').doc('achievementHistory')
      .set({history: S.achievementHistory}).catch(()=>{});
  }
}

function openAchievementHistory(achId) {
  const stats = computeStats();
  const achs = getAchievementDefs(stats);
  const a = achs.find(x=>x.id===achId);
  if (!a) return;
  const hist = (S.achievementHistory||{})[achId] || {};

  const rows = a.levels.map((lvl,i) => {
    const reached = i <= a.curLvl;
    const date = hist[String(i)];
    const dateLabel = reached ? (date ? fmtDate(date) : 'anterior activării') : '🔒 blocat';
    return '<div class="ach-hist-row'+(reached?'':' ach-hist-row--locked')+'">'+
      '<span class="ach-hist-tier">'+lvl.t+'</span>'+
      '<span class="ach-hist-desc">'+lvl.n+(a.suffix||'')+'</span>'+
      '<span class="ach-hist-date">'+esc(dateLabel)+'</span>'+
    '</div>';
  }).join('');

  openModal(a.icon+' '+a.name,
    '<p style="font-size:13px;color:var(--text-2);margin-bottom:14px">'+esc(a.desc)+'</p>'+
    '<div class="ach-hist-list">'+rows+'</div>'+
    '<p style="font-size:11px;color:var(--text-3);margin-top:14px;line-height:1.5">'+
    'Datele reflectă momentul detectării progresului, nu neapărat data exactă istorică '+
    '(relevant pentru corecții retroactive în masă).</p>',
    '<button class="btn btn--ghost" onclick="closeModal()">Închide</button>');
}

function showNextMilestone() {
  const m = _milestoneQueue.shift();
  if (!m) { document.body.classList.remove('milestone-visible'); return; }

  let overlay = $('#milestone-overlay');
  if (!overlay) {
    overlay = mk('div',''); overlay.id = 'milestone-overlay';
    document.body.appendChild(overlay);
  }
  const remaining = _milestoneQueue.length;
  overlay.innerHTML =
    '<div class="milestone-card">' +
      '<div class="milestone-icon-big">'+m.icon+'</div>' +
      '<div class="milestone-title-big">'+esc(m.title)+'</div>' +
      '<div class="milestone-desc-big">'+esc(m.desc)+'</div>' +
      (remaining>0 ? '<div class="milestone-queue-note">+'+remaining+' alte praguri atinse</div>' : '') +
      '<button class="btn btn--accent btn--full" onclick="closeMilestoneOverlay()">✓ Super!</button>' +
    '</div>';
  document.body.classList.add('milestone-visible');
  requestAnimationFrame(()=> overlay.classList.add('visible'));
}

function closeMilestoneOverlay() {
  const overlay = $('#milestone-overlay');
  if (overlay) overlay.classList.remove('visible');
  setTimeout(()=>{
    if (_milestoneQueue.length) showNextMilestone();
    else document.body.classList.remove('milestone-visible');
  }, 300);
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
}

function closeSearch() {
  S.search = '';
  document.body.classList.remove('search-open','has-search');
  const inp = $('#search-input');
  if (inp) inp.value = '';
  render();
}

function openFiltersModal() {
  const tabF = TAB_FILTERS[S.tab] || [];
  const decades = [...new Set(list().map(m=>{
    const yr = parseInt(m.year); return isNaN(yr)?null:Math.floor(yr/10)*10;
  }).filter(d=>d!==null))].sort();

  const chipsHTML = tabF.map(f => {
    const active = S.activeFilters.has(f.id);
    return '<button class="chip-filter'+(active?' chip-filter--active':'')+'" onclick="toggleActiveFilter(\''+f.id+'\')">'+f.label+'</button>';
  }).join('');

  const decadeChips = decades.map(d => {
    const active = S.filterDecades.has(d);
    return '<button class="decade-chip'+(active?' decade-chip--active':'')+'" onclick="toggleFilterDecade('+d+')">'+d+'s</button>';
  }).join('');

  openModal('🎚 Filtrează',
    (tabF.length ? `<div class="field"><label>Rapid</label><div class="filter-chips-modal">${chipsHTML}</div></div>` : '') +
    (decades.length ? `<div class="field"><label>Decadă (selecție multiplă)</label><div class="decade-chips">${decadeChips}</div></div>` : '') +
    `<div class="field"><label>Durată</label>
       <div class="range-wrap">
         <div class="range-label"><span>Min: <span id="fadv-min-lbl">${S.filterRuntimeMin}</span>m</span>
                                     <span>Max: <span id="fadv-max-lbl">${S.filterRuntimeMax>=999?'∞':S.filterRuntimeMax+'m'}</span></span></div>
         <input type="range" min="0" max="300" step="15" value="${S.filterRuntimeMin}"
                oninput="updateFilterRuntime('min',this.value)">
         <input type="range" min="0" max="300" step="15" value="${S.filterRuntimeMax>=999?300:S.filterRuntimeMax}"
                oninput="updateFilterRuntime('max',this.value)" style="margin-top:4px">
       </div>
     </div>`,
    `<button class="btn btn--ghost" onclick="resetAllFilters()">Resetează tot</button>
     <button class="btn btn--accent" onclick="closeModal();syncFilterBadge();render()">✓ Aplică</button>`);
}

function toggleActiveFilter(id) {
  if (S.activeFilters.has(id)) S.activeFilters.delete(id);
  else S.activeFilters.add(id);
  openFiltersModal(); // re-render with updated state
}

function toggleFilterDecade(d) {
  if (S.filterDecades.has(d)) S.filterDecades.delete(d);
  else S.filterDecades.add(d);
  openFiltersModal();
}

function updateFilterRuntime(which, val) {
  val = parseInt(val);
  if (which==='min') { S.filterRuntimeMin = val; $('#fadv-min-lbl').textContent = val; }
  else { S.filterRuntimeMax = val>=300?999:val; $('#fadv-max-lbl').textContent = val>=300?'∞':val+'m'; }
}

function resetAllFilters() {
  S.activeFilters.clear();
  S.filterDecades.clear();
  S.filterRuntimeMin = 0;
  S.filterRuntimeMax = 999;
  closeModal();
  syncFilterBadge();
  render();
}

function syncFilterBadge() {
  const active = S.activeFilters.size > 0 || S.filterDecades.size > 0 ||
                 S.filterRuntimeMin > 0 || S.filterRuntimeMax < 999;
  const dot = $('#filter-active-dot');
  if (dot) dot.style.display = active ? 'block' : 'none';
}

// ════════════════════════════════════════════════════
// DIARY VIEW
// ════════════════════════════════════════════════════
function renderDiary(main, movies) {
  // Separa watchHistory entries: cu data valida vs fara data
  const entries = [];
  const noDateFilms = [];
  movies.forEach(m => {
    const wh = m.watchHistory || [];
    let hasValidDate = false;
    wh.forEach(w => {
      if (w.date && w.date > '') { entries.push({...m, watchDate: w.date}); hasValidDate = true; }
    });
    // Film e in "fara data" doar daca NICIUNA din vizionarile lui n-are data valida
    if (wh.length && !hasValidDate) noDateFilms.push(m);
  });
  entries.sort((a,b) => b.watchDate.localeCompare(a.watchDate));

  if (!entries.length && !noDateFilms.length) {
    main.appendChild(emptyState('📅','Nicio dată de vizionare înregistrată.')); return;
  }

  // Sectiune "Fara data" - mereu prima, editabila direct
  if (noDateFilms.length) {
    const hdr = mk('div','diary-month-header','⚠ Fără dată înregistrată ('+noDateFilms.length+')');
    hdr.style.color = 'var(--amber)';
    main.appendChild(hdr);
    noDateFilms.sort((a,b)=>sortTitle(a.title).localeCompare(sortTitle(b.title))).forEach(m => {
      const row = mk('div','diary-row');
      row.onclick = () => openFilmDetail(m.id);
      const dayEl = mk('div','diary-day','?');
      const poster = mk('div','diary-poster');
      const img = mk('img'); img.alt=m.title; img.loading='lazy';
      img.src = m.tmdbPosterUrl||m.posterUrl||posterPlaceholder(m.title);
      img.onerror=()=>{img.src=posterPlaceholder(m.title);};
      poster.appendChild(img);
      const info = mk('div','diary-info');
      info.appendChild(mk('div','diary-title',m.title));
      info.appendChild(mk('div','diary-meta','Tap pentru a edita data vizionării'));
      row.append(dayEl,poster,info);
      main.appendChild(row);
    });
  }

  if (!entries.length) return;

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
    const active = S.randomDecades.has(d);
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
  if (S.randomDecades.has(d)) S.randomDecades.delete(d);
  else S.randomDecades.add(d);
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
  if (S.randomDecades.size > 0) pool = pool.filter(m=>m.year&&S.randomDecades.has(Math.floor(parseInt(m.year)/10)*10));

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
  syncViewButtons();
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
  // Doar grid/list — Jurnal e complet separat, vezi openDiaryView()
  S.view = v;
  localStorage.setItem('bt_view', v);
  syncViewButtons();
  closeDrawer();
  setTimeout(render, 50);
}

function openDiaryView() {
  S.tab = 'watched';
  S.diaryMode = true;
  syncViewButtons();
  syncNav();
  closeDrawer();
  setTimeout(render, 50);
}

function syncViewButtons() {
  $('#view-grid-btn')?.classList.toggle('view-btn--active', !S.diaryMode && S.view === 'grid');
  $('#view-list-btn')?.classList.toggle('view-btn--active', !S.diaryMode && S.view === 'list');
  $('#view-diary-btn')?.classList.toggle('view-btn--active', S.diaryMode);
}

// ════════════════════════════════════════════════════

async function initApp() {
  $$('.nav__item').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));
  $('#btn-menu').addEventListener('click', openDrawer);
  $('#btn-stats')?.addEventListener('click', openStats);
  $('#btn-filter')?.addEventListener('click', openFiltersModal);
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
    loadActivityLog();
    await loadAchievedMilestones();
    await loadAchievementHistory();
    await ensureMilestoneBaseline();
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
