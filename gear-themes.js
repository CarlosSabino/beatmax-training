// =====================================================================================
// gear-themes.js — gears com MOLDURA (estilo "Respect V"): pilares laterais, painel de
// teclas embaixo da linha de julgamento, painel inferior com SPEED/score/modo, HP no pilar
// esquerdo, nome do treino na vertical no pilar direito — e o HUD estilo DJMAX (COMBO
// grande no alto, "MAX 100%" dourado, RATE, medidor de timing), que vale pra todas as gears.
//
// Designs ORIGINAIS, só inspirados no estilo geral das gears do jogo (layout, clima, cores).
//
// Geometria: a área das lanes continua EXATAMENTE a mesma de sempre (520x1080 lógicos,
// linha de julgamento em 1000) — canvas.logicalWidth/Height continuam valendo pra toda a
// matemática do jogo. A moldura só ACRESCENTA espaço em volta: GEAR_FRAME_SIDE de cada lado e
// GEAR_FRAME_BOTTOM embaixo (canvas.totalWidth/totalHeight). Nada de timing/velocidade muda.
//
// Tudo que é fixo (pilares, painel, corpo da pista, botões) é desenhado uma vez com Canvas 2D
// e reaproveitado: vira textura no WebGL (game-gl.js) ou imagem pronta no Canvas 2D.
// =====================================================================================

const GEAR_FRAME_SIDE = 30;
const GEAR_FRAME_BOTTOM = 128;
// PROPORÇÃO DA GEAR
//  'arcade'  (padrão): igual aos jogos de teclas de arcade — pista mais curta e mais larga,
//            linha de julgamento em ~70% da altura da tela (mais perto do meio, onde o olho fica)
//            e painel de baixo maior. Pista 520x863 (linha em 783) + painel de 260.
//  'classica': a de antes — pista 520x1080 (linha em 1000) + painel de 128.
// A velocidade continua sendo "tempo na tela": SPEED 6.5 mostra a nota pelo mesmo tempo nas duas.
const GEAR_PROP_KEY = 'djmaxTrainerGearProp_v1';
let gearProportion = 'arcade';
try { gearProportion = localStorage.getItem(GEAR_PROP_KEY) === 'classica' ? 'classica' : 'arcade'; } catch (e) {}
const GEAR_PROPS = { arcade: { H: 863, P: 260 }, classica: { H: 1080, P: 128 } };
function gearProp() { return GEAR_PROPS[gearProportion] || GEAR_PROPS.arcade; }
// deslocamento do conteúdo do painel de baixo (SPEED, score, modo) pra ficar centralizado
function gearPanelOffset(L) { return Math.max(0, Math.round(((L && L.P) || GEAR_FRAME_BOTTOM) - GEAR_FRAME_BOTTOM) * 0.45); }
function setGearProportion(v) {
    gearProportion = v === 'classica' ? 'classica' : 'arcade';
    try { localStorage.setItem(GEAR_PROP_KEY, gearProportion); } catch (e) {}
    try { if (typeof glResetGearCache === 'function') glResetGearCache(); } catch (e) {}
    try { if (typeof sprite2DCache !== 'undefined') sprite2DCache.clear(); } catch (e) {}
    try { resizeCanvas(); } catch (e) {}
}

// Cada gear: paleta das notas, corpo da pista, pilares, painel e botões.
const GEAR_THEMES = {
    respect: {
        label: 'Grafite',
        accent: '#fbbf24',
        palette: { edge: '#e5e7eb', altA: '#38bdf8', altB: '#cbd5e1', center: '#facc15' },
        body: { top: '#101216', bottom: '#1b1d22', glow: '#f59e0b', glowAlpha: 0.42, laneTint: 0.028, divider: 'rgba(255,255,255,0.07)' },
        pillar: { style: 'metal', lo: '#17191e', mid: '#3f444d', hi: '#8b929c', trim: '#d1d5db', text: '#9ca3af' },
        panel: { base: '#15171b', hi: '#2d3139', trim: '#9ca3af', box: '#be123c', text: '#e5e7eb' },
        keys: { top: '#2a2d33', bottom: '#131418', edge: '#4b5058', icon: '#6b7280' },
        line: ['#ffffff', '#d1d5db', '#8b929c']
    },
    clockwork: {
        label: 'Relojoaria (dourado)',
        accent: '#eab308',
        palette: { edge: '#93c5fd', altA: '#fdba74', altB: '#bfdbfe', center: '#fde68a' },
        body: { top: '#191613', bottom: '#2a241b', glow: '#fcd34d', glowAlpha: 0.5, laneTint: 0.03, divider: 'rgba(253,230,138,0.08)' },
        pillar: { style: 'filigree', lo: '#6b5327', mid: '#d9c7a0', hi: '#f6ecd4', trim: '#eab308', text: '#6b5327' },
        panel: { base: '#231d14', hi: '#6b5327', trim: '#eab308', box: '#a16207', text: '#fef3c7' },
        keys: { top: '#3a3122', bottom: '#1c1710', edge: '#a16207', icon: '#ca8a04' },
        line: ['#fffbeb', '#fde68a', '#b45309']
    },
    prism: {
        label: 'Prisma (rosa/ciano)',
        accent: '#f0abfc',
        palette: { edge: '#f1f5f9', altA: '#f0abfc', altB: '#a5f3fc', center: '#fde047' },
        body: { top: '#18161d', bottom: '#2a2330', glow: '#fbbf24', glowAlpha: 0.38, laneTint: 0.03, divider: 'rgba(255,255,255,0.07)' },
        pillar: { style: 'prism', lo: '#3b2a4a', mid: '#f0abfc', hi: '#67e8f9', trim: '#ffffff', text: '#fdf4ff' },
        panel: { base: '#1e1a26', hi: '#f0abfc', trim: '#67e8f9', box: '#db2777', text: '#fdf4ff' },
        keys: { top: '#2c2735', bottom: '#15121b', edge: '#6b5a7e', icon: '#c4b5fd' },
        line: ['#ffffff', '#f5d0fe', '#a5f3fc']
    },
    hazard: {
        label: 'Alerta (vermelho)',
        accent: '#38bdf8',
        palette: { edge: '#60a5fa', altA: '#f472b6', altB: '#93c5fd', center: '#fbbf24' },
        body: { top: '#0b1022', bottom: '#131a33', glow: '#3b82f6', glowAlpha: 0.4, laneTint: 0.03, divider: 'rgba(147,197,253,0.08)' },
        pillar: { style: 'hazard', lo: '#450a0a', mid: '#b91c1c', hi: '#ef4444', trim: '#fca5a5', text: '#fecaca' },
        panel: { base: '#3b0a0a', hi: '#b91c1c', trim: '#fca5a5', box: '#1d4ed8', text: '#fee2e2' },
        keys: { top: '#2a1418', bottom: '#12080a', edge: '#7f1d1d', icon: '#f87171' },
        line: ['#ffffff', '#fecaca', '#ef4444']
    },
    stage: {
        label: 'Palco (industrial)',
        accent: '#facc15',
        palette: { edge: '#fbbf24', altA: '#fb923c', altB: '#fde68a', center: '#f87171' },
        body: { top: '#10141a', bottom: '#1c232c', glow: '#facc15', glowAlpha: 0.45, laneTint: 0.025, divider: 'rgba(250,204,21,0.07)' },
        pillar: { style: 'truss', lo: '#0f1115', mid: '#30343b', hi: '#5b616b', trim: '#facc15', text: '#fde68a' },
        panel: { base: '#1a1510', hi: '#3a2f1f', trim: '#f59e0b', box: '#b45309', text: '#fef3c7' },
        keys: { top: '#2b2419', bottom: '#14100b', edge: '#78350f', icon: '#f59e0b' },
        line: ['#fffbeb', '#fde047', '#ca8a04']
    },
    neon: {
        label: 'Neon Roxo',
        accent: '#e879f9',
        palette: { edge: '#fde047', altA: '#a855f7', altB: '#facc15', center: '#f0abfc' },
        body: { top: '#07050c', bottom: '#150d1f', glow: '#facc15', glowAlpha: 0.48, laneTint: 0.03, divider: 'rgba(216,180,254,0.08)' },
        pillar: { style: 'neon', lo: '#1e0b36', mid: '#6d28d9', hi: '#a855f7', trim: '#ffffff', text: '#faf5ff' },
        panel: { base: '#1a0b2e', hi: '#7e22ce', trim: '#f0abfc', box: '#c026d3', text: '#faf5ff' },
        keys: { top: '#221433', bottom: '#0d0716', edge: '#6b21a8', icon: '#c084fc' },
        line: ['#ffffff', '#f5d0fe', '#c084fc']
    }
};

// cores das notas das gears novas (mesmo formato de SKIN_PALETTES do script.js)
Object.keys(GEAR_THEMES).forEach(k => {
    SKIN_PALETTES[k] = Object.assign({ side: SIDE_NOTE_COLOR }, GEAR_THEMES[k].palette);
});

function getGearTheme() {
    return GEAR_THEMES[gearSkin] || null;
}

// Layout da tela: com moldura (gears novas, visual clássico ou Gear 3D reta) ou sem.
function getGearLayout() {
    const th = gameView !== 'highway_tilt' ? getGearTheme() : null;
    const W = canvas.logicalWidth, H = canvas.logicalHeight;
    if (!th) return { frame: false, F: 0, P: 0, W, H, totalW: W, totalH: H, theme: null };
    const PB = gameView !== 'highway_tilt' ? gearProp().P : GEAR_FRAME_BOTTOM;
    return { frame: true, F: GEAR_FRAME_SIDE, P: PB, W, H, totalW: W + GEAR_FRAME_SIDE * 2, totalH: H + PB, theme: th };
}

function getGameStrikeY() {
    return canvas.logicalHeight - 80;
}

// ---------- cores CSS <-> arrays ----------
function cssOfColor(c) {
    if (!Array.isArray(c)) return c;
    return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3] == null ? 1 : c[3]})`;
}

function hexToRgba(hex, a) {
    const p = glParseColor(hex);
    return `rgba(${Math.round(p[0] * 255)},${Math.round(p[1] * 255)},${Math.round(p[2] * 255)},${a})`;
}

// ---------- "assar" desenho 2D num canvas (serve pros dois renderizadores) ----------
function gearPixelScale() {
    return Math.max(0.25, canvas.width / (canvas.totalWidth || canvas.logicalWidth));
}

function bakeCanvas(lw, lh, drawFn) {
    const s = gearPixelScale();
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
        console.warn('[gear] falha ao preparar imagem', e);
    } finally {
        ctx = savedCtx;
        noteAnimClockOverride = null;
        noteAnimSkipPulseRing = false;
    }
    return c;
}

// cache das imagens prontas pro Canvas 2D (o WebGL guarda textura, ver glGetSprite)
const sprite2DCache = new Map();
let sprite2DScale = 0;
function get2DSprite(spec) {
    const s = gearPixelScale();
    if (Math.abs(s - sprite2DScale) > 0.001) { sprite2DCache.clear(); sprite2DScale = s; }
    let e = sprite2DCache.get(spec.key);
    if (e) {
        sprite2DCache.delete(spec.key);
        sprite2DCache.set(spec.key, e);
        return e;
    }
    e = { c: bakeCanvas(spec.lw, spec.lh, spec.draw), lw: spec.lw, lh: spec.lh, ax: spec.ax || 0, ay: spec.ay || 0 };
    sprite2DCache.set(spec.key, e);
    while (sprite2DCache.size > 300) sprite2DCache.delete(sprite2DCache.keys().next().value);
    return e;
}
if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => {
        for (const k of [...sprite2DCache.keys()]) if (k.startsWith('t|') || k.startsWith('gF|')) sprite2DCache.delete(k);
        clearTextMetricsMemo();
    });
}

// Texto como "sprite": mede, e devolve o desenho + âncora (ponto do textAlign na linha de base).
// o: align, shadowColor, shadowBlur, gradient [[t,cor]...] (vertical), stroke {color,width}
let textMeasureCtx = null;
// Medir texto (measureText) a cada quadro custa: guarda a "receita" pronta por chave.
const textSpecMemo = new Map();
const charAdvanceMemo = new Map();
function clearTextMetricsMemo() { textSpecMemo.clear(); charAdvanceMemo.clear(); }
function textSpriteSpec(text, font, color, o) {
    o = o || {};
    text = String(text);
    const align = o.align || 'center';
    const sc = o.shadowColor || '';
    const sb = o.shadowBlur || 0;
    const grad = o.gradient ? (o.gradient._k || (o.gradient._k = JSON.stringify(o.gradient))) : '';
    const st = o.stroke ? `${o.stroke.color}/${o.stroke.width}` : '';
    const key = `t|${font}|${color}|${sc}|${sb}|${align}|${grad}|${st}|${text}`;
    const memo = textSpecMemo.get(key);
    if (memo) return memo;
    if (textSpecMemo.size > 1500) textSpecMemo.clear();
    const spec = buildTextSpriteSpec(key, text, font, color, o, align, sc, sb);
    textSpecMemo.set(key, spec);
    return spec;
}
function buildTextSpriteSpec(key, text, font, color, o, align, sc, sb) {
    if (!textMeasureCtx) textMeasureCtx = document.createElement('canvas').getContext('2d');
    textMeasureCtx.font = font;
    const m = textMeasureCtx.measureText(text);
    const size = parseFloat((font.match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 16;
    const ascent = Math.max(m.actualBoundingBoxAscent || 0, size * 0.8);
    const descent = Math.max(m.actualBoundingBoxDescent || 0, size * 0.22);
    const tw = Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0), 1) + size * 0.15;
    const sw = o.stroke ? o.stroke.width : 0;
    const pad = Math.ceil(sb * 1.6 + sw) + 4;
    const lw = tw + pad * 2, lh = ascent + descent + pad * 2;
    const ax = align === 'left' ? pad : align === 'right' ? pad + tw : pad + tw / 2;
    const ay = pad + ascent;
    o = { gradient: o.gradient, stroke: o.stroke };
    return {
        key, lw, lh, ax, ay,
        draw: (b) => {
            b.font = font;
            b.textAlign = align;
            b.textBaseline = 'alphabetic';
            let fill = color;
            if (o.gradient) {
                const g = b.createLinearGradient(0, ay - ascent, 0, ay + descent);
                o.gradient.forEach(([t, c]) => g.addColorStop(t, c));
                fill = g;
            }
            if (sb > 0) { b.shadowColor = sc || color; b.shadowBlur = sb; }
            if (o.stroke) {
                b.lineJoin = 'round';
                b.strokeStyle = o.stroke.color;
                b.lineWidth = o.stroke.width;
                b.strokeText(text, ax, ay);
                b.shadowBlur = 0;
            }
            b.fillStyle = fill;
            b.fillText(text, ax, ay);
        }
    };
}

// Números que mudam o tempo todo (combo, score, RATE, SPEED): cada valor novo virava uma
// textura nova (canvas criado + envio pra placa de vídeo) várias vezes por segundo — dá
// "engasgo" em PC/placa mais fraca. Agora o número é montado com uma textura por dígito,
// que fica pronta depois do primeiro uso.
const COMPOSED_TEXT_RE = /^[0-9.,%:+\-]{2,16}$/;
function charAdvance(font, ch) {
    const k = font + '|' + ch;
    let w = charAdvanceMemo.get(k);
    if (w == null) {
        if (!textMeasureCtx) textMeasureCtx = document.createElement('canvas').getContext('2d');
        textMeasureCtx.font = font;
        w = textMeasureCtx.measureText(ch).width;
        charAdvanceMemo.set(k, w);
    }
    return w;
}
function drawComposedText(drawSpec, text, x, y, font, color, o) {
    o = o || {};
    const align = o.align || 'center';
    const oc = { shadowColor: o.shadowColor, shadowBlur: o.shadowBlur, gradient: o.gradient, stroke: o.stroke, align: 'left' };
    const sx = o.sx != null ? o.sx : 1;
    let total = 0;
    for (let i = 0; i < text.length; i++) total += charAdvance(font, text[i]);
    let cx = align === 'left' ? x : align === 'right' ? x - total * sx : x - total * sx / 2;
    for (let i = 0; i < text.length; i++) {
        drawSpec(textSpriteSpec(text[i], font, color, oc), cx, y, o);
        cx += charAdvance(font, text[i]) * sx;
    }
}

// ---------- "pintor": a mesma chamada desenha no WebGL ou no Canvas 2D ----------
function makeGLPainter(R) {
    return {
        kind: 'gl',
        rect: (x, y, w, h, c) => R.rect(x, y, w, h, c),
        rectV: (x, y, w, h, a, b) => R.rectV(x, y, w, h, a, b),
        line: (x0, y0, x1, y1, w, c) => R.line(x0, y0, x1, y1, w, c),
        glowLine: (x0, y0, x1, y1, w, c, g, a) => R.glowLine(x0, y0, x1, y1, w, c, g, a),
        glowRect: (x, y, w, h, c, g, a) => R.glowRect(x, y, w, h, c, g, a),
        circle: (x, y, r, c) => R.circle(x, y, r, c),
        ring: (x, y, r, w, c) => R.ring(x, y, r, r, w, c),
        sprite: (spec, x, y, o) => R.sprite(glGetSprite(spec.key, spec.lw, spec.lh, spec.ax || 0, spec.ay || 0, spec.draw), x, y, o),
        text: (t, x, y, font, color, o) => {
            const str = String(t);
            const put = (spec, px, py, po) => R.sprite(glGetSprite(spec.key, spec.lw, spec.lh, spec.ax, spec.ay, spec.draw), px, py, po);
            if (COMPOSED_TEXT_RE.test(str)) return drawComposedText(put, str, x, y, font, color, o);
            put(textSpriteSpec(str, font, color, o), x, y, o);
        },
        offset: (dx, dy, fn) => {
            const ox = R.offX, oy = R.offY;
            R.setOffset(ox + dx, oy + dy);
            try { fn(); } finally { R.setOffset(ox, oy); }
        },
        additive: (fn) => {
            const prev = R._additive;
            R._additive = true;
            try { fn(); } finally { R._additive = prev; }
        }
    };
}

function make2DPainter(c) {
    const P = {
        kind: '2d',
        rect: (x, y, w, h, col) => { c.fillStyle = cssOfColor(col); c.fillRect(x, y, w, h); },
        rectV: (x, y, w, h, a, b) => {
            const g = c.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, cssOfColor(a));
            g.addColorStop(1, cssOfColor(b));
            c.fillStyle = g;
            c.fillRect(x, y, w, h);
        },
        line: (x0, y0, x1, y1, w, col) => {
            c.strokeStyle = cssOfColor(col);
            c.lineWidth = w;
            c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        },
        glowLine: () => {},
        glowRect: () => {},
        circle: (x, y, r, col) => { c.fillStyle = cssOfColor(col); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); },
        ring: (x, y, r, w, col) => { c.strokeStyle = cssOfColor(col); c.lineWidth = w; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); },
        sprite: (spec, x, y, o) => {
            const e = get2DSprite(spec);
            o = o || {};
            const sx = o.sx != null ? o.sx : 1, sy = o.sy != null ? o.sy : sx;
            c.save();
            if (o.alpha != null) c.globalAlpha *= o.alpha;
            c.translate(x, y);
            if (o.rot) c.rotate(o.rot);
            c.scale(sx, sy);
            c.drawImage(e.c, -e.ax, -e.ay, e.lw, e.lh);
            c.restore();
        },
        text: (t, x, y, font, color, o) => {
            const str = String(t);
            if (COMPOSED_TEXT_RE.test(str)) return drawComposedText(P.sprite, str, x, y, font, color, o);
            P.sprite(textSpriteSpec(str, font, color, o), x, y, o);
        },
        offset: (dx, dy, fn) => { c.save(); c.translate(dx, dy); try { fn(); } finally { c.restore(); } },
        additive: (fn) => {
            const prev = c.globalCompositeOperation;
            c.globalCompositeOperation = 'lighter';
            try { fn(); } finally { c.globalCompositeOperation = prev; }
        }
    };
    return P;
}

// ---------- partes fixas (assadas) ----------
function gearTitleText() {
    const drill = (typeof DRILLS !== 'undefined' && DRILLS[currentPatternType]) ? DRILLS[currentPatternType] : null;
    let name = drill ? (drill.name || drill.title || currentPatternType) : String(currentPatternType || '');
    if (name.startsWith('custom:') && typeof findCustomChart === 'function') {
        const ch = findCustomChart(name.slice(7));
        name = ch ? (ch.title || ch.name || 'CHART') : 'CHART';
    }
    return String(name).toUpperCase();
}

function roundRectPath(b, x, y, w, h, r) {
    b.beginPath();
    if (typeof b.roundRect === 'function') b.roundRect(x, y, w, h, r);
    else b.rect(x, y, w, h);
}

// pilar de um lado (x0 = borda externa); dir = +1 (esquerdo, lanes à direita) / -1 (direito)
function bakePillar(b, th, x0, w, h, dir) {
    const p = th.pillar;
    const g = b.createLinearGradient(x0, 0, x0 + w, 0);
    const outer = dir > 0 ? 0 : 1, inner = 1 - outer;
    g.addColorStop(outer, p.lo);
    g.addColorStop(0.5, p.mid);
    g.addColorStop(inner * 0.85 + outer * 0.15, p.hi);
    g.addColorStop(inner, p.lo);
    b.fillStyle = g;
    b.fillRect(x0, 0, w, h);

    const innerX = dir > 0 ? x0 + w : x0; // encosta nas lanes
    b.save();
    b.beginPath();
    b.rect(x0, 0, w, h);
    b.clip();
    if (p.style === 'metal') {
        b.strokeStyle = 'rgba(0,0,0,0.35)';
        b.lineWidth = 1;
        for (let y = 40; y < h; y += 64) {
            b.beginPath(); b.moveTo(x0 + 3, y); b.lineTo(x0 + w - 3, y); b.stroke();
            b.fillStyle = 'rgba(255,255,255,0.35)';
            b.beginPath(); b.arc(x0 + w / 2, y + 32, 1.6, 0, Math.PI * 2); b.fill();
        }
    } else if (p.style === 'filigree') {
        b.strokeStyle = p.trim;
        b.lineWidth = 1.4;
        for (let y = 30; y < h; y += 90) {
            const cx = x0 + w / 2;
            b.beginPath(); b.arc(cx, y, w * 0.28, 0, Math.PI * 2); b.stroke();
            b.beginPath(); b.arc(cx, y, w * 0.12, 0, Math.PI * 2); b.stroke();
            b.beginPath();
            b.moveTo(cx, y + w * 0.28);
            b.bezierCurveTo(cx + w * 0.4 * dir, y + 30, cx - w * 0.4 * dir, y + 55, cx, y + 90 - w * 0.28);
            b.stroke();
        }
    } else if (p.style === 'prism') {
        for (let y = -40; y < h; y += 110) {
            b.fillStyle = 'rgba(255,255,255,0.14)';
            b.beginPath();
            b.moveTo(x0, y); b.lineTo(x0 + w, y + 40); b.lineTo(x0 + w, y + 70); b.lineTo(x0, y + 30);
            b.closePath(); b.fill();
            b.fillStyle = 'rgba(0,0,0,0.12)';
            b.beginPath();
            b.moveTo(x0, y + 55); b.lineTo(x0 + w, y + 95); b.lineTo(x0 + w, y + 110); b.lineTo(x0, y + 70);
            b.closePath(); b.fill();
        }
        const vg = b.createLinearGradient(0, 0, 0, h);
        vg.addColorStop(0, 'rgba(240,171,252,0.35)');
        vg.addColorStop(1, 'rgba(103,232,249,0.35)');
        b.fillStyle = vg;
        b.fillRect(x0, 0, w, h);
    } else if (p.style === 'hazard') {
        const bandW = 9;
        const bx = dir > 0 ? x0 + w - bandW - 3 : x0 + 3;
        b.save();
        b.beginPath(); b.rect(bx, 0, bandW, h); b.clip();
        b.fillStyle = '#111827';
        b.fillRect(bx, 0, bandW, h);
        b.fillStyle = '#f59e0b';
        for (let y = -20; y < h + 20; y += 16) {
            b.beginPath();
            b.moveTo(bx, y); b.lineTo(bx + bandW, y - 8); b.lineTo(bx + bandW, y); b.lineTo(bx, y + 8);
            b.closePath(); b.fill();
        }
        b.restore();
    } else if (p.style === 'truss') {
        b.strokeStyle = 'rgba(148,163,184,0.55)';
        b.lineWidth = 2;
        const l = x0 + 5, r = x0 + w - 5;
        b.beginPath(); b.moveTo(l, 0); b.lineTo(l, h); b.moveTo(r, 0); b.lineTo(r, h); b.stroke();
        b.lineWidth = 1.5;
        for (let y = 0; y < h; y += 34) {
            b.beginPath(); b.moveTo(l, y); b.lineTo(r, y + 17); b.lineTo(l, y + 34); b.stroke();
        }
        b.fillStyle = p.trim;
        for (let y = 0; y < h; y += 136) {
            b.fillRect(l - 2, y + 2, r - l + 4, 3);
        }
    } else if (p.style === 'neon') {
        b.fillStyle = 'rgba(255,255,255,0.85)';
        for (let y = 20; y < h; y += 120) {
            b.fillRect(innerX - dir * 7 - 2, y, 4, 60);
        }
    }
    b.restore();

    // friso na borda das lanes + borda externa escura
    b.fillStyle = p.trim;
    b.fillRect(dir > 0 ? x0 + w - 2 : x0, 0, 2, h);
    b.fillStyle = 'rgba(0,0,0,0.6)';
    b.fillRect(dir > 0 ? x0 : x0 + w - 1, 0, 1, h);
}

function bakeGearFrame(b, L) {
    const th = L.theme;
    const { F, W, H, P, totalW, totalH } = L;
    bakePillar(b, th, 0, F, H, 1);
    bakePillar(b, th, F + W, F, H, -1);
    const hs = hudShowFlags();

    // trilho do HP no pilar esquerdo
    if (hs.hp) {
    b.fillStyle = 'rgba(0,0,0,0.55)';
    roundRectPath(b, 9, 70, 12, H - 150, 5);
    b.fill();
    b.strokeStyle = 'rgba(255,255,255,0.18)';
    b.lineWidth = 1;
    b.stroke();
    }

    // lâmpadas das side keys (acendem quando a tecla está apertada — ver drawGearFrameDynamic)
    [F / 2, F + W + F / 2].forEach(x => {
        b.fillStyle = 'rgba(0,0,0,0.6)';
        b.beginPath(); b.arc(x, H - 45, 9, 0, Math.PI * 2); b.fill();
        b.strokeStyle = 'rgba(255,255,255,0.25)';
        b.stroke();
    });

    // nome do treino na vertical, no pilar direito
    if (hs.title) {
    b.save();
    b.translate(F + W + F / 2 + 5, 60);
    b.rotate(Math.PI / 2);
    b.font = '700 15px "Barlow Condensed", Rajdhani, sans-serif';
    b.fillStyle = th.pillar.text;
    b.globalAlpha = 0.8;
    b.textAlign = 'left';
    b.fillText(`${gearTitleText()}  ·  ${getModeDisplayName(currentMode)}  ·  ${typeof difficultyLabel === 'function' ? difficultyLabel() : currentDifficulty}`, 0, 0);
    b.restore();
    }

    // painel inferior
    const y0 = H;
    const pg = b.createLinearGradient(0, y0, 0, totalH);
    pg.addColorStop(0, th.panel.hi);
    pg.addColorStop(0.18, th.panel.base);
    pg.addColorStop(1, th.panel.base);
    b.fillStyle = pg;
    b.beginPath();
    b.moveTo(0, y0);
    b.lineTo(totalW, y0);
    b.lineTo(totalW, totalH - 26);
    b.lineTo(totalW - 26, totalH);
    b.lineTo(26, totalH);
    b.lineTo(0, totalH - 26);
    b.closePath();
    b.fill();
    b.strokeStyle = th.panel.trim;
    b.lineWidth = 2;
    b.stroke();
    // friso em "V" no topo do painel (marca registrada das gears)
    b.strokeStyle = th.panel.trim;
    b.lineWidth = 3;
    b.beginPath();
    b.moveTo(F, y0 + 4);
    b.lineTo(totalW / 2, y0 + 22);
    b.lineTo(F + W, y0 + 4);
    b.stroke();
    if (th.pillar.style === 'prism') {
        b.strokeStyle = th.panel.hi;
        b.lineWidth = 2;
        b.beginPath(); b.moveTo(F, y0 + 12); b.lineTo(totalW / 2, y0 + 30); b.lineTo(F + W, y0 + 12); b.stroke();
    }
    if (th.pillar.style === 'stage') {
        // "caixas de som" decorativas
        [150, totalW - 150].forEach(cx => {
            b.strokeStyle = th.panel.trim;
            b.lineWidth = 3;
            b.beginPath(); b.arc(cx, y0 + 80, 30, 0, Math.PI * 2); b.stroke();
            b.beginPath(); b.arc(cx, y0 + 80, 14, 0, Math.PI * 2); b.stroke();
        });
    }
    if (th.pillar.style === 'truss') {
        b.fillStyle = 'rgba(250,204,21,0.12)';
        for (let i = 0; i < 12; i++) b.fillRect(170 + i * 20, y0 + 96, 14, 18 - (i % 4) * 3);
    }
    if (th.pillar.style === 'filigree') {
        b.strokeStyle = th.panel.trim;
        b.lineWidth = 1.5;
        b.beginPath(); b.arc(totalW / 2, y0 + 150, 110, Math.PI * 1.15, Math.PI * 1.85); b.stroke();
        for (let i = 0; i < 13; i++) {
            const a = Math.PI * 1.15 + (i / 12) * Math.PI * 0.7;
            b.beginPath();
            b.moveTo(totalW / 2 + Math.cos(a) * 100, y0 + 150 + Math.sin(a) * 100);
            b.lineTo(totalW / 2 + Math.cos(a) * 110, y0 + 150 + Math.sin(a) * 110);
            b.stroke();
        }
    }

    if (!hs.panel) return;
    b.save();
    b.translate(0, gearPanelOffset(L)); // painel maior (proporção arcade): conteúdo no meio dele
    // caixa SPEED (o valor é desenhado por cima, dinâmico)
    b.fillStyle = th.panel.box;
    roundRectPath(b, 38, y0 + 36, 76, 72, 8);
    b.fill();
    b.strokeStyle = 'rgba(255,255,255,0.5)';
    b.lineWidth = 1.5;
    b.stroke();
    b.fillStyle = 'rgba(255,255,255,0.85)';
    b.font = '700 12px Orbitron, sans-serif';
    b.textAlign = 'center';
    b.fillText('SPEED', 76, y0 + 54);

    // caixa do modo/dificuldade
    b.fillStyle = 'rgba(0,0,0,0.45)';
    roundRectPath(b, totalW - 114, y0 + 36, 76, 72, 8);
    b.fill();
    b.strokeStyle = th.panel.trim;
    b.stroke();
    b.fillStyle = th.panel.text;
    b.font = '900 30px Orbitron, sans-serif';
    b.fillText(getModeDisplayName(currentMode), totalW - 76, y0 + 78);
    {
        const lbl = typeof difficultyLabel === 'function' ? difficultyLabel() : currentDifficulty;
        let fs = 13; b.font = `700 ${fs}px Orbitron, sans-serif`;
        while (fs > 8 && b.measureText(lbl).width > 70) { fs--; b.font = `700 ${fs}px Orbitron, sans-serif`; }
        b.fillText(lbl, totalW - 76, y0 + 98);
    }

    // "visor" do score no meio
    b.fillStyle = 'rgba(0,0,0,0.5)';
    roundRectPath(b, totalW / 2 - 110, y0 + 42, 220, 34, 6);
    b.fill();
    b.strokeStyle = 'rgba(255,255,255,0.15)';
    b.lineWidth = 1;
    b.stroke();
    b.fillStyle = th.panel.text;
    b.globalAlpha = 0.7;
    b.font = '600 13px Rajdhani, sans-serif';
    b.fillText(gearTitleText(), totalW / 2, y0 + 96);
    b.globalAlpha = 1;
    b.restore();
}

function gearFrameSpec(L) {
    const th = L.theme;
    return {
        key: `gF|${gearSkin}|${currentMode}|${typeof difficultyLabel === 'function' ? difficultyLabel() : currentDifficulty}|${currentPatternType}|${L.totalW}x${L.totalH}|${hudShowKey()}`,
        lw: L.totalW, lh: L.totalH, ax: 0, ay: 0,
        draw: (b) => bakeGearFrame(b, L, th)
    };
}

// corpo da pista (área das lanes, coordenadas das lanes)
function bakeGearBody(b, L, withLanes) {
    const th = L.theme;
    const { W, H } = L;
    const strikeY = getGameStrikeY();
    const op = laneOpacityPct / 100;
    const g = b.createLinearGradient(0, 0, 0, strikeY);
    g.addColorStop(0, hexToRgba(th.body.top, op));
    g.addColorStop(1, hexToRgba(th.body.bottom, op));
    b.fillStyle = g;
    b.fillRect(0, 0, W, strikeY);
    // brilho quente subindo da linha de julgamento
    const gl = b.createLinearGradient(0, strikeY - 380, 0, strikeY);
    gl.addColorStop(0, hexToRgba(th.body.glow, 0));
    gl.addColorStop(1, hexToRgba(th.body.glow, th.body.glowAlpha * Math.max(0.35, op)));
    b.fillStyle = gl;
    b.fillRect(0, strikeY - 380, W, 380);
    if (withLanes) {
        const cols = getGameplayColumnLayout(currentMode, W);
        cols.forEach((col, i) => {
            if (i % 2 === 1) {
                b.fillStyle = `rgba(255,255,255,${th.body.laneTint})`;
                b.fillRect(col.x, 0, col.width, strikeY);
            }
            if (i > 0) {
                b.fillStyle = th.body.divider;
                b.fillRect(col.x - 0.5, 0, 1, strikeY);
            }
        });
    }
    // sombra interna nas bordas (profundidade)
    [[0, 1], [W, -1]].forEach(([x, d]) => {
        const sg = b.createLinearGradient(x, 0, x + d * 26, 0);
        sg.addColorStop(0, 'rgba(0,0,0,0.5)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        b.fillStyle = sg;
        b.fillRect(d > 0 ? x : x - 26, 0, 26, strikeY);
    });
    // painel das teclas (embaixo da linha)
    const kg = b.createLinearGradient(0, strikeY, 0, H);
    kg.addColorStop(0, '#08090b');
    kg.addColorStop(1, '#101114');
    b.fillStyle = kg;
    b.fillRect(0, strikeY + 4, W, H - strikeY - 4);
}

function gearBodySpec(L, withLanes) {
    return {
        key: `gB|${gearSkin}|${currentMode}|${laneOpacityPct}|${withLanes ? 1 : 0}|${L.W}x${L.H}`,
        lw: L.W, lh: L.H, ax: 0, ay: 0,
        draw: (b) => bakeGearBody(b, L, withLanes)
    };
}

function gearStrikeSpec(L) {
    const th = L.theme;
    return {
        key: `gS|${gearSkin}|${L.W}`,
        lw: L.W, lh: 12, ax: 0, ay: 6,
        draw: (b) => {
            const g = b.createLinearGradient(0, 0, 0, 12);
            g.addColorStop(0, th.line[0]);
            g.addColorStop(0.5, th.line[1]);
            g.addColorStop(1, th.line[2]);
            b.fillStyle = g;
            b.fillRect(0, 1, L.W, 10);
            b.fillStyle = 'rgba(255,255,255,0.9)';
            b.fillRect(0, 1, L.W, 1.5);
            b.fillStyle = 'rgba(0,0,0,0.4)';
            b.fillRect(0, 10, L.W, 1);
        }
    };
}

function gearKeySpec(th, w, h, color, pressed, iconKind) {
    return {
        key: `gK|${gearSkin}|${w.toFixed(1)}|${h}|${color}|${pressed ? 1 : 0}|${iconKind}`,
        lw: w + 24, lh: h + 24, ax: 12, ay: 12,
        draw: (b) => {
            const x = 12, y = 12;
            const g = b.createLinearGradient(0, y, 0, y + h);
            if (pressed) {
                g.addColorStop(0, shadeColor(color, 0.55));
                g.addColorStop(1, shadeColor(color, -0.25));
                b.shadowColor = color;
                b.shadowBlur = 14;
            } else {
                g.addColorStop(0, th.keys.top);
                g.addColorStop(1, th.keys.bottom);
            }
            b.fillStyle = g;
            roundRectPath(b, x, y, w, h, 6);
            b.fill();
            b.shadowBlur = 0;
            b.strokeStyle = pressed ? '#ffffff' : th.keys.edge;
            b.lineWidth = 1.5;
            b.stroke();
            // ícone no meio do botão (X nas lanes do meio, estrela nas de fora)
            const cx = x + w / 2, cy = y + h / 2 - 4, r = Math.min(10, w * 0.12);
            b.strokeStyle = pressed ? '#ffffff' : th.keys.icon;
            b.fillStyle = pressed ? '#ffffff' : th.keys.icon;
            b.lineWidth = 2.5;
            b.globalAlpha = pressed ? 1 : 0.75;
            if (iconKind === 'x') {
                b.beginPath();
                b.moveTo(cx - r, cy - r); b.lineTo(cx + r, cy + r);
                b.moveTo(cx + r, cy - r); b.lineTo(cx - r, cy + r);
                b.stroke();
            } else {
                b.beginPath();
                for (let i = 0; i < 8; i++) {
                    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
                    const rr = i % 2 === 0 ? r : r * 0.35;
                    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
                    if (i === 0) b.moveTo(px, py); else b.lineTo(px, py);
                }
                b.closePath();
                b.fill();
            }
        }
    };
}

// Explosão de acerto das gears novas: estrela de 4 pontas branca com brilho (tingida na GPU).
function gearBurstSpec() {
    return {
        key: 'gX|burst', lw: 200, lh: 200, ax: 100, ay: 100,
        draw: (b) => {
            const c = 100;
            const rg = b.createRadialGradient(c, c, 2, c, c, 70);
            rg.addColorStop(0, 'rgba(255,255,255,0.95)');
            rg.addColorStop(0.25, 'rgba(255,255,255,0.45)');
            rg.addColorStop(1, 'rgba(255,255,255,0)');
            b.fillStyle = rg;
            b.fillRect(0, 0, 200, 200);
            b.fillStyle = '#ffffff';
            b.shadowColor = '#ffffff';
            b.shadowBlur = 10;
            [[0, 1], [Math.PI / 2, 1], [Math.PI / 4, 0.55], [-Math.PI / 4, 0.55]].forEach(([a, len]) => {
                b.save();
                b.translate(c, c);
                b.rotate(a);
                b.beginPath();
                b.moveTo(-92 * len, 0);
                b.lineTo(0, -7 * len);
                b.lineTo(92 * len, 0);
                b.lineTo(0, 7 * len);
                b.closePath();
                b.fill();
                b.restore();
            });
        }
    };
}

// ---------- partes que mudam a cada frame ----------
function drawGearLaneBase(P, L, withLanes) {
    P.sprite(gearBodySpec(L, withLanes), 0, 0);
}

function drawGearStrikeLine(P, L, mainColor) {
    const y = getGameStrikeY();
    if (beatPulse > 0) P.glowLine(0, y, L.W, y, 8, L.theme.accent, 6 + beatPulse * 12, 0.35 * beatPulse + 0.15);
    P.sprite(gearStrikeSpec(L), 0, y);
}

function drawGearKeyPanel(P, L, currentTime) {
    const th = L.theme;
    const strikeY = getGameStrikeY();
    const cols = getGameplayColumnLayout(currentMode, L.W);
    const colors = getKeyColorScheme(currentMode, gearSkin);
    const keys = KEY_CONFIGS[currentMode] || [];
    const y = strikeY + 12, h = L.H - strikeY - 20;
    const n = cols.length;
    const labelAlpha = getGameKeyLabelAlpha(currentTime);
    // fundo opaco do painel: a nota que passou da linha some "por baixo" das teclas
    P.rectV(0, strikeY + 6, L.W, L.H - strikeY - 6, '#08090b', '#101114');
    cols.forEach((col, i) => {
        const pressed = !!(keyState && keyState[i]);
        const icon = (n % 2 === 0 ? (i === n / 2 - 1 || i === n / 2) : i === (n - 1) / 2) ? 'x' : 'star';
        P.sprite(gearKeySpec(th, col.width - 8, h, colors[i], pressed, icon), col.x + 4, y);
        if (labelAlpha > 0.01) {
            P.text(keys[i] ? formatKeyCode(keys[i]) : String(i + 1), col.x + col.width / 2, y + h - 7,
                '700 13px Orbitron, monospace', '#f8fafc', { alpha: labelAlpha });
        }
    });
}

function drawGearFrameDynamic(P, L, currentTime) {
    const th = L.theme;
    const { F, W, H } = L;
    // HP no pilar esquerdo (enche de baixo pra cima)
    const hs = hudShowFlags();
    const hpH = H - 154;
    const hh = hpH * Math.max(0, Math.min(1, hpDisplayed / 100));
    const hpColor = hpDisplayed > 30 ? th.accent : '#ef4444';
    if (hh > 0.5 && hs.hp) {
        P.rectV(11, 72 + hpH - hh, 8, hh, shadeColor(hpColor, 0.35), hpColor);
        P.glowRect(11, 72 + hpH - hh, 8, hh, hpColor, 5, 0.35);
    }
    // lâmpadas das side keys / TRACK L/R
    const sideIdx = getSideLaneIndices(currentMode);
    const trIdx = getTrackLRIndices(currentMode);
    [[0, F / 2], [1, F + W + F / 2]].forEach(([k, x]) => {
        const sOn = sideIdx && keyState && keyState[sideIdx[k]];
        const tOn = trIdx && keyState && keyState[trIdx[k]];
        if (sOn || tOn) {
            const c = tOn ? TRACK_LR_COLOR : SIDE_NOTE_COLOR;
            P.circle(x, H - 45, 7, c);
            P.additive(() => P.circle(x, H - 45, 12, glWithAlpha(c, 0.35)));
        }
    });
    // SPEED e score
    if (!hs.panel) return;
    const po = gearPanelOffset(L);
    P.text(scrollSpeed.toFixed(1), 76, H + 96 + po, '800 34px "Barlow Condensed", Rajdhani, sans-serif', '#ffffff');
    // pontuação no estilo do jogo: 1.000.000 = tudo MAX 100%
    const score = totalPossibleScore > 0 ? Math.max(0, Math.round(1e6 * (currentEarnedScore || 0) / totalPossibleScore)) : 0;
    P.text(String(score).padStart(7, '0'), L.totalW / 2, H + 67 + po, '700 24px Orbitron, monospace', th.panel.text);
}

// ---------- HUD estilo DJMAX (todas as gears) ----------
// O que aparece na gear (Ajustes → "Mostrar na gear"). Tudo ligado por padrão.
const HUD_SHOW_DEFAULTS = { combo: true, judge: true, fastslow: true, rate: true, meter: true, hp: true, panel: true, title: true };
function hudShowFlags() {
    const h = (typeof hudShow !== 'undefined' && hudShow) || {};
    const o = {};
    for (const k in HUD_SHOW_DEFAULTS) o[k] = h[k] !== false;
    return o;
}
function hudShowKey() {
    const f = hudShowFlags();
    return Object.keys(HUD_SHOW_DEFAULTS).map(k => (f[k] ? '1' : '0')).join('');
}
let hudJudgmentRef = null, hudJudgmentAt = 0;
let hudComboValue = 0, hudComboAt = 0;

const HUD_JUDGE_STYLES = {
    max100: { gradient: [[0, '#ffe9a8'], [0.4, '#ffc94a'], [0.75, '#f29b1d'], [1, '#c8650c']], stroke: '#4a2a05' },
    max90: { gradient: [[0, '#f0fdfa'], [0.45, '#5eead4'], [1, '#0f766e']], stroke: '#042f2e' },
    low: { gradient: [[0, '#fff7ed'], [0.45, '#fdba74'], [1, '#c2410c']], stroke: '#431407' },
    brk: { gradient: [[0, '#fee2e2'], [0.45, '#f87171'], [1, '#b91c1c']], stroke: '#450a0a' },
    hold: { gradient: [[0, '#f0fdf4'], [0.45, '#86efac'], [1, '#15803d']], stroke: '#052e16' }
};

function hudJudgeStyle(text) {
    if (!text) return HUD_JUDGE_STYLES.max100;
    if (text.includes('BREAK')) return HUD_JUDGE_STYLES.brk;
    if (text.startsWith('HOLD')) return HUD_JUDGE_STYLES.hold;
    if (text.includes('100')) return HUD_JUDGE_STYLES.max100;
    if (text.includes('90')) return HUD_JUDGE_STYLES.max90;
    return HUD_JUDGE_STYLES.low;
}

function currentRatePct() {
    const n = stats.rateCount || 0;
    if (!n) return 100;
    return stats.rateSum / n;
}

function drawGameHud(P, W, H) {
    if (!(isPlaying && !isCountingDown && !isSongFinished)) return;
    const now = performance.now();
    const hudFont = '"Barlow Condensed", Rajdhani, sans-serif';
    // Tudo medido a partir da linha de julgamento (S), igual ao DJMAX: COMBO lá no alto,
    // e embaixo, logo acima da linha, a barrinha de timing, o RATE e o "MAX 100%".
    const S = H - 80;
    const centerHud = hudLayout === 'center';
    // proporção ARCADE: posições e tamanhos medidos nos jogos de teclas de arcade (tela Full HD,
    // linha de julgamento a 753 px): "COMBO" ~122 px, número do combo com base em ~295 px e
    // ~115 px de altura, "MAX 100%" com base em ~650 px (bem perto da linha) e ~40 px de altura.
    const arcade = typeof gearProportion !== 'undefined' && gearProportion === 'arcade' && gameView !== 'highway_tilt';
    const k = arcade ? 1 : Math.min(1.15, Math.max(0.6, S / 1000));

    // aviso das fases da calibração
    if (typeof isCalibrationRun === 'function' && isCalibrationRun()) {
        const next = notes.find(n => !n.hit && !n.missed);
        const ghost = next && next.ghost;
        const msg = !next ? 'CALIBRAÇÃO CONCLUÍDA' : ghost ? 'SÓ OUVINDO — toque junto com a batida' : 'OLHANDO — toque quando a nota chegar na linha';
        P.text('CALIBRAÇÃO', W / 2, S * 0.52, `800 ${Math.round(26 * k)}px ${hudFont}`, '#67e8f9', { alpha: 0.9 });
        P.text(msg, W / 2, S * 0.52 + 30 * k, `700 ${Math.round(20 * k)}px ${hudFont}`, ghost ? '#fde047' : '#e2e8f0', { alpha: 0.95 });
    }
    if (stats.combo !== hudComboValue) {
        if (stats.combo > hudComboValue) hudComboAt = now;
        hudComboValue = stats.combo;
    }
    const comboLabelY = centerHud ? S * 0.33 : arcade ? S * 0.162 : S * 0.15;
    const comboY = arcade && !centerHud ? S * 0.392 : comboLabelY + 205 * k;
    if (stats.combo > 0 && hudShowFlags().combo) {
        const pop = Math.max(0, 1 - (now - hudComboAt) / 90);
        P.text('COMBO', W / 2, comboLabelY, `500 ${Math.round(30 * k)}px ${hudFont}`, '#c7ccd4', { alpha: 0.82 });
        // número grande cinza "metálico", estreito, com contorno escuro (como no jogo)
        P.text(stats.combo, W / 2, comboY, `700 ${Math.round(172 * k)}px ${hudFont}`, '#9ca3af', {
            gradient: [[0, '#f4f5f7'], [0.45, '#a3a8b0'], [0.8, '#70757d'], [1, '#4b5058']],
            stroke: { color: 'rgba(10,10,14,0.75)', width: 6 },
            alpha: 0.88, sx: 0.86 * (1 + pop * 0.05), sy: 1 + pop * 0.05
        });
    }

    if (lastJudgment !== hudJudgmentRef) {
        hudJudgmentRef = lastJudgment;
        hudJudgmentAt = now;
    }
    // "MAX 100%" no meio da gear (onde estava antes), RATE e barrinha logo acima dele
    const jy = centerHud ? S * 0.66 : arcade ? S * 0.863 : H * 0.62;
    const judgeSize = arcade && !centerHud ? 60 : Math.round(84 * k);
    const rateY = jy - (arcade && !centerHud ? 58 : 72 * k);
    const meterY = jy - (arcade && !centerHud ? 88 : 108 * k);
    const hs = hudShowFlags();

    // barrinha de timing (onde caíram os últimos toques: esquerda = cedo, direita = tarde)
    const mw = Math.min(200, W * 0.4), mx = W / 2 - mw / 2, mh = 7;
    if (hs.meter) {
    P.rect(mx, meterY, mw, mh, 'rgba(0,0,0,0.65)');
    const scale = (mw / 2) / TIMING.MAX1;
    P.rect(W / 2 - TIMING.MAX90 * scale, meterY, TIMING.MAX90 * 2 * scale, mh, 'rgba(94,234,212,0.18)');
    P.rect(W / 2 - TIMING.MAX100 * scale, meterY, TIMING.MAX100 * 2 * scale, mh, 'rgba(250,204,21,0.85)');
    P.rect(W / 2 - 1, meterY - 3, 2, mh + 6, '#ffffff');
    const offs = stats.hitOffsets || [];
    const n = Math.min(12, offs.length);
    for (let q = 0; q < n; q++) {
        const d = offs[offs.length - 1 - q];
        const x = W / 2 + Math.max(-TIMING.MAX1, Math.min(TIMING.MAX1, d)) * scale;
        const ad = Math.abs(d);
        const c = ad <= TIMING.MAX100 ? '#ffffff' : ad <= TIMING.MAX90 ? '#5eead4' : '#fb923c';
        P.rect(x - 1.5, meterY - 5, 3, mh + 10, glWithAlpha(c, 1 - q / (n + 1)));
    }
    }

    // RATE (rótulo pequeno + valor)
    const rate = currentRatePct();
    if (hs.rate) P.text('RATE', W / 2 - 14 * k, rateY, `600 ${Math.round(12 * k)}px ${hudFont}`, '#cbd5e1', { align: 'right', alpha: 0.9 });
    if (hs.rate) P.text(`${rate.toFixed(2)}%`, W / 2 - 6 * k, rateY, `600 ${Math.round(19 * k)}px ${hudFont}`, '#f8fafc', { align: 'left' });

    // Julgamento: "MAX 100%" dourado, reto (não itálico), com um "pop" curto quando muda
    if (lastJudgment && lastJudgment.text && hs.judge) {
        const age = now - hudJudgmentAt;
        const pop = Math.max(0, 1 - age / 100);
        const st = hudJudgeStyle(lastJudgment.text);
        P.text(lastJudgment.text, W / 2, jy, `800 ${judgeSize}px ${hudFont}`, '#fcd34d', {
            gradient: st.gradient, stroke: { color: st.stroke, width: 4 },
            sx: 0.94 * (1 + pop * 0.16), sy: 1 + pop * 0.16,
            alpha: age > 1500 ? Math.max(0.35, 1 - (age - 1500) / 800) : 1
        });
        if (hs.fastslow && lastJudgment.subText && lastJudgment.subText !== 'PERFECT' && lastJudgment.subText !== 'MISSED') {
            const sub = lastJudgment.subText;
            const c = sub.startsWith('FAST') ? '#60a5fa' : sub.startsWith('SLOW') ? '#f87171' : '#cbd5e1';
            P.text(sub, W / 2, jy + (arcade && !centerHud ? 20 : 24 * k), `700 ${Math.round(15 * k)}px ${hudFont}`, c, { alpha: age > 1500 ? 0.45 : 0.9 });
        }
    }
}

// explosão nas gears novas (no lugar do anel antigo)
function drawGearHitFlash(P, f) {
    const t = 1 - f.life;
    const s = (f.big ? 0.95 : 0.75) * (0.55 + t * 0.7);
    P.additive(() => {
        P.sprite(gearBurstSpec(), f.x, f.y, { alpha: f.life * 0.9, sx: s, sy: s * 0.9, tint: glParseColor(f.color) });
        P.sprite(gearBurstSpec(), f.x, f.y, { alpha: Math.max(0, f.life - 0.35) * 1.4, sx: s * 0.55, sy: s * 0.5 });
    });
    // coluna de luz curta subindo da linha
    const w = 70;
    P.rectV(f.x - w / 2, f.y - 170, w, 170, glWithAlpha(f.color, 0), glWithAlpha(f.color, f.life * 0.35));
}

// ---------- extras do Canvas 2D (modo compatibilidade) ----------
function drawGearFrame2DBack(L) {
    const P = make2DPainter(ctx);
    P.sprite(gearFrameSpec(L), 0, 0);
}

// ---------- imagem de fundo (guardada no navegador, IndexedDB) ----------
let gameBgUrl = null;
function mediaDb() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('sem IndexedDB'));
        const req = indexedDB.open('djmaxTrainerMedia', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function mediaPut(key, val) {
    const db = await mediaDb();
    await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        if (val == null) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(val, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
    });
}
async function mediaGet(key) {
    const db = await mediaDb();
    return new Promise((res, rej) => {
        const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}

function applyGameBackground() {
    const box = document.getElementById('game-container');
    const status = document.getElementById('bg-image-status');
    if (!box) return;
    if (!gameBgUrl) {
        box.style.backgroundImage = '';
        if (status) status.textContent = 'Nenhuma';
        return;
    }
    const d = bgDimPct / 100;
    box.style.backgroundImage = `linear-gradient(rgba(0,0,0,${d}), rgba(0,0,0,${d})), url("${gameBgUrl}")`;
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    box.style.borderRadius = '12px';
    if (status) status.textContent = 'Imagem carregada';
}

async function setGameBackgroundFile(file) {
    if (gameBgUrl) { URL.revokeObjectURL(gameBgUrl); gameBgUrl = null; }
    if (file) gameBgUrl = URL.createObjectURL(file);
    applyGameBackground();
    try { await mediaPut('bgImage', file || null); } catch (e) { console.warn('[fundo] não deu pra salvar a imagem', e); }
}

(async function loadGameBackground() {
    try {
        const blob = await mediaGet('bgImage');
        if (blob) {
            gameBgUrl = URL.createObjectURL(blob);
            applyGameBackground();
        }
    } catch (e) { /* sem IndexedDB: segue sem fundo */ }
})();

// ---------- opção "Proporção da gear" nas Configurações ----------
(function gearPropUI() {
    const pos = document.getElementById('setting-gear-position');
    const row = pos && pos.closest('label');
    if (!row || document.getElementById('setting-gear-prop')) return;
    const lb = document.createElement('label');
    lb.className = 'flex items-center justify-between gap-3';
    lb.innerHTML = `<span><span class="text-xs font-bold text-slate-200 block">Proporção da gear</span>
        <span class="text-[10px] text-slate-400">Arcade: linha de julgamento mais alta (perto do meio da tela), pista mais larga e notas maiores, como nos jogos de teclas de arcade. Clássica: a pista alta de antes. A velocidade (tempo da nota na tela) é a mesma nas duas.</span></span>
        <select id="setting-gear-prop" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 shrink-0" style="min-width:7rem"><option value="arcade">Arcade</option><option value="classica">Clássica</option></select>`;
    row.insertAdjacentElement('afterend', lb);
    const sel = lb.querySelector('select');
    sel.value = gearProportion;
    sel.addEventListener('change', () => setGearProportion(sel.value));
})();
// script.js já mediu a tela antes deste arquivo existir: mede de novo com a proporção certa
try { if (typeof resizeCanvas === 'function') resizeCanvas(); } catch (e) {}
