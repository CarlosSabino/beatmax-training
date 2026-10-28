// =====================================================================================
// skinfx.js — efeitos animados das gears EXCLUSIVAS da loja.
//
//   Aurora Boreal   : cortinas de aurora ondulando nas laterais + cintilações
//   Magma           : paredes (pilares) de lava borbulhando + brasas subindo
//   Oceano Profundo : bolhas subindo e raios de luz ondulando nas laterais
//   Sakura Noturna  : pétalas de cerejeira caindo e girando dos dois lados
//   Ouro Real       : brilhos dourados piscando nos pilares + pó de ouro caindo
//   Vazio Cósmico   : estrelas em órbita, cometas e névoa roxa pulsando
//
// Tudo desenhado só FORA da pista (pilares e laterais): as notas nunca ficam cobertas.
// Os acertos soltam mais partículas e tudo pulsa na batida.
// =====================================================================================
(function () {
    const KEY = 'djmaxTrainerSkinFx_v1';
    const cfg = { on: true, amount: 100 };
    try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
    const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
    const rand = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;
    // camadas do brilho da aurora (largura × alpha), da mais larga e fraca à mais fina e forte
    const GLOW = [[5.5, 0.12], [3.8, 0.18], [2.6, 0.28], [1.7, 0.45], [1, 1.1]];

    // ---------- um "emissor" por área (jogo ou miniatura da loja) ----------
    // R: { x, y, w, h } da gear na tela do canvas; pw = largura do pilar; lane = { x0, x1 } da pista
    function newState() { return { parts: [], t0: performance.now(), last: 0, seed: Math.random() * 1000, warm: false }; }
    // simula alguns segundos sem desenhar na tela, pra já começar com partículas espalhadas
    let warmCtx = null;
    function warmUp(S, fx, R) {
        if (S.warm) return;
        S.warm = true;
        if (!warmCtx) { const c = document.createElement('canvas'); c.width = 4; c.height = 4; warmCtx = c.getContext('2d'); }
        const now = performance.now();
        for (let i = 0; i < 100; i++) { S.last = now - 50; step(warmCtx, S, fx, R, now, 0, null, true); }
        S.last = 0;
    }

    const NEON = ['#ff3fb4', '#39ff88', '#ff8a1f', '#b26bff', '#22d3ee'];
    const FX = {
        // Grafite da Jade: muros de concreto que vão sendo pichados a cada acerto
        grafite: {
            rate: 4,
            spawn(S, R, n) {
                for (let i = 0; i < n; i++) {
                    const left = Math.random() < 0.5;
                    S.parts.push({ k: 'mist', x: left ? R.x + R.pw * rand(0.2, 0.8) : R.x + R.w - R.pw * rand(0.2, 0.8), y: R.y + R.h * rand(0.1, 0.95), vx: (left ? -1 : 1) * rand(6, 22) * R.scale, vy: -rand(4, 14) * R.scale, life: 1, dec: rand(0.35, 0.6), s: rand(1.5, 3.5) * Math.max(0.6, R.scale), c: NEON[(Math.random() * NEON.length) | 0] });
                }
            },
            burst(S, R, x, y) {
                if (Math.random() < 0.45) return;
                const left = x < R.x + R.w / 2;
                const cx = left ? R.x + R.pw * rand(0.15, 0.85) : R.x + R.w - R.pw * rand(0.15, 0.85);
                const cy = Math.min(R.y + R.h * 0.97, Math.max(R.y + 10, y + rand(-R.h * 0.35, R.h * 0.1)));
                const r = R.pw * rand(0.22, 0.48);
                const blobs = []; for (let i = 0; i < 5; i++) blobs.push([rand(-0.6, 0.6), rand(-0.6, 0.6), rand(0.35, 0.8)]);
                const drips = []; for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) drips.push([rand(-0.7, 0.7), rand(0.6, 2.4), rand(0.08, 0.16)]);
                S.parts.push({ k: 'tag', x: cx, y: cy, r, grow: 0, blobs, drips, c: NEON[(Math.random() * NEON.length) | 0], life: 1, dec: rand(0.03, 0.05) });
                for (let i = 0; i < 5; i++) S.parts.push({ k: 'mist', x: cx, y: cy, vx: rand(-60, 60) * R.scale, vy: rand(-60, 20) * R.scale, life: 1, dec: rand(1.2, 2), s: rand(1.5, 3) * Math.max(0.6, R.scale), c: NEON[(Math.random() * NEON.length) | 0] });
            },
            walls(g, R, t, pulse) {
                [R.x, R.x + R.w - R.pw].forEach((x0, side) => {
                    const gr = g.createLinearGradient(x0, 0, x0 + R.pw, 0);
                    gr.addColorStop(0, '#1b1d24'); gr.addColorStop(0.5, '#3a3d47'); gr.addColorStop(1, '#1b1d24');
                    g.globalAlpha = 0.95; g.fillStyle = gr; g.fillRect(x0, R.y, R.pw, R.h);
                    // juntas dos tijolos
                    g.globalAlpha = 0.18; g.fillStyle = '#000';
                    const bh = Math.max(8, R.pw * 0.32);
                    for (let y = R.y, row = 0; y < R.y + R.h; y += bh, row++) { g.fillRect(x0, y, R.pw, 1.5); g.fillRect(x0 + (row % 2 ? R.pw * 0.5 : R.pw * 0.15), y, 1.5, bh); }
                    // neon na borda que encosta na pista, alternando rosa e verde no ritmo
                    const ex = side ? x0 : x0 + R.pw;
                    const col = (Math.floor(t / 2000) + side) % 2 ? '57,255,136' : '255,63,180';
                    const eg = g.createLinearGradient(ex - 7, 0, ex + 7, 0);
                    eg.addColorStop(0, `rgba(${col},0)`); eg.addColorStop(0.5, `rgba(${col},${0.4 + 0.45 * pulse})`); eg.addColorStop(1, `rgba(${col},0)`);
                    g.globalAlpha = 1; g.fillStyle = eg; g.fillRect(ex - 7, R.y, 14, R.h);
                });
                g.globalAlpha = 1;
            },
            draw(g, p, dt) {
                if (p.k === 'mist') {
                    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.life -= p.dec * dt;
                    g.globalAlpha = Math.max(0, p.life) * 0.8; g.fillStyle = p.c;
                    g.fillRect(p.x, p.y, p.s, p.s);
                    return p.life > 0;
                }
                p.grow = Math.min(1, p.grow + dt * 7); p.life -= p.dec * dt;
                const a = Math.max(0, Math.min(1, p.life * 3)), r = p.r * p.grow;
                g.globalAlpha = a * 0.9; g.fillStyle = p.c;
                g.shadowColor = p.c; g.shadowBlur = r * 0.6;
                p.blobs.forEach(([bx, by, br]) => { g.beginPath(); g.arc(p.x + bx * r, p.y + by * r, br * r, 0, TAU); g.fill(); });
                g.shadowBlur = 0;
                p.drips.forEach(([dx, len, w]) => { const L = r * len * Math.min(1, (1 - p.life) * 6 + p.grow * 0.3); g.fillRect(p.x + dx * r - w * r / 2, p.y, w * r, L); g.beginPath(); g.arc(p.x + dx * r, p.y + L, w * r * 0.7, 0, TAU); g.fill(); });
                return p.life > 0;
            }
        },
        magma: {
            spawn(S, R, n) {
                for (let i = 0; i < n; i++) {
                    const left = Math.random() < 0.5;
                    const x = left ? R.x + rand(0, R.pw) : R.x + R.w - rand(0, R.pw);
                    if (Math.random() < 0.55) S.parts.push({ k: 'bubble', x: left ? R.x + rand(-R.pw * 0.3, R.pw) : R.x + R.w - rand(-R.pw * 0.3, R.pw), y: R.y + R.h * rand(0.15, 1), r: 0, max: rand(R.pw * 0.3, R.pw * 0.7) * Math.max(1, R.scale), grow: rand(0.8, 1.6), life: 1 });
                    else S.parts.push({ k: 'ember', x, y: R.y + R.h * rand(0.2, 1), vx: (left ? -1 : 1) * rand(8, 40) * R.scale, vy: -rand(35, 90) * R.scale, life: 1, dec: rand(0.3, 0.7), s: rand(1.2, 3) * Math.max(0.6, R.scale) });
                }
            },
            rate: 26,
            walls(g, R, t, pulse) {
                // calor saindo das paredes pra fora
                [[R.x, -1], [R.x + R.w, 1]].forEach(([ex, dir]) => {
                    const hg = g.createLinearGradient(ex, 0, ex + dir * R.side * 0.7, 0);
                    hg.addColorStop(0, `rgba(255,80,10,${0.28 + 0.2 * pulse})`); hg.addColorStop(1, 'rgba(255,40,0,0)');
                    g.fillStyle = hg; g.fillRect(Math.min(ex, ex + dir * R.side * 0.7), R.y, R.side * 0.7, R.h);
                });
                [R.x, R.x + R.w - R.pw].forEach((x0, side) => {
                    const gr = g.createLinearGradient(x0, 0, x0 + R.pw, 0);
                    gr.addColorStop(0, '#3a0a02'); gr.addColorStop(0.5, '#b8300a'); gr.addColorStop(1, '#3a0a02');
                    g.fillStyle = gr; g.globalAlpha = 0.92;
                    g.fillRect(x0, R.y, R.pw, R.h);
                    // veios de lava subindo
                    g.globalCompositeOperation = 'lighter';
                    for (let k = 0; k < 7; k++) {
                        const ph = ((t * 0.00012 * (1 + k * 0.13) + k * 0.37 + side * 0.5) % 1);
                        const y = R.y + R.h * (1 - ph);
                        const xw = x0 + R.pw * (0.5 + 0.32 * Math.sin(t * 0.0015 + k * 1.7));
                        const rg = g.createRadialGradient(xw, y, 0, xw, y, R.pw * 0.9);
                        rg.addColorStop(0, 'rgba(255,200,60,0.55)'); rg.addColorStop(0.5, 'rgba(255,90,10,0.25)'); rg.addColorStop(1, 'rgba(255,40,0,0)');
                        g.fillStyle = rg; g.globalAlpha = 0.7 + 0.3 * pulse;
                        g.fillRect(x0, y - R.pw, R.pw, R.pw * 2);
                    }
                    g.globalCompositeOperation = 'source-over';
                    // brilho na borda que encosta na pista
                    const ex = side ? x0 : x0 + R.pw;
                    const eg = g.createLinearGradient(ex - 6, 0, ex + 6, 0);
                    eg.addColorStop(0, 'rgba(255,120,20,0)'); eg.addColorStop(0.5, `rgba(255,150,40,${0.45 + 0.4 * pulse})`); eg.addColorStop(1, 'rgba(255,120,20,0)');
                    g.globalAlpha = 1; g.fillStyle = eg; g.fillRect(ex - 6, R.y, 12, R.h);
                });
                g.globalAlpha = 1;
            },
            draw(g, p, dt) {
                if (p.k === 'bubble') {
                    p.r += p.grow * dt * 14;
                    if (p.r >= p.max) { p.life -= dt * 5; }
                    const a = Math.max(0, p.life);
                    g.globalAlpha = a;
                    const rg = g.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, 0, p.x, p.y, p.r);
                    rg.addColorStop(0, '#ffe08a'); rg.addColorStop(0.45, '#ff7a1a'); rg.addColorStop(1, '#9a1d04');
                    g.fillStyle = rg; g.beginPath(); g.arc(p.x, p.y, Math.max(0.5, p.r), 0, TAU); g.fill();
                    if (p.life < 0.6) { g.strokeStyle = `rgba(255,200,80,${a})`; g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, p.r * (1.6 - p.life), 0, TAU); g.stroke(); }
                } else {
                    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.99; p.life -= p.dec * dt;
                    g.globalAlpha = Math.max(0, p.life);
                    g.fillStyle = p.life > 0.5 ? '#ffd24a' : '#ff6a1a';
                    g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill();
                }
                return p.life > 0;
            }
        },
        sakura: {
            rate: 9,
            spawn(S, R, n) {
                for (let i = 0; i < n; i++) {
                    const left = Math.random() < 0.5;
                    const band = R.side;
                    const x = left ? R.x - rand(-R.pw, band) : R.x + R.w + rand(-R.pw, band);
                    S.parts.push({ x, y: R.y - rand(0, 40), vy: rand(60, 120) * R.scale, sway: rand(0.8, 2.2), ph: rand(0, TAU), rot: rand(0, TAU), vr: rand(-2.5, 2.5), s: rand(5, 10) * R.scale, life: 1, hue: rand(330, 350), light: rand(78, 90), bottom: R.y + R.h });
                }
            },
            burst(S, R, x, y) { for (let i = 0; i < 3; i++) { const left = x < R.x + R.w / 2; S.parts.push({ x: left ? R.x - rand(0, R.side * 0.6) : R.x + R.w + rand(0, R.side * 0.6), y: y - rand(0, R.h * 0.5), vy: rand(30, 50) * R.scale, sway: rand(1, 2), ph: rand(0, TAU), rot: rand(0, TAU), vr: rand(-3, 3), s: rand(4, 7) * R.scale, life: 1, hue: rand(330, 350), light: rand(80, 92), bottom: R.y + R.h }); } },
            walls(g, R, t, pulse) {
                // galhos de cerejeira estilizados no topo dos pilares (brilho rosado)
                [R.x + R.pw / 2, R.x + R.w - R.pw / 2].forEach(x => {
                    const rg = g.createRadialGradient(x, R.y + R.h * 0.08, 0, x, R.y + R.h * 0.08, R.side * 0.9 + R.pw);
                    rg.addColorStop(0, `rgba(255,170,210,${0.35 + 0.25 * pulse})`); rg.addColorStop(1, 'rgba(255,170,210,0)');
                    g.fillStyle = rg; g.fillRect(x - R.side - R.pw, R.y, (R.side + R.pw) * 2, R.h * 0.3);
                });
            },
            draw(g, p, dt, t) {
                p.y += p.vy * dt; p.ph += dt * p.sway; p.x += Math.sin(p.ph) * 22 * dt; p.rot += p.vr * dt;
                if (p.y > p.bottom - 6) { p.vy = 0; p.vr = 0; p.life -= dt * 0.6; } // pousou: some devagar
                g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(p.ph)));
                g.globalAlpha = Math.max(0, Math.min(1, p.life));
                g.fillStyle = `hsl(${p.hue},85%,${p.light}%)`;
                g.beginPath(); g.moveTo(0, -p.s); g.quadraticCurveTo(p.s, -p.s * 0.2, 0, p.s); g.quadraticCurveTo(-p.s, -p.s * 0.2, 0, -p.s); g.fill();
                g.fillStyle = `hsla(${p.hue},70%,60%,0.6)`; g.beginPath(); g.arc(0, p.s * 0.55, p.s * 0.18, 0, TAU); g.fill();
                g.restore();
                return p.life > 0;
            }
        },
        aurora: {
            rate: 6,
            spawn(S, R, n) { for (let i = 0; i < n; i++) { const left = Math.random() < 0.5; S.parts.push({ x: left ? R.x - rand(0, R.side) : R.x + R.w + rand(0, R.side), y: R.y + rand(0, R.h * 0.7), life: 1, s: rand(1, 2.4) * R.scale, dec: rand(0.5, 1.2) }); } },
            walls(g, R, t, pulse) {
                g.globalCompositeOperation = 'lighter';
                [-1, 1].forEach(side => {
                    const base = side < 0 ? R.x : R.x + R.w;
                    for (let k = 0; k < 3; k++) {
                        g.beginPath();
                        const steps = 24;
                        for (let i = 0; i <= steps; i++) {
                            const yy = R.y + R.h * 0.85 * i / steps;
                            const off = (R.pw * 0.5 + R.side * (0.25 + 0.25 * k)) + Math.sin(t * 0.0009 * (1 + k * 0.3) + i * 0.45 + k) * R.side * 0.18;
                            const xx = base + side * off;
                            i ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
                        }
                        const hue = Math.round(150 + k * 30 + 15 * Math.sin(t * 0.0005 + k));
                        const a = 0.09 + 0.1 * pulse, lw = R.side * (0.11 - k * 0.025);
                        g.lineCap = 'round'; g.lineJoin = 'round';
                        // brilho "falso": 3 traços do largo/fraco ao fino/forte (shadowBlur custa MUITO caro)
                        for (const [wm, am] of GLOW) { g.strokeStyle = `hsla(${hue},90%,62%,${a * am})`; g.lineWidth = lw * wm; g.stroke(); }
                    }
                });
                g.globalCompositeOperation = 'source-over';
            },
            draw(g, p, dt, t) {
                p.life -= p.dec * dt;
                const a = Math.max(0, Math.sin(p.life * Math.PI));
                g.globalAlpha = a; g.fillStyle = '#d1fae5';
                g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill();
                return p.life > 0;
            }
        },
        oceano: {
            rate: 14,
            spawn(S, R, n) { for (let i = 0; i < n; i++) { const left = Math.random() < 0.5; S.parts.push({ x: left ? R.x - rand(-R.pw, R.side * 0.8) : R.x + R.w + rand(-R.pw, R.side * 0.8), y: R.y + R.h + rand(0, 10), vy: -rand(30, 80) * R.scale, r: rand(1.5, 5) * R.scale, ph: rand(0, TAU), life: 1, top: R.y }); } },
            burst(S, R, x, y) { for (let i = 0; i < 4; i++) { const left = x < R.x + R.w / 2; S.parts.push({ x: left ? R.x - rand(0, R.side * 0.5) : R.x + R.w + rand(0, R.side * 0.5), y, vy: -rand(60, 110) * R.scale, r: rand(2, 4) * R.scale, ph: rand(0, TAU), life: 1, top: R.y }); } },
            walls(g, R, t, pulse) {
                g.globalCompositeOperation = 'lighter';
                [-1, 1].forEach(side => {
                    for (let k = 0; k < 4; k++) {
                        const x = (side < 0 ? R.x : R.x + R.w) + side * (R.pw * 0.3 + R.side * (0.15 + 0.2 * k)) + Math.sin(t * 0.0007 + k * 2) * R.side * 0.08;
                        const w = R.side * 0.12 * (1 + 0.3 * Math.sin(t * 0.001 + k));
                        const gr = g.createLinearGradient(0, R.y, 0, R.y + R.h);
                        gr.addColorStop(0, `rgba(125,211,252,${0.18 + 0.1 * pulse})`); gr.addColorStop(1, 'rgba(14,116,144,0)');
                        g.fillStyle = gr;
                        g.beginPath(); g.moveTo(x - w * 0.3, R.y); g.lineTo(x + w * 0.3, R.y); g.lineTo(x + w, R.y + R.h); g.lineTo(x - w, R.y + R.h); g.fill();
                    }
                });
                g.globalCompositeOperation = 'source-over';
            },
            draw(g, p, dt) {
                p.y += p.vy * dt; p.ph += dt * 3; p.x += Math.sin(p.ph) * 10 * dt;
                if (p.y < p.top + 10) p.life -= dt * 4;
                g.globalAlpha = Math.max(0, p.life) * 0.85;
                g.strokeStyle = '#bae6fd'; g.lineWidth = 1;
                g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
                g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.25, 0, TAU); g.fill();
                return p.life > 0;
            }
        },
        ouro: {
            rate: 22,
            spawn(S, R, n) {
                for (let i = 0; i < n; i++) {
                    const left = Math.random() < 0.5;
                    if (Math.random() < 0.6) S.parts.push({ k: 'spark', x: left ? R.x + rand(-R.pw * 0.5, R.pw * 1.5) : R.x + R.w - rand(-R.pw * 0.5, R.pw * 1.5), y: R.y + rand(0, R.h), life: 1, dec: rand(0.9, 1.8), s: rand(5, 11) * Math.max(0.6, R.scale) });
                    else S.parts.push({ k: 'dust', x: left ? R.x - rand(0, R.side) : R.x + R.w + rand(0, R.side), y: R.y - 5, vy: rand(20, 45) * R.scale, life: 1, s: rand(0.8, 1.8) * R.scale, ph: rand(0, TAU), bottom: R.y + R.h });
                }
            },
            burst(S, R, x, y) { for (let i = 0; i < 3; i++) { const left = Math.random() < 0.5; S.parts.push({ k: 'spark', x: left ? R.x + rand(0, R.pw) : R.x + R.w - rand(0, R.pw), y: y - rand(0, R.h * 0.4), life: 1, dec: 1.6, s: rand(6, 10) * R.scale }); } },
            walls(g, R, t, pulse) {
                [R.x, R.x + R.w - R.pw].forEach(x0 => {
                    const sh = ((t * 0.0004) % 1.6) - 0.3;
                    const gr = g.createLinearGradient(0, R.y + R.h * (sh - 0.15), 0, R.y + R.h * (sh + 0.15));
                    gr.addColorStop(0, 'rgba(255,240,180,0)'); gr.addColorStop(0.5, `rgba(255,236,160,${0.35 + 0.25 * pulse})`); gr.addColorStop(1, 'rgba(255,240,180,0)');
                    g.fillStyle = gr; g.fillRect(x0, R.y, R.pw, R.h);
                });
            },
            draw(g, p, dt) {
                if (p.k === 'spark') {
                    p.life -= p.dec * dt;
                    const a = Math.max(0, Math.sin(p.life * Math.PI)), s = p.s * a;
                    g.globalAlpha = a; g.fillStyle = '#fff7c2';
                    g.beginPath(); g.moveTo(p.x, p.y - s); g.lineTo(p.x + s * 0.22, p.y - s * 0.22); g.lineTo(p.x + s, p.y); g.lineTo(p.x + s * 0.22, p.y + s * 0.22);
                    g.lineTo(p.x, p.y + s); g.lineTo(p.x - s * 0.22, p.y + s * 0.22); g.lineTo(p.x - s, p.y); g.lineTo(p.x - s * 0.22, p.y - s * 0.22); g.closePath(); g.fill();
                } else {
                    p.y += p.vy * dt; p.ph += dt * 2; p.x += Math.sin(p.ph) * 6 * dt;
                    if (p.y > p.bottom) p.life = 0;
                    g.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(p.ph * 3)); g.fillStyle = '#fcd34d';
                    g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill();
                }
                return p.life > 0;
            }
        },
        cosmos: {
            rate: 10,
            spawn(S, R, n) {
                for (let i = 0; i < n; i++) {
                    const left = Math.random() < 0.5;
                    if (Math.random() < 0.2) S.parts.push({ k: 'comet', x: left ? R.x - R.side : R.x + R.w + R.side, y: R.y + rand(0, R.h * 0.5), vx: (left ? 1 : -1) * rand(40, 90) * R.scale, vy: rand(60, 140) * R.scale, life: 1, left, lim: left ? R.x : R.x + R.w });
                    else S.parts.push({ k: 'star', cx: left ? R.x - R.side * 0.45 : R.x + R.w + R.side * 0.45, cy: R.y + rand(0.1, 0.9) * R.h, rad: rand(0.15, 0.45) * R.side, a: rand(0, TAU), va: rand(0.4, 1.4) * (Math.random() < 0.5 ? -1 : 1), life: 1, dec: rand(0.15, 0.35), s: rand(0.8, 2) * R.scale });
                }
            },
            walls(g, R, t, pulse) {
                g.globalCompositeOperation = 'lighter';
                [R.x - R.side * 0.45, R.x + R.w + R.side * 0.45].forEach((cx, i) => {
                    for (let k = 0; k < 3; k++) {
                        const cy = R.y + R.h * (0.25 + 0.25 * k) + Math.sin(t * 0.0004 + k + i) * R.h * 0.05;
                        const rr = R.side * (0.6 + 0.2 * Math.sin(t * 0.0006 + k * 2));
                        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
                        rg.addColorStop(0, `rgba(168,85,247,${0.18 + 0.15 * pulse})`); rg.addColorStop(0.6, 'rgba(76,29,149,0.08)'); rg.addColorStop(1, 'rgba(76,29,149,0)');
                        g.fillStyle = rg; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
                    }
                });
                g.globalCompositeOperation = 'source-over';
            },
            draw(g, p, dt) {
                if (p.k === 'comet') {
                    p.x += p.vx * dt; p.y += p.vy * dt;
                    if (p.left ? p.x > p.lim - 4 : p.x < p.lim + 4) p.life = 0;
                    const tail = g.createLinearGradient(p.x, p.y, p.x - p.vx * 0.25, p.y - p.vy * 0.25);
                    tail.addColorStop(0, 'rgba(233,213,255,0.95)'); tail.addColorStop(1, 'rgba(168,85,247,0)');
                    g.globalAlpha = 1; g.strokeStyle = tail; g.lineWidth = 2;
                    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.25, p.y - p.vy * 0.25); g.stroke();
                } else {
                    p.a += p.va * dt; p.life -= p.dec * dt;
                    const x = p.cx + Math.cos(p.a) * p.rad, y = p.cy + Math.sin(p.a) * p.rad * 0.4;
                    g.globalAlpha = Math.max(0, Math.sin(p.life * Math.PI)); g.fillStyle = '#f5f3ff';
                    g.beginPath(); g.arc(x, y, p.s, 0, TAU); g.fill();
                }
                return p.life > 0;
            }
        }
    };
    window.SKINFX = FX;
    window.SKINFX_API = { FX, newState: () => newState(), warmUp: (S, fx, R) => warmUp(S, fx, R), step: (g, S, fx, R, ts, pulse, hits) => step(g, S, fx, R, ts, pulse, hits) };

    // avança e desenha um emissor dentro de um retângulo R
    function step(g, S, fx, R, ts, pulse, hits, noWalls) {
        const dt = S.last ? Math.min(0.05, (ts - S.last) / 1000) : 0.016;
        S.last = ts;
        const amt = cfg.amount / 100;
        S.acc = (S.acc || 0) + fx.rate * amt * dt * (1 + 0.8 * pulse);
        const n = Math.floor(S.acc); S.acc -= n;
        if (n) fx.spawn(S, R, n);
        (hits || []).forEach(h => { if (fx.burst) fx.burst(S, R, h.x, h.y); else fx.spawn(S, R, 2); });
        const cap = Math.round(110 + 110 * amt); if (S.parts.length > cap) S.parts.splice(0, S.parts.length - cap);
        if (fx.walls && !noWalls) fx.walls(g, R, ts, pulse);
        let j = 0; const P = S.parts;
        for (let i = 0; i < P.length; i++) { if (fx.draw(g, P[i], dt, ts)) P[j++] = P[i]; }
        P.length = j;
        g.globalAlpha = 1;
    }

    // ---------- no jogo ----------
    const G = { cv: null, g: null, S: newState(), id: null, seen: new WeakSet() };
    function gameFrame(ts) {
        requestAnimationFrame(gameFrame);
        const id = typeof window.bmGearFxId === 'function' ? window.bmGearFxId() : (typeof gearSkin === 'string' && gearSkin.startsWith('shop_') ? gearSkin.slice(5) : null);
        const playing = typeof isPlaying !== 'undefined' && isPlaying;
        const fx = id && FX[id];
        if (!cfg.on || !fx || !playing) { if (G.cv) G.cv.style.display = 'none'; G.S.last = 0; return; }
        const box = document.getElementById('game-container');
        if (!box) return;
        if (!G.cv) {
            G.cv = document.createElement('canvas');
            G.cv.id = 'skinfx-layer';
            G.cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2';
            box.appendChild(G.cv);
        }
        if (G.id !== id) { G.S = newState(); G.id = id; }
        const cv = G.cv;
        cv.style.display = '';
        const rc = typeof gearRectsCached === 'function' ? gearRectsCached(ts) : null;
        const br = rc ? rc.box : box.getBoundingClientRect();
        // resolução 1:1 com a tela (sem multiplicar pelo zoom do Windows): os efeitos ficam nas
        // laterais, são suaves, e isso corta o trabalho pela metade em telas com escala 150%
        const dpr = 1;
        const w = Math.round(br.width * dpr), h = Math.round(br.height * dpr);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        const g = G.g || (G.g = cv.getContext('2d', { alpha: true, desynchronized: false }));
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const gc = typeof palcoGearCanvas === 'function' ? palcoGearCanvas() : document.getElementById('gameCanvas');
        if (!gc) return;
        const gr = rc ? rc.gear : gc.getBoundingClientRect();
        const L = typeof getGearLayout === 'function' ? getGearLayout() : null;
        const tw = (L && L.totalW) || canvas.totalWidth || 580, th = (L && L.totalH) || canvas.totalHeight || 1208;
        const F = L && L.frame ? L.F : 30, laneH = (L ? L.H : 1080);
        const R = { x: gr.left - br.left, y: gr.top - br.top, w: gr.width, h: (window.bmGearFxFull && window.bmGearFxFull()) ? gr.height : gr.height * laneH / th, pw: gr.width * F / tw, side: Math.min(140, Math.max(40, (br.width - gr.width) / 2 * 0.6)), scale: gr.height / 900 };
        // só fora da pista: recorta a área das lanes
        g.save();
        g.beginPath();
        g.rect(0, 0, br.width, br.height);
        g.rect(R.x + R.pw, R.y - 2, R.w - R.pw * 2, gr.height + 4);
        g.clip('evenodd');
        const b = typeof palcoBeatInfo === 'function' ? palcoBeatInfo() : { pulse: 0 };
        const hits = [];
        if (typeof hitFlashes !== 'undefined') for (const f of hitFlashes) { if (G.seen.has(f)) continue; G.seen.add(f); if (f.big || Math.random() < 0.4) hits.push({ x: R.x + (f.x + F) / tw * gr.width, y: R.y + f.y / th * gr.height }); }
        warmUp(G.S, fx, R);
        step(g, G.S, fx, R, ts, b.pulse || 0, hits);
        g.restore();
    }
    requestAnimationFrame(gameFrame);

    // ---------- miniaturas da loja (animadas enquanto a loja está aberta) ----------
    const M = new Map();
    function shopFrame(ts) {
        requestAnimationFrame(shopFrame);
        const host = document.getElementById('bc-ov') || document.getElementById('col-ov');
        const prevs = host ? host.querySelectorAll('.prev[data-fx]') : [];
        if (!prevs.length) { if (M.size) M.clear(); return; }
        const beats = ts / 500, pulse = Math.exp(-(beats - Math.floor(beats)) * 6);
        prevs.forEach(el => {
            const fx = FX[el.dataset.fx];
            if (!fx) return;
            let m = M.get(el);
            if (!m) {
                const cv = document.createElement('canvas');
                cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
                el.appendChild(cv);
                m = { cv, S: newState() };
                M.set(el, m);
            }
            const r = el.getBoundingClientRect();
            const w = Math.round(r.width), h = Math.round(r.height);
            if (m.cv.width !== w || m.cv.height !== h) { m.cv.width = w; m.cv.height = h; }
            const g = m.cv.getContext('2d');
            g.clearRect(0, 0, w, h);
            // mesma geometria da miniatura (pilares de 12px com 10px de folga nas pontas)
            const gx = 10, gw = w - 20;
            const R = { x: gx, y: 0, w: gw, h: h, pw: 12, side: 22, scale: 0.45 };
            g.save(); g.beginPath(); g.rect(0, 0, w, h); g.rect(gx + 12, 0, gw - 24, h); g.clip('evenodd');
            warmUp(m.S, fx, R);
            step(g, m.S, fx, R, ts, pulse, null);
            g.restore();
        });
    }
    requestAnimationFrame(shopFrame);

    // ---------- opção nas Configurações ----------
    (function ui() {
        const anchor = document.getElementById('setting-palco');
        const host = anchor && anchor.closest('.flex.flex-col');
        if (!host || document.getElementById('setting-skinfx')) return;
        const row = document.createElement('label');
        row.className = 'flex items-center justify-between gap-3 cursor-pointer';
        row.innerHTML = `<span><span class="text-xs font-bold text-slate-200 block">Efeitos animados das gears exclusivas</span>
            <span class="text-[10px] text-slate-400">Lava, pétalas, aurora, bolhas, ouro e cosmos nas laterais das gears da loja (nunca em cima das notas).</span></span>
            <span class="flex items-center gap-2 shrink-0"><select id="setting-skinfx-amt" class="bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-slate-100" title="Quantidade de partículas"><option value="50">Poucas</option><option value="100">Normal</option><option value="160">Muitas</option></select>
            <input type="checkbox" id="setting-skinfx" class="accent-cyan-400 w-5 h-5"></span>`;
        host.insertAdjacentElement('afterend', row);
        const cb = row.querySelector('#setting-skinfx'), amt = row.querySelector('#setting-skinfx-amt');
        cb.checked = cfg.on; amt.value = String(cfg.amount);
        cb.addEventListener('change', () => { cfg.on = cb.checked; saveCfg(); });
        amt.addEventListener('change', () => { cfg.amount = +amt.value; saveCfg(); });
    })();
})();
