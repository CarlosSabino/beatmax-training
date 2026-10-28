// =====================================================================================
// editor-apagar.js — apagar rápido no Chart Editor, sem precisar selecionar com Shift.
//
//  • Botão DIREITO + arrastar começando numa NOTA  = borracha: apaga tudo por onde passar
//  • Botão DIREITO + arrastar começando no VAZIO   = retângulo vermelho: apaga tudo dentro
//  • Botão direito simples numa nota               = apaga só ela (como antes)
//  • Shift + Delete                                = apaga o COMPASSO inteiro sob o mouse
//  • Alt + botão direito arrastando               = apaga só na COLUNA onde começou
//  • Ctrl + Shift + Delete                         = apaga só a COLUNA sob o mouse nesse compasso
// Tudo entra no Desfazer (Ctrl+Z) como um passo só.
// =====================================================================================
const edDel = { mode: null, startX: 0, startY: 0, moved: false, hover: null, lockLane: null };

function edDelPoint(e) {
    try { return editorPointFromAnyView(e, true); } catch (err) { return { lane: null, timeMs: null }; }
}
function edDelIndices(pred) {
    const idx = [];
    editorState.notes.forEach((n, i) => { if (pred(n)) idx.push(i); });
    return idx;
}
function edDelApply(indices, msg) {
    if (!indices.length) { if (typeof flashEditorStatus === 'function') flashEditorStatus('Nada pra apagar aí.'); return 0; }
    indices.sort((a, b) => b - a).forEach(i => editorState.notes.splice(i, 1));
    editorState.selectedIndex = -1;
    editorState.selectedIndices = new Set();
    renderEditorCanvas();
    if (typeof editorHistCommitSoon === 'function') editorHistCommitSoon();
    if (msg && typeof flashEditorStatus === 'function') flashEditorStatus(msg.replace('{n}', indices.length));
    return indices.length;
}
// compasso que contém o tempo t (respeita as mudanças de BPM)
function edDelMeasureAt(t) {
    const segs = getEditorTempoSegments();
    const seg = tempoSegmentAt(segs, t);
    const len = seg.msPerBeat * 4;
    const k = Math.floor((t - seg.start) / len + 1e-6);
    const a = seg.start + k * len;
    return { a, b: Math.min(a + len, seg.end), num: seg.measureStart + k + 1 };
}

(function edDelWire() {
    const cv = document.getElementById('editorCanvas');
    if (!cv) return;
    cv.addEventListener('mousedown', (e) => {
        if (e.button !== 2) return;
        if (editorState.simulatorMode && typeof isGameViewEditable === 'function' && !isGameViewEditable()) return;
        const { lane, timeMs } = edDelPoint(e);
        if (lane == null || timeMs == null) return;
        edDel.startX = e.clientX; edDel.startY = e.clientY; edDel.moved = false;
        edDel.lockLane = e.altKey ? lane : null;
        const hit = findNoteAt(lane, timeMs);
        if (hit !== -1 && !e.altKey) {
            edDel.mode = 'swipe';
            deleteEditorNoteAt(hit);
            renderEditorCanvas();
        } else {
            edDel.mode = 'box';
            editorState.marqueeErase = true;
            editorState.marqueeLockLane = edDel.lockLane;
            editorState.marqueeStart = { lane, timeMs };
            editorState.marqueeCurrent = { lane, timeMs };
        }
        e.preventDefault();
    }, true);
    window.addEventListener('mousemove', (e) => {
        if (!edDel.mode) { if (isEditorOpen && isEditorOpen()) { const p = edDelPoint(e); if (p.timeMs != null) edDel.hover = p; } return; }
        if (Math.hypot(e.clientX - edDel.startX, e.clientY - edDel.startY) > 4) edDel.moved = true;
        const { lane, timeMs } = edDelPoint(e);
        if (lane == null || timeMs == null) return;
        if (edDel.mode === 'swipe') {
            const hit = findNoteAt(lane, timeMs);
            if (hit !== -1) { deleteEditorNoteAt(hit); renderEditorCanvas(); }
        }
        // no modo 'box' quem atualiza o retângulo é o próprio editor (marqueeCurrent)
    }, true);
    window.addEventListener('mouseup', (e) => {
        if (e.button !== 2 || !edDel.mode) return;
        const mode = edDel.mode;
        edDel.mode = null;
        if (mode === 'box') {
            const a = editorState.marqueeStart, b = editorState.marqueeCurrent;
            editorState.marqueeStart = null; editorState.marqueeCurrent = null; editorState.marqueeErase = false; editorState.marqueeLockLane = null;
            if (a && b && edDel.moved) {
                const lmin = Math.min(a.lane, b.lane), lmax = Math.max(a.lane, b.lane), tmin = Math.min(a.timeMs, b.timeMs), tmax = Math.max(a.timeMs, b.timeMs);
                edDelApply(edDelIndices(n => n.lane >= lmin && n.lane <= lmax && (n.holdEnd != null ? n.holdEnd : n.time) >= tmin && n.time <= tmax), '🗑 {n} nota(s) apagada(s) — Ctrl+Z desfaz');
            } else renderEditorCanvas();
        } else if (typeof editorHistCommitSoon === 'function') editorHistCommitSoon();
        // o menu do botão direito não deve apagar de novo depois de um arraste
        if (edDel.moved) { const stop = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); }; window.addEventListener('contextmenu', stop, { capture: true, once: true }); setTimeout(() => window.removeEventListener('contextmenu', stop, true), 300); }
    }, true);

    window.addEventListener('keydown', (e) => {
        if (!(typeof isEditorOpen === 'function' && isEditorOpen()) || editorState.isRecording) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if ((e.code !== 'Delete' && e.code !== 'Backspace') || !e.shiftKey) return;
        const h = edDel.hover;
        if (!h || h.timeMs == null) { flashEditorStatus && flashEditorStatus('Passe o mouse sobre o compasso que quer apagar.'); return; }
        e.preventDefault(); e.stopImmediatePropagation();
        const m = edDelMeasureAt(h.timeMs);
        const onlyLane = (e.ctrlKey || e.metaKey) ? h.lane : null;
        edDelApply(edDelIndices(n => n.time >= m.a - 0.5 && n.time < m.b - 0.5 && (onlyLane == null || n.lane === onlyLane)),
            onlyLane == null ? `🗑 Compasso ${m.num}: {n} nota(s) apagada(s) — Ctrl+Z desfaz` : `🗑 Compasso ${m.num}, só aquela coluna: {n} nota(s) — Ctrl+Z desfaz`);
    }, true);
})();
