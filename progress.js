// =====================================================================================
// progress.js — evolução e treino: histórico de partidas, recordes, mapa de erros do
// resultado (com "treinar este trecho"), precisão por lane, velocidade da música no jogo e
// modo escada de BPM. Carregado DEPOIS de script.js / music-sync.js / game-gl.js.
// =====================================================================================

const HISTORY_KEY = 'djmaxTrainerHistory_v1';
const HISTORY_MAX = 3000;
const LADDER_STEP = 0.05;      // +5% a cada aprovação
const LADDER_PASS = 95;        // precisão mínima pra subir
const LADDER_MAX_RATE = 2.0;

let runHistory = [];
let ladderMode = false;
let ladderStartRate = 1;
let ladderTimer = null;
let lastRunSummary = null;     // { run, prevBest, isRecord, ladder }

function loadHistory() {
    try { runHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') || []; } catch (e) { runHistory = []; }
    if (!Array.isArray(runHistory)) runHistory = [];
}
function saveHistory() {
    if (runHistory.length > HISTORY_MAX) runHistory = runHistory.slice(runHistory.length - HISTORY_MAX);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(runHistory)); } catch (e) { /* cheio: segue só na sessão */ }
}
loadHistory();

function patternTitle(pattern) {
    if (typeof pattern !== 'string') return String(pattern);
    if (pattern.startsWith('custom:')) {
        const ch = typeof findCustomChart === 'function' ? findCustomChart(pattern.slice(7)) : null;
        return ch ? (ch.name || ch.title || 'Chart') : 'Chart (apagado)';
    }
    const id = typeof resolvePatternId === 'function' ? resolvePatternId(pattern) : pattern;
    const d = typeof DRILLS !== 'undefined' ? DRILLS[id] : null;
    return d ? (d.title || id) : pattern;
}
function recordKey(r) { return `${r.pattern}|${r.mode}|${r.diff}`; }
function rankOf(acc) {
    if (acc >= 100) return 'PERFECT';
    if (acc >= 97) return 'S';
    if (acc >= 90) return 'A';
    if (acc >= 80) return 'B';
    return 'C';
}
function fmtPct(v) { return `${(Math.floor(v * 100) / 100).toFixed(2)}%`; }
function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtDate(ts) {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// Recorde = melhor precisão em velocidade 100%, partida concluída (sem morrer com o HP)
// Índice dos recordes por música/modo/dificuldade, refeito só quando o histórico muda. Antes
// cada card da lista varria as até 3000 partidas (2x) toda vez que a lista mexia — com muitas
// músicas isso dava ~200ms de travada ao andar pela lista.
let recIdx = null;
function recIndex() {
    const last = runHistory.length ? runHistory[runHistory.length - 1] : null;
    const sig = runHistory.length + '|' + (last && last.id) + '|' + (last && last.ladderPassed);
    if (recIdx && recIdx.sig === sig) return recIdx;
    const best = new Map(), ladder = new Map();
    for (const r of runHistory) {
        const k = recordKey(r);
        if (r.ladder && r.ladderPassed) ladder.set(k, Math.max(ladder.get(k) || 0, r.rate || 1));
        if (r.failed || Math.abs((r.rate || 1) - 1) > 0.001 || r.section) continue;
        const b = best.get(k);
        if (!b || r.acc > b.acc || (r.acc === b.acc && r.maxCombo > b.maxCombo)) best.set(k, r);
    }
    recIdx = { sig, best, ladder };
    return recIdx;
}
function bestFor(key, exceptId) {
    if (!exceptId) return recIndex().best.get(key) || null;
    let best = null;
    for (const r of runHistory) {
        if (r.id === exceptId || recordKey(r) !== key || r.failed || Math.abs((r.rate || 1) - 1) > 0.001 || r.section) continue;
        if (!best || r.acc > best.acc || (r.acc === best.acc && r.maxCombo > best.maxCombo)) best = r;
    }
    return best;
}
function ladderBestFor(key) {
    return recIndex().ladder.get(key) || 0;
}

// ---------- análise da partida (por nota) ----------
// Junta os eventos por nota (cabeça + soltura da nota longa): BREAK na soltura zera a nota.
function noteResultsFrom(events) {
    const map = new Map();
    for (const e of (events || [])) {
        const k = `${Math.round(e.t)}|${e.lane}`;
        const cur = map.get(k) || { t: e.t, lane: e.lane, p: 0, d: null, b: false };
        if (e.b) { cur.b = true; cur.p = 0; }
        else if (!cur.b) { cur.p = e.p; cur.d = e.d; }
        map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => a.t - b.t);
}

function summarizeRun(failed) {
    const acc = totalPossibleScore > 0 ? Math.min(100, (currentEarnedScore / totalPossibleScore) * 100) : 0;
    const a = typeof analyzeRunTiming === 'function' ? analyzeRunTiming(stats) : null;
    const offs = (stats.hitOffsets || []);
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        at: Date.now(),
        pattern: currentPatternType,
        title: patternTitle(currentPatternType),
        mode: currentMode,
        diff: currentDifficulty,
        rate: Math.round(gameRate * 100) / 100,
        judge: judgeDifficulty,
        acc: Math.round(acc * 100) / 100,
        score: totalPossibleScore > 0 ? Math.round(1e6 * currentEarnedScore / totalPossibleScore) : 0,
        maxCombo: stats.maxCombo || 0,
        notes: Math.round(totalPossibleScore / 100),
        m100: stats.judgments.max100, m90: stats.judgments.max90, low: stats.judgments.lower, brk: stats.judgments.break,
        med: a ? Math.round(a.median * 10) / 10 : null,
        spread: a ? Math.round(a.spread * 10) / 10 : null,
        fast: offs.filter(v => v < -4).length, slow: offs.filter(v => v > 4).length,
        failed: !!failed,
        noFail: !!noFailMode,
        section: activeSection ? { from: activeSection.from, to: activeSection.to } : (releasedSection ? { ...releasedSection, released: true } : null),
        ladder: ladderMode || undefined
    };
}

// Chamado por script.js quando a partida termina (depois de showAnalysis)
function afterRunFinished(failed) {
    const oldBox = document.getElementById('result-extras');
    if (oldBox) oldBox.innerHTML = '';
    if (typeof isCalibrationRun === 'function' && isCalibrationRun()) return;
    if (!totalPossibleScore) return;
    const run = summarizeRun(failed);
    const key = recordKey(run);
    const prevBest = bestFor(key, run.id);
    const countsForRecord = !run.failed && Math.abs(run.rate - 1) < 0.001 && !run.section;
    const isRecord = countsForRecord && (!prevBest || run.acc > prevBest.acc);
    let ladder = null;
    if (ladderMode) {
        const passed = !run.failed && run.acc >= LADDER_PASS;
        run.ladderPassed = passed;
        const bestRate = ladderBestFor(key);
        const nx = Math.min(LADDER_MAX_RATE, Math.round((run.rate + LADDER_STEP) * 100) / 100);
        ladder = { passed, rate: run.rate, next: passed && nx > run.rate ? nx : null, best: Math.max(bestRate, passed ? run.rate : 0), prevBest: bestRate };
    }
    runHistory.push(run);
    saveHistory();
    releasedSection = null;
    lastRunSummary = { run, prevBest, isRecord, countsForRecord, ladder, events: (stats.events || []).slice() };
    renderResultExtras();
    decoratePatternCards();
    if (ladder) handleLadderAfterRun(ladder);
}

// ---------- tela de resultado: recorde, mapa da música, precisão por lane ----------
function ensureResultExtrasBox() {
    let box = document.getElementById('result-extras');
    if (box) return box;
    const overlay = document.getElementById('stats-overlay');
    const panel = overlay && overlay.firstElementChild;
    if (!panel) return null;
    panel.classList.add('max-h-full', 'overflow-y-auto');
    box = document.createElement('div');
    box.id = 'result-extras';
    box.className = 'flex flex-col gap-3';
    const scatterBlock = document.getElementById('timing-scatter')?.closest('div.bg-slate-800\\/40');
    if (scatterBlock) panel.insertBefore(box, scatterBlock); else panel.insertBefore(box, panel.lastElementChild);
    return box;
}

const SEG_COLORS = [[99.5, '#22d3ee'], [97, '#34d399'], [90, '#facc15'], [80, '#fb923c'], [0, '#ef4444']];
function accColor(acc) { for (const [lim, c] of SEG_COLORS) if (acc >= lim) return c; return '#ef4444'; }

function buildSegments(results) {
    if (!results.length) return [];
    const segs = (typeof getTempoSegmentsForPattern === 'function') ? getTempoSegmentsForPattern(currentPatternType) : null;
    const beat = segs && segs[0] ? segs[0].msPerBeat : 500;
    const t0 = results[0].t, t1 = results[results.length - 1].t;
    let len = beat * 8; // 2 compassos
    while ((t1 - t0) / len > 36) len *= 2;
    const out = [];
    for (let s = t0 - 1; s <= t1; s += len) {
        const inSeg = results.filter(r => r.t >= s && r.t < s + len);
        if (!inSeg.length) { out.push({ from: s, to: s + len, n: 0, acc: null, brk: 0 }); continue; }
        const acc = inSeg.reduce((x, r) => x + r.p, 0) / inSeg.length;
        out.push({ from: s, to: s + len, n: inSeg.length, acc, brk: inSeg.filter(r => r.b).length, first: inSeg[0].t, last: inSeg[inSeg.length - 1].t });
    }
    return out;
}

let resultSelection = null; // { a, b } índices de segmento

function renderResultExtras() {
    const box = ensureResultExtrasBox();
    if (!box || !lastRunSummary) return;
    const { run, prevBest, isRecord, countsForRecord, ladder } = lastRunSummary;
    const results = noteResultsFrom(lastRunSummary.events);
    const segs = buildSegments(results);
    lastRunSummary.segs = segs;
    // pré-seleciona o pior trecho com notas
    let worst = -1;
    segs.forEach((s, i) => { if (s.n >= 3 && (worst < 0 || s.acc < segs[worst].acc)) worst = i; });
    resultSelection = worst >= 0 && segs[worst].acc < 99.5 ? { a: worst, b: worst } : null;

    let recHtml = '';
    if (run.failed) recHtml = `<span class="text-red-300">Partida não concluída (HP zerou) — não conta como recorde.</span>`;
    else if (!countsForRecord) recHtml = `<span class="text-slate-300">${run.section ? 'Treino de trecho' : `Velocidade ${Math.round(run.rate * 100)}%`} — recordes só contam a 100% e com a música inteira.</span>`;
    else if (isRecord) recHtml = `<span class="font-orbitron font-black text-amber-300">🏆 NOVO RECORDE!</span> <span class="text-slate-300">${prevBest ? `antes ${fmtPct(prevBest.acc)} (+${(run.acc - prevBest.acc).toFixed(2)}%)` : 'primeira vez neste treino/modo/dificuldade'}</span>`;
    else if (prevBest) recHtml = `<span class="text-slate-300">Recorde: <b class="text-white">${fmtPct(prevBest.acc)}</b> em ${fmtDate(prevBest.at)} — faltou ${(prevBest.acc - run.acc).toFixed(2)}%</span>`;
    let ladderHtml = '';
    if (ladder) {
        // a escada NÃO continua sozinha: você escolhe avançar (ou repetir) ou encerrar
        const btnGo = 'px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold';
        const btnEnd = 'px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200';
        ladderHtml = ladder.passed
            ? `<div id="ladder-box" class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-[12px]">
                 <span class="text-emerald-300 font-bold">ESCADA: passou a ${Math.round(ladder.rate * 100)}% ✓${ladder.next ? '' : ' — chegou no máximo!'}</span>
                 <span class="flex gap-1.5">${ladder.next ? `<button id="btn-ladder-next" class="${btnGo}">Avançar para ${Math.round(ladder.next * 100)}% (Enter)</button>` : ''}<button id="btn-ladder-stop" class="${btnEnd}">Encerrar escada</button></span>
               </div>`
            : `<div id="ladder-box" class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/40 text-[12px] text-amber-200">
                 <span>ESCADA: ${fmtPct(run.acc)} a ${Math.round(ladder.rate * 100)}% (precisa de ${LADDER_PASS}%). Seu limite hoje: <b>${ladder.best ? Math.round(ladder.best * 100) + '%' : 'abaixo de ' + Math.round(ladder.rate * 100) + '%'}</b>${ladder.prevBest ? ` · melhor de sempre: ${Math.round(ladder.prevBest * 100)}%` : ''}.</span>
                 <span class="flex gap-1.5"><button id="btn-ladder-retry" class="${btnGo}">Tentar de novo a ${Math.round(ladder.rate * 100)}% (Enter)</button><button id="btn-ladder-stop" class="${btnEnd}">Encerrar escada</button></span>
               </div>`;
    }
    box.innerHTML = `
        ${ladderHtml}
        <div class="text-[12px] flex flex-wrap items-center gap-2">${recHtml}</div>
        <div class="bg-slate-800/40 p-4 rounded-xl border border-slate-800">
            <h4 class="text-xs font-bold text-slate-300 mb-2 flex justify-between gap-2"><span>MAPA DA MÚSICA (precisão por trecho)</span><span id="seg-hover" class="font-mono text-slate-400"></span></h4>
            <canvas id="result-seg-map" class="w-full cursor-pointer" height="70"></canvas>
            <div class="flex flex-wrap items-center justify-between gap-2 mt-2">
                <span id="seg-sel-text" class="text-[11px] text-slate-400">Clique num trecho (Shift+clique pra juntar vários) e treine só ele em loop.</span>
                <button id="btn-train-section" class="hidden px-3 py-1.5 bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/60 rounded-lg text-[11px] font-semibold text-pink-200">Treinar este trecho</button>
            </div>
        </div>
        <div class="bg-slate-800/40 p-4 rounded-xl border border-slate-800">
            <h4 class="text-xs font-bold text-slate-300 mb-2">PRECISÃO POR LANE</h4>
            <div id="lane-stats" class="grid gap-1.5"></div>
        </div>`;
    drawSegmentMap();
    renderLaneStats(results);
    const cv = document.getElementById('result-seg-map');
    cv.addEventListener('click', (e) => {
        const i = segIndexAt(e);
        if (i < 0) return;
        if (e.shiftKey && resultSelection) resultSelection = { a: Math.min(resultSelection.a, i), b: Math.max(resultSelection.b, i) };
        else resultSelection = { a: i, b: i };
        drawSegmentMap();
    });
    cv.addEventListener('mousemove', (e) => {
        const i = segIndexAt(e);
        const el = document.getElementById('seg-hover');
        const s = segs[i];
        if (!el) return;
        el.textContent = s ? `${fmtClock(s.from - 2000)}–${fmtClock(s.to - 2000)} · ${s.n ? fmtPct(s.acc) + ` · ${s.n} notas` + (s.brk ? ` · ${s.brk} BREAK` : '') : 'sem notas'}` : '';
    });
    cv.addEventListener('mouseleave', () => { const el = document.getElementById('seg-hover'); if (el) el.textContent = ''; });
    document.getElementById('btn-train-section').addEventListener('click', trainSelectedSection);
    document.getElementById('btn-ladder-next')?.addEventListener('click', () => { clearLadderTimer(); startLadderNext(); });
    document.getElementById('btn-ladder-retry')?.addEventListener('click', () => { clearLadderTimer(); startPractice(); });
    document.getElementById('btn-ladder-stop')?.addEventListener('click', () => { clearLadderTimer(); stopLadder(true); });
}

function segIndexAt(e) {
    const cv = e.currentTarget || document.getElementById('result-seg-map');
    const segs = lastRunSummary?.segs || [];
    if (!segs.length) return -1;
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    return Math.max(0, Math.min(segs.length - 1, Math.floor(x * segs.length)));
}

function drawSegmentMap() {
    const cv = document.getElementById('result-seg-map');
    const segs = lastRunSummary?.segs || [];
    if (!cv) return;
    const w = cv.clientWidth || 600, h = 70;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (!segs.length) return;
    const bw = w / segs.length;
    const base = h - 14;
    // grade recessiva: 80/90/100%
    c.strokeStyle = 'rgba(148,163,184,0.15)'; c.lineWidth = 1;
    [80, 90, 100].forEach(v => { const y = base - (v - 70) / 30 * (base - 4); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); });
    segs.forEach((s, i) => {
        const x = i * bw;
        const sel = resultSelection && i >= resultSelection.a && i <= resultSelection.b;
        if (sel) { c.fillStyle = 'rgba(236,72,153,0.18)'; c.fillRect(x, 0, bw, h); }
        if (!s.n) return;
        const hh = Math.max(3, (Math.max(70, s.acc) - 70) / 30 * (base - 4));
        c.fillStyle = accColor(s.acc);
        const gx = x + 1, gw = Math.max(1, bw - 2);
        c.beginPath();
        if (c.roundRect) c.roundRect(gx, base - hh, gw, hh, [Math.min(4, gw / 2), Math.min(4, gw / 2), 0, 0]); else c.rect(gx, base - hh, gw, hh);
        c.fill();
        if (s.brk) { c.fillStyle = '#ef4444'; c.beginPath(); c.moveTo(x + bw / 2, base + 3); c.lineTo(x + bw / 2 - 4, base + 11); c.lineTo(x + bw / 2 + 4, base + 11); c.fill(); }
    });
    c.fillStyle = '#94a3b8'; c.font = '10px monospace';
    c.textAlign = 'left'; c.fillText(fmtClock(segs[0].from - 2000), 2, h - 1);
    c.textAlign = 'right'; c.fillText(fmtClock(segs[segs.length - 1].to - 2000), w - 2, h - 1);
    const btn = document.getElementById('btn-train-section');
    const txt = document.getElementById('seg-sel-text');
    if (resultSelection) {
        const a = segs[resultSelection.a], b = segs[resultSelection.b];
        const n = segs.slice(resultSelection.a, resultSelection.b + 1).reduce((x, s) => x + s.n, 0);
        btn.classList.toggle('hidden', !n);
        btn.textContent = `Treinar ${fmtClock(a.from - 2000)}–${fmtClock(b.to - 2000)} em loop${Math.abs(gameRate - 1) > 0.001 ? ` (${Math.round(gameRate * 100)}%)` : ''}`;
        if (txt) txt.textContent = `${n} notas no trecho${resultSelection.a === resultSelection.b && segs[resultSelection.a].acc != null ? ` · ${fmtPct(segs[resultSelection.a].acc)}` : ''} — Shift+clique junta trechos. A velocidade da música do menu vale aqui também.`;
    } else {
        btn.classList.add('hidden');
    }
}

function trainSelectedSection() {
    const segs = lastRunSummary?.segs || [];
    if (!resultSelection || !segs.length) return;
    const a = segs[resultSelection.a], b = segs[resultSelection.b];
    pendingSection = { from: Math.max(0, a.from), to: b.to };
    clearLadderTimer();
    ladderMode = false; syncRateUI();
    startPractice();
}

function laneLabel(mode, lane) {
    const kinds = getLaneKinds(mode);
    const k = kinds[lane];
    if (k === 'side' || k === 'trackLR') {
        const pair = getLaneIndicesOfKind(mode, k);
        return `${k === 'side' ? 'SIDE' : 'TRACK'} ${pair && pair[0] === lane ? 'L' : 'R'}`;
    }
    const code = (KEY_CONFIGS[mode] || [])[lane];
    return code && typeof formatKeyCode === 'function' ? formatKeyCode(code) : `L${lane + 1}`;
}

function renderLaneStats(results) {
    const el = document.getElementById('lane-stats');
    if (!el) return;
    const mode = lastRunSummary.run.mode;
    const order = getVisualOrder(mode);
    const rows = order.map(lane => {
        const rs = results.filter(r => r.lane === lane);
        if (!rs.length) return '';
        const acc = rs.reduce((x, r) => x + r.p, 0) / rs.length;
        const ds = rs.filter(r => r.d != null).map(r => r.d);
        const mean = ds.length ? ds.reduce((x, v) => x + v, 0) / ds.length : 0;
        const brk = rs.filter(r => r.b).length;
        const tend = Math.abs(mean) < 4 ? '<span class="text-slate-400">no tempo</span>' : (mean < 0 ? `<span class="text-sky-300">FAST ${Math.round(mean)}ms</span>` : `<span class="text-rose-300">SLOW +${Math.round(mean)}ms</span>`);
        const pct = Math.max(0, Math.min(100, (acc - 70) / 30 * 100));
        return `<div class="grid grid-cols-[64px_1fr_auto] items-center gap-2 text-[11px]">
            <span class="font-mono font-bold text-slate-200 truncate">${escapeHtml(laneLabel(mode, lane))}</span>
            <span class="h-2.5 bg-slate-900 rounded-full overflow-hidden"><span class="block h-full rounded-full" style="width:${pct.toFixed(1)}%;background:${accColor(acc)}"></span></span>
            <span class="font-mono text-slate-200 whitespace-nowrap">${fmtPct(acc)} · ${tend}${brk ? ` · <span class="text-red-400">${brk} BREAK</span>` : ''}</span>
        </div>`;
    }).join('');
    el.innerHTML = rows || '<span class="text-[11px] text-slate-500">Sem notas registradas.</span>';
}

// ---------- velocidade da música + escada de BPM (menu) ----------
const RATE_OPTIONS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5];
function rateLabel(r) {
    const bpm = typeof getBpmForPattern === 'function' ? Math.round(getBpmForPattern(currentPatternType) * r) : null;
    return `${Math.round(r * 100)}%${bpm ? ` · BPM ${bpm}` : ''}`;
}
function ensureRateUI() {
    if (document.getElementById('game-rate')) return;
    const start = document.getElementById('btn-start');
    if (!start) return;
    const wrap = document.createElement('div');
    wrap.id = 'game-rate-box';
    wrap.innerHTML = `
        <label class="block text-[10px] font-bold text-slate-400 mb-1">VELOCIDADE DA MÚSICA <span class="text-slate-500 font-normal">(o tom não muda)</span></label>
        <div class="flex items-center gap-2">
            <select id="game-rate" class="flex-1 min-w-0 bg-slate-800 border border-slate-700 text-[11px] rounded px-2 py-1.5 focus:border-cyan-400 outline-none"></select>
            <label class="flex items-center gap-1 text-[10px] text-slate-300 cursor-pointer whitespace-nowrap" title="Escada de BPM: cada vez que passar de ${LADDER_PASS}%, a música recomeça ${Math.round(LADDER_STEP * 100)}% mais rápida, até achar o seu limite.">
                <input type="checkbox" id="ladder-mode" class="accent-emerald-400"> Escada de BPM</label>
        </div>`;
    start.parentElement.insertBefore(wrap, start);
    const sel = document.getElementById('game-rate');
    sel.addEventListener('change', () => { gameRate = parseFloat(sel.value) || 1; saveRatePref(); });
    document.getElementById('ladder-mode').addEventListener('change', (e) => { ladderMode = !!e.target.checked; saveRatePref(); });
    syncRateUI();
}
function syncRateUI() {
    const sel = document.getElementById('game-rate');
    if (sel) {
        const opts = RATE_OPTIONS.includes(Math.round(gameRate * 100) / 100) ? RATE_OPTIONS : [...RATE_OPTIONS, gameRate].sort((a, b) => a - b);
        sel.innerHTML = opts.map(r => `<option value="${r}">${rateLabel(r)}</option>`).join('');
        sel.value = String(opts.find(r => Math.abs(r - gameRate) < 0.001));
    }
    const lad = document.getElementById('ladder-mode');
    if (lad) lad.checked = ladderMode;
}
function saveRatePref() {
    try { localStorage.setItem('djmaxTrainerRate_v1', JSON.stringify({ rate: gameRate, ladder: ladderMode })); } catch (e) {}
}
function loadRatePref() {
    try {
        const v = JSON.parse(localStorage.getItem('djmaxTrainerRate_v1') || 'null');
        if (v && typeof v.rate === 'number' && v.rate >= 0.5 && v.rate <= 2) gameRate = v.rate;
        if (v && typeof v.ladder === 'boolean') ladderMode = v.ladder;
    } catch (e) {}
}

function clearLadderTimer() { if (ladderTimer) { clearInterval(ladderTimer); ladderTimer = null; } }
function handleLadderAfterRun(ladder) {
    clearLadderTimer(); // (não inicia mais nada sozinho — espera a escolha no resultado)
}
function startLadderNext() {
    const r = lastRunSummary?.ladder;
    if (!r || !r.next) return;
    gameRate = r.next;
    syncRateUI();
    startPractice();
}
function stopLadder() {
    // encerra esta escada: volta pra velocidade em que ela começou (a opção continua ligada no menu)
    gameRate = ladderStartRate; syncRateUI(); saveRatePref();
    const box = document.getElementById('ladder-box');
    if (box) box.innerHTML = `<span class="text-slate-300">Escada encerrada — velocidade de volta a ${Math.round(gameRate * 100)}%. Use RETRY ou o menu quando quiser.</span>`;
}
// Enter no resultado = avançar (ou tentar de novo)
window.addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    const ov = document.getElementById('stats-overlay');
    if (!ov || ov.classList.contains('hidden')) return;
    const b = document.getElementById('btn-ladder-next') || document.getElementById('btn-ladder-retry');
    if (b) { e.preventDefault(); b.click(); }
});

// lembra onde a escada começou (START do menu, não as subidas automáticas)
(function hookStart() {
    const btn = document.getElementById('btn-start');
    if (btn) btn.addEventListener('click', () => { ladderStartRate = gameRate; }, true);
    // sair do resultado / reiniciar cancela a contagem da escada
    ['btn-back-menu', 'btn-retry'].forEach(id => document.getElementById(id)?.addEventListener('click', () => { clearLadderTimer(); if (id === 'btn-back-menu' && ladderMode) { gameRate = ladderStartRate; syncRateUI(); } }, true));
})();

// ---------- recorde nos cards dos treinos ----------
let decorateQueued = false;
function decoratePatternCards() {
    const grid = document.getElementById('pattern-grid');
    if (!grid) return;
    grid.querySelectorAll('.pattern-card[data-pattern]').forEach(card => {
        // treinos de um modo só (TRACK 3 Turbo = 5B, Grave + Side = 8B) somem nos outros modos
        const dr = typeof DRILLS !== 'undefined' ? DRILLS[card.dataset.pattern] : null;
        const hid = !!(dr && dr.modes && !dr.modes.includes(currentMode));
        if (card.classList.contains('hidden') !== hid) card.classList.toggle('hidden', hid);
        const key = `${card.dataset.pattern}|${currentMode}|${currentDifficulty}`;
        const best = bestFor(key);
        const lb = ladderBestFor(key);
        let el = card.querySelector('.rec-line');
        const text = best ? `★ ${fmtPct(best.acc)} · ${rankOf(best.acc)}${best.brk === 0 && best.acc < 100 ? ' · MAX COMBO' : ''}${lb ? ` · escada ${Math.round(lb * 100)}%` : ''}` : (lb ? `escada ${Math.round(lb * 100)}%` : '');
        if (!text) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.className = 'rec-line text-[10px] font-mono text-amber-300/90 truncate';
            const host = card.querySelector('.min-w-0') || card;
            host.appendChild(el);
        }
        if (el.textContent !== text) el.textContent = text; // sem reescrever o que não mudou (evita refazer o layout da lista)
    });
}
function queueDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    setTimeout(() => { decorateQueued = false; decoratePatternCards(); syncRateUI(); }, 30);
}
(function watchCards() {
    const grid = document.getElementById('pattern-grid');
    if (grid && typeof MutationObserver !== 'undefined') new MutationObserver((muts) => {
        if (muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && !n.classList.contains('rec-line')))) queueDecorate();
    }).observe(grid, { childList: true, subtree: true });
    document.getElementById('menu-overlay')?.addEventListener('click', queueDecorate);
})();

// ---------- tela de Histórico & Recordes (botão Analysis) ----------
function ensureHistoryModal() {
    let m = document.getElementById('history-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'history-modal';
    m.className = 'hidden absolute inset-0 bg-slate-950/90 backdrop-blur-md flex justify-center items-center p-4 z-[60]';
    m.innerHTML = `
      <div class="max-w-4xl w-full max-h-full overflow-y-auto bg-slate-900 border border-pink-500/40 rounded-2xl p-5 shadow-2xl flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <h2 class="font-orbitron text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-cyan-400">HISTÓRICO &amp; RECORDES</h2>
            <div class="flex flex-wrap gap-1.5">
                <button id="btn-hist-last" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200">Último resultado</button>
                <button id="btn-hist-backup" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-cyan-700/60 text-[11px] text-cyan-300"><i class="fa-solid fa-download mr-1"></i>Backup</button>
                <button id="btn-hist-close" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200">Fechar</button>
            </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-[11px]">
            <label class="flex items-center gap-1 text-slate-400">Treino
                <select id="hist-pattern" class="max-w-[260px] min-w-0 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100"></select></label>
            <label class="flex items-center gap-1 text-slate-400">Modo
                <select id="hist-mode" class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100"><option value="">Todos</option><option value="4K">4B</option><option value="5K">5B</option><option value="6K">6B</option><option value="8K">8B</option></select></label>
            <span id="hist-count" class="text-slate-500 font-mono"></span>
        </div>
        <div id="hist-tiles" class="grid grid-cols-2 md:grid-cols-4 gap-2"></div>
        <div class="bg-slate-800/40 p-3 rounded-xl border border-slate-800">
            <h4 class="text-xs font-bold text-slate-300 mb-1 flex justify-between"><span>PRECISÃO AO LONGO DO TEMPO</span><span id="hist-hover" class="font-mono text-slate-400"></span></h4>
            <canvas id="hist-chart" class="w-full" height="180"></canvas>
            <div class="flex gap-3 text-[10px] text-slate-400 mt-1"><span class="flex items-center gap-1"><span class="inline-block w-3 h-0.5 bg-cyan-400"></span>precisão (100%)</span><span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full border border-slate-400"></span>outra velocidade/trecho</span><span class="flex items-center gap-1"><span class="inline-block w-3 h-0.5 bg-amber-300"></span>recorde</span></div>
        </div>
        <div class="bg-slate-800/40 p-3 rounded-xl border border-slate-800">
            <h4 class="text-xs font-bold text-slate-300 mb-2">RECORDES</h4>
            <div id="hist-records" class="grid gap-1 text-[11px]"></div>
        </div>
        <div class="bg-slate-800/40 p-3 rounded-xl border border-slate-800">
            <h4 class="text-xs font-bold text-slate-300 mb-2">ÚLTIMAS PARTIDAS</h4>
            <div id="hist-table" class="overflow-x-auto"></div>
        </div>
        <div class="flex justify-end"><button id="btn-hist-clear" class="px-2.5 py-1 rounded bg-slate-900 hover:bg-red-950 border border-red-900/60 text-[10px] text-red-300">Apagar histórico</button></div>
      </div>`;
    (document.getElementById('menu-overlay')?.parentElement || document.body).appendChild(m);
    m.querySelector('#btn-hist-close').addEventListener('click', () => m.classList.add('hidden'));
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    m.querySelector('#btn-hist-last').addEventListener('click', () => { m.classList.add('hidden'); showAnalysis(); if (lastRunSummary) renderResultExtras(); });
    m.querySelector('#btn-hist-backup').addEventListener('click', () => { if (typeof openBackupDialog === 'function') openBackupDialog(); });
    m.querySelector('#hist-pattern').addEventListener('change', renderHistory);
    m.querySelector('#hist-mode').addEventListener('change', renderHistory);
    m.querySelector('#btn-hist-clear').addEventListener('click', () => {
        if (!confirm('Apagar TODO o histórico de partidas e recordes? (Dica: faça um Backup antes.)')) return;
        runHistory = []; saveHistory(); renderHistory(); decoratePatternCards();
    });
    const cv = m.querySelector('#hist-chart');
    cv.addEventListener('mousemove', histChartHover);
    cv.addEventListener('mouseleave', () => { m.querySelector('#hist-hover').textContent = ''; drawHistoryChart(); });
    return m;
}

function openHistoryModal() {
    const m = ensureHistoryModal();
    const sel = m.querySelector('#hist-pattern');
    const pats = [...new Set(runHistory.map(r => r.pattern))];
    sel.innerHTML = `<option value="">Todos os treinos</option>` + pats.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(patternTitle(p))}</option>`).join('');
    sel.value = pats.includes(currentPatternType) ? currentPatternType : '';
    // abre no botão (4B/5B/6B/8B) que está selecionado: recorde de um modo não aparece no outro
    m.querySelector('#hist-mode').value = currentMode || '';
    m.classList.remove('hidden');
    renderHistory();
}

function filteredHistory() {
    const m = document.getElementById('history-modal');
    const p = m.querySelector('#hist-pattern').value, mode = m.querySelector('#hist-mode').value;
    return runHistory.filter(r => (!p || r.pattern === p) && (!mode || r.mode === mode));
}

let histPoints = [];
function renderHistory() {
    const m = document.getElementById('history-modal');
    if (!m) return;
    const runs = filteredHistory();
    m.querySelector('#hist-count').textContent = `${runs.length} partida(s)`;
    const full = runs.filter(r => !r.failed && Math.abs((r.rate || 1) - 1) < 0.001 && !r.section);
    const last10 = full.slice(-10);
    const avg = (a, f) => a.length ? a.reduce((x, r) => x + f(r), 0) / a.length : null;
    const best = full.reduce((b, r) => (!b || r.acc > b.acc ? r : b), null);
    const prev10 = full.slice(-20, -10);
    const trend = (avg(last10, r => r.acc) != null && avg(prev10, r => r.acc) != null) ? avg(last10, r => r.acc) - avg(prev10, r => r.acc) : null;
    const tile = (label, value, sub) => `<div class="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700"><div class="text-[10px] text-slate-400">${label}</div><div class="font-orbitron text-lg font-bold text-white">${value}</div><div class="text-[10px] text-slate-400">${sub || ''}</div></div>`;
    m.querySelector('#hist-tiles').innerHTML = [
        tile('Partidas', runs.length, `${full.length} completas a 100%`),
        tile('Melhor precisão', best ? fmtPct(best.acc) : '—', best ? `${escapeHtml(best.title)} · ${fmtDate(best.at)}` : ''),
        tile('Média (últimas 10)', last10.length ? fmtPct(avg(last10, r => r.acc)) : '—', trend == null ? '' : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend).toFixed(2)}% vs 10 anteriores`),
        tile('Timing (últimas 10)', last10.some(r => r.med != null) ? `${(() => { const v = avg(last10.filter(r => r.med != null), r => r.med); return (v > 0 ? '+' : '') + v.toFixed(1); })()}ms` : '—', last10.some(r => r.spread != null) ? `variação ±${avg(last10.filter(r => r.spread != null), r => r.spread).toFixed(1)}ms` : '')
    ].join('');
    // recordes por treino/modo/dificuldade
    const keys = [...new Set(runs.map(recordKey))];
    const recs = keys.map(k => ({ k, best: bestFor(k), ladder: ladderBestFor(k), n: runs.filter(r => recordKey(r) === k).length })).filter(x => x.best || x.ladder)
        .sort((a, b) => (b.best ? b.best.at : 0) - (a.best ? a.best.at : 0));
    m.querySelector('#hist-records').innerHTML = recs.length ? recs.slice(0, 40).map(x => {
        const [p, mode, diff] = x.k.split('|');
        const b = x.best;
        return `<div class="grid grid-cols-[1fr_auto] gap-2 items-center px-2 py-1 rounded bg-slate-900/60">
            <span class="truncate text-slate-200">${escapeHtml(patternTitle(p))} <span class="text-slate-500 font-mono">${escapeHtml(typeof getModeDisplayName === 'function' ? getModeDisplayName(mode) : mode)} ${escapeHtml(diff)} · ${x.n}x</span></span>
            <span class="font-mono text-amber-300 whitespace-nowrap">${b ? `${fmtPct(b.acc)} ${rankOf(b.acc)}${b.brk === 0 && b.acc < 100 ? ' · MC' : ''} · ${fmtDate(b.at)}` : ''}${x.ladder ? ` · escada ${Math.round(x.ladder * 100)}%` : ''}${(() => { const rp = typeof bestReplayFor === 'function' ? bestReplayFor(x.k, 1, null) : null; return rp ? ` <button data-replay-play="${escapeHtml(rp.id)}" title="Replay do recorde" class="ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 text-[10px]"><i class="fa-solid fa-play"></i></button>` : ''; })()}</span></div>`;
    }).join('') : '<span class="text-slate-500">Ainda sem recordes — termine uma partida a 100% de velocidade.</span>';
    // tabela
    const rows = runs.slice(-60).reverse().map(r => `<tr class="border-t border-slate-800">
        <td class="py-1 pr-2 whitespace-nowrap text-slate-400">${fmtDate(r.at)}</td>
        <td class="py-1 pr-2 max-w-[220px] truncate text-slate-200">${escapeHtml(r.title)}</td>
        <td class="py-1 pr-2 whitespace-nowrap">${escapeHtml(typeof getModeDisplayName === 'function' ? getModeDisplayName(r.mode) : r.mode)} ${escapeHtml(String(r.pattern || '').startsWith('custom:') ? '' : (typeof drillDiffLabel === 'function' ? drillDiffLabel(r.diff) : r.diff))}</td>
        <td class="py-1 pr-2 whitespace-nowrap">${Math.round((r.rate || 1) * 100)}%${r.section ? ' trecho' : ''}${r.ladder ? ' esc.' : ''}</td>
        <td class="py-1 pr-2 whitespace-nowrap font-mono ${r.failed ? 'text-red-400' : 'text-white'}">${fmtPct(r.acc)}${r.failed ? ' ✗' : ''}</td>
        <td class="py-1 pr-2 whitespace-nowrap font-mono">${rankOf(r.acc)}</td>
        <td class="py-1 pr-2 whitespace-nowrap font-mono">${r.brk}</td>
        <td class="py-1 pr-2 whitespace-nowrap font-mono">${r.med == null ? '—' : (r.med > 0 ? '+' : '') + r.med + 'ms'}</td>
        <td class="py-1 whitespace-nowrap">${typeof hasReplay === 'function' && hasReplay(r.id) ? `<button data-replay-play="${escapeHtml(r.id)}" title="Ver o replay desta partida" class="px-1.5 py-0.5 rounded bg-pink-500/20 hover:bg-pink-500/35 border border-pink-500/50 text-pink-200 text-[10px]"><i class="fa-solid fa-play"></i></button>` : ''}</td>
    </tr>`).join('');
    m.querySelector('#hist-table').innerHTML = runs.length ? `<table class="w-full text-[11px] text-left">
        <thead class="text-slate-400"><tr><th class="pr-2 font-normal">Quando</th><th class="pr-2 font-normal">Treino</th><th class="pr-2 font-normal">Modo</th><th class="pr-2 font-normal">Veloc.</th><th class="pr-2 font-normal">Precisão</th><th class="pr-2 font-normal">Rank</th><th class="pr-2 font-normal">BREAK</th><th class="pr-2 font-normal">Timing</th><th class="font-normal">Replay</th></tr></thead>
        <tbody>${rows}</tbody></table>` : '<span class="text-[11px] text-slate-500">Nenhuma partida registrada ainda.</span>';
    drawHistoryChart();
}

function drawHistoryChart(hoverIdx = -1) {
    const m = document.getElementById('history-modal');
    const cv = m && m.querySelector('#hist-chart');
    if (!cv) return;
    const runs = filteredHistory().slice(-120);
    const w = cv.clientWidth || 700, h = 180;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    histPoints = [];
    if (!runs.length) { c.fillStyle = '#64748b'; c.font = '12px sans-serif'; c.fillText('Sem partidas ainda.', 10, 24); return; }
    const L = 38, R = 8, T = 8, B = 18;
    const minAcc = Math.max(0, Math.min(90, Math.floor(Math.min(...runs.map(r => r.acc)) / 5) * 5));
    const yOf = v => T + (1 - (v - minAcc) / (100 - minAcc)) * (h - T - B);
    const xOf = i => runs.length === 1 ? (L + w - R) / 2 : L + i / (runs.length - 1) * (w - L - R);
    c.font = '10px monospace'; c.textAlign = 'right'; c.fillStyle = '#94a3b8';
    c.strokeStyle = 'rgba(148,163,184,0.15)'; c.lineWidth = 1;
    const step = (100 - minAcc) > 30 ? 20 : (100 - minAcc) > 10 ? 5 : 2;
    for (let v = minAcc; v <= 100; v += step) { const y = yOf(v); c.beginPath(); c.moveTo(L, y); c.lineTo(w - R, y); c.stroke(); c.fillText(`${v}%`, L - 4, y + 3); }
    // recorde (melhor até cada ponto) — linha em degraus
    let best = null;
    c.strokeStyle = '#fcd34d'; c.lineWidth = 2; c.beginPath();
    let started = false;
    runs.forEach((r, i) => {
        const counts = !r.failed && Math.abs((r.rate || 1) - 1) < 0.001 && !r.section;
        if (counts && (best == null || r.acc > best)) best = r.acc;
        if (best == null) return;
        const x = xOf(i), y = yOf(best);
        if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
    });
    c.stroke();
    // série principal
    const main = runs.map((r, i) => ({ r, i })).filter(o => !o.r.failed && Math.abs((o.r.rate || 1) - 1) < 0.001 && !o.r.section);
    c.strokeStyle = '#22d3ee'; c.lineWidth = 2; c.beginPath();
    main.forEach((o, k) => { const x = xOf(o.i), y = yOf(o.r.acc); if (!k) c.moveTo(x, y); else c.lineTo(x, y); });
    c.stroke();
    runs.forEach((r, i) => {
        const x = xOf(i), y = yOf(r.acc);
        const counts = !r.failed && Math.abs((r.rate || 1) - 1) < 0.001 && !r.section;
        c.beginPath(); c.arc(x, y, i === hoverIdx ? 5.5 : 4, 0, Math.PI * 2);
        if (counts) { c.fillStyle = '#22d3ee'; c.fill(); c.strokeStyle = '#0f172a'; c.lineWidth = 2; c.stroke(); }
        else { c.fillStyle = '#0f172a'; c.fill(); c.strokeStyle = r.failed ? '#f87171' : '#94a3b8'; c.lineWidth = 1.5; c.stroke(); }
        histPoints.push({ x, y, r });
    });
    if (hoverIdx >= 0 && histPoints[hoverIdx]) {
        const p = histPoints[hoverIdx];
        c.strokeStyle = 'rgba(226,232,240,0.35)'; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, T); c.lineTo(p.x, h - B); c.stroke();
    }
}
function histChartHover(e) {
    const cv = e.currentTarget;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let bi = -1, bd = Infinity;
    histPoints.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0 || bd > 24) return;
    drawHistoryChart(bi);
    const r = histPoints[bi].r;
    document.getElementById('hist-hover').textContent = `${fmtDate(r.at)} · ${r.title} · ${fmtPct(r.acc)} · ${Math.round((r.rate || 1) * 100)}%${r.section ? ' (trecho)' : ''} · ${r.brk} BREAK`;
}

// ---------- velocidade no painel da gear ----------
(function hookGearRate() {
    if (typeof drawGearFrameDynamic !== 'function') return;
    const orig = drawGearFrameDynamic;
    drawGearFrameDynamic = function (P, L, currentTime) {
        orig(P, L, currentTime);
        if (Math.abs(gameRate - 1) > 0.001 && (typeof hudShowFlags !== 'function' || hudShowFlags().panel)) {
            P.text(`♪ ${Math.round(gameRate * 100)}%${activeSection ? ' · TRECHO' : ''}`, L.totalW / 2, L.H + 116, '700 13px "Barlow Condensed", Rajdhani, sans-serif', ladderMode ? '#6ee7b7' : '#fcd34d');
        } else if (activeSection && (typeof hudShowFlags !== 'function' || hudShowFlags().panel)) {
            P.text('TRECHO EM LOOP', L.totalW / 2, L.H + 116, '700 13px "Barlow Condensed", Rajdhani, sans-serif', '#f9a8d4');
        }
    };
})();

loadRatePref();
ensureRateUI();
queueDecorate();


// =====================================================================================
// Treino de trecho: no fim de cada passada, mostra como foi (melhorou/piorou) e pergunta se
// continua — em vez de repetir pra sempre sem dizer nada.
// =====================================================================================
let releasedSection = null;     // trecho que virou "música inteira" (desligou o loop no meio)
let sectionPromptOpen = false;
const SECTION_MSG = {
    first: ['Primeira passada feita — agora é refinar!', 'Aquecido! Bora de novo?', 'Base marcada. Vamos ver se sobe?'],
    better: ['Melhorou! Tá pegando o jeito.', 'Subiu! O treino tá funcionando.', 'Evoluindo! Mais uma pra fixar.', 'Boa! Os dedos estão aprendendo.'],
    same: ['Consistente! Mais uma pra subir?', 'Firme e estável — agora é lapidar.', 'Mesmo nível: tenta relaxar a mão e soltar o ritmo.'],
    worse: ['Caiu um pouco — normal, respira e vai de novo.', 'Oscilou, faz parte. Foca nos primeiros tempos do trecho.', 'Não desanima: errar também é treino.'],
    perfect: ['Trecho dominado! Que tal a música inteira ou subir a velocidade?', 'PERFEITO! Esse pedaço já é seu.'],
    tired: ['Três quedas seguidas: o cansaço pode estar pesando. Uma pausa curta costuma render mais que insistir.']
};
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function sectionPassAccuracy() {
    const sec = activeSection;
    const ns = notes.filter(n => n.time >= sec.from - 1 && n.time <= sec.to + 1 && !n.ghost);
    if (!ns.length) return null;
    const pts = ns.reduce((x, n) => x + (n.missed ? 0 : (n.pointsEarned || 0)), 0);
    return Math.max(0, Math.min(100, pts / (ns.length * 100) * 100));
}

function ensureSectionCard() {
    let el = document.getElementById('section-pass-card');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'section-pass-card';
    el.className = 'hidden absolute inset-0 z-[46] flex items-center justify-center p-4 pointer-events-none';
    el.innerHTML = `<div class="pointer-events-auto max-w-sm w-full bg-slate-900/95 border border-pink-500/50 rounded-2xl p-5 shadow-2xl flex flex-col gap-3 text-center">
        <div id="spc-title" class="font-orbitron text-sm font-bold text-pink-300"></div>
        <div id="spc-acc" class="font-orbitron text-4xl font-black text-white"></div>
        <div id="spc-delta" class="text-[12px] font-mono"></div>
        <div id="spc-msg" class="text-[13px] text-slate-200"></div>
        <div id="spc-list" class="flex flex-wrap justify-center gap-1 text-[10px] font-mono text-slate-400"></div>
        <div class="flex gap-2 mt-1">
            <button id="spc-go" class="flex-1 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[12px] font-bold">Continuar (Enter)</button>
            <button id="spc-stop" class="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[12px] text-slate-200">Sair / descansar</button>
        </div>
        <label class="flex items-center justify-center gap-1.5 text-[10px] text-slate-400 cursor-pointer"><input type="checkbox" id="spc-auto" class="accent-pink-400"> Não perguntar mais neste trecho (só mostrar o resultado)</label>
    </div>`;
    (document.getElementById('game-container') || document.body).appendChild(el);
    el.querySelector('#spc-go').addEventListener('click', continueSectionLoop);
    el.querySelector('#spc-stop').addEventListener('click', stopSectionTraining);
    return el;
}
function ensureToast() {
    let el = document.getElementById('section-toast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'section-toast';
    el.className = 'hidden absolute top-4 left-1/2 -translate-x-1/2 z-[46] px-4 py-2 rounded-xl bg-slate-900/90 border border-pink-500/50 text-[12px] text-slate-100 font-mono pointer-events-none';
    (document.getElementById('game-container') || document.body).appendChild(el);
    return el;
}
let toastTimer = null;
function showToast(text) {
    const el = ensureToast();
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// chamado por script.js quando a passada do trecho termina; true = "deixa comigo"
function onSectionLoopPass() {
    const sec = activeSection;
    if (!sec) return false;
    const acc = sectionPassAccuracy();
    if (acc == null) return false;
    sec.passes = sec.passes || [];
    const prev = sec.passes.length ? sec.passes[sec.passes.length - 1] : null;
    sec.passes.push(acc);
    const n = sec.passes.length;
    const delta = prev == null ? null : acc - prev;
    let kind = prev == null ? 'first' : (delta >= 0.5 ? 'better' : (delta <= -0.5 ? 'worse' : 'same'));
    if (acc >= 100) kind = 'perfect';
    const lastThree = sec.passes.slice(-4);
    const tired = lastThree.length === 4 && lastThree[1] < lastThree[0] - 0.5 && lastThree[2] < lastThree[1] - 0.5 && lastThree[3] < lastThree[2] - 0.5;
    const msg = tired ? SECTION_MSG.tired[0] : pick(SECTION_MSG[kind]);
    const deltaTxt = delta == null ? '' : `${delta >= 0 ? '▲ +' : '▼ '}${delta.toFixed(2)}% vs passada anterior`;
    if (sec.auto) {
        showToast(`Passada ${n}: ${fmtPct(acc)}${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)`} — ${msg}`);
        return false; // segue o loop normal
    }
    // pausa e pergunta
    togglePause();
    document.getElementById('pause-modal')?.classList.add('hidden');
    const card = ensureSectionCard();
    card.querySelector('#spc-title').textContent = `TRECHO ${fmtClock(sec.from - 2000)}–${fmtClock(sec.to - 2000)} · PASSADA ${n}`;
    card.querySelector('#spc-acc').textContent = fmtPct(acc);
    const dEl = card.querySelector('#spc-delta');
    dEl.textContent = deltaTxt || 'primeira passada';
    dEl.className = `text-[12px] font-mono ${delta == null ? 'text-slate-400' : delta >= 0.5 ? 'text-emerald-300' : delta <= -0.5 ? 'text-amber-300' : 'text-slate-300'}`;
    card.querySelector('#spc-msg').textContent = msg;
    const best = Math.max(...sec.passes);
    card.querySelector('#spc-list').innerHTML = sec.passes.slice(-8).map((v, i, a) => `<span class="px-1.5 py-0.5 rounded ${v === best ? 'bg-pink-500/20 text-pink-200' : 'bg-slate-800'}">${v.toFixed(1)}%</span>`).join('');
    const stopBtn = card.querySelector('#spc-stop');
    stopBtn.textContent = (kind === 'worse' || tired) ? 'Descansar um pouco' : 'Sair do trecho';
    stopBtn.className = (kind === 'worse' || tired)
        ? 'flex-1 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/60 text-[12px] font-bold text-amber-200'
        : 'flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[12px] text-slate-200';
    card.querySelector('#spc-go').textContent = kind === 'perfect' ? 'Mais uma (Enter)' : (kind === 'worse' ? 'Treinar de novo (Enter)' : 'Continuar (Enter)');
    card.querySelector('#spc-auto').checked = false;
    card.classList.remove('hidden');
    sectionPromptOpen = true;
    return true;
}
function hideSectionCard() {
    sectionPromptOpen = false;
    document.getElementById('section-pass-card')?.classList.add('hidden');
}
function continueSectionLoop() {
    if (!sectionPromptOpen) return;
    const card = document.getElementById('section-pass-card');
    if (activeSection && card && card.querySelector('#spc-auto').checked) activeSection.auto = true;
    hideSectionCard();
    jumpToTime(loopStart);
    if (isPaused) togglePause();
}
function stopSectionTraining() {
    hideSectionCard();
    document.getElementById('btn-pause-menu')?.click(); // mesmo caminho do QUIT TO MENU
}
window.addEventListener('keydown', (e) => {
    if (!sectionPromptOpen) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); e.stopImmediatePropagation(); continueSectionLoop(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') {
        // vai pro menu de pausa normal (pra mexer no loop, sair etc.), já no começo do trecho
        e.preventDefault(); e.stopImmediatePropagation();
        hideSectionCard();
        jumpToTime(loopStart);
        document.getElementById('pause-modal')?.classList.remove('hidden');
    } else if (!e.ctrlKey && !e.metaKey) {
        e.stopImmediatePropagation(); // tecla de lane não "acorda" o jogo por baixo do aviso
    }
}, true);

// Desligou o loop (ou limpou as marcações) no meio do treino de trecho: volta pra música
// inteira dali pra frente — antes a música seguia mas as notas tinham sumido (só existiam as
// do trecho).
function releaseSectionToFullSong() {
    if (!activeSection || !sectionFullNotes) return;
    const sec = activeSection;
    const nowChart = chartTimeAt(isPaused ? pauseStartTime : performance.now());
    const inSec = n => n.time >= sec.from - 1 && n.time <= sec.to + 1;
    notes = sectionFullNotes.filter(n => inSec(n) || n.time >= nowChart - 1);
    notes.sort((a, b) => a.time - b.time);
    totalPossibleScore = notes.filter(n => !n.ghost).length * 100;
    releasedSection = { from: sec.from, to: sec.to };
    activeSection = null;
    sectionFullNotes = null;
    loopStart = null; loopEnd = null; loopEnabled = false;
    const cb = document.getElementById('setting-loop-enabled'); if (cb) cb.checked = false;
    if (typeof updateLoopStatus === 'function') updateLoopStatus();
    const st = document.getElementById('loop-status');
    if (st) st.innerText = 'Loop desligado: a música segue inteira daqui (não conta como recorde)';
}
document.getElementById('setting-loop-enabled')?.addEventListener('change', (e) => { if (!e.target.checked) releaseSectionToFullSong(); });
document.getElementById('btn-loop-clear')?.addEventListener('click', releaseSectionToFullSong, true);
['btn-start', 'btn-retry', 'btn-pause-restart', 'btn-pause-menu', 'btn-back-menu'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => { releasedSection = null; hideSectionCard(); }, true));

// =====================================================================================
// Bem-estar: mais de 1h jogando sem pausa -> um aviso gentil pra descansar (num momento
// seguro: resultado, pausa ou menu — nunca no meio da música).
// =====================================================================================
const WELL_KEY = 'djmaxTrainerWellbeing_v1';
const WELL_LIMIT_MS = 60 * 60 * 1000;
const WELL_BREAK_MS = 15 * 60 * 1000;   // 15 min sem jogar = pausa de verdade, zera a contagem
const WELL_SNOOZE_MS = 30 * 60 * 1000;
let well = { playMs: 0, lastActive: 0, nextAt: WELL_LIMIT_MS };
try { const v = JSON.parse(localStorage.getItem(WELL_KEY) || 'null'); if (v && typeof v.playMs === 'number') well = { ...well, ...v }; } catch (e) {}
let wellLastTick = performance.now();
function saveWell() { try { localStorage.setItem(WELL_KEY, JSON.stringify(well)); } catch (e) {} }
function wellTick() {
    const nowP = performance.now();
    const dt = Math.min(15000, nowP - wellLastTick);
    wellLastTick = nowP;
    const now = Date.now();
    if (well.lastActive && now - well.lastActive > WELL_BREAK_MS) { well.playMs = 0; well.nextAt = WELL_LIMIT_MS; }
    const playing = isPlaying && !isPaused && !isCountingDown;
    if (playing) { well.playMs += dt; well.lastActive = now; }
    // só num momento seguro: menu, resultado ou pausa (nunca no meio da música/contagem)
    if (well.playMs >= well.nextAt && (!isPlaying || (isPaused && !isCountingDown))) showWellbeing();
    saveWell();
}
function ensureWellModal() {
    let m = document.getElementById('wellbeing-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'wellbeing-modal';
    m.className = 'hidden absolute inset-0 bg-slate-950/85 backdrop-blur-md flex justify-center items-center p-4 z-[90]';
    m.innerHTML = `<div class="max-w-md w-full bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 shadow-2xl flex flex-col gap-3 text-center">
        <div class="text-3xl">🌿</div>
        <h2 class="font-orbitron text-lg font-black text-emerald-300">HORA DE UMA PAUSA?</h2>
        <p id="well-time" class="text-[13px] text-slate-200"></p>
        <p class="text-[12px] text-slate-300 leading-snug">Descanso também faz parte do treino: mãos, olhos e cabeça rendem mais depois de uns 10 minutos longe da tela. Levanta, bebe uma água, alonga os punhos e os dedos — e volta com tudo.</p>
        <div class="flex gap-2 mt-1">
            <button id="well-rest" class="flex-1 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[12px] font-bold">Vou descansar</button>
            <button id="well-more" class="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[12px] text-slate-200">Mais 30 minutos</button>
        </div>
        <p class="text-[10px] text-slate-500">A contagem zera sozinha depois de 15 minutos sem jogar.</p>
    </div>`;
    (document.getElementById('menu-overlay')?.parentElement || document.body).appendChild(m);
    m.querySelector('#well-rest').addEventListener('click', () => {
        m.classList.add('hidden');
        well.nextAt = well.playMs + WELL_SNOOZE_MS; saveWell();
        if (isPlaying) document.getElementById('btn-pause-menu')?.click();
        else if (!document.getElementById('stats-overlay')?.classList.contains('hidden')) document.getElementById('btn-back-menu')?.click();
    });
    m.querySelector('#well-more').addEventListener('click', () => { m.classList.add('hidden'); well.nextAt = well.playMs + WELL_SNOOZE_MS; saveWell(); });
    return m;
}
function showWellbeing() {
    const m = ensureWellModal();
    if (!m.classList.contains('hidden')) return;
    const mins = Math.round(well.playMs / 60000);
    m.querySelector('#well-time').textContent = `Você está jogando há ${mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : mins + ' min'} quase sem parar.`;
    m.classList.remove('hidden');
}
setInterval(wellTick, 5000);
