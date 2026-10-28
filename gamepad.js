// =====================================================================================
// gamepad.js — Controle (PS4/PS5/Xbox e compatíveis) pela Gamepad API do navegador.
// Lanes principais no direcional (lado esquerdo) e nos botões de face (lado direito), side
// no L1/R1 (TRACK L/R do 8B no L2/R2). Dá pra remapear nas Configurações.
// O instante do toque usa o carimbo de tempo do próprio controle (mesma base do teclado).
// =====================================================================================

const PAD_KEY = 'djmaxTrainerGamepad_v1';
// Nomes no padrão "standard" da Gamepad API (índices de botão)
const PAD_BUTTON_NAMES = {
    0: '✕ / A', 1: '○ / B', 2: '□ / X', 3: '△ / Y', 4: 'L1 / LB', 5: 'R1 / RB', 6: 'L2 / LT', 7: 'R2 / RT',
    8: 'Share / View', 9: 'Options / Menu', 10: 'L3', 11: 'R3', 12: '↑', 13: '↓', 14: '←', 15: '→', 16: 'PS / Xbox'
};
// lanes principais, da esquerda pra direita
const PAD_MAIN_DEFAULTS = {
    4: [[14], [12], [3], [1]],                 // ← ↑ △ ○
    5: [[14], [12], [15, 0], [3], [1]],        // ← ↑ (→ ou ✕) △ ○ — a TRACK 3 tem 2 botões, pra repetir rápido
    6: [[14], [12], [15], [2], [3], [1]],      // ← ↑ → □ △ ○
    8: [[6], [14], [12], [15], [2], [3], [1], [7]], // 8B em 8 colunas: L2 ← ↑ → □ △ ○ R2
};
let padMaps = {};          // mode -> array por índice LÓGICO de lane -> [botões]
let padPrev = [];          // estado anterior por lane
let padConnected = null;   // id do controle
let padCapture = null;     // remapeando: { mode, order, i }
let padPollTimer = null;

function padDefaultMap(mode) {
    const kinds = getLaneKinds(mode);
    const order = getVisualOrder(mode);
    const mains = order.filter(l => kinds[l] === 'main');
    const def = PAD_MAIN_DEFAULTS[mains.length] || PAD_MAIN_DEFAULTS[6].slice(0, mains.length);
    const map = new Array(kinds.length).fill(null).map(() => []);
    mains.forEach((lane, i) => { map[lane] = (def[i] || []).slice(); });
    const hasTrack = kinds.includes('trackLR');
    ['side', 'trackLR'].forEach(kind => {
        const pair = getLaneIndicesOfKind(mode, kind);
        if (!pair) return;
        if (kind === 'side') { map[pair[0]] = hasTrack ? [4] : [4, 6]; map[pair[1]] = hasTrack ? [5] : [5, 7]; }
        else { map[pair[0]] = [6]; map[pair[1]] = [7]; }
    });
    return map;
}
function padMapFor(mode) {
    const m = padMaps[mode];
    const n = (KEY_CONFIGS[mode] || []).length;
    if (Array.isArray(m) && m.length === n) return m;
    return padDefaultMap(mode);
}
function loadPadMaps() { try { padMaps = JSON.parse(localStorage.getItem(PAD_KEY) || '{}') || {}; } catch (e) { padMaps = {}; } }
function savePadMaps() { try { localStorage.setItem(PAD_KEY, JSON.stringify(padMaps)); } catch (e) {} }

function activePad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
}
function btnDown(pad, i) {
    const b = pad.buttons[i];
    return !!b && (b.pressed || b.value > 0.5);
}

function padMode() {
    const ed = document.getElementById('chart-editor-modal');
    if (ed && !ed.classList.contains('hidden') && typeof editorState !== 'undefined' && editorState.isRecording) return editorState.mode;
    return currentMode;
}

let padStartPrev = false;
function pollGamepad() {
    const pad = activePad();
    if (!pad) { if (padConnected) { padConnected = null; updatePadStatus(); } return; }
    if (padConnected !== pad.id) { padConnected = pad.id; updatePadStatus(); }
    const now = performance.now();
    // carimbo do controle (quando o estado mudou), se for coerente
    const ts = (pad.timestamp > 0 && pad.timestamp <= now + 1 && now - pad.timestamp < 60) ? pad.timestamp : now;

    if (padCapture) { padCaptureStep(pad); return; }

    // Options/Start = pausa
    const startDown = btnDown(pad, 9);
    if (startDown && !padStartPrev && typeof sectionPromptOpen !== 'undefined' && sectionPromptOpen) continueSectionLoop();
    else if (startDown && !padStartPrev && isPlaying && !isCountingDown && typeof togglePause === 'function') togglePause();
    padStartPrev = startDown;

    const mode = padMode();
    const map = padMapFor(mode);
    // Calibrador aberto: os botões das lanes viram toques da calibração
    if (typeof caltPadActive === 'function' && caltPadActive()) {
        for (let lane = 0; lane < map.length; lane++) {
            const down = (map[lane] || []).some(i => btnDown(pad, i));
            if (down && !padPrev[lane]) caltPadTap(ts, lane);
            padPrev[lane] = down;
        }
        return;
    }
    const editorRec = typeof editorState !== 'undefined' && editorState.isRecording && mode === editorState.mode;
    for (let lane = 0; lane < map.length; lane++) {
        const down = (map[lane] || []).some(i => btnDown(pad, i));
        const was = !!padPrev[lane];
        if (down === was) continue;
        padPrev[lane] = down;
        if (editorRec) {
            if (down) handleSimulatorNoteDown(lane); else handleSimulatorNoteUp(lane);
        } else if (down) handleKeyPress(lane, ts);
        else handleKeyRelease(lane, ts);
    }
}

function padLoop() {
    pollGamepad();
    requestAnimationFrame(padLoop);
}
function startPadPolling() {
    // além do quadro da tela, lê a cada ~4ms pra o toque não esperar o próximo quadro
    if (!padPollTimer) padPollTimer = setInterval(() => { if (activePad()) pollGamepad(); }, 4);
}
window.addEventListener('gamepadconnected', () => { startPadPolling(); updatePadStatus(); });
window.addEventListener('gamepaddisconnected', () => { padPrev = []; updatePadStatus(); });

// ---------- Configurações ----------
function laneNameForPad(mode, lane) {
    const kinds = getLaneKinds(mode);
    const k = kinds[lane];
    if (k !== 'main') {
        const pair = getLaneIndicesOfKind(mode, k);
        return `${k === 'side' ? 'SIDE' : 'TRACK'} ${pair && pair[0] === lane ? 'L' : 'R'}`;
    }
    const mains = getVisualOrder(mode).filter(l => kinds[l] === 'main');
    return `Lane ${mains.indexOf(lane) + 1}`;
}
let padUiMode = null;
function renderPadConfig() {
    const box = document.getElementById('pad-config');
    if (!box) return;
    const mode = padUiMode || currentMode;
    const map = padMapFor(mode);
    const order = getVisualOrder(mode);
    box.innerHTML = order.map(lane => {
        const capturing = padCapture && padCapture.mode === mode && padCapture.order[padCapture.i] === lane;
        return `<div class="flex flex-col gap-0.5 px-2 py-1.5 rounded border ${capturing ? 'border-pink-400 bg-pink-500/15' : 'border-slate-700 bg-slate-900/60'}">
            <span class="text-[9px] text-slate-400 font-mono">${laneNameForPad(mode, lane)}</span>
            <span class="text-[11px] font-bold text-slate-100">${capturing ? 'aperte…' : ((map[lane] || []).map(i => PAD_BUTTON_NAMES[i] || `B${i}`).join(' ou ') || '—')}</span></div>`;
    }).join('');
    document.querySelectorAll('[data-pad-mode]').forEach(b => {
        const on = b.dataset.padMode === mode;
        b.classList.toggle('bg-cyan-500', on); b.classList.toggle('text-slate-950', on);
    });
}
function updatePadStatus() {
    const el = document.getElementById('pad-status');
    if (!el) return;
    const pad = activePad();
    el.textContent = pad ? `🎮 Conectado: ${pad.id.replace(/\(.*?\)/g, '').trim().slice(0, 60)}` : 'Nenhum controle detectado — conecte e aperte qualquer botão.';
    el.className = `text-[10px] ${pad ? 'text-emerald-300' : 'text-slate-400'}`;
}
function startPadCapture() {
    const mode = padUiMode || currentMode;
    if (!activePad()) { updatePadStatus(); alert('Conecte o controle e aperte qualquer botão nele antes (o navegador só "vê" o controle depois de um toque).'); return; }
    padCapture = { mode, order: getVisualOrder(mode), i: 0, map: new Array((KEY_CONFIGS[mode] || []).length).fill(null).map(() => []), waitRelease: true };
    renderPadConfig();
}
function padCaptureStep(pad) {
    const c = padCapture;
    const pressed = pad.buttons.map((b, i) => (b.pressed || b.value > 0.5) ? i : -1).filter(i => i >= 0);
    if (c.waitRelease) { if (!pressed.length) c.waitRelease = false; return; }
    if (!pressed.length) return;
    const lane = c.order[c.i];
    c.map[lane] = [pressed[0]];
    c.i++;
    c.waitRelease = true;
    if (c.i >= c.order.length) {
        padMaps[c.mode] = c.map;
        savePadMaps();
        padCapture = null;
    }
    renderPadConfig();
}
(function addPadSettings() {
    const keys = document.getElementById('keybinds-config')?.closest('section');
    if (!keys) return;
    const sec = document.createElement('section');
    sec.className = 'md:col-span-2 bg-slate-800/40 rounded-xl border border-slate-700 p-4 flex flex-col gap-3';
    sec.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-sm font-bold text-cyan-300"><i class="fa-solid fa-gamepad mr-1.5"></i>Controle (gamepad)</h4>
            <div class="flex items-center gap-1.5">
                <div class="flex gap-1">${['4K', '5K', '6K', '8K'].map(m => `<button data-pad-mode="${m}" class="px-2 py-0.5 rounded border border-slate-600 text-[10px] font-bold">${typeof getModeDisplayName === 'function' ? getModeDisplayName(m) : m}</button>`).join('')}</div>
                <button id="btn-pad-map" class="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 border border-cyan-700/60 rounded text-[10px] text-cyan-300">Remapear</button>
                <button id="btn-pad-reset" class="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-300">Padrão</button>
            </div>
        </div>
        <span id="pad-status" class="text-[10px] text-slate-400"></span>
        <span class="text-[10px] text-slate-400 -mt-2">Padrão: lanes no direcional e nos botões ◻ △ ○, side no L1/R1 (8B: TRACK L/R no L2/R2), Options pausa. "Remapear" pede um botão por lane, da esquerda pra direita.</span>
        <div id="pad-config" class="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs"></div>`;
    keys.parentElement.insertBefore(sec, keys.nextSibling);
    sec.querySelectorAll('[data-pad-mode]').forEach(b => b.addEventListener('click', () => { padUiMode = b.dataset.padMode; padCapture = null; renderPadConfig(); }));
    sec.querySelector('#btn-pad-map').addEventListener('click', startPadCapture);
    sec.querySelector('#btn-pad-reset').addEventListener('click', () => { const m = padUiMode || currentMode; delete padMaps[m]; savePadMaps(); padCapture = null; renderPadConfig(); });
    document.getElementById('btn-settings')?.addEventListener('click', () => { padUiMode = currentMode; updatePadStatus(); renderPadConfig(); });
    updatePadStatus();
    renderPadConfig();
})();

loadPadMaps();
requestAnimationFrame(padLoop);
if (activePad()) startPadPolling();
