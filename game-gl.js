// =====================================================================================
// game-gl.js — tela de JOGO desenhada pela placa de vídeo (WebGL).
//
// É o mesmo jogo, com a mesma lógica de render() do script.js (tempo, julgamento, BREAK,
// hold, partículas...) — só que cada coisa visual vira geometria/textura na GPU (ver
// gl-renderer.js). As skins de nota, o fundo da gear e os textos são desenhados UMA vez com o
// próprio código do Canvas 2D (mesmo visual de antes) e guardados como textura; depois, a
// cada frame, a GPU só "carimba" essas texturas nas posições certas. Nada de shadowBlur por
// frame (o que mais pesava), então o frame fica curto e regular.
// Se o WebGL falhar (PC/navegador sem suporte, driver travado), o jogo volta sozinho pro
// Canvas 2D de sempre.
// =====================================================================================

let glGame = null;            // { r: GLBatchRenderer, canvas, lost }
let glFailReason = '';
const glSpriteCache = new Map(); // chave -> textura (LRU simples)
const GL_SPRITE_CACHE_MAX = 420;
let glCachePixelScale = 0;
let glMeasureCtx = null;

function getGLCanvasEl() { return document.getElementById('gameCanvasGL'); }

function isGLGameActive() {
    return !!(glGame && !glGame.lost && rendererPref === 'webgl');
}

// Canvas que está de fato aparecendo na tela (o de WebGL quando ativo) — usado por
// resizeCanvas() pra medir o tamanho real exibido.
function getVisibleGLCanvas() {
    return isGLGameActive() ? glGame.canvas : null;
}

function glPurgeSprites(prefix) {
    for (const [k, t] of glSpriteCache) {
        if (!prefix || k.startsWith(prefix)) {
            if (glGame && glGame.r && !glGame.lost) glGame.r.deleteTexture(t);
            glSpriteCache.delete(k);
        }
    }
}

// joga fora as texturas já "assadas" (fundo da gear etc.) — usado quando muda o layout das
// colunas (ex.: 8B em 8 COLUNAS), já que a chave delas não sabe disso
function glResetGearCache() {
    try { if (glGame && glGame.r) for (const t of glSpriteCache.values()) glGame.r.deleteTexture(t); } catch (e) {}
    glSpriteCache.clear();
    try { if (typeof sprite2DCache !== 'undefined') sprite2DCache.clear(); } catch (e) {}
}

function initGLGame() {
    const el = getGLCanvasEl();
    if (!el || typeof GLBatchRenderer === 'undefined') {
        glFailReason = 'WebGL não carregou';
        return false;
    }
    try {
        const r = new GLBatchRenderer(el, { lowLatency: lowLatencyMode });
        glSpriteCache.clear();
        glGame = { r, canvas: el, lost: false };
        glFailReason = '';
        if (!el.__glListeners) {
            el.__glListeners = true;
            el.addEventListener('webglcontextlost', (e) => {
                e.preventDefault();
                if (glGame) glGame.lost = true;
                glSpriteCache.clear();
                applyRendererVisibility();
                resizeCanvas();
            });
            el.addEventListener('webglcontextrestored', () => {
                initGLGame();
                applyRendererVisibility();
                resizeCanvas();
            });
        }
        return true;
    } catch (e) {
        console.warn('[WebGL] indisponível, usando Canvas 2D:', e && e.message);
        glGame = null;
        glFailReason = (e && e.message) || 'erro ao iniciar';
        return false;
    }
}

// O atributo "desynchronized" (baixa latência) só pode ser escolhido na criação do contexto,
// então pra trocar é preciso um canvas novo.
function recreateGLCanvas() {
    const old = getGLCanvasEl();
    if (!old) return;
    glPurgeSprites();
    const fresh = old.cloneNode(false);
    fresh.__glListeners = false;
    old.replaceWith(fresh);
    glGame = null;
    if (rendererPref === 'webgl') initGLGame();
    applyRendererVisibility();
    resizeCanvas();
}

function applyRendererVisibility() {
    const el = getGLCanvasEl();
    const gl = isGLGameActive();
    if (el) el.classList.toggle('hidden', !gl);
    canvas.classList.toggle('hidden', gl);
    updateRendererStatusUI();
}

function setRendererPref(pref) {
    rendererPref = pref === '2d' ? '2d' : 'webgl';
    if (rendererPref === 'webgl' && !glGame) initGLGame();
    applyRendererVisibility();
    resizeCanvas();
}

function updateRendererStatusUI() {
    const el = document.getElementById('renderer-status');
    if (!el) return;
    if (rendererPref === '2d') {
        el.textContent = 'Usando Canvas 2D (modo compatibilidade).';
        el.className = 'text-[10px] text-slate-400';
    } else if (isGLGameActive()) {
        let gpu = '';
        try { gpu = glGame.r.rendererName(); } catch (e) { gpu = ''; }
        el.textContent = `WebGL ativo${gpu ? ' — ' + gpu : ''}`;
        el.className = 'text-[10px] text-emerald-400';
    } else {
        el.textContent = `WebGL indisponível (${glFailReason || 'contexto perdido'}) — usando Canvas 2D.`;
        el.className = 'text-[10px] text-amber-400';
    }
}

// chamado por resizeCanvas() depois de ajustar o tamanho do buffer
function onGLCanvasResized() {
    if (!glGame) return;
    const s = gearPixelScale();
    if (Math.abs(s - glCachePixelScale) > 0.001) {
        glPurgeSprites();
        glCachePixelScale = s;
    }
}

// Fontes da web (Orbitron/Rajdhani) podem terminar de carregar depois que o texto já virou
// textura com a fonte reserva — refaz os textos quando isso acontecer.
if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => { glPurgeSprites('t|'); if (typeof clearTextMetricsMemo === 'function') clearTextMetricsMemo(); });
}
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { glPurgeSprites('t|'); if (typeof clearTextMetricsMemo === 'function') clearTextMetricsMemo(); });
}

// ---------- texturas "assadas" com o código do Canvas 2D ----------
function glPixelScale() {
    return gearPixelScale();
}

// Desenha uma vez com o Canvas 2D (trocando o ctx global, então as funções de desenho de
// sempre — drawNote, drawHoldNote, drawGameHighwayGem... — funcionam sem mudança) e guarda
// como textura. lw/lh: tamanho lógico; ax/ay: âncora.
function glGetSprite(key, lw, lh, ax, ay, drawFn) {
    let t = glSpriteCache.get(key);
    if (t && t.tex) {
        glSpriteCache.delete(key);
        glSpriteCache.set(key, t);
        return t;
    }
    const s = glPixelScale();
    const pw = Math.max(1, Math.min(4096, Math.ceil(lw * s)));
    const ph = Math.max(1, Math.min(4096, Math.ceil(lh * s)));
    const c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const bctx = c.getContext('2d');
    bctx.scale(pw / lw, ph / lh);
    const savedCtx = ctx;
    ctx = bctx;
    try {
        drawFn(bctx);
    } catch (e) {
        console.warn('[WebGL] falha ao preparar textura', key, e);
    } finally {
        ctx = savedCtx;
        noteAnimClockOverride = null;
        noteAnimSkipPulseRing = false;
    }
    t = glGame.r.createTexture(c, lw, lh, ax, ay);
    glSpriteCache.set(key, t);
    while (glSpriteCache.size > GL_SPRITE_CACHE_MAX) {
        const oldest = glSpriteCache.keys().next().value;
        glGame.r.deleteTexture(glSpriteCache.get(oldest));
        glSpriteCache.delete(oldest);
    }
    return t;
}

// Texto como textura. Âncora = ponto do textAlign na linha de base (igual ao fillText).
function glTextSprite(text, font, color, o) {
    o = o || {};
    text = String(text);
    const align = o.align || 'center';
    const sc = o.shadowColor || '';
    const sb = o.shadowBlur || 0;
    const key = `t|${font}|${color}|${sc}|${sb}|${align}|${text}`;
    const cached = glSpriteCache.get(key);
    if (cached && cached.tex) {
        glSpriteCache.delete(key);
        glSpriteCache.set(key, cached);
        return cached;
    }
    if (!glMeasureCtx) glMeasureCtx = document.createElement('canvas').getContext('2d');
    glMeasureCtx.font = font;
    const m = glMeasureCtx.measureText(text);
    const size = parseFloat((font.match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 16;
    const ascent = Math.max(m.actualBoundingBoxAscent || 0, size * 0.8);
    const descent = Math.max(m.actualBoundingBoxDescent || 0, size * 0.22);
    const tw = Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0), 1);
    const pad = Math.ceil(sb * 1.6) + 4;
    const lw = tw + pad * 2, lh = ascent + descent + pad * 2;
    const ax = align === 'left' ? pad : align === 'right' ? pad + tw : pad + tw / 2;
    const ay = pad + ascent;
    return glGetSprite(key, lw, lh, ax, ay, (b) => {
        b.font = font;
        b.textAlign = align;
        b.textBaseline = 'alphabetic';
        b.fillStyle = color;
        if (sb > 0) { b.shadowColor = sc || color; b.shadowBlur = sb; }
        b.fillText(text, ax, ay);
    });
}

function glText(R, text, x, y, font, color, o) {
    const t = glTextSprite(text, font, color, o);
    R.sprite(t, x, y, { alpha: o && o.alpha != null ? o.alpha : 1 });
}

function getGearMainColor() {
    switch (gearSkin) {
        case 'crimson': return '#ef4444';
        case 'gold': return '#eab308';
        case 'sakura': return '#ec4899';
        case 'chrome': return '#e2e8f0';
        case 'matrix': return '#22c55e';
        case 'void': return '#8b5cf6';
        default: return (typeof GEAR_THEMES !== 'undefined' && GEAR_THEMES[gearSkin]) ? GEAR_THEMES[gearSkin].accent : '#06b6d4';
    }
}

// ---------- medidor de FPS / tempo de frame (vale pros dois renderizadores) ----------
const frameStats = { last: null, samples: [], fps: 0, avgMs: 0, worstMs: 0, lastCalc: 0, text: '' };
function trackFrameStats(timestamp) {
    const fs = frameStats;
    if (fs.last != null) {
        const d = timestamp - fs.last;
        if (d > 0 && d < 1000) {
            fs.samples.push(d);
            if (fs.samples.length > 120) fs.samples.shift();
        }
    }
    fs.last = timestamp;
    if (timestamp - fs.lastCalc > 250 && fs.samples.length > 5) {
        fs.lastCalc = timestamp;
        let sum = 0, worst = 0;
        for (const d of fs.samples) { sum += d; if (d > worst) worst = d; }
        fs.avgMs = sum / fs.samples.length;
        fs.fps = 1000 / fs.avgMs;
        fs.worstMs = worst;
        fs.text = `${Math.round(fs.fps)} FPS · ${fs.avgMs.toFixed(1)}ms (pior ${worst.toFixed(1)}ms) · ${isGLGameActive() ? 'WebGL' : '2D'}`;
    }
}

// ---------- Gear clássica ----------
function glBakeClassicLanes(b) {
    const mainLaneCount = getMainLaneCount(currentMode);
    const columns = getGameplayColumnLayout(currentMode, canvas.logicalWidth);
    const H = canvas.logicalHeight;
    for (let i = 0; i < mainLaneCount; i++) {
        const col = columns[i];
        b.fillStyle = i % 2 === 0 ? 'rgba(15, 23, 42, 0.6)' : 'rgba(30, 41, 59, 0.6)';
        b.fillRect(col.x, 0, col.width, H);
        b.lineWidth = 1;
        if (gearSkin === 'cyan') {
            b.strokeStyle = 'rgba(6, 182, 212, 0.15)';
            b.strokeRect(col.x, 0, col.width, H);
        } else if (gearSkin === 'crimson') {
            b.fillStyle = 'rgba(239, 68, 68, 0.05)';
            b.fillRect(col.x + col.width / 2 - 2, 0, 4, H);
            b.strokeStyle = 'rgba(239, 68, 68, 0.2)';
            b.strokeRect(col.x, 0, col.width, H);
        } else if (gearSkin === 'gold') {
            b.strokeStyle = 'rgba(234, 179, 8, 0.25)';
            b.lineWidth = 2;
            b.strokeRect(col.x + 2, 0, col.width - 4, H);
        } else if (gearSkin === 'sakura') {
            const g = b.createLinearGradient(col.x, 0, col.x, H);
            g.addColorStop(0, 'rgba(236, 72, 153, 0.10)');
            g.addColorStop(1, 'rgba(168, 85, 247, 0.04)');
            b.fillStyle = g;
            b.fillRect(col.x, 0, col.width, H);
            b.strokeStyle = 'rgba(236, 72, 153, 0.25)';
            b.lineWidth = 1.5;
            b.strokeRect(col.x + 2, 0, col.width - 4, H);
        } else if (gearSkin === 'chrome') {
            b.fillStyle = 'rgba(148, 163, 184, 0.06)';
            b.fillRect(col.x + col.width / 2 - 3, 0, 6, H);
            b.strokeStyle = 'rgba(226, 232, 240, 0.22)';
            b.strokeRect(col.x, 0, col.width, H);
        } else if (gearSkin === 'matrix') {
            b.fillStyle = 'rgba(34, 197, 94, 0.04)';
            b.fillRect(col.x, 0, col.width, H);
            b.strokeStyle = 'rgba(34, 197, 94, 0.22)';
            b.strokeRect(col.x, 0, col.width, H);
        } else if (gearSkin === 'void') {
            const g = b.createRadialGradient(col.x + col.width / 2, H * 0.35, 4, col.x + col.width / 2, H * 0.35, col.width * 1.4);
            g.addColorStop(0, 'rgba(139, 92, 246, 0.16)');
            g.addColorStop(1, 'rgba(139, 92, 246, 0)');
            b.fillStyle = g;
            b.fillRect(col.x, 0, col.width, H);
            b.strokeStyle = 'rgba(167, 139, 250, 0.22)';
            b.strokeRect(col.x, 0, col.width, H);
        }
    }
}

function glDrawClassicLanes(R, dt) {
    const W = canvas.logicalWidth, H = canvas.logicalHeight;
    // fundo escuro (opacidade da pista) + faixas numa textura só: uma camada de tela a menos
    const bg = glGetSprite(`bgC|${currentMode}|${gearSkin}|${W}x${H}|${laneOpacityPct}`, W, H, 0, 0, (b) => {
        b.fillStyle = `rgba(2, 6, 23, ${0.92 * laneOpacityPct / 100})`;
        b.fillRect(0, 0, W, H);
        glBakeClassicLanes(b);
    });
    R.sprite(bg, 0, 0);

    const mainLaneCount = getMainLaneCount(currentMode);
    const columns = getGameplayColumnLayout(currentMode, W);
    const colors = getKeyColorScheme(currentMode, gearSkin);
    const now = performance.now();
    for (let i = 0; i < mainLaneCount; i++) {
        const col = columns[i];
        if (gearSkin === 'matrix') {
            const dashLen = 22, gapLen = 34, cycle = dashLen + gapLen;
            const scrollOffset = (now / 8 + i * 71) % cycle;
            const sx = col.x + col.width / 2;
            for (let y = -cycle + scrollOffset; y < H; y += cycle) R.rect(sx - 1, y, 2, dashLen, 'rgba(74, 222, 128, 0.35)');
        } else if (gearSkin === 'void') {
            const seed = i * 97;
            for (let s = 0; s < 5; s++) {
                const sx = col.x + ((seed + s * 53) % 100) / 100 * col.width;
                const sy = ((seed + s * 137) % 1000) / 1000 * H;
                const tw = 0.3 + 0.5 * Math.abs(Math.sin(now / 600 + s));
                R.rect(sx, sy, 2, 2, glWithAlpha('#e9d5ff', tw));
            }
        }
        if (keyLighting[i] > 0) {
            const c = colors[i];
            R.rectV(col.x, 0, col.width, H, glWithAlpha(c, 0), glWithAlpha(c, keyLighting[i] * 0.4));
            keyLighting[i] -= 0.05 * dt;
        }
    }
}

function glDrawHpBar(R, mainColor) {
    const W = canvas.logicalWidth;
    const barW = gameView === 'highway_tilt' ? Math.min(W * 0.5, 620) : W - 20;
    const x = (W - barW) / 2;
    R.rect(x, 10, barW, 8, '#0f172a');
    R.rect(x, 10, barW * Math.max(0, hpDisplayed / 100), 8, hpDisplayed > 30 ? mainColor : '#ef4444');
}

// Raio que drawNote usa pra cada skin redonda (pra escalar a textura igualzinho)
const GL_ROUND_SKIN_RADIUS = { circle: [2, 0.9], hex: [2, 0.95], pulse: [2, 0.9], disc: [4, 0.85], orb: [4, 0.85], ring: [4, 0.85] };

// Nota comum na gear clássica: mesmo efeito de entrada/profundidade de drawNoteWithEntryFx.
// A textura da nota é feita no tamanho MÁXIMO (bem em cima da linha) e só encolhe na GPU
// conforme a "distância" — uma textura por cor, então as notas saem em pouquíssimas chamadas.
// Se "queue" vier, o carimbo da nota vai pra fila (desenhada depois, agrupada por textura).
function glDrawClassicNote(R, lane, noteY, column, noteHeight, speedFactor, queue) {
    const FADE_PX = 90;
    const spawnT = noteY < (-50 + FADE_PX) ? Math.max(0, Math.min(1, (noteY + 50) / FADE_PX)) : 1;
    if (spawnT <= 0.02) return;
    const targetY = canvas.logicalHeight - 80;
    const GROW_PX = Math.max(150, targetY + 50);
    const depthT = Math.max(0, Math.min(1, (noteY + 50) / GROW_PX));
    const depthScale = 1 + 0 * depthT; // tamanho constante (igual em todos os visuais)
    const color = getKeyColorScheme(currentMode, gearSkin)[lane];
    const laneW = column.width;
    const xCenter = column.x + laneW / 2;

    // rastro de luz
    const trailW = laneW * 0.5;
    const stepPx = Math.max(6, speedFactor * 2.2);
    for (let i = 4; i >= 1; i--) {
        const ty = noteY - i * stepPx;
        if (ty < -70) continue;
        const a = spawnT * (1 - i / 5) * 0.28;
        if (a <= 0.01) continue;
        const h = noteHeight * 0.36;
        R.rect(xCenter - trailW / 2, ty - h / 2, trailW, h, glWithAlpha(color, a));
        R.glowRect(xCenter - trailW / 2, ty - h / 2, trailW, h, color, 5, a * 0.5);
    }

    const nh = noteHeight * depthScale;
    const nhMax = noteHeight;
    const PAD = 28;
    const lw = laneW + PAD * 2, lh = nhMax * 2 + PAD * 2;
    const key = `nC|${noteShape}|${color}|${laneW.toFixed(2)}|${nhMax.toFixed(2)}`;
    const tex = glGetSprite(key, lw, lh, lw / 2, lh / 2, () => {
        noteAnimClockOverride = 0;       // hexágono "parado" (a GPU gira depois)
        noteAnimSkipPulseRing = true;    // a onda do Pulse Core é desenhada à parte
        drawNote(lane, lh / 2, { x: PAD, width: laneW }, nhMax);
    });
    let sx = 1, sy = nh / nhMax; // barra/losango: largura fixa, altura acompanha
    const rs = GL_ROUND_SKIN_RADIUS[noteShape];
    if (rs) {
        sx = sy = Math.min(laneW / 2 - rs[0], nh * rs[1]) / Math.max(0.001, Math.min(laneW / 2 - rs[0], nhMax * rs[1]));
    }
    const now = performance.now();
    const rot = noteShape === 'hex' ? (now / 900) % (Math.PI * 2) : noteShape === 'sk_seatus' ? (now / 700) % (Math.PI * 2) : noteShape === 'sk_vinil' ? (now / 260) % (Math.PI * 2) : 0;
    const d = { tex, x: xCenter, y: noteY, o: { alpha: spawnT * (R.alpha == null ? 1 : R.alpha), rot, sx, sy } }; // R.alpha = FADER
    if (queue) queue.push(d); else R.sprite(d.tex, d.x, d.y, d.o);
    if (noteShape === 'pulse') {
        const radius = Math.min(laneW / 2 - 2, nh * 0.9);
        const cyc = (now / 480) % 1;
        const rr = radius * (0.9 + cyc * 0.9);
        R.ring(xCenter, noteY, rr, rr, 2, glWithAlpha(color, 0.5 * (1 - cyc) * spawnT));
    }
}

// Hold na gear clássica: a cápsula é "assada" uma vez e esticada em 3 fatias (ponta de
// cima, meio, ponta de baixo), então qualquer comprimento fica perfeito.
function glDrawClassicHold(R, lane, headY, tailY, column, isActive) {
    const color = getKeyColorScheme(currentMode, gearSkin)[lane];
    const laneW = column.width;
    const xCenter = column.x + laneW / 2;
    const bw = Math.min(laneW - 10, 74);
    const r = bw / 2;
    const PAD = isActive ? 44 : 16;
    const Lb = bw * 2 + 8;
    const lw = bw + PAD * 2, lh = Lb + PAD * 2;
    const tex = glGetSprite(`hC|${color}|${laneW.toFixed(2)}|${isActive ? 1 : 0}`, lw, lh, 0, 0, () => {
        drawHoldNote(lane, PAD + Lb, PAD, { x: lw / 2 - laneW / 2, width: laneW }, isActive);
    });
    const top = Math.min(headY, tailY);
    const height = Math.max(r * 2, Math.max(headY, tailY) - top);
    const bottom = top + height;
    const x0 = xCenter - lw / 2;
    R.spriteSub(tex, 0, 0, lw, PAD + r, x0, top - PAD, lw, PAD + r);
    R.spriteSub(tex, 0, lh / 2 - 0.5, lw, 1, x0, top + r, lw, Math.max(0, height - 2 * r));
    R.spriteSub(tex, 0, lh - PAD - r, lw, PAD + r, x0, bottom - r, lw, PAD + r);
}

// Faixa da SIDE TRACK / TRACK L/R. `glow` (0..1) vem animado (acende e apaga suave, ver
// sideGlowStep): a faixa nasce esfumada em cima, tem a "cabeça" brilhante embaixo (a borda que
// marca o tempo, igual a uma nota), faixas de luz descendo por dentro e, segurando, uma onda de
// energia subindo da linha.
function glDrawSideOverlay(R, rect, headY, tailY, glow, color, label, held) {
    const top = Math.min(headY, tailY);
    const bottom = Math.max(headY, tailY);
    const h = Math.max(2, bottom - top);
    const x = rect.x, w = rect.width;
    const now = performance.now();
    const base = 0.12 + 0.2 * glow;
    const fade = Math.min(90, h * 0.45);
    R.rectV(x, top, w, fade, glWithAlpha(color, 0), glWithAlpha(color, base));
    if (h > fade) R.rect(x, top + fade, w, h - fade, glWithAlpha(color, base));
    // luzes descendo por dentro da faixa
    R.additive && 0;
    const prevAdd = R._additive; R._additive = true;
    for (let k = 0; k < 3; k++) {
        const ph = ((now / 900) + k / 3) % 1;
        const by = top + ph * h;
        const bh = Math.min(46, h * 0.3);
        R.rectV(x, by - bh, w, bh, glWithAlpha(color, 0), glWithAlpha(color, (0.05 + 0.1 * glow) * Math.sin(ph * Math.PI)));
    }
    R._additive = prevAdd;
    // bordas laterais
    const ea = 0.45 + 0.45 * glow;
    R.rectV(x + 2, top, 2.5, Math.min(fade, h), glWithAlpha(color, 0), glWithAlpha(color, ea));
    R.rectV(x + w - 4.5, top, 2.5, Math.min(fade, h), glWithAlpha(color, 0), glWithAlpha(color, ea));
    if (h > fade) {
        R.rect(x + 2, top + fade, 2.5, h - fade, glWithAlpha(color, ea));
        R.rect(x + w - 4.5, top + fade, 2.5, h - fade, glWithAlpha(color, ea));
        R.glowLine(x + 3, top + fade, x + 3, bottom, 2, color, 6 + 10 * glow, 0.25 + 0.3 * glow);
        R.glowLine(x + w - 3, top + fade, x + w - 3, bottom, 2, color, 6 + 10 * glow, 0.25 + 0.3 * glow);
    }
    // cabeça (borda de baixo) — é ela que marca o tempo de apertar
    if (!held) {
        R.rectV(x + 4, bottom - 12, w - 8, 12, glWithAlpha('#ffffff', 0.85), glWithAlpha(color, 0.95));
        R.glowRect(x + 4, bottom - 12, w - 8, 12, color, 10, 0.4);
    }
    if (h > 70) {
        const labelY = Math.max(top + fade * 0.6 + 18, Math.min(bottom - 22, (top + bottom) / 2));
        glText(R, label, x + w / 2, labelY, '900 18px Orbitron', '#ffffff', { alpha: 0.35 + 0.35 * glow });
    }
}

// Onda de energia na linha enquanto segura a faixa (mais forte = mais emoção)
function glDrawSideHeldEnergy(R, rect, targetY, glow, color) {
    if (glow < 0.02) return;
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(now / 80);
    const prevAdd = R._additive; R._additive = true;
    R.rectV(rect.x, targetY - 150, rect.width, 150, glWithAlpha(color, 0), glWithAlpha(color, (0.22 + 0.12 * pulse) * glow));
    R.rect(rect.x + 4, targetY - 4, rect.width - 8, 8, glWithAlpha('#ffffff', (0.55 + 0.35 * pulse) * glow));
    R.glowRect(rect.x + 4, targetY - 4, rect.width - 8, 8, color, 18, 0.5 * glow);
    R._additive = prevAdd;
}

// Depois que a faixa acaba (soltou certo, quebrou ou passou direto): ela não some de uma vez —
// o resto apaga suave; no acerto, um clarão largo sobe da linha.
function glDrawSideFx(R, dt) {
    const targetY = canvas.logicalHeight - 80;
    sideFx.forEach(f => {
        const t = 1 - f.life;
        const col = f.kind === 'ok' ? f.color : '#ef4444';
        const top = f.top, bottom = Math.max(f.top + 2, f.bottom);
        R.rect(f.x, top, f.w, bottom - top, glWithAlpha(col, 0.22 * f.life * (f.kind === 'ok' ? 1 : 0.8)));
        if (f.kind === 'ok') {
            const prevAdd = R._additive; R._additive = true;
            const hh = 60 + 220 * t;
            R.rectV(f.x, targetY - hh, f.w, hh, glWithAlpha(col, 0), glWithAlpha(col, 0.55 * f.life));
            R.rect(f.x, targetY - 5, f.w, 10, glWithAlpha('#ffffff', 0.9 * f.life));
            R.glowRect(f.x, targetY - 5, f.w, 10, col, 24 * f.life + 4, 0.6 * f.life);
            R._additive = prevAdd;
        }
        f.life -= (f.kind === 'ok' ? 0.045 : 0.06) * dt;
    });
    sideFx = sideFx.filter(f => f.life > 0);
}

// Clarão largo do acerto na side track (no lugar da explosão redonda de uma lane só)
function glDrawWideFlash(R, f) {
    const t = 1 - f.life;
    const prevAdd = R._additive; R._additive = true;
    const hh = 40 + 160 * t;
    R.rectV(f.x - f.wide / 2, f.y - hh, f.wide, hh, glWithAlpha(f.color, 0), glWithAlpha(f.color, 0.6 * f.life));
    R.rect(f.x - f.wide / 2, f.y - 6, f.wide, 12, glWithAlpha('#ffffff', 0.95 * f.life));
    R.glowRect(f.x - f.wide / 2, f.y - 6, f.wide, 12, f.color, 30 * f.life + 6, 0.55 * f.life);
    R._additive = prevAdd;
}

function glDrawClassicSideWarning(R, rect, isLeft, pulseT, introT) {
    const y = canvas.logicalHeight * SIDE_WARNING_Y_FRAC;
    const fadeIn = Math.min(1, introT / 0.25);
    const slowPulse = 0.78 + 0.22 * Math.sin(pulseT * Math.PI * 2);
    const alpha = fadeIn * slowPulse;
    if (alpha <= 0.02) return;
    const boxW = Math.min(rect.width * 0.94, 420);
    const boxH = 78;
    const boxX = rect.x + rect.width / 2 - boxW / 2;
    const M = 30;
    const tex = glGetSprite(`cWarn|${isLeft ? 'L' : 'R'}|${boxW.toFixed(1)}|${rect.x.toFixed(1)}`, boxW + M * 2, boxH + M * 2, 0, 0, (b) => {
        b.translate(-(boxX - M), -(y - boxH / 2 - M));
        drawSideTrackWarning(rect, isLeft, 0.25, 1); // brilho máximo; a GPU aplica o pulso
    });
    R.sprite(tex, boxX - M, y - boxH / 2 - M, { alpha });
}

function glDrawClassicNotes(R, currentTime, speedFactor, dt) {
    const W = canvas.logicalWidth, H = canvas.logicalHeight;
    const columns = getGameplayColumnLayout(currentMode, W);
    const sideIdx = getSideLaneIndices(currentMode);
    const trackLRIdx = getTrackLRIndices(currentMode);
    const targetY = H - 80;
    const noteHeight = NOTE_HEIGHT_BASE * noteSizeScale;
    const colors = getKeyColorScheme(currentMode, gearSkin);
    const tapQueue = [];

    const SIDE_WARNING_LEAD_MS = 1600;
    if (sideIdx) {
        notes.forEach(note => {
            if (note.lane !== sideIdx[0] && note.lane !== sideIdx[1]) return;
            if (note.hit || note.missed || note.holdResolved) return;
            const timeToStart = note.time - currentTime;
            if (timeToStart > 0 && timeToStart < SIDE_WARNING_LEAD_MS) {
                const rect = getSideOverlayRect(W, note.lane === sideIdx[0]);
                const elapsedFrac = 1 - timeToStart / SIDE_WARNING_LEAD_MS;
                glDrawClassicSideWarning(R, rect, note.lane === sideIdx[0], elapsedFrac * 1.2, elapsedFrac);
            }
        });
    }

    notes.forEach(note => {
        const isHold = !!note.holdEnd;
        const isSideLane = !!sideIdx && (note.lane === sideIdx[0] || note.lane === sideIdx[1]);
        const isTrackLRLane = !!trackLRIdx && (note.lane === trackLRIdx[0] || note.lane === trackLRIdx[1]);
        const isOverlayLane = isSideLane || isTrackLRLane;
        const overlayPair = isSideLane ? sideIdx : trackLRIdx;
        const column = isOverlayLane ? getSideOverlayRect(W, note.lane === overlayPair[0]) : columns[note.lane];
        const overlayColor = isTrackLRLane ? TRACK_LR_COLOR : SIDE_NOTE_COLOR;
        const overlayLabel = isTrackLRLane ? 'TRACK L/R' : 'SIDE TRACK';

        if (!advanceNoteLifecycle(note, frameLogicT)) return;
        if (note.ghost) return; // calibração "só ouvindo": nota invisível

        const noteY = modNoteY(note.time - currentTime, speedFactor, note.lane, targetY);
        const fadeHold = isHold && typeof modFadeOutHolds === 'function' && modFadeOutHolds();
        R.alpha = fadeHold
            ? modNoteAlpha(modNoteY(note.holdEnd - currentTime, speedFactor, note.lane, targetY), targetY, renderClockMs) // longa: vale a cauda
            : modNoteAlpha(isHold && note.hit ? targetY : noteY, targetY, renderClockMs);
        if (R.alpha < 0.01 && !note.holdActive) { R.alpha = 1; return; }
        if (isHold) {
            const tailY = modNoteY(note.holdEnd - currentTime, speedFactor, note.lane, targetY);
            let headY = note.hit ? targetY : noteY;
            if (fadeHold) headY = Math.min(headY, modFadeZeroY(targetY)); // corta onde o fade termina
            if (isOverlayLane) {
                const glow = sideGlowStep(note, dt * 16.67);
                note._ov = { x: column.x, w: column.width, top: Math.min(headY, tailY), bottom: Math.max(headY, tailY), color: overlayColor };
                glDrawSideOverlay(R, column, headY, tailY, glow, overlayColor, overlayLabel, note.hit);
                if (note.holdActive || glow > 0.02) glDrawSideHeldEnergy(R, column, targetY, glow, overlayColor);
            } else glDrawClassicHold(R, note.lane, headY, tailY, column, note.holdActive);

            if (note.holdActive && isOverlayLane) {
                // faíscas subindo pela largura toda da faixa
                const sparkChance = Math.min(1, 0.8 * dt);
                for (let s = 0; s < 4; s++) {
                    if (Math.random() < sparkChance) {
                        hitParticles.push({
                            x: column.x + 8 + Math.random() * (column.width - 16), y: targetY,
                            vx: (Math.random() - 0.5) * 1.5, vy: -4 - Math.random() * 5,
                            life: 0.9, color: overlayColor
                        });
                    }
                }
            } else if (note.holdActive) {
                const color = colors[note.lane];
                const cx = column.x + column.width / 2;
                const pulse = 0.5 + Math.sin(currentTime / 90) * 0.5;
                const rr = 18 + pulse * 6;
                const a = 0.5 + pulse * 0.4;
                R.ring(cx, targetY, rr, rr, 4, glWithAlpha(color, a));
                R.ringGlow(cx, targetY, rr, rr, 4, color, 14 + pulse * 10, a * 0.55);
                const sparkChance = Math.min(1, 0.6 * dt);
                for (let s = 0; s < 3; s++) {
                    if (Math.random() < sparkChance) {
                        hitParticles.push({
                            x: cx + (Math.random() - 0.5) * (column.width - 16), y: targetY,
                            vx: (Math.random() - 0.5) * 3, vy: -3 - Math.random() * 3,
                            life: 0.8, color
                        });
                    }
                }
            }
        } else if (isOverlayLane) {
            if (noteY > -80 && noteY < H + 50) {
                note._ov = { x: column.x, w: column.width, top: noteY - 24, bottom: noteY + 24, color: overlayColor };
                glDrawSideOverlay(R, column, noteY - 24, noteY + 24, isTrackLRLane ? 0.6 : 0.25, overlayColor, overlayLabel, false);
            }
        } else if (noteY > -50 && noteY < H + 50) {
            glDrawClassicNote(R, note.lane, noteY, column, noteHeight, speedFactor, tapQueue);
        }
    });

    R.alpha = 1; // FADER: volta ao normal
    // notas comuns por cima de tudo, agrupadas por textura (poucas chamadas pra GPU)
    tapQueue.sort((a, b) => (a.tex.id - b.tex.id));
    for (const d of tapQueue) R.sprite(d.tex, d.x, d.y, d.o);
    glDrawSideFx(R, dt);
}

// ---------- Gear 3D (reta e inclinada) ----------
function glQuadPts(proj, u0, u1, z0, z1) {
    const y0 = proj.yOfZ(z0), y1 = proj.yOfZ(z1);
    // ordem: cima-esq, cima-dir, baixo-dir, baixo-esq (z1 é o mais longe = em cima)
    return [proj.xOf(u0, z1), y1, proj.xOf(u1, z1), y1, proj.xOf(u1, z0), y0, proj.xOf(u0, z0), y0];
}

function glBakeHighwayTrack(b, proj) {
    const { xOf, yOfZ, zFar, zPast, strikeY, topY } = proj;
    const mainCols = getGameplayColumnLayout(currentMode, 1);
    const quad = (u0, u1, z0, z1) => {
        b.beginPath();
        b.moveTo(xOf(u0, z0), yOfZ(z0));
        b.lineTo(xOf(u1, z0), yOfZ(z0));
        b.lineTo(xOf(u1, z1), yOfZ(z1));
        b.lineTo(xOf(u0, z1), yOfZ(z1));
        b.closePath();
    };
    const body = b.createLinearGradient(0, topY, 0, strikeY);
    body.addColorStop(0, '#070d1c');
    body.addColorStop(1, '#101a30');
    quad(0, 1, zPast, zFar);
    b.fillStyle = body;
    b.fill();
    mainCols.forEach((col, i) => {
        quad(col.x, col.x + col.width, zPast, zFar);
        b.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.05)';
        b.fill();
    });
    mainCols.forEach(col => {
        b.strokeStyle = 'rgba(255,255,255,0.09)';
        b.lineWidth = 1;
        b.beginPath();
        b.moveTo(xOf(col.x, zPast), yOfZ(zPast));
        b.lineTo(xOf(col.x, zFar), yOfZ(zFar));
        b.stroke();
    });
    if (!proj.tilted) {
        [[0, -1], [1, 1]].forEach(([u, dir]) => {
            const x = xOf(u, 0);
            const railW = 10;
            const x0 = dir < 0 ? x : x - railW;
            const g = b.createLinearGradient(x0, 0, x0 + railW, 0);
            g.addColorStop(0, dir < 0 ? '#0b1224' : '#475569');
            g.addColorStop(0.5, '#94a3b8');
            g.addColorStop(1, dir < 0 ? '#475569' : '#0b1224');
            b.fillStyle = g;
            b.globalAlpha = 0.55;
            b.fillRect(x0, topY, railW, yOfZ(zPast) - topY);
            b.globalAlpha = 1;
        });
        [[0, 1], [1, -1]].forEach(([u, dir]) => {
            const x = xOf(u, 0);
            const g = b.createLinearGradient(x, 0, x + dir * 40, 0);
            g.addColorStop(0, 'rgba(0,0,0,0.45)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            b.fillStyle = g;
            b.fillRect(dir > 0 ? x : x - 40, topY, 40, yOfZ(zPast) - topY);
        });
    }
}

function glHighwayRy(proj, span, z, HEAD_DZ) {
    const laneW = proj.xOf(span.u1, z) - proj.xOf(span.u0, z);
    const rx = Math.max(4, laneW * 0.4);
    const ry = Math.min(rx * 0.55, Math.max(2.5, Math.abs(proj.yOfZ(z - HEAD_DZ * 0.9) - proj.yOfZ(z + HEAD_DZ * 0.9)) * 0.75, rx * 0.34));
    return { laneW, rx, ry };
}

// Cabeça da nota na Gear 3D: textura assada em z=0 com o próprio drawGameHighwayGem; na
// inclinada, ela é só escalada conforme a profundidade.
function glDrawHighwayGem(R, proj, span, z, color, HEAD_DZ, pad, t, alpha) {
    const uc = (span.u0 + span.u1) / 2;
    const cx = proj.xOf(uc, z), cy = proj.yOfZ(z);
    const g0 = glHighwayRy(proj, span, 0, HEAD_DZ);
    const head0 = Math.abs(proj.yOfZ(-HEAD_DZ / 2) - proj.yOfZ(HEAD_DZ / 2));
    const lw = g0.laneW * 1.15 + 80;
    const lh = Math.max(g0.laneW * 1.35, head0 * 2.4) + 80;
    const shape = noteShape;
    const key = `nH|${gameView}|${shape}|${color}|${g0.laneW.toFixed(2)}|${head0.toFixed(2)}|${pad.toFixed(4)}`;
    const tex = glGetSprite(key, lw, lh, lw / 2, lh / 2, (b) => {
        if (shape === 'hex') {
            // hexágono "de frente" (sem achatar); a GPU gira e depois achata
            const rr = g0.rx * 0.95;
            const x = lw / 2, y = lh / 2;
            b.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI * 2 * i) / 6;
                const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
                if (i === 0) b.moveTo(px, py); else b.lineTo(px, py);
            }
            b.closePath();
            const gr = b.createRadialGradient(x, y, 1, x, y, g0.rx);
            gr.addColorStop(0, '#ffffff');
            gr.addColorStop(0.45, color);
            gr.addColorStop(1, 'rgba(0,0,0,0.7)');
            b.fillStyle = gr;
            b.shadowColor = color;
            b.shadowBlur = 12;
            b.fill();
            b.shadowBlur = 0;
            b.strokeStyle = color;
            b.lineWidth = 2;
            b.stroke();
            return;
        }
        const x0 = proj.xOf(uc, 0), y0 = proj.yOfZ(0);
        const bp = {
            xOf: (u, zz) => proj.xOf(u, zz) - x0 + lw / 2,
            yOfZ: (zz) => proj.yOfZ(zz) - y0 + lh / 2
        };
        const bquad = (u0, u1, z0, z1) => {
            b.beginPath();
            b.moveTo(bp.xOf(u0, z0), bp.yOfZ(z0));
            b.lineTo(bp.xOf(u1, z0), bp.yOfZ(z0));
            b.lineTo(bp.xOf(u1, z1), bp.yOfZ(z1));
            b.lineTo(bp.xOf(u0, z1), bp.yOfZ(z1));
            b.closePath();
        };
        noteAnimSkipPulseRing = true;
        drawGameHighwayGem(bp, bquad, span, 0, color, HEAD_DZ, pad, 0);
    });

    let sx = 1, sy = 1;
    const g = proj.tilted ? glHighwayRy(proj, span, z, HEAD_DZ) : g0;
    if (proj.tilted) {
        sx = g.laneW / g0.laneW;
        if (shape === 'bar' || shape === 'diamond' || !shape || THIN_NOTE_SHAPES.includes(shape)) {
            sy = Math.abs(proj.yOfZ(z - HEAD_DZ / 2) - proj.yOfZ(z + HEAD_DZ / 2)) / Math.max(0.001, head0);
        } else if (shape === 'orb') {
            sy = sx;
        } else {
            sy = g.ry / g0.ry;
        }
    }
    if (shape === 'hex') {
        const s = g.rx / g0.rx;
        R.sprite(tex, cx, cy, { alpha, sx: s, sy: s, rot: t / 900, squashY: g.ry / g.rx });
    } else {
        R.sprite(tex, cx, cy, { alpha, sx, sy });
    }
    if (shape === 'pulse') {
        const cyc = (t / 480) % 1;
        const k = 0.8 + cyc * 0.7;
        R.ring(cx, cy, g.rx * k, g.ry * k, 2, glWithAlpha(color, 0.55 * (1 - cyc) * alpha));
    }
}

function glDrawHighwaySideWarning(R, proj, lane, isLeft, timeToStart, currentTime) {
    const { xOf, zFar, h } = proj;
    const W = canvas.logicalWidth;
    const span = getGameHighwayLaneSpan(lane);
    const pulse = 0.5 + 0.5 * Math.sin(currentTime / 110);
    const keys = KEY_CONFIGS[currentMode] || [];
    const appear = Math.max(0, Math.min(1, (proj.windowMs + 1600 - timeToStart) / 250));

    R.poly4(glQuadPts(proj, span.u0, span.u1, 0, zFar), glWithAlpha(SIDE_NOTE_COLOR, appear * (0.07 + pulse * 0.1)));

    const y = h * 0.38;
    const z = proj.zOfY(y);
    const edgeX = xOf(isLeft ? 0 : 1, z);
    let cx = isLeft ? Math.max(90, edgeX / 2) : Math.min(W - 90, edgeX + (W - edgeX) / 2);
    let boxW = Math.min(220, Math.max(150, isLeft ? edgeX - 16 : W - edgeX - 16));
    if (!proj.tilted) {
        cx = xOf((span.u0 + span.u1) / 2, z);
        boxW = Math.min(220, xOf(span.u1, z) - xOf(span.u0, z) - 20);
    }
    const M = 44;
    const tex = glGetSprite(`hWarn|${isLeft ? 'L' : 'R'}|${boxW.toFixed(1)}`, boxW + M * 2, 116 + M * 2, boxW / 2 + M, 58 + M, (b) => {
        const x = boxW / 2 + M, yy = 58 + M;
        b.fillStyle = 'rgba(5, 46, 22, 0.85)';
        b.strokeStyle = SIDE_NOTE_COLOR;
        b.lineWidth = 3;
        b.shadowColor = SIDE_NOTE_COLOR;
        b.shadowBlur = 27;
        b.beginPath();
        if (typeof b.roundRect === 'function') b.roundRect(x - boxW / 2, yy - 58, boxW, 116, 14);
        else b.rect(x - boxW / 2, yy - 58, boxW, 116);
        b.fill();
        b.stroke();
        b.shadowBlur = 0;
        b.textAlign = 'center';
        b.fillStyle = '#bbf7d0';
        b.font = 'bold 40px Orbitron, sans-serif';
        b.fillText(isLeft ? '◀◀' : '▶▶', x, yy - 14);
        b.font = 'bold 22px Orbitron, sans-serif';
        b.fillStyle = '#ffffff';
        b.fillText('SIDE TRACK', x, yy + 16);
    });
    const a = appear * (0.75 + pulse * 0.25);
    R.sprite(tex, cx, y, { alpha: a });
    const secs = Math.max(0, timeToStart / 1000).toFixed(1);
    glText(R, `${keys[lane] ? formatKeyCode(keys[lane]) : ''} · ${secs}s`, cx, y + 42, 'bold 14px Orbitron, monospace', '#86efac', { alpha: a });
}

function glDrawHighwayNotes(R, proj, currentTime, colors, dt) {
    const { zOfTime, zFar, strikeY, xOf } = proj;
    const HEAD_DZ = proj.tilted ? 0.05 * noteSizeScale : (NOTE_HEIGHT_BASE * noteSizeScale) / (proj.strikeY - proj.topY);
    const sideIdx = getSideLaneIndices(currentMode);

    if (sideIdx) {
        const upcoming = {};
        notes.forEach(note => {
            if (note.lane !== sideIdx[0] && note.lane !== sideIdx[1]) return;
            if (note.hit || note.missed || note.holdResolved) return;
            const timeToStart = note.time - currentTime;
            if (timeToStart <= 0 || timeToStart > proj.windowMs + 1600) return;
            if (upcoming[note.lane] == null || timeToStart < upcoming[note.lane]) upcoming[note.lane] = timeToStart;
        });
        Object.keys(upcoming).forEach(laneStr => {
            const lane = +laneStr;
            glDrawHighwaySideWarning(R, proj, lane, lane === sideIdx[0], upcoming[lane], currentTime);
        });
    }

    const visible = [];
    notes.forEach(note => {
        if (!advanceNoteLifecycle(note, frameLogicT)) return;
        const zHead = note.hit ? 0 : zOfTime(note.time, currentTime);
        if (zHead > zFar) return;
        const zTail = note.holdEnd ? zOfTime(note.holdEnd, currentTime) : zHead;
        if (zTail < proj.zPast) return;
        visible.push({ note, zHead, zTail });
    });
    visible.sort((a, b) => b.zHead - a.zHead);

    visible.forEach(({ note, zHead, zTail }) => {
        const span = getGameHighwayLaneSpan(note.lane);
        const color = span.overlay ? (span.kind === 'trackLR' ? TRACK_LR_COLOR : SIDE_NOTE_COLOR) : (colors[note.lane] || '#22d3ee');
        const isHold = !!note.holdEnd;

        if (span.overlay) {
            const z0 = Math.max(0, zHead - (isHold ? 0 : HEAD_DZ));
            const z1 = Math.min(zFar, isHold ? zTail : zHead + HEAD_DZ);
            if (z1 <= z0) return;
            const pts = glQuadPts(proj, span.u0 + 0.004, span.u1 - 0.004, z0, z1);
            R.poly4(pts, glWithAlpha(color, note.holdActive ? 0.42 : 0.24));
            R.strokePoly4(pts, 2, glWithAlpha(color, 0.9), note.holdActive ? 14 : 6, 0.4);
            return;
        }

        const inset = (span.u1 - span.u0) * 0.24;
        if (isHold) {
            const z0 = Math.max(0, zHead), z1 = Math.min(zFar, zTail);
            if (z1 > z0) {
                const p = glQuadPts(proj, span.u0 + inset, span.u1 - inset, z0, z1);
                const cNear = glWithAlpha(color, note.holdActive ? 0xee / 255 : 0xaa / 255);
                const cFar = glWithAlpha(color, 0x55 / 255);
                R.quad4(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], cFar, cFar, cNear, cNear);
                if (note.holdActive) {
                    R.glowLine(p[0], p[1], p[6], p[7], 1, color, 12, 0.35);
                    R.glowLine(p[2], p[3], p[4], p[5], 1, color, 12, 0.35);
                }
            }
            if (note.holdActive) {
                const cx = xOf((span.u0 + span.u1) / 2, 0);
                const pulse = 0.5 + Math.sin(currentTime / 90) * 0.5;
                const rx = 26 + pulse * 8;
                const a = 0.5 + pulse * 0.4;
                R.ring(cx, strikeY, rx, rx * 0.42, 4, glWithAlpha(color, a));
                R.ringGlow(cx, strikeY, rx, rx * 0.42, 4, color, 14 + pulse * 10, a * 0.55);
                const laneW = xOf(span.u1, 0) - xOf(span.u0, 0);
                const sparkChance = Math.min(1, 0.6 * dt);
                for (let s = 0; s < 3; s++) {
                    if (Math.random() < sparkChance) {
                        hitParticles.push({ x: cx + (Math.random() - 0.5) * (laneW - 16), y: strikeY, vx: (Math.random() - 0.5) * 3, vy: -3 - Math.random() * 3, life: 0.8, color });
                    }
                }
            }
        }
        if (!note.hit && zHead >= 0 - HEAD_DZ && zHead <= zFar) {
            const pad = (span.u1 - span.u0) * 0.06;
            const alpha = zHead < 0 ? Math.max(0, 1 + zHead / HEAD_DZ) : 1;
            if (alpha > 0.01) glDrawHighwayGem(R, proj, span, zHead, color, HEAD_DZ, pad, currentTime, alpha);
        }
    });
}

function glDrawHighwayScene(R, currentTime, mainColor, dt, withNotes) {
    const proj = getGameHighwayProjection();
    const { xOf, yOfZ, zOfTime, zFar, zPast, strikeY, topY } = proj;
    const W = canvas.logicalWidth, H = canvas.logicalHeight;
    const mode = currentMode;
    const colors = getKeyColorScheme(mode, gearSkin);
    const mainCols = getGameplayColumnLayout(mode, 1);
    const mainCount = getMainLaneCount(mode);

    const themeL = getGearLayout().frame ? getGearLayout() : null;
    if (themeL) {
        drawGearLaneBase(makeGLPainter(R), themeL, true);
    } else {
    // Fundo + pista (faixas, divisórias, trilhos) assados JUNTOS numa textura só. Antes eram
    // 3 camadas de tela inteira (fundo do frame + degradê + pista) e mais um brilho do tamanho
    // de 60% da tela: a placa de vídeo pintava cada pixel ~2x a mais que na gear clássica, e a
    // Gear 3D com as gears antigas rodava bem mais pesada. A opacidade da pista (Configurações)
    // agora vale aqui também, igual às outras gears.
    const track = glGetSprite(`hwT|${gameView}|${mode}|${gearSkin}|${W}x${H}`, W, H, 0, 0, (b) => {
        const g = b.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#01030a'); g.addColorStop(0.55, '#050a18'); g.addColorStop(1, '#0a1022');
        b.fillStyle = g;
        b.fillRect(0, 0, W, H);
        glBakeHighwayTrack(b, proj);
    });
    R.sprite(track, 0, 0, { alpha: 0.3 + 0.7 * laneOpacityPct / 100 });
    // brilho do horizonte (pulsa na batida) — só existe na pista inclinada: na Gear 3D reta a
    // pista cobre a tela toda e ele ficava 100% escondido embaixo dela (pintado à toa)
    if (proj.tilted) {
    const haloH = Math.max(8, Math.min(H, topY + 10 + W * 0.45));
    const halo = glGetSprite(`halo|${mainColor}|${W}x${Math.round(haloH)}|${Math.round(topY)}`, W, haloH, 0, 0, (b) => {
        const g = b.createRadialGradient(W / 2, topY + 10, 10, W / 2, topY + 10, W * 0.45);
        g.addColorStop(0, mainColor + '33');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        b.fillStyle = g;
        b.fillRect(0, 0, W, haloH);
    });
    R.sprite(halo, 0, 0, { alpha: 0.6 + beatPulse * 0.4 });
    }
    }

    // feixe de luz das teclas
    for (let i = 0; i < keyLighting.length; i++) {
        if (!(keyLighting[i] > 0)) continue;
        const span = getGameHighwayLaneSpan(i);
        const c = colors[i] || mainColor;
        const a = keyLighting[i] * (span.overlay ? 0.25 : 0.45);
        const p = glQuadPts(proj, span.u0, span.u1, 0, zFar * 0.55);
        R.quad4(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], glWithAlpha(c, 0), glWithAlpha(c, 0), glWithAlpha(c, a), glWithAlpha(c, a));
        keyLighting[i] -= 0.05 * dt;
    }

    // linhas de batida
    if (isPlaying) {
        const segs = getTempoSegmentsForPattern(currentPatternType);
        const tMin = proj.timeOfZ(0, currentTime), tMax = proj.timeOfZ(zFar, currentTime);
        const measureColor = mainColor + 'aa';
        segs.forEach(seg => {
            const segStart = CUSTOM_CHART_START_DELAY_MS + seg.start;
            const segEnd = CUSTOM_CHART_START_DELAY_MS + seg.end;
            if (segEnd < tMin || segStart > tMax) return;
            let k = Math.max(0, Math.ceil((Math.max(tMin, segStart) - segStart) / seg.msPerBeat));
            for (let guard = 0; guard < 200; guard++, k++) {
                const t = segStart + k * seg.msPerBeat;
                if (t > tMax || t >= segEnd - 0.5) break;
                const z = zOfTime(t, currentTime);
                const isMeasure = k % 4 === 0;
                const lw = (isMeasure ? 2.4 : 1.2) * Math.max(0.4, proj.scaleAt(z));
                const y = yOfZ(z);
                R.line(xOf(0, z), y, xOf(1, z), y, lw, isMeasure ? measureColor : 'rgba(148,163,184,0.22)');
            }
        });
    }

    // bordas brilhando na batida
    const edgeW = 3 + beatPulse * 2;
    if (!themeL) [0, 1].forEach(u => {
        const x0 = xOf(u, zPast), y0 = yOfZ(zPast), x1 = xOf(u, zFar), y1 = yOfZ(zFar);
        R.line(x0, y0, x1, y1, edgeW, mainColor);
        R.glowLine(x0, y0, x1, y1, edgeW, mainColor, 6 + beatPulse * 10, 0.35 + beatPulse * 0.3);
    });

    if (withNotes) glDrawHighwayNotes(R, proj, currentTime, colors, dt);

    if (!proj.tilted) { /* Gear 3D reta: cobertura igual à clássica, desenhada depois das notas */ }
    else if (coverMod === 'sudden') R.poly4(glQuadPts(proj, -0.02, 1.02, zFar * 0.42, zFar), '#060b18');
    else if (coverMod === 'hidden') R.poly4(glQuadPts(proj, -0.02, 1.02, zFar * 0.05, zFar * 0.3), '#060b18');

    if (themeL) {
        drawGearStrikeLine(makeGLPainter(R), themeL, mainColor);
    } else {
        // névoa no fundo
        R.rectV(0, topY - 4, W, 114, 'rgba(1,3,10,1)', 'rgba(1,3,10,0)');
        // linha de acerto
        const sw = 5 + beatPulse * 4;
        const sx0 = xOf(0, 0), sx1 = xOf(1, 0);
        R.line(sx0, strikeY, sx1, strikeY, sw, mainColor);
        R.glowLine(sx0, strikeY, sx1, strikeY, sw, mainColor, 10 + beatPulse * 9, 0.5 + beatPulse * 0.25);
    }

    // teclas apertadas
    const keys = KEY_CONFIGS[mode] || [];
    for (let i = 0; i < keys.length; i++) {
        if (!(keyState && keyState[i])) continue;
        const span = getGameHighwayLaneSpan(i);
        const c = colors[i] || mainColor;
        const a = span.overlay ? 0.35 : 0.8;
        const x = xOf(span.u0, 0) + 3, w = xOf(span.u1, 0) - xOf(span.u0, 0) - 6;
        R.rect(x, strikeY - 4, w, 8, glWithAlpha(c, a));
        R.glowRect(x, strikeY - 4, w, 8, c, 12, a * 0.5);
    }

    // etiquetas das teclas (somem depois que a música começa)
    const labelAlpha = themeL ? 0 : getGameKeyLabelAlpha(currentTime);
    if (labelAlpha > 0.01) {
        const padY = strikeY + 8;
        mainCols.forEach((col, i) => {
            const x0 = xOf(col.x, 0) + 4, x1 = xOf(col.x + col.width, 0) - 4;
            R.rect(x0, padY, x1 - x0, 26, glWithAlpha(colors[i] || mainColor, labelAlpha * 0.35));
            glText(R, keys[i] ? formatKeyCode(keys[i]) : String(i + 1), (x0 + x1) / 2, padY + 19, 'bold 15px Orbitron, monospace', '#f1f5f9', { alpha: labelAlpha });
        });
        for (let i = mainCount; i < keys.length; i++) {
            const span = getGameHighwayLaneSpan(i);
            const x0 = xOf(span.u0, 0) + 4, x1 = xOf(span.u1, 0) - 4;
            const y = padY + 30 + (span.kind === 'side' ? 0 : 14);
            R.rect(x0, y, x1 - x0, 12, glWithAlpha(colors[i] || '#4ade80', labelAlpha * 0.3));
            glText(R, `${span.kind === 'side' ? 'SIDE' : 'TRACK'} ${formatKeyCode(keys[i])}`, (x0 + x1) / 2, y + 10, 'bold 10px monospace', '#e2e8f0', { alpha: labelAlpha });
        }
    }
}

// ---------- frame completo (espelha render() do script.js) ----------
function renderGLFrame(timestamp) {
    const R = glGame.r;
    if (lastFrameTimestamp === null) lastFrameTimestamp = timestamp;
    const dtMs = Math.min(timestamp - lastFrameTimestamp, 100);
    lastFrameTimestamp = timestamp;
    const dt = dtMs / (1000 / 60);

    const W = canvas.logicalWidth, H = canvas.logicalHeight;
    const L = getGearLayout();
    const P = makeGLPainter(R);
    let offX = 0, offY = 0;
    if (missShake > 0) {
        const m = missShake * 7;
        offX = (Math.random() - 0.5) * m;
        offY = (Math.random() - 0.5) * m;
        missShake = Math.max(0, missShake - 0.05 * dt);
    }
    // fundo transparente: atrás da gear aparece a tela (ou a imagem de fundo escolhida)
    R.begin(L.totalW, L.totalH, 0, 0, R.hasAlpha ? 'rgba(0,0,0,0)' : '#020617');
    if (L.frame) {
        // moldura: só as tiras de verdade (pilares + painel de baixo). A textura cobre a gear
        // inteira, mas o miolo (área das lanes) é transparente — desenhar ela toda fazia a placa
        // de vídeo misturar ~500x1000 pixels vazios a cada quadro.
        const fs = gearFrameSpec(L);
        const ft = glGetSprite(fs.key, L.totalW, L.totalH, 0, 0, fs.draw);
        const m = 8, sideW = L.F + m;
        R.spriteSub(ft, 0, 0, sideW, L.H, 0, 0, sideW, L.H);
        R.spriteSub(ft, L.totalW - sideW, 0, sideW, L.H, L.totalW - sideW, 0, sideW, L.H);
        R.spriteSub(ft, 0, L.H, L.totalW, L.totalH - L.H, 0, L.H, L.totalW, L.totalH - L.H);
    }
    // daqui pra baixo: coordenadas da área das lanes (deslocada pela moldura + tremida)
    R.setOffset(L.F + offX, offY);
    if (L.frame) R.scissor(L.F, 0, W, H); // nada da pista vaza pra cima da moldura
    // (a Gear 3D desenha o próprio fundo por cima de tudo — pintar este também era desperdício)
    // (a gear clássica antiga já leva esse fundo dentro da textura das faixas)

    const targetY = H - 80;
    const currentTime = isPlaying ? chartTimeAt(isPaused ? pauseStartTime : (renderClockMs || performance.now())) : 0;
    frameLogicT = isPlaying ? chartTimeAt(isPaused ? pauseStartTime : performance.now()) : 0;

    if (isPlaying && !isPaused) {
        const pulseSegs = getTempoSegmentsForPattern(currentPatternType);
        const rel = currentTime - CUSTOM_CHART_START_DELAY_MS;
        const seg = tempoSegmentAt(pulseSegs, rel);
        const beatIdx = seg.index * 1e6 + Math.floor((rel - seg.start) / seg.msPerBeat);
        if (beatIdx > lastPulseBeatIndex) {
            beatPulse = 1.0;
            lastPulseBeatIndex = beatIdx;
        }
    }

    const useHighway = isGameHighwayView();
    const mainColor = getGearMainColor();

    if (useHighway) {
        if (!isPlaying) glDrawHighwayScene(R, currentTime, mainColor, dt, false);
    } else if (L.frame) {
        drawGearLaneBase(P, L, true);
        const kc = getKeyColorScheme(currentMode, gearSkin);
        const cols = getGameplayColumnLayout(currentMode, W);
        for (let i = 0; i < cols.length; i++) {
            if (keyLighting[i] > 0) {
                R.rectV(cols[i].x, 0, cols[i].width, targetY, glWithAlpha(kc[i], 0), glWithAlpha(kc[i], keyLighting[i] * 0.4));
                keyLighting[i] -= 0.05 * dt;
            }
        }
        drawGearStrikeLine(P, L, mainColor);
    } else {
        glDrawClassicLanes(R, dt);
        const barColor = beatPulse > 0 ? mainColor : '#1e293b';
        R.rect(0, 0, 6, H, barColor);
        R.rect(W - 6, 0, 6, H, barColor);
        const lw = 4 + beatPulse * 4;
        R.line(0, targetY, W, targetY, lw, mainColor);
        if (beatPulse > 0) R.glowLine(0, targetY, W, targetY, lw, mainColor, 12 * beatPulse, 0.55 * beatPulse);
    }
    if (beatPulse > 0) beatPulse -= 0.05 * dt;

    if (isPlaying) {
        const hpSmoothing = 1 - Math.pow(0.001, dtMs / 1000);
        hpDisplayed += (hp - hpDisplayed) * hpSmoothing;
        if (Math.abs(hpDisplayed - hp) < 0.05) hpDisplayed = hp;
        if (!useHighway && !L.frame) glDrawHpBar(R, mainColor);

        const speedSmoothing = 1 - Math.pow(0.0001, dtMs / 1000);
        renderedSpeedFactor += (gameSpeedFactorTarget() - renderedSpeedFactor) * speedSmoothing;
        if (useHighway) {
            // Gear 3D reta: notas desenhadas EXATAMENTE como na clássica (mesmo julgamento visual)
            const flat = gameView !== 'highway_tilt';
            glDrawHighwayScene(R, currentTime, mainColor, dt, !flat);
            if (flat) glDrawClassicNotes(R, currentTime, renderedSpeedFactor, dt);
            if (!L.frame) glDrawHpBar(R, mainColor);
        } else {
            glDrawClassicNotes(R, currentTime, renderedSpeedFactor, dt);
        }
    }

    if (!useHighway || gameView !== 'highway_tilt') {
        if (coverMod === 'sudden') R.rect(0, 0, W, H * 0.45, '#090d16');
        else if (coverMod === 'hidden') R.rect(0, targetY - 200, W, 180, '#090d16');
        else if (coverMod === 'fog' && isPlaying && typeof drawModFog === 'function') drawModFog(R, W, targetY, currentTime);
    }

    if (L.frame && isPlaying) drawGearKeyPanel(P, L, currentTime);

    // explosões/anéis de acerto
    hitFlashes.forEach(f => {
        if (f.wide) {
            glDrawWideFlash(R, f);
        } else if (L.theme) {
            drawGearHitFlash(P, f);
        } else {
            const maxRadius = f.big ? 78 : 55;
            const radius = (1 - f.life) * maxRadius + 8;
            const a = f.life * 0.9;
            const lw = f.big ? 4 : 3;
            R.ring(f.x, f.y, radius, radius, lw, glWithAlpha(f.color, a));
            R.ringGlow(f.x, f.y, radius, radius, lw, f.color, f.big ? 14 : 10, a * 0.6);
            if (f.big) R.ring(f.x, f.y, radius * 1.4, radius * 1.4, 2, glWithAlpha(f.color, f.life * 0.5));
            const coreA = Math.max(0, f.life - 0.6) * 2.2;
            if (coreA > 0.01) R.circle(f.x, f.y, f.big ? 13 : 10, glWithAlpha('#ffffff', Math.min(1, coreA)));
        }
        f.life -= 0.07 * dt;
    });
    hitFlashes = hitFlashes.filter(f => f.life > 0);

    hitParticles.forEach(p => {
        if (p.life > 0) R.ellipse(p.x, p.y, L.theme ? 3 : 4, L.theme ? 3 : 4, glWithAlpha(L.theme ? '#ffffff' : p.color, Math.min(1, p.life)), null, 10);
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= 0.04 * dt;
    });
    hitParticles = hitParticles.filter(p => p.life > 0);

    // HUD estilo DJMAX
    drawGameHud(P, W, H);

    if (isCountingDown) {
        glText(R, countdownText, W / 2, H / 2, '900 72px Orbitron', mainColor, { shadowColor: mainColor, shadowBlur: 20 });
    }
    if (isSongFinished && completionBannerText) {
        const c = completionBannerText.includes('PERFECT') ? '#06b6d4' : completionBannerText === 'GAME OVER' ? '#ef4444' : '#eab308';
        glText(R, completionBannerText, W / 2, H / 2 - 10, '900 38px Orbitron', c, { shadowColor: c, shadowBlur: 25 });
        const subtitle = completionBannerText === 'GAME OVER' ? 'HP ZERADO - PREPARING ANALYSIS...' : 'STAGE CLEAR - PREPARING ANALYSIS...';
        glText(R, subtitle, W / 2, H / 2 + 30, '700 16px Rajdhani', '#ffffff', { shadowColor: c, shadowBlur: 25 });
    }

    // moldura: HP, lâmpadas das side keys, SPEED e score
    R.scissor(null);
    R.setOffset(0, 0);
    if (L.frame) drawGearFrameDynamic(P, L, currentTime);
    if (showFpsMeter && frameStats.text) {
        glText(R, frameStats.text, 10, L.totalH - 14, '600 13px monospace', '#a3e635', { align: 'left' });
    }
    R.end();
}
