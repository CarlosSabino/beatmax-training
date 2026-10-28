// =====================================================================================
// editor-validate.js — "Verificar Chart" que mostra ONDE está cada problema.
// Antes a verificação só dizia "3 pares de notas coladas" sem dizer quais. Agora:
//  • cada problema lista os pontos exatos (tempo + lane); clicar leva até lá e seleciona as notas;
//  • uma barra de navegação (◀ ▶ / F3) percorre os problemas sem reabrir a janela;
//  • as notas com problema ficam contornadas em vermelho/âmbar na grade e marcadas na timeline;
//  • correções automáticas quando é seguro (duplicadas, hold invadindo a próxima, fora da
//    grade, hold curtinha, fora da duração) — tudo com Desfazer (Ctrl+Z);
//  • a lista se atualiza sozinha enquanto você corrige.
// =====================================================================================

let edIssues = [];          // [{ id, level, title, hint, items: [{ t, lane, notes: [] }], fixes: [{label, run}] }]
let edIssueFlat = [];       // itens de todos os problemas, em ordem de tempo
let edIssueCursor = -1;
let edIssueBarOn = false;

function fmtEdT(ms) {
    const neg = ms < 0; ms = Math.abs(ms);
    const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = Math.round(ms % 1000);
    return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
function edLaneName(lane) {
    const mode = editorState.mode;
    const kinds = getLaneKinds(mode);
    const k = kinds[lane];
    if (k === 'side' || k === 'trackLR') {
        const pair = getLaneIndicesOfKind(mode, k);
        return `${k === 'side' ? 'SIDE' : 'TRACK'} ${pair && pair[0] === lane ? 'L' : 'R'}`;
    }
    const mains = getVisualOrder(mode).filter(l => kinds[l] === 'main');
    return `Track ${mains.indexOf(lane) + 1}`;
}
function edNoteEnd(n) { return n.holdEnd != null ? n.holdEnd : n.time; }

function edStepMs(t, div) {
    const seg = tempoSegmentAt(getEditorTempoSegments(), t);
    return { seg, step: seg.msPerBeat / div };
}
// distância (ms) até a grade mais próxima entre 1/32 e 1/24 (cobre 1/4…1/32 e as tercinas)
function edOffGridMs(t) {
    let best = Infinity;
    for (const div of [8, 6]) {
        const { seg, step } = edStepMs(t, div);
        const k = Math.round((t - seg.start) / step);
        best = Math.min(best, Math.abs(t - (seg.start + k * step)));
    }
    return best;
}

function buildEditorIssues() {
    const issues = [];
    const notes = editorState.notes;
    const totalMs = editorState.duration * 1000;
    const beatAt = (t) => tempoSegmentAt(getEditorTempoSegments(), t).msPerBeat;

    if (!notes.length) issues.push({ id: 'empty', level: 'error', title: 'Nenhuma nota criada ainda neste chart.', items: [] });
    if (!editorState.audioBuffer) issues.push({ id: 'noaudio', level: 'warn', title: 'Nenhum áudio importado — esse chart não vai tocar música na hora de jogar.', items: [] });
    if (editorState.bpm < 40 || editorState.bpm > 400) issues.push({ id: 'bpm', level: 'warn', title: `BPM incomum (${editorState.bpm}) — confira se não foi engano de digitação.`, items: [] });
    (editorState.bpmChanges || []).forEach(c => {
        if (c.time > totalMs) issues.push({ id: 'bpmc-late', level: 'warn', title: `Mudança de BPM em ${fmtEdT(c.time)} está depois do fim da música — não tem efeito.`, items: [{ t: c.time, lane: null, notes: [] }] });
        if (c.bpm < 40 || c.bpm > 400) issues.push({ id: 'bpmc-odd', level: 'warn', title: `Mudança de BPM incomum (${formatBpmValue(c.bpm)}) em ${fmtEdT(c.time)}.`, items: [{ t: c.time, lane: null, notes: [] }] });
    });
    if (editorState.audioBuffer) {
        const audioMs = editorState.audioBuffer.duration * 1000;
        if (Math.abs(audioMs - totalMs) > 5000) issues.push({
            id: 'dur', level: 'warn', title: `Duração do chart (${formatEditorTime(totalMs)}) bem diferente da do áudio (${formatEditorTime(audioMs)}).`, items: [],
            fixes: [{ label: 'Usar a duração do áudio', run: () => { editorState.duration = Math.ceil(audioMs / 1000); setEditorFormValue('editor-duration', editorState.duration); resizeEditorCanvas(); } }]
        });
    }

    // fim da música
    if (editorState.songEndMs != null) {
        const lastEnd = notes.reduce((m, n) => Math.max(m, edNoteEnd(n)), 0);
        const after = notes.filter(n => n.time > editorState.songEndMs + 1);
        if (after.length) issues.push({
            id: 'songend-early', level: 'error', title: `${after.length} nota(s) depois do Fim da música (${fmtEdT(editorState.songEndMs)})`, hint: 'No jogo elas ficam de fora (a partida termina no fim marcado). Se forem de verdade, mova o fim pra depois delas.',
            items: after.map(n => ({ t: n.time, lane: n.lane, notes: [n] })),
            fixes: [
                { label: 'Apagar essas notas', run: () => { const k = new Set(after); editorState.notes = editorState.notes.filter(n => !k.has(n)); } },
                { label: 'Mover o fim pra depois delas', run: () => { editorState.songEndMs = Math.round(lastEnd + 1000); } }
            ]
        });
        if (editorState.songEndMs > totalMs) issues.push({ id: 'songend-late', level: 'warn', title: 'Fim da música marcado depois da duração do chart.', items: [{ t: editorState.songEndMs, lane: null, notes: [] }],
            fixes: [{ label: 'Remover a marcação', run: () => { editorState.songEndMs = null; } }] });
    } else if (editorState.audioBuffer && typeof detectSongEndFromAudio === 'function') {
        const d = detectSongEndFromAudio(editorState.audioBuffer);
        if (d && d.silenceMs >= 3000) {
            const lastEnd = notes.reduce((m, n) => Math.max(m, edNoteEnd(n)), 0);
            const at = Math.max(d.endMs, lastEnd + 500);
            issues.push({
                id: 'songend-silence', level: 'warn', title: `O áudio tem ~${Math.round(d.silenceMs / 1000)}s de silêncio no fim`, hint: 'Sem o "Fim da música" marcado, a partida fica esse tempo todo esperando o arquivo acabar.',
                items: [{ t: at, lane: null, notes: [] }],
                fixes: [{ label: `Marcar o fim da música em ${fmtEdT(at)}`, run: () => { editorState.songEndMs = Math.round(at); } }]
            });
        }
    }

    // notas soltas: 1-3 notas isoladas por um vazio grande antes e depois (no fim, só antes) —
    // costuma ser nota criada/arrastada sem querer
    {
        const sorted = notes.slice().sort((a, b) => a.time - b.time);
        const GAP = 8000, stray = [];
        let i = 0;
        while (i < sorted.length) {
            let j = i;
            while (j + 1 < sorted.length && sorted[j + 1].time - edNoteEnd(sorted[j]) < GAP) j++;
            const grp = sorted.slice(i, j + 1);
            const before = i > 0 ? grp[0].time - edNoteEnd(sorted[i - 1]) : Infinity;
            if (grp.length <= 3 && sorted.length > 12 && before >= GAP) stray.push(...grp);
            i = j + 1;
        }
        if (stray.length) issues.push({
            id: 'stray', level: 'warn', title: `${stray.length} nota(s) solta(s), longe de todas as outras`, hint: 'Mais de 8s de vazio antes delas — quase sempre uma nota criada ou arrastada sem querer (é ela que deixa um "buraco" esperando no fim da partida).',
            items: stray.map(n => ({ t: n.time, lane: n.lane, notes: [n] })),
            fixes: [{ label: 'Apagar as notas soltas', run: () => { const k = new Set(stray); editorState.notes = editorState.notes.filter(n => !k.has(n)); } }]
        });
    }

    // fora da duração
    const outs = notes.filter(n => n.time < 0 || n.time > totalMs || edNoteEnd(n) > totalMs);
    if (outs.length) issues.push({
        id: 'range', level: 'error', title: `${outs.length} nota(s) fora da duração da música`, hint: 'Depois do fim (ou antes do começo) — não aparecem no jogo do jeito esperado.',
        items: outs.map(n => ({ t: n.time, lane: n.lane, notes: [n] })),
        fixes: [
            { label: 'Esticar a duração', run: () => { const end = Math.max(...outs.map(edNoteEnd)); editorState.duration = Math.ceil(end / 1000) + 2; setEditorFormValue('editor-duration', editorState.duration); resizeEditorCanvas(); } },
            { label: 'Apagar essas notas', run: () => { const s = new Set(outs); editorState.notes = notes.filter(n => !s.has(n)); } }
        ]
    });

    // por lane: duplicadas, hold invadindo a próxima, coladas demais
    const byLane = {};
    notes.forEach(n => { (byLane[n.lane] = byLane[n.lane] || []).push(n); });
    const dups = [], overlaps = [], close = [];
    Object.values(byLane).forEach(list => {
        list.sort((a, b) => a.time - b.time);
        for (let i = 1; i < list.length; i++) {
            const a = list[i - 1], b = list[i];
            const minGap = Math.max(20, beatAt(b.time) / 8);
            if (Math.abs(b.time - a.time) < 2) dups.push({ t: b.time, lane: b.lane, notes: [a, b] });
            else if (a.holdEnd != null && b.time < a.holdEnd + 1) overlaps.push({ t: b.time, lane: b.lane, notes: [a, b] });
            else if (b.time < edNoteEnd(a) + minGap - 1) close.push({ t: b.time, lane: b.lane, notes: [a, b], gap: b.time - edNoteEnd(a) });
        }
    });
    if (dups.length) issues.push({
        id: 'dup', level: 'error', title: `${dups.length} nota(s) duplicada(s) no mesmo lugar`, hint: 'Duas notas na mesma lane e no mesmo instante — no jogo vira uma só, a outra dá BREAK.',
        items: dups,
        fixes: [{ label: 'Remover as duplicadas', run: () => {
            const kill = new Set();
            dups.forEach(d => { const [a, b] = d.notes; const keepA = (edNoteEnd(a) - a.time) >= (edNoteEnd(b) - b.time); kill.add(keepA ? b : a); });
            editorState.notes = editorState.notes.filter(n => !kill.has(n));
        } }]
    });
    if (overlaps.length) issues.push({
        id: 'overlap', level: 'error', title: `${overlaps.length} nota(s) longa(s) invadindo a próxima nota da lane`, hint: 'Enquanto você segura a hold, a nota de cima não tem como ser apertada.',
        items: overlaps,
        fixes: [{ label: 'Cortar as holds antes da próxima', run: () => {
            overlaps.forEach(o => {
                const [a, b] = o.notes;
                const end = Math.floor(b.time - Math.max(40, beatAt(b.time) / 4)); // solta 1/16 de batida antes
                const minHold = Math.max(60, beatAt(a.time) / 4);
                a.holdEnd = end - a.time >= minHold ? end : null;
            });
        } }]
    });
    if (close.length) issues.push({
        id: 'close', level: 'warn', title: `${close.length} par(es) de notas coladas demais na mesma lane`, hint: 'Menos de 1/32 de batida entre uma e outra — quase impossível de tocar; costuma ser clique duplo sem querer.',
        items: close,
        fixes: [{ label: 'Apagar a 2ª de cada par', run: () => { const kill = new Set(close.map(c => c.notes[1])); editorState.notes = editorState.notes.filter(n => !kill.has(n)); } }]
    });

    // hold curtinha demais (parece um toque normal)
    const shortHolds = notes.filter(n => n.holdEnd != null && n.holdEnd - n.time < Math.max(60, beatAt(n.time) / 4));
    if (shortHolds.length) issues.push({
        id: 'short', level: 'warn', title: `${shortHolds.length} nota(s) longa(s) curtinha(s) demais`, hint: 'Menos de 1/16 de batida — no jogo parece um toque normal e confunde.',
        items: shortHolds.map(n => ({ t: n.time, lane: n.lane, notes: [n] })),
        fixes: [{ label: 'Transformar em toque', run: () => shortHolds.forEach(n => { n.holdEnd = null; }) }]
    });

    // fora da grade de BPM (gravadas no teclado, arrastadas com SNAP diferente...)
    const offGrid = notes.filter(n => edOffGridMs(n.time) > 3);
    if (offGrid.length) issues.push({
        id: 'grid', level: 'warn', title: `${offGrid.length} nota(s) fora da grade do BPM`, hint: 'Não caem em nenhuma divisão (até 1/32 ou tercinas) — se o BPM está certo, provavelmente foi um clique fora do lugar.',
        items: offGrid.map(n => ({ t: n.time, lane: n.lane, notes: [n], off: edOffGridMs(n.time) })),
        fixes: [{ label: `Encaixar no SNAP atual (${typeof editorSnapLabel === 'function' ? editorSnapLabel(editorState.snap) : editorState.snap})`, run: () => offGrid.forEach(n => {
            const nt = snapEditorTime(n.time);
            if (n.holdEnd != null) n.holdEnd = Math.max(nt + 1, snapEditorTime(n.holdEnd));
            n.time = nt;
        }) }]
    });

    issues.forEach(is => is.items.sort((a, b) => a.t - b.t));
    return issues;
}

// compatibilidade: quem chamar validateEditorChart() continua recebendo a lista simples
function validateEditorChart() {
    const iss = buildEditorIssues();
    if (!iss.length) return [{ level: 'ok', text: 'Nenhum problema encontrado — o chart parece consistente!' }];
    return iss.map(i => ({ level: i.level, text: i.title }));
}

function refreshEditorIssues(keepCursor) {
    const cur = edIssueFlat[edIssueCursor];
    edIssues = buildEditorIssues();
    edIssueFlat = [];
    edIssues.forEach(is => is.items.forEach(it => edIssueFlat.push({ ...it, issue: is })));
    edIssueFlat.sort((a, b) => a.t - b.t);
    if (keepCursor && cur) {
        let i = edIssueFlat.findIndex(x => x.t >= cur.t - 1);
        edIssueCursor = i < 0 ? edIssueFlat.length - 1 : i;
    } else edIssueCursor = edIssueFlat.length ? 0 : -1;
}

const ED_LEVEL = {
    error: { icon: '❌', box: 'bg-red-950/50 border-red-700/50 text-red-200', chip: 'bg-red-900/50 hover:bg-red-800/70 text-red-100' },
    warn: { icon: '⚠️', box: 'bg-amber-950/50 border-amber-700/50 text-amber-200', chip: 'bg-amber-900/40 hover:bg-amber-800/60 text-amber-100' },
    ok: { icon: '✅', box: 'bg-emerald-950/50 border-emerald-700/50 text-emerald-200', chip: '' }
};

function showEditorValidationReport() {
    refreshEditorIssues(false);
    const container = document.getElementById('editor-validate-results');
    const modal = document.getElementById('editor-validate-modal');
    if (!container || !modal) return;
    container.innerHTML = '';
    if (!edIssues.length) {
        container.innerHTML = `<div class="rounded px-3 py-2 border ${ED_LEVEL.ok.box}">✅ Nenhum problema encontrado — o chart parece consistente!</div>`;
        closeIssueBar();
        modal.classList.remove('hidden');
        return;
    }
    const nPoints = edIssueFlat.length;
    const head = document.createElement('div');
    head.className = 'flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300';
    head.innerHTML = `<span>${edIssues.length} tipo(s) de problema${nPoints ? ` · ${nPoints} ponto(s) no chart` : ''}. Clique num ponto pra ir até ele.</span>`;
    if (nPoints) {
        const b = document.createElement('button');
        b.className = 'px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold';
        b.textContent = 'Percorrer um por um ▶';
        b.addEventListener('click', () => { closeEditorValidationReport(); openIssueBar(0); });
        head.appendChild(b);
    }
    container.appendChild(head);
    edIssues.forEach(is => {
        const st = ED_LEVEL[is.level] || ED_LEVEL.warn;
        const box = document.createElement('div');
        box.className = `rounded px-3 py-2 border ${st.box} flex flex-col gap-1.5`;
        const title = document.createElement('div');
        title.className = 'font-semibold';
        title.textContent = `${st.icon} ${is.title}`;
        box.appendChild(title);
        if (is.hint) { const h = document.createElement('div'); h.className = 'text-[10px] opacity-80'; h.textContent = is.hint; box.appendChild(h); }
        if (is.items.length) {
            const list = document.createElement('div');
            list.className = 'flex flex-wrap gap-1';
            is.items.slice(0, 60).forEach(it => {
                const c = document.createElement('button');
                c.className = `px-1.5 py-0.5 rounded font-mono text-[10px] ${st.chip}`;
                c.textContent = `${fmtEdT(it.t)}${it.lane != null ? ' · ' + edLaneName(it.lane) : ''}${it.gap != null ? ` (${Math.round(it.gap)}ms)` : ''}${it.off != null ? ` (${Math.round(it.off)}ms)` : ''}`;
                c.title = 'Ir até aqui e selecionar';
                c.addEventListener('click', () => { closeEditorValidationReport(); const i = edIssueFlat.findIndex(x => x.issue === is && x.t === it.t && x.lane === it.lane); openIssueBar(Math.max(0, i)); });
                list.appendChild(c);
            });
            if (is.items.length > 60) { const more = document.createElement('span'); more.className = 'text-[10px] opacity-70 self-center'; more.textContent = `+${is.items.length - 60}…`; list.appendChild(more); }
            box.appendChild(list);
        }
        const acts = document.createElement('div');
        acts.className = 'flex flex-wrap gap-1.5';
        const withNotes = is.items.filter(i => i.notes && i.notes.length);
        if (withNotes.length) {
            const sel = document.createElement('button');
            sel.className = 'px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] text-slate-100';
            sel.textContent = 'Selecionar todas';
            sel.title = 'Seleciona todas as notas deste problema (aí dá pra apagar com Delete ou mover com ↑/↓)';
            sel.addEventListener('click', () => { selectEditorNoteObjects(withNotes.flatMap(i => i.notes)); closeEditorValidationReport(); goToIssueTime(withNotes[0].t); flashEditorStatus(`${withNotes.length} ponto(s) selecionado(s).`); });
            acts.appendChild(sel);
        }
        (is.fixes || []).forEach(f => {
            const b = document.createElement('button');
            b.className = 'px-2 py-1 rounded bg-emerald-700/60 hover:bg-emerald-600/70 border border-emerald-500/60 text-[10px] font-semibold text-emerald-50';
            b.textContent = `🔧 ${f.label}`;
            b.addEventListener('click', () => { applyIssueFix(f); showEditorValidationReport(); });
            acts.appendChild(b);
        });
        if (acts.children.length) box.appendChild(acts);
        container.appendChild(box);
    });
    const foot = document.createElement('div');
    foot.className = 'text-[10px] text-slate-500';
    foot.textContent = 'As correções automáticas podem ser desfeitas com Ctrl+Z. Nada aqui impede salvar.';
    container.appendChild(foot);
    modal.classList.remove('hidden');
    renderEditorCanvas();
}

function applyIssueFix(f) {
    f.run();
    editorState.selectedIndex = -1;
    editorState.selectedIndices = new Set();
    resizeEditorCanvas();
    renderEditorCanvas();
    if (typeof editorHistCommit === 'function') editorHistCommit();
    flashEditorStatus(`🔧 ${f.label} — feito (Ctrl+Z desfaz).`);
}

function selectEditorNoteObjects(objs) {
    const set = new Set(objs);
    editorState.selectedIndex = -1;
    editorState.selectedIndices = new Set();
    editorState.notes.forEach((n, i) => { if (set.has(n)) editorState.selectedIndices.add(i); });
}

function goToIssueTime(t) {
    if (editorState.simulatorMode || editorState.highwayMode) {
        goToEditorTime(Math.max(0, (t - 400) / 1000));
    } else {
        const [v0, v1] = getEditorVisibleTimeRange();
        const span = isFinite(v0) && isFinite(v1) ? Math.max(500, v1 - v0) : 2000;
        goToEditorTime(Math.max(0, (t - span / 2) / 1000)); // deixa o ponto no meio da tela
    }
    renderEditorCanvas();
}

// ---------- barra de navegação dos problemas ----------
function ensureIssueBar() {
    let bar = document.getElementById('editor-issue-bar');
    if (bar) return bar;
    const wrap = document.getElementById('editor-canvas-wrap');
    const host = wrap ? wrap.parentElement : document.getElementById('chart-editor-modal');
    bar = document.createElement('div');
    bar.id = 'editor-issue-bar';
    bar.className = 'hidden absolute top-2 left-1/2 -translate-x-1/2 z-30 max-w-[95%] flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/95 border border-amber-500/60 shadow-xl text-[11px] text-slate-100';
    bar.innerHTML = `
        <span id="eib-pos" class="font-mono font-bold text-amber-300"></span>
        <span id="eib-text" class="max-w-[360px] truncate"></span>
        <button id="eib-prev" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600" title="Anterior (Shift+F3)">◀</button>
        <button id="eib-next" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600" title="Próximo (F3)">▶</button>
        <button id="eib-fix" class="hidden px-1.5 py-0.5 rounded bg-emerald-700/70 hover:bg-emerald-600 border border-emerald-500/60 text-emerald-50"></button>
        <button id="eib-list" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600" title="Ver a lista completa">Lista</button>
        <button id="eib-close" class="px-1.5 py-0.5 rounded text-slate-400 hover:text-white" title="Fechar (Esc)">✕</button>`;
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    (host || document.body).appendChild(bar);
    bar.querySelector('#eib-prev').addEventListener('click', () => stepIssue(-1));
    bar.querySelector('#eib-next').addEventListener('click', () => stepIssue(1));
    bar.querySelector('#eib-list').addEventListener('click', () => showEditorValidationReport());
    bar.querySelector('#eib-close').addEventListener('click', closeIssueBar);
    bar.querySelector('#eib-fix').addEventListener('click', fixCurrentIssueItem);
    return bar;
}
function openIssueBar(i) {
    edIssueBarOn = true;
    edIssueCursor = Math.max(0, Math.min(edIssueFlat.length - 1, i));
    ensureIssueBar().classList.remove('hidden');
    focusIssue();
}
function closeIssueBar() {
    edIssueBarOn = false;
    document.getElementById('editor-issue-bar')?.classList.add('hidden');
    if (isEditorOpen()) renderEditorCanvas();
}
function stepIssue(d) {
    if (!edIssueFlat.length) return;
    edIssueCursor = (edIssueCursor + d + edIssueFlat.length) % edIssueFlat.length;
    focusIssue();
}
// corrige só o ponto atual (quando o tipo de problema tem uma correção pontual)
const ED_POINT_FIX = {
    dup: { label: 'Remover duplicada', run: (it) => { const [a, b] = it.notes; const keepA = (edNoteEnd(a) - a.time) >= (edNoteEnd(b) - b.time); const kill = keepA ? b : a; editorState.notes = editorState.notes.filter(n => n !== kill); } },
    overlap: { label: 'Cortar a hold', run: (it) => { const [a, b] = it.notes; const beat = tempoSegmentAt(getEditorTempoSegments(), b.time).msPerBeat; const end = Math.floor(b.time - Math.max(40, beat / 4)); a.holdEnd = end - a.time >= Math.max(60, beat / 4) ? end : null; } },
    close: { label: 'Apagar a 2ª', run: (it) => { const kill = it.notes[1]; editorState.notes = editorState.notes.filter(n => n !== kill); } },
    short: { label: 'Virar toque', run: (it) => { it.notes[0].holdEnd = null; } },
    grid: { label: 'Encaixar', run: (it) => { const n = it.notes[0]; const nt = snapEditorTime(n.time); if (n.holdEnd != null) n.holdEnd = Math.max(nt + 1, snapEditorTime(n.holdEnd)); n.time = nt; } },
    stray: { label: 'Apagar', run: (it) => { const kill = it.notes[0]; editorState.notes = editorState.notes.filter(n => n !== kill); } },
    'songend-early': { label: 'Apagar', run: (it) => { const kill = it.notes[0]; editorState.notes = editorState.notes.filter(n => n !== kill); } },
    range: { label: 'Apagar', run: (it) => { const kill = it.notes[0]; editorState.notes = editorState.notes.filter(n => n !== kill); } }
};
function fixCurrentIssueItem() {
    const it = edIssueFlat[edIssueCursor];
    if (!it) return;
    const f = ED_POINT_FIX[it.issue.id];
    if (!f) return;
    f.run(it);
    editorState.selectedIndex = -1; editorState.selectedIndices = new Set();
    if (typeof editorHistCommit === 'function') editorHistCommit();
    refreshEditorIssues(true);
    if (!edIssueFlat.length) { updateIssueBar(); renderEditorCanvas(); return; }
    focusIssue();
}
function focusIssue() {
    const it = edIssueFlat[edIssueCursor];
    if (it) {
        if (it.notes && it.notes.length) selectEditorNoteObjects(it.notes);
        goToIssueTime(it.t);
    }
    updateIssueBar();
}
function updateIssueBar() {
    const bar = document.getElementById('editor-issue-bar');
    if (!bar || !edIssueBarOn) return;
    const it = edIssueFlat[edIssueCursor];
    const pos = bar.querySelector('#eib-pos'), txt = bar.querySelector('#eib-text'), fix = bar.querySelector('#eib-fix');
    if (!it) {
        pos.textContent = '✅';
        txt.textContent = 'Tudo certo — nenhum problema restante!';
        fix.classList.add('hidden');
        bar.classList.replace('border-amber-500/60', 'border-emerald-500/60');
        return;
    }
    bar.classList.replace('border-emerald-500/60', 'border-amber-500/60');
    pos.textContent = `${edIssueCursor + 1}/${edIssueFlat.length}`;
    const short = { range: 'Fora da duração', dup: 'Nota duplicada', overlap: 'Hold invadindo a próxima', close: 'Notas coladas', short: 'Hold curtinha', grid: 'Fora da grade', 'bpmc-late': 'BPM depois do fim', 'bpmc-odd': 'BPM incomum', 'songend-early': 'Nota depois do fim', stray: 'Nota solta', 'songend-late': 'Fim depois da duração', 'songend-silence': 'Silêncio no fim do áudio' }[it.issue.id] || it.issue.title;
    txt.textContent = `${it.issue.level === 'error' ? '❌' : '⚠️'} ${short} · ${fmtEdT(it.t)}${it.lane != null ? ' · ' + edLaneName(it.lane) : ''}${it.gap != null ? ` · ${Math.round(it.gap)}ms de distância` : ''}${it.off != null ? ` · ${Math.round(it.off)}ms fora` : ''}`;
    const f = ED_POINT_FIX[it.issue.id];
    fix.classList.toggle('hidden', !f);
    if (f) fix.textContent = `🔧 ${f.label}`;
}

// ---------- marcas na grade e na timeline ----------
function drawIssueMarkers() {
    if (!edIssueBarOn || !edIssueFlat.length || editorState.simulatorMode || editorState.highwayMode) return;
    const canvasEl = document.getElementById('editorCanvas');
    if (!canvasEl) return;
    const c = canvasEl.getContext('2d');
    const winTop = editorState.canvasWindowTopPx || 0;
    const layout = getColumnLayoutForWidth(editorState.mode, canvasEl.width);
    const cur = edIssueFlat[edIssueCursor];
    c.save();
    edIssueFlat.forEach(it => {
        const ns = (it.notes && it.notes.length) ? it.notes : null;
        const isCur = it === cur;
        const col = it.lane != null ? layout[it.lane] : null;
        const color = it.issue.level === 'error' ? '#f87171' : '#fbbf24';
        c.strokeStyle = color;
        c.lineWidth = isCur ? 3 : 1.5;
        c.setLineDash(isCur ? [] : [4, 3]);
        if (ns && col) {
            const y0 = Math.min(...ns.map(n => editorTimeToAbsY(edNoteEnd(n)))) - winTop;
            const y1 = Math.max(...ns.map(n => editorTimeToAbsY(n.time))) - winTop;
            if (y1 < -30 || y0 > canvasEl.height + 30) return;
            c.strokeRect(col.x + 1, y0 - NOTE_HEIGHT_PX / 2 - 4, col.width - 2, (y1 - y0) + NOTE_HEIGHT_PX + 8);
            if (isCur) { c.fillStyle = color; c.font = 'bold 11px monospace'; c.textAlign = 'left'; c.fillText('◀ aqui', col.x + col.width + 3 > canvasEl.width - 40 ? col.x - 44 : col.x + col.width + 3, y1 + 4); }
        } else {
            const y = editorTimeToAbsY(it.t) - winTop;
            if (y < -10 || y > canvasEl.height + 10) return;
            c.beginPath(); c.moveTo(0, y); c.lineTo(canvasEl.width, y); c.stroke();
        }
    });
    c.restore();
}
function drawIssueTimelineMarks() {
    if (!edIssueBarOn || !edIssueFlat.length || typeof editorTimelineGeometry !== 'function') return;
    const g = editorTimelineGeometry();
    if (!g) return;
    const c = g.c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    edIssueFlat.forEach((it, i) => {
        const y = g.yOf(Math.max(0, Math.min(g.totalMs, it.t)));
        c.fillStyle = it.issue.level === 'error' ? '#f87171' : '#fbbf24';
        const w = i === edIssueCursor ? g.W : Math.max(6, g.W * 0.35);
        c.fillRect(i === edIssueCursor ? 0 : g.W - w, y - 1, w, i === edIssueCursor ? 3 : 2);
    });
    c.restore();
}

(function wireEditorValidate() {
    const origRender = window.renderEditorCanvas;
    if (typeof origRender === 'function') window.renderEditorCanvas = function (...a) { const r = origRender.apply(this, a); try { drawIssueMarkers(); } catch (e) {} return r; };
    const origTl = window.renderEditorTimeline;
    if (typeof origTl === 'function') window.renderEditorTimeline = function (...a) { const r = origTl.apply(this, a); try { drawIssueTimelineMarks(); } catch (e) {} return r; };
    // a lista se atualiza sozinha enquanto você corrige
    if (typeof editorHistCommit === 'function') {
        const origCommit = editorHistCommit;
        window.editorHistCommit = function (...a) {
            const r = origCommit.apply(this, a);
            if (edIssueBarOn) { refreshEditorIssues(true); updateIssueBar(); }
            return r;
        };
    }
    window.addEventListener('keydown', (e) => {
        if (!edIssueBarOn || !isEditorOpen()) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.code === 'F3') { e.preventDefault(); stepIssue(e.shiftKey ? -1 : 1); }
        else if (e.code === 'Escape' && !editorState.isRecording && !editorState.isRefAudioPlaying) { e.preventDefault(); closeIssueBar(); }
    });
    // abrir outro chart / chart novo fecha a navegação
    ['openChartEditor', 'newBlankChartInEditor', 'loadChartIntoEditor', 'closeChartEditor'].forEach(name => {
        const orig = window[name];
        if (typeof orig === 'function') window[name] = function (...a) { closeIssueBar(); edIssueFlat = []; return orig.apply(this, a); };
    });
})();
