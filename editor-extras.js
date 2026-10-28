// =====================================================================================
// editor-extras.js — Desfazer/Refazer no editor de charts (Ctrl+Z / Ctrl+Y) e rascunho
// automático logo depois de cada alteração (antes era só a cada 30s).
// Funciona por "fotos" do chart: depois de cada ação (soltar o mouse, tecla, mudar um campo,
// parar a gravação) compara o chart com a última foto; se mudou, guarda a anterior na pilha.
// =====================================================================================

const EDITOR_UNDO_LIMIT = 150;
const editorHist = { undo: [], redo: [], last: null, timer: null, autosaveTimer: null };

function editorSnapshotJSON() {
    return JSON.stringify({
        mode: editorState.mode, bpm: editorState.bpm, duration: editorState.duration,
        notes: editorState.notes.map(n => [n.time, n.lane, n.holdEnd == null ? null : n.holdEnd]),
        pins: editorState.pins, sections: editorState.sections, bpmChanges: editorState.bpmChanges,
        songEndMs: editorState.songEndMs
    });
}

function editorHistReset() {
    editorHist.undo = []; editorHist.redo = [];
    editorHist.last = editorSnapshotJSON();
    updateEditorUndoButtons();
}

function isEditorOpen() {
    const m = document.getElementById('chart-editor-modal');
    return !!m && !m.classList.contains('hidden');
}

// Chamado depois de cada ação; agrupa ações seguidas no mesmo instante numa foto só
function editorHistCommitSoon() {
    if (!isEditorOpen()) return;
    clearTimeout(editorHist.timer);
    editorHist.timer = setTimeout(editorHistCommit, 0);
}
function editorHistCommit() {
    if (!isEditorOpen() || editorState.isRecording || editorState.moveDrag || editorState.dragNote || editorState.stairDrag || editorState.marqueeStart) return;
    if (editorHist.last == null) { editorHist.last = editorSnapshotJSON(); return; }
    const cur = editorSnapshotJSON();
    if (cur === editorHist.last) return;
    editorHist.undo.push(editorHist.last);
    if (editorHist.undo.length > EDITOR_UNDO_LIMIT) editorHist.undo.shift();
    editorHist.redo = [];
    editorHist.last = cur;
    updateEditorUndoButtons();
    scheduleEditorAutosave();
}

function restoreEditorSnapshot(json) {
    const s = JSON.parse(json);
    const modeChanged = s.mode !== editorState.mode;
    editorState.mode = s.mode;
    editorState.bpm = s.bpm;
    editorState.duration = s.duration;
    editorState.notes = s.notes.map(([time, lane, holdEnd]) => ({ time, lane, holdEnd }));
    editorState.pins = (s.pins || []).slice();
    editorState.sections = (s.sections || []).map(x => ({ ...x }));
    editorState.bpmChanges = (s.bpmChanges || []).map(x => ({ ...x }));
    editorState.songEndMs = typeof s.songEndMs === 'number' ? s.songEndMs : null;
    editorState.selectedIndex = -1;
    editorState.selectedIndices = new Set();
    editorState.dragNote = null; editorState.moveDrag = null;
    setEditorFormValue('editor-mode', editorState.mode);
    setEditorFormValue('editor-bpm', editorState.bpm);
    setEditorFormValue('editor-duration', editorState.duration);
    if (typeof renderEditorPinsList === 'function') renderEditorPinsList();
    if (typeof renderEditorSectionsList === 'function') renderEditorSectionsList();
    if (modeChanged && typeof renderEditorTrackLabels === 'function') renderEditorTrackLabels();
    resizeEditorCanvas();
    renderEditorCanvas();
}

function editorUndo() {
    if (!editorHist.undo.length) { flashEditorStatus('Nada pra desfazer.'); return; }
    editorHistCommit(); // se tinha algo pendente, vira uma foto antes
    if (!editorHist.undo.length) return;
    editorHist.redo.push(editorHist.last);
    editorHist.last = editorHist.undo.pop();
    restoreEditorSnapshot(editorHist.last);
    updateEditorUndoButtons();
    scheduleEditorAutosave();
    flashEditorStatus(`↶ Desfeito (${editorHist.undo.length} passo(s) ainda dá pra desfazer)`);
}
function editorRedo() {
    if (!editorHist.redo.length) { flashEditorStatus('Nada pra refazer.'); return; }
    editorHist.undo.push(editorHist.last);
    editorHist.last = editorHist.redo.pop();
    restoreEditorSnapshot(editorHist.last);
    updateEditorUndoButtons();
    scheduleEditorAutosave();
    flashEditorStatus('↷ Refeito');
}
function updateEditorUndoButtons() {
    const u = document.getElementById('btn-editor-undo'), r = document.getElementById('btn-editor-redo');
    if (u) u.disabled = !editorHist.undo.length;
    if (r) r.disabled = !editorHist.redo.length;
}

// rascunho automático ~1,5s depois da última alteração (além do de 30 em 30s que já existia)
function scheduleEditorAutosave() {
    clearTimeout(editorHist.autosaveTimer);
    editorHist.autosaveTimer = setTimeout(() => { if (typeof runEditorAutosave === 'function') runEditorAutosave(); }, 1500);
}

(function wireEditorHistory() {
    // abrir um chart / chart novo = histórico novo (depois de uma possível recuperação de rascunho)
    if (typeof openChartEditor === 'function') {
        const origOpen = openChartEditor;
        openChartEditor = function (...args) { const r = origOpen.apply(this, args); editorHistReset(); return r; };
    }
    if (typeof newBlankChartInEditor === 'function') {
        const origNew = newBlankChartInEditor;
        newBlankChartInEditor = function (...args) { const r = origNew.apply(this, args); editorHistReset(); return r; };
    }
    if (typeof loadChartIntoEditor === 'function') {
        const origLoad = loadChartIntoEditor;
        loadChartIntoEditor = function (...args) { const r = origLoad.apply(this, args); editorHistReset(); Promise.resolve(r).then(() => editorHistReset()).catch(() => {}); return r; };
    }
    if (typeof stopEditorPlayback === 'function') {
        const origStop = stopEditorPlayback;
        stopEditorPlayback = function (...args) { const r = origStop.apply(this, args); editorHistCommitSoon(); return r; };
    }
    const modal = document.getElementById('chart-editor-modal');
    window.addEventListener('mouseup', editorHistCommitSoon);
    if (modal) {
        modal.addEventListener('click', editorHistCommitSoon);
        modal.addEventListener('change', editorHistCommitSoon);
        modal.addEventListener('input', () => { clearTimeout(editorHist.timer); editorHist.timer = setTimeout(editorHistCommit, 600); });
    }
    window.addEventListener('keyup', (e) => { if (isEditorOpen() && !editorState.isRecording) editorHistCommitSoon(); });
    window.addEventListener('keydown', (e) => {
        if (!isEditorOpen() || editorState.isRecording) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); editorUndo(); }
        else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); editorRedo(); }
    }, true);
    document.getElementById('btn-editor-undo')?.addEventListener('click', (e) => { e.stopPropagation(); editorUndo(); });
    document.getElementById('btn-editor-redo')?.addEventListener('click', (e) => { e.stopPropagation(); editorRedo(); });
    // fechou/recarregou a aba: grava o rascunho na hora
    window.addEventListener('pagehide', () => { try { if (isEditorOpen()) runEditorAutosave(); } catch (e) {} });
    updateEditorUndoButtons();
})();

// Mostrar/esconder a barra de pins/seções muda a altura da grade — e a "posição atual" (lida
// na borda de baixo da grade) andava junto: criar um pin e apertar P de novo no mesmo lugar
// criava OUTRO pin em vez de remover. Agora a grade é reajustada pra continuar no mesmo tempo.
function keepEditorPositionWhile(fn) {
    const wrap = document.getElementById('editor-canvas-wrap');
    const canKeep = wrap && isEditorOpen() && !editorState.simulatorMode && !editorState.isRefAudioPlaying;
    const t = canKeep ? getEditorElapsedMs() : null;
    const r = fn();
    if (canKeep && t != null) {
        const top = editorTimeToAbsY(t) - wrap.clientHeight;
        if (Math.abs(wrap.scrollTop - top) > 0.5) wrap.scrollTop = Math.max(0, top);
    }
    return r;
}
['renderEditorPinsList', 'renderEditorSectionsList', 'toggleEditorPin', 'toggleEditorAddSection'].forEach(name => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (...args) { return keepEditorPositionWhile(() => orig.apply(this, args)); };
});

// =====================================================================================
// FIM DA MÚSICA: marca onde a música acaba de verdade. No jogo, a partida termina ali (a
// música some num fade curto) em vez de esperar 10-15s de silêncio no fim do arquivo.
// =====================================================================================
function editorCurrentRawMs() {
    // mesma posição que pins/seções usam; tocando, desconta o offset de áudio (igual à gravação)
    return editorState.isRefAudioPlaying ? getEditorElapsedMs() - globalOffset : getEditorElapsedMs();
}
function lastEditorNoteEndMs() {
    let end = 0;
    editorState.notes.forEach(n => { end = Math.max(end, n.holdEnd != null ? n.holdEnd : n.time); });
    return end;
}
function setEditorSongEnd(ms, why) {
    editorState.songEndMs = ms == null ? null : Math.max(0, Math.round(ms));
    renderEditorCanvas();
    if (typeof renderEditorTimeline === 'function') renderEditorTimeline();
    if (typeof editorHistCommit === 'function') editorHistCommit();
    if (ms == null) { flashEditorStatus('🏁 Fim da música removido — o jogo volta a ir até o fim do áudio.'); return; }
    const last = lastEditorNoteEndMs();
    const warn = editorState.songEndMs < last ? ` ⚠️ Está ANTES da última nota (${fmtEdTime(last)}) — no jogo a partida só termina depois dela.` : '';
    const tail = editorState.audioBuffer ? Math.max(0, editorState.audioBuffer.duration * 1000 - editorState.songEndMs) : 0;
    flashEditorStatus(`🏁 Fim da música em ${fmtEdTime(editorState.songEndMs)}${why ? ` (${why})` : ''}${tail > 500 ? ` — corta ${(tail / 1000).toFixed(1)}s do fim do áudio` : ''}. Salve o chart pra valer no jogo.${warn}`);
}
function fmtEdTime(ms) {
    const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = Math.round(ms % 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
function toggleEditorSongEnd() {
    const t = editorCurrentRawMs();
    const beat = tempoSegmentAt(getEditorTempoSegments(), t).msPerBeat;
    if (editorState.songEndMs != null && Math.abs(editorState.songEndMs - t) <= Math.max(250, beat)) { setEditorSongEnd(null); return; }
    setEditorSongEnd(t);
}
// Onde o som acaba de verdade: último trecho de 50ms acima de ~-36dB do pico (+0,4s de "rabo")
function detectSongEndFromAudio(buffer) {
    if (!buffer) return null;
    const sr = buffer.sampleRate, win = Math.max(1, Math.round(sr * 0.05));
    const chs = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) chs.push(buffer.getChannelData(c));
    const nWin = Math.floor(buffer.length / win);
    const rms = new Float32Array(nWin);
    let peak = 0;
    for (let w = 0; w < nWin; w++) {
        let sum = 0;
        const o = w * win;
        for (let i = 0; i < win; i += 2) { let v = 0; for (const ch of chs) v += ch[o + i]; v /= chs.length; sum += v * v; }
        rms[w] = Math.sqrt(sum / (win / 2));
        if (rms[w] > peak) peak = rms[w];
    }
    if (!peak) return null;
    const thr = Math.max(peak * 0.016, 0.0015);
    let lastLoud = -1;
    for (let w = nWin - 1; w >= 0; w--) if (rms[w] > thr) { lastLoud = w; break; }
    if (lastLoud < 0) return null;
    const endMs = Math.min(buffer.duration * 1000, (lastLoud + 1) * 50 + 400);
    return { endMs, silenceMs: buffer.duration * 1000 - endMs };
}
function autoEditorSongEnd() {
    if (!editorState.audioBuffer) { flashEditorStatus('Importe o áudio primeiro — o "Auto" procura o silêncio no fim dele.'); return; }
    const r = detectSongEndFromAudio(editorState.audioBuffer);
    if (!r || r.silenceMs < 800) { flashEditorStatus('O áudio não tem silêncio sobrando no fim — não precisa marcar o fim.'); return; }
    setEditorSongEnd(Math.max(r.endMs, lastEditorNoteEndMs() + 500), 'achado pelo silêncio do áudio');
    goToEditorTime(Math.max(0, (editorState.songEndMs - 3000) / 1000));
}

function drawSongEndMarker() {
    if (editorState.songEndMs == null || editorState.simulatorMode || editorState.highwayMode) return;
    const canvasEl = document.getElementById('editorCanvas');
    if (!canvasEl) return;
    const c = canvasEl.getContext('2d');
    const y = editorTimeToAbsY(editorState.songEndMs) - (editorState.canvasWindowTopPx || 0);
    if (y < -20) return;
    c.save();
    // depois do fim (pra cima, o tempo sobe) fica escurecido
    c.fillStyle = 'rgba(2,6,23,0.55)';
    c.fillRect(0, 0, canvasEl.width, Math.max(0, Math.min(canvasEl.height, y)));
    if (y <= canvasEl.height + 20) {
        c.strokeStyle = '#fb7185'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(0, y); c.lineTo(canvasEl.width, y); c.stroke();
        c.fillStyle = '#fda4af'; c.font = 'bold 12px monospace'; c.textAlign = 'left';
        c.fillText(`🏁 FIM DA MÚSICA ${fmtEdTime(editorState.songEndMs)}`, 6, y - 6);
    }
    c.restore();
}
function drawSongEndTimeline() {
    if (editorState.songEndMs == null || typeof editorTimelineGeometry !== 'function') return;
    const g = editorTimelineGeometry();
    if (!g) return;
    const c = g.c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const y = g.yOf(Math.max(0, Math.min(g.totalMs, editorState.songEndMs)));
    c.fillStyle = 'rgba(2,6,23,0.6)';
    c.fillRect(0, 0, g.W, Math.max(0, y));
    c.fillStyle = '#fb7185';
    c.fillRect(0, y - 1.5, g.W, 3);
    c.restore();
}
(function wireSongEnd() {
    const r0 = window.renderEditorCanvas;
    if (typeof r0 === 'function') window.renderEditorCanvas = function (...a) { const r = r0.apply(this, a); try { drawSongEndMarker(); } catch (e) {} return r; };
    const t0 = window.renderEditorTimeline;
    if (typeof t0 === 'function') window.renderEditorTimeline = function (...a) { const r = t0.apply(this, a); try { drawSongEndTimeline(); } catch (e) {} return r; };
    document.getElementById('btn-editor-song-end')?.addEventListener('click', () => startSongEndPlacement());
    document.getElementById('btn-editor-song-end-auto')?.addEventListener('click', autoEditorSongEnd);
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'End' || !isEditorOpen() || editorState.isRecording) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        if (songEndPlace.active) stopSongEndPlacement(); else startSongEndPlacement();
    });
    // áudio novo com silêncio grande no fim: sugere marcar
    const imp = window.handleEditorAudioImport;
    if (typeof imp === 'function') window.handleEditorAudioImport = async function (...a) {
        const r = await imp.apply(this, a);
        try {
            if (editorState.audioBuffer && editorState.songEndMs == null) {
                const d = detectSongEndFromAudio(editorState.audioBuffer);
                if (d && d.silenceMs >= 3000) flashEditorStatus(`🏁 Esse áudio tem ~${Math.round(d.silenceMs / 1000)}s de silêncio no fim — clique em "Auto" (ao lado de Fim da música) pra a partida terminar quando a música acaba.`);
            }
        } catch (e) {}
        return r;
    };
})();


// ---------- escolher ONDE fica o fim: clicar na grade, arrastar a linha ou digitar o tempo ----------
const songEndPlace = { active: false, hoverMs: null, drag: false };

function ensureSongEndBar() {
    let bar = document.getElementById('editor-songend-bar');
    if (bar) return bar;
    const wrap = document.getElementById('editor-canvas-wrap');
    const host = wrap ? wrap.parentElement : document.getElementById('chart-editor-modal');
    bar = document.createElement('div');
    bar.id = 'editor-songend-bar';
    bar.className = 'hidden absolute top-2 left-1/2 -translate-x-1/2 z-30 max-w-[95%] flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/95 border border-rose-500/70 shadow-xl text-[11px] text-slate-100';
    bar.innerHTML = `
        <span class="font-bold text-rose-300">🏁 Onde a música termina?</span>
        <span id="seb-hint" class="text-slate-300">Clique na grade (ou na timeline à direita)</span>
        <span class="text-slate-500">ou digite:</span>
        <input id="seb-time" type="text" placeholder="m:ss.000" class="w-20 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 font-mono text-slate-100">
        <button id="seb-ok" class="px-1.5 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold">OK</button>
        <button id="seb-auto" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600" title="Acha pelo silêncio no fim do áudio">Auto</button>
        <button id="seb-remove" class="hidden px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600">Remover</button>
        <button id="seb-cancel" class="px-1.5 py-0.5 rounded text-slate-400 hover:text-white" title="Cancelar (Esc)">✕</button>`;
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    (host || document.body).appendChild(bar);
    const apply = () => {
        const ms = parseEditorTimeInput(bar.querySelector('#seb-time').value);
        if (ms == null) { flashEditorStatus('Tempo inválido — use m:ss.000 (ex.: 2:15.500) ou segundos (ex.: 135.5).'); return; }
        stopSongEndPlacement();
        setEditorSongEnd(ms, 'digitado');
        goToEditorTime(Math.max(0, (ms - 3000) / 1000));
    };
    bar.querySelector('#seb-ok').addEventListener('click', apply);
    bar.querySelector('#seb-time').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') stopSongEndPlacement(); e.stopPropagation(); });
    bar.querySelector('#seb-auto').addEventListener('click', () => { stopSongEndPlacement(); autoEditorSongEnd(); });
    bar.querySelector('#seb-remove').addEventListener('click', () => { stopSongEndPlacement(); setEditorSongEnd(null); });
    bar.querySelector('#seb-cancel').addEventListener('click', stopSongEndPlacement);
    return bar;
}
function parseEditorTimeInput(txt) {
    txt = String(txt || '').trim().replace(',', '.');
    if (!txt) return null;
    let m = txt.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (m) return (+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? +m[3].padEnd(3, '0') : 0);
    m = txt.match(/^\d+(?:\.\d+)?$/);
    if (m) return Math.round(parseFloat(txt) * 1000);
    return null;
}
function startSongEndPlacement() {
    if (!isEditorOpen()) return;
    songEndPlace.active = true;
    songEndPlace.hoverMs = null;
    const bar = ensureSongEndBar();
    bar.querySelector('#seb-time').value = editorState.songEndMs != null ? fmtEdTime(editorState.songEndMs) : '';
    bar.querySelector('#seb-remove').classList.toggle('hidden', editorState.songEndMs == null);
    bar.classList.remove('hidden');
    document.getElementById('editor-issue-bar')?.classList.add('hidden');
    const cv = document.getElementById('editorCanvas'); if (cv) cv.style.cursor = 'row-resize';
    renderEditorCanvas();
}
function stopSongEndPlacement() {
    songEndPlace.active = false;
    songEndPlace.hoverMs = null;
    document.getElementById('editor-songend-bar')?.classList.add('hidden');
    if (typeof updateEditorToolUI === 'function') updateEditorToolUI();
    renderEditorCanvas();
}
function songEndSnap(ms) {
    // encaixa no SNAP, mas o fim pode ficar em qualquer lugar com Shift (sem encaixe)
    return Math.max(0, Math.min(editorState.duration * 1000, ms));
}
function songEndTolMs() {
    const cv = document.getElementById('editorCanvas');
    const rect = cv ? cv.getBoundingClientRect() : null;
    const scale = rect && rect.height ? cv.height / rect.height : 1;
    return 8 * scale * 1000 / Math.max(10, editorState.zoom || 70);
}

(function wireSongEndPlacement() {
    const cv = document.getElementById('editorCanvas');
    if (!cv) return;
    // capture: chega antes das ferramentas de nota (não cria nota sem querer)
    cv.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const p = editorPointFromAnyView(e);
        if (p.timeMs == null) return;
        if (songEndPlace.active) {
            e.preventDefault(); e.stopImmediatePropagation();
            const ms = e.shiftKey ? p.timeMs : snapEditorTime(p.timeMs);
            stopSongEndPlacement();
            setEditorSongEnd(songEndSnap(ms), 'escolhido na grade');
            return;
        }
        // agarrou a linha do fim já marcada: arrasta
        if (editorState.songEndMs != null && !editorState.simulatorMode && !editorState.highwayMode && Math.abs(p.timeMs - editorState.songEndMs) <= songEndTolMs()) {
            e.preventDefault(); e.stopImmediatePropagation();
            songEndPlace.drag = true;
            cv.style.cursor = 'row-resize';
        }
    }, true);
    cv.addEventListener('mousemove', (e) => {
        const p = editorPointFromAnyView(e);
        if (songEndPlace.active) {
            songEndPlace.hoverMs = p.timeMs == null ? null : (e.shiftKey ? p.timeMs : snapEditorTime(p.timeMs));
            const h = document.getElementById('seb-hint');
            if (h) h.textContent = songEndPlace.hoverMs != null ? `Clique pra marcar em ${fmtEdTime(songEndPlace.hoverMs)} (Shift = sem encaixar no SNAP)` : 'Clique na grade (ou na timeline à direita)';
            renderEditorCanvas();
        } else if (!songEndPlace.drag && editorState.songEndMs != null && p.timeMs != null && !editorState.simulatorMode && !editorState.highwayMode) {
            const near = Math.abs(p.timeMs - editorState.songEndMs) <= songEndTolMs();
            if (near) { cv.style.cursor = 'row-resize'; cv.title = 'Arraste pra mover o Fim da música'; }
            else if (cv.title) { cv.title = ''; if (typeof updateEditorToolUI === 'function') updateEditorToolUI(); }
        }
    });
    cv.addEventListener('mouseleave', () => { if (songEndPlace.active) { songEndPlace.hoverMs = null; renderEditorCanvas(); } });
    window.addEventListener('mousemove', (e) => {
        if (!songEndPlace.drag) return;
        const p = editorPointFromAnyView(e, true);
        if (p.timeMs == null) return;
        editorState.songEndMs = Math.round(songEndSnap(e.shiftKey ? p.timeMs : snapEditorTime(p.timeMs)));
        renderEditorCanvas();
        if (typeof renderEditorTimeline === 'function') renderEditorTimeline();
    });
    window.addEventListener('mouseup', () => {
        if (!songEndPlace.drag) return;
        songEndPlace.drag = false;
        if (typeof updateEditorToolUI === 'function') updateEditorToolUI();
        setEditorSongEnd(editorState.songEndMs, 'arrastado');
    });
    // timeline lateral: no modo de escolher, o clique marca o fim (em vez de pular pra lá)
    const tl = document.getElementById('editor-timeline');
    if (tl) tl.addEventListener('mousedown', (e) => {
        if (!songEndPlace.active || typeof editorTimelineGeometry !== 'function') return;
        const g = editorTimelineGeometry();
        if (!g) return;
        const r = tl.getBoundingClientRect();
        const y = (e.clientY - r.top) * (g.H / r.height);
        // yOf é linear: acha o tempo pela proporção entre os dois extremos
        const y0 = g.yOf(0), y1 = g.yOf(g.totalMs);
        const ms = Math.max(0, Math.min(g.totalMs, (y - y0) / (y1 - y0) * g.totalMs));
        e.preventDefault(); e.stopImmediatePropagation();
        stopSongEndPlacement();
        setEditorSongEnd(snapEditorTime(ms), 'escolhido na timeline');
        goToEditorTime(Math.max(0, (editorState.songEndMs - 3000) / 1000));
    }, true);
    window.addEventListener('keydown', (e) => {
        if (songEndPlace.active && e.code === 'Escape' && isEditorOpen()) { e.preventDefault(); e.stopImmediatePropagation(); stopSongEndPlacement(); }
    }, true);
    // linha "fantasma" acompanhando o mouse
    const r0 = window.renderEditorCanvas;
    window.renderEditorCanvas = function (...a) {
        const r = r0.apply(this, a);
        try {
            if (songEndPlace.active && songEndPlace.hoverMs != null && !editorState.simulatorMode && !editorState.highwayMode) {
                const c = cv.getContext('2d');
                const y = editorTimeToAbsY(songEndPlace.hoverMs) - (editorState.canvasWindowTopPx || 0);
                c.save();
                c.setLineDash([8, 5]); c.strokeStyle = '#fda4af'; c.lineWidth = 2;
                c.beginPath(); c.moveTo(0, y); c.lineTo(cv.width, y); c.stroke();
                c.setLineDash([]); c.fillStyle = '#fda4af'; c.font = 'bold 12px monospace'; c.textAlign = 'right';
                c.fillText(`🏁 ${fmtEdTime(songEndPlace.hoverMs)}`, cv.width - 6, y - 6);
                c.restore();
            }
        } catch (err) {}
        return r;
    };
})();
