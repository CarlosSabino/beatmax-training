// =====================================================================================
// biblioteca.js — Organização das músicas/treinos (abas, busca, filtro de modo, ordem,
// músicas do osu! agrupadas por música) na tela inicial e na lista do Chart Editor, mais a
// LIXEIRA (excluir não apaga na hora — dá pra desfazer/restaurar por 30 dias) e a
// recuperação de músicas a partir de um arquivo de backup, sem mexer no resto.
// =====================================================================================

const LIB_CFG_KEY = 'djmaxTrainerBiblioteca_v1';
const TRASH_DB = 'djmax-trainer-lixeira';
const TRASH_STORE = 'charts';
const TRASH_DAYS = 30;
let libCfg = { tab: 'all', q: '', mode: '', sort: 'default', edQ: '', edMode: '', edSrc: '', favs: [] };
try { Object.assign(libCfg, JSON.parse(localStorage.getItem(LIB_CFG_KEY) || '{}')); } catch (e) {}
function saveLibCfg() { try { localStorage.setItem(LIB_CFG_KEY, JSON.stringify(libCfg)); } catch (e) {} }

const libNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const LIB_BTN = 'px-2 py-1 rounded text-[11px] font-bold border transition';
const LIB_ON = 'bg-cyan-500/20 border-cyan-400 text-cyan-200';
const LIB_OFF = 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white';
const LIB_SELECT = 'bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200';

// ---------- dados de cada card ----------
function libCardInfo(card) {
    const pat = card.dataset.pattern || '';
    if (!pat.startsWith('custom:')) {
        const dr = typeof DRILLS !== 'undefined' ? DRILLS[pat] : null;
        return { kind: 'drill', title: dr ? dr.title : (card.dataset.title || pat), search: `${dr ? dr.title : ''} ${dr ? dr.skill : ''} ${card.dataset.desc || ''}`, modes: dr && dr.modes ? dr.modes : null, at: 0, notes: 0 };
    }
    const ch = typeof findCustomChart === 'function' ? findCustomChart(pat.slice(7)) : null;
    if (!ch) return { kind: 'custom', title: card.dataset.title || '', search: card.dataset.title || '', modes: null, at: 0, notes: 0 };
    const o = ch.osu || {};
    const songTitle = ch.source === 'osu' ? String(ch.title || '').replace(/\s*\[[^\]]*\]\s*$/, '') : ch.title;
    return {
        kind: ch.source === 'osu' ? 'osu' : 'custom', chart: ch, title: ch.title || '', songTitle,
        group: ch.source === 'osu' ? `osu:${o.setId || songTitle}` : null,
        search: `${ch.title} ${o.creator || ''} ${o.version || ''}`, modes: [ch.mode], at: ch.updatedAt || 0, notes: (ch.notes || []).length, stars: o.stars || 0
    };
}
// ---------- FAVORITAS ----------
// A estrela vale pra MÚSICA (todas as dificuldades e modos dela), não só pra um chart.
function libFavKey(info, card) {
    if (info.kind === 'drill') return 'd:' + (card.dataset.pattern || '');
    if (info.kind === 'osu' && info.group) return 'o:' + info.group;
    return 'c:' + libNorm(info.songTitle || info.title);
}
function libIsFav(key) { return Array.isArray(libCfg.favs) && libCfg.favs.includes(key); }
function libToggleFav(card) {
    if (!card) return;
    const key = libFavKey(libCardInfo(card), card);
    if (!Array.isArray(libCfg.favs)) libCfg.favs = [];
    const i = libCfg.favs.indexOf(key);
    if (i >= 0) libCfg.favs.splice(i, 1); else libCfg.favs.push(key);
    saveLibCfg();
    // NÃO reorganiza a lista: o card fica no mesmo lugar (dá pra favoritar várias em sequência).
    // Só troca a estrela das dificuldades da mesma música e o número da aba.
    libFavSoftUpdate();
    if (typeof libToast === 'function') libToast(i >= 0 ? 'Tirada das favoritas' : '★ Adicionada às favoritas');
}
window.libToggleFavSelected = function () {
    const grid = document.getElementById('pattern-grid');
    const card = grid && grid.querySelector(`.pattern-card[data-pattern="${CSS.escape(currentPatternType || '')}"]`);
    libToggleFav(card);
};
function libFavSoftUpdate() {
    const grid = document.getElementById('pattern-grid'); if (!grid) return;
    let n = 0;
    grid.querySelectorAll('.pattern-card').forEach(c => {
        const info = libCardInfo(c);
        const fav = libIsFav(libFavKey(info, c));
        libStar(c, fav);
        c.classList.toggle('lib-unfav', (libCfg.tab === 'fav') && !fav);
        const modeOk = !libCfg.mode || !info.modes || info.modes.includes(libCfg.mode);
        if (fav && modeOk && !(c.classList.contains('hidden') && info.kind === 'drill')) n++;
    });
    const c = document.querySelector('#lib-tabs [data-lib-tab="fav"] .lib-count'); if (c) c.textContent = `(${n})`;
}
function libStar(card, fav) {
    let b = card.querySelector(':scope > .lib-fav');
    if (!b) {
        b = document.createElement('button');
        b.type = 'button'; b.className = 'lib-fav';
        b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); libToggleFav(card); });
        card.style.position = 'relative';
        card.appendChild(b);
    }
    b.textContent = fav ? '★' : '☆';
    b.title = fav ? 'Tirar das favoritas (F)' : 'Favoritar (F)';
    b.classList.toggle('on', fav);
}
(function libFavCss() {
    const css = document.createElement('style');
    css.textContent = `.pattern-card .lib-fav{position:absolute;top:3px;right:6px;font-size:15px;line-height:1;color:#475569;background:none;border:0;cursor:pointer;padding:2px;opacity:.55;transition:opacity .15s,color .15s,transform .15s}
.pattern-card:hover .lib-fav,.pattern-card .lib-fav:focus{opacity:1}
.pattern-card .lib-fav.on{color:#facc15;opacity:1;text-shadow:0 0 8px rgba(250,204,21,.55)}
.pattern-card .lib-fav:hover{transform:scale(1.2);color:#fde047}
.pattern-card.lib-unfav{opacity:.45}`;
    document.head.appendChild(css);
})();
// tecla F na lista = favoritar a música selecionada
window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyF' || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (typeof menuListaAtiva !== 'function' || !menuListaAtiva()) return;
    e.preventDefault();
    window.libToggleFavSelected();
});

// índice das partidas por música (refeito só quando o histórico ou o modo mudam): antes cada
// card varria o histórico inteiro (até 3000 partidas) a cada vez que a lista era organizada
let libPlaysIdx = null;
function libPlays(pattern) {
    if (typeof runHistory === 'undefined') return { n: 0, best: 0, last: 0 };
    // só as partidas do botão (modo) selecionado — o recorde do 4B não vale pro 6B
    const mode = typeof currentMode !== 'undefined' ? currentMode : null;
    const last0 = runHistory.length ? runHistory[runHistory.length - 1] : null;
    const sig = runHistory.length + '|' + (last0 && last0.id) + '|' + mode;
    if (!libPlaysIdx || libPlaysIdx.sig !== sig) {
        const m = new Map();
        for (const r of runHistory) {
            if (mode && r.mode !== mode) continue;
            let e = m.get(r.pattern); if (!e) { e = { n: 0, best: 0, last: 0 }; m.set(r.pattern, e); }
            e.n++;
            if (!r.failed && !r.section && Math.abs((r.rate || 1) - 1) < 0.001) e.best = Math.max(e.best, r.acc || 0);
            e.last = Math.max(e.last, r.at || 0);
        }
        libPlaysIdx = { sig, m };
    }
    const e = libPlaysIdx.m.get(pattern);
    return e ? { n: e.n, best: e.best, last: e.last } : { n: 0, best: 0, last: 0 };
}

// ---------- barra da tela inicial ----------
let libApplying = false;
function libEnsureToolbar() {
    const grid = document.getElementById('pattern-grid');
    if (!grid || document.getElementById('lib-toolbar')) return grid;
    const bar = document.createElement('div');
    bar.id = 'lib-toolbar';
    bar.className = 'px-3 pt-3 pb-1 flex flex-col gap-1.5 border-b border-slate-800/80';
    bar.innerHTML = `
        <div class="flex flex-wrap gap-1" id="lib-tabs">
            <button data-lib-tab="all" class="${LIB_BTN}">Todos <span class="lib-count opacity-70"></span></button>
            <button data-lib-tab="fav" class="${LIB_BTN}" title="Suas músicas favoritas (estrela no card ou tecla F)">★ Favoritas <span class="lib-count opacity-70"></span></button>
            <button data-lib-tab="drill" class="${LIB_BTN}">Treinos <span class="lib-count opacity-70"></span></button>
            <button data-lib-tab="osu" class="${LIB_BTN}">♪ osu! <span class="lib-count opacity-70"></span></button>
            <button data-lib-tab="custom" class="${LIB_BTN}">✏️ Meus charts <span class="lib-count opacity-70"></span></button>
            <button data-lib-tab="played" class="${LIB_BTN}" title="Só o que você já jogou">Jogados <span class="lib-count opacity-70"></span></button>
            <button id="lib-trash-btn" class="${LIB_BTN} ${LIB_OFF} ml-auto" title="Músicas/charts excluídos (dá pra restaurar)"><i class="fa-solid fa-trash-can-arrow-up mr-1"></i>Lixeira <span id="lib-trash-count"></span></button>
        </div>
        <div class="flex flex-wrap gap-1.5 items-center">
            <div class="relative flex-1 min-w-[140px]">
                <i class="fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500"></i>
                <input id="lib-q" type="search" placeholder="Buscar música, artista, mapper..." class="w-full bg-slate-900 border border-slate-700 rounded pl-6 pr-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400">
            </div>
            <select id="lib-mode" class="${LIB_SELECT}" title="Modo de teclas">
                <option value="">Todos os modos</option><option value="4K">4B</option><option value="5K">5B</option><option value="6K">6B</option><option value="8K">8B</option>
            </select>
            <select id="lib-sort" class="${LIB_SELECT}" title="Ordem">
                <option value="default">Ordem: agrupado</option><option value="name">Nome (A–Z)</option><option value="recent">Mais recentes</option>
                <option value="lastplayed">Jogados por último</option><option value="plays">Mais jogados</option><option value="best">Melhor recorde</option><option value="notes">Mais notas</option>
            </select>
        </div>`;
    grid.parentElement.insertBefore(bar, grid);
    bar.querySelectorAll('[data-lib-tab]').forEach(b => b.addEventListener('click', () => { libCfg.tab = b.dataset.libTab; saveLibCfg(); libApply(); }));
    const q = bar.querySelector('#lib-q');
    q.value = libCfg.q || '';
    q.addEventListener('input', () => { libCfg.q = q.value; saveLibCfg(); libApply(); });
    q.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { q.value = ''; libCfg.q = ''; saveLibCfg(); libApply(); q.blur(); } });
    const m = bar.querySelector('#lib-mode'); m.value = libCfg.mode || ''; m.addEventListener('change', () => {
        libCfg.mode = m.value; saveLibCfg();
        // escolher um modo no filtro também troca o modo do jogo (o botão lá em cima)
        const btn = m.value && m.value !== currentMode ? document.querySelector(`.mode-btn[data-mode="${m.value}"]`) : null;
        if (btn) btn.click(); else { libApply(); libFixSelection(); }
    });
    const s = bar.querySelector('#lib-sort'); s.value = libCfg.sort || 'default'; s.addEventListener('change', () => { libCfg.sort = s.value; saveLibCfg(); libApply(); });
    bar.querySelector('#lib-trash-btn').addEventListener('click', openTrashModal);
    return grid;
}

// depois de trocar o modo: se a música selecionada não é desse modo (ou sumiu da lista),
// seleciona a mesma música nesse modo, se existir — senão a primeira da lista
function libFixSelection() {
    const grid = document.getElementById('pattern-grid');
    if (!grid) return;
    const cur = grid.querySelector(`.pattern-card[data-pattern="${CSS.escape(currentPatternType || '')}"]`);
    const curChart = String(currentPatternType || '').startsWith('custom:') ? findCustomChart(currentPatternType.slice(7)) : null;
    const curOk = cur && cur.style.display !== 'none' && !cur.classList.contains('hidden') && (!curChart || curChart.mode === currentMode);
    if (curOk) return;
    const vis = [...grid.querySelectorAll('.pattern-card')].filter(c => c.style.display !== 'none' && !c.classList.contains('hidden'));
    if (!vis.length) return;
    let pick = null;
    if (curChart) {
        const norm = (t) => String(t || '').trim().toLowerCase();
        pick = vis.find(c => { const ch = String(c.dataset.pattern).startsWith('custom:') ? findCustomChart(c.dataset.pattern.slice(7)) : null; return ch && ch.mode === currentMode && norm(ch.title) === norm(curChart.title); });
    }
    const chOf = (c) => String(c.dataset.pattern).startsWith('custom:') ? findCustomChart(c.dataset.pattern.slice(7)) : null;
    pick = pick || vis.find(c => { const ch = chOf(c); return ch && ch.mode === currentMode; })            // uma música desse modo
        || vis.find(c => !chOf(c) && !/calib/i.test(c.dataset.pattern))                                        // ou um treino (não a calibração)
        || vis.find(c => { const ch = chOf(c); return !ch || ch.mode === currentMode; });
    if (pick) { pick.click(); pick.scrollIntoView({ block: 'nearest' }); }
}

function libHeader(text, sub) {
    const h = document.createElement('div');
    h.className = 'lib-header flex items-baseline justify-between gap-2 px-1 pt-2 pb-0.5 text-[10px] font-bold font-mono uppercase tracking-wider text-slate-400 select-none';
    h.innerHTML = `<span class="truncate">${text}</span>${sub ? `<span class="text-slate-600 normal-case font-normal">${sub}</span>` : ''}`;
    return h;
}
function libSongHeader(title, n) {
    const h = document.createElement('div');
    h.className = 'lib-header lib-song flex items-center gap-2 px-1 pt-1.5 text-[11px] font-bold text-pink-200/90 select-none';
    h.innerHTML = `<span class="text-pink-400">♪</span><span class="truncate">${escapeHtml(title)}</span><span class="text-[10px] font-normal text-slate-500 shrink-0">${n} dificuldade${n > 1 ? 's' : ''}</span>`;
    return h;
}

function libApply() {
    const grid = libEnsureToolbar();
    if (!grid || libApplying) return;
    libApplying = true;
    try {
        // filtro de modo sempre igual ao modo do jogo (a não ser "Todos os modos")
        if (libCfg.mode && typeof currentMode !== 'undefined' && libCfg.mode !== currentMode) {
            libCfg.mode = currentMode; saveLibCfg();
            const sel = document.getElementById('lib-mode'); if (sel) sel.value = libCfg.mode;
        }
        grid.querySelectorAll('.lib-header').forEach(h => h.remove());
        const cards = [...grid.querySelectorAll('.pattern-card')];
        const q = libNorm(libCfg.q).trim();
        const words = q ? q.split(/\s+/) : [];
        const items = cards.map((card, idx) => {
            const info = libCardInfo(card);
            const plays = libPlays(card.dataset.pattern);
            const modeOk = !libCfg.mode || !info.modes || info.modes.includes(libCfg.mode);
            const textOk = !words.length || words.every(w => libNorm(info.search + ' ' + info.title).includes(w));
            const fav = libIsFav(libFavKey(info, card));
            libStar(card, fav);
            return { card, info, plays, idx, modeOk, textOk, fav };
        });
        const counts = { all: 0, fav: 0, drill: 0, osu: 0, custom: 0, played: 0 };
        items.forEach(it => {
            if (!(it.modeOk && it.textOk)) return;
            if (it.card.classList.contains('hidden') && it.info.kind === 'drill') return; // treino de outro modo
            counts.all++; counts[it.info.kind]++; if (it.plays.n) counts.played++; if (it.fav) counts.fav++;
        });
        const tab = libCfg.tab || 'all';
        const visible = items.filter(it => it.modeOk && it.textOk && (tab === 'all' || (tab === 'played' ? it.plays.n > 0 : tab === 'fav' ? it.fav : it.info.kind === tab)));
        const hiddenSet = new Set(items.filter(it => !visible.includes(it)).map(it => it.card));
        items.forEach(it => { it.card.style.display = hiddenSet.has(it.card) ? 'none' : ''; it.card.classList.toggle('lib-indent', false); it.card.classList.remove('lib-unfav'); it.card.style.marginLeft = ''; });

        const sort = libCfg.sort || 'default';
        const by = {
            name: (a, b) => libNorm(a.info.title).localeCompare(libNorm(b.info.title)),
            recent: (a, b) => (b.info.at - a.info.at) || (a.idx - b.idx),
            lastplayed: (a, b) => (b.plays.last - a.plays.last) || (a.idx - b.idx),
            plays: (a, b) => (b.plays.n - a.plays.n) || (a.idx - b.idx),
            best: (a, b) => (b.plays.best - a.plays.best) || (a.idx - b.idx),
            notes: (a, b) => (b.info.notes - a.info.notes) || (a.idx - b.idx)
        };
        const frag = document.createDocumentFragment();
        const kindOrder = { drill: 0, osu: 1, custom: 2 };
        if (sort === 'default') {
            // agrupado: Treinos / Músicas do osu! (cada música com as dificuldades juntas) / Meus charts
            // na aba Favoritas elas ficam juntas; nas outras abas cada uma fica no seu lugar (só ganha a ★)
            const sections = tab === 'fav' ? [['fav', '★ Favoritas']] : [['drill', 'Treinos'], ['osu', 'Músicas do osu!'], ['custom', 'Meus charts']];
            sections.forEach(([kind, label]) => {
                const list = kind === 'fav' ? visible.filter(it => it.fav) : visible.filter(it => it.info.kind === kind);
                const shownN = list.filter(it => !it.card.classList.contains('hidden')).length;
                if (!list.length) return;
                if ((tab === 'all' || tab === 'played' || (tab === 'fav' && kind === 'fav')) && shownN) frag.appendChild(libHeader(label, `${shownN}`));
                if (kind === 'fav') {
                    list.sort((a, b) => (kindOrder[a.info.kind] - kindOrder[b.info.kind]) || libNorm(a.info.songTitle || a.info.title).localeCompare(libNorm(b.info.songTitle || b.info.title)) || (a.idx - b.idx)).forEach(it => frag.appendChild(it.card));
                } else if (kind === 'osu') {
                    const groups = new Map();
                    list.forEach(it => { const g = it.info.group || it.card.id; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); });
                    [...groups.values()].sort((a, b) => libNorm(a[0].info.songTitle).localeCompare(libNorm(b[0].info.songTitle))).forEach(g => {
                        g.sort((a, b) => (a.info.chart.mode || '').localeCompare(b.info.chart.mode || '') || ((a.info.stars || 0) - (b.info.stars || 0)) || (a.info.notes - b.info.notes));
                        frag.appendChild(libSongHeader(g[0].info.songTitle, g.length));
                        g.forEach(it => { it.card.style.marginLeft = '10px'; frag.appendChild(it.card); });
                    });
                } else if (kind === 'custom') {
                    list.sort(by.recent).forEach(it => frag.appendChild(it.card));
                } else list.sort((a, b) => a.idx - b.idx).forEach(it => frag.appendChild(it.card));
            });
        } else {
            visible.sort(by[sort] || ((a, b) => a.idx - b.idx)).forEach(it => frag.appendChild(it.card));
        }
        // escondidos vão pro fim (continuam no DOM pro resto do jogo achar os cards)
        items.filter(it => hiddenSet.has(it.card)).forEach(it => frag.appendChild(it.card));
        grid.appendChild(frag);
        if (!visible.length) {
            const empty = libHeader('Nada encontrado', '');
            empty.classList.add('justify-center', 'py-6', 'normal-case');
            grid.insertBefore(empty, grid.firstChild);
        }
        // abas
        document.querySelectorAll('#lib-tabs [data-lib-tab]').forEach(b => {
            const on = b.dataset.libTab === tab;
            b.className = `${LIB_BTN} ${on ? LIB_ON : LIB_OFF}`;
            const c = b.querySelector('.lib-count'); if (c) c.textContent = counts[b.dataset.libTab] != null ? `(${counts[b.dataset.libTab]})` : '';
        });
    } finally {
        setTimeout(() => { libApplying = false; }, 0);
    }
}
let libQueued = false;
function libQueue() {
    if (libQueued) return;
    libQueued = true;
    setTimeout(() => { libQueued = false; libApply(); }, 40);
}
(function libWatch() {
    const grid = document.getElementById('pattern-grid');
    if (!grid) return;
    new MutationObserver((muts) => {
        if (libApplying) return;
        // card novo/removido (importou, salvou, excluiu) — não reage às próprias reordenações
        if (muts.some(m => [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && n.classList.contains('pattern-card')))) libQueue();
    }).observe(grid, { childList: true });
    // troca de modo esconde/mostra treinos (progress.js) — recalcula contadores
    // botões 4B/5B/6B/8B lá em cima = filtro da lista (só aparece o que é daquele modo)
    document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => {
        libCfg.mode = b.dataset.mode || ''; saveLibCfg();
        const sel = document.getElementById('lib-mode'); if (sel) sel.value = libCfg.mode;
        setTimeout(() => { libApply(); libFixSelection(); }, 60);
    }));
    libApply();
    // o card selecionado aparece na tela
    setTimeout(() => { const sel = grid.querySelector(`.pattern-card[data-pattern="${CSS.escape(currentPatternType || '')}"]`); if (sel && sel.style.display !== 'none') sel.scrollIntoView({ block: 'nearest' }); }, 300);
})();

// ---------- lista do Chart Editor ----------
(function editorListFilters() {
    const list = document.getElementById('editor-chart-list');
    if (!list || document.getElementById('ed-lib-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'ed-lib-bar';
    bar.className = 'px-2 py-1.5 flex flex-col gap-1 border-b border-slate-800';
    bar.innerHTML = `
        <input id="ed-lib-q" type="search" placeholder="Buscar chart..." class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400">
        <div class="flex gap-1">
            <select id="ed-lib-src" class="${LIB_SELECT} flex-1"><option value="">Todos</option><option value="custom">Meus charts</option><option value="osu">osu!</option></select>
            <select id="ed-lib-mode" class="${LIB_SELECT}"><option value="">Modo</option><option value="4K">4B</option><option value="5K">5B</option><option value="6K">6B</option><option value="8K">8B</option></select>
            <button id="ed-lib-trash" title="Lixeira" class="px-2 rounded border border-slate-700 bg-slate-800/60 text-slate-300 hover:text-white text-[11px]"><i class="fa-solid fa-trash-can-arrow-up"></i></button>
        </div>
        <span id="ed-lib-count" class="text-[9px] text-slate-500 font-mono"></span>`;
    list.parentElement.insertBefore(bar, list);
    const q = bar.querySelector('#ed-lib-q'), src = bar.querySelector('#ed-lib-src'), md = bar.querySelector('#ed-lib-mode');
    q.value = libCfg.edQ || ''; src.value = libCfg.edSrc || ''; md.value = libCfg.edMode || '';
    q.addEventListener('input', () => { libCfg.edQ = q.value; saveLibCfg(); applyEditorListFilter(); });
    q.addEventListener('keydown', (e) => e.stopPropagation());
    src.addEventListener('change', () => { libCfg.edSrc = src.value; saveLibCfg(); applyEditorListFilter(); });
    md.addEventListener('change', () => { libCfg.edMode = md.value; saveLibCfg(); applyEditorListFilter(); });
    bar.querySelector('#ed-lib-trash').addEventListener('click', openTrashModal);
})();
const _libOrigRenderEditorList = window.renderEditorChartList;
window.renderEditorChartList = function () {
    const out = _libOrigRenderEditorList.apply(this, arguments);
    applyEditorListFilter();
    return out;
};
function applyEditorListFilter() {
    const list = document.getElementById('editor-chart-list');
    if (!list) return;
    // as linhas saem na mesma ordem da lista (mais recente primeiro)
    const sorted = [...customCharts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const rows = [...list.children].filter(r => r.querySelector('button'));
    const words = libNorm(libCfg.edQ).trim().split(/\s+/).filter(Boolean);
    let shown = 0;
    rows.forEach((row, i) => {
        const ch = sorted[i];
        if (!ch) return;
        row.dataset.chartId = ch.id;
        const kind = ch.source === 'osu' ? 'osu' : 'custom';
        const ok = (!libCfg.edSrc || libCfg.edSrc === kind) && (!libCfg.edMode || ch.mode === libCfg.edMode) &&
            (!words.length || words.every(w => libNorm(`${ch.title} ${(ch.osu && ch.osu.creator) || ''}`).includes(w)));
        row.style.display = ok ? '' : 'none';
        if (ok) shown++;
        // marquinha de origem
        if (kind === 'osu' && !row.querySelector('.ed-osu-tag')) {
            const t = row.querySelector('.font-semibold');
            if (t) t.insertAdjacentHTML('afterbegin', '<span class="ed-osu-tag text-pink-400 mr-1">♪</span>');
        }
    });
    const c = document.getElementById('ed-lib-count');
    if (c) c.textContent = rows.length ? `${shown} de ${rows.length} chart(s)` : '';
}

// ---------- LIXEIRA ----------
let trashDbPromise = null;
function trashDb() {
    if (trashDbPromise) return trashDbPromise;
    trashDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('sem IndexedDB'));
        const rq = indexedDB.open(TRASH_DB, 1);
        rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(TRASH_STORE)) rq.result.createObjectStore(TRASH_STORE, { keyPath: 'id' }); };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
    });
    return trashDbPromise;
}
function trashOp(mode, fn) {
    return trashDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(TRASH_STORE, mode);
        const req = fn(tx.objectStore(TRASH_STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
    }));
}
const trashAll = () => trashOp('readonly', st => st.getAll());
const trashPut = (row) => trashOp('readwrite', st => st.put(row));
const trashDel = (id) => trashOp('readwrite', st => st.delete(id));

async function trashRefreshCount() {
    let n = 0;
    try {
        const rows = await trashAll();
        const limit = Date.now() - TRASH_DAYS * 86400000;
        for (const r of rows) { if (r.deletedAt < limit) await trashDel(r.id); else n++; }
    } catch (e) {}
    const el = document.getElementById('lib-trash-count');
    if (el) el.textContent = n ? `(${n})` : '';
}

// excluir = mandar pra lixeira (chart + áudio), com "Desfazer" na hora
const _libOrigDelete = window.deleteCustomChart;
window.deleteCustomChart = async function (id) {
    const chart = findCustomChart(id);
    if (chart) {
        let audioRow = null;
        try { audioRow = await loadChartAudioBlob(id); } catch (e) {}
        try {
            await trashPut({ id, chart: JSON.parse(JSON.stringify(chart)), audio: audioRow ? { blob: audioRow.blob, fileName: audioRow.fileName } : null, deletedAt: Date.now() });
        } catch (e) {
            if (!confirm('Não deu pra guardar este chart na Lixeira (armazenamento do navegador cheio?). Excluir mesmo assim, sem volta?')) return;
        }
    }
    _libOrigDelete(id);
    trashRefreshCount();
    if (chart) libToast(`"${chart.title}" foi para a Lixeira.`, 'Desfazer', () => restoreFromTrash(id));
};

async function restoreFromTrash(id) {
    let row = null;
    try { row = (await trashAll()).find(r => r.id === id); } catch (e) {}
    if (!row) { alert('Esse item não está mais na Lixeira.'); return false; }
    await restoreChartRecord(row.chart, row.audio);
    await trashDel(id);
    trashRefreshCount();
    return true;
}
async function restoreChartRecord(chart, audioRow) {
    const idx = customCharts.findIndex(c => c.id === chart.id);
    if (idx >= 0) customCharts[idx] = chart; else customCharts.push(chart);
    saveCustomCharts();
    if (audioRow && audioRow.blob) await saveChartAudioBlob(chart.id, audioRow.blob, audioRow.fileName || '');
    if (typeof addOrUpdateCustomChartCard === 'function') addOrUpdateCustomChartCard(chart);
    if (typeof renderEditorChartList === 'function') renderEditorChartList();
    if (typeof decoratePatternCards === 'function') decoratePatternCards();
    libQueue();
}

function libToast(text, actionLabel, action) {
    let t = document.getElementById('lib-toast');
    if (!t) { t = document.createElement('div'); t.id = 'lib-toast'; document.body.appendChild(t); }
    t.className = 'fixed left-1/2 -translate-x-1/2 bottom-5 z-[120] flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-900/95 border border-slate-600 text-[12px] text-slate-100 shadow-2xl';
    t.innerHTML = `<span>${escapeHtml(text)}</span>${actionLabel ? `<button class="px-2 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[11px]">${escapeHtml(actionLabel)}</button>` : ''}`;
    clearTimeout(libToast._t);
    if (actionLabel) t.querySelector('button').addEventListener('click', async () => { t.remove(); await action(); });
    libToast._t = setTimeout(() => t.remove(), 9000);
}

function ensureTrashModal() {
    let m = document.getElementById('trash-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'trash-modal';
    m.className = 'hidden fixed inset-0 bg-slate-950/85 backdrop-blur-md flex justify-center items-center p-4 z-[110]';
    m.innerHTML = `<div class="max-w-2xl w-full max-h-full overflow-y-auto bg-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-2xl flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <h2 class="font-orbitron text-lg font-black text-amber-300"><i class="fa-solid fa-trash-can-arrow-up mr-2"></i>LIXEIRA</h2>
            <button id="trash-close" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200">Fechar</button>
        </div>
        <p class="text-[11px] text-slate-400">Charts e músicas excluídos ficam aqui por ${TRASH_DAYS} dias, com o áudio junto. "Restaurar" devolve do jeito que estava (histórico, recordes e replays nunca são apagados).</p>
        <div id="trash-list" class="flex flex-col gap-1.5"></div>
        <div class="border-t border-slate-800 pt-3 flex flex-col gap-2">
            <span class="text-xs font-bold text-slate-200">Recuperar de outros lugares</span>
            <div class="flex flex-wrap gap-2">
                <label class="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-cyan-700/60 text-[11px] text-cyan-200 cursor-pointer"><i class="fa-solid fa-box-archive mr-1"></i>De um arquivo de backup…<input id="trash-backup-file" type="file" accept=".zip,application/zip,.json,application/json" class="hidden"></label>
                <button id="trash-autosave" class="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Último rascunho do editor</button>
            </div>
            <span class="text-[10px] text-slate-500">O backup só ACRESCENTA as músicas que você escolher — não apaga nem troca nada do que já existe. Música do osu!: também dá pra só importar o .osz de novo (ele costuma estar na pasta Downloads).</span>
            <div id="trash-backup-list" class="flex flex-col gap-1.5"></div>
        </div>
    </div>`;
    document.body.appendChild(m);
    m.querySelector('#trash-close').addEventListener('click', () => m.classList.add('hidden'));
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    m.querySelector('#trash-backup-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) scanBackupFile(f); });
    m.querySelector('#trash-autosave').addEventListener('click', recoverFromAutosave);
    return m;
}
function chartLine(ch) {
    const kind = ch.source === 'osu' ? '<span class="text-pink-400">♪ osu!</span>' : '<span class="text-green-400">✏️ chart</span>';
    return `${kind} · ${getModeDisplayName(ch.mode)} · ${(ch.notes || []).length} notas`;
}
async function openTrashModal() {
    const m = ensureTrashModal();
    m.classList.remove('hidden');
    m.querySelector('#trash-backup-list').innerHTML = '';
    const list = m.querySelector('#trash-list');
    let rows = [];
    try { rows = (await trashAll()).sort((a, b) => b.deletedAt - a.deletedAt); } catch (e) {}
    list.innerHTML = rows.length ? rows.map(r => `<div class="flex items-center gap-2 px-2 py-1.5 rounded bg-slate-800/60 border border-slate-700">
        <div class="flex-1 min-w-0"><div class="text-[12px] font-bold text-white truncate">${escapeHtml(r.chart.title)}</div>
            <div class="text-[10px] text-slate-400 font-mono">${chartLine(r.chart)} · excluído em ${fmtDate(r.deletedAt)}${r.audio ? ' · com áudio' : ''}</div></div>
        <button data-trash-restore="${escapeHtml(r.id)}" class="px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold">Restaurar</button>
        <button data-trash-purge="${escapeHtml(r.id)}" title="Apagar de vez" class="px-2 py-1 rounded bg-slate-900 hover:bg-red-950 border border-red-900/60 text-red-300 text-[11px]"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('') : '<span class="text-[11px] text-slate-500">A Lixeira está vazia. (Ela começou a funcionar agora — o que foi excluído antes desta versão não passou por aqui; tente o backup abaixo.)</span>';
    list.querySelectorAll('[data-trash-restore]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; if (await restoreFromTrash(b.dataset.trashRestore)) { libToast('Restaurado!'); openTrashModal(); } }));
    list.querySelectorAll('[data-trash-purge]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Apagar de vez? Aí não tem mais volta.')) return; await trashDel(b.dataset.trashPurge); trashRefreshCount(); openTrashModal(); }));
}

// recuperar músicas de um backup (.json do botão Backup), sem substituir nada
async function scanBackupFile(file) {
    const box = document.getElementById('trash-backup-list');
    box.innerHTML = `<span class="text-[11px] text-cyan-300"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Lendo ${escapeHtml(file.name)} (${(file.size / 1048576).toFixed(0)} MB)… arquivos grandes demoram um pouco.</span>`;
    await new Promise(r => setTimeout(r, 50));
    let data;
    try { data = await loadBackupFile(file); } catch (e) { box.innerHTML = `<span class="text-[11px] text-red-300">Não deu pra ler esse arquivo: ${escapeHtml(e.message || String(e))}</span>`; return; }
    let charts = [];
    try { charts = JSON.parse((data.localStorage || {})[CUSTOM_CHARTS_KEY] || '[]') || []; } catch (e) {}
    if (!charts.length) { box.innerHTML = '<span class="text-[11px] text-slate-400">Esse backup não tem nenhum chart/música.</span>'; return; }
    const have = new Set(customCharts.map(c => c.id));
    const audioById = new Map((data.chartAudio || []).map(row => [row.id, row]));
    const mediaByKey = new Map((data.media || []).map(row => [row.key, row.value]));
    charts.sort((a, b) => (have.has(a.id) - have.has(b.id)) || String(a.title).localeCompare(String(b.title)));
    const missing = charts.filter(c => !have.has(c.id)).length;
    box.innerHTML = `<div class="flex items-center justify-between gap-2"><span class="text-[11px] text-slate-300">${charts.length} no backup · <b class="text-amber-300">${missing} que não estão mais aqui</b></span>
        <button id="bk-restore" class="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold">Recuperar marcados</button></div>
        <input id="bk-q" type="search" placeholder="Filtrar..." class="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100 outline-none">
        <div id="bk-items" class="flex flex-col gap-1 max-h-[45vh] overflow-y-auto pr-1">${charts.map((c, i) => `<label data-bk-row="${i}" class="flex items-center gap-2 px-2 py-1 rounded ${have.has(c.id) ? 'bg-slate-900/40 opacity-60' : 'bg-slate-800/70 border border-amber-500/30'} cursor-pointer">
            <input type="checkbox" data-bk="${i}" ${have.has(c.id) ? '' : 'checked'} class="accent-emerald-400">
            <span class="flex-1 min-w-0"><span class="block text-[11px] text-white truncate">${escapeHtml(c.title)}</span><span class="block text-[10px] text-slate-400 font-mono">${chartLine(c)}${audioById.has(c.id) ? ' · com áudio' : ''}${have.has(c.id) ? ' · já existe (substitui pela do backup)' : ''}</span></span></label>`).join('')}</div>`;
    box.querySelector('#bk-q').addEventListener('input', (e) => {
        const w = libNorm(e.target.value).trim();
        box.querySelectorAll('[data-bk-row]').forEach(r => { r.style.display = !w || libNorm(charts[+r.dataset.bkRow].title).includes(w) ? '' : 'none'; });
    });
    box.querySelector('#bk-q').addEventListener('keydown', (e) => e.stopPropagation());
    box.querySelector('#bk-restore').addEventListener('click', async () => {
        const picked = [...box.querySelectorAll('[data-bk]:checked')].map(x => charts[+x.dataset.bk]);
        if (!picked.length) return;
        let n = 0;
        for (const c of picked) {
            const row = audioById.get(c.id);
            const audioRow = row ? await unpackValueAsync(row, data) : null;
            await restoreChartRecord(c, audioRow);
            if (c.bga && c.bga.key && mediaByKey.has(c.bga.key)) { try { await mediaPut(c.bga.key, await unpackValueAsync(mediaByKey.get(c.bga.key), data)); } catch (e) {} }
            n++;
        }
        box.innerHTML = `<span class="text-[11px] text-emerald-300">✅ ${n} recuperado(s). Já estão na lista de músicas.</span>`;
        data = null;
    });
}

function recoverFromAutosave() {
    const box = document.getElementById('trash-backup-list');
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(EDITOR_AUTOSAVE_KEY) || 'null'); } catch (e) {}
    if (!snap || !snap.notes || !snap.notes.length) { box.innerHTML = '<span class="text-[11px] text-slate-400">Não tem rascunho do editor guardado.</span>'; return; }
    const exists = snap.id && findCustomChart(snap.id);
    box.innerHTML = `<div class="flex items-center gap-2 px-2 py-1.5 rounded bg-slate-800/70 border border-slate-600">
        <div class="flex-1 min-w-0"><div class="text-[12px] text-white truncate">${escapeHtml(snap.title || 'Sem título')}</div>
        <div class="text-[10px] text-slate-400 font-mono">${getModeDisplayName(snap.mode)} · ${snap.notes.length} notas · ${fmtDate(snap.savedAt)}${exists ? ' · esse chart ainda existe' : ' · <span class="text-amber-300">não está na lista</span>'} · só as notas (sem o áudio)</div></div>
        <button id="as-restore" class="px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold">${exists ? 'Salvar como cópia' : 'Recuperar'}</button></div>`;
    box.querySelector('#as-restore').addEventListener('click', async () => {
        const chart = { id: exists ? `custom_${Date.now()}_${Math.floor(Math.random() * 1e6)}` : (snap.id || `custom_${Date.now()}`), title: snap.title + (exists ? ' (cópia)' : ''), mode: snap.mode, bpm: snap.bpm, snap: snap.snap, duration: snap.duration, notes: snap.notes, pins: snap.pins || [], sections: snap.sections || [], bpmChanges: snap.bpmChanges || [], songEndMs: snap.songEndMs ?? null, difficulty: snap.difficulty || null, updatedAt: Date.now() };
        await restoreChartRecord(chart, null);
        box.innerHTML = '<span class="text-[11px] text-emerald-300">✅ Recuperado (sem o áudio — dá pra carregar a música de novo no editor).</span>';
    });
}

trashRefreshCount();

// ---------- Exportar/importar chart COM a música (pacote .djmaxchart) ----------
// O pacote é um .zip comum (dá pra abrir no Windows) com: chart.json + a música (mp3/ogg/…)
// + o fundo da música (imagem/vídeo do osu!), se tiver. Sem música, continua o .json de antes.
const PKG_EXT = '.bmchart'; // (os antigos .djmaxchart continuam abrindo)
let crc32Table = null;
function crc32(buf) {
    if (!crc32Table) {
        crc32Table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc32Table[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crc32Table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
// zip sem compressão (música já é comprimida) — entradas: [{ name, data: Uint8Array }]
function makeZip(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const e of entries) {
        const name = enc.encode(e.name), crc = crc32(e.data), size = e.data.length;
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true); lh.setUint16(8, 0, true);
        lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
        lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
        parts.push(new Uint8Array(lh.buffer), name, e.data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true); ch.setUint16(10, 0, true);
        ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
        ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
        central.push(new Uint8Array(ch.buffer), name);
        offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
function pkgSafeName(s) { return String(s || 'chart').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'chart'; }
function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const _libOrigExport = window.exportCurrentEditorChart;
window.exportCurrentEditorChart = async function () {
    if (editorState.notes.length === 0) { alert('Adicione pelo menos uma nota antes de exportar.'); return; }
    // música: a que foi carregada agora no editor, ou a salva junto com o chart
    let audioBlob = editorState.audioFileBlob || null, audioName = editorState.audioFileName || '';
    if (!audioBlob && editorState.id) {
        try { const row = await loadChartAudioBlob(editorState.id); if (row && row.blob) { audioBlob = row.blob; audioName = row.fileName || ''; } } catch (e) {}
    }
    if (!audioBlob) return _libOrigExport.apply(this, arguments);   // sem música: .json como antes
    const chart = {
        title: editorState.title, mode: editorState.mode, bpm: editorState.bpm, snap: editorState.snap, duration: editorState.duration,
        notes: editorState.notes.map(n => ({ time: Math.round(n.time), lane: n.lane, holdEnd: n.holdEnd != null ? Math.round(n.holdEnd) : null })).sort((a, b) => a.time - b.time),
        pins: editorState.pins.map(p => Math.round(p)).sort((a, b) => a - b),
        sections: editorState.sections.map(s => ({ time: Math.round(s.time), name: s.name })).sort((a, b) => a.time - b.time),
        bpmChanges: sanitizeBpmChanges(editorState.bpmChanges),
        songEndMs: editorState.songEndMs != null ? Math.round(editorState.songEndMs) : null,
        format: 'djmax-trainer-chart', version: 2
    };
    const saved = editorState.id ? findCustomChart(editorState.id) : null;
    if (saved && saved.source === 'osu') { chart.source = 'osu'; chart.osu = saved.osu; }
    const ext = (audioName.match(/\.[a-z0-9]{2,4}$/i) || [''])[0] || ({ 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/mp4': '.m4a', 'audio/flac': '.flac' }[audioBlob.type] || '.mp3');
    const audioFile = 'audio/' + pkgSafeName(audioName.replace(/\.[^.]+$/, '') || chart.title) + ext;
    chart.audioFile = audioFile;
    const entries = [{ name: audioFile, data: new Uint8Array(await audioBlob.arrayBuffer()) }];
    // fundo da música (osu!)
    if (saved && saved.bga && saved.bga.key) {
        try {
            const rec = await mediaGet(saved.bga.key);
            if (rec && rec.image) { const n = 'fundo/imagem' + ({ 'image/png': '.png', 'image/webp': '.webp' }[rec.image.type] || '.jpg'); entries.push({ name: n, data: new Uint8Array(await rec.image.arrayBuffer()) }); chart.bgImageFile = n; }
            if (rec && rec.video) { const n = 'fundo/video' + (rec.video.type === 'video/webm' ? '.webm' : '.mp4'); entries.push({ name: n, data: new Uint8Array(await rec.video.arrayBuffer()) }); chart.bgVideoFile = n; chart.bgVideoOffsetMs = saved.bga.offsetMs || 0; }
        } catch (e) {}
    }
    entries.unshift({ name: 'chart.json', data: new TextEncoder().encode(JSON.stringify(chart, null, 2)) });
    downloadBlob(makeZip(entries), pkgSafeName(chart.title) + PKG_EXT);
    if (typeof setEditorAudioStatus === 'function') setEditorAudioStatus(`📦 Exportado com a música (${(entries.reduce((s, e) => s + e.data.length, 0) / 1048576).toFixed(1)} MB).`);
};

// Lê um pacote .djmaxchart (zip) e grava a chart na biblioteca (com música e fundo). Usado
// pelo Importar do editor e pela nuvem. Devolve { chart, hadAudio }.
async function pkgImportBlob(file, extra) {
    const entries = await readZipEntries(file);
    const find = (n) => n && entries.find(e => e.name === n || e.name.toLowerCase() === String(n).toLowerCase());
    const je = entries.find(e => /(^|\/)chart\.json$/i.test(e.name)) || entries.find(e => /\.json$/i.test(e.name));
    if (!je) throw new Error('não tem chart.json dentro');
    const parsed = JSON.parse(new TextDecoder().decode(await je.read()));
    if (!parsed || !Array.isArray(parsed.notes) || !parsed.mode || !KEY_CONFIGS[parsed.mode]) throw new Error('chart inválido');
    // extra.replaceId: atualiza uma chart que já existe (mesmo id) em vez de criar outra
    const replaceId = extra && extra.replaceId && findCustomChart(extra.replaceId) ? extra.replaceId : null;
    const id = replaceId || `custom_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const chart = {
        id, title: parsed.title || 'Chart importado', mode: parsed.mode,
        bpm: (typeof parsed.bpm === 'number' && parsed.bpm > 0) ? parsed.bpm : 150, snap: parsed.snap || 4,
        duration: (typeof parsed.duration === 'number' && parsed.duration > 0) ? parsed.duration : 90,
        notes: parsed.notes.filter(n => typeof n.time === 'number' && typeof n.lane === 'number').map(n => ({ time: n.time, lane: n.lane, holdEnd: (typeof n.holdEnd === 'number') ? n.holdEnd : null })),
        pins: Array.isArray(parsed.pins) ? parsed.pins.filter(p => typeof p === 'number') : [],
        sections: Array.isArray(parsed.sections) ? parsed.sections.filter(s => s && typeof s.time === 'number' && typeof s.name === 'string') : [],
        bpmChanges: sanitizeBpmChanges(parsed.bpmChanges),
        songEndMs: (typeof parsed.songEndMs === 'number' && parsed.songEndMs > 0) ? parsed.songEndMs : null,
        difficulty: (parsed.difficulty && typeof parsed.difficulty.tier === 'string') ? { tier: parsed.difficulty.tier, level: parsed.difficulty.level } : null,
        updatedAt: Date.now()
    };
    if (parsed.source === 'osu' && parsed.osu) { chart.source = 'osu'; chart.osu = parsed.osu; }
    if (extra) { const { replaceId: _r, ...rest } = extra; Object.assign(chart, rest); }
    const ae = find(parsed.audioFile) || entries.find(e => /\.(mp3|ogg|wav|m4a|flac|opus)$/i.test(e.name));
    if (ae) {
        const name = ae.name.split('/').pop();
        await saveChartAudioBlob(id, new Blob([await ae.read()], { type: typeof audioMime === 'function' ? audioMime(name) : 'audio/mpeg' }), name);
    }
    const ie = find(parsed.bgImageFile), ve = find(parsed.bgVideoFile);
    if (ie || ve) {
        const rec = { image: ie ? new Blob([await ie.read()], { type: fundoMime(ie.name) }) : null, video: ve ? new Blob([await ve.read()], { type: fundoMime(ve.name) }) : null };
        const key = `bga:pkg:${id}`;
        await mediaPut(key, rec);
        chart.bga = { key, offsetMs: parsed.bgVideoOffsetMs || 0, video: !!rec.video, image: !!rec.image };
    }
    const oldIdx = customCharts.findIndex(c => c.id === id);
    if (oldIdx >= 0) customCharts.splice(oldIdx, 1);
    customCharts.push(chart);
    saveCustomCharts();
    addOrUpdateCustomChartCard(chart);
    if (typeof renderEditorChartList === 'function') renderEditorChartList();
    if (typeof decoratePatternCards === 'function') decoratePatternCards();
    if (typeof libQueue === 'function') libQueue();
    return { chart, hadAudio: !!ae };
}

const _libOrigImport = window.importChartFromFile;
window.importChartFromFile = async function (file) {
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (!isZip) return _libOrigImport.call(this, file);   // .json antigo
    try {
        const { chart, hadAudio: ae } = await pkgImportBlob(file);
        await loadChartIntoEditor(chart);   // já abre com a música
        renderEditorChartList();
        resizeEditorCanvas(); scrollEditorGridToStart(); renderEditorCanvas();
        libToast(`"${chart.title}" importado${ae ? ' com a música' : ''}.`);
    } catch (e) {
        alert('Não foi possível ler esse pacote de chart: ' + (e.message || e));
    }
};
(function pkgImportAccept() {
    const inp = document.getElementById('editor-import-json');
    if (inp) inp.accept = 'application/json,.json,.bmchart,.djmaxchart,.zip';
})();
