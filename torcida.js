// =====================================================================================
// torcida.js — TORCIDA 8-BIT: as personagens em pixel ao lado da gear, reagindo à partida.
//
//  • Compra na Loja (seção Torcida 8-bit) e escolhe no Personalizar quem fica de cada lado.
//  • Animadas quadro a quadro (folhas de sprites assets/pxs-*.webp): balançam no ritmo, pulam
//    nos acertos, cada uma tem o seu golpe especial a cada 50 de combo, cambalhota a cada 100,
//    entram no "embalo" com 100+ (Arya corre de um lado pro outro, Jade dança, Iris acena,
//    Echo digita a mil), fazem poses à toa quando está calmo e levam um susto no BREAK.
//    Cada uma solta o seu "efeito": Arya ♪, Jade spray, Iris ♥, Echo dados.
//  • Funciona com qualquer gear. Desenha numa camada própria (não mexe na gear nem nas notas).
// =====================================================================================
(function () {
    const LIST = [
        { id: 'arya', name: 'Arya 8-bit', img: 'assets/px-arya.webp', price: 60, cor: '#22d3ee', fx: 'nota', desc: 'Canta junto: notas musicais a cada sequência.' },
        { id: 'jade', name: 'Jade 8-bit', img: 'assets/px-jade.webp', price: 60, cor: '#4ade80', fx: 'spray', desc: 'Grafita o ar com o spray quando o combo sobe.' },
        { id: 'iris', name: 'Iris 8-bit', img: 'assets/px-iris.webp', price: 80, cor: '#f472b6', fx: 'coracao', desc: 'Manda corações a cada sequência boa.' },
        { id: 'echo', name: 'Echo 8-bit', img: 'assets/px-echo.webp', price: 80, cor: '#a78bfa', fx: 'dados', desc: 'Analisa tudo: dados e porcentagens voando.' }
    ];
    const BY = Object.fromEntries(LIST.map(x => [x.id, x]));
    const IMG = {};
    function carrega(key, src) {
        if (!IMG[key]) { const i = new Image(); i.decoding = 'async'; i.src = src; IMG[key] = i; }
        return IMG[key].complete && IMG[key].naturalWidth ? IMG[key] : null;
    }
    function img(id) { const it = BY[id]; return it ? carrega(id, it.img) : null; }

    // ---------- sprites (folhas com todos os quadros lado a lado, mesma base/âncora) ----------
    // w/h = tamanho de cada quadro · ax = x do centro do corpo · base = altura "em pé"
    // face = pra onde a personagem olha no desenho (1 direita, -1 esquerda)
    // anim: f = quadros, fps, one = toca uma vez e volta
    const SPR = {
        arya: { src: 'assets/pxs-arya.webp', n: 12, w: 200, h: 345, ax: 101, base: 300, face: 1, air: 4,
            anim: { idle: { f: [10], fps: 1 }, hype: { f: [0, 1, 2, 3, 6, 7, 8], fps: 13, corre: 1 },
                hit: { f: [5, 11, 10], fps: 12, one: 1 }, marco: { f: [9, 9, 10, 9, 9, 10], fps: 6, one: 1 },
                brk: { f: [5, 5, 11], fps: 3, one: 1 }, extra: [{ f: [11, 5, 5, 11, 10], fps: 6, one: 1 }, { f: [9, 10, 9, 10], fps: 5, one: 1 }] } },
        jade: { src: 'assets/pxs-jade.webp', n: 24, w: 249, h: 314, ax: 133, base: 300, face: -1, air: 19,
            anim: { idle: { f: [0, 1, 0, 7], fps: 1.6 }, hype: { f: [4, 5, 6, 5], fps: 4 },
                hit: { f: [9, 10, 9, 10], fps: 12, one: 1 }, marco: { f: [9, 10, 11, 12, 13, 14, 13, 14, 13, 15], fps: 8, one: 1, spray: 4 },
                brk: { f: [21, 21, 21, 16], fps: 3, one: 1 },
                extra: [{ f: [20, 22, 23, 22, 23, 20], fps: 3, one: 1 }, { f: [2, 3, 2, 3, 0], fps: 4, one: 1 }, { f: [17, 18, 17, 18, 0], fps: 5, one: 1 }, { f: [9, 10, 11, 12, 13, 14, 15], fps: 8, one: 1, spray: 4 }] } },
        iris: { src: 'assets/pxs-iris.webp', n: 6, w: 220, h: 306, ax: 103, base: 300, face: 1, air: 0,
            anim: { idle: { f: [1], fps: 1 }, hype: { f: [2, 3, 4, 5, 4, 3], fps: 7 },
                hit: { f: [0, 0, 1], fps: 8, one: 1 }, marco: { f: [0, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5], fps: 8, one: 1 },
                brk: { f: [1], fps: 1, one: 1 }, extra: [{ f: [2, 3, 4, 5, 4, 3, 2, 1], fps: 7, one: 1 }, { f: [0, 0, 0, 1], fps: 3, one: 1 }] } },
        echo: { src: 'assets/pxs-echo.webp', n: 8, w: 267, h: 314, ax: 135, base: 300, face: 1, air: 1,
            anim: { idle: { f: [0, 2, 3, 0], fps: 1.5 }, hype: { f: [0, 2, 3, 4, 5, 6, 7], fps: 9 },
                hit: { f: [4, 5, 6, 7], fps: 14, one: 1 }, marco: { f: [1, 1, 1, 0, 4, 5, 6, 7], fps: 6, one: 1 },
                brk: { f: [1, 1, 1], fps: 2, one: 1 }, extra: [{ f: [1, 1, 1, 0], fps: 2, one: 1 }, { f: [4, 5, 6, 7, 4, 5, 6, 7], fps: 10, one: 1 }] } }
    };
    function folha(id) { const s = SPR[id]; return s ? carrega('spr_' + id, s.src) : null; }
    LIST.forEach(x => { img(x.id); folha(x.id); }); // pré-carrega

    const SPRAY = ['#ff3fb4', '#39ff88', '#ff8a1f', '#b26bff', '#22d3ee'];
    function novoEstado() { return { L: lado(), R: lado(), parts: [], last: 0, combo: 0, brk: 0 }; }
    function lado() { return { y: 0, vy: 0, shake: 0, rot: 0, emote: null, emoteT: 0, tint: 0, one: null, t: 0, x: 0, dir: 1, extraT: 3 + Math.random() * 4 }; }
    function tocar(s, a) { if (a) s.one = { a, t: 0 }; }

    // eventos: { hit: n, brk: bool, marco: combo|0, combo?: n }
    function reagir(S, ev, chars) {
        if (ev.combo != null) S.combo = ev.combo; else if (ev.brk) S.combo = 0; else S.combo = (S.combo || 0) + (ev.hit || 0);
        ['L', 'R'].forEach(k => {
            const s = S[k], sp = SPR[chars && chars[k]];
            if (ev.brk) { s.shake = 1; s.tint = 1; s.emote = '!!'; s.emoteT = 0.9; s.vy = 0; s.rot = 0; if (sp) tocar(s, sp.anim.brk); }
            else if (ev.marco) {
                s.emote = ev.marco + '!'; s.emoteT = 1.3;
                if (ev.marco % 100 === 0) { s.vy = -520; s.rot = 1; }           // a cada 100: cambalhota
                else { s.vy = -380; if (sp) tocar(s, sp.anim.marco); }          // a cada 50: o golpe especial de cada uma
            }
            else if (ev.hit) {
                if (s.y >= -1 && Math.random() < 0.5) s.vy = -170 - Math.random() * 90;
                else if (sp && !s.one && Math.random() < 0.25) tocar(s, sp.anim.hit);
            }
        });
        if (ev.marco || (ev.hit && Math.random() < 0.08)) ['L', 'R'].forEach(k => { if (chars[k]) S.pend = (S.pend || []).concat([{ k, n: ev.marco ? 9 : 1 }]); });
    }
    function soltar(S, fx, x, y, n, esc, ang, abre) {
        for (let i = 0; i < n; i++) {
            const a = (ang == null ? -Math.PI / 2 : ang) + (Math.random() - 0.5) * (abre || 1.6);
            const v = (90 + Math.random() * 140) * esc * (ang == null ? 1 : 1.6);
            S.parts.push({ fx, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, dec: 0.55 + Math.random() * 0.5, s: (6 + Math.random() * 7) * esc, c: SPRAY[(Math.random() * SPRAY.length) | 0], t: fx === 'dados' ? ['%', '▲', '01', '+1', '≈'][(Math.random() * 5) | 0] : '' });
        }
    }
    function desenharPart(g, p, dt) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.fx === 'spray' ? 60 : -30) * dt; p.vx *= 0.98; p.life -= p.dec * dt;
        if (p.life <= 0) return false;
        g.globalAlpha = Math.min(1, p.life * 1.4);
        if (p.fx === 'spray') { g.fillStyle = p.c; const q = Math.max(2, Math.round(p.s / 3)); g.fillRect(Math.round(p.x), Math.round(p.y), q, q); g.fillRect(Math.round(p.x + q * 1.4), Math.round(p.y - q), q, q); }
        else {
            g.font = `900 ${Math.round(p.s * 1.8)}px Rajdhani, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillStyle = p.fx === 'coracao' ? '#f472b6' : p.fx === 'nota' ? '#67e8f9' : '#c4b5fd';
            g.fillText(p.fx === 'coracao' ? '♥' : p.fx === 'nota' ? (Math.random() < 0.5 ? '♪' : '♫') : p.t, p.x, p.y);
        }
        return true;
    }

    // qual quadro mostrar agora (e avança as animações)
    function quadro(s, sp, dt, hype, k, b, sc) {
        s.t += dt;
        const A = sp.anim;
        if (s.one) {
            const o = s.one, a = o.a; o.t += dt;
            const i = Math.floor(o.t * a.fps);
            if (i < a.f.length) return { f: a.f[i], a };
            s.one = null;
        }
        if (s.y < -6 && s.rot < 0.02) return { f: sp.air };
        // sem nada acontecendo por um tempo: um movimento "à toa" (pose, fone de gatinho, aceno…)
        s.extraT -= dt;
        if (s.extraT <= 0 && !hype) { s.extraT = 4 + Math.random() * 6; const ex = A.extra; tocar(s, ex[(Math.random() * ex.length) | 0]); return quadro(s, sp, 0, hype, k, b, sc); }
        const a = hype ? A.hype : A.idle;
        if (a.corre) { // corre de um lado pro outro no espaço dela
            const lim = Math.max(0, b.w * 0.55);
            s.x += s.dir * dt * 95 * sc; if (s.x > lim) { s.x = lim; s.dir = -1; } else if (s.x < -lim) { s.x = -lim; s.dir = 1; }
        } else s.x *= Math.max(0, 1 - dt * 4);
        return { f: a.f[Math.floor(s.t * a.fps) % a.f.length], a };
    }

    // desenha a torcida. chars = { L: id|'' , R: id|'' } · box = área de cada lado { L:{x,y,w,h}, R:{...} } (h = altura do chão)
    // lado L fica à esquerda da gear (olha pra direita), R à direita (olha pra esquerda)
    function desenhar(g, S, chars, box, ts, pulse) {
        const dt = S.last ? Math.min(0.05, (ts - S.last) / 1000) : 0.016; S.last = ts;
        const hype = (S.combo || 0) >= 100;
        g.save();
        g.imageSmoothingEnabled = false;
        ['L', 'R'].forEach(k => {
            const id = chars[k], b = box[k];
            if (!id || !b) return;
            const sp = SPR[id], fo = sp && folha(id);
            const im = fo ? null : img(id); if (!fo && !im) return;
            const s = S[k];
            // física do pulo
            s.vy += 1500 * dt; s.y = Math.min(0, s.y + s.vy * dt); if (s.y === 0 && s.vy > 0) s.vy = 0;
            s.shake = Math.max(0, s.shake - dt * 2.2); s.tint = Math.max(0, s.tint - dt * 1.6); s.rot = Math.max(0, s.rot - dt * 1.6); s.emoteT = Math.max(0, s.emoteT - dt);
            const hh = Math.min(b.h, fo ? b.h : b.w * im.naturalHeight / im.naturalWidth);
            const k1 = fo ? hh / sp.base : hh / im.naturalHeight;    // px na tela por px do sprite
            const ww = fo ? sp.base * 0.62 * k1 : hh * im.naturalWidth / im.naturalHeight;
            const sc = hh / 160; // escala dos efeitos
            const Q = fo ? quadro(s, sp, dt, hype, k, b, sc) : null;
            const bob = pulse * hh * 0.025;
            const squash = 1 - pulse * 0.04 + (s.y < -2 ? 0.03 : 0);
            const cx = b.x + b.w / 2 + s.x + (s.shake ? Math.sin(ts * 0.09) * s.shake * ww * 0.06 : 0);
            const base = b.y + b.h;
            // pra onde olha: correndo = pra onde vai; senão, pra gear
            const quer = Q && Q.a && Q.a.corre ? s.dir : (k === 'L' ? 1 : -1);
            const vira = fo && sp.face !== quer;
            g.save();
            g.translate(cx, base + s.y * sc);
            if (s.rot > 0.02) { g.translate(0, -hh / 2); g.rotate((1 - s.rot) * Math.PI * 2 * (k === 'L' ? -1 : 1)); g.translate(0, hh / 2); } // cambalhota em volta do meio do corpo
            g.scale(1 / squash < 1.2 ? 1 + (1 - squash) * 0.6 : 1, squash);
            // sombra
            g.globalAlpha = 0.35; g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, -2, ww * 0.32, ww * 0.06, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
            if (fo) {
                if (vira) g.scale(-1, 1);
                const dw = Math.round(sp.w * k1), dh = Math.round(sp.h * k1);
                g.drawImage(fo, Q.f * sp.w, 0, sp.w, sp.h, Math.round(-sp.ax * k1), Math.round(-dh - bob), dw, dh);
                if (s.tint) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = s.tint * 0.5; g.fillStyle = '#ef4444'; g.fillRect(-sp.ax * k1, -dh - bob, dw, dh); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
            } else {
                g.drawImage(im, Math.round(-ww / 2), Math.round(-hh - bob), Math.round(ww), Math.round(hh));
                if (s.tint) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = s.tint * 0.5; g.fillStyle = '#ef4444'; g.fillRect(-ww / 2, -hh - bob, ww, hh); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
            }
            g.restore();
            // jato de spray da Jade no golpe especial (sai da lata, na direção da gear)
            if (Q && Q.a && Q.a.spray && s.one && Math.floor(s.one.t * Q.a.fps) >= Q.a.spray) {
                const dx = (k === 'L' ? 1 : -1);
                if (Math.random() < 0.7) soltar(S, 'spray', cx + dx * ww * 0.42, base - hh * 0.55 + s.y * sc, 3, Math.max(0.5, sc), dx > 0 ? -0.25 : Math.PI + 0.25, 0.7);
            }
            // no embalo (100+): Echo e Iris soltam efeitos de vez em quando
            if (hype && Math.random() < dt * 1.2) S.pend = (S.pend || []).concat([{ k, n: 1 }]);
            // balão de emoção (pixelado)
            if (s.emoteT > 0 && s.emote) {
                const t = s.emote, fs = Math.max(12, Math.round(hh * 0.11));
                g.font = `900 ${fs}px Orbitron, monospace`;
                const tw = g.measureText(t).width + fs;
                const bx = Math.round(cx - tw / 2), by = Math.round(base - hh - fs * 2.1 + s.y * sc * 0.5);
                g.globalAlpha = Math.min(1, s.emoteT * 3);
                g.fillStyle = s.emote === '!!' ? '#ef4444' : BY[id].cor; g.fillRect(bx - 3, by - 3, tw + 6, fs * 1.5 + 6);
                g.fillStyle = '#0b1022'; g.fillRect(bx, by, tw, fs * 1.5);
                g.fillStyle = s.emote === '!!' ? '#fecaca' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
                g.fillText(t, bx + tw / 2, by + fs * 0.78);
                g.globalAlpha = 1;
            }
            // efeitos pendentes deste lado
            (S.pend || []).filter(p => p.k === k).forEach(p => soltar(S, BY[id].fx, cx + (BY[id].fx === 'spray' ? (k === 'L' ? 1 : -1) * ww * 0.4 : 0), base - hh * 0.62, p.n, Math.max(0.5, sc)));
        });
        S.pend = [];
        let j = 0; const P = S.parts;
        for (let i = 0; i < P.length; i++) if (desenharPart(g, P[i], dt)) P[j++] = P[i];
        P.length = j;
        if (P.length > 160) P.splice(0, P.length - 160);
        g.restore();
    }

    // ---------- vitrine (Loja): a personagem sozinha num canvas, fazendo o "show" completo ----------
    function vitrine(cv, id) {
        if (!cv || !SPR[id]) return;
        const S = novoEstado(), ch = { L: id, R: '' };
        let t0 = 0, prox = 0, n = 0;
        function loop(ts) {
            if (!cv.isConnected) return;
            requestAnimationFrame(loop);
            const r = cv.getBoundingClientRect(); if (!r.width) return;
            const w = Math.round(r.width), h = Math.round(r.height);
            if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
            if (!t0) t0 = ts;
            const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
            if (ts > prox) { // simula uma partida: acertos, 50, 100 (embalo), e às vezes um BREAK
                prox = ts + 260; n++;
                const c = n % 170;
                if (c === 0) reagir(S, { brk: true, combo: 0 }, ch);
                else reagir(S, { hit: 1, combo: c, marco: c % 50 === 0 ? c : 0 }, ch);
            }
            const bh = h * 0.86, bw = bh * 0.62;
            const beats = ts / 500, pulse = Math.exp(-(beats - Math.floor(beats)) * 6);
            desenhar(g, S, ch, { L: { x: (w - bw) / 2, y: h * 0.96 - bh, w: bw, h: bh } }, ts, pulse);
        }
        requestAnimationFrame(loop);
    }
    // liga as vitrines da Loja quando ela abre (cada uma para sozinha quando a Loja fecha)
    setInterval(() => {
        const host = document.getElementById('bc-ov'); if (!host) return;
        host.querySelectorAll('canvas[data-torc]:not(.on)').forEach(cv => { if (folha(cv.dataset.torc)) { cv.classList.add('on'); vitrine(cv, cv.dataset.torc); } });
    }, 300);

    // ---------- no jogo ----------
    const G = { cv: null, g: null, S: novoEstado(), combo: 0, brk: 0, run: false };
    function quem() { return typeof window.bmTorcida === 'function' ? window.bmTorcida() : { L: '', R: '' }; }
    function frame(ts) {
        requestAnimationFrame(frame);
        const playing = typeof isPlaying !== 'undefined' && isPlaying;
        const ch = quem();
        if (!playing || (!ch.L && !ch.R)) { if (G.cv) G.cv.style.display = 'none'; G.run = false; return; }
        const box = document.getElementById('game-container');
        if (!box) return;
        if (!G.cv) {
            G.cv = document.createElement('canvas'); G.cv.id = 'torcida-layer';
            G.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
            box.appendChild(G.cv);
        }
        if (!G.run) { G.run = true; G.S = novoEstado(); G.combo = 0; G.brk = 0; }
        const cv = G.cv; cv.style.display = '';
        const rc = typeof gearRectsCached === 'function' ? gearRectsCached(ts) : null;
        const br = rc ? rc.box : box.getBoundingClientRect();
        const gc = document.getElementById('gameCanvas');
        const gr = rc ? rc.gear : gc && gc.getBoundingClientRect();
        if (!gr) return;
        const w = Math.round(br.width), h = Math.round(br.height);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        const g = G.g || (G.g = cv.getContext('2d'));
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
        // eventos da partida (só lê os números do jogo)
        const st = typeof stats !== 'undefined' ? stats : null;
        const ev = { hit: 0, brk: false, marco: 0 };
        if (st) {
            const c = st.combo || 0, b = (st.judgments && st.judgments.break) || 0;
            if (b > G.brk) ev.brk = true;
            else if (c > G.combo) { ev.hit = c - G.combo; const m = Math.floor(c / 50) * 50; if (m >= 50 && m > Math.floor(G.combo / 50) * 50) ev.marco = m; }
            G.combo = c; G.brk = b;
        }
        if (ev.hit || ev.brk || ev.marco) { ev.combo = G.combo; reagir(G.S, ev, ch); }
        G.S.combo = G.combo;
        const gx = gr.left - br.left, gy = gr.top - br.top;
        const ladoW = Math.min(gx, br.width - (gx + gr.width));
        const bw = Math.max(50, Math.min(ladoW * 0.62, gr.height * 0.17));
        const bh = bw / 0.62;
        const fy = gy + gr.height * 0.98 - bh;
        const pad = Math.max(10, ladoW * 0.08);
        const caixa = { L: { x: gx - pad - bw, y: fy, w: bw, h: bh }, R: { x: gx + gr.width + pad, y: fy, w: bw, h: bh } };
        const b = typeof palcoBeatInfo === 'function' ? palcoBeatInfo() : { pulse: 0 };
        desenhar(g, G.S, ch, caixa, ts, b.pulse || 0);
    }
    requestAnimationFrame(frame);

    window.TORCIDA_API = { LIST, BY, SPR, img, novoEstado, reagir, desenhar, vitrine };
})();
