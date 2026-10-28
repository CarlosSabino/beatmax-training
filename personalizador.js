// =====================================================================================
// personalizador.js — Personalizador de gears/skins (BEATMAX Training).
//
// Cada skin do jogador vira um tema de verdade em GEAR_THEMES (chave "u_<id>"), então ela
// passa pelo MESMO caminho de desenho das gears prontas (WebGL e Canvas 2D), sem custo extra
// por frame: moldura, pista e teclas continuam "assadas" uma vez em imagem/textura.
//
// O que dá pra mudar: cores de tudo (notas, moldura, pista, teclas, linha), estilo do pilar,
// imagem na pista, formato das notas, e os efeitos (explosão de acerto, coluna de luz, feixe
// ao apertar a tecla). Exporta/importa como arquivo .bmskin (JSON).
// Guardado no IndexedDB (entra no backup automaticamente).
// =====================================================================================

const SKIN_STORE_KEY = 'djmaxSkins_v1';
const SKIN_PREVIEW_KEY = 'u__preview';
const SKIN_FX_DEFAULT = { burst: 'star', size: 1, column: 1, keybeam: true, beam: 0.35 };
const SKIN_PILLAR_STYLES = [
    ['metal', 'Metal'], ['filigree', 'Filigrana'], ['prism', 'Prisma'],
    ['hazard', 'Alerta (listras)'], ['truss', 'Treliça'], ['neon', 'Neon']
];
const SKIN_BURSTS = [['star', 'Estrela'], ['ring', 'Anel'], ['spark', 'Faíscas'], ['none', 'Nenhuma']];

// Guardado no IndexedDB (banco djmaxTrainerMedia, chave SKIN_IDB_KEY) — o localStorage é
// pequeno (~5 MB) e já fica cheio com o resto do jogo. Versão antiga usava localStorage:
// se tiver lá, migra.
const SKIN_IDB_KEY = 'skins:v1';
let skinStore = { skins: [] };
try { const s = JSON.parse(localStorage.getItem(SKIN_STORE_KEY) || 'null'); if (s && Array.isArray(s.skins)) skinStore = s; } catch (e) {}

let skinSaveChain = Promise.resolve();
function skinSaveStore() {
    const snap = skinClone(skinStore);
    skinSaveChain = skinSaveChain.then(() => mediaPut(SKIN_IDB_KEY, snap)).then(() => {
        try { localStorage.removeItem(SKIN_STORE_KEY); } catch (e) {}
    }, (e) => {
        console.warn('[skin] não salvou', e);
        skinMsg('⚠️ Não consegui salvar a skin no navegador (' + (e && e.name || 'erro') + ').');
    });
    return true;
}
async function skinLoadStore() {
    try {
        const v = await mediaGet(SKIN_IDB_KEY);
        if (v && Array.isArray(v.skins)) {
            // o que estava no localStorage (versão antiga) e ainda não foi pro IndexedDB entra junto
            const ids = new Set(v.skins.map(x => x.id));
            skinStore.skins.forEach(x => { if (!ids.has(x.id)) v.skins.push(x); });
            skinStore = v;
        }
        if (skinStore.skins.length) skinSaveStore();
    } catch (e) { console.warn('[skin] carregar', e); }
}
const skinClone = (o) => JSON.parse(JSON.stringify(o));
const skinNewId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const skinEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- cores ----------
function skinHex(c, fallback) {
    if (typeof c !== 'string') return fallback || '#000000';
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('').toLowerCase();
    const m = c.match(/rgba?\(([^)]+)\)/i);
    if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return '#' + p.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
    return fallback || '#000000';
}
function skinAlphaOf(c) { const m = typeof c === 'string' && c.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/i); return m ? parseFloat(m[1]) : 1; }
function skinRgba(hex, a) { const h = skinHex(hex); return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${+a.toFixed(3)})`; }
function skinHsl(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
function skinHueOf(hex) {
    const h = skinHex(hex); const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    let hu = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (hu * 60 + 360) % 360;
}

// tema completo derivado de UMA cor (botão "Gerar a partir do destaque" e "Aleatório")
function skinThemeFromHue(h, style) {
    return {
        accent: skinHsl(h, 90, 60),
        palette: { edge: skinHsl(h, 25, 92), altA: skinHsl(h + 180, 85, 65), altB: skinHsl(h + 150, 40, 82), center: skinHsl(h + 40, 95, 62) },
        body: { top: skinHsl(h, 30, 5), bottom: skinHsl(h, 30, 11), glow: skinHsl(h, 90, 55), glowAlpha: 0.42, laneTint: 0.03, divider: skinRgba(skinHsl(h, 60, 85), 0.08) },
        pillar: { style: style || 'metal', lo: skinHsl(h, 40, 10), mid: skinHsl(h, 45, 32), hi: skinHsl(h, 55, 58), trim: skinHsl(h, 80, 75), text: skinHsl(h, 40, 85) },
        panel: { base: skinHsl(h, 35, 8), hi: skinHsl(h, 45, 26), trim: skinHsl(h, 80, 65), box: skinHsl(h + 180, 70, 40), text: skinHsl(h, 30, 92) },
        keys: { top: skinHsl(h, 20, 18), bottom: skinHsl(h, 20, 8), edge: skinHsl(h, 40, 35), icon: skinHsl(h, 60, 60) },
        line: ['#ffffff', skinHsl(h, 80, 85), skinHsl(h, 85, 50)]
    };
}

function skinBlank(fromKey) {
    const base = (typeof GEAR_THEMES !== 'undefined' && GEAR_THEMES[fromKey]) || GEAR_THEMES.respect;
    const t = skinClone({ accent: base.accent, palette: base.palette, body: base.body, pillar: base.pillar, panel: base.panel, keys: base.keys, line: base.line });
    return { id: skinNewId(), name: 'Minha skin', theme: t, fx: Object.assign({}, SKIN_FX_DEFAULT, base.fx || {}), laneImg: base.laneImg || null, laneImgAlpha: base.laneImgAlpha != null ? base.laneImgAlpha : 0.35, noteShape: base.noteShape || '' };
}

// ---------- registro nos temas do jogo ----------
function skinKey(s) { return 'u_' + s.id; }
function skinRegister(s, key) {
    key = key || skinKey(s);
    GEAR_THEMES[key] = Object.assign(skinClone(s.theme), { label: s.name, custom: true, fx: Object.assign({}, SKIN_FX_DEFAULT, s.fx), laneImg: s.laneImg || null, laneImgAlpha: s.laneImgAlpha, noteShape: s.noteShape || '' });
    SKIN_PALETTES[key] = Object.assign({ side: SIDE_NOTE_COLOR }, s.theme.palette);
    if (s.laneImg) skinImage(s.laneImg);
    return key;
}
function skinRegisterAll() { skinStore.skins.forEach(s => skinRegister(s)); }

// joga fora as imagens/texturas prontas de uma skin (pra redesenhar com as cores novas)
function skinPurge(key) {
    const tag = '|' + key + '|';
    for (const k of [...sprite2DCache.keys()]) if (k.includes(tag)) sprite2DCache.delete(k);
    if (typeof glPurgeSprites === 'function' && typeof glSpriteCache !== 'undefined') {
        for (const k of [...glSpriteCache.keys()]) if (k.includes(tag)) glPurgeSprites(k);
    }
}

// imagens da pista (dataURL -> Image pronta)
const skinImgCache = new Map();
function skinImage(url) {
    let im = skinImgCache.get(url);
    if (!im) {
        im = new Image();
        im.onload = () => { Object.keys(GEAR_THEMES).forEach(k => { if (GEAR_THEMES[k].laneImg === url) skinPurge(k); }); };
        im.src = url;
        skinImgCache.set(url, im);
    }
    return im;
}

// ---------- ganchos no desenho (só valem pra skins do jogador; as prontas ficam iguais) ----------
(function hookGearDrawing() {
    const origBody = window.bakeGearBody;
    window.bakeGearBody = function (b, L, withLanes) {
        origBody(b, L, withLanes);
        const th = L.theme;
        if (!th || !th.laneImg) return;
        const im = skinImage(th.laneImg);
        if (!im.complete || !im.naturalWidth) return;
        const strikeY = getGameStrikeY();
        const W = L.W, s = Math.max(W / im.naturalWidth, strikeY / im.naturalHeight);
        const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
        b.save();
        b.beginPath(); b.rect(0, 0, W, strikeY); b.clip();
        b.globalAlpha = Math.max(0, Math.min(1, th.laneImgAlpha != null ? th.laneImgAlpha : 0.35)) * Math.max(0.25, laneOpacityPct / 100);
        b.drawImage(im, (W - dw) / 2, strikeY - dh, dw, dh);
        b.restore();
    };

    const origFlash = window.drawGearHitFlash;
    window.drawGearHitFlash = function (P, f) {
        const th = getGearTheme();
        const fx = th && th.custom ? th.fx : null;
        if (!fx) return origFlash(P, f);
        const t = 1 - f.life, k = fx.size || 1;
        if (fx.burst === 'star') {
            const s = (f.big ? 0.95 : 0.75) * (0.55 + t * 0.7) * k;
            P.additive(() => {
                P.sprite(gearBurstSpec(), f.x, f.y, { alpha: f.life * 0.9, sx: s, sy: s * 0.9, tint: glParseColor(f.color) });
                P.sprite(gearBurstSpec(), f.x, f.y, { alpha: Math.max(0, f.life - 0.35) * 1.4, sx: s * 0.55, sy: s * 0.5 });
            });
        } else if (fx.burst === 'ring') {
            const r = (t * (f.big ? 78 : 58) + 10) * k;
            P.additive(() => {
                P.ring(f.x, f.y, r, (f.big ? 5 : 3.5) * Math.max(0.4, f.life), glWithAlpha(f.color, f.life * 0.95));
                if (f.big) P.ring(f.x, f.y, r * 1.35, 2, glWithAlpha(f.color, f.life * 0.5));
                const core = Math.max(0, f.life - 0.55) * 2.2;
                if (core > 0.01) P.circle(f.x, f.y, (f.big ? 14 : 10) * k, glWithAlpha('#ffffff', Math.min(1, core)));
            });
        } else if (fx.burst === 'spark') {
            const n = f.big ? 10 : 7, r0 = (8 + t * 40) * k, r1 = r0 + (18 + t * 34) * k;
            const rot = ((f.x * 13 + f.y) % 360) * Math.PI / 180;
            P.additive(() => {
                for (let i = 0; i < n; i++) {
                    const a = rot + i * Math.PI * 2 / n;
                    P.line(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0, f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1, f.big ? 3.5 : 2.5, glWithAlpha(f.color, f.life));
                }
                const core = Math.max(0, f.life - 0.5) * 2;
                if (core > 0.01) P.circle(f.x, f.y, 9 * k, glWithAlpha('#ffffff', Math.min(1, core)));
            });
        }
        const ci = fx.column == null ? 1 : fx.column;
        if (ci > 0.01) {
            const w = 70 * Math.min(1.4, k), h = 170 * Math.min(2, 0.6 + ci * 0.4);
            P.rectV(f.x - w / 2, f.y - h, w, h, glWithAlpha(f.color, 0), glWithAlpha(f.color, Math.min(1, f.life * 0.35 * ci)));
        }
    };

    const origKeys = window.drawGearKeyPanel;
    window.drawGearKeyPanel = function (P, L, currentTime) {
        const th = L.theme;
        const fx = th && th.custom ? th.fx : null;
        if (fx && fx.keybeam && keyState) {
            const strikeY = getGameStrikeY();
            const cols = getGameplayColumnLayout(currentMode, L.W);
            const colors = getKeyColorScheme(currentMode, gearSkin);
            const a = fx.beam == null ? 0.35 : fx.beam;
            P.additive(() => cols.forEach((col, i) => {
                if (keyState[i]) P.rectV(col.x + 2, strikeY - 320, col.width - 4, 320, glWithAlpha(colors[i], 0), glWithAlpha(colors[i], a));
            }));
        }
        return origKeys(P, L, currentTime);
    };
})();

// formato de nota próprio da skin: troca o formato global enquanto ela estiver em uso
function skinApplyNoteShape() {
    if (window.BM_COLECAO) return; // a nota agora é escolhida separada (Personalizar › Nota)
    const th = getGearTheme();
    if (th && th.custom && th.noteShape) {
        noteShape = th.noteShape;
        const sel = document.getElementById('main-note-shape');
        if (sel) sel.value = noteShape;
    }
}

// ---------- seletor "Gear Skin" do menu ----------
function skinFillGearSelect() {
    const sel = document.getElementById('main-gear-skin');
    if (!sel) return;
    let og = document.getElementById('skin-optgroup');
    if (!og) {
        og = document.createElement('optgroup');
        og.id = 'skin-optgroup';
        og.label = 'Minhas skins';
        sel.insertBefore(og, sel.firstChild);
    }
    og.innerHTML = skinStore.skins.map(s => `<option value="${skinKey(s)}">${skinEsc(s.name)}</option>`).join('');
    og.hidden = !skinStore.skins.length;
    if ([...sel.options].some(o => o.value === gearSkin)) sel.value = gearSkin;
}

// ---------- tela do personalizador ----------
const skinEd = { open: false, cur: null, mode: '4K', raf: 0, notes: [], flashes: [], keys: [], keyUntil: [], last: 0, t0: 0, dirty: false };

function skinMsg(text) {
    const el = document.getElementById('skin-msg');
    if (!el) return;
    el.textContent = text;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 4000);
}

function skinEnsureModal() {
    let m = document.getElementById('skin-modal');
    if (m) return m;
    const css = document.createElement('style');
    css.textContent = `
#skin-modal{position:fixed;inset:0;z-index:86;display:none;background:rgba(2,6,23,.96);backdrop-filter:blur(6px);color:#e2e8f0;font-size:12px}
#skin-modal.open{display:flex}
#skin-side{width:400px;max-width:46vw;display:flex;flex-direction:column;border-right:1px solid rgba(236,72,153,.3);background:#0b1120}
#skin-side header{padding:12px 14px;border-bottom:1px solid #1e293b;display:flex;flex-direction:column;gap:8px}
#skin-scroll{flex:1;overflow:auto;padding:8px 14px 18px}
#skin-modal h2{font-family:Orbitron,monospace;font-weight:900;font-size:16px;color:#f9a8d4;letter-spacing:.04em}
#skin-modal details{border:1px solid #1e293b;border-radius:10px;margin-top:8px;background:#0f172a}
#skin-modal summary{cursor:pointer;padding:8px 10px;font-weight:700;color:#67e8f9;list-style:none}
#skin-modal summary::before{content:'▸ ';color:#64748b}
#skin-modal details[open] summary::before{content:'▾ '}
#skin-modal .sk-body{padding:4px 10px 10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
#skin-modal .sk-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
#skin-modal .sk-row.full{grid-column:1/-1}
#skin-modal label{color:#94a3b8}
#skin-modal input[type=color]{width:34px;height:22px;border:1px solid #334155;border-radius:4px;background:none;padding:0;cursor:pointer}
#skin-modal input[type=range]{width:120px;accent-color:#ec4899}
#skin-modal select,#skin-modal input[type=text]{background:#020617;border:1px solid #334155;border-radius:6px;padding:4px 6px;color:#e2e8f0;font-size:12px}
#skin-modal .sk-btn{padding:5px 9px;border-radius:7px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-weight:600;cursor:pointer;white-space:nowrap}
#skin-modal .sk-btn:hover{background:#334155}
#skin-modal .sk-btn.pri{background:#be185d;border-color:#ec4899;color:#fff}
#skin-modal .sk-btn.pri:hover{background:#db2777}
#skin-modal .sk-btn.red{border-color:#7f1d1d;color:#fca5a5}
#skin-modal .sk-btns{display:flex;flex-wrap:wrap;gap:6px}
#skin-stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;min-width:0}
#skin-canvas{background:#000;border-radius:6px;box-shadow:0 0 40px rgba(236,72,153,.15)}
#skin-msg{min-height:16px;color:#fde68a}
`;
    document.head.appendChild(css);
    m = document.createElement('div');
    m.id = 'skin-modal';
    m.innerHTML = `
<div id="skin-side">
  <header>
    <div class="sk-row"><h2>PERSONALIZAR GEAR</h2><button id="skin-close" class="sk-btn">Fechar</button></div>
    <div class="sk-row"><select id="skin-list" style="flex:1"></select></div>
    <div class="sk-btns">
      <select id="skin-new-from" title="Criar uma skin nova a partir de uma gear pronta"></select>
      <button id="skin-new" class="sk-btn">+ Nova</button>
      <button id="skin-dup" class="sk-btn">Duplicar</button>
      <button id="skin-del" class="sk-btn red">Excluir</button>
    </div>
    <div class="sk-row"><label>Nome</label><input id="skin-name" type="text" maxlength="40" style="flex:1"></div>
    <div class="sk-btns">
      <button id="skin-auto" class="sk-btn" title="Gera todas as cores a partir da cor de destaque">🎨 Cores pelo destaque</button>
      <button id="skin-rand" class="sk-btn">🎲 Aleatório</button>
      <button id="skin-export" class="sk-btn">Exportar</button>
      <button id="skin-import" class="sk-btn">Importar</button>
      <input id="skin-import-file" type="file" accept=".bmskin,.json" hidden>
    </div>
    <div class="sk-btns"><button id="skin-use" class="sk-btn pri" style="flex:1">✔ Salvar e usar no jogo</button></div>
    <div id="skin-msg"></div>
  </header>
  <div id="skin-scroll"></div>
</div>
<div id="skin-stage">
  <div class="sk-btns" style="align-items:center">
    <label>Prévia</label>
    <select id="skin-mode"><option value="4K">4B</option><option value="5K">5B</option><option value="6K">6B</option><option value="8K">8B</option></select>
    <span style="color:#64748b">— as notas caem sozinhas; aperte as teclas do modo pra ver o feixe</span>
  </div>
  <div class="sk-btns" style="align-items:center" title="Velocidade das notas na prévia — a mesma escala do jogo (Configurações › Velocidade)">
    <label>Velocidade</label>
    <button id="skin-spd-minus" class="sk-btn">−</button>
    <input id="skin-spd" type="range" min="1" max="10" step="0.1">
    <button id="skin-spd-plus" class="sk-btn">+</button>
    <b id="skin-spd-val" style="font-family:Orbitron,monospace;color:#f9a8d4;min-width:44px;text-align:center"></b>
    <button id="skin-spd-mine" class="sk-btn" title="Volta pra velocidade que você usa no jogo">= a do jogo</button>
    <button id="skin-spd-use" class="sk-btn" title="Passa a usar essa velocidade nas partidas">Usar no jogo</button>
  </div>
  <canvas id="skin-canvas"></canvas>
</div>`;
    document.body.appendChild(m);

    const $ = (id) => document.getElementById(id);
    $('skin-close').onclick = skinClose;
    $('skin-list').onchange = (e) => skinSelect(e.target.value);
    $('skin-new-from').innerHTML = Object.keys(GEAR_THEMES).filter(k => !GEAR_THEMES[k].custom).map(k => `<option value="${k}">Base: ${skinEsc(GEAR_THEMES[k].label)}</option>`).join('');
    $('skin-new').onclick = () => { const s = skinBlank($('skin-new-from').value); s.name = 'Skin ' + (skinStore.skins.length + 1); skinStore.skins.push(s); skinCommit(s, 'Skin criada.'); skinSelect(s.id); };
    $('skin-dup').onclick = () => { if (!skinEd.cur) return; const s = skinClone(skinEd.cur); s.id = skinNewId(); s.name = (s.name + ' (cópia)').slice(0, 40); skinStore.skins.push(s); skinCommit(s, 'Duplicada.'); skinSelect(s.id); };
    $('skin-del').onclick = skinDelete;
    $('skin-name').oninput = (e) => { if (skinEd.cur) { skinEd.cur.name = e.target.value || 'Sem nome'; skinChanged(); } };
    $('skin-auto').onclick = () => { if (!skinEd.cur) return; const st = skinEd.cur.theme.pillar.style; skinEd.cur.theme = skinThemeFromHue(skinHueOf(skinEd.cur.theme.accent), st); skinChanged(true); };
    $('skin-rand').onclick = () => {
        if (!skinEd.cur) return;
        const st = SKIN_PILLAR_STYLES[Math.floor(Math.random() * SKIN_PILLAR_STYLES.length)][0];
        skinEd.cur.theme = skinThemeFromHue(Math.random() * 360, st);
        skinEd.cur.fx.burst = SKIN_BURSTS[Math.floor(Math.random() * 3)][0];
        skinChanged(true);
    };
    $('skin-export').onclick = skinExport;
    $('skin-import').onclick = () => $('skin-import-file').click();
    $('skin-import-file').onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) skinImport(f); };
    $('skin-use').onclick = skinUse;
    $('skin-mode').onchange = (e) => { skinEd.mode = e.target.value; skinEd.notes = []; skinPurge(SKIN_PREVIEW_KEY); };
    // velocidade da prévia (começa na que a pessoa usa no jogo)
    const spdSet = (v) => {
        skinEd.speed = Math.min(10, Math.max(1, Math.round(v * 10) / 10));
        $('skin-spd').value = skinEd.speed;
        $('skin-spd-val').textContent = skinEd.speed.toFixed(1);
        $('skin-spd-mine').style.opacity = Math.abs(skinEd.speed - scrollSpeed) < 0.05 ? '.45' : '1';
    };
    skinEd.setSpeed = spdSet;
    $('skin-spd').oninput = (e) => spdSet(parseFloat(e.target.value));
    $('skin-spd-minus').onclick = () => spdSet(skinEd.speed - 0.1);
    $('skin-spd-plus').onclick = () => spdSet(skinEd.speed + 0.1);
    $('skin-spd-mine').onclick = () => spdSet(scrollSpeed);
    $('skin-spd-use').onclick = () => {
        scrollSpeed = skinEd.speed;
        if (typeof updateSpeedDisplay === 'function') updateSpeedDisplay();
        if (typeof saveSettings === 'function') saveSettings();
        renderedSpeedFactor = gameSpeedFactorTarget();
        spdSet(skinEd.speed);
        skinMsg(`Velocidade ${scrollSpeed.toFixed(1)} salva pras partidas.`);
    };
    return m;
}

// ---------- controles ----------
function skinControlsHtml(s) {
    const t = s.theme, fx = s.fx;
    const col = (path, label, val) => `<div class="sk-row"><label>${label}</label><input type="color" data-p="${path}" value="${skinHex(val)}"></div>`;
    const rng = (path, label, val, min, max, step) => `<div class="sk-row full"><label>${label}</label><input type="range" data-p="${path}" data-num="1" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
    const sel = (path, label, val, opts) => `<div class="sk-row full"><label>${label}</label><select data-p="${path}">${opts.map(([v, n]) => `<option value="${v}"${v === val ? ' selected' : ''}>${skinEsc(n)}</option>`).join('')}</select></div>`;
    const shapes = [['', 'Usar o formato do jogo']].concat([...(document.getElementById('main-note-shape') || { options: [] }).options].map(o => [o.value, o.textContent]));
    return `
<details open><summary>Notas e destaque</summary><div class="sk-body">
  ${col('theme.accent', 'Destaque', t.accent)}
  ${col('theme.palette.center', 'Centro', t.palette.center)}
  ${col('theme.palette.edge', 'Bordas', t.palette.edge)}
  ${col('theme.palette.altA', 'Alternada A', t.palette.altA)}
  ${col('theme.palette.altB', 'Alternada B', t.palette.altB)}
  ${sel('noteShape', 'Formato das notas', s.noteShape || '', shapes)}
</div></details>
<details open><summary>Efeitos</summary><div class="sk-body">
  ${sel('fx.burst', 'Explosão de acerto', fx.burst, SKIN_BURSTS)}
  ${rng('fx.size', 'Tamanho da explosão', fx.size, 0.4, 1.8, 0.05)}
  ${rng('fx.column', 'Coluna de luz', fx.column, 0, 2, 0.05)}
  <div class="sk-row full"><label>Feixe ao apertar a tecla</label><input type="checkbox" data-p="fx.keybeam"${fx.keybeam ? ' checked' : ''}></div>
  ${rng('fx.beam', 'Força do feixe', fx.beam, 0.05, 0.8, 0.05)}
</div></details>
<details><summary>Moldura (pilares e painel)</summary><div class="sk-body">
  ${sel('theme.pillar.style', 'Estilo do pilar', t.pillar.style, SKIN_PILLAR_STYLES)}
  ${col('theme.pillar.lo', 'Pilar escuro', t.pillar.lo)}
  ${col('theme.pillar.mid', 'Pilar médio', t.pillar.mid)}
  ${col('theme.pillar.hi', 'Pilar claro', t.pillar.hi)}
  ${col('theme.pillar.trim', 'Pilar detalhe', t.pillar.trim)}
  ${col('theme.pillar.text', 'Pilar texto', t.pillar.text)}
  ${col('theme.panel.base', 'Painel fundo', t.panel.base)}
  ${col('theme.panel.hi', 'Painel claro', t.panel.hi)}
  ${col('theme.panel.trim', 'Painel detalhe', t.panel.trim)}
  ${col('theme.panel.box', 'Painel caixa', t.panel.box)}
  ${col('theme.panel.text', 'Painel texto', t.panel.text)}
</div></details>
<details><summary>Pista</summary><div class="sk-body">
  ${col('theme.body.top', 'Topo', t.body.top)}
  ${col('theme.body.bottom', 'Base', t.body.bottom)}
  ${col('theme.body.glow', 'Brilho', t.body.glow)}
  ${col('divider', 'Divisórias', t.body.divider)}
  ${rng('theme.body.glowAlpha', 'Força do brilho', t.body.glowAlpha, 0, 1, 0.02)}
  ${rng('theme.body.laneTint', 'Lanes alternadas', t.body.laneTint, 0, 0.12, 0.005)}
  ${rng('dividerA', 'Divisórias (força)', +skinAlphaOf(t.body.divider).toFixed(2), 0, 0.5, 0.01)}
  <div class="sk-row full"><label>Imagem na pista</label><span class="sk-btns"><button class="sk-btn" id="skin-img-pick">${s.laneImg ? 'Trocar' : 'Escolher'}…</button><button class="sk-btn" id="skin-img-link" title="Usar uma imagem da internet (colar o link)">🔗 Link…</button>${s.laneImg ? '<button class="sk-btn red" id="skin-img-del">Tirar</button>' : ''}</span><input id="skin-img-file" type="file" accept="image/*" hidden></div>
  <div class="sk-row full" id="skin-img-linkrow" style="display:none"><input id="skin-img-url" type="url" placeholder="Cole o link da imagem (https://…)" style="flex:1;min-width:0;background:#020617;border:1px solid #334155;border-radius:6px;padding:5px 8px;color:#e2e8f0;font-size:12px"><span class="sk-btns"><button class="sk-btn" id="skin-img-url-ok">Usar</button></span></div>
  ${s.laneImg ? rng('laneImgAlpha', 'Imagem (força)', s.laneImgAlpha, 0.05, 1, 0.05) : ''}
</div></details>
<details><summary>Teclas e linha de julgamento</summary><div class="sk-body">
  ${col('theme.keys.top', 'Tecla topo', t.keys.top)}
  ${col('theme.keys.bottom', 'Tecla base', t.keys.bottom)}
  ${col('theme.keys.edge', 'Tecla borda', t.keys.edge)}
  ${col('theme.keys.icon', 'Tecla ícone', t.keys.icon)}
  ${col('theme.line.0', 'Linha cima', t.line[0])}
  ${col('theme.line.1', 'Linha meio', t.line[1])}
  ${col('theme.line.2', 'Linha baixo', t.line[2])}
</div></details>`;
}

function skinSetPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
}

function skinRenderControls() {
    const box = document.getElementById('skin-scroll');
    const s = skinEd.cur;
    if (!s) { box.innerHTML = '<p style="color:#94a3b8;margin-top:12px">Você ainda não tem skins. Escolha uma base acima e clique em <b>+ Nova</b>.</p>'; return; }
    const openState = [...box.querySelectorAll('details')].map(d => d.open);
    box.innerHTML = skinControlsHtml(s);
    if (openState.length) box.querySelectorAll('details').forEach((d, i) => { if (openState[i] != null) d.open = openState[i]; });
    box.querySelectorAll('[data-p]').forEach(el => {
        const ev = el.type === 'color' || el.type === 'range' ? 'input' : 'change';
        el.addEventListener(ev, () => {
            const p = el.dataset.p;
            let v = el.type === 'checkbox' ? el.checked : el.value;
            if (el.dataset.num) v = parseFloat(v);
            if (p === 'divider') s.theme.body.divider = skinRgba(v, skinAlphaOf(s.theme.body.divider));
            else if (p === 'dividerA') s.theme.body.divider = skinRgba(skinHex(s.theme.body.divider), v);
            else skinSetPath(s, p, v);
            skinChanged(p === 'noteShape');
        });
    });
    const pick = document.getElementById('skin-img-pick');
    if (pick) pick.onclick = () => document.getElementById('skin-img-file').click();
    const file = document.getElementById('skin-img-file');
    if (file) file.onchange = async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try { s.laneImg = await skinShrinkImage(f, 720, 1280); skinChanged(true); }
        catch (err) { skinMsg('⚠️ Não consegui abrir essa imagem.'); }
    };
    const del = document.getElementById('skin-img-del');
    if (del) del.onclick = () => { s.laneImg = null; skinChanged(true); };
    // imagem por LINK: baixa uma vez e guarda reduzida (não depende do site depois)
    const linkBtn = document.getElementById('skin-img-link'), row = document.getElementById('skin-img-linkrow');
    const urlIn = document.getElementById('skin-img-url'), ok = document.getElementById('skin-img-url-ok');
    if (linkBtn && row) linkBtn.onclick = () => { row.style.display = row.style.display === 'none' ? '' : 'none'; if (row.style.display !== 'none') urlIn.focus(); };
    const useLink = async () => {
        const url = (urlIn.value || '').trim();
        if (!/^https?:\/\//i.test(url)) { skinMsg('⚠️ Cole um link começando com http:// ou https://'); return; }
        ok.disabled = true; skinMsg('⏳ Baixando a imagem…');
        try { s.laneImg = await skinImageFromUrl(url); skinChanged(true); skinMsg('✅ Imagem aplicada.'); }
        catch (err) { skinMsg('⚠️ ' + (err && err.message ? err.message : 'Não consegui baixar essa imagem.')); }
        finally { ok.disabled = false; }
    };
    if (ok) ok.onclick = useLink;
    if (urlIn) urlIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); useLink(); } });
}

// baixa a imagem do link: direto pelo navegador e, se o site não deixar (CORS), pelo servidor
// local do BEATMAX (no PC). Na versão web só dá o caminho direto.
async function skinImageFromUrl(url) {
    const blob = await window.beatmaxFetchMedia(url, false);
    return skinShrinkImage(blob, 720, 1280);
}

// reduz a imagem (localStorage é pequeno) e devolve em JPEG/dataURL
function skinShrinkImage(file, maxW, maxH) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.onload = () => {
            const s = Math.min(1, maxW / im.naturalWidth, maxH / im.naturalHeight);
            const c = document.createElement('canvas');
            c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
            c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/jpeg', 0.82));
        };
        im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem')); };
        im.src = url;
    });
}

function skinChanged(rerender) {
    skinEd.dirty = true;
    skinRegister(skinEd.cur, SKIN_PREVIEW_KEY);
    skinPurge(SKIN_PREVIEW_KEY);
    if (rerender) skinRenderControls();
    skinFillList();
}

function skinFillList() {
    const sel = document.getElementById('skin-list');
    if (!sel) return;
    sel.innerHTML = skinStore.skins.length
        ? skinStore.skins.map(s => `<option value="${s.id}"${skinEd.cur && s.id === skinEd.cur.id ? ' selected' : ''}>${skinEsc(s.name)}${GEAR_THEMES[skinKey(s)] && gearSkin === skinKey(s) ? '  ✔ em uso' : ''}</option>`).join('')
        : '<option value="">(nenhuma skin ainda)</option>';
}

function skinSelect(id) {
    const stored = skinStore.skins.find(s => s.id === id);
    skinEd.cur = stored ? skinClone(stored) : null; // edita uma cópia; só grava em "Salvar"
    skinEd.dirty = false;
    if (skinEd.cur) {
        skinEd.cur.fx = Object.assign({}, SKIN_FX_DEFAULT, skinEd.cur.fx || {});
        skinRegister(skinEd.cur, SKIN_PREVIEW_KEY);
        skinPurge(SKIN_PREVIEW_KEY);
    }
    document.getElementById('skin-name').value = skinEd.cur ? skinEd.cur.name : '';
    ['skin-name', 'skin-dup', 'skin-del', 'skin-auto', 'skin-rand', 'skin-export', 'skin-use'].forEach(i => { document.getElementById(i).disabled = !skinEd.cur; });
    skinFillList();
    skinRenderControls();
}

// grava a skin editada no armazenamento + tema do jogo
function skinCommit(s, msg) {
    const i = skinStore.skins.findIndex(x => x.id === s.id);
    const copy = skinClone(s);
    if (i >= 0) skinStore.skins[i] = copy; else skinStore.skins.push(copy);
    if (!skinSaveStore()) return false;
    const key = skinRegister(copy);
    skinPurge(key);
    skinFillGearSelect();
    if (msg) skinMsg(msg);
    return true;
}

function skinUse() {
    const s = skinEd.cur;
    if (!s) return;
    if (!skinCommit(s)) return;
    skinEd.dirty = false;
    gearSkin = skinKey(s);
    skinApplyNoteShape();
    skinFillGearSelect();
    try { resizeCanvas(); } catch (e) {}
    try { saveSettings(); } catch (e) {}
    skinFillList();
    skinMsg('✅ Salva! Essa skin já está valendo no jogo.');
}

function skinDelete() {
    const s = skinEd.cur;
    if (!s || !confirm(`Excluir a skin "${s.name}"?`)) return;
    skinStore.skins = skinStore.skins.filter(x => x.id !== s.id);
    skinSaveStore();
    const key = skinKey(s);
    skinPurge(key);
    delete GEAR_THEMES[key];
    if (gearSkin === key) { gearSkin = 'respect'; try { resizeCanvas(); saveSettings(); } catch (e) {} }
    skinFillGearSelect();
    skinSelect(skinStore.skins[0] ? skinStore.skins[0].id : null);
    skinMsg('Skin excluída.');
}

function skinExport() {
    const s = skinEd.cur;
    if (!s) return;
    const data = { format: 'beatmax-skin', version: 1, skin: Object.assign(skinClone(s), { id: undefined }) };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (s.name || 'skin').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.bmskin';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    skinMsg('Arquivo .bmskin gerado — mande pra quem quiser.');
}

async function skinImport(file) {
    try {
        const data = JSON.parse(await file.text());
        const src = data && data.format === 'beatmax-skin' ? data.skin : null;
        if (!src || !src.theme || !src.theme.palette || !src.theme.pillar) throw new Error('formato');
        const s = skinBlank('respect');
        ['accent', 'palette', 'body', 'pillar', 'panel', 'keys', 'line'].forEach(k => { if (src.theme[k] != null) s.theme[k] = src.theme[k]; });
        if (!SKIN_PILLAR_STYLES.some(([v]) => v === s.theme.pillar.style)) s.theme.pillar.style = 'metal';
        s.fx = Object.assign({}, SKIN_FX_DEFAULT, src.fx || {});
        s.name = String(src.name || 'Skin importada').slice(0, 40);
        s.laneImg = typeof src.laneImg === 'string' && src.laneImg.startsWith('data:image/') ? src.laneImg : null;
        s.laneImgAlpha = typeof src.laneImgAlpha === 'number' ? src.laneImgAlpha : 0.35;
        s.noteShape = typeof src.noteShape === 'string' ? src.noteShape : '';
        if (!skinCommit(s, `✅ "${s.name}" importada.`)) return;
        skinSelect(s.id);
    } catch (e) {
        skinMsg('⚠️ Esse arquivo não é uma skin do BEATMAX (.bmskin).');
    }
}

// ---------- prévia animada (gear de verdade, desenhada pelo mesmo código do jogo) ----------
function skinPreviewFrame(now) {
    if (!skinEd.open) return;
    skinEd.raf = requestAnimationFrame(skinPreviewFrame);
    const cv = document.getElementById('skin-canvas');
    const stage = document.getElementById('skin-stage');
    const GP = typeof gearProp === 'function' ? gearProp() : { H: 1080, P: GEAR_FRAME_BOTTOM };
    const F = GEAR_FRAME_SIDE, PB = GP.P, W = 520, H = GP.H, TW = W + F * 2, TH = H + PB;
    const other = [...stage.children].reduce((h, el) => h + (el === cv || getComputedStyle(el).position === 'absolute' ? 0 : el.offsetHeight + 8), 0);
    const availH = Math.max(200, stage.clientHeight - other - 30), availW = Math.max(150, stage.clientWidth - 20);
    const cssH = Math.min(availH, availW * TH / TW), cssW = cssH * TW / TH;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; }
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000'; c.fillRect(0, 0, pw, ph);
    if (!skinEd.cur || !GEAR_THEMES[SKIN_PREVIEW_KEY]) return;
    c.setTransform(pw / TW, 0, 0, ph / TH, 0, 0);

    const dt = Math.min(3, skinEd.last ? (now - skinEd.last) / (1000 / 60) : 1);
    skinEd.last = now;
    const t = now - skinEd.t0;
    const mode = skinEd.mode;
    const strikeY = H - 80;
    // mesma conta do jogo: na velocidade X a nota leva o mesmo tempo pra atravessar a pista
    const spd = skinEd.speed || scrollSpeed || 3;
    const speed = speedFactorForTravel(spd, H); // px por ms
    const save = { gearSkin, currentMode, noteShape, ctx, keyState, lw: canvas.logicalWidth, lh: canvas.logicalHeight, hp: hpDisplayed, ss: scrollSpeed };
    try {
        gearSkin = SKIN_PREVIEW_KEY;
        scrollSpeed = spd; // o painel da gear mostra a velocidade da prévia
        currentMode = mode;
        const th = GEAR_THEMES[SKIN_PREVIEW_KEY];
        if (th.noteShape) noteShape = th.noteShape;
        ctx = c;
        canvas.logicalWidth = W; canvas.logicalHeight = H;
        hpDisplayed = 100;
        const cols = getGameplayColumnLayout(mode, W);
        const colors = getKeyColorScheme(mode, SKIN_PREVIEW_KEY);
        // notas automáticas: um padrão simples que se repete
        const lastT = skinEd.notes.length ? skinEd.notes[skinEd.notes.length - 1].time : t;
        for (let nt = lastT + 160; nt < t + noteTravelMsForSpeed(spd) + 200; nt += 160 + ((nt / 160) % 3 === 0 ? 160 : 0)) {
            skinEd.notes.push({ time: nt, lane: Math.floor((Math.sin(nt * 0.0137) * 0.5 + 0.5) * cols.length) % cols.length });
        }
        const ks = cols.map((_, i) => (skinEd.keyUntil[i] || 0) > t || !!skinEd.keys[i]);
        keyState = ks;
        const L = { frame: true, F, P: PB, W, H, totalW: TW, totalH: TH, theme: th };
        const P = make2DPainter(c);
        P.sprite(gearFrameSpec(L), 0, 0);
        P.offset(F, 0, () => {
            drawGearLaneBase(P, L, true);
            const nh = NOTE_HEIGHT_BASE * noteSizeScale;
            skinEd.notes = skinEd.notes.filter(n => {
                if (n.time <= t) {
                    const col = cols[n.lane];
                    skinEd.flashes.push({ x: col.x + col.width / 2, y: strikeY, life: 1, color: colors[n.lane], big: (n.time / 160) % 4 < 1 });
                    skinEd.keyUntil[n.lane] = t + 90;
                    return false;
                }
                const y = strikeY - (n.time - t) * speed;
                if (y > -60) drawNote(n.lane, y, cols[n.lane], nh);
                return true;
            });
            drawGearStrikeLine(P, L, th.accent);
            drawGearKeyPanel(P, L, 0);
            skinEd.flashes = skinEd.flashes.filter(f => { drawGearHitFlash(P, f); f.life -= 0.07 * dt; return f.life > 0; });
        });
        drawGearFrameDynamic(P, L, 0);
    } catch (e) {
        console.warn('[skin] prévia', e);
    } finally {
        gearSkin = save.gearSkin; currentMode = save.currentMode; noteShape = save.noteShape; ctx = save.ctx; keyState = save.keyState;
        canvas.logicalWidth = save.lw; canvas.logicalHeight = save.lh; hpDisplayed = save.hp; scrollSpeed = save.ss;
    }
}

function skinKeyHandler(e) {
    if (!skinEd.open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); skinClose(); return; }
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' && e.target.type === 'text') return;
    const keys = KEY_CONFIGS[skinEd.mode] || [];
    const i = keys.indexOf(e.code);
    e.stopImmediatePropagation();
    if (i >= 0 && i < getMainLaneCount(skinEd.mode)) skinEd.keys[i] = e.type === 'keydown';
}

function openSkinEditor() {
    if (typeof isPlaying !== 'undefined' && isPlaying) return;
    const m = skinEnsureModal();
    m.classList.add('open');
    skinEd.open = true;
    skinEd.mode = ['4K', '5K', '6K', '8K'].includes(currentMode) ? currentMode : '4K';
    document.getElementById('skin-mode').value = skinEd.mode;
    if (skinEd.setSpeed) skinEd.setSpeed(scrollSpeed);
    skinEd.notes = []; skinEd.flashes = []; skinEd.keys = []; skinEd.keyUntil = []; skinEd.last = 0; skinEd.t0 = performance.now();
    const using = skinStore.skins.find(s => skinKey(s) === gearSkin);
    skinSelect(using ? using.id : (skinStore.skins[0] ? skinStore.skins[0].id : null));
    const from = document.getElementById('skin-new-from');
    if (GEAR_THEMES[gearSkin] && !GEAR_THEMES[gearSkin].custom) from.value = gearSkin;
    window.addEventListener('keydown', skinKeyHandler, true);
    window.addEventListener('keyup', skinKeyHandler, true);
    cancelAnimationFrame(skinEd.raf);
    skinEd.raf = requestAnimationFrame(skinPreviewFrame);
}

function skinClose() {
    if (skinEd.dirty && skinEd.cur && !confirm('Fechar sem salvar as mudanças dessa skin?')) return;
    skinEd.open = false;
    cancelAnimationFrame(skinEd.raf);
    document.getElementById('skin-modal').classList.remove('open');
    window.removeEventListener('keydown', skinKeyHandler, true);
    window.removeEventListener('keyup', skinKeyHandler, true);
    skinPurge(SKIN_PREVIEW_KEY);
    delete GEAR_THEMES[SKIN_PREVIEW_KEY];
}

// ---------- inicialização ----------
skinRegisterAll();
skinFillGearSelect();
skinLoadStore().then(() => {
    skinRegisterAll();
    skinFillGearSelect();
    // a config salva pode apontar pra uma skin do jogador (registrada só agora): redesenha
    if (GEAR_THEMES[gearSkin] && GEAR_THEMES[gearSkin].custom) { try { skinApplyNoteShape(); resizeCanvas(); } catch (e) {} }
});
(function addSkinButton() {
    const ref = document.getElementById('btn-settings');
    if (!ref || document.getElementById('btn-skin')) return;
    const b = document.createElement('button');
    b.id = 'btn-skin';
    b.className = ref.className;
    b.innerHTML = '<i class="fa-solid fa-palette text-pink-400"></i> Personalizar';
    ref.parentElement.insertBefore(b, ref);
    b.addEventListener('click', openSkinEditor);
    const gs = document.getElementById('main-gear-skin');
    if (gs) gs.addEventListener('change', skinApplyNoteShape);
})();
