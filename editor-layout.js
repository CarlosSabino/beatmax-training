// =====================================================================================
// editor-layout.js — Chart Editor repaginado (v1.8)
//
//  • Régua de LINHAS à esquerda da grade:
//      clique            = seleciona a linha inteira (todas as colunas naquele tempo)
//      arrastar          = seleciona várias linhas de uma vez
//      duplo clique      = seleciona o compasso inteiro
//      Shift             = soma à seleção que já existe
//      botão direito + arrastar = apaga as linhas (Ctrl+Z desfaz)
//  • Painel "Trecho": seleciona/apaga tudo entre duas seções/pins (ou início/fim/playhead)
//  • Dica da ferramenta grande no painel esquerdo + barra de status embaixo + posição do mouse
//  • Tela de atalhos (F1 ou ?)
// =====================================================================================
(function () {
    const $ = (id) => document.getElementById(id);
    const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s));

    // ---------------- dicas das ferramentas ----------------
    const TOOL_HELP = {
        select: { t: 'Seleção', d: 'Clique numa nota pra selecionar. <b>Arraste uma nota</b> pra mover (tempo e coluna). <b>Arraste no vazio</b> pra selecionar várias.', k: '<kbd>Shift</kbd>+clique soma · <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> move · <kbd>Ctrl</kbd>+<kbd>←</kbd>/<kbd>→</kbd> troca coluna' },
        tap: { t: 'Tap', d: 'Clique cria só <b>nota simples</b> — nunca vira hold, mesmo arrastando.', k: '<kbd>Clique direito</kbd> apaga · <kbd>Q</kbd>/<kbd>E</kbd> muda o SNAP' },
        note: { t: 'Nota/Hold', d: 'Clique cria nota. <b>Arraste pra cima</b> (pra frente no tempo) pra virar hold.', k: '<kbd>Clique direito</kbd> apaga · <kbd>Q</kbd>/<kbd>E</kbd> muda o SNAP' },
        eraser: { t: 'Borracha', d: 'Clique ou <b>arraste por cima</b> das notas pra apagar.', k: 'Em qualquer ferramenta: <kbd>botão direito</kbd> arrastando também apaga' },
        stair: { t: 'Escada', d: 'Arraste de uma coluna até outra (<b>pra cima = pra frente</b>) e a escadinha nasce no passo escolhido. Começar e terminar na mesma coluna = atravessa todas.', k: 'Passo e formato logo abaixo' }
    };
    function renderToolHint() {
        const box = $('editor-tool-hint');
        const tool = (typeof editorState !== 'undefined' && editorState.tool) || 'note';
        const h = TOOL_HELP[tool] || TOOL_HELP.note;
        if (box) box.innerHTML = `<b>${h.t}</b> — ${h.d}<span class="ed-hint-keys">${h.k}</span>`;
        const so = $('editor-stair-opts');
        if (so) so.style.display = tool === 'stair' ? '' : 'none';
        setIdleStatus();
    }
    if (typeof window.updateEditorToolUI === 'function') {
        const orig = window.updateEditorToolUI;
        window.updateEditorToolUI = function () { const r = orig.apply(this, arguments); renderToolHint(); return r; };
    }

    // ---------------- barra de status ----------------
    let flashTimer = null;
    function setIdleStatus() {
        if (flashTimer) return;
        const el = $('editor-status-msg');
        if (!el) return;
        const tool = (typeof editorState !== 'undefined' && editorState.tool) || 'note';
        el.classList.remove('ed-flash');
        el.textContent = `🛠️ ${(TOOL_HELP[tool] || TOOL_HELP.note).t} · Régua à esquerda da grade: clique seleciona a linha, arraste seleciona várias, duplo clique = compasso`;
    }
    window.flashEditorStatus = function (msg) {
        const el = $('editor-status-msg');
        if (!el) { if (typeof setEditorAudioStatus === 'function') setEditorAudioStatus(msg); return; }
        el.textContent = msg;
        el.classList.add('ed-flash');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashTimer = null; setIdleStatus(); }, 4000);
    };
    const keysEl = $('editor-status-keys');
    if (keysEl) keysEl.innerHTML = '<kbd>Espaço</kbd> play · <kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz · <kbd>1</kbd>–<kbd>5</kbd> ferramentas · <kbd>F1</kbd> todos os atalhos';

    // ---------------- posição do mouse ----------------
    function updateReadout(e) {
        const out = $('editor-pos-readout');
        if (!out || typeof editorPointFromAnyView !== 'function') return;
        let p;
        try { p = editorPointFromAnyView(e); } catch (err) { return; }
        if (!p || p.timeMs == null || p.lane == null) return;
        const t = snapEditorTime(p.timeMs);
        const s = (t / 1000);
        const mm = Math.floor(s / 60), ss = (s % 60).toFixed(3).padStart(6, '0');
        out.textContent = `${describeEditorBeatPosition(t)} · ${getTrackLabel(editorState.mode, p.lane)} · ${mm}:${ss}`;
    }
    $('editorCanvas')?.addEventListener('mousemove', updateReadout);

    // ---------------- régua de linhas ----------------
    const ruler = $('editor-ruler');
    const R = { drag: null, anchor: null, hoverT: null };
    const RW = typeof EDITOR_RULER_W !== 'undefined' ? EDITOR_RULER_W : 64;

    function gridMode() { return typeof editorState !== 'undefined' && !editorState.simulatorMode; }
    function placeRuler() {
        const cv = $('editorCanvas');
        if (!ruler || !cv) return;
        if (!gridMode()) { ruler.style.display = 'none'; return; }
        ruler.style.display = '';
        const w = cv.width;
        if (ruler.width !== RW) ruler.width = RW;
        if (ruler.height !== cv.height) ruler.height = cv.height;
        ruler.style.width = RW + 'px';
        ruler.style.height = cv.height + 'px';
        ruler.style.left = '50%';
        ruler.style.marginLeft = (-w / 2 - RW - 6) + 'px';
        ruler.style.top = (editorState.canvasWindowTopPx || 0) + 'px';
    }
    function rulerTimeAt(clientY, clamp) {
        const rc = ruler.getBoundingClientRect();
        let y = (clientY - rc.top) * (ruler.height / Math.max(1, rc.height));
        if (clamp) y = Math.max(0, Math.min(ruler.height, y));
        const t = editorAbsYToTime(y + (editorState.canvasWindowTopPx || 0));
        return Math.max(0, Math.min(editorState.duration * 1000, snapEditorTime(t)));
    }
    function drawRuler() {
        if (!ruler || !gridMode()) return;
        placeRuler();
        const g = ruler.getContext('2d');
        const H = ruler.height, top = editorState.canvasWindowTopPx || 0;
        g.clearRect(0, 0, RW, H);
        g.fillStyle = '#0b1222';
        g.fillRect(0, 0, RW, H);
        const total = editorState.duration * 1000;
        const tStart = Math.max(0, editorAbsYToTime(top + H));
        const tEnd = Math.min(total, editorAbsYToTime(top));
        const yOf = (t) => editorTimeToAbsY(t) - top;
        // linhas que têm nota selecionada
        const selT = new Set();
        try { getSelectedEditorNoteIndices().forEach(i => { const n = editorState.notes[i]; if (n) selT.add(Math.round(n.time)); }); } catch (e) {}
        const step = editorSnapMsAt(tStart);
        selT.forEach(t => {
            if (t < tStart - step || t > tEnd + step) return;
            g.fillStyle = 'rgba(255,255,255,0.16)';
            g.fillRect(0, yOf(t) - 4, RW, 8);
        });
        // faixa sendo arrastada
        if (R.drag) {
            const a = Math.min(R.drag.t0, R.drag.t1), b = Math.max(R.drag.t0, R.drag.t1);
            const y1 = yOf(b) - 5, y2 = yOf(a) + 5;
            g.fillStyle = R.drag.erase ? 'rgba(239,68,68,0.35)' : 'rgba(34,211,238,0.3)';
            g.fillRect(0, y1, RW, y2 - y1);
            g.strokeStyle = R.drag.erase ? '#f87171' : '#22d3ee';
            g.lineWidth = 1.5;
            g.strokeRect(1, y1, RW - 2, y2 - y1);
        } else if (R.hoverT != null) {
            g.fillStyle = 'rgba(34,211,238,0.18)';
            g.fillRect(0, yOf(R.hoverT) - 4, RW, 8);
        }
        g.textAlign = 'right';
        forEachEditorGridLine(tStart, tEnd, (t, isBeat, isMeasure, num) => {
            const y = yOf(t) + 0.5;
            const len = isMeasure ? RW : (isBeat ? 22 : 10);
            g.strokeStyle = isMeasure ? 'rgba(34,211,238,0.85)' : (isBeat ? 'rgba(148,163,184,0.6)' : 'rgba(100,116,139,0.35)');
            g.lineWidth = isMeasure ? 1.5 : 1;
            g.beginPath(); g.moveTo(RW - len, y); g.lineTo(RW, y); g.stroke();
            if (isMeasure) {
                g.fillStyle = '#a5f3fc';
                g.font = 'bold 14px "JetBrains Mono", monospace';
                g.fillText(String(num), RW - 6, y - 4);
            }
        });
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.beginPath(); g.moveTo(RW - 0.5, 0); g.lineTo(RW - 0.5, H); g.stroke();
    }

    function indicesInRange(a, b, lane) {
        const lo = Math.min(a, b) - 1, hi = Math.max(a, b) + 1;
        const out = [];
        editorState.notes.forEach((n, i) => { if (n.time >= lo && n.time <= hi && (lane == null || n.lane === lane)) out.push(i); });
        return out;
    }
    function selectIndices(idx, add, label) {
        if (!add) { editorState.selectedIndices = new Set(); editorState.selectedIndex = -1; }
        idx.forEach(i => editorState.selectedIndices.add(i));
        renderEditorCanvas();
        if (typeof renderEditorPropertiesPanel === 'function') renderEditorPropertiesPanel(true);
        const n = getSelectedEditorNoteIndices().size;
        flashEditorStatus(idx.length ? `✔ ${label}: ${idx.length} nota(s) — total selecionado: ${n}. Delete apaga · Ctrl+C copia · arraste com a Seleção (1) pra mover` : `${label}: nenhuma nota aí.`);
    }
    function deleteIndices(idx, label) {
        if (typeof edDelApply === 'function') return edDelApply(idx, `🗑 ${label}: {n} nota(s) apagada(s) — Ctrl+Z desfaz`);
        idx.sort((a, b) => b - a).forEach(i => editorState.notes.splice(i, 1));
        editorState.selectedIndex = -1; editorState.selectedIndices = new Set();
        renderEditorCanvas();
        if (typeof editorHistCommitSoon === 'function') editorHistCommitSoon();
    }

    if (ruler) {
        ruler.addEventListener('contextmenu', (e) => e.preventDefault());
        ruler.addEventListener('mousedown', (e) => {
            if (!gridMode() || (e.button !== 0 && e.button !== 2)) return;
            e.preventDefault(); e.stopPropagation();
            const t = rulerTimeAt(e.clientY);
            const t0 = (e.button === 0 && e.shiftKey && R.anchor != null) ? R.anchor : t;
            R.drag = { t0, t1: t, erase: e.button === 2, add: e.shiftKey || e.ctrlKey };
            if (e.button === 0 && !e.shiftKey) R.anchor = t;
            drawRuler();
        });
        ruler.addEventListener('mousemove', (e) => {
            if (R.drag || !gridMode()) return;
            R.hoverT = rulerTimeAt(e.clientY);
            drawRuler();
            const out = $('editor-pos-readout');
            if (out) out.textContent = `${describeEditorBeatPosition(R.hoverT)} · linha inteira`;
        });
        ruler.addEventListener('mouseleave', () => { R.hoverT = null; if (!R.drag) drawRuler(); });
        window.addEventListener('mousemove', (e) => {
            if (!R.drag) return;
            R.drag.t1 = rulerTimeAt(e.clientY, true);
            // rolar sozinho quando passa da borda da área visível
            const wrap = $('editor-canvas-wrap');
            if (wrap) {
                const wr = wrap.getBoundingClientRect();
                if (e.clientY < wr.top + 20) wrap.scrollTop -= 18;
                else if (e.clientY > wr.bottom - 20) wrap.scrollTop += 18;
            }
            drawRuler();
        });
        window.addEventListener('mouseup', (e) => {
            if (!R.drag) return;
            const d = R.drag; R.drag = null;
            const a = Math.min(d.t0, d.t1), b = Math.max(d.t0, d.t1);
            const label = a === b ? `Linha ${describeEditorBeatPosition(a)}` : `Linhas de ${describeEditorBeatPosition(a)} até ${describeEditorBeatPosition(b)}`;
            if (d.erase) deleteIndices(indicesInRange(a, b), label);
            else selectIndices(indicesInRange(a, b), d.add, label);
            drawRuler();
        });
        ruler.addEventListener('dblclick', (e) => {
            if (!gridMode()) return;
            const t = rulerTimeAt(e.clientY);
            const m = typeof edDelMeasureAt === 'function' ? edDelMeasureAt(t) : null;
            if (!m) return;
            const idx = [];
            editorState.notes.forEach((n, i) => { if (n.time >= m.a - 0.5 && n.time < m.b - 0.5) idx.push(i); });
            selectIndices(idx, e.shiftKey, `Compasso ${m.num}`);
        });
    }

    // acompanha o canvas (rolagem, troca de visual, zoom...)
    if (typeof window.renderEditorCanvas === 'function') {
        const origRender = window.renderEditorCanvas;
        window.renderEditorCanvas = function () { const r = origRender.apply(this, arguments); try { drawRuler(); } catch (e) {} return r; };
    }
    if (typeof window.positionEditorCanvasWindow === 'function') {
        const origPos = window.positionEditorCanvasWindow;
        window.positionEditorCanvasWindow = function () { const r = origPos.apply(this, arguments); placeRuler(); return r; };
    }
    if (typeof window.resizeEditorCanvas === 'function') {
        const origResize = window.resizeEditorCanvas;
        window.resizeEditorCanvas = function () { const r = origResize.apply(this, arguments); placeRuler(); try { drawRuler(); } catch (e) {} return r; };
    }
    // a área da grade muda de tamanho (janela, barras de pins/seções aparecendo...): refaz o layout
    const wrapEl = $('editor-canvas-wrap');
    if (wrapEl && typeof ResizeObserver !== 'undefined') {
        let lastW = 0, raf = 0;
        new ResizeObserver(() => {
            if (!isEditorOpen()) return;
            const w = wrapEl.clientWidth;
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                if (Math.abs(w - lastW) > 2 || editorState.simulatorMode) { lastW = w; resizeEditorCanvas(); renderEditorCanvas(); }
                else if (typeof alignEditorTrackLabels === 'function') alignEditorTrackLabels();
            });
        }).observe(wrapEl);
    }

    // ---------------- painel "Trecho" ----------------
    const rangeBox = $('editor-range-box');
    let rangeSig = '';
    function rangePoints() {
        const pts = [{ v: 'start', t: 0, l: 'Início (0:00)' }];
        (editorState.sections || []).forEach(s => pts.push({ v: 's' + s.time, t: s.time, l: `🚩 ${s.name} (${formatEditorTime(s.time)})` }));
        (editorState.pins || []).forEach(p => pts.push({ v: 'p' + p, t: p, l: `📍 Pin ${formatEditorTime(p)}` }));
        pts.sort((a, b) => a.t - b.t);
        pts.push({ v: 'end', t: editorState.duration * 1000 + 1, l: `Fim (${formatEditorTime(editorState.duration * 1000)})` });
        return pts;
    }
    function renderRangeBox(force) {
        if (!rangeBox || typeof editorState === 'undefined') return;
        const pts = rangePoints();
        const lanes = (KEY_CONFIGS[editorState.mode] || []).length;
        const sig = JSON.stringify([pts.map(p => p.v + p.l), lanes, editorState.mode]);
        if (!force && sig === rangeSig) return;
        if (!force && rangeBox.contains(document.activeElement)) return;
        rangeSig = sig;
        const prevA = $('ed-rg-a')?.value, prevB = $('ed-rg-b')?.value, prevL = $('ed-rg-lane')?.value;
        const opts = (sel) => pts.map(p => `<option value="${p.v}" ${p.v === sel ? 'selected' : ''}>${esc(p.l)}</option>`).join('');
        const laneOpts = `<option value="">Todas as colunas</option>` + Array.from({ length: lanes }, (_, i) => `<option value="${i}" ${String(i) === prevL ? 'selected' : ''}>${esc(getTrackLabel(editorState.mode, i))}</option>`).join('');
        const defB = pts.length > 2 ? pts[1].v : 'end';
        rangeBox.innerHTML = `
            <label class="ed-field">De <select id="ed-rg-a" class="ed-input">${opts(pts.some(p => p.v === prevA) ? prevA : 'start')}</select></label>
            <label class="ed-field">Até <select id="ed-rg-b" class="ed-input">${opts(pts.some(p => p.v === prevB) ? prevB : defB)}</select></label>
            <label class="ed-field">Só <select id="ed-rg-lane" class="ed-input">${laneOpts}</select></label>
            <div class="ed-grid2">
                <button type="button" id="ed-rg-sel" class="ed-btn"><i class="fa-solid fa-object-group"></i> Selecionar</button>
                <button type="button" id="ed-rg-del" class="ed-btn ed-danger"><i class="fa-solid fa-eraser"></i> Limpar trecho</button>
            </div>
            <div class="ed-note">Use as Seções (N) e Pins (P) como pontos de corte. O fim do trecho não entra (a nota que está bem em cima da seção seguinte fica).</div>`;
        const get = () => {
            const P = rangePoints();
            const a = P.find(p => p.v === $('ed-rg-a').value), b = P.find(p => p.v === $('ed-rg-b').value);
            if (!a || !b) return null;
            const lo = Math.min(a.t, b.t), hi = Math.max(a.t, b.t);
            const lv = $('ed-rg-lane').value, lane = lv === '' ? null : parseInt(lv, 10);
            const idx = [];
            editorState.notes.forEach((n, i) => { if (n.time >= lo - 0.5 && n.time < hi - 0.5 && (lane == null || n.lane === lane)) idx.push(i); });
            const what = `${a.t <= b.t ? a.l : b.l} → ${a.t <= b.t ? b.l : a.l}`.replace(/\s*\([^)]*\)/g, '') + (lane == null ? '' : ` (${getTrackLabel(editorState.mode, lane)})`);
            return { idx, what };
        };
        $('ed-rg-sel').onclick = () => { const r = get(); if (r) selectIndices(r.idx, false, `Trecho ${r.what}`); };
        $('ed-rg-del').onclick = () => {
            const r = get(); if (!r) return;
            if (!r.idx.length) { flashEditorStatus('Esse trecho já está vazio.'); return; }
            deleteIndices(r.idx, `Trecho ${r.what}`);
        };
    }
    // o painel de propriedades já é redesenhado a cada mudança — aproveita o mesmo ritmo
    if (typeof window.renderEditorPropertiesPanel === 'function') {
        const origProps = window.renderEditorPropertiesPanel;
        window.renderEditorPropertiesPanel = function () { const r = origProps.apply(this, arguments); try { renderRangeBox(false); } catch (e) {} return r; };
    }

    // ---------------- tela de atalhos (F1 / ?) ----------------
    const KEYS = [
        ['Tocar e navegar', [
            ['Espaço', 'Play / Pause'], ['← / →', 'voltar / avançar 5s (Shift = 1s)'], ['↑ / ↓', 'andar 1 passo da grade'],
            ['[ / ]', 'velocidade da música −/+'], ['R', 'ponto de retorno'], ['Roda do mouse', 'rolar a grade']]],
        ['Ferramentas', [
            ['1', 'Seleção'], ['2', 'Tap (só nota simples)'], ['3', 'Nota/Hold'], ['4', 'Borracha'], ['5', 'Escada'], ['Q / E', 'SNAP mais grosso / mais fino']]],
        ['Selecionar', [
            ['Clique na régua', 'seleciona a LINHA inteira'], ['Arrastar na régua', 'várias linhas'], ['Duplo clique na régua', 'compasso inteiro'],
            ['Shift + régua', 'soma à seleção'], ['Shift + clique/arraste', 'notas / caixa na grade'], ['Ctrl + A', 'tudo'], ['Painel Trecho', 'entre seções/pins']]],
        ['Editar', [
            ['Ctrl + C / Ctrl + V', 'copiar / colar no ponto do mouse'], ['Alt + ↑ / ↓', 'mover seleção no tempo'], ['Ctrl + ← / →', 'trocar coluna'],
            ['Alt + arrastar', 'mover'], ['Ctrl + Z / Ctrl + Y', 'desfazer / refazer']]],
        ['Apagar', [
            ['Delete', 'apaga a seleção'], ['Clique direito', 'apaga a nota'], ['Direito + arrastar numa nota', 'borracha'],
            ['Direito + arrastar no vazio', 'apaga tudo na caixa'], ['Alt + direito + arrastar', 'apaga só naquela coluna'],
            ['Direito + arrastar na régua', 'apaga linhas inteiras'], ['Shift + Delete', 'compasso sob o mouse'], ['Ctrl + Shift + Delete', 'só a coluna, naquele compasso']]],
        ['Marcadores', [
            ['N', 'seção (Intro, Refrão...)'], ['P', 'pin'], ['B', 'mudança de BPM'], ['End', 'fim da música']]]
    ];
    function openKeys() {
        if ($('ed-keys-ov')) return;
        const ov = document.createElement('div');
        ov.id = 'ed-keys-ov';
        ov.innerHTML = `<div class="box"><h2>⌨ ATALHOS DO CHART EDITOR</h2><div class="cols">${KEYS.map(([h, rows]) =>
            `<div><h3>${h}</h3>${rows.map(([k, d]) => `<div class="k"><b>${k.split(' / ').map(x => x.split(' + ').map(y => `<kbd>${esc(y)}</kbd>`).join('+')).join(' / ')}</b><span>${esc(d)}</span></div>`).join('')}</div>`).join('')}</div>
            <div style="margin-top:16px;text-align:center;color:#64748b;font-size:14px">Esc, F1 ou clique fora pra fechar</div></div>`;
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.remove(); });
        document.body.appendChild(ov);
    }
    $('btn-editor-shortcuts')?.addEventListener('click', openKeys);
    window.addEventListener('keydown', (e) => {
        const ov = $('ed-keys-ov');
        if (ov) {
            if (e.key === 'Escape' || e.key === 'F1' || e.key === '?') ov.remove();
            e.preventDefault(); e.stopImmediatePropagation();
            return;
        }
        if (!isEditorOpen() || editorState.isRecording) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'F1' || e.key === '?') { e.preventDefault(); e.stopImmediatePropagation(); openKeys(); }
    }, true);

    renderToolHint();
})();
