// =====================================================================================
// telas.js — Abertura do jogo, tela de GAME OVER (vídeo + estatísticas) e o aviso de
// servidor desatualizado / arquivos novos. Tudo opcional (Configurações → Telas).
// =====================================================================================

const TELAS_KEY = 'djmaxTrainerTelas_v1';
const SERVER_MIN_VERSION = 3;
let telasCfg = { intro: true, gameOver: true, alwaysFs: true, autoUpdate: true };
try { Object.assign(telasCfg, JSON.parse(localStorage.getItem(TELAS_KEY) || '{}')); } catch (e) {}
function saveTelasCfg() { try { localStorage.setItem(TELAS_KEY, JSON.stringify(telasCfg)); } catch (e) {} }
// nos testes automáticos (navegador robô) as telas ficam desligadas, a não ser com ?telas=1
const TELAS_FORCED = /[?&]telas=1\b/.test(location.search);
const TELAS_ALLOWED = TELAS_FORCED || !navigator.webdriver;

(function injectTelasStyle() {
    const st = document.createElement('style');
    st.textContent = `
    .tl-ov{position:fixed;inset:0;z-index:150;background:#000;overflow:hidden;opacity:0;transition:opacity .35s ease;user-select:none}
    .tl-ov.on{opacity:1}
    .tl-ov.out{opacity:0;transition:opacity .6s ease}
    .tl-fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
    .tl-video{opacity:0;transition:opacity .4s ease}
    .tl-video.on{opacity:1}
    .tl-press{position:absolute;left:0;right:0;bottom:9%;text-align:center;font-family:Orbitron,sans-serif;font-weight:700;
        letter-spacing:.35em;font-size:clamp(12px,1.6vw,22px);color:#e0f7ff;text-shadow:0 0 12px #22d3ee,0 0 28px #ec4899;
        animation:tlBlink 1.4s ease-in-out infinite}
    .tl-hint{position:absolute;right:18px;bottom:14px;font:600 11px Rajdhani,sans-serif;color:rgba(226,232,240,.55);letter-spacing:.08em}
    @keyframes tlBlink{0%,100%{opacity:1}50%{opacity:.25}}
    .go-bg{position:absolute;inset:-12px;background:url(assets/gameover-fundo.jpg?v=2) center/cover no-repeat;filter:brightness(.42) blur(3px)}
    .go-stats{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity .5s ease}
    .go-stats.on{opacity:1}
    .go-band{position:relative;width:min(1100px,96vw);padding:clamp(14px,2.5vh,28px) 0 clamp(16px,3vh,30px);
        background:linear-gradient(180deg,rgba(30,41,59,.55),rgba(15,23,42,.62));border-top:1px solid rgba(148,163,184,.45);
        border-bottom:1px solid rgba(148,163,184,.45);backdrop-filter:blur(4px);box-shadow:0 0 60px rgba(0,0,0,.6) inset;
        border-radius:50% / 26px;display:flex;flex-direction:column;align-items:center}
    .go-title{font-family:'Barlow Condensed',Rajdhani,sans-serif;font-weight:800;font-size:clamp(54px,11vw,150px);line-height:.95;
        letter-spacing:.02em;color:rgba(70,12,20,.35);-webkit-text-stroke:2.5px #ff5a69;
        filter:drop-shadow(0 0 3px rgba(255,70,90,.95)) drop-shadow(0 0 12px rgba(255,30,60,.7)) drop-shadow(0 0 34px rgba(255,0,40,.4));animation:goFlicker 3.2s infinite}
    @keyframes goFlicker{0%,100%{opacity:1}3%{opacity:.55}5%{opacity:1}61%{opacity:1}62%{opacity:.7}63%{opacity:1}}
    .go-sub{font:600 clamp(11px,1.3vw,15px) Rajdhani,sans-serif;color:#cbd5e1;letter-spacing:.12em;margin:2px 0 clamp(6px,1.2vh,14px);text-align:center;max-width:90%}
    .go-rows{width:min(640px,86vw)}
    .go-row{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:clamp(4px,1vh,9px) 4px;position:relative;
        font-family:Rajdhani,sans-serif;font-weight:600;font-size:clamp(17px,2.3vw,30px);color:#f1f5f9;opacity:0;transform:translateY(6px);
        transition:opacity .35s ease,transform .35s ease}
    .go-row.on{opacity:1;transform:none}
    .go-row:after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,#94a3b8,rgba(148,163,184,.35) 50%,#94a3b8)}
    .go-row:before{content:'';position:absolute;left:-3px;bottom:-2px;width:6px;height:6px;background:#cbd5e1;border-radius:1px;box-shadow:calc(min(640px,86vw) - 2px) 0 0 #cbd5e1}
    .go-row b{font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.04em}
    .go-row small{font-size:.6em;color:#94a3b8;margin-left:8px;font-weight:600}
    .go-btns{display:flex;gap:clamp(18px,5vw,70px);margin-top:clamp(14px,3.5vh,34px);opacity:0;transition:opacity .4s ease}
    .go-btns.on{opacity:1}
    .go-btn{position:relative;font:700 clamp(18px,2.4vw,30px) Rajdhani,sans-serif;letter-spacing:.06em;color:#cbd5e1;background:none;border:0;
        padding:6px 10px 6px 54px;cursor:pointer;transition:color .15s ease,text-shadow .15s ease}
    .go-btn:before{content:'';position:absolute;left:6px;top:50%;width:38px;height:38px;margin-top:-19px;border-radius:50%;
        border:3px solid rgba(203,213,225,.25);transition:all .2s ease}
    .go-btn.sel{color:#fff;text-shadow:0 0 10px rgba(255,255,255,.7)}
    .go-btn.sel:before{border-color:#f8fafc;box-shadow:0 0 14px rgba(255,255,255,.75),inset 0 0 10px rgba(255,255,255,.35);border-style:dashed;animation:goSpin 4s linear infinite}
    @keyframes goSpin{to{transform:rotate(360deg)}}
    .go-keys{margin-top:10px;font:600 11px Rajdhani,sans-serif;color:rgba(203,213,225,.55);letter-spacing:.08em;text-align:center}
    .go-spark{position:absolute;width:3px;height:3px;border-radius:50%;background:#fbbf24;box-shadow:0 0 6px #f59e0b;opacity:0;animation:goSpark linear infinite}
    @keyframes goSpark{0%{opacity:0;transform:translate(0,0)}15%{opacity:.9}100%{opacity:0;transform:translate(var(--dx),var(--dy))}}
    .srv-toast{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:95;max-width:min(680px,94vw);display:flex;gap:10px;align-items:center;
        padding:9px 12px;border-radius:12px;background:rgba(15,23,42,.96);border:1px solid rgba(34,211,238,.5);color:#e2e8f0;font:600 12px Rajdhani,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)}
    .srv-toast.warn{border-color:rgba(251,191,36,.7)}
    .srv-toast button{padding:4px 10px;border-radius:8px;font-weight:700;font-size:12px}
    `;
    document.head.appendChild(st);
})();

function telasVolume() { return typeof musicVolume === 'number' ? Math.max(0, Math.min(1, musicVolume)) : 0.8; }
function telasPadButtons() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p.buttons.map(b => b.pressed || b.value > 0.5);
    return null;
}
// teclas que nunca são "engolidas" pelas telas (recarregar, tela cheia, DevTools)
function telasPassKey(e) { return /^F(5|11|12)$/.test(e.code) || e.ctrlKey || e.metaKey || e.altKey; }

// ======================= ABERTURA =======================
let introEl = null;
function showIntro(force) {
    if (introEl || (!force && (!telasCfg.intro || !TELAS_ALLOWED))) return false;
    const ov = document.createElement('div');
    ov.id = 'tela-abertura';
    ov.className = 'tl-ov';
    ov.innerHTML = `<img class="tl-fill" src="assets/abertura-capa.jpg?v=2" alt="">
        <video class="tl-fill tl-video" src="assets/abertura.mp4?v=2" playsinline preload="auto"></video>
        <div class="tl-press">PRESSIONE QUALQUER TECLA</div>
        <div class="tl-hint"></div>`;
    document.body.appendChild(ov);
    introEl = ov;
    requestAnimationFrame(() => ov.classList.add('on'));
    const video = ov.querySelector('video');
    const press = ov.querySelector('.tl-press');
    const hint = ov.querySelector('.tl-hint');
    let stage = 'cover', stageAt = performance.now(), padPrev = null, raf = 0;

    const finish = () => {
        if (stage === 'done') return;
        stage = 'done';
        window.removeEventListener('keydown', onKey, true);
        cancelAnimationFrame(raf);
        ov.classList.add('out');
        try { video.pause(); } catch (e) {}
        setTimeout(() => { ov.remove(); if (introEl === ov) introEl = null; }, 650);
    };
    const play = () => {
        telasEnterFullscreen(); // o toque que abre a abertura também põe o jogo em tela cheia
        stage = 'video'; stageAt = performance.now();
        // este toque/clique é um "gesto" do usuário: libera o som do vídeo e o áudio do jogo
        try { if (typeof audio !== 'undefined' && audio.init) audio.init(); } catch (e) {}
        press.style.display = 'none';
        hint.textContent = 'qualquer tecla pula';
        video.volume = telasVolume();
        video.muted = false;
        const p = video.play();
        video.classList.add('on');
        if (p && p.catch) p.catch(() => { video.muted = true; video.play().catch(finish); });
    };
    const advance = () => {
        if (stage === 'cover') play();
        else if (stage === 'video' && performance.now() - stageAt > 500) finish();
    };
    const onKey = (e) => {
        if (telasPassKey(e)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) advance();
    };
    window.addEventListener('keydown', onKey, true);
    ov.addEventListener('pointerdown', (e) => { e.preventDefault(); advance(); });
    video.addEventListener('ended', finish);
    video.addEventListener('error', () => { if (stage === 'video') finish(); });
    const padLoop = () => {
        const b = telasPadButtons();
        if (b) {
            if (padPrev && b.some((d, i) => d && !padPrev[i])) advance();
            padPrev = b;
        }
        if (stage !== 'done') raf = requestAnimationFrame(padLoop);
    };
    raf = requestAnimationFrame(padLoop);
    return true;
}

// ======================= GAME OVER =======================
let gameOverEl = null;
function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function gameOverSnapshot() {
    const total = (typeof notes !== 'undefined' && notes) ? notes.length : 0;
    let judged = 0, lastT = 0, endT = 0;
    (notes || []).forEach(n => {
        endT = Math.max(endT, n.holdEnd || n.time);
        if (n.hit || n.missed) { judged++; lastT = Math.max(lastT, n.time); }
    });
    try { if (typeof getSongEndChartMs === 'function') { const e = getSongEndChartMs(); if (isFinite(e) && e > 0) endT = e; } } catch (e) {}
    const score = totalPossibleScore > 0 ? Math.max(0, Math.round(1e6 * (currentEarnedScore || 0) / totalPossibleScore)) : 0;
    const rate = stats.rateCount ? stats.rateSum / stats.rateCount : 0;
    let title = '';
    try { title = typeof patternTitle === 'function' ? patternTitle(currentPatternType) : ''; } catch (e) {}
    const mode = typeof getModeDisplayName === 'function' ? getModeDisplayName(currentMode) : currentMode;
    return {
        score, rate, total, judged, lastT, endT, title, mode,
        speed: Math.round((typeof gameRate === 'number' ? gameRate : 1) * 100),
        maxCombo: stats.maxCombo || 0,
        m100: stats.judgments.max100 || 0, brk: stats.judgments.break || 0
    };
}

// Chamado por script.js quando o HP zera. Devolve false se a tela estiver desligada (aí o
// jogo segue o caminho antigo: análise direto).
function showGameOverScreen() {
    if (!telasCfg.gameOver || !TELAS_ALLOWED || gameOverEl) return false;
    const snap = gameOverSnapshot();
    const ov = document.createElement('div');
    ov.id = 'tela-gameover';
    ov.className = 'tl-ov';
    const pctProg = snap.total ? Math.floor(100 * snap.judged / snap.total) : 0;
    const pctM100 = snap.judged ? Math.round(100 * snap.m100 / snap.judged) : 0;
    const rows = [
        ['Score', `<b data-count="${snap.score}">0000000</b>`],
        ['Rate', `<b>${snap.rate.toFixed(2)}%</b>`],
        ['Progresso', `<b>${pctProg}%</b><small>${snap.judged}/${snap.total} notas${snap.endT ? ` · ${fmtClock(snap.lastT)} de ${fmtClock(snap.endT)}` : ''}</small>`],
        ['Max Combo', `<b>${snap.maxCombo}</b>`],
        ['MAX 100%', `<b>${snap.m100}</b><small>${pctM100}%</small>`],
        ['Break', `<b>${snap.brk}</b>`]
    ];
    const sparks = Array.from({ length: 26 }, () => {
        const x = Math.random() * 100, y = 30 + Math.random() * 70, d = 3 + Math.random() * 5;
        return `<i class="go-spark" style="left:${x}%;top:${y}%;--dx:${(Math.random() * 120 - 60).toFixed(0)}px;--dy:${(-60 - Math.random() * 160).toFixed(0)}px;animation-duration:${d.toFixed(1)}s;animation-delay:${(Math.random() * d).toFixed(1)}s"></i>`;
    }).join('');
    ov.innerHTML = `
        <video class="tl-fill" src="assets/gameover.mp4?v=2" playsinline preload="auto"></video>
        <div class="go-stats">
            <div class="go-bg"></div>${sparks}
            <div class="go-band">
                <div class="go-title">GAME OVER</div>
                <div class="go-sub">${escapeTelas(snap.title)} · ${escapeTelas(snap.mode)}${snap.speed !== 100 ? ` · ${snap.speed}%` : ''}</div>
                <div class="go-rows">${rows.map(([k, v]) => `<div class="go-row"><span>${k}:</span><span>${v}</span></div>`).join('')}</div>
            </div>
            <div class="go-btns">
                <button class="go-btn" data-go="retry">RETRY</button>
                <button class="go-btn" data-go="analysis">ANÁLISE</button>
                <button class="go-btn" data-go="exit">EXIT</button>
            </div>
            <div class="go-keys">←/→ escolher · Enter confirmar · F8 retry · Esc sair</div>
        </div>
        <div class="tl-hint">qualquer tecla pula</div>`;
    document.body.appendChild(ov);
    gameOverEl = ov;
    requestAnimationFrame(() => ov.classList.add('on'));

    const video = ov.querySelector('video');
    const statsBox = ov.querySelector('.go-stats');
    const hint = ov.querySelector('.tl-hint');
    const btns = [...ov.querySelectorAll('.go-btn')];
    let stage = 'video', stageAt = performance.now(), sel = 0, padPrev = null, raf = 0;
    const select = (i) => { sel = (i + btns.length) % btns.length; btns.forEach((b, j) => b.classList.toggle('sel', j === sel)); };
    select(0);

    const close = () => {
        stage = 'done';
        window.removeEventListener('keydown', onKey, true);
        cancelAnimationFrame(raf);
        try { video.pause(); } catch (e) {}
        ov.remove();
        if (gameOverEl === ov) gameOverEl = null;
    };
    const act = (what) => {
        if (stage !== 'stats') return;
        close();
        if (what === 'retry') {
            const b = document.getElementById('btn-retry');
            if (b) b.click(); else startPractice();
        } else if (what === 'analysis') {
            showAnalysis();
            // redesenha o mapa/gráficos agora que a tela de resultado está visível
            try { if (typeof renderResultExtras === 'function' && typeof lastRunSummary !== 'undefined' && lastRunSummary) renderResultExtras(); } catch (e) { console.error(e); }
        } else {
            const b = document.getElementById('btn-back-menu');
            if (b) b.click();
        }
    };
    const showStats = () => {
        if (stage !== 'video') return;
        stage = 'stats'; stageAt = performance.now();
        try { video.pause(); } catch (e) {}
        video.style.transition = 'opacity .5s ease'; video.style.opacity = '0';
        hint.remove();
        statsBox.classList.add('on');
        ov.querySelectorAll('.go-row').forEach((r, i) => setTimeout(() => r.classList.add('on'), 250 + i * 110));
        setTimeout(() => ov.querySelector('.go-btns').classList.add('on'), 250 + rows.length * 110);
        // score sobe contando
        const el = ov.querySelector('[data-count]');
        const target = +el.dataset.count, t0 = performance.now(), dur = 900;
        const tick = () => {
            const k = Math.min(1, (performance.now() - t0) / dur);
            el.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3)))).padStart(7, '0');
            if (k < 1 && stage === 'stats') requestAnimationFrame(tick);
        };
        setTimeout(() => requestAnimationFrame(tick), 250);
    };
    // quem está apertando as lanes na hora que o HP zera não deve pular o vídeo sem querer
    const ready = () => performance.now() - stageAt > (stage === 'video' ? 1200 : 450);
    const onKey = (e) => {
        if (telasPassKey(e)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.repeat || !ready()) return;
        if (stage === 'video') { showStats(); return; }
        if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') select(sel - 1);
        else if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'Tab') select(sel + 1);
        else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') act(btns[sel].dataset.go);
        else if (e.code === 'F8') act('retry');
        else if (e.code === 'Escape' || e.code === 'Backspace') act('exit');
    };
    window.addEventListener('keydown', onKey, true);
    ov.addEventListener('pointerdown', (e) => {
        if (stage === 'video' && ready()) { e.preventDefault(); showStats(); }
    });
    btns.forEach((b, i) => {
        b.addEventListener('mouseenter', () => select(i));
        b.addEventListener('click', () => act(b.dataset.go));
    });
    video.addEventListener('ended', showStats);
    video.addEventListener('error', showStats);
    video.volume = telasVolume();
    const p = video.play();
    if (p && p.catch) p.catch(() => { video.muted = true; video.play().catch(showStats); });
    // se o vídeo travar por algum motivo, as estatísticas aparecem de qualquer jeito
    setTimeout(showStats, 9000);

    const padLoop = () => {
        const b = telasPadButtons();
        if (b && padPrev && ready()) {
            const edge = (i) => b[i] && !padPrev[i];
            if (stage === 'video') { if (b.some((d, i) => d && !padPrev[i])) showStats(); }
            else if (stage === 'stats') {
                if (edge(14) || edge(12)) select(sel - 1);
                else if (edge(15) || edge(13)) select(sel + 1);
                else if (edge(0)) act(btns[sel].dataset.go);
                else if (edge(1)) act('exit');
                else if (edge(9)) act('retry');
            }
        }
        if (b) padPrev = b;
        if (stage !== 'done') raf = requestAnimationFrame(padLoop);
    };
    raf = requestAnimationFrame(padLoop);
    return true;
}
function gameOverScreenEnabled() { return !!(telasCfg.gameOver && TELAS_ALLOWED) && !(typeof replayRun !== 'undefined' && replayRun); }
function escapeTelas(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ======================= CONFIGURAÇÕES =======================
(function addTelasSettings() {
    const afs = document.getElementById('setting-auto-fullscreen')?.closest('label');
    if (!afs) return;
    const mk = (id, title, desc, on) => {
        const l = document.createElement('label');
        l.className = 'flex items-start justify-between gap-3 cursor-pointer';
        l.innerHTML = `<span><span class="text-xs font-bold text-slate-200 block">${title}</span><span class="text-[10px] text-slate-400">${desc}</span></span>
            <input type="checkbox" id="${id}" ${on ? 'checked' : ''} class="accent-cyan-400 w-5 h-5 cursor-pointer shrink-0 mt-0.5">`;
        return l;
    };
    const a = mk('setting-intro', 'Abertura ao abrir o jogo', 'Mostra a abertura (com som) quando a página abre. Qualquer tecla pula.', telasCfg.intro);
    const g = mk('setting-gameover-video', 'Tela de GAME OVER', 'Quando o HP zera: vídeo de Game Over + estatísticas (RETRY / ANÁLISE / EXIT). Desligado = vai direto pra análise.', telasCfg.gameOver);
    const fs = mk('setting-always-fs', 'Sempre em tela cheia', 'O jogo fica em tela cheia de verdade (sem navegador) desde a primeira tecla. ESC continua pausando; pra sair da tela cheia, SEGURE o ESC por 2 segundos.', telasCfg.alwaysFs);
    afs.after(fs, a, g);
    afs.classList.add('hidden'); // a antiga "tela cheia automática" (só durante a partida) fica escondida
    fs.querySelector('input').addEventListener('change', (e) => { telasCfg.alwaysFs = !!e.target.checked; saveTelasCfg(); if (telasCfg.alwaysFs) telasEnterFullscreen(); else telasExitFullscreen(); });
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'ml-2 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-300';
    replay.textContent = 'Ver agora';
    a.querySelector('.block').appendChild(replay);
    replay.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showIntro(true); });
    a.querySelector('input').addEventListener('change', (e) => { telasCfg.intro = !!e.target.checked; saveTelasCfg(); });
    g.querySelector('input').addEventListener('change', (e) => { telasCfg.gameOver = !!e.target.checked; saveTelasCfg(); });
})();

// ======================= INSTALAR COMO APLICATIVO =======================
// Chrome/Edge instalam o jogo como um app de verdade: janela própria (sem barra do
// navegador), ícone na barra de tarefas e no menu Iniciar. Continua usando o servidor local.
let appInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); appInstallPrompt = e; updateAppInstallUI(); });
window.addEventListener('appinstalled', () => { appInstallPrompt = null; updateAppInstallUI(true); });
function isRunningAsApp() {
    return window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: window-controls-overlay)').matches);
}
function updateAppInstallUI(justInstalled) {
    const st = document.getElementById('app-install-status');
    const btn = document.getElementById('btn-app-install');
    if (!st || !btn) return;
    if (isRunningAsApp() || justInstalled) {
        st.textContent = justInstalled ? '✅ Instalado! Procure "BEATMAX Training" no menu Iniciar / Área de Trabalho.' : '✅ Você já está usando o aplicativo.';
        btn.classList.add('hidden');
    } else if (!/^https?:$/.test(location.protocol)) {
        st.textContent = 'Abra pelo iniciar.bat (http://localhost:8791) pra poder instalar.';
        btn.classList.add('hidden');
    } else {
        st.textContent = appInstallPrompt ? 'Janela própria, sem barra do navegador, com ícone na barra de tarefas.' : 'No Chrome: menu ⋮ → "Transmitir, salvar e compartilhar" → "Instalar página como app". No Edge: menu … → "Aplicativos" → "Instalar este site como aplicativo".';
        btn.classList.toggle('hidden', !appInstallPrompt);
    }
}
(function addAppInstallSettings() {
    const anchor = document.getElementById('setting-gameover-video')?.closest('label');
    if (!anchor) return;
    const box = document.createElement('div');
    box.className = 'flex flex-col gap-1';
    box.innerHTML = `<div class="flex items-center justify-between gap-3"><span class="text-xs font-bold text-slate-200">Instalar como aplicativo</span>
        <button id="btn-app-install" type="button" class="hidden px-2 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-bold">Instalar</button></div>
        <span id="app-install-status" class="text-[10px] text-slate-400"></span>`;
    anchor.after(box);
    box.querySelector('#btn-app-install').addEventListener('click', async () => {
        if (!appInstallPrompt) return updateAppInstallUI();
        appInstallPrompt.prompt();
        try { await appInstallPrompt.userChoice; } catch (e) {}
        appInstallPrompt = null;
        updateAppInstallUI();
    });
    updateAppInstallUI();
})();

// ======================= SERVIDOR: versão e arquivos novos =======================
let serverBuildAtLoad = null;
function serverToast(html, warn) {
    let t = document.getElementById('srv-toast');
    if (!t) { t = document.createElement('div'); t.id = 'srv-toast'; document.body.appendChild(t); }
    t.className = 'srv-toast' + (warn ? ' warn' : '');
    t.innerHTML = html + `<button class="bg-slate-700 hover:bg-slate-600 text-slate-200" data-x>✕</button>`;
    t.querySelector('[data-x]').addEventListener('click', () => t.remove());
    return t;
}
async function checkServerVersion() {
    if (!/^https?:$/.test(location.protocol)) return;
    let j;
    try { const r = await fetch('/api/ping', { cache: 'no-store' }); if (!r.ok) return; j = await r.json(); } catch (e) { return; }
    if (!j || j.server !== 'djmax-trainer') return;
    if ((j.version || 0) < SERVER_MIN_VERSION) {
        serverToast(`<span>⚠️ O servidor que está rodando é de uma versão antiga. Feche a janela preta do <b>iniciar.bat</b> e abra ele de novo — daqui pra frente ele se atualiza sozinho.</span>`, true);
        return;
    }
    if (serverBuildAtLoad == null) { serverBuildAtLoad = j.build; return; }
    const busy = (typeof isPlaying !== 'undefined' && isPlaying) || gameOverEl || introEl;
    if (j.build && j.build !== serverBuildAtLoad && !busy && !document.getElementById('srv-toast')) {
        const t = serverToast(`<span>🔄 Arquivos do jogo atualizados.</span><button class="bg-cyan-500 hover:bg-cyan-400 text-slate-950" data-r>Recarregar</button>`);
        t.querySelector('[data-r]').addEventListener('click', () => location.reload());
        serverBuildAtLoad = j.build;
    }
}
checkServerVersion();

// ======================= ATUALIZAÇÃO AUTOMÁTICA =======================
// O servidor confere a release mais nova no GitHub (ver servidor.py). Aqui: mostra a versão,
// avisa quando tem nova e (se ligado) instala sozinho quando o jogo abre — nunca no meio de
// uma partida. Músicas, recordes e replays ficam no navegador: não são tocados.
let updState = null, updBusy = false;
// selo da versão no cabeçalho (clicar abre o painel de atualização)
function updBadgeUI() {
    const b = document.getElementById('app-version-badge'), t = document.getElementById('app-version-text');
    if (!b || !t) return;
    const u = updState;
    const base = 'ml-1 self-center flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono transition ';
    if (!u) { t.textContent = 'versão ?'; b.className = base + 'border-slate-600 bg-slate-800/80 hover:bg-slate-700 text-slate-400'; return; }
    if (updBusy) { t.textContent = `v${u.current} → ${u.latest}…`; b.className = base + 'border-amber-400 bg-amber-500/15 text-amber-200 animate-pulse'; return; }
    if (u.available) { t.textContent = `v${u.current} → v${u.latest} disponível`; b.className = base + 'border-emerald-400 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 animate-pulse'; return; }
    t.textContent = `v${u.current}`;
    b.className = base + 'border-slate-600 bg-slate-800/80 hover:bg-slate-700 text-slate-300';
}
function updPanelEnsure() {
    let pn = document.getElementById('upd-panel');
    if (pn) return pn;
    pn = document.createElement('div');
    pn.id = 'upd-panel';
    pn.className = 'hidden fixed z-[120] w-[320px] max-w-[92vw] p-3 rounded-xl bg-slate-900/95 border border-cyan-500/40 shadow-2xl flex flex-col gap-2 text-slate-200';
    pn.innerHTML = `<div class="flex items-center justify-between"><span class="font-orbitron text-sm font-bold text-cyan-300">ATUALIZAÇÕES</span><button data-x class="text-slate-400 hover:text-white text-sm px-1">✕</button></div>
        <div class="text-[12px]">Versão instalada: <b id="updp-cur" class="font-mono"></b></div>
        <div id="updp-status" class="text-[11px] text-slate-300 leading-snug"></div>
        <div class="flex gap-2">
            <button id="updp-check" class="flex-1 px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px]"><i class="fa-solid fa-magnifying-glass mr-1"></i>Procurar agora</button>
            <button id="updp-apply" class="hidden flex-1 px-2 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold"><i class="fa-solid fa-download mr-1"></i>Atualizar agora</button>
        </div>
        <label class="flex items-center justify-between gap-2 cursor-pointer text-[11px] text-slate-300"><span>Instalar sozinho quando o jogo abrir</span><input id="updp-auto" type="checkbox" class="accent-cyan-400 w-4 h-4"></label>`;
    document.body.appendChild(pn);
    pn.querySelector('[data-x]').addEventListener('click', () => pn.classList.add('hidden'));
    pn.querySelector('#updp-check').addEventListener('click', async () => { pn.querySelector('#updp-status').textContent = 'Procurando…'; await updCheck(true); });
    pn.querySelector('#updp-apply').addEventListener('click', updApply);
    pn.querySelector('#updp-auto').addEventListener('change', (e) => { telasCfg.autoUpdate = !!e.target.checked; saveTelasCfg(); const o = document.getElementById('setting-auto-update'); if (o) o.checked = telasCfg.autoUpdate; });
    document.addEventListener('pointerdown', (e) => { if (!pn.classList.contains('hidden') && !pn.contains(e.target) && !e.target.closest('#app-version-badge')) pn.classList.add('hidden'); });
    return pn;
}
function updPanelUI() {
    const pn = document.getElementById('upd-panel');
    if (!pn) return;
    const u = updState;
    pn.querySelector('#updp-cur').textContent = u ? `v${u.current}` : '—';
    pn.querySelector('#updp-auto').checked = !!telasCfg.autoUpdate;
    const st = pn.querySelector('#updp-status'), ap = pn.querySelector('#updp-apply');
    if (!u) { st.textContent = 'O servidor do jogo não respondeu (abra pelo atalho do BEATMAX Training).'; ap.classList.add('hidden'); return; }
    if (updBusy) { st.textContent = '⏳ Atualizando… o jogo recarrega sozinho.'; ap.classList.add('hidden'); return; }
    if (u.available) { st.innerHTML = `🆕 Versão <b>${escapeTelas(u.latest)}</b> disponível${u.notes ? `<br><span class="text-slate-400">${escapeTelas(u.notes)}</span>` : ''}`; ap.classList.remove('hidden'); }
    else { st.textContent = u.error ? `Não deu pra procurar: ${u.error}` : '✅ Você está na versão mais nova.'; ap.classList.add('hidden'); }
}
document.getElementById('app-version-badge')?.addEventListener('click', (e) => {
    const pn = updPanelEnsure();
    const r = e.currentTarget.getBoundingClientRect();
    pn.style.left = Math.max(8, Math.min(window.innerWidth - 330, r.left)) + 'px';
    pn.style.top = (r.bottom + 8) + 'px';
    const opening = pn.classList.contains('hidden');
    pn.classList.toggle('hidden');
    updPanelUI();
    if (opening) updCheck(true);
});

function updUI() {
    updBadgeUI();
    updPanelUI();
    const st = document.getElementById('upd-status'), btn = document.getElementById('btn-upd-apply'), cur = document.getElementById('upd-current');
    if (!st) return;
    const u = updState;
    if (cur) cur.textContent = u ? `v${u.current}` : '';
    if (!u) { st.textContent = 'Servidor sem suporte a atualização (abra pelo atalho/iniciar.bat).'; btn.classList.add('hidden'); return; }
    if (updBusy) { st.textContent = '⏳ Atualizando…'; btn.classList.add('hidden'); return; }
    if (u.available) { st.innerHTML = `🆕 Versão <b>${escapeTelas(u.latest)}</b> disponível${u.notes ? ' — ' + escapeTelas(u.notes) : ''}`; btn.classList.remove('hidden'); }
    else { st.textContent = u.error ? `Não deu pra procurar: ${u.error}` : `Você está na versão mais nova${u.latest ? '' : ''}.`; btn.classList.add('hidden'); }
}
async function updCheck(force) {
    if (!/^https?:$/.test(location.protocol)) return null;
    try { const r = await fetch('/api/update/check' + (force ? '?force=1' : ''), { cache: 'no-store' }); if (!r.ok) { updState = null; updUI(); return null; } updState = await r.json(); }
    catch (e) { updState = null; }
    updUI();
    return updState;
}
async function updApply() {
    if (updBusy || !updState || !updState.available) return;
    updBusy = true; updUI();
    const target = updState.latest;
    const t = serverToast(`<span>⏳ Atualizando o BEATMAX Training para a versão <b>${escapeTelas(target)}</b>… não feche o jogo.</span>`);
    try {
        const r = await fetch('/api/update/apply', { method: 'POST', headers: { 'X-DJMAX': '1', 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json().catch(() => ({}));
        if (!j.ok) throw new Error(j.error || `erro ${r.status}`);
        // espera o servidor reiniciar com a versão nova e recarrega a página
        for (let i = 0; i < 60; i++) {
            await new Promise(res => setTimeout(res, 1000));
            try { const p = await (await fetch('/api/ping', { cache: 'no-store' })).json(); if (p.gameVersion === target) break; } catch (e) {}
        }
        t.innerHTML = `<span>✅ Atualizado para a versão ${escapeTelas(target)} — recarregando…</span>`;
        setTimeout(() => location.reload(), 800);
    } catch (e) {
        updBusy = false;
        serverToast(`<span>❌ A atualização não deu certo: ${escapeTelas(e.message || String(e))}. O jogo continua na versão atual.</span>`, true);
        updCheck(true);
    }
}
(function addUpdateSettings() {
    const anchor = document.getElementById('app-install-status')?.parentElement;
    if (!anchor) return;
    const box = document.createElement('div');
    box.className = 'flex flex-col gap-1';
    box.innerHTML = `<div class="flex items-center justify-between gap-2"><span class="text-xs font-bold text-slate-200">Atualizações <span id="upd-current" class="font-mono text-[10px] text-slate-400"></span></span>
            <span class="flex gap-1"><button id="btn-upd-check" type="button" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200">Procurar agora</button>
            <button id="btn-upd-apply" type="button" class="hidden px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold">Atualizar agora</button></span></div>
        <span id="upd-status" class="text-[10px] text-slate-400"></span>
        <label class="flex items-center justify-between gap-3 cursor-pointer"><span class="text-[11px] text-slate-300">Instalar atualizações sozinho quando o jogo abrir</span>
            <input type="checkbox" id="setting-auto-update" ${telasCfg.autoUpdate ? 'checked' : ''} class="accent-cyan-400 w-4 h-4 cursor-pointer shrink-0"></label>`;
    anchor.after(box);
    box.querySelector('#btn-upd-check').addEventListener('click', async () => { document.getElementById('upd-status').textContent = 'Procurando…'; await updCheck(true); });
    box.querySelector('#btn-upd-apply').addEventListener('click', updApply);
    box.querySelector('#setting-auto-update').addEventListener('change', (e) => { telasCfg.autoUpdate = !!e.target.checked; saveTelasCfg(); });
})();
(async function updOnStart() {
    if (!TELAS_ALLOWED && !TELAS_FORCED) { updCheck(false); return; }
    // dá um tempinho pro servidor consultar o GitHub (ele confere sozinho ~8s depois de ligar)
    // procura de verdade ao abrir (o servidor fica ligado o dia todo desde o boot do Windows,
    // então o resultado guardado nele podia estar velho — era por isso que não atualizava)
    let u = await updCheck(true);
    if (u && !u.available && !u.latest && !u.error) { await new Promise(r => setTimeout(r, 10000)); u = await updCheck(true); }
    if (!u || !u.available) return;
    const busy = () => (typeof isPlaying !== 'undefined' && isPlaying);
    if (telasCfg.autoUpdate && !busy()) { updApply(); return; }
    const t = serverToast(`<span>🆕 Versão <b>${escapeTelas(u.latest)}</b> do BEATMAX Training disponível${u.notes ? ': ' + escapeTelas(u.notes) : ''}.</span><button class="bg-emerald-500 hover:bg-emerald-400 text-slate-950" data-up>Atualizar</button>`);
    t.querySelector('[data-up]').addEventListener('click', () => { t.remove(); updApply(); });
})();
setInterval(checkServerVersion, 20000);
// com o jogo aberto, confere de novo a cada 30 min; achou e está no menu (sem jogar)? avisa/instala
setInterval(async () => {
    if (updBusy || (typeof isPlaying !== 'undefined' && isPlaying)) return;
    const had = updState && updState.available;
    const u = await updCheck(true);
    if (!u || !u.available || had) return;
    const noMenu = typeof window.bmHubAtivo === 'function' ? window.bmHubAtivo() : false;
    if (telasCfg.autoUpdate && noMenu) { updApply(); return; }
    const t = serverToast(`<span>🆕 Saiu a versão <b>${escapeTelas(u.latest)}</b> do BEATMAX Training.</span><button class="bg-emerald-500 hover:bg-emerald-400 text-slate-950" data-up>Atualizar</button>`);
    t.querySelector('[data-up]').addEventListener('click', () => { t.remove(); updApply(); });
}, 30 * 60 * 1000);

// ======================= SEMPRE EM TELA CHEIA =======================
// O navegador só deixa entrar em tela cheia depois de um toque/tecla do usuário: entramos no
// primeiro (o "pressione qualquer tecla" da abertura, ou a primeira tecla/clique se a
// abertura estiver desligada). Com a tela cheia ligada, o Chrome/Edge deixam o jogo "segurar"
// o ESC (Keyboard Lock): um toque pausa como sempre; segurar 2s sai da tela cheia.
let telasFsUserLeft = false;   // o jogador saiu da tela cheia de propósito: só volta no próximo START
let telasFsByUs = false;
let telasFsPending = false;
function telasFsWanted() { return telasCfg.alwaysFs && TELAS_ALLOWED; }
function telasEnterFullscreen() {
    if (!telasFsWanted() || document.fullscreenElement || telasFsPending || !document.documentElement.requestFullscreen) return;
    try {
        telasFsPending = true;
        const p = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        telasFsByUs = true;
        const lock = () => { try { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(() => {}); } catch (e) {} };
        const done = () => { telasFsPending = false; if (!document.fullscreenElement) telasFsByUs = false; };
        if (p && p.then) p.then(lock).catch(() => {}).then(done); else { lock(); done(); }
    } catch (e) { telasFsPending = false; telasFsByUs = false; }
}
function telasExitFullscreen() {
    try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (e) {}
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && telasFsByUs) { telasFsByUs = false; telasFsUserLeft = true; }
    if (typeof resizeCanvas === 'function') setTimeout(resizeCanvas, 50);
});
// primeira tecla/clique da sessão (e depois de sair de propósito, o próximo START)
function telasFsGesture(e) {
    if (!telasFsWanted() || document.fullscreenElement || telasFsUserLeft) return;
    if (e.type === 'keydown' && (e.repeat || /^F(5|11|12)$/.test(e.code) || e.ctrlKey || e.altKey || e.metaKey)) return;
    telasEnterFullscreen();
}
window.addEventListener('keydown', telasFsGesture, true);
window.addEventListener('pointerdown', telasFsGesture, true);
(function telasFsOnStart() {
    const again = () => { if (telasFsWanted() && !document.fullscreenElement) { telasFsUserLeft = false; telasEnterFullscreen(); } };
    ['btn-start', 'btn-retry', 'btn-pause-restart'].forEach(id => document.getElementById(id)?.addEventListener('click', again, true));
})();

showIntro(false);
