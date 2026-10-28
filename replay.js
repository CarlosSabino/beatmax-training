// =====================================================================================
// replay.js — REPLAY (rever uma partida exatamente como foi: mesmas teclas, mesmos
// julgamentos) e FANTASMA (durante o jogo, quanto você está na frente/atrás do seu recorde).
//
// Como funciona: durante a partida guardamos cada toque/soltura no "tempo do julgamento"
// (tempo do chart já com o ajuste de sincronia), mais as notas exatamente como caíram (com
// RANDOM e tudo). No replay, as mesmas notas são carregadas e os toques são "apertados"
// sozinhos nos mesmos instantes — o julgamento é o mesmo código do jogo, então o resultado
// sai igual. Fica tudo no IndexedDB do navegador: os 30 últimos replays + o do recorde de
// cada treino/modo/dificuldade/velocidade.
// =====================================================================================

const REPLAY_DB = 'djmax-trainer-replays';
const REPLAY_STORE = 'replays';
const REPLAY_KEEP_RECENT = 30;
const REPLAY_CFG_KEY = 'djmaxTrainerReplay_v1';
const NOTE_RUNTIME_KEYS = new Set(['hit', 'missed', 'holdActive', 'holdResolved', 'pointsEarned', 'headPct', '_ov', 'holdComboTicks', 'sideGlow']);

let replayCfg = { ghost: true };
try { Object.assign(replayCfg, JSON.parse(localStorage.getItem(REPLAY_CFG_KEY) || '{}')); } catch (e) {}
function saveReplayCfg() { try { localStorage.setItem(REPLAY_CFG_KEY, JSON.stringify(replayCfg)); } catch (e) {} }

let replayIndex = new Map();   // id -> resumo (sem as listas grandes) — pra saber o que tem replay
let replayRec = null;          // gravação da partida atual
let replayRun = null;          // replay tocando agora: { data, i, timer, restore }
let replayPending = null;      // replay pedido, esperando o startPractice
let replayInjecting = false;
let ghostRun = null;           // fantasma da partida atual
let lastReplayView = null;     // { id } do último replay assistido (pro "ver de novo")

// ---------- IndexedDB ----------
let replayDbPromise = null;
function replayDb() {
    if (replayDbPromise) return replayDbPromise;
    replayDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('sem IndexedDB'));
        const rq = indexedDB.open(REPLAY_DB, 1);
        rq.onupgradeneeded = () => {
            const db = rq.result;
            if (!db.objectStoreNames.contains(REPLAY_STORE)) db.createObjectStore(REPLAY_STORE, { keyPath: 'id' });
        };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
    });
    return replayDbPromise;
}
function replayTx(mode, fn) {
    return replayDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(REPLAY_STORE, mode);
        const st = tx.objectStore(REPLAY_STORE);
        let out;
        try { out = fn(st); } catch (e) { reject(e); return; }
        tx.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    }));
}
function replayGet(id) { return replayTx('readonly', st => st.get(id)); }
function replayPut(data) { return replayTx('readwrite', st => st.put(data)); }
function replayDelete(id) { return replayTx('readwrite', st => st.delete(id)); }
function replaySummary(d) {
    return { id: d.id, key: d.key, rate: d.rate, acc: d.acc, score: d.score, failed: d.failed, at: d.at, hash: d.hash, title: d.title, mode: d.mode, diff: d.diff, pattern: d.pattern };
}
function loadReplayIndex() {
    return replayTx('readonly', st => {
        const rq = st.openCursor();
        rq.onsuccess = () => {
            const c = rq.result;
            if (!c) return;
            replayIndex.set(c.value.id, replaySummary(c.value));
            c.continue();
        };
        return null;
    }).then(() => { if (typeof renderHistory === 'function' && document.getElementById('history-modal') && !document.getElementById('history-modal').classList.contains('hidden')) renderHistory(); })
      .catch(e => console.warn('[replay] não deu pra abrir os replays salvos:', e));
}
function hasReplay(id) { return replayIndex.has(id); }

// ---------- notas: cópia "limpa" e assinatura ----------
function snapshotNotes(list) {
    return (list || []).map(n => {
        const o = {};
        for (const k of Object.keys(n)) {
            if (NOTE_RUNTIME_KEYS.has(k)) continue;
            const v = n[k];
            if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') o[k] = v;
        }
        return o;
    });
}
function notesFromSnapshot(snap) {
    return snap.map(o => Object.assign({ hit: false, missed: false, holdActive: false, holdResolved: false, pointsEarned: 0 }, o, { holdEnd: o.holdEnd == null ? null : o.holdEnd }));
}
function notesHash(list) {
    let h = 2166136261 >>> 0;
    for (const n of list || []) {
        // sem a lane: com RANDOM as lanes mudam, mas o ritmo (o que o fantasma compara) é o mesmo
        const s = `${Math.round(n.time)}|${n.holdEnd ? Math.round(n.holdEnd) : 0};`;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    }
    return `${(list || []).length}-${h.toString(36)}`;
}
function replayKeyNow() { return `${currentPatternType}|${currentMode}|${currentDifficulty}${typeof perfis !== 'undefined' ? perfis.suffix() : ''}`; }

// ---------- gravação: cada toque/soltura ----------
function replayCanRecordNow() {
    return replayRec && !replayRun && isPlaying && !isPaused && !isCountingDown && !isSongFinished;
}
const _replayOrigPress = window.handleKeyPress;
const _replayOrigRelease = window.handleKeyRelease;
// Cada evento: [lane, tempo do julgamento, apertou(1)/soltou(0), combo depois, HP depois].
// Combo e HP vão junto porque as notas que passam direto (BREAK) e os "ticks" de combo da
// nota longa acontecem no ritmo da TELA (quadro a quadro) — guardando o valor real depois de
// cada toque, o replay mostra exatamente o mesmo combo/HP da partida.
const REPLAY_STRIDE = 5;
function replayRecordInput(orig, down, lane, inputTime) {
    const rec = replayCanRecordNow() ? replayRec : null;
    const t = rec ? Math.round(judgeTimeAt(inputTime) * 10) / 10 : 0;
    const out = orig(lane, inputTime);
    if (rec) rec.inputs.push(lane, t, down, stats.combo || 0, Math.round(hp * 100) / 100);
    return out;
}
window.handleKeyPress = function (lane, inputTime = performance.now()) {
    if (replayRun && !replayInjecting) return;            // assistindo: o teclado não joga
    return replayRecordInput(_replayOrigPress, 1, lane, inputTime);
};
window.handleKeyRelease = function (lane, inputTime = performance.now()) {
    if (replayRun && !replayInjecting) return;
    return replayRecordInput(_replayOrigRelease, 0, lane, inputTime);
};
// voltar/avançar a música no meio (pausa) deixa a partida "não reproduzível"
const _replayOrigJump = window.jumpToTime;
window.jumpToTime = function (t) {
    if (replayRec && !activeSection) replayRec.tainted = true;
    const out = _replayOrigJump(t);
    // no replay dá pra voltar/avançar 5s na pausa: recomeça as teclas a partir dali
    if (replayRun) {
        const inp = replayRun.data.inputs;
        let i = 0;
        while (i < inp.length && inp[i + 1] < t) i += REPLAY_STRIDE;
        replayRun.i = i;
    }
    return out;
};

// Início de partida: o startPractice chama generateNotes() logo no começo.
const _replayOrigGenerate = window.generateNotes;
window.generateNotes = function (pattern, mode) {
    let list = _replayOrigGenerate(pattern, mode);
    // F8 / "recomeçar" no meio de um replay = assistir de novo do começo
    if (replayRun && !replayPending) replayPending = replayRun.data;
    stopReplayTimer();
    if (replayPending) {
        const data = replayPending;
        replayPending = null;
        list = notesFromSnapshot(data.notes);
        totalPossibleScore = list.length * 100;
        replayRun = { data, i: 0, timer: null, restore: replayRun ? replayRun.restore : null };
        replayRec = null;
        ghostRun = null;
        setTimeout(startReplayTimer, 0);
    } else {
        replayRun = null;
        replayRec = { inputs: [], tainted: false, notes: snapshotNotes(list), hash: notesHash(list), key: `${pattern}|${mode}|${currentDifficulty}`, rate: Math.round(gameRate * 100) / 100 };
        ghostRun = null;
        setTimeout(() => {
            if (!replayRec) return;
            replayRec.section = !!activeSection;
            if (replayCfg.ghost && !activeSection && !(typeof isCalibrationRun === 'function' && isCalibrationRun())) loadGhostFor(replayRec);
        }, 0);
    }
    return list;
};

// ---------- replay: aperta as teclas gravadas na hora certa ----------
function stopReplayTimer() { if (replayRun && replayRun.timer) { clearInterval(replayRun.timer); replayRun.timer = null; } }
function startReplayTimer() {
    if (!replayRun) return;
    stopReplayTimer();
    replayRun.timer = setInterval(replayTick, 4);
}
function replayTick() {
    const r = replayRun;
    if (!r) return;
    if (!isPlaying) { stopReplayTimer(); return; }
    if (isPaused || isCountingDown || isSongFinished) return;
    const now = performance.now();
    const jNow = judgeTimeAt(now);
    const inp = r.data.inputs;
    // aperta um tiquinho ANTES (com o instante exato gravado): o julgamento usa o instante
    // informado, e assim nunca perde a nota por o timer atrasar alguns ms
    while (r.i < inp.length && inp[r.i + 1] <= jNow + 16) {
        const lane = inp[r.i], t = inp[r.i + 1], down = inp[r.i + 2];
        const wall = t / gameRate + startTime - globalOffset + getActiveJudgeOffset();
        const maxBefore = stats.maxCombo;
        replayInjecting = true;
        try { if (down) window.handleKeyPress(lane, wall); else window.handleKeyRelease(lane, wall); }
        finally { replayInjecting = false; }
        stats.combo = inp[r.i + 3];
        stats.maxCombo = Math.max(maxBefore, stats.combo);
        hp = inp[r.i + 4];
        r.i += REPLAY_STRIDE;
    }
    // partida original que morreu: o replay para no MESMO instante em que o HP zerou
    if (r.data.failed && r.data.deathT != null && chartTimeAt(now) >= r.data.deathT) finishFailedReplay();
    else if (r.data.failed && r.data.deathT == null && r.i >= inp.length && jNow > (r.data.endT || 0) + 2500) finishFailedReplay();
}
// Também roda no começo de CADA quadro, antes do desenho: é no desenho que a nota que passou
// da linha vira BREAK — assim o toque gravado sempre chega antes dessa checagem, mesmo se o
// timer atrasar (PC ocupado).
const _replayOrigRender = window.render;
window.render = function (ts) {
    if (replayRun) { try { replayTick(); } catch (e) { console.error(e); } }
    // gravando: o último instante desenhado com a partida valendo (= quando o HP zerou)
    else if (replayRec && isPlaying && !isPaused && !isCountingDown && !isSongFinished) replayRec.lastChartT = chartTimeAt(performance.now());
    return _replayOrigRender(ts);
};
function finishFailedReplay() {
    if (!replayRun || isSongFinished) return;
    // as notas que a partida original já tinha dado como BREAK até aquele instante
    const deathT = replayRun.data.deathT;
    if (deathT != null) for (const n of notes) { try { advanceNoteLifecycle(n, deathT); } catch (e) {} }
    isSongFinished = true;
    completionBannerText = '';
    try { stopTrackForCurrentPattern(); } catch (e) {}
    setTimeout(() => {
        stopAllGameLoops();
        showAnalysis();
        afterRunFinished(true);
    }, 600);
}

function captureReplayRestore() {
    return { pattern: currentPatternType, mode: currentMode, diff: currentDifficulty, rate: gameRate, judge: judgeDifficulty, noFail: noFailMode, ladder: typeof ladderMode !== 'undefined' ? ladderMode : false };
}
function restoreAfterReplay() {
    const r = replayRun;
    replayRun = null;
    replayPending = null;
    if (!r || !r.restore) return;
    stopReplayTimerOf(r);
    const s = r.restore;
    currentPatternType = s.pattern; currentMode = s.mode; currentDifficulty = s.diff;
    gameRate = s.rate; noFailMode = s.noFail;
    if (typeof ladderMode !== 'undefined') ladderMode = s.ladder;
    if (typeof applyJudgeProfile === 'function' && s.judge) applyJudgeProfile(s.judge);
    if (typeof syncRateUI === 'function') syncRateUI();
}
function stopReplayTimerOf(r) { if (r && r.timer) { clearInterval(r.timer); r.timer = null; } }

async function playReplay(id) {
    let data;
    try { data = await replayGet(id); } catch (e) { data = null; }
    if (!data) { alert('Esse replay não está mais guardado.'); replayIndex.delete(id); return; }
    const restore = replayRun ? replayRun.restore : captureReplayRestore();
    if (replayRun) { stopReplayTimer(); replayRun = null; }
    currentPatternType = data.pattern; currentMode = data.mode; currentDifficulty = data.diff;
    gameRate = data.rate || 1;
    if (typeof ladderMode !== 'undefined') ladderMode = false;
    if (data.judge && typeof applyJudgeProfile === 'function') applyJudgeProfile(data.judge);
    // o HP do replay vem da gravação, e o fim (inclusive a morte) também: sem falha aqui
    noFailMode = true;
    replayPending = data;
    lastReplayView = { id };
    ['history-modal', 'stats-overlay', 'menu-overlay', 'pause-modal'].forEach(x => document.getElementById(x)?.classList.add('hidden'));
    startPractice();
    if (replayRun) replayRun.restore = restore;
}

// sair pro menu no meio de um replay devolve as configurações
document.getElementById('btn-pause-menu')?.addEventListener('click', () => { if (replayRun) restoreAfterReplay(); }, true);

// ---------- fim da partida: guardar (ou, se era replay, não contar nada) ----------
const _replayOrigAfterRun = window.afterRunFinished;
window.afterRunFinished = function (failed) {
    if (replayRun) {
        const data = replayRun.data;
        restoreAfterReplay();
        renderReplayResultBanner(data);
        return;
    }
    const out = _replayOrigAfterRun(failed);
    try { saveRunReplay(failed); } catch (e) { console.warn('[replay] não salvou:', e); }
    return out;
};

function saveRunReplay(failed) {
    const rec = replayRec;
    replayRec = null;
    if (!rec || rec.tainted || rec.section || !rec.inputs.length) return;
    if (typeof isCalibrationRun === 'function' && isCalibrationRun()) return;
    const run = lastRunSummary && lastRunSummary.run;
    if (!run || !totalPossibleScore) return;
    const results = typeof noteResultsFrom === 'function' ? noteResultsFrom(stats.events) : [];
    const data = {
        id: run.id, key: rec.key, pattern: run.pattern, title: run.title, mode: run.mode, diff: run.diff,
        rate: run.rate, judge: run.judge, at: run.at, acc: run.acc, score: run.score, failed: !!failed,
        maxCombo: run.maxCombo, noFail: !!run.noFail, deathT: failed && rec.lastChartT != null ? rec.lastChartT : null, hash: rec.hash, notes: rec.notes, inputs: rec.inputs,
        res: results.map(r => [Math.round(r.t * 10) / 10, r.p]),
        endT: Math.max(rec.inputs.length ? rec.inputs[rec.inputs.length - REPLAY_STRIDE + 1] : 0, results.length ? results[results.length - 1].t : 0),
        v: 2
    };
    replayPut(data).then(() => {
        replayIndex.set(data.id, replaySummary(data));
        pruneReplays();
        renderReplayBar();
    }).catch(e => console.warn('[replay] IndexedDB cheio/indisponível:', e));
}

// guarda os 30 últimos + o melhor de cada treino/modo/dificuldade/velocidade
function bestReplayFor(key, rate, hash, exceptId) {
    let best = null;
    for (const s of replayIndex.values()) {
        if (s.id === exceptId || s.key !== key || s.failed || Math.abs((s.rate || 1) - rate) > 0.001) continue;
        if (hash && s.hash !== hash) continue;
        if (!best || s.acc > best.acc || (s.acc === best.acc && s.score > best.score)) best = s;
    }
    return best;
}
function pruneReplays() {
    const all = [...replayIndex.values()].sort((a, b) => b.at - a.at);
    const keep = new Set(all.slice(0, REPLAY_KEEP_RECENT).map(s => s.id));
    const groups = new Set(all.map(s => `${s.key}@${s.rate}`));
    groups.forEach(g => {
        const [key, rate] = [g.slice(0, g.lastIndexOf('@')), +g.slice(g.lastIndexOf('@') + 1)];
        const b = bestReplayFor(key, rate, null);
        if (b) keep.add(b.id);
    });
    all.forEach(s => {
        if (keep.has(s.id)) return;
        replayIndex.delete(s.id);
        replayDelete(s.id).catch(() => {});
    });
}

// ---------- FANTASMA: diferença pro recorde durante o jogo ----------
async function loadGhostFor(rec) {
    const best = bestReplayFor(rec.key, rec.rate, rec.hash);
    if (!best) return;
    let data;
    try { data = await replayGet(best.id); } catch (e) { return; }
    if (!data || replayRec !== rec) return;   // já começou outra partida
    const res = (data.res || []).slice().sort((a, b) => a[0] - b[0]);
    ghostRun = { res, ptr: 0, sum: 0, diff: 0, acc: data.acc, at: data.at, lastCalc: 0 };
}
function updateGhost() {
    const g = ghostRun;
    if (!g || !isPlaying || isCountingDown || !totalPossibleScore) return;
    const now = performance.now();
    if (now - g.lastCalc < 100) return;
    g.lastCalc = now;
    // só compara as notas que já foram decididas nas DUAS partidas (passou a janela toda)
    const horizon = chartTimeAt(isPaused ? pauseStartTime : now) - (TIMING.MAX1 + getActiveJudgeOffset()) * gameRate - 20;
    while (g.ptr < g.res.length && g.res[g.ptr][0] < horizon) { g.sum += g.res[g.ptr][1]; g.ptr++; }
    let mine = 0;
    const results = typeof noteResultsFrom === 'function' ? noteResultsFrom(stats.events) : [];
    for (const r of results) { if (r.t < horizon) mine += r.p; else break; }
    g.diff = Math.round(1e6 * (mine - g.sum) / totalPossibleScore);
    g.started = g.ptr > 0;
}

// desenho no HUD (WebGL e Canvas 2D usam a mesma função)
const _replayOrigHud = window.drawGameHud;
window.drawGameHud = function (P, W, H) {
    _replayOrigHud(P, W, H);
    if (!(isPlaying && !isCountingDown && !isSongFinished)) return;
    const font = '700 19px "Barlow Condensed", Rajdhani, sans-serif';
    let y = 38;
    if (replayRun) {
        const d = replayRun.data;
        P.text('▶ REPLAY', 12, y, '800 30px "Barlow Condensed", Rajdhani, sans-serif', '#f472b6', { align: 'left', alpha: 0.95 });
        P.text(`${fmtDate(d.at)} · ${fmtPct(d.acc)}`, 12, y + 24, font, '#e2e8f0', { align: 'left', alpha: 0.8 });
        return;
    }
    if (ghostRun && replayCfg.ghost) {
        updateGhost();
        if (!ghostRun.started) return;
        const d = ghostRun.diff;
        const c = d > 0 ? '#4ade80' : d < 0 ? '#f87171' : '#e2e8f0';
        P.text('VS RECORDE', 12, y, font, '#cbd5e1', { align: 'left', alpha: 0.8 });
        P.text((d > 0 ? '+' : d < 0 ? '-' : '') + Math.abs(d), 12, y + 34, '700 36px "Barlow Condensed", Rajdhani, sans-serif', c, { align: 'left' });
    }
};

// ---------- tela de resultado ----------
const _replayOrigRenderExtras = window.renderResultExtras;
window.renderResultExtras = function () {
    const out = _replayOrigRenderExtras.apply(this, arguments);
    renderReplayBar();
    return out;
};
function replayBtn(id, label, cls) {
    return `<button data-replay-play="${id}" class="px-2.5 py-1 rounded ${cls || 'bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/60 text-pink-200'} text-[11px] font-bold"><i class="fa-solid fa-play mr-1"></i>${label}</button>`;
}
function renderReplayBar() {
    const box = document.getElementById('result-extras');
    if (!box || !lastRunSummary || !lastRunSummary.run) return;
    let bar = document.getElementById('replay-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'replay-bar';
        bar.className = 'flex flex-wrap items-center gap-2 text-[11px]';
        box.insertBefore(bar, box.firstChild);
    }
    const run = lastRunSummary.run;
    const parts = [];
    if (hasReplay(run.id)) parts.push(replayBtn(run.id, 'Ver replay'));
    const best = bestReplayFor(`${run.pattern}|${run.mode}|${run.diff}${typeof perfis !== 'undefined' ? perfis.suffix() : ''}`, run.rate || 1, replayIndex.get(run.id)?.hash || null, run.id);
    if (best && (!hasReplay(run.id) || best.acc >= run.acc)) parts.push(replayBtn(best.id, `Replay do recorde (${fmtPct(best.acc)})`, 'bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/60 text-amber-200'));
    bar.innerHTML = parts.join('');
    bar.classList.toggle('hidden', !parts.length);
}
function renderReplayResultBanner(data) {
    const box = (typeof ensureResultExtrasBox === 'function') ? ensureResultExtrasBox() : document.getElementById('result-extras');
    if (!box) return;
    box.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-pink-500/10 border border-pink-500/40 text-[12px]">
        <span class="text-pink-200"><b>REPLAY</b> de ${escapeHtml(data.title || patternTitle(data.pattern))} · ${fmtDate(data.at)} — não conta no histórico nem nos recordes.</span>
        ${replayBtn(data.id, 'Ver de novo')}
    </div>`;
}
document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-replay-play]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    playReplay(b.dataset.replayPlay);
});

// ---------- configurações ----------
(function addReplaySettings() {
    const anchor = document.getElementById('setting-gameover-video')?.closest('label') || document.getElementById('setting-auto-fullscreen')?.closest('label');
    if (!anchor) return;
    const l = document.createElement('label');
    l.className = 'flex items-start justify-between gap-3 cursor-pointer';
    l.innerHTML = `<span><span class="text-xs font-bold text-slate-200 block">Fantasma do recorde</span><span class="text-[10px] text-slate-400">Durante o jogo mostra, no canto da pista, quantos pontos você está na frente (verde) ou atrás (vermelho) do seu recorde no mesmo treino, modo, dificuldade e velocidade.</span></span>
        <input type="checkbox" id="setting-ghost" ${replayCfg.ghost ? 'checked' : ''} class="accent-cyan-400 w-5 h-5 cursor-pointer shrink-0 mt-0.5">`;
    anchor.after(l);
    l.querySelector('input').addEventListener('change', (e) => { replayCfg.ghost = !!e.target.checked; saveReplayCfg(); });
})();

loadReplayIndex();
