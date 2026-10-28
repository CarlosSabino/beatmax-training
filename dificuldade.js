// =====================================================================================
// dificuldade.js — dificuldade das músicas/charts.
//
//  • Cada chart tem um nível: EASY / NORMAL / HARD / EXPERT / MASTER + nível 1 a 15.
//    Pode ser definido no Chart Editor; sem definir, é estimado (estrelas do osu! ou
//    densidade de notas) e aparece marcado como "≈".
//  • Na lista de músicas, as dificuldades da MESMA música (mesmo modo de botões) viram um
//    card só, com as dificuldades lado a lado. ← / → troca a dificuldade (ou clique nela).
// =====================================================================================
const DIFF_TIERS = [
    { id: 'easy', name: 'EASY', color: '#4ade80' },
    { id: 'normal', name: 'NORMAL', color: '#38bdf8' },
    { id: 'hard', name: 'HARD', color: '#fbbf24' },
    { id: 'expert', name: 'EXPERT', color: '#f87171' },
    { id: 'master', name: 'MASTER', color: '#c084fc' }
];
const DIFF_BY_ID = Object.fromEntries(DIFF_TIERS.map((t, i) => [t.id, Object.assign({ idx: i }, t)]));

function diffTierForLevel(level) {
    return level <= 3 ? 'easy' : level <= 6 ? 'normal' : level <= 9 ? 'hard' : level <= 12 ? 'expert' : 'master';
}
// nível estimado: estrelas do osu! ou notas por segundo no trecho com notas
function diffEstimateLevel(ch) {
    const stars = ch && ch.osu && +ch.osu.stars;
    if (stars > 0) return Math.max(1, Math.min(15, Math.round(stars * 2.2)));
    const notes = (ch && ch.notes) || [];
    if (notes.length < 2) return 1;
    let t0 = Infinity, t1 = 0;
    notes.forEach(n => { t0 = Math.min(t0, n.time); t1 = Math.max(t1, n.holdEnd || n.time); });
    const nps = notes.length / Math.max(5, (t1 - t0) / 1000);
    return Math.max(1, Math.min(15, Math.round(nps * 1.4)));
}
function chartDifficulty(ch) {
    if (ch && ch.difficulty && DIFF_BY_ID[ch.difficulty.tier]) {
        const lv = Math.max(1, Math.min(15, parseInt(ch.difficulty.level, 10) || 1));
        return { tier: ch.difficulty.tier, level: lv, auto: false };
    }
    const lv = diffEstimateLevel(ch);
    return { tier: diffTierForLevel(lv), level: lv, auto: true };
}
function diffLabel(d) { return `${DIFF_BY_ID[d.tier].name} ${d.auto ? '≈' : ''}${d.level}`; }

(function () {
    const css = document.createElement('style');
    css.textContent = `
.diff-strip{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:5px}
.diff-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;border:1.5px solid var(--dc);color:var(--dc);background:rgba(15,23,42,.6);font-family:Orbitron,monospace;font-size:10px;font-weight:800;letter-spacing:.04em;cursor:pointer;line-height:1.5;white-space:nowrap;opacity:.6}
.diff-chip:hover{opacity:1}
.diff-chip.on{background:var(--dc);color:#020617;opacity:1;box-shadow:0 0 10px var(--dc)}
.diff-chip .lv{font-size:11px}
.diff-arrows{font-size:10px;color:#64748b;margin-left:2px;font-family:Rajdhani,sans-serif}
.diff-ver{font-size:10px;color:#94a3b8;margin-left:4px;font-family:Rajdhani,sans-serif;font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.diff-video{font-size:9px;color:#94a3b8;opacity:.55;margin-left:auto;padding-right:2px}
.ed-diff-pill{font-family:Orbitron,monospace;font-weight:800;font-size:12px;padding:3px 10px;border-radius:999px;border:1.5px solid var(--dc);color:var(--dc);white-space:nowrap}`;
    document.head.appendChild(css);

    // ---------- lista de músicas: agrupa as dificuldades ----------
    const SEL_KEY = 'djmaxDiffSel_v1';
    let sel = {};
    try { sel = JSON.parse(localStorage.getItem(SEL_KEY) || '{}') || {}; } catch (e) {}
    const saveSel = () => { try { localStorage.setItem(SEL_KEY, JSON.stringify(sel)); } catch (e) {} };
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

    function groupKey(ch) {
        if (!ch) return null;
        if (ch.source === 'osu') {
            const song = String(ch.title || '').replace(/\s*\[[^\]]*\]\s*$/, '');
            return `osu|${(ch.osu && ch.osu.setId) || norm(song)}|${ch.mode}`;
        }
        return `custom|${norm(ch.title)}|${ch.mode}`;
    }
    window.diffGroupKey = groupKey;
    let groups = new Map();   // key -> [{card, ch, d}]

    function buildStrip(key, activeId) {
        const list = groups.get(key) || [];
        const strip = document.createElement('div');
        strip.className = 'diff-strip';
        list.forEach(m => {
            const t = DIFF_BY_ID[m.d.tier];
            const b = document.createElement('span');
            b.className = 'diff-chip' + (m.ch.id === activeId ? ' on' : '');
            b.style.setProperty('--dc', t.color);
            b.title = `${t.name} nível ${m.d.level}${m.d.auto ? ' (estimado — dá pra definir no Chart Editor)' : ''} · ${(m.ch.notes || []).length} notas${m.ch.osu && m.ch.osu.version ? ' · ' + m.ch.osu.version : ''}`;
            b.innerHTML = `${t.name}<span class="lv">${m.d.auto ? '≈' : ''}${m.d.level}</span>`;
            b.addEventListener('click', (e) => { e.stopPropagation(); pick(key, m.ch.id); });
            strip.appendChild(b);
        });
        const act = list.find(m => m.ch.id === activeId);
        if (act && act.ch.osu && act.ch.osu.version) { const v = document.createElement('span'); v.className = 'diff-ver'; v.textContent = `“${act.ch.osu.version}”`; strip.appendChild(v); }
        if (list.length > 1) { const a = document.createElement('span'); a.className = 'diff-arrows'; a.textContent = '◀ ▶ troca'; strip.appendChild(a); }
        if (act && act.ch.bga && act.ch.bga.video) { const v = document.createElement('i'); v.className = 'fa-solid fa-film diff-video'; v.title = 'Esta música tem vídeo de fundo'; strip.appendChild(v); }
        return strip;
    }

    function pick(key, chartId) {
        sel[key] = chartId; saveSel();
        const m = (groups.get(key) || []).find(x => x.ch.id === chartId);
        if (!m) return;
        m.card.style.display = '';
        m.card.click(); // seleciona de verdade (mesmo caminho do clique normal: modo, prévia...)
        decorate();
        m.card.scrollIntoView({ block: 'nearest' });
    }

    // depois de cada organização da lista: esconde as outras dificuldades e põe as fichas
    function decorate(fromLib) {
        const grid = document.getElementById('pattern-grid');
        if (!grid || typeof findCustomChart !== 'function') return;
        groups = new Map();
        const cards = [...grid.querySelectorAll('.pattern-card[data-pattern^="custom:"]')];
        if (fromLib) cards.forEach(c => { delete c.dataset.diffHidden; }); // a biblioteca acabou de refazer quem aparece
        cards.forEach(card => {
            card.querySelectorAll('.diff-strip').forEach(s => s.remove());
            // filtrado pela busca/aba/modo (as outras dificuldades que ESTE arquivo escondeu continuam no grupo)
            if ((card.style.display === 'none' && card.dataset.diffHidden !== '1') || card.classList.contains('hidden')) return;
            const ch = findCustomChart(card.dataset.pattern.slice(7));
            const key = groupKey(ch);
            if (!key) return;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ card, ch, d: chartDifficulty(ch) });
        });
        // as dificuldades separadas não precisam mais do cabeçalho "♪ música — N dificuldades"
        grid.querySelectorAll('.lib-song').forEach(h => h.remove());
        groups.forEach((list, key) => {
            list.sort((a, b) => (DIFF_BY_ID[a.d.tier].idx - DIFF_BY_ID[b.d.tier].idx) || (a.d.level - b.d.level) || ((a.ch.notes || []).length - (b.ch.notes || []).length));
            const cur = typeof currentPatternType !== 'undefined' ? currentPatternType : '';
            let active = list.find(m => `custom:${m.ch.id}` === cur) || list.find(m => m.ch.id === sel[key]) || list[0];
            // o card que fica é o da dificuldade escolhida, na posição do primeiro do grupo
            const first = list.reduce((a, m) => (a.card.compareDocumentPosition(m.card) & Node.DOCUMENT_POSITION_PRECEDING) ? m : a, list[0]);
            if (active.card !== first.card) first.card.parentElement.insertBefore(active.card, first.card);
            list.forEach(m => { m.card.style.display = m === active ? '' : 'none'; m.card.dataset.diffHidden = m === active ? '' : '1'; m.card.style.marginLeft = ''; });
            const strip = buildStrip(key, active.ch.id);
            const body = active.card.querySelector('.flex-1.min-w-0') || active.card;
            body.appendChild(strip);
        });
        updateTrainDiffPanel();
    }
    window.diffDecorateList = decorate;

    // painel "Dificuldade do treino": nas músicas/charts quem vale é a dificuldade da música
    function updateTrainDiffPanel() {
        const pills = document.getElementById('diff-pills');
        if (!pills) return;
        const pat = typeof currentPatternType !== 'undefined' ? String(currentPatternType || '') : '';
        const ch = pat.startsWith('custom:') && typeof findCustomChart === 'function' ? findCustomChart(pat.slice(7)) : null;
        pills.style.opacity = ch ? '0.35' : '';
        pills.style.pointerEvents = ch ? 'none' : '';
        let cap = document.getElementById('diff-song-cap');
        if (!cap) { cap = document.createElement('div'); cap.id = 'diff-song-cap'; cap.style.cssText = 'font-size:11px;margin-top:5px;color:#94a3b8;line-height:1.3'; pills.insertAdjacentElement('afterend', cap); }
        if (ch) {
            const d = chartDifficulty(ch), t = DIFF_BY_ID[d.tier];
            cap.innerHTML = `Música: <b style="color:${t.color}">${t.name} ${d.auto ? '≈' : ''}${d.level}</b> — a dificuldade do treino não vale aqui (use ← → pra trocar a da música).`;
        } else cap.innerHTML = '';
    }
    window.updateTrainDiffPanel = updateTrainDiffPanel;

    if (typeof window.libApply === 'function') {
        const orig = window.libApply;
        window.libApply = function () { const r = orig.apply(this, arguments); try { decorate(true); } catch (e) { console.warn('[dificuldade]', e); } return r; };
    }
    if (typeof window.addOrUpdateCustomChartCard === 'function') {
        const origCard = window.addOrUpdateCustomChartCard;
        window.addOrUpdateCustomChartCard = function () { const r = origCard.apply(this, arguments); if (typeof libQueue === 'function') libQueue(); return r; };
    }
    // escolher uma dificuldade pelo clique normal também fica lembrado pra aquela música
    document.getElementById('pattern-grid')?.addEventListener('click', (e) => {
        if (!e.target.closest('.pattern-card')) return;
        setTimeout(() => {
            groups.forEach((list, key) => { const act = list.find(m => `custom:${m.ch.id}` === currentPatternType); if (act) { sel[key] = act.ch.id; saveSel(); } });
            updateTrainDiffPanel();
        }, 0);
    });

    // ← / → no menu: troca a dificuldade da música selecionada
    function menuOpen() {
        const m = document.getElementById('menu-overlay');
        if (!m || m.classList.contains('hidden')) return false;
        if (typeof isPlaying !== 'undefined' && isPlaying) return false;
        if (typeof isEditorOpen === 'function' && isEditorOpen()) return false;
        if (typeof introEl !== 'undefined' && introEl) return false;
        // alguma janela por cima da lista (Configurações, osu!, Nuvem, resultado...)? então não é com a lista
        const grid = document.getElementById('pattern-grid');
        if (!grid) return false;
        const r = grid.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 120));
        return !!(top && m.contains(top));
    }
    window.menuListaAtiva = menuOpen;

    // ---------- teclado na lista: ↑/↓ música · Enter começa ----------
    function visibleCards() {
        return [...document.querySelectorAll('#pattern-grid .pattern-card')].filter(c => c.style.display !== 'none' && !c.classList.contains('hidden') && c.offsetParent !== null);
    }
    function selectedCard(cards) {
        const cur = typeof currentPatternType !== 'undefined' ? currentPatternType : '';
        let i = cards.findIndex(c => c.dataset.pattern === cur);
        return i;
    }
    window.addEventListener('keydown', (e) => {
        const nav = { ArrowUp: -1, ArrowDown: 1, PageUp: -6, PageDown: 6, Home: -1e9, End: 1e9 };
        const isEnter = e.code === 'Enter' || e.code === 'NumpadEnter';
        if (!(e.code in nav) && !isEnter) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (!menuOpen()) return;
        e.preventDefault();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        if (isEnter) {
            if (e.repeat) return;
            // acabou de sair da tela de resultado: o mesmo Enter não pode começar outra música
            if (performance.now() - (window.__resFechadoEm || -1e9) < 600) return;
            const btn = document.getElementById('btn-start');
            if (btn) btn.click();
            return;
        }
        const cards = visibleCards();
        if (!cards.length) return;
        let i = selectedCard(cards);
        const step = nav[e.code];
        const j = i < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, i + step));
        if (j === i) return;
        cards[j].click();
        cards[j].scrollIntoView({ block: 'nearest' });
    });

    window.addEventListener('keydown', (e) => {
        if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (!menuOpen()) return;
        const cur = typeof currentPatternType !== 'undefined' ? currentPatternType : '';
        for (const [key, list] of groups) {
            const i = list.findIndex(m => `custom:${m.ch.id}` === cur);
            if (i < 0) continue;
            e.preventDefault();
            if (list.length < 2) return;
            const j = Math.max(0, Math.min(list.length - 1, i + (e.code === 'ArrowRight' ? 1 : -1)));
            if (j !== i) pick(key, list[j].ch.id);
            return;
        }
    });

    // ---------- Chart Editor: campo de dificuldade ----------
    (function editorField() {
        const dur = document.getElementById('editor-duration');
        const anchor = dur && dur.closest('label');
        if (!anchor || document.getElementById('editor-diff-tier')) return;
        const lab = document.createElement('label');
        lab.className = 'ed-field';
        lab.title = 'Dificuldade deste chart (aparece na lista de músicas). Auto = estimada pela densidade de notas.';
        lab.innerHTML = `DIFICULDADE
            <select id="editor-diff-tier" class="ed-input ed-strong"><option value="">Auto</option>${DIFF_TIERS.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
            <input id="editor-diff-level" type="number" min="1" max="15" class="ed-input" style="width:58px" title="Nível de 1 a 15">
            <span id="editor-diff-pill" class="ed-diff-pill"></span>`;
        anchor.insertAdjacentElement('afterend', lab);
        const tierEl = lab.querySelector('#editor-diff-tier'), lvEl = lab.querySelector('#editor-diff-level');
        [tierEl, lvEl].forEach(el => el.addEventListener('keydown', (e) => e.stopPropagation()));
        const commit = () => {
            if (!tierEl.value) editorState.difficulty = null;
            else {
                const lv = Math.max(1, Math.min(15, parseInt(lvEl.value, 10) || chartDifficulty({ notes: editorState.notes }).level));
                editorState.difficulty = { tier: tierEl.value, level: lv };
            }
            ui();
            if (typeof runEditorAutosave === 'function') runEditorAutosave();
        };
        tierEl.addEventListener('change', () => {
            // ao escolher a categoria, sugere um nível dentro dela
            if (tierEl.value) {
                const ranges = { easy: [1, 3], normal: [4, 6], hard: [7, 9], expert: [10, 12], master: [13, 15] }[tierEl.value];
                const cur = parseInt(lvEl.value, 10);
                if (!(cur >= ranges[0] && cur <= ranges[1])) {
                    const est = chartDifficulty({ notes: editorState.notes }).level;
                    lvEl.value = Math.max(ranges[0], Math.min(ranges[1], est));
                }
            }
            commit();
        });
        lvEl.addEventListener('change', () => { if (!tierEl.value) tierEl.value = diffTierForLevel(Math.max(1, Math.min(15, parseInt(lvEl.value, 10) || 1))); commit(); });
        function ui() {
            const d = editorState.difficulty && DIFF_BY_ID[editorState.difficulty.tier]
                ? { tier: editorState.difficulty.tier, level: editorState.difficulty.level, auto: false }
                : Object.assign(chartDifficulty({ notes: editorState.notes, osu: (typeof findCustomChart === 'function' && editorState.id && (findCustomChart(editorState.id) || {}).osu) || null }), { auto: true });
            tierEl.value = d.auto ? '' : d.tier;
            lvEl.value = d.level;
            lvEl.disabled = false;
            const pill = lab.querySelector('#editor-diff-pill');
            pill.style.setProperty('--dc', DIFF_BY_ID[d.tier].color);
            pill.textContent = diffLabel(d);
            pill.title = d.auto ? 'Estimada pelas notas — escolha uma dificuldade pra fixar' : 'Definida por você';
        }
        window.edDiffUI = ui;
        ui();
        // a estimativa (Auto) acompanha as notas
        setInterval(() => { if (typeof isEditorOpen === 'function' && isEditorOpen() && !editorState.difficulty && document.activeElement !== lvEl) ui(); }, 1500);
    })();

    // ---------- lista "Meus charts" do editor: mostra a dificuldade ----------
    if (typeof window.renderEditorChartList === 'function') {
        const origList = window.renderEditorChartList;
        window.renderEditorChartList = function () {
            const r = origList.apply(this, arguments);
            try {
                document.querySelectorAll('#editor-chart-list [data-chart-id], #editor-chart-list [data-id]').forEach(row => {
                    const id = row.dataset.chartId || row.dataset.id;
                    const ch = findCustomChart(id);
                    if (!ch || row.querySelector('.ed-diff-pill')) return;
                    const d = chartDifficulty(ch);
                    const pill = document.createElement('span');
                    pill.className = 'ed-diff-pill';
                    pill.style.cssText = `--dc:${DIFF_BY_ID[d.tier].color};font-size:9px;padding:1px 6px;margin-left:4px`;
                    pill.textContent = diffLabel(d);
                    const meta = row.querySelector('.font-mono') || row;
                    meta.appendChild(pill);
                });
            } catch (e) {}
            return r;
        };
    }

    // dica dos atalhos na barra da lista
    (function hint() {
        const bar = document.getElementById('lib-toolbar');
        if (!bar || document.getElementById('lib-keys-hint')) return;
        const h = document.createElement('div');
        h.id = 'lib-keys-hint';
        h.style.cssText = 'font-size:10.5px;color:#64748b;font-family:Rajdhani,sans-serif;font-weight:600;letter-spacing:.02em';
        h.innerHTML = '<span style="color:#94a3b8">⌨</span> <b style="color:#cbd5e1">↑ ↓</b> música · <b style="color:#cbd5e1">← →</b> dificuldade · <b style="color:#cbd5e1">Enter</b> começa · <b style="color:#cbd5e1">F</b> favorita';
        bar.appendChild(h);
    })();
    setTimeout(() => { if (typeof libApply === 'function') libApply(); }, 50);
})();
