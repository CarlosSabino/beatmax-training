// =====================================================================================
// sincronia.js — ferramentas pra entender a sincronia do PC:
//
//  • Fluidez da partida: mede o tempo de cada quadro enquanto você joga e conta as
//    "travadas" (quadros que demoraram bem mais que o normal). Aparece na tela de resultado.
//  • Atraso da saída de áudio: o valor que o sistema informa (o jogo já desconta ele em tudo).
//    Se for alto (típico de fone/caixa Bluetooth), avisa — Bluetooth atrasa e, pior, VARIA.
// =====================================================================================
(function () {
    // ---------- fluidez ----------
    const F = { on: false, last: 0, deltas: [], summary: null };
    window.__fluidez = F; // (diagnóstico)
    function loop(ts) {
        requestAnimationFrame(loop);
        const playing = typeof isPlaying !== 'undefined' && isPlaying && !(typeof isPaused !== 'undefined' && isPaused);
        if (playing) {
            if (!F.on) { F.on = true; F.deltas = []; F.last = ts; F.summary = null; F.fx = ''; return; }
            if (F.deltas.length % 60 === 5) F.fx = efeitosAtivos() || F.fx;
            const d = ts - F.last;
            F.last = ts;
            if (d > 0 && d < 1000 && document.visibilityState === 'visible') F.deltas.push(d);
        } else if (F.on) {
            // pausou ou acabou: fecha o resumo (se pausar e voltar, continua somando)
            if (!(typeof isPaused !== 'undefined' && isPaused)) { F.on = false; F.summary = summarize(F.deltas); }
            else F.last = ts;
        }
    }
    requestAnimationFrame(loop);
    // efeitos visuais pesados ligados nesta partida (pra dar a dica certa no resultado)
    function efeitosAtivos() {
        const out = [];
        const pc = document.getElementById('palco3d'), fx = document.getElementById('skinfx-layer');
        if (pc && pc.style.display !== 'none') out.push('Palco 3D');
        if (fx && fx.style.display !== 'none') out.push('efeitos da gear');
        return out.join(' + ');
    }
    // quando volta da pausa, não conta o tempo parado como um quadro lento
    document.addEventListener('visibilitychange', () => { F.last = performance.now(); });

    function summarize(ds) {
        if (ds.length < 60) return null;
        const s = ds.slice().sort((a, b) => a - b);
        const med = s[s.length >> 1];
        const limit = Math.max(med * 1.8, med + 8);
        let hitches = 0, worst = 0;
        ds.forEach(d => { if (d > limit) { hitches++; worst = Math.max(worst, d); } });
        const p99 = s[Math.min(s.length - 1, Math.floor(s.length * 0.99))];
        return { fps: Math.round(1000 / med), frameMs: med, hitches, worst: Math.round(worst), p99: Math.round(p99), frames: ds.length };
    }
    // texto pra tela de resultado
    window.fluidezResumo = function () {
        const r = F.summary || (F.on ? summarize(F.deltas) : null);
        if (!r) return null;
        const ok = r.hitches === 0 ? 'sem travadas' : `${r.hitches} travada${r.hitches > 1 ? 's' : ''} (pior ${r.worst}ms)`;
        const level = r.hitches === 0 ? 'ok' : r.hitches <= 3 && r.worst < 60 ? 'warn' : 'bad';
        // muitas travadas: as notas aparecem atrasadas na tela e o toque sai SLOW — aí o timing
        // da partida não serve pra mexer na sincronia
        const heavy = r.hitches >= 20 || r.hitches / r.frames > 0.01;
        const dica = heavy && F.fx ? ` — ${F.fx} pesando no seu PC: tente a qualidade Leve do Palco, menos partículas ou desligue os efeitos` : '';
        return { text: `Fluidez: ${r.fps} fps · ${ok}${dica}`, level, heavy, fx: F.fx, r };
    };

    // ---------- atraso de saída do áudio ----------
    window.audioSaidaMs = function () {
        try { if (typeof audio !== 'undefined' && audio.ctx) return Math.round(audio.getOutputLatencySec() * 1000); } catch (e) {}
        return null;
    };
    const SLOW_MS = 100;
    window.audioSaidaInfo = function () {
        const ms = window.audioSaidaMs();
        if (ms == null) return { ms: null, html: 'Atraso da saída de áudio: aparece depois de tocar algum som.', slow: false };
        const slow = ms >= SLOW_MS;
        return {
            ms, slow,
            html: slow
                ? `<b style="color:#fbbf24">⚠ Saída de áudio com ${ms}ms de atraso</b> — parece fone/caixa <b>Bluetooth</b> (ou saída lenta). O jogo desconta esse atraso, mas no Bluetooth ele <b>varia</b> e a sincronia oscila. Pra jogar sério, prefira fone com fio.`
                : `Atraso da saída de áudio: <b>${ms}ms</b> (informado pelo sistema e já descontado pelo jogo).`
        };
    };
    // aviso uma vez por sessão, ao começar uma partida com saída lenta
    let warned = false;
    if (typeof window.startPractice === 'function') {
        const orig = window.startPractice;
        window.startPractice = function () {
            const r = orig.apply(this, arguments);
            setTimeout(() => {
                const i = window.audioSaidaInfo();
                if (!warned && i.slow) {
                    warned = true;
                    const t = document.createElement('div');
                    t.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:130;max-width:min(560px,92vw);background:rgba(15,23,42,.95);border:1px solid #f59e0b;border-radius:12px;padding:10px 14px;color:#fde68a;font:600 14px Rajdhani,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:none';
                    t.innerHTML = `🎧 Saída de áudio com ${i.ms}ms de atraso — parece Bluetooth. A sincronia pode oscilar; fone com fio é mais estável.`;
                    document.body.appendChild(t);
                    setTimeout(() => t.remove(), 6000);
                }
            }, 1500);
            return r;
        };
    }
    // nas Configurações, junto da calibração
    if (typeof window.calibUI === 'function') {
        const origUI = window.calibUI;
        window.calibUI = function () {
            const r = origUI.apply(this, arguments);
            const box = document.getElementById('calib-speed-box');
            if (box) {
                let el = box.querySelector('.audio-saida');
                if (!el) { el = document.createElement('div'); el.className = 'audio-saida mt-1'; box.appendChild(el); }
                el.innerHTML = window.audioSaidaInfo().html;
            }
            return r;
        };
        try { window.calibUI(); } catch (e) {}
    }
})();
