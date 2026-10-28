// =====================================================================================
// modificadores.js — modificadores no estilo DJMAX.
//
//  RANDOM (lanes)      : OFF, MIRROR, RANDOM, HALF RANDOM, MIRROR + HALF RANDOM
//  VELOCIDADE (CHAOS)  : OFF, SLIDE UP, SLIDE DOWN, CHAOS W, SPECIAL CHAOS
//  FADER               : OFF, FADE IN, FADE OUT, BLINK
//  LANE COVER          : OFF, SUDDEN, HIDDEN, FOG (névoa andando pela pista)
//
// Tudo que é VISUAL (velocidade, fader, névoa) só muda ONDE/COMO a nota é desenhada: ela
// continua chegando na linha exatamente no tempo dela — o julgamento não muda nada.
// O RANDOM troca as lanes da música inteira (vale pra treinos e pras músicas/charts).
// =====================================================================================

// ---------- RANDOM: troca as lanes principais (as extras — Side/TRACK L/R — só espelham) ----------
function modShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
}
function modLaneMap(kind, L) {
    const id = Array.from({ length: L }, (_, i) => i);
    if (kind === 'mirror') return id.map(i => L - 1 - i);
    if (kind === 'random') {
        // embaralha até sair diferente do original (com 4+ lanes quase sempre de primeira)
        for (let t = 0; t < 8; t++) { const m = modShuffle(id.slice()); if (m.some((v, i) => v !== i)) return m; }
        return id.slice().reverse();
    }
    if (kind === 'half_random' || kind === 'mirror_half') {
        const half = Math.floor(L / 2);
        let left = id.slice(0, half), right = id.slice(L - half);
        const mid = L % 2 ? [half] : [];
        if (kind === 'mirror_half') [left, right] = [right, left]; // espelho: as metades trocam de lado
        const map = id.slice();
        const sl = modShuffle(left.slice()), sr = modShuffle(right.slice());
        for (let i = 0; i < half; i++) { map[i] = sl[i]; map[L - half + i] = sr[i]; }
        mid.forEach(c => { map[c] = c; });
        return map;
    }
    return id;
}
// seq: notas já com índice LÓGICO de lane. Aplica o RANDOM escolhido + sorteia o SPECIAL CHAOS.
function applyLaneMods(seq, mode) {
    modRollLaneSpeeds(mode);
    const kind = typeof randomMod !== 'undefined' ? randomMod : 'none';
    if (!kind || kind === 'none') return seq;
    const mainIdx = getMainLaneIndices(mode);
    const L = mainIdx.length;
    const map = modLaneMap(kind, L);
    const pos = new Map(mainIdx.map((lane, i) => [lane, i]));
    const mirrorExtras = kind === 'mirror' || kind === 'mirror_half';
    const pairs = [getSideLaneIndices(mode), getTrackLRIndices(mode)].filter(Boolean);
    seq.forEach(n => {
        if (pos.has(n.lane)) { n.lane = mainIdx[map[pos.get(n.lane)]]; return; }
        if (mirrorExtras) pairs.forEach(p => { if (n.lane === p[0]) n.lane = p[1]; else if (n.lane === p[1]) n.lane = p[0]; });
    });
    return seq;
}

// ---------- VELOCIDADE (CHAOS) ----------
let modLaneSpeed = [];
function modRollLaneSpeeds(mode) {
    const n = (KEY_CONFIGS[mode] || []).length || 10;
    const steps = [0.7, 0.8, 0.9, 1.1, 1.25, 1.4];
    modLaneSpeed = Array.from({ length: n }, () => steps[Math.floor(Math.random() * steps.length)]);
}
// u = distância normal até a linha / altura da pista (0 = na linha, 1 = no topo).
// Toda curva começa em 0 (a nota chega na linha no tempo certo) e sempre sobe (nunca volta).
function modWarp(u, t) {
    const sm = typeof speedMod !== 'undefined' ? speedMod : 'none';
    if (sm === 'slide_up' || sm === 'slide_down') {
        // SLIDE UP: entra devagar lá em cima e acelera chegando na linha; SLIDE DOWN: o contrário
        const a = sm === 'slide_up' ? 1.7 : 0.45, b = 2 - a; // inclinação na linha / no topo
        if (u <= 0) return u * a;
        if (u >= 1) return 1 + (u - 1) * b;
        return a * u + (b - a) * u * u / 2;
    }
    if (sm === 'chaos_w') {
        // velocidade "em ondas": acelera e freia várias vezes no caminho, e a onda anda com o tempo
        if (u <= 0) return u;
        const k = 4 * Math.PI, ph = t / 650, A = 0.55;
        return u + (A / k) * (Math.sin(k * u + ph) - Math.sin(ph));
    }
    return u;
}
// ---------- SV: velocidade que muda sozinha (charts do osu! com pontos de velocidade) ----------
// O chart guarda [{ t, x }]: a partir do tempo t, as notas andam x vezes mais rápido. A nota
// fica na posição "distância percorrida" entre agora e o tempo dela — o julgamento não muda.
const SV_KEY = 'djmaxTrainerSV_v1';
let svEnabled = true;
try { svEnabled = localStorage.getItem(SV_KEY) !== 'off'; } catch (e) {}
let svTable = null, svCacheClock = -1, svCacheNow = 0, svCachePos = 0;
function svLoadForChart(chart) {
    svTable = null; svCacheClock = -1;
    if (!svEnabled || !chart || !Array.isArray(chart.sv) || !chart.sv.length) return;
    const off = typeof CUSTOM_CHART_START_DELAY_MS !== 'undefined' ? CUSTOM_CHART_START_DELAY_MS : 0;
    const pts = chart.sv.map(p => ({ t: (+p.t || 0) + off, x: Math.max(0.01, Math.min(15, +p.x || 1)) })).sort((a, b) => a.t - b.t);
    const T = [], X = [], P = [];
    let pos = 0;
    pts.forEach((p, i) => { if (i) pos += (p.t - pts[i - 1].t) * pts[i - 1].x; T.push(p.t); X.push(p.x); P.push(pos); });
    svTable = { T, X, P };
}
function svPos(t) {
    const { T, X, P } = svTable;
    if (t <= T[0]) return P[0] + (t - T[0]) * X[0];
    let lo = 0, hi = T.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid] <= t) lo = mid; else hi = mid - 1; }
    return P[lo] + (t - T[lo]) * X[lo];
}
function svDiff(timeDiff) {
    const clock = (typeof renderClockMs !== 'undefined' && renderClockMs) || performance.now();
    if (clock !== svCacheClock) {
        svCacheClock = clock;
        svCacheNow = typeof chartTimeAt === 'function' ? chartTimeAt((typeof isPaused !== 'undefined' && isPaused) ? pauseStartTime : clock) : 0;
        svCachePos = svPos(svCacheNow);
    }
    return svPos(svCacheNow + timeDiff) - svCachePos;
}
function setSvEnabled(on) { svEnabled = !!on; try { localStorage.setItem(SV_KEY, on ? 'on' : 'off'); } catch (e) {} }

function modNoteY(timeDiff, speedFactor, lane, targetY) {
    if (svTable) timeDiff = svDiff(timeDiff);
    const sm = typeof speedMod !== 'undefined' ? speedMod : 'none';
    let d = timeDiff * speedFactor;
    if (sm === 'special_chaos') d *= modLaneSpeed[lane] || 1;   // cada coluna na sua velocidade
    if (sm === 'none' || sm === 'special_chaos' || !sm) return targetY - d;
    const R = Math.max(1, targetY);
    return targetY - R * modWarp(d / R, (typeof renderClockMs !== 'undefined' && renderClockMs) || performance.now());
}

// ---------- FADER ----------
function modClamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function modNoteAlpha(y, targetY, now) {
    const fm = typeof faderMod !== 'undefined' ? faderMod : 'none';
    if (!fm || fm === 'none') return 1;
    const p = (targetY - y) / Math.max(1, targetY); // 0 na linha, 1 no topo
    if (fm === 'fade_in') return modClamp01((0.62 - p) / 0.2);   // invisível lá em cima, aparece perto da linha
    if (fm === 'fade_out') return modClamp01((p - 0.22) / 0.2);  // aparece em cima e some antes da linha
    if (fm === 'fade_out2') return modClamp01((p - 0.55) / 0.15); // FADE OUT 2: some já na metade de cima da pista
    if (fm === 'blink') return ((now % 460) < 270) ? 1 : 0.06;   // pisca o tempo todo
    return 1;
}

// FADE OUT nas notas LONGAS: a cauda continua visível e a nota some "entrando" na linha onde
// o fade termina (antes, a nota longa inteira sumia junto com a cabeça).
const MOD_FADE_ZERO = { fade_out: 0.22, fade_out2: 0.55 };
function modFadeOutHolds() { return typeof faderMod !== 'undefined' && MOD_FADE_ZERO[faderMod] != null; }
function modFadeZeroY(targetY) { return targetY - Math.max(1, targetY) * (MOD_FADE_ZERO[faderMod] || 0); }

// ---------- LANE COVER: FOG (névoa) ----------
// Três nuvens escuras descendo devagar pela pista e escondendo trechos diferentes.
function drawModFog(P, W, targetY, t) {
    const R = targetY, band = 170, speed = 0.055;
    const col = '#0a0f1e';
    for (let k = 0; k < 3; k++) {
        const y = ((t * speed + k * (R + band) / 3) % (R + band)) - band;
        const wob = Math.sin(t / 900 + k * 2.1) * 30;
        const h2 = band / 2;
        P.rectV(0, y + wob, W, h2, glWithAlpha(col, 0), glWithAlpha(col, 0.94));
        P.rectV(0, y + wob + h2, W, h2, glWithAlpha(col, 0.94), glWithAlpha(col, 0));
    }
}

// ---------- seletores do menu ----------
(function modUI() {
    const rnd = document.getElementById('mod-random');
    if (rnd && !rnd.querySelector('option[value="half_random"]')) {
        rnd.innerHTML = '<option value="none">OFF</option><option value="mirror">MIRROR</option><option value="random">RANDOM</option><option value="half_random">HALF RANDOM</option><option value="mirror_half">MIRROR + HALF RANDOM</option>';
        rnd.value = randomMod;
        rnd.title = 'MIRROR: espelha · RANDOM: embaralha as lanes · HALF RANDOM: embaralha cada metade separada · MIRROR + HALF: espelha e embaralha cada metade';
    }
    const cov = document.getElementById('mod-cover');
    if (cov && !cov.querySelector('option[value="fog"]')) {
        cov.insertAdjacentHTML('beforeend', '<option value="fog">FOG (névoa)</option>');
        cov.value = coverMod;
    }
    const grid = cov && cov.closest('.grid');
    if (grid && !document.getElementById('mod-speed')) {
        const sel = 'w-full bg-slate-800 border border-slate-700 text-[11px] rounded px-2 py-1.5 focus:border-cyan-400 outline-none';
        const row = document.createElement('div');
        row.className = 'grid grid-cols-2 gap-2';
        row.innerHTML = `
            <div><label class="block text-[10px] font-bold text-slate-400 mb-1">VELOCIDADE (CHAOS)</label>
                <select id="mod-speed" class="${sel}" title="Muda o jeito que a nota desce — ela sempre chega na linha no tempo certo">
                    <option value="none">OFF</option><option value="slide_up">SLIDE UP (acelera)</option><option value="slide_down">SLIDE DOWN (freia)</option>
                    <option value="chaos_w">CHAOS W (ondas)</option><option value="special_chaos">SPECIAL CHAOS (por coluna)</option></select></div>
            <div><label class="block text-[10px] font-bold text-slate-400 mb-1">FADER</label>
                <select id="mod-fader" class="${sel}" title="FADE IN: aparece perto da linha · FADE OUT: some antes da linha · FADE OUT 2: some já na metade do caminho · BLINK: pisca">
                    <option value="none">OFF</option><option value="fade_in">FADE IN</option><option value="fade_out">FADE OUT</option><option value="fade_out2">FADE OUT 2</option><option value="blink">BLINK</option></select></div>`;
        grid.insertAdjacentElement('afterend', row);
        const sp = document.getElementById('mod-speed'), fd = document.getElementById('mod-fader');
        sp.value = speedMod; fd.value = faderMod;
        sp.addEventListener('change', (e) => { speedMod = e.target.value; saveSettings(); });
        fd.addEventListener('change', (e) => { faderMod = e.target.value; saveSettings(); });
        // SV do chart + estilo do 8B
        const row2 = document.createElement('div');
        row2.className = 'grid grid-cols-2 gap-2';
        row2.innerHTML = `
            <div><label class="block text-[10px] font-bold text-slate-400 mb-1">VELOCIDADE DO CHART (SV)</label>
                <select id="mod-sv" class="${sel}" title="Charts do osu! com mudanças de velocidade (SV): as notas aceleram/freiam como no osu!. Vale pra músicas importadas a partir da versão 1.16 (importe de novo as antigas).">
                    <option value="on">ON (segue o chart)</option><option value="off">OFF (constante)</option></select></div>
            <div><label class="block text-[10px] font-bold text-slate-400 mb-1">8B: TRACK L/R</label>
                <select id="mod-lane8" class="${sel}" title="CLÁSSICO: TRACK L/R são as barras vermelhas por cima da pista · COLUNAS: viram 2 colunas normais nas pontas (8 colunas iguais, estilo osu! 8K / EZ2ON)">
                    <option value="djmax">CLÁSSICO (barras vermelhas)</option><option value="osu">8 COLUNAS (osu!/EZ2ON)</option></select></div>`;
        row.insertAdjacentElement('afterend', row2);
        const svSel = document.getElementById('mod-sv'), l8 = document.getElementById('mod-lane8');
        svSel.value = svEnabled ? 'on' : 'off';
        l8.value = typeof lane8Style !== 'undefined' ? lane8Style : 'djmax';
        svSel.addEventListener('change', () => setSvEnabled(svSel.value === 'on'));
        l8.addEventListener('change', () => { if (typeof setLane8Style === 'function') setLane8Style(l8.value); });
    }
})();
