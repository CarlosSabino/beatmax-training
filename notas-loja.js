// =====================================================================================
// notas-loja.js — SKINS DE NOTAS EXCLUSIVAS (compradas na Loja com Beatcoins).
//
//   Seatus      : círculos com anel de marcações girando; anéis duplos + varredura no acerto
//   Neon Tube   : tubos de neon com núcleo branco; faíscas elétricas no acerto
//   Cristal     : gemas lapidadas; estilhaços de cristal no acerto
//   Pixel 8-bit : blocos pixelados retrô; explosão de pixels e "+1" no acerto
//   Chama       : notas em brasa com rastro de fogo; labareda no acerto
//   Vinil       : discos girando com sulcos; onda sonora no acerto
//
// Cada uma muda: a nota (drawNote → também vira textura do WebGL), o hold (drawHoldNote), a
// nota da Gear 3D (drawGameHighwayGem) e o efeito de acerto (camada própria por cima da gear).
// Seatus e Chama também trocam as cores das lanes; as outras usam as cores da gear.
// =====================================================================================
(function () {
    const TAU = Math.PI * 2;
    const ITEMS = [
        { id: 'seatus', name: 'Seatus', price: 120, desc: 'Círculos com anel de marcações girando. Anéis duplos e linha de varredura ao acertar. Laterais ciano, centro rosa.' },
        { id: 'neon', name: 'Neon Tube', price: 80, desc: 'Tubos de neon com núcleo branco. Faíscas elétricas ao acertar.' },
        { id: 'cristal', name: 'Cristal', price: 100, desc: 'Gemas lapidadas que refletem a luz. Estilhaços de cristal voam no acerto.' },
        { id: 'pixel', name: 'Pixel 8-bit', price: 60, desc: 'Blocos pixelados com sombreado retrô. Explosão de pixels e "+1" no acerto.' },
        { id: 'chama', name: 'Chama', price: 90, desc: 'Notas em brasa com rastro de fogo. Labareda sobe da linha ao acertar.' },
        { id: 'vinil', name: 'Vinil', price: 110, desc: 'Discos girando com sulcos. Onda sonora se espalha pela gear no acerto.' },
        { id: 'moeda', name: 'Moedinhas', price: 150, desc: 'Moedas pixeladas de ouro e prata. A cada acerto, várias moedinhas pulam girando da linha.' }
    ];
    const SHAPE = (id) => 'sk_' + id;
    const isSk = (s) => typeof s === 'string' && s.startsWith('sk_');
    const PAL = {
        sk_seatus: { edge: '#22d3ee', altA: '#f472b6', altB: '#67e8f9', center: '#e879f9' },
        sk_chama: { edge: '#fb923c', altA: '#facc15', altB: '#f97316', center: '#fde047' },
        sk_moeda: { edge: '#e2e8f0', altA: '#facc15', altB: '#cbd5e1', center: '#fbbf24' }
    };
    // ---------- moedinha em pixel art (desenhada aqui mesmo, 16×16) ----------
    const coinCache = {};
    function isGold(c) {
        const m = String(c || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
        if (!m) return true;
        const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
        return r > 170 && b < 140 && r - b > 70;
    }
    function coinSprite(gold) {
        const k = gold ? 'g' : 's';
        if (coinCache[k]) return coinCache[k];
        const N = 16, cv = document.createElement('canvas'); cv.width = cv.height = N;
        const g = cv.getContext('2d');
        const P = gold ? { o: '#6b3a05', d: '#b7791f', m: '#facc15', l: '#fde68a', w: '#fffbeb', r: '#d69e2e' }
                       : { o: '#374151', d: '#9ca3af', m: '#d1d5db', l: '#f3f4f6', w: '#ffffff', r: '#a3aab5' };
        const c = 7.5;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const dx = x - c, dy = y - c, d = Math.sqrt(dx * dx + dy * dy);
            let col = null;
            if (d <= 7.6) col = P.o;
            if (d <= 6.6) {
                const lit = (-dx - dy) / 9;                // luz de cima/esquerda
                col = lit > 0.45 ? P.l : lit > -0.25 ? P.m : P.d;
                if (d > 4.3 && d <= 5.2) col = P.r;        // aro interno
                if (d <= 4.3) col = lit > 0.2 ? P.m : P.d;
                if (d <= 4.3 && Math.abs(dx + 0.5) < 1 && Math.abs(dy) < 3) col = lit > -0.2 ? P.l : P.m; // risco no meio
            }
            if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
        }
        g.fillStyle = P.w; g.fillRect(4, 4, 2, 1); g.fillRect(4, 5, 1, 1); // brilho
        return (coinCache[k] = cv);
    }
    function drawCoin(g, x, y, r, gold, spin) {
        const sp = coinSprite(gold), sx = spin == null ? 1 : Math.max(0.12, Math.abs(spin));
        g.save(); g.imageSmoothingEnabled = false;
        g.translate(x, y); g.scale(sx, 1);
        g.drawImage(sp, -r, -r, r * 2, r * 2);
        g.restore();
    }
    window.notaLojaMoeda = drawCoin;

    // ---------- cores das lanes (Seatus / Chama) ----------
    if (typeof window.getKeyColorScheme === 'function') {
        const orig = window.getKeyColorScheme;
        window.getKeyColorScheme = function (mode, skin) {
            const out = orig.apply(this, arguments);
            const P = typeof noteShape !== 'undefined' && PAL[noteShape];
            if (!P || !Array.isArray(out)) return out;
            const p = (typeof SKIN_PALETTES !== 'undefined' && (SKIN_PALETTES[skin] || SKIN_PALETTES.cyan)) || {};
            return out.map(c => c === p.edge ? P.edge : c === p.altA ? P.altA : c === p.altB ? P.altB : c === p.center ? P.center : c);
        };
    }

    const shade = (c, a) => typeof shadeColor === 'function' ? shadeColor(c, a) : c;
    // cor com transparência (aceita #rgb, #rrggbb e rgb()/rgba())
    function alpha(c, a) {
        c = String(c || '#fff').trim();
        let r = 255, g = 255, b = 255;
        if (c[0] === '#') {
            let h = c.slice(1); if (h.length === 3) h = h.split('').map(x => x + x).join('');
            r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
        } else { const m = c.match(/[\d.]+/g); if (m && m.length >= 3) { r = +m[0]; g = +m[1]; b = +m[2]; } }
        return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
    }
    const glow = (g, c, b) => { g.shadowColor = c; g.shadowBlur = b; };

    // ---------- desenho das notas (em g, centro x/y, largura da lane w, altura base nh) ----------
    const DRAW = {
        seatus(g, x, y, w, nh, c, t) {
            const r = Math.min(w / 2 - 2, nh * 0.9) * 0.74;
            const gr = g.createRadialGradient(x, y, 0, x, y, r);
            gr.addColorStop(0, '#fff'); gr.addColorStop(0.38, '#fff'); gr.addColorStop(0.6, c); gr.addColorStop(1, shade(c, -0.3));
            glow(g, c, 16); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
            g.shadowBlur = 6; g.strokeStyle = c; g.lineWidth = Math.max(2, r * 0.12); g.beginPath(); g.arc(x, y, r * 0.98, 0, TAU); g.stroke();
            g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, r * 0.08); g.lineCap = 'round';
            const rot = t / 700;
            for (let k = 0; k < 12; k++) {
                const a = rot + k * Math.PI / 6, r1 = r * 1.14, r2 = r * (k % 3 === 0 ? 1.38 : 1.26);
                g.beginPath(); g.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); g.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2); g.stroke();
            }
        },
        neon(g, x, y, w, nh, c) {
            const half = w * 0.4, lw = Math.max(5, nh * 0.32);
            g.lineCap = 'round';
            glow(g, c, 22); g.strokeStyle = c; g.lineWidth = lw;
            g.beginPath(); g.moveTo(x - half + lw / 2, y); g.lineTo(x + half - lw / 2, y); g.stroke();
            g.shadowBlur = 6; g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, lw * 0.36);
            g.beginPath(); g.moveTo(x - half + lw / 2, y); g.lineTo(x + half - lw / 2, y); g.stroke();
        },
        cristal(g, x, y, w, nh, c) {
            const hw = w * 0.42, h = Math.max(8, nh * 0.42);
            const pts = [[x - hw, y], [x - hw * 0.62, y - h], [x + hw * 0.62, y - h], [x + hw, y], [x + hw * 0.62, y + h], [x - hw * 0.62, y + h]];
            const gr = g.createLinearGradient(x - hw, y - h, x + hw, y + h);
            gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, c); gr.addColorStop(0.7, shade(c, -0.45)); gr.addColorStop(1, '#fff');
            glow(g, c, 14); g.fillStyle = gr; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
            g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.3; g.stroke();
            g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1;
            g.beginPath();
            g.moveTo(x - hw * 0.62, y - h); g.lineTo(x - hw * 0.22, y); g.lineTo(x + hw * 0.22, y); g.lineTo(x + hw * 0.62, y - h);
            g.moveTo(x - hw, y); g.lineTo(x - hw * 0.22, y); g.moveTo(x + hw, y); g.lineTo(x + hw * 0.22, y);
            g.moveTo(x - hw * 0.22, y); g.lineTo(x - hw * 0.62, y + h); g.moveTo(x + hw * 0.22, y); g.lineTo(x + hw * 0.62, y + h);
            g.stroke();
            g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.arc(x - hw * 0.45, y - h * 0.45, Math.max(1.5, h * 0.14), 0, TAU); g.fill();
        },
        pixel(g, x, y, w, nh, c) {
            const P = Math.max(3, Math.round(w / 15));
            const cols = Math.max(4, Math.floor(w * 0.84 / P)), rows = Math.max(3, Math.round(nh * 0.62 / P));
            const x0 = Math.round(x - cols * P / 2), y0 = Math.round(y - rows * P / 2);
            g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x0 + P, y0 + P, cols * P, rows * P);
            g.fillStyle = c; g.fillRect(x0, y0, cols * P, rows * P);
            g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x0, y0, cols * P, P); g.fillRect(x0, y0, P, rows * P);
            g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x0, y0 + (rows - 1) * P, cols * P, P); g.fillRect(x0 + (cols - 1) * P, y0, P, rows * P);
            g.fillStyle = 'rgba(0,0,0,.18)';
            for (let i = 1; i < cols - 1; i += 2) g.fillRect(x0 + i * P, y0 + (rows - 2) * P, P, P);
        },
        chama(g, x, y, w, nh, c) {
            const len = Math.min(nh * 1.5, nh + 22), bw = w * 0.4;
            const fg = g.createLinearGradient(0, y - len, 0, y);
            fg.addColorStop(0, 'rgba(239,68,68,0)'); fg.addColorStop(0.55, 'rgba(249,115,22,.55)'); fg.addColorStop(1, 'rgba(253,224,71,.9)');
            g.fillStyle = fg; g.beginPath();
            g.moveTo(x - bw * 0.9, y);
            g.quadraticCurveTo(x - bw * 0.75, y - len * 0.5, x - bw * 0.2, y - len);
            g.quadraticCurveTo(x, y - len * 0.6, x + bw * 0.25, y - len * 0.85);
            g.quadraticCurveTo(x + bw * 0.8, y - len * 0.4, x + bw * 0.9, y);
            g.closePath(); g.fill();
            const h = Math.max(7, nh * 0.36);
            const gr = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
            gr.addColorStop(0, '#fef3c7'); gr.addColorStop(0.5, c); gr.addColorStop(1, '#9a3412');
            glow(g, '#f97316', 18); g.fillStyle = gr; g.beginPath();
            if (g.roundRect) g.roundRect(x - bw, y - h / 2, bw * 2, h, h / 2); else g.rect(x - bw, y - h / 2, bw * 2, h);
            g.fill();
        },
        moeda(g, x, y, w, nh, c) {
            const r = Math.min(w / 2 - 3, nh * 0.95);
            const gold = isGold(c);
            g.shadowColor = gold ? 'rgba(250,204,21,.7)' : 'rgba(226,232,240,.55)'; g.shadowBlur = 10;
            drawCoin(g, x, y, r, gold);
        },
        vinil(g, x, y, w, nh, c, t) {
            const r = Math.min(w / 2 - 3, nh * 0.95);
            glow(g, c, 10); g.fillStyle = '#0b0b0f'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.shadowBlur = 0;
            g.strokeStyle = 'rgba(255,255,255,.13)'; g.lineWidth = 1;
            for (let k = r * 0.48; k < r - 1; k += Math.max(2, r / 9)) { g.beginPath(); g.arc(x, y, k, 0, TAU); g.stroke(); }
            const rot = t / 260;
            g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = Math.max(1.5, r * 0.07);
            g.beginPath(); g.arc(x, y, r * 0.8, rot, rot + 0.8); g.stroke();
            g.beginPath(); g.arc(x, y, r * 0.8, rot + Math.PI, rot + Math.PI + 0.8); g.stroke();
            g.fillStyle = c; g.beginPath(); g.arc(x, y, r * 0.38, 0, TAU); g.fill();
            g.fillStyle = '#0b0b0f'; g.beginPath(); g.arc(x, y, Math.max(1.5, r * 0.07), 0, TAU); g.fill();
            g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
        }
    };
    function drawSkinNote(g, shape, x, y, w, nh, c, t) {
        const f = DRAW[shape.slice(3)];
        if (!f) return false;
        g.save(); f(g, x, y, w, nh, c, t == null ? 0 : t); g.restore();
        return true;
    }
    window.notaLojaDraw = drawSkinNote;

    // drawNote (2D e textura do WebGL)
    if (typeof window.drawNote === 'function') {
        const orig = window.drawNote;
        window.drawNote = function (lane, noteY, column, noteHeight) {
            if (!isSk(noteShape)) return orig.apply(this, arguments);
            const color = getKeyColorScheme(currentMode, gearSkin)[lane];
            // no WebGL a textura é "assada" parada (a GPU gira Seatus/Vinil); no 2D anima aqui
            const t = typeof noteAnimClockOverride === 'number' ? noteAnimClockOverride : performance.now();
            if (!drawSkinNote(ctx, noteShape, column.x + column.width / 2, noteY, column.width, noteHeight, color, t)) return orig.apply(this, arguments);
        };
    }
    // anel/disco girando no WebGL (mesmo truque do Hex Gem)
    if (typeof GL_ROUND_SKIN_RADIUS !== 'undefined') {
        GL_ROUND_SKIN_RADIUS.sk_seatus = [2, 0.9];
        GL_ROUND_SKIN_RADIUS.sk_vinil = [3, 0.95];
        GL_ROUND_SKIN_RADIUS.sk_moeda = [3, 0.95];
    }

    // Gear 3D: a cabeça da nota
    if (typeof window.drawGameHighwayGem === 'function') {
        const orig = window.drawGameHighwayGem;
        window.drawGameHighwayGem = function (proj, quad, span, z, color, HEAD_DZ, pad, t) {
            if (!isSk(noteShape)) return orig.apply(this, arguments);
            const uc = (span.u0 + span.u1) / 2;
            const cx = proj.xOf(uc, z), cy = proj.yOfZ(z);
            const laneW = proj.xOf(span.u1, z) - proj.xOf(span.u0, z);
            const h = Math.abs(proj.yOfZ(z - HEAD_DZ / 2) - proj.yOfZ(z + HEAD_DZ / 2));
            const round = noteShape === 'sk_seatus' || noteShape === 'sk_vinil' || noteShape === 'sk_moeda';
            ctx.save();
            if (round && proj.tilted) {
                // círculo "deitado" na pista
                const rx = Math.max(4, laneW * 0.4), ry = Math.max(3, Math.min(rx * 0.55, h * 0.75));
                ctx.translate(cx, cy); ctx.scale(1, ry / rx);
                drawSkinNote(ctx, noteShape, 0, 0, laneW, rx / 0.9, color, t);
            } else drawSkinNote(ctx, noteShape, cx, cy, laneW, round ? Math.max(h, laneW * 0.45) : h, color, t);
            ctx.restore();
        };
    }

    // hold
    if (typeof window.drawHoldNote === 'function') {
        const orig = window.drawHoldNote;
        window.drawHoldNote = function (lane, headY, tailY, column, isActive) {
            if (!isSk(noteShape)) return orig.apply(this, arguments);
            const s = noteShape.slice(3);
            const color = getKeyColorScheme(currentMode, gearSkin)[lane];
            const bw = Math.min(column.width - 10, 74), r = bw / 2;
            const xc = column.x + column.width / 2, x = xc - r;
            const top = Math.min(headY, tailY), bottom = Math.max(headY, tailY);
            const height = Math.max(r * 2, bottom - top);
            const g = ctx;
            g.save();
            g.globalAlpha = isActive ? 0.97 : 0.65;
            const cap = (rad) => { g.beginPath(); if (g.roundRect) g.roundRect(x, top, bw, height, rad); else g.rect(x, top, bw, height); };
            const hgrad = (stops) => { const gr = g.createLinearGradient(x, 0, x + bw, 0); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
            if (s === 'seatus') {
                cap(r); g.fillStyle = hgrad([[0, 'rgba(0,0,0,0)'], [0.3, alpha(shade(color, -0.4), 0.33)], [0.5, alpha(color, 0.4)], [0.7, alpha(shade(color, -0.4), 0.33)], [1, 'rgba(0,0,0,0)']]); g.fill();
                glow(g, color, isActive ? 22 : 8); g.fillStyle = '#fff'; g.fillRect(xc - 1.5, top + r * 0.5, 3, height - r);
                g.strokeStyle = color; g.lineWidth = 2; g.stroke();
            } else if (s === 'neon') {
                cap(r); g.fillStyle = 'rgba(2,6,23,.55)'; g.fill();
                glow(g, color, isActive ? 26 : 12); g.strokeStyle = color; g.lineWidth = 4; g.stroke();
                g.shadowBlur = 4; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
            } else if (s === 'cristal') {
                cap(r * 0.5); g.fillStyle = hgrad([[0, alpha(shade(color, -0.5), 0.67)], [0.25, alpha(color, 0.4)], [0.5, 'rgba(255,255,255,.85)'], [0.75, alpha(color, 0.4)], [1, alpha(shade(color, -0.5), 0.67)]]);
                glow(g, color, isActive ? 24 : 6); g.fill(); g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.2; g.stroke();
            } else if (s === 'pixel') {
                const P = Math.max(3, Math.round(column.width / 15));
                g.beginPath(); g.rect(x, top, bw, height);
                g.fillStyle = hgrad([[0, '#ffffffcc'], [P / bw, '#ffffffcc'], [P / bw + 0.001, color], [1 - P / bw - 0.001, color], [1 - P / bw, shade(color, -0.5)], [1, shade(color, -0.5)]]);
                g.fill();
            } else if (s === 'chama') {
                cap(r); g.fillStyle = hgrad([[0, 'rgba(154,52,18,.6)'], [0.3, '#f97316'], [0.5, '#fde68a'], [0.7, '#f97316'], [1, 'rgba(154,52,18,.6)']]);
                glow(g, '#f97316', isActive ? 30 : 10); g.fill();
            } else if (s === 'moeda') {
                // barra de prata pixelada (cantos em degrau)
                const P = Math.max(3, Math.round(bw / 12));
                g.beginPath();
                g.moveTo(x + P * 2, top); g.lineTo(x + bw - P * 2, top); g.lineTo(x + bw - P * 2, top + P); g.lineTo(x + bw - P, top + P); g.lineTo(x + bw - P, top + P * 2); g.lineTo(x + bw, top + P * 2);
                g.lineTo(x + bw, top + height - P * 2); g.lineTo(x + bw - P, top + height - P * 2); g.lineTo(x + bw - P, top + height - P); g.lineTo(x + bw - P * 2, top + height - P); g.lineTo(x + bw - P * 2, top + height);
                g.lineTo(x + P * 2, top + height); g.lineTo(x + P * 2, top + height - P); g.lineTo(x + P, top + height - P); g.lineTo(x + P, top + height - P * 2); g.lineTo(x, top + height - P * 2);
                g.lineTo(x, top + P * 2); g.lineTo(x + P, top + P * 2); g.lineTo(x + P, top + P); g.lineTo(x + P * 2, top + P); g.closePath();
                g.fillStyle = hgrad([[0, '#6b7280'], [0.18, '#e5e7eb'], [0.4, '#ffffff'], [0.62, '#d1d5db'], [0.85, '#9ca3af'], [1, '#4b5563']]);
                glow(g, '#e2e8f0', isActive ? 22 : 6); g.fill(); g.shadowBlur = 0;
                g.strokeStyle = '#374151'; g.lineWidth = 1.5; g.stroke();
            } else if (s === 'vinil') {
                cap(r); g.fillStyle = hgrad([[0, '#0b0b0f'], [0.4, '#1f2937'], [0.5, color], [0.6, '#1f2937'], [1, '#0b0b0f']]);
                glow(g, color, isActive ? 22 : 6); g.fill(); g.shadowBlur = 0; g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();
            } else { g.restore(); return orig.apply(this, arguments); }
            g.restore();
        };
    }

    // ---------- efeitos de acerto ----------
    const rand = (a, b) => a + Math.random() * (b - a);
    const HIT = {
        moeda: {
            spawn(P, x, y, w, c, big) {
                const gold = true;
                P.push({ k: 'flash', x, y, w, life: 1, dec: 4 });
                P.push({ k: 'ring', x, y, w, life: 1, dec: 3 });
                const n = big ? 7 : 5;
                for (let i = 0; i < n; i++) {
                    const a = -Math.PI / 2 + rand(-0.75, 0.75);
                    const v = rand(2.6, 4.0) * w;                  // pulam alto e caem devagar
                    P.push({ k: 'coin', x: x + rand(-0.25, 0.25) * w, y, vx: Math.cos(a) * v * 0.55, vy: Math.sin(a) * v, r: rand(0.13, 0.19) * w, ph: rand(0, 6.3), sp: rand(7, 12), gold: i % 4 !== 3 || !gold, life: 1, dec: rand(0.7, 0.95), g: w * 3.4 });
                }
            },
            draw(g, p, dt) {
                if (p.k === 'flash') {
                    const k = 1 - p.life, L = p.w * (0.55 + 0.6 * k);
                    g.globalAlpha = p.life; glow(g, '#fde047', 18); g.fillStyle = '#fffbeb';
                    g.fillRect(p.x - L, p.y - 2, L * 2, 4); g.fillRect(p.x - 2, p.y - L * 0.8, 4, L * 1.6);
                    return;
                }
                if (p.k === 'ring') {
                    const k = 1 - p.life;
                    g.globalAlpha = p.life * 0.9; glow(g, '#facc15', 14); g.strokeStyle = '#fde047'; g.lineWidth = 3;
                    g.beginPath(); g.arc(p.x, p.y, p.w * (0.3 + 0.35 * k), 0, TAU); g.stroke();
                    return;
                }
                p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.ph += p.sp * dt;
                g.globalAlpha = Math.min(1, p.life * 1.6);
                g.shadowColor = 'rgba(250,204,21,.6)'; g.shadowBlur = 6;
                drawCoin(g, p.x, p.y, p.r, p.gold, Math.cos(p.ph));
            }
        },
        seatus: {
            spawn(P, x, y, w, c, big) { P.push({ k: 'ring', x, y, w, c, life: 1, dec: 2.6 }); P.push({ k: 'scan', x, y, w, c, life: 1, dec: 3.2 }); },
            draw(g, p) {
                const k = 1 - p.life;
                if (p.k === 'ring') {
                    glow(g, p.c, 16); g.globalAlpha = p.life; g.strokeStyle = '#fff'; g.lineWidth = 3;
                    g.beginPath(); g.arc(p.x, p.y, p.w * (0.35 + 0.35 * k), 0, TAU); g.stroke();
                    g.strokeStyle = p.c; g.lineWidth = 2; g.globalAlpha = p.life * 0.8;
                    const R2 = p.w * (0.5 + 0.55 * k);
                    g.beginPath(); g.arc(p.x, p.y, R2, 0, TAU); g.stroke();
                    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8 + k; g.beginPath(); g.moveTo(p.x + Math.cos(a) * R2 * 1.06, p.y + Math.sin(a) * R2 * 1.06); g.lineTo(p.x + Math.cos(a) * R2 * 1.16, p.y + Math.sin(a) * R2 * 1.16); g.stroke(); }
                } else {
                    const half = p.w * (0.6 + 2.2 * k);
                    const gr = g.createLinearGradient(p.x - half, 0, p.x + half, 0);
                    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, p.c); gr.addColorStop(1, 'rgba(255,255,255,0)');
                    g.globalAlpha = p.life * 0.9; glow(g, p.c, 10); g.fillStyle = gr; g.fillRect(p.x - half, p.y - 1.5, half * 2, 3);
                }
            }
        },
        neon: {
            spawn(P, x, y, w, c, big) {
                P.push({ k: 'col', x, y, w, c, life: 1, dec: 4 });
                for (let i = 0; i < (big ? 6 : 4); i++) {
                    const pts = [[x, y]]; let px = x, py = y; const a = -Math.PI * rand(0.12, 0.88);
                    for (let s = 0; s < 4; s++) { px += Math.cos(a) * w * 0.16 + rand(-1, 1) * w * 0.12; py += Math.sin(a) * w * 0.16 + rand(-1, 1) * w * 0.08; pts.push([px, py]); }
                    P.push({ k: 'zap', pts, c, life: 1, dec: rand(3.5, 6) });
                }
            },
            draw(g, p) {
                if (p.k === 'col') { g.globalAlpha = p.life * 0.25 * (0.6 + 0.4 * Math.random()); g.fillStyle = p.c; g.fillRect(p.x - p.w / 2, p.y - p.w * 3.2, p.w, p.w * 3.2); return; }
                g.globalAlpha = p.life; glow(g, p.c, 12); g.strokeStyle = '#f7fee7'; g.lineWidth = 2; g.lineJoin = 'round';
                g.beginPath(); p.pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.stroke();
            }
        },
        cristal: {
            spawn(P, x, y, w, c, big) {
                P.push({ k: 'arc', x, y, w, life: 1, dec: 3 });
                for (let i = 0; i < (big ? 12 : 8); i++) { const a = -Math.PI * rand(0.05, 0.95), v = rand(1.6, 4.2) * w; P.push({ k: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: rand(0.06, 0.12) * w, c: i % 2 ? '#e0e7ff' : c, rot: rand(0, TAU), life: 1, dec: rand(1.6, 2.6) }); }
            },
            draw(g, p, dt) {
                if (p.k === 'arc') { g.globalAlpha = p.life * 0.8; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, p.w * (0.35 + 0.4 * (1 - p.life)), Math.PI, 0); g.stroke(); return; }
                p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.s * 60 * dt; p.rot += dt * 8;
                g.globalAlpha = p.life; glow(g, p.c, 8); g.fillStyle = p.c;
                g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); g.moveTo(0, -p.s); g.lineTo(p.s * 0.5, 0); g.lineTo(0, p.s); g.lineTo(-p.s * 0.5, 0); g.closePath(); g.fill(); g.restore();
            }
        },
        pixel: {
            spawn(P, x, y, w, c, big) {
                const S = Math.max(3, Math.round(w / 15));
                for (let i = 0; i < (big ? 16 : 10); i++) { const a = -Math.PI * rand(0, 1), v = rand(1, 3.6) * w; P.push({ k: 'px', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, S: S * (i % 3 ? 1 : 2), c: ['#fff', c, '#fde68a', c][i % 4], life: 1, dec: rand(1.8, 3) }); }
                if (big) P.push({ k: 'txt', x, y: y - w * 0.6, w, life: 1, dec: 1.6 });
            },
            draw(g, p, dt) {
                if (p.k === 'txt') { p.y -= p.w * 0.9 * dt; g.globalAlpha = Math.min(1, p.life * 1.5); g.fillStyle = '#fff'; g.font = `bold ${Math.round(p.w * 0.32)}px monospace`; g.textAlign = 'center'; g.fillText('+1', Math.round(p.x), Math.round(p.y)); return; }
                p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.S * 80 * dt;
                g.globalAlpha = p.life > 0.3 ? 1 : p.life / 0.3; g.fillStyle = p.c;
                g.fillRect(Math.round(p.x / p.S) * p.S, Math.round(p.y / p.S) * p.S, p.S, p.S);
            }
        },
        chama: {
            spawn(P, x, y, w, c, big) {
                P.push({ k: 'fire', x, y, w, h: w * (big ? 1.7 : 1.3), life: 1, dec: 2.8, seed: Math.random() * 10 });
                for (let i = 0; i < (big ? 8 : 5); i++) P.push({ k: 'emb', x: x + rand(-0.4, 0.4) * w, y, vx: rand(-0.3, 0.3) * w, vy: -rand(1.5, 3.5) * w, s: rand(1.2, 2.6), life: 1, dec: rand(1, 1.8) });
            },
            draw(g, p, dt, ts) {
                if (p.k === 'emb') { p.x += p.vx * dt; p.y += p.vy * dt; g.globalAlpha = p.life; g.fillStyle = '#fde68a'; glow(g, '#f97316', 6); g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill(); return; }
                const k = 1 - p.life, h = p.h * (0.5 + 0.6 * k), x = p.x, y = p.y, w = p.w, wob = Math.sin(ts / 60 + p.seed) * w * 0.08;
                const gr = g.createLinearGradient(0, y - h, 0, y);
                gr.addColorStop(0, 'rgba(239,68,68,0)'); gr.addColorStop(0.5, 'rgba(249,115,22,.75)'); gr.addColorStop(1, '#fef08a');
                g.globalAlpha = p.life * 0.85; glow(g, '#fb923c', 20); g.fillStyle = gr; g.beginPath();
                g.moveTo(x - w * 0.5, y);
                g.bezierCurveTo(x - w * 0.6, y - h * 0.4, x - w * 0.1 + wob, y - h * 0.55, x - w * 0.12 + wob, y - h);
                g.bezierCurveTo(x + w * 0.2, y - h * 0.7, x + w * 0.05 - wob, y - h * 0.5, x + w * 0.25 - wob, y - h * 0.8);
                g.bezierCurveTo(x + w * 0.6, y - h * 0.45, x + w * 0.5, y - h * 0.2, x + w * 0.5, y);
                g.closePath(); g.fill();
            }
        },
        vinil: {
            spawn(P, x, y, w, c, big) { for (let i = 0; i < (big ? 3 : 2); i++) P.push({ k: 'wave', x, y, w, c, life: 1 + i * 0.25, dec: 1.8 }); },
            draw(g, p) {
                const l = Math.min(1, p.life); if (p.life > 1) return;
                const k = 1 - l;
                g.globalAlpha = l * 0.8; glow(g, p.c, 10); g.strokeStyle = p.c; g.lineWidth = 3;
                g.beginPath(); g.ellipse(p.x, p.y, p.w * (0.4 + 2.4 * k), p.w * (0.15 + 0.8 * k), 0, 0, TAU); g.stroke();
            }
        }
    };
    function stepFx(g, P, dt, ts) {
        let j = 0;
        for (let i = 0; i < P.length; i++) {
            const p = P[i];
            p.life -= (p.dec || 2) * dt;
            if (p.life <= 0) continue;
            g.save();
            if (p.sk === '_flash') { g.globalAlpha = p.life; glow(g, p.c, 14); g.fillStyle = '#fff'; g.fillRect(p.x - p.w / 2, p.y - 3, p.w, 6); g.globalAlpha = p.life * 0.35; g.fillStyle = p.c; g.fillRect(p.x - p.w / 2 + 3, p.y - p.w * 1.2, p.w - 6, p.w * 1.2); }
            else HIT[p.sk].draw(g, p, dt, ts);
            g.restore();
            P[j++] = p;
        }
        P.length = j;
    }
    function spawnFx(P, sk, x, y, w, c, big) {
        const fx = HIT[sk]; if (!fx || !isFinite(x) || !isFinite(y) || !(w > 0)) return;
        const n0 = P.length; fx.spawn(P, x, y, w, c, big);
        for (let i = n0; i < P.length; i++) P[i].sk = sk;
        if (P.length > 260) P.splice(0, P.length - 260);
    }

    // camada no jogo
    const G = { cv: null, g: null, P: [], seen: new WeakSet(), last: 0 };
    function gameFrame(ts) {
        requestAnimationFrame(gameFrame);
        let sk = typeof window.bmHitFxId === 'function' ? window.bmHitFxId() : (typeof noteShape === 'string' && isSk(noteShape) ? noteShape.slice(3) : null);
        if (sk === 'padrao') sk = null;
        const playing = typeof isPlaying !== 'undefined' && isPlaying;
        if (!sk || !HIT[sk] || (!playing && !G.P.length)) { if (G.cv) G.cv.style.display = 'none'; G.last = 0; G.P.length = 0; if (typeof hitFlashes !== 'undefined') hitFlashes.forEach(f => G.seen.add(f)); return; }
        const box = document.getElementById('game-container');
        if (!box) return;
        if (!G.cv) {
            G.cv = document.createElement('canvas');
            G.cv.id = 'notafx-layer';
            G.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
            box.appendChild(G.cv);
        }
        const cv = G.cv; cv.style.display = '';
        const rc = typeof gearRectsCached === 'function' ? gearRectsCached(ts) : null;
        const br = rc ? rc.box : box.getBoundingClientRect();
        const w = Math.round(br.width), h = Math.round(br.height);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        const g = G.g || (G.g = cv.getContext('2d'));
        g.clearRect(0, 0, w, h);
        const gc = typeof palcoGearCanvas === 'function' ? palcoGearCanvas() : document.getElementById('gameCanvas');
        if (!gc) return;
        const gr = rc ? rc.gear : gc.getBoundingClientRect();
        const L = typeof getGearLayout === 'function' ? getGearLayout() : null;
        const tw = (L && L.totalW) || canvas.totalWidth || 580, th = (L && L.totalH) || canvas.totalHeight || 1208;
        const F = L && L.frame ? L.F : 30;
        const sc = gr.width / tw;
        const dt = G.last ? Math.min(0.05, (ts - G.last) / 1000) : 0.016; G.last = ts;
        if (typeof hitFlashes !== 'undefined') for (const f of hitFlashes) {
            if (G.seen.has(f)) continue; G.seen.add(f);
            if (f.wide && f.wide > 140) continue; // SIDE TRACK / faixa larga: fica só com o brilho normal
            const laneW = f.wide || (tw - F * 2) / Math.max(4, (typeof getMainLaneCount === 'function' ? getMainLaneCount(currentMode) : 4));
            spawnFx(G.P, sk, gr.left - br.left + (f.x + F) * sc, gr.top - br.top + f.y * (gr.height / th), laneW * sc, f.color || '#fff', !!f.big);
        }
        stepFx(g, G.P, dt, ts);
    }
    requestAnimationFrame(gameFrame);

    // ---------- prévia animada (Loja) ----------
    function previewFrame(ts) {
        requestAnimationFrame(previewFrame);
        // só procura as miniaturas com a Loja/Personalizar abertos (varrer a página toda a cada quadro pesava)
        const host = document.getElementById('bc-ov') || document.getElementById('col-ov');
        if (!host) return;
        const list = host.querySelectorAll('canvas[data-nota-prev]');
        list.forEach(cv => {
            const shape = cv.dataset.shape || ('sk_' + cv.dataset.notaPrev);
            const sk = cv.dataset.fx || cv.dataset.notaPrev;
            const transp = cv.dataset.transp === '1';
            const g = cv.getContext('2d'), W = cv.width, H = cv.height;
            const st = cv._st || (cv._st = { P: [], last: 0, hitAt: [] });
            const dt = st.last ? Math.min(0.05, (ts - st.last) / 1000) : 0.016; st.last = ts;
            const LX = 12, LN = 4, LW = (W - LX * 2) / LN, JY = H - 30, nh = 18;
            const P = cv.dataset.cores ? null : PAL[shape];
            const cols = P ? [P.edge, P.altA, P.altA, P.edge] : (cv.dataset.cores || '#22d3ee,#e2e8f0,#e2e8f0,#22d3ee').split(',');
            if (transp) g.clearRect(0, 0, W, H);
            else {
                const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0b1020'); bg.addColorStop(1, '#111827');
                g.fillStyle = bg; g.fillRect(0, 0, W, H);
                g.fillStyle = '#1e293b'; g.fillRect(0, 0, LX, H); g.fillRect(W - LX, 0, LX, H);
            }
            for (let i = 1; i < LN; i++) { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(LX + i * LW, 0, 1, H); }
            g.fillStyle = 'rgba(203,213,225,.8)'; g.fillRect(LX, JY - 1, W - LX * 2, 2);
            // notas caindo (padrão fixo de 2 s)
            const T = 2000, speed = (JY + 30) / 900;
            const pat = [[0, 0], [1, 250], [2, 500], [3, 750], [1, 1000], [2, 1250], [0, 1500], [3, 1625], [1, 1750]];
            const now = ts % T;
            g.save(); g.beginPath(); g.rect(LX, 0, W - LX * 2, JY + 14); g.clip();
            // hold na lane 2
            const hs = ((now - 1000 + T) % T), hY = JY - (900 - hs) * speed;
            drawHoldPrev(g, shape, LX + LW * 2 + LW / 2, hY - 70, hY, LW, cols[2], hs > 900 && hs < 1200);
            pat.forEach(([ln, at]) => {
                const dtm = ((at - now + T) % T);
                const y = JY - dtm * speed;
                if (dtm < 900 && y > -30) { if (isSk(shape)) drawSkinNote(g, shape, LX + LW * ln + LW / 2, y, LW, nh, cols[ln], ts); else drawGameNotePrev(g, shape, ln, y, LX + LW * ln, LW, nh, cols[ln]); }
            });
            g.restore();
            pat.forEach(([ln, at], i) => {
                const pass = ((now - at + T) % T) < 40;
                if (pass && !st.hitAt[i]) { st.hitAt[i] = 1; if (sk === 'padrao' || !HIT[sk]) st.P.push({ sk: '_flash', x: LX + LW * ln + LW / 2, y: JY, w: LW, c: cols[ln], life: 1, dec: 5 }); else spawnFx(st.P, sk, LX + LW * ln + LW / 2, JY, LW, cols[ln], i % 3 === 0); }
                else if (!pass) st.hitAt[i] = 0;
            });
            stepFx(g, st.P, dt, ts);
        });
    }
    // nota de skin comum (Clássica, Circle, Hex...) desenhada na miniatura com o desenho do jogo
    function drawGameNotePrev(g, shape, lane, y, x0, LW, nh, c) {
        const saveCtx = ctx, sv = noteShape, cm = window.getKeyColorScheme;
        try {
            ctx = g; noteShape = shape; window.getKeyColorScheme = () => Array(12).fill(c);
            const ov = typeof noteAnimClockOverride !== 'undefined' ? noteAnimClockOverride : null;
            window.drawNote(0, y, { x: x0, width: LW }, nh);
        } catch (e) {} finally { window.getKeyColorScheme = cm; noteShape = sv; ctx = saveCtx; }
    }
    function drawHoldPrev(g, shape, xc, y0, y1, LW, c, active) {
        const saveCtx = ctx;
        try {
            // reaproveita o desenho do hold do jogo apontando o ctx pra miniatura
            ctx = g;
            const sv = noteShape; noteShape = shape;
            const cm = window.getKeyColorScheme; window.getKeyColorScheme = () => [c, c, c, c, c, c, c, c, c, c];
            try { window.drawHoldNote(2, y1, y0, { x: xc - LW / 2, width: LW }, active); } finally { window.getKeyColorScheme = cm; noteShape = sv; }
        } catch (e) {} finally { ctx = saveCtx; }
    }
    requestAnimationFrame(previewFrame);

    window.NOTAS_HIT_IDS = Object.keys(HIT);
    window.NOTAS_FX_API = { spawn: spawnFx, step: stepFx, has: (id) => !!HIT[id] };
    window.NOTAS_LOJA = ITEMS.map(it => Object.assign({ shape: SHAPE(it.id) }, it));
})();
