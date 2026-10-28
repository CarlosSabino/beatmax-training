// =====================================================================================
// calibracao-tela.js — CALIBRADOR BEATMAX (automático).
//
// As notas caem na SUA gear, na SUA velocidade, com batida de metrônomo, por ~32 segundos.
// Você aperta quando a nota ENCOSTA na linha. O jogo junta as amostras (descarta o aquecimento
// e os toques muito fora), calcula sozinho o ajuste de julgamento e já aplica — dá pra desfazer.
// Depois oferece calibrar numa segunda velocidade: com duas velocidades salvas, a compensação
// por velocidade (calibracao.js) passa a acertar a sincronia em qualquer velocidade.
// =====================================================================================
(function () {
    const BPM = 120, STEP = 60000 / BPM;          // uma nota por batida
    const NOTES = 64;                              // 64 batidas = 32 segundos de coleta
    const WARMUP = 4;                              // primeiras notas não contam
    const LEAD = 3000;                             // contagem antes da 1ª nota
    const MIN_OK = 30;                             // mínimo de toques válidos
    const W = 520, MATCH = 220; let H = 1080;          // janela pra casar o toque com a nota (ms)
    const S = { open: false, raf: 0, phase: 'ready', t0: 0, notes: [], samples: [], flashes: [], keys: [], keyUntil: [], effStart: 0, sound: true, audioRef: null, nextSched: 0, nextK: 0, last: null, result: null, undo: null };

    const $ = (id) => document.getElementById(id);
    const sfNow = () => speedFactorForTravel(scrollSpeed, H);
    const fmt = (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`;
    const colorOf = (v) => { const a = Math.abs(v); return a <= 10 ? '#67e8f9' : a <= 25 ? '#4ade80' : a <= 45 ? '#facc15' : '#f87171'; };

    // ---------- estilo ----------
    const css = document.createElement('style');
    css.textContent = `
#calt-ov{position:fixed;inset:0;z-index:140;background:#020617;display:flex;font-family:Rajdhani,sans-serif;color:#e2e8f0}
#calt-stage{flex:1;position:relative;display:flex;align-items:center;justify-content:center;min-width:0;padding:10px}
#calt-cv{background:#000;border-radius:6px}
#calt-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
#calt-center .big{font-family:Orbitron,monospace;font-weight:900;font-size:110px;color:#fff;text-shadow:0 0 30px rgba(34,211,238,.8)}
#calt-center .start{pointer-events:auto;background:rgba(2,6,23,.82);border:1px solid #22d3ee;border-radius:16px;padding:22px 28px;text-align:center;max-width:420px}
#calt-center .start b{font-family:Orbitron,monospace;font-size:20px;color:#67e8f9}
#calt-center .banner{text-align:center;background:rgba(2,6,23,.7);border-radius:18px;padding:16px 30px}
#calt-center .tag{font-family:Orbitron,monospace;font-weight:900;font-size:22px;letter-spacing:.2em;color:#facc15}
#calt-center .go{font-family:Orbitron,monospace;font-weight:900;font-size:54px;color:#6ee7b7;text-shadow:0 0 24px rgba(52,211,153,.8)}
#calt-center .hint{font-size:18px;color:#e2e8f0;margin-top:6px}
#calt-center .top{position:absolute;top:22px;left:0;right:0;text-align:center}
#calt-center .rec{display:inline-block;font-family:Orbitron,monospace;font-weight:800;font-size:18px;letter-spacing:.08em;padding:6px 16px;border-radius:999px;background:rgba(2,6,23,.75);border:1px solid #f43f5e;color:#fda4af}
#calt-center .rec.end{border-color:#facc15;color:#fde68a;font-size:24px}
#calt-side{width:440px;max-width:44vw;border-left:1px solid #1e293b;background:#0b1222;display:flex;flex-direction:column;gap:14px;padding:22px 24px;overflow-y:auto}
#calt-side h2{font-family:Orbitron,monospace;font-weight:900;font-size:22px;letter-spacing:.06em;color:#67e8f9}
#calt-side .sub{font-size:15px;color:#94a3b8;line-height:1.35}
#calt-side .card{border:1px solid #1e293b;border-radius:12px;background:#0f172a;padding:12px 14px}
#calt-side .lbl{font-family:Orbitron,monospace;font-size:10px;font-weight:800;letter-spacing:.12em;color:#64748b;text-transform:uppercase}
#calt-last{font-family:Orbitron,monospace;font-weight:900;font-size:40px;line-height:1.1}
#calt-last small{font-size:17px;margin-left:8px}
#calt-prog{height:10px;border-radius:6px;background:#1e293b;overflow:hidden;margin-top:6px}
#calt-prog div{height:100%;width:0;background:linear-gradient(90deg,#0891b2,#22d3ee);transition:width .2s}
#calt-bar{position:relative;height:46px;margin-top:8px;border-radius:8px;background:linear-gradient(90deg,rgba(244,63,94,.18),rgba(34,211,238,.12) 35%,rgba(34,211,238,.12) 65%,rgba(244,63,94,.18))}
#calt-bar .mid{position:absolute;left:50%;top:0;bottom:0;width:2px;background:#e2e8f0;opacity:.7}
#calt-bar .dot{position:absolute;top:50%;width:5px;height:20px;margin:-10px 0 0 -2.5px;border-radius:3px}
#calt-bar .avg{position:absolute;top:2px;bottom:2px;width:4px;margin-left:-2px;background:#facc15;border-radius:2px;box-shadow:0 0 8px #facc15}
#calt-bar .ends{position:absolute;bottom:-18px;font-size:12px;color:#64748b}
.calt-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.calt-val{font-family:Orbitron,monospace;font-weight:900;font-size:24px;color:#fff;min-width:90px;text-align:center}
#calt-res .num{font-family:Orbitron,monospace;font-weight:900;font-size:40px;color:#6ee7b7}
#calt-ov button{padding:8px 14px;border-radius:9px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:15px;font-weight:700;cursor:pointer}
#calt-ov button:hover{background:#334155}
#calt-ov button.pri{background:#0891b2;border-color:#22d3ee;color:#020617}
#calt-ov button:disabled{opacity:.4;cursor:default}
#calt-ov kbd{font-family:'JetBrains Mono',monospace;font-size:12px;padding:1px 6px;border-radius:5px;background:#1e293b;border:1px solid #475569;color:#fff}
#calt-model{font-size:14px;color:#cbd5e1;line-height:1.4}`;
    document.head.appendChild(css);

    function build() {
        const ov = document.createElement('div');
        ov.id = 'calt-ov';
        ov.innerHTML = `
<div id="calt-stage"><canvas id="calt-cv"></canvas><div id="calt-center"></div></div>
<div id="calt-side">
  <div><h2>CALIBRADOR BEATMAX</h2><div class="sub">Por uns 30 segundos, aperte qualquer tecla do modo (ou Espaço) quando a nota <b>encostar na linha</b>. No fim, o jogo calcula e aplica o ajuste sozinho.</div></div>
  <div class="card"><div class="lbl">Coleta</div>
    <div class="calt-row" style="justify-content:space-between;margin-top:4px"><span id="calt-count" style="font-size:16px;font-weight:700">0 toques</span><span id="calt-time" style="font-family:'JetBrains Mono',monospace;color:#94a3b8">0:32</span></div>
    <div id="calt-prog"><div></div></div>
    <div class="lbl" style="margin-top:12px">Último toque</div><div id="calt-last">—</div>
    <div id="calt-bar"><div class="mid"></div><span class="ends" style="left:0">FAST −60</span><span class="ends" style="right:0">+60 SLOW</span></div>
  </div>
  <div id="calt-res" class="card" style="display:none"></div>
  <div class="card"><div class="lbl">Velocidade</div>
    <div class="calt-row" style="margin-top:6px"><button id="calt-sdown">▼</button><div id="calt-spd" class="calt-val"></div><button id="calt-sup">▲</button>
      <label style="display:flex;align-items:center;gap:6px;font-size:15px;cursor:pointer"><input id="calt-sound" type="checkbox" checked style="accent-color:#22d3ee;width:16px;height:16px"> Batida</label></div>
    <div id="calt-model" style="margin-top:8px"></div>
  </div>
  <div class="calt-row"><button id="calt-go" class="pri">▶ Começar <kbd>Espaço</kbd></button><button id="calt-close">Sair <kbd>Esc</kbd></button></div>
  <div class="sub" style="font-size:14px"><kbd>↑</kbd>/<kbd>↓</kbd> muda a velocidade antes de começar (<kbd>Shift</kbd> ±0.5)</div>
</div>`;
        document.body.appendChild(ov);
        $('calt-sdown').onclick = () => setSpeed(scrollSpeed - 0.1);
        $('calt-sup').onclick = () => setSpeed(scrollSpeed + 0.1);
        $('calt-sound').onchange = (e) => { S.sound = e.target.checked; };
        $('calt-go').onclick = start;
        $('calt-close').onclick = close;
        ov.querySelectorAll('button,input').forEach(b => b.addEventListener('mouseup', () => b.blur()));
    }

    // ---------- interface ----------
    function center(html) { const c = $('calt-center'); if (c) c.innerHTML = html; }
    function ui() {
        const valid = S.samples.length;
        $('calt-count').textContent = `${valid} toque${valid === 1 ? '' : 's'}`;
        const now = performance.now();
        const end = S.t0 + (NOTES - 1) * STEP;
        const total = (NOTES - 1) * STEP;
        const left = S.phase === 'run' || S.phase === 'count' ? Math.max(0, end - now) : (S.phase === 'done' ? 0 : total);
        $('calt-time').textContent = `0:${String(Math.ceil(left / 1000)).padStart(2, '0')}`;
        $('calt-prog').firstElementChild.style.width = `${Math.min(100, (1 - left / total) * 100)}%`;
        const lastEl = $('calt-last');
        if (S.last == null) lastEl.innerHTML = '<span style="color:#475569">—</span>';
        else { const v = S.last - S.effStart; lastEl.innerHTML = `<span style="color:${colorOf(v)}">${fmt(v)}ms</span><small style="color:${colorOf(v)}">${Math.abs(v) <= 3 ? 'NO ALVO' : v < 0 ? 'FAST' : 'SLOW'}</small>`; }
        const bar = $('calt-bar');
        bar.querySelectorAll('.dot,.avg').forEach(d => d.remove());
        const pos = (v) => `${50 + Math.max(-60, Math.min(60, v)) / 60 * 50}%`;
        const xs = S.samples.slice(-32).map(s => s.raw - S.effStart);
        xs.forEach((v, i) => { const d = document.createElement('div'); d.className = 'dot'; d.style.left = pos(v); d.style.background = colorOf(v); d.style.opacity = String(0.2 + 0.8 * (i + 1) / xs.length); bar.appendChild(d); });
        if (S.result && S.result.ok) { const m = document.createElement('div'); m.className = 'avg'; m.style.left = pos(S.result.value - S.effStart); bar.appendChild(m); }
        $('calt-spd').textContent = Number(scrollSpeed).toFixed(1);
        const locked = S.phase === 'run' || S.phase === 'count';
        ['calt-sdown', 'calt-sup', 'calt-go'].forEach(id => { const b = $(id); if (b) b.disabled = locked; });
        $('calt-go').innerHTML = S.phase === 'done' ? '↻ Calibrar de novo <kbd>Espaço</kbd>' : '▶ Começar <kbd>Espaço</kbd>';
        const pts = (typeof calibModel !== 'undefined' && calibModel.points) || [];
        const active = typeof calibActive === 'function' && calibActive();
        $('calt-model').innerHTML = (pts.length ? `Calibrado neste perfil: ${pts.map(p => `<b>${p.speed.toFixed(1)}</b> → ${fmt(p.judge)}ms`).join(' · ')}<br>` : '')
            + (active ? '<span style="color:#6ee7b7">Compensação por velocidade ATIVA</span> — nas outras velocidades o jogo calcula sozinho.'
                : 'Calibre em <b>duas velocidades bem diferentes</b> pra o jogo acertar a sincronia em qualquer velocidade.')
            + (typeof audioSaidaInfo === 'function' ? `<div style="margin-top:8px;font-size:13.5px">${audioSaidaInfo().html}</div>` : '');
    }

    // ---------- fluxo ----------
    function setSpeed(v) {
        if (S.phase === 'run' || S.phase === 'count') return;
        const nv = Math.round(Math.max(1, Math.min(10, v)) * 10) / 10;
        if (nv === scrollSpeed) return;
        scrollSpeed = nv;
        if (typeof updateSpeedDisplay === 'function') updateSpeedDisplay();
        renderedSpeedFactor = gameSpeedFactorTarget();
        if (typeof saveSettings === 'function') saveSettings();
        ui();
    }
    function start() {
        if (S.phase === 'run' || S.phase === 'count') return;
        S.phase = 'count';
        S.samples = []; S.last = null; S.result = null; S.flashes = [];
        S.effStart = Math.round(getActiveJudgeOffset());
        $('calt-res').style.display = 'none';
        S.t0 = performance.now() + LEAD;
        S.notes = []; S.nextSched = 0; S.nextK = 0;
        try { audio.init(); } catch (e) {}
        S.audioRef = (audio.ctx && typeof audio.ctx.currentTime === 'number') ? { a: audio.ctx.currentTime, p: performance.now() } : null;
        ui();
    }

    function robust(raws) {
        const sorted = raws.slice().sort((a, b) => a - b);
        const med = sorted[sorted.length >> 1];
        const near = sorted.filter(v => Math.abs(v - med) <= 80);      // tira toques muito fora (escorregão, tecla errada)
        const trim = Math.floor(near.length * 0.1);
        const core = near.slice(trim, near.length - trim || near.length);
        const mean = core.reduce((a, b) => a + b, 0) / core.length;
        const sd = Math.sqrt(core.reduce((a, b) => a + (b - mean) ** 2, 0) / core.length);
        return { mean, sd, n: near.length };
    }

    function finish() {
        S.phase = 'done'; S.doneAt = performance.now(); S.doneShown = false;
        // dois bipes avisando que acabou
        try { if (audio.ctx) { const t = audio.ctx.currentTime + 0.02; audio.scheduleMetronomeBeat(t); audio.scheduleMetronomeBeat(t + 0.14); } } catch (e) {}
        const raws = S.samples.filter(s => s.k >= WARMUP).map(s => s.raw);
        const box = $('calt-res');
        box.style.display = '';
        if (raws.length < MIN_OK) {
            S.result = { ok: false };
            box.innerHTML = `<div class="lbl">Resultado</div><div style="font-size:17px;margin-top:6px;color:#fca5a5">Poucos toques válidos (${raws.length}/${MIN_OK}). Nada foi alterado — tente de novo, apertando em todas as notas.</div>`;
            ui(); return;
        }
        const r = robust(raws);
        const value = Math.round(Math.max(-120, Math.min(120, r.mean)));
        const quality = r.sd <= 15 ? ['Ótima', '#6ee7b7'] : r.sd <= 25 ? ['Boa', '#4ade80'] : r.sd <= 35 ? ['Regular', '#facc15'] : ['Instável', '#f87171'];
        if (r.sd > 40) {
            S.result = { ok: false };
            box.innerHTML = `<div class="lbl">Resultado</div><div style="font-size:17px;margin-top:6px;color:#fca5a5">Os toques variaram demais (±${Math.round(r.sd)}ms), então o resultado não é confiável e <b>não foi aplicado</b>. Respire, olhe só pra linha e tente de novo.</div>`;
            ui(); return;
        }
        // aplica: vira o ajuste desta velocidade e entra no modelo por velocidade
        S.undo = { judgeOffset, model: JSON.parse(JSON.stringify(calibModel)) };
        judgeOffset = value;
        if (typeof calibAddPoint === 'function') calibAddPoint(sfNow(), scrollSpeed, value);
        if (typeof updateJudgeOffsetDisplay === 'function') updateJudgeOffsetDisplay();
        if (typeof saveSettings === 'function') saveSettings();
        S.result = { ok: true, value };
        // sugere a 2ª velocidade se ainda não tem uma bem diferente
        const pts = calibModel.points || [];
        const far = pts.some(p => Math.abs(p.speed - scrollSpeed) >= 1);
        const other = Math.round((scrollSpeed >= 5 ? scrollSpeed - 1.5 : scrollSpeed + 1.5) * 10) / 10;
        box.innerHTML = `<div class="lbl">Resultado — aplicado</div>
            <div class="calt-row" style="margin-top:4px"><span class="num">${fmt(value)}ms</span><span style="font-size:15px;color:#94a3b8">antes: ${fmt(S.effStart)}ms</span></div>
            <div style="font-size:15px;margin-top:2px">${r.n} toques · variação ±${Math.round(r.sd)}ms · consistência <b style="color:${quality[1]}">${quality[0]}</b></div>
            <div class="calt-row" style="margin-top:10px">
              ${far ? '' : `<button id="calt-next" class="pri">Calibrar também em ${other.toFixed(1)}</button>`}
              <button id="calt-undo">Desfazer</button></div>
            ${far ? '' : '<div class="sub" style="font-size:13.5px;margin-top:6px">Recomendado: calibrando numa segunda velocidade, a sincronia não desanda mais quando você trocar a velocidade.</div>'}`;
        const nx = $('calt-next'); if (nx) nx.onclick = () => { setSpeed(other); start(); };
        $('calt-undo').onclick = () => {
            if (!S.undo) return;
            judgeOffset = S.undo.judgeOffset;
            Object.assign(calibModel, S.undo.model);
            if (typeof calibSave === 'function') calibSave();
            if (typeof updateJudgeOffsetDisplay === 'function') updateJudgeOffsetDisplay();
            if (typeof saveSettings === 'function') saveSettings();
            S.undo = null; S.result = null;
            box.innerHTML = '<div class="lbl">Resultado</div><div style="font-size:16px;margin-top:6px">↩ Desfeito: o ajuste voltou ao que era antes.</div>';
            ui();
        };
        ui();
    }

    // ---------- notas e metrônomo ----------
    function ensureNotes(now) {
        const L = getMainLaneCount(currentMode);
        const travel = noteTravelMsForSpeed(scrollSpeed) + 300;
        let k = S.nextK;
        while (k < NOTES && S.t0 + k * STEP < now + travel) {
            const cyc = (L - 1) * 2 || 1, p = k % cyc;          // vai e volta pelas colunas
            S.notes.push({ k, t: S.t0 + k * STEP, lane: L > 1 ? (p < L ? p : cyc - p) : 0, hit: false });
            k++;
        }
        S.nextK = k;
        if (S.audioRef && S.sound) {
            S.notes.forEach(n => {
                if (n.k < S.nextSched) return;
                // mesma conta do jogo: já desconta o atraso da saída de áudio
                const at = typeof audio.wallToCtxTime === 'function' ? audio.wallToCtxTime(n.t) : S.audioRef.a + (n.t - S.audioRef.p) / 1000;
                if (at > audio.ctx.currentTime + 0.005 && at < audio.ctx.currentTime + 1.5) { audio.scheduleMetronomeBeat(at); S.nextSched = n.k + 1; }
                else if (at <= audio.ctx.currentTime + 0.005) S.nextSched = n.k + 1;
            });
        }
    }

    function onKey(e) {
        if (!S.open) return;
        const k = e.code;
        const lanes = KEY_CONFIGS[currentMode] || [];
        if (e.type === 'keyup') { const i = lanes.indexOf(k); if (i >= 0) S.keys[i] = false; e.stopImmediatePropagation(); return; }
        e.stopImmediatePropagation();
        if (k === 'Escape') { e.preventDefault(); close(); return; }
        const running = S.phase === 'run' || S.phase === 'count';
        if (!running) {
            if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); setSpeed(scrollSpeed + (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.5 : 0.1)); return; }
            if (k === 'Space' || k === 'Enter' || k === 'NumpadEnter') { e.preventDefault(); start(); return; }
            return;
        }
        if (e.repeat) { e.preventDefault(); return; }
        const li = lanes.indexOf(k);
        if (li < 0 && k !== 'Space') return;
        e.preventDefault();
        if (li >= 0) S.keys[li] = true;
        tap(inputTimeFromEvent(e));
    }
    // toque vindo do controle (gamepad.js manda com o carimbo de tempo do próprio controle)
    window.caltPadActive = () => !!(S.open && (S.phase === 'run' || S.phase === 'count'));
    window.caltPadTap = (P, li) => { if (!window.caltPadActive()) return; if (li >= 0) S.keyUntil[li] = performance.now() + 90; tap(P); };
    function tap(P) {
        let best = null;
        S.notes.forEach(n => { if (!n.hit && Math.abs(P - n.t) <= MATCH && (!best || Math.abs(P - n.t) < Math.abs(P - best.t))) best = n; });
        if (!best) return;
        best.hit = true;
        const raw = P - best.t;
        S.samples.push({ raw, k: best.k });
        S.last = raw;
        const col = getGameplayColumnLayout(currentMode, W)[best.lane];
        S.flashes.push({ x: col.x + col.width / 2, y: H - 80, life: 1, color: getKeyColorScheme(currentMode, gearSkin)[best.lane], big: Math.abs(raw - S.effStart) <= 10 });
        S.keyUntil[best.lane] = performance.now() + 90;
        ui();
    }

    // ---------- desenho (mesma gear e mesma conta de posição do jogo) ----------
    function frame(now) {
        if (!S.open) return;
        S.raf = requestAnimationFrame(frame);
        const cv = $('calt-cv'), stage = $('calt-stage');
        const F = GEAR_FRAME_SIDE, PB = typeof gearProp === 'function' ? gearProp().P : GEAR_FRAME_BOTTOM, TW = W + F * 2, TH = H + PB;
        const availH = Math.max(200, stage.clientHeight - 20), availW = Math.max(150, stage.clientWidth - 20);
        const cssH = Math.min(availH, availW * TH / TW), cssW = cssH * TW / TH;
        const dpr = window.devicePixelRatio || 1;
        const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
        if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; }
        const c = cv.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = '#000'; c.fillRect(0, 0, pw, ph);
        c.setTransform(pw / TW, 0, 0, ph / TH, 0, 0);

        // fases
        if (S.phase === 'count') {
            const left = S.t0 - now;
            if (left <= 0) S.phase = 'run';
            else center(`<div class="banner"><div class="tag">PREPARE-SE</div><div class="big">${Math.ceil(left / 1000)}</div><div class="hint">A coleta começa quando a 1ª nota encostar na linha</div></div>`);
        }
        if (S.phase === 'run') {
            const endT = S.t0 + (NOTES - 1) * STEP;
            const rest = endT - now;
            if (now - S.t0 < 1000) center('<div class="banner"><div class="go">COMEÇOU!</div><div class="hint">Aperte quando cada nota encostar na linha</div></div>');
            else if (rest > 0 && rest <= 3000) center(`<div class="top"><span class="rec end">TERMINA EM ${Math.ceil(rest / 1000)}</span></div>`);
            else if (rest > 0) center(`<div class="top"><span class="rec">● COLETANDO · 0:${String(Math.ceil(rest / 1000)).padStart(2, '0')}</span></div>`);
            if (now > endT + MATCH + 150) finish();
        }
        if (S.phase === 'done' && now - S.doneAt < 1600) center('<div class="banner"><div class="go">FIM DA COLETA!</div><div class="hint">Resultado no painel ao lado →</div></div>');
        else if (S.phase === 'done' && S.doneShown !== true) { S.doneShown = true; center(''); }
        if (S.phase === 'ready') center(`<div class="start"><b>CALIBRADOR BEATMAX</b><div style="font-size:16px;margin:8px 0 12px;color:#cbd5e1">Velocidade ${Number(scrollSpeed).toFixed(1)} · ~32 segundos</div><div style="font-size:16px">Aperte <kbd>Espaço</kbd> pra começar</div><div style="font-size:14px;color:#94a3b8;margin-top:8px">Vai ter uma contagem 3-2-1 e o aviso COMEÇOU! · no fim aparece FIM DA COLETA</div></div>`);
        if (S.phase === 'run' || S.phase === 'count') ui();
        if (S.phase === 'run' || S.phase === 'count') ensureNotes(now);

        const sf = sfNow(), strikeY = H - 80;
        const save = { ctx, keyState, lw: canvas.logicalWidth, lh: canvas.logicalHeight };
        try {
            ctx = c;
            canvas.logicalWidth = W; canvas.logicalHeight = H;
            const cols = getGameplayColumnLayout(currentMode, W);
            keyState = cols.map((_, i) => !!S.keys[i] || (S.keyUntil[i] || 0) > now);
            const th = GEAR_THEMES[gearSkin] || getGearTheme();
            const L = { frame: !!th, F: th ? F : 0, P: th ? PB : 0, W, H, totalW: TW, totalH: TH, theme: th };
            const P = make2DPainter(c);
            if (th) P.sprite(gearFrameSpec(L), 0, 0);
            P.offset(L.F, 0, () => {
                drawGearLaneBase(P, L, true);
                const nh = NOTE_HEIGHT_BASE * noteSizeScale;
                S.notes = S.notes.filter(n => {
                    if (!n.hit && now - n.t > MATCH) n.hit = true; // passou sem toque
                    if (n.t < now - 600) return false;
                    if (!n.hit) {
                        const y = strikeY - (n.t - now) * sf;
                        if (y > -60) drawNote(n.lane, y, cols[n.lane], nh);
                    }
                    return true;
                });
                drawGearStrikeLine(P, L, th ? th.accent : '#22d3ee');
                drawGearKeyPanel(P, L, 0);
                S.flashes = S.flashes.filter(f => { drawGearHitFlash(P, f); f.life -= 0.06; return f.life > 0; });
            });
            if (th) drawGearFrameDynamic(P, L, 0);
        } catch (err) {
            console.warn('[calibrador] desenho', err);
        } finally {
            ctx = save.ctx; keyState = save.keyState; canvas.logicalWidth = save.lw; canvas.logicalHeight = save.lh;
        }
    }

    function open() {
        H = typeof gearProp === 'function' ? gearProp().H : 1080; // mesma proporção da gear do jogo
        if (typeof isPlaying !== 'undefined' && isPlaying) return;
        $('settings-modal')?.classList.add('hidden');
        document.getElementById('calt-ov')?.remove();
        build();
        S.open = true; S.phase = 'ready';
        S.samples = []; S.last = null; S.result = null; S.notes = []; S.keys = []; S.keyUntil = []; S.undo = null;
        S.effStart = Math.round(getActiveJudgeOffset());
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKey, true);
        ui();
        cancelAnimationFrame(S.raf);
        S.raf = requestAnimationFrame(frame);
    }
    function close() {
        S.open = false;
        cancelAnimationFrame(S.raf);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKey, true);
        document.getElementById('calt-ov')?.remove();
        if (typeof saveSettings === 'function') saveSettings();
        if (typeof calibUI === 'function') calibUI();
    }
    window.openCalibrador = open;
    window.__caltState = S; // (diagnóstico)

    // ---------- botão nas Configurações ----------
    const quick = $('btn-start-calibration');
    if (quick && !$('btn-calib-tela')) {
        const b = document.createElement('button');
        b.id = 'btn-calib-tela';
        b.type = 'button';
        b.className = quick.className;
        b.textContent = 'Calibrador BEATMAX';
        b.title = 'Notas caindo na sua gear e velocidade por ~30s: o jogo mede seus toques e define o ajuste sozinho';
        quick.insertAdjacentElement('beforebegin', b);
        quick.className = 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-bold';
        quick.textContent = 'Com áudio (música)';
        quick.title = 'Calibração rápida antiga: toca olhando e depois só ouvindo — também acerta o Offset de Áudio';
        quick.parentElement.classList.add('gap-2');
        const titleEl = quick.parentElement.querySelector('.text-cyan-200');
        if (titleEl) titleEl.textContent = 'Calibrador BEATMAX (≈30s)';
        const descEl = titleEl && titleEl.nextElementSibling;
        if (descEl) descEl.textContent = 'As notas caem na sua gear e velocidade; aperte quando encostarem na linha. No fim o jogo calcula e aplica o Ajuste de Julgamento sozinho (dá pra desfazer). "Com áudio" também acerta o Offset de Áudio.';
        b.addEventListener('click', open);
    }
})();
