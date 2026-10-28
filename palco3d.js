// =====================================================================================
// palco3d.js — PALCO 3D atrás da gear.
//
// Um cenário 3D que reage à música: anda no ritmo do BPM, pulsa em cada batida, solta
// ondas de choque nos acertos, ganha energia com o combo e fica vermelho no erro.
// A gear e as notas continuam EXATAMENTE as mesmas (retas, mesmo julgamento) — o 3D fica
// em volta, então não mexe na sincronia.
//
// Tudo é desenhado por código (shader WebGL), sem baixar nada: nenhum arquivo extra, nenhum
// problema de licença e roda offline. Temas: Túnel neon, Galáxia, Synthwave.
// Se o PC começar a perder quadros, a resolução do palco cai sozinha (e, no limite, 30 fps).
// =====================================================================================
(function () {
    const KEY = 'djmaxTrainerPalco_v1';
    const cfg = { tema: 'off', intensidade: 70, qualidade: 'auto', ondas: 'grandes' };
    try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
    const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
    const TEMAS = { tunel: 0, galaxia: 1, synthwave: 2 };
    // tamanho das ondas de choque dos acertos (0 = sem ondas; as luzes continuam)
    const ONDAS = { grandes: 1, medias: 0.6, pequenas: 0.32, off: 0 };

    const FRAG = `
precision mediump float;
uniform vec2 R; uniform float T, PULSE, ENERGY, HUE, MISS, THEME, TRAVEL, INT, RSCALE;
uniform vec4 RING[8]; uniform vec4 GEAR;
vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h*6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }

vec3 tunel(vec2 uv){
  float r = length(uv), a = atan(uv.y, uv.x);
  float z = 0.8/(r + 0.025) + TRAVEL;
  float dz = 0.5 - abs(fract(z) - 0.5);                        // distância até o anel mais próximo
  float ring = smoothstep(0.07, 0.0, dz);
  float da = 0.5 - abs(fract(a/6.2831*12.0 + z*0.05) - 0.5);
  float spokes = smoothstep(0.03, 0.0, da);
  float fade = smoothstep(0.03, 0.55, r);
  vec3 c = hsv(HUE + floor(z)*0.04, 0.75, 1.0) * (ring*(0.45 + 1.0*PULSE) + spokes*0.16) * fade * 0.8;
  c += hsv(HUE + 0.5, 0.6, 1.0) * 0.035/(r + 0.04) * (0.5 + PULSE);
  return c;
}
vec3 galaxia(vec2 uv){
  vec3 c = vec3(0.0);
  for (int i = 0; i < 4; i++){
    float fi = float(i);
    float depth = fract(fi*0.25 + TRAVEL*0.125);
    float scale = mix(26.0, 1.5, depth);
    vec2 p = uv*scale + vec2(fi*7.3, fi*3.1);
    vec2 id = floor(p), f = fract(p) - 0.5;
    float h = hash(id + fi*13.0);
    if (h > 0.86){
      vec2 o = vec2(hash(id + 1.7), hash(id + 2.3)) - 0.5;
      float d = length(f - o*0.6);
      float s = smoothstep(0.05*depth + 0.015, 0.0, d) * depth * smoothstep(1.0, 0.85, depth);
      c += hsv(HUE + h*0.3, 0.35, 1.0) * s * (1.2 + 1.5*PULSE);
    }
  }
  float n = fbm(uv*1.6 + vec2(T*0.02, -T*0.015));
  c += hsv(HUE + 0.12 + n*0.2, 0.7, 1.0) * pow(n, 2.6) * 0.55 * (0.7 + 0.5*PULSE);
  return c;
}
vec3 synthwave(vec2 uv){
  vec3 c;
  float hz = -0.05;
  if (uv.y < hz){
    float dy = hz - uv.y;
    float zz = 0.35/dy;
    vec2 g = vec2(uv.x*zz*1.6, zz + TRAVEL*1.0);
    vec2 w = abs(fract(g) - 0.5);
    float lw = 0.02*zz;
    float line = max(smoothstep(0.48 - lw, 0.5, w.x), smoothstep(0.48 - lw, 0.5, w.y));
    float fog = exp(-zz*0.12);
    c = mix(vec3(0.03, 0.0, 0.07), hsv(HUE + 0.85, 0.85, 1.0) * line * (0.8 + 1.4*PULSE), fog);
    c += hsv(HUE + 0.85, 0.8, 1.0) * 0.18 * exp(-dy*12.0);
  } else {
    float y = uv.y - hz;
    c = mix(hsv(HUE + 0.78, 0.7, 0.45), vec3(0.02, 0.0, 0.08), smoothstep(0.0, 0.9, y));
    vec2 sp = uv - vec2(0.0, hz + 0.27);
    float sd = length(sp);
    float sun = smoothstep(0.30, 0.295, sd);
    float stripes = step(0.5, fract((sp.y + T*0.02)*14.0)) + step(0.0, sp.y);
    sun *= clamp(stripes, 0.0, 1.0);
    c += mix(vec3(1.0, 0.85, 0.25), vec3(1.0, 0.2, 0.6), smoothstep(0.25, -0.3, sp.y)) * sun * (0.85 + 0.3*PULSE);
    c += vec3(1.0, 0.3, 0.6) * 0.12 * exp(-sd*4.0) * (1.0 + PULSE);
    float m = hz + 0.03 + 0.09*fbm(vec2(uv.x*2.5, 1.0)) - abs(uv.x)*0.02;
    if (uv.y < m) c = mix(c, vec3(0.04, 0.0, 0.1), 0.92);
  }
  return c;
}
void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5*R) / R.y;
  vec2 suv = frag / R;
  vec3 c;
  if (THEME < 0.5) c = tunel(uv);
  else if (THEME < 1.5) c = galaxia(uv);
  else c = synthwave(uv);
  c *= 0.5 + 0.75*ENERGY;
  // ondas de choque dos acertos
  for (int i = 0; i < 8; i++){
    vec4 rg = RING[i];
    if (RSCALE <= 0.0 || rg.z <= 0.0 || rg.z >= 1.0) continue;
    vec2 d = (suv - rg.xy) * vec2(R.x/R.y, 1.0);
    float rad = rg.z * 0.42 * RSCALE;
    float w = (0.006 + 0.02*rg.z) * max(0.5, RSCALE);
    float k = smoothstep(w, 0.0, abs(length(d) - rad)) * (1.0 - rg.z);
    c += hsv(rg.w, 0.6, 1.0) * k * 1.4;
  }
  // brilho em volta da gear, pulsando na batida
  vec2 q = abs(suv - GEAR.xy) - GEAR.zw;
  float gd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  if (gd > 0.0) c += hsv(HUE, 0.7, 1.0) * exp(-gd*R.y/45.0) * (0.25 + 0.6*PULSE) * (0.6 + 0.6*ENERGY);
  // erro: pisca vermelho nas bordas
  float vig = smoothstep(0.35, 1.0, length(suv - 0.5)*1.4);
  c = mix(c, vec3(0.7, 0.02, 0.08), MISS*0.5*vig);
  c *= 1.0 - 0.45*vig;
  gl_FragColor = vec4(c*INT, 1.0);
}`;
    const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

    const S = { cv: null, gl: null, prog: null, loc: {}, scale: 1, skip: false, odd: false, ringData: new Float32Array(32), rings: [], ringIdx: 0, seen: new WeakSet(), energy: 0, hue: 0.55, lastComboMs: 0, lastCombo: 0, perf: [], lastTs: 0, ok: true };

    function hueOf(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return 0.55;
        const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (!d) return 0.55;
        let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return ((h / 6) + 1) % 1;
    }

    // compila o shader num canvas (o do jogo e o da prévia do Personalizar usam o mesmo)
    function setupGL(cv) {
        const gl = cv.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
        if (!gl) return null;
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[palco3d]', gl.getShaderInfoLog(s)); return null; } return s; };
        const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return null;
        const prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[palco3d]', gl.getProgramInfoLog(prog)); return null; }
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const pl = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(pl);
        gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
        const loc = {};
        ['R', 'T', 'PULSE', 'ENERGY', 'HUE', 'MISS', 'THEME', 'TRAVEL', 'INT', 'RSCALE', 'RING', 'GEAR'].forEach(n => { loc[n] = gl.getUniformLocation(prog, n); });
        return { gl, prog, loc };
    }
    function drawGL(gl, loc, w, h, u) {
        gl.viewport(0, 0, w, h);
        gl.uniform2f(loc.R, w, h);
        gl.uniform1f(loc.T, u.t);
        gl.uniform1f(loc.PULSE, u.pulse);
        gl.uniform1f(loc.TRAVEL, u.travel);
        gl.uniform1f(loc.ENERGY, u.energy);
        gl.uniform1f(loc.HUE, u.hue);
        gl.uniform1f(loc.MISS, u.miss);
        gl.uniform1f(loc.THEME, TEMAS[u.tema] != null ? TEMAS[u.tema] : 0);
        gl.uniform1f(loc.INT, Math.max(0.1, u.intensidade / 100));
        gl.uniform1f(loc.RSCALE, ONDAS[cfg.ondas] != null ? ONDAS[cfg.ondas] : 1);
        gl.uniform4fv(loc.RING, u.rings);
        gl.uniform4f(loc.GEAR, u.gear[0], u.gear[1], u.gear[2], u.gear[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function init() {
        if (S.gl || !S.ok) return !!S.gl;
        const box = document.getElementById('game-container');
        if (!box) return false;
        const cv = document.createElement('canvas');
        cv.id = 'palco3d';
        cv.setAttribute('aria-hidden', 'true');
        cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;display:none;border-radius:12px';
        const dim = document.getElementById('game-bg-dim');
        if (dim && dim.parentElement === box) dim.insertAdjacentElement('afterend', cv); else box.insertBefore(cv, box.firstChild);
        ['gameCanvas', 'gameCanvasGL'].forEach(id => { const c = document.getElementById(id); if (c) { c.style.position = 'relative'; c.style.zIndex = '1'; } });
        const g = setupGL(cv);
        if (!g) { S.ok = false; cv.remove(); return false; }
        const { gl, prog } = g;
        S.loc = g.loc;
        S.cv = cv; S.gl = gl; S.prog = prog;
        cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); S.gl = null; S.ok = true; cv.remove(); S.cv = null; });
        return true;
    }

    function visibleGearCanvas() {
        const gl = document.getElementById('gameCanvasGL');
        if (gl && !gl.classList.contains('hidden') && gl.offsetParent) return gl;
        return document.getElementById('gameCanvas');
    }

    // posição (fração da tela do palco) de um ponto da gear
    function gearToUv(x, y, boxRect, gcRect) {
        const tw = canvas.totalWidth || canvas.logicalWidth, th = canvas.totalHeight || canvas.logicalHeight;
        const L = typeof getGearLayout === 'function' ? getGearLayout() : { F: 0 };
        const sx = gcRect.left + (x + (L.frame ? L.F : 0)) / tw * gcRect.width;
        const sy = gcRect.top + y / th * gcRect.height;
        return [(sx - boxRect.left) / boxRect.width, 1 - (sy - boxRect.top) / boxRect.height];
    }

    function beatInfo() {
        try {
            if (typeof chartTimeAt !== 'function' || typeof getTempoSegmentsForPattern !== 'function') return { travel: performance.now() / 500, pulse: 0 };
            const now = (typeof isPaused !== 'undefined' && isPaused && typeof pauseStartTime !== 'undefined') ? pauseStartTime : ((typeof renderClockMs !== 'undefined' && renderClockMs) || performance.now());
            const t = chartTimeAt(now) - (typeof CUSTOM_CHART_START_DELAY_MS !== 'undefined' ? CUSTOM_CHART_START_DELAY_MS : 2000);
            const segs = getTempoSegmentsForPattern(currentPatternType) || [];
            let seg = segs[0];
            for (const s of segs) if (t >= s.start) seg = s;
            if (!seg) return { travel: t / 500, pulse: 0 };
            const beats = (seg.measureStart || 0) * 4 + (t - seg.start) / seg.msPerBeat;
            const ph = beats - Math.floor(beats);
            return { travel: beats, pulse: t >= 0 ? Math.exp(-ph * 6) : 0 };
        } catch (e) { return { travel: performance.now() / 500, pulse: 0 }; }
    }

    // posições da tela em cache: ler getBoundingClientRect todo quadro força o navegador a
    // recalcular o layout no meio da partida (custa caro e dá travadinhas). Atualiza a cada 0,5s.
    const RC = { t: 0, box: null, gear: null, boxEl: null };
    window.addEventListener('resize', () => { RC.t = 0; });
    function cachedRects(boxEl, now) {
        if (RC.boxEl !== boxEl || !RC.box || now - RC.t > 500) {
            const gc = visibleGearCanvas();
            RC.boxEl = boxEl; RC.box = boxEl.getBoundingClientRect(); RC.gear = gc ? gc.getBoundingClientRect() : RC.box; RC.t = now;
        }
        return RC;
    }
    window.gearRectsCached = function (now) {
        const boxEl = document.getElementById('game-container');
        return boxEl ? cachedRects(boxEl, now || performance.now()) : null;
    };
    // orçamento de pixels do palco (o cenário é suave: não precisa de resolução cheia)
    const BUDGET = { alta: 1400000, auto: 420000, leve: 160000 };

    function frame(ts) {
        requestAnimationFrame(frame);
        const playing = typeof isPlaying !== 'undefined' && isPlaying;
        const fundoOn = typeof fundo !== 'undefined' && fundo.active;
        const want = cfg.tema !== 'off' && playing && !fundoOn;
        if (!want) { if (S.cv) S.cv.style.display = 'none'; S.lastTs = 0; S.perf = []; RC.t = 0; return; }
        if (!init()) return;
        const { cv, gl, loc } = S;
        cv.style.display = '';
        const rc = cachedRects(cv.parentElement, ts);
        const box = rc.box;
        // queda de desempenho? (modo automático) baixa a resolução e, no limite, desenha o palco
        // a 30 quadros por segundo (o jogo continua a 60: só o cenário de fundo atualiza menos)
        if (S.lastTs) {
            const d = ts - S.lastTs;
            S.perf.push(d);
            if (S.perf.length >= 120) {
                const sorted = S.perf.slice().sort((a, b) => a - b), med = sorted[60];
                const drops = S.perf.filter(x => x > med * 1.6).length;
                if (cfg.qualidade === 'auto' && drops > 3) {
                    if (S.scale > 0.45) S.scale *= 0.7; else S.skip = true;
                }
                S.perf = [];
            }
        }
        S.lastTs = ts;
        const half = cfg.qualidade === 'leve' || (cfg.qualidade === 'auto' && S.skip);
        S.odd = !S.odd;
        if (half && S.odd) return; // 30 fps: pula um quadro sim, outro não (o canvas mantém a imagem)
        // resolução: cabe no orçamento de pixels da qualidade escolhida
        const dpr = Math.min(1.5, window.devicePixelRatio || 1);
        const full = box.width * dpr * box.height * dpr;
        const budget = (BUDGET[cfg.qualidade] || BUDGET.auto) * (cfg.qualidade === 'auto' ? S.scale : 1);
        const k = Math.min(1, Math.sqrt(budget / Math.max(1, full)));
        const w = Math.max(64, Math.round(box.width * dpr * k)), h = Math.max(64, Math.round(box.height * dpr * k));
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        gl.viewport(0, 0, w, h);

        // cor do tema da gear
        try { const th = GEAR_THEMES[gearSkin]; if (th && th.accent) S.hue = hueOf(th.accent); } catch (e) {}
        // energia: sobe com o combo, cai no erro
        const combo = (typeof stats !== 'undefined' && stats.combo) || 0;
        const target = Math.min(1, combo / 150);
        S.energy += (target - S.energy) * 0.05;
        // ondas: cada explosão de acerto nova vira uma onda (tem um limite de 8 ao mesmo tempo)
        const gr = rc.gear;
        if (typeof hitFlashes !== 'undefined') {
            for (const f of hitFlashes) {
                if (S.seen.has(f)) continue;
                S.seen.add(f);
                if (cfg.ondas === 'off') continue;
                if (!f.big && Math.random() < 0.5) continue; // só metade dos acertos comuns, pra não poluir
                const uv = gearToUv(f.x, f.y, box, gr);
                S.rings[S.ringIdx] = { x: uv[0], y: uv[1], born: ts, hue: hueOf(f.color) };
                S.ringIdx = (S.ringIdx + 1) % 8;
            }
        }
        // marco de combo (a cada 100): onda grande saindo do topo da gear
        if (combo >= 100 && Math.floor(combo / 100) > Math.floor(S.lastCombo / 100)) {
            const cx = ((gr.left + gr.width / 2) - box.left) / box.width;
            const cy = 1 - ((gr.top + gr.height * 0.35) - box.top) / box.height;
            for (let k = 0; k < 3; k++) { S.rings[S.ringIdx] = { x: cx, y: cy, born: ts + k * 120, hue: (S.hue + k * 0.15) % 1, big: true }; S.ringIdx = (S.ringIdx + 1) % 8; }
        }
        S.lastCombo = combo;
        const ringData = S.ringData;
        ringData.fill(0);
        for (let i = 0; i < 8; i++) {
            const r = S.rings[i];
            if (!r) continue;
            const age = (ts - r.born) / (r.big ? 1400 : 700);
            ringData.set([r.x, r.y, age > 0 && age < 1 ? age : 0, r.hue], i * 4);
        }
        // retângulo da gear (centro e metade do tamanho, em fração da tela)
        const gx = ((gr.left + gr.width / 2) - box.left) / box.width, gy = 1 - ((gr.top + gr.height / 2) - box.top) / box.height;
        const b = beatInfo();
        drawGL(gl, loc, w, h, { t: ts / 1000, pulse: b.pulse, travel: b.travel, energy: S.energy, hue: S.hue,
            miss: Math.min(1, (typeof missShake !== 'undefined' ? missShake : 0)), tema: cfg.tema, intensidade: cfg.intensidade, rings: ringData,
            gear: [gx, gy, gr.width / box.width / 2, gr.height / box.height / 2] });
    }
    requestAnimationFrame(frame);

    // ---------- prévia no Personalizar (atrás da gear de exemplo) ----------
    const PV = { cv: null, g: null, rings: [], idx: 0, seen: new WeakSet(), ok: true };
    function previewFrame(ts) {
        requestAnimationFrame(previewFrame);
        const modal = document.getElementById('skin-modal');
        if (!modal || !modal.classList.contains('open')) { if (PV.cv) PV.cv.style.display = 'none'; return; }
        ensurePersonalizarPanel(modal);
        const stage = document.getElementById('skin-stage'), gcv = document.getElementById('skin-canvas');
        if (!stage || !gcv) return;
        if (cfg.tema === 'off' || !PV.ok) { if (PV.cv) PV.cv.style.display = 'none'; return; }
        if (!PV.cv) {
            const cv = document.createElement('canvas');
            cv.id = 'palco3d-preview';
            cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
            stage.style.position = 'relative';
            [...stage.children].forEach(ch => { ch.style.position = ch.style.position || 'relative'; ch.style.zIndex = '1'; });
            stage.insertBefore(cv, stage.firstChild);
            PV.g = setupGL(cv);
            if (!PV.g) { PV.ok = false; cv.remove(); return; }
            PV.cv = cv;
        }
        PV.cv.style.display = '';
        const box = stage.getBoundingClientRect(), gr = gcv.getBoundingClientRect();
        const w = Math.max(64, Math.round(box.width * 0.5)), h = Math.max(64, Math.round(box.height * 0.5));
        if (PV.cv.width !== w || PV.cv.height !== h) { PV.cv.width = w; PV.cv.height = h; }
        // batida de exemplo: 120 BPM
        const beats = ts / 500, ph = beats - Math.floor(beats);
        let hue = 0.55;
        try { const th = GEAR_THEMES['u__preview'] || GEAR_THEMES[gearSkin]; if (th && th.accent) hue = hueOf(th.accent); } catch (e) {}
        // ondas nas explosões da prévia
        try {
            const F = typeof GEAR_FRAME_SIDE !== 'undefined' ? GEAR_FRAME_SIDE : 30, GP = typeof gearProp === 'function' ? gearProp() : { H: 1080, P: 128 }, PB = GP.P;
            const TW = 520 + F * 2, TH = GP.H + PB;
            (skinEd.flashes || []).forEach(f => {
                if (PV.seen.has(f)) return;
                PV.seen.add(f);
                if (!f.big && Math.random() < 0.5) return;
                const sx = gr.left + (f.x + F) / TW * gr.width, sy = gr.top + f.y / TH * gr.height;
                PV.rings[PV.idx] = { x: (sx - box.left) / box.width, y: 1 - (sy - box.top) / box.height, born: ts, hue: hueOf(f.color) };
                PV.idx = (PV.idx + 1) % 8;
            });
        } catch (e) {}
        const rd = new Float32Array(32);
        PV.rings.forEach((r, i) => { if (!r) return; const age = (ts - r.born) / 700; rd.set([r.x, r.y, age > 0 && age < 1 ? age : 0, r.hue], i * 4); });
        const gx = ((gr.left + gr.width / 2) - box.left) / box.width, gy = 1 - ((gr.top + gr.height / 2) - box.top) / box.height;
        drawGL(PV.g.gl, PV.g.loc, w, h, { t: ts / 1000, pulse: Math.exp(-ph * 6), travel: beats, energy: 0.55 + 0.45 * Math.sin(ts / 2500), hue, miss: 0,
            tema: cfg.tema, intensidade: cfg.intensidade, rings: rd, gear: [gx, gy, gr.width / box.width / 2, gr.height / box.height / 2] });
    }
    requestAnimationFrame(previewFrame);

    // controles do palco (Configurações e Personalizar mexem na MESMA configuração)
    function palcoControlsHtml(prefix) {
        return `<select id="${prefix}" class="pc-sel">
                <option value="off">Desligado</option><option value="tunel">Túnel neon</option><option value="galaxia">Galáxia</option><option value="synthwave">Synthwave</option></select>
            <span class="pc-lbl">Intensidade</span><input type="range" id="${prefix}-int" min="20" max="100" step="5"><span id="${prefix}-int-val" class="pc-val"></span>
            <select id="${prefix}-q" class="pc-sel" title="Qualidade (Automática baixa sozinha se o PC perder quadros)"><option value="auto">Automática</option><option value="leve">Leve</option><option value="alta">Alta</option></select>
            ${ondasSelect(prefix, 'pc-sel')}`;
    }
    function ondasSelect(prefix, cls) {
        return `<select id="${prefix}-ondas" class="${cls}" title="Ondas que saem dos acertos e do combo (as luzes e o brilho continuam)"><option value="grandes">Ondas grandes</option><option value="medias">Ondas médias</option><option value="pequenas">Ondas pequenas</option><option value="off">Sem ondas</option></select>`;
    }
    function bindControls(prefix) {
        const sel = document.getElementById(prefix), it = document.getElementById(prefix + '-int'), iv = document.getElementById(prefix + '-int-val'), q = document.getElementById(prefix + '-q');
        if (!sel) return;
        sel.addEventListener('change', () => { cfg.tema = sel.value; saveCfg(); syncAll(); });
        it.addEventListener('input', () => { cfg.intensidade = +it.value; saveCfg(); syncAll(); });
        q.addEventListener('change', () => { cfg.qualidade = q.value; S.scale = 1; S.skip = false; saveCfg(); syncAll(); });
        document.getElementById(prefix + '-ondas')?.addEventListener('change', (e) => { cfg.ondas = e.target.value; saveCfg(); syncAll(); });
    }
    function syncAll() {
        ['setting-palco', 'skin-palco'].forEach(prefix => {
            const sel = document.getElementById(prefix); if (!sel) return;
            sel.value = cfg.tema;
            document.getElementById(prefix + '-int').value = cfg.intensidade;
            document.getElementById(prefix + '-int-val').textContent = cfg.intensidade + '%';
            document.getElementById(prefix + '-q').value = cfg.qualidade;
            const o = document.getElementById(prefix + '-ondas'); if (o) o.value = cfg.ondas || 'grandes';
        });
    }
    function ensurePersonalizarPanel(modal) {
        if (document.getElementById('skin-palco')) return;
        const side = modal.querySelector('#skin-side');
        if (!side) return;
        const css = document.createElement('style');
        css.textContent = `#skin-palco-box{border-top:1px solid rgba(236,72,153,.3);padding:10px 14px 12px;background:#0b1120}
#skin-palco-box .t{font-weight:800;color:#67e8f9;font-size:12.5px;margin-bottom:2px}
#skin-palco-box .d{color:#64748b;font-size:11px;margin-bottom:6px;line-height:1.3}
#skin-palco-box .r{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
#skin-palco-box .pc-sel{background:#020617;border:1px solid #334155;border-radius:6px;padding:4px 6px;color:#e2e8f0;font-size:12px}
#skin-palco-box input[type=range]{width:110px;accent-color:#ec4899}
#skin-palco-box .pc-lbl{color:#94a3b8;font-size:12px}#skin-palco-box .pc-val{color:#f9a8d4;font-family:monospace;font-size:12px;width:34px}`;
        document.head.appendChild(css);
        const box = document.createElement('div');
        box.id = 'skin-palco-box';
        box.innerHTML = `<div class="t">🎆 Palco 3D (atrás da gear)</div>
            <div class="d">Cenário que pulsa na batida, solta ondas nos acertos e ganha energia com o combo. Vale pra todas as skins — veja a prévia ao lado. As notas não mudam.</div>
            <div class="r">${palcoControlsHtml('skin-palco')}</div>`;
        side.appendChild(box);
        bindControls('skin-palco');
        syncAll();
    }

    // ---------- Configurações (Gear e fundo) ----------
    (function ui() {
        const anchor = document.getElementById('setting-gear-position');
        const row = anchor && anchor.closest('label');
        if (!row || document.getElementById('setting-palco')) return;
        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col gap-1';
        wrap.innerHTML = `
            <label class="flex items-center justify-between gap-3">
                <span><span class="text-xs font-bold text-slate-200 block">Palco 3D atrás da gear</span>
                <span class="text-[10px] text-slate-400">Cenário que anda no ritmo, pulsa na batida, solta ondas nos acertos e ganha energia com o combo. A gear e as notas não mudam (sincronia igual). Fica desligado quando a música tem vídeo/imagem de fundo.</span></span>
                <select id="setting-palco" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 shrink-0" style="min-width:8.5rem">
                    <option value="off">Desligado</option><option value="tunel">Túnel neon</option><option value="galaxia">Galáxia</option><option value="synthwave">Synthwave</option>
                </select>
            </label>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="text-slate-300">Intensidade</span><input type="range" id="setting-palco-int" min="20" max="100" step="5" class="accent-cyan-400 flex-1"><span id="setting-palco-int-val" class="font-mono text-cyan-300 w-10 text-right"></span>
                <select id="setting-palco-q" class="bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-slate-100" title="Qualidade do palco (Automática baixa sozinha se o PC perder quadros)">
                    <option value="auto">Automática</option><option value="leve">Leve</option><option value="alta">Alta</option>
                </select>
                ${ondasSelect('setting-palco', 'bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-slate-100')}
            </div>`;
        row.insertAdjacentElement('afterend', wrap);
        bindControls('setting-palco');
        syncAll();
    })();
    window.palco3dCfg = cfg;
    window.palcoBeatInfo = beatInfo;
    window.palcoGearCanvas = visibleGearCanvas;
})();
