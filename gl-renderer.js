// =====================================================================================
// gl-renderer.js — "motor" 2D em WebGL usado pela tela de JOGO.
//
// Em vez do Canvas 2D (que redesenha tudo na CPU e fica pesado com brilho/sombra), tudo
// aqui vira triângulos enviados em lote pra placa de vídeo:
//   - formas simples (retângulos, linhas, anéis, elipses, degradês) são geometria pura;
//   - brilho ("glow") é feito com bordas esfumadas somadas (blend aditivo), nunca shadowBlur;
//   - o que é complexo de desenhar (skins das notas, fundo da gear, textos) é desenhado UMA
//     vez num canvas escondido e vira textura — depois é só "carimbar" na tela a cada frame.
// Coordenadas sempre em unidades LÓGICAS da tela do jogo (ex.: 520x1080), iguais às do
// Canvas 2D antigo, então toda a matemática de posição do jogo continua a mesma.
// =====================================================================================
(function (global) {
    'use strict';

    const VS = [
        'attribute vec2 aPos;',
        'attribute vec2 aUV;',
        'attribute vec4 aCol;',
        'uniform vec2 uRes;',
        'uniform vec2 uOff;',
        'varying vec2 vUV;',
        'varying vec4 vCol;',
        'void main() {',
        '  vec2 p = (aPos + uOff) / uRes * 2.0 - 1.0;',
        '  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);',
        '  vUV = aUV;',
        '  vCol = aCol;',
        '}'
    ].join('\n');

    const FS = [
        'precision mediump float;',
        'uniform sampler2D uTex;',
        'varying vec2 vUV;',
        'varying vec4 vCol;',
        'void main() {',
        '  gl_FragColor = texture2D(uTex, vUV) * vCol;',
        '}'
    ].join('\n');

    // ---------- cores CSS -> [r,g,b,a] (0..1), com cache ----------
    const colorCache = new Map();
    function parseColor(c) {
        if (Array.isArray(c)) return c;
        if (c == null) return [1, 1, 1, 1];
        let v = colorCache.get(c);
        if (v) return v;
        const s = String(c).trim().toLowerCase();
        v = [1, 1, 1, 1];
        if (s[0] === '#') {
            const h = s.slice(1);
            if (h.length === 3 || h.length === 4) {
                v = [parseInt(h[0] + h[0], 16) / 255, parseInt(h[1] + h[1], 16) / 255, parseInt(h[2] + h[2], 16) / 255,
                    h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1];
            } else if (h.length === 6 || h.length === 8) {
                v = [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255,
                    h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
            }
        } else if (s.startsWith('rgb')) {
            const m = s.match(/[\d.]+/g) || [];
            v = [(+m[0] || 0) / 255, (+m[1] || 0) / 255, (+m[2] || 0) / 255, m[3] != null ? +m[3] : 1];
        } else if (s === 'transparent') {
            v = [0, 0, 0, 0];
        } else if (s === 'white') {
            v = [1, 1, 1, 1];
        } else if (s === 'black') {
            v = [0, 0, 0, 1];
        }
        if (colorCache.size > 2000) colorCache.clear();
        colorCache.set(c, v);
        return v;
    }
    // mesma cor com outra opacidade (multiplica a alpha já existente)
    function withAlpha(c, a) {
        const p = parseColor(c);
        return [p[0], p[1], p[2], p[3] * a];
    }

    const FLOATS_PER_VERT = 8;

    class GLBatchRenderer {
        constructor(canvas, opts) {
            opts = opts || {};
            const attrs = {
                // com fundo transparente dá pra ver a imagem de fundo atrás da gear; no modo de
                // baixa latência o navegador exige canvas opaco.
                alpha: !opts.lowLatency,
                antialias: true,
                depth: false,
                stencil: false,
                premultipliedAlpha: true,
                // "Baixa latência": o navegador pula o compositor e manda o frame direto pra tela
                // (menos atraso, pode rasgar a imagem em alguns PCs — por isso é opcional).
                desynchronized: !!opts.lowLatency,
                preserveDrawingBuffer: !!opts.lowLatency,
                powerPreference: 'high-performance'
            };
            const gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
            if (!gl) throw new Error('WebGL indisponível neste navegador/PC');
            this.gl = gl;
            this.canvas = canvas;
            this._texSeq = 0;
            this._additive = false;
            this.lowLatency = !!opts.lowLatency;
            this.hasAlpha = !opts.lowLatency;

            const prog = this._program(VS, FS);
            this.prog = prog;
            this.aPos = gl.getAttribLocation(prog, 'aPos');
            this.aUV = gl.getAttribLocation(prog, 'aUV');
            this.aCol = gl.getAttribLocation(prog, 'aCol');
            this.uRes = gl.getUniformLocation(prog, 'uRes');
            this.uOff = gl.getUniformLocation(prog, 'uOff');
            this.uTex = gl.getUniformLocation(prog, 'uTex');

            this.MAX_VERTS = 16384;
            this.MAX_IDX = this.MAX_VERTS * 3;
            this.data = new Float32Array(this.MAX_VERTS * FLOATS_PER_VERT);
            this.idx = new Uint16Array(this.MAX_IDX);
            this.nv = 0;
            this.ni = 0;
            this.vbo = gl.createBuffer();
            this.ibo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx.byteLength, gl.DYNAMIC_DRAW);

            gl.useProgram(prog);
            const stride = FLOATS_PER_VERT * 4;
            gl.enableVertexAttribArray(this.aPos);
            gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, stride, 0);
            gl.enableVertexAttribArray(this.aUV);
            gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, stride, 8);
            gl.enableVertexAttribArray(this.aCol);
            gl.vertexAttribPointer(this.aCol, 4, gl.FLOAT, false, stride, 16);
            gl.uniform1i(this.uTex, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.enable(gl.BLEND);
            gl.disable(gl.DEPTH_TEST);
            gl.disable(gl.CULL_FACE);

            // textura branca 1x1: geometria pura usa ela (cor = só a cor do vértice)
            const white = document.createElement('canvas');
            white.width = white.height = 4;
            const wc = white.getContext('2d');
            wc.fillStyle = '#fff';
            wc.fillRect(0, 0, 4, 4);
            this.white = this.createTexture(white, 4, 4);
            this.white.u0 = this.white.v0 = 0.375; // centro da textura, sem pegar borda
            this.white.u1 = this.white.v1 = 0.625;

            this.curTex = null;
            this.blend = null;
            this.alpha = 1;       // opacidade global (tipo ctx.globalAlpha)
            this.lw = 1; this.lh = 1;
            this.offX = 0; this.offY = 0;
            this.drawCalls = 0;
            this.setBlend('normal');
        }

        _shader(type, src) {
            const gl = this.gl;
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
            return s;
        }
        _program(vs, fs) {
            const gl = this.gl;
            const p = gl.createProgram();
            gl.attachShader(p, this._shader(gl.VERTEX_SHADER, vs));
            gl.attachShader(p, this._shader(gl.FRAGMENT_SHADER, fs));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
            return p;
        }

        get isLost() { return this.gl.isContextLost(); }

        rendererName() {
            const gl = this.gl;
            try {
                const ext = gl.getExtension('WEBGL_debug_renderer_info');
                if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
            } catch (e) { /* sem info */ }
            return String(gl.getParameter(gl.RENDERER));
        }

        // ---------- texturas ----------
        // src: canvas/imagem. lw/lh: tamanho LÓGICO que a textura ocupa na tela.
        // ax/ay: ponto de ancoragem (em unidades lógicas a partir do canto de cima/esquerda).
        createTexture(src, lw, lh, ax, ay) {
            const gl = this.gl;
            // desenha o que já está na fila ANTES de trocar a textura ligada (senão o lote
            // pendente sairia com a textura nova)
            this.flush();
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.curTex = null; // o bind acima trocou a textura atual
            return {
                tex, id: ++this._texSeq, pw: src.width, ph: src.height,
                w: lw != null ? lw : src.width, h: lh != null ? lh : src.height,
                ax: ax || 0, ay: ay || 0,
                u0: 0, v0: 0, u1: 1, v1: 1
            };
        }
        deleteTexture(t) {
            if (!t || !t.tex) return;
            if (this.curTex === t.tex) { this.flush(); this.curTex = null; }
            this.gl.deleteTexture(t.tex);
            t.tex = null;
        }

        // ---------- frame ----------
        begin(logicalW, logicalH, offX, offY, clear) {
            const gl = this.gl;
            this.lw = logicalW;
            this.lh = logicalH;
            this.offX = offX || 0;
            this.offY = offY || 0;
            this.drawCalls = 0;
            this.alpha = 1;
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.useProgram(this.prog);
            gl.uniform2f(this.uRes, logicalW, logicalH);
            gl.uniform2f(this.uOff, this.offX, this.offY);
            const c = parseColor(clear || '#000');
            const ca = this.hasAlpha ? c[3] : 1;
            gl.clearColor(c[0] * ca, c[1] * ca, c[2] * ca, ca);
            gl.disable(gl.SCISSOR_TEST);
            gl.clear(gl.COLOR_BUFFER_BIT);
            this.curTex = null;
            this.blend = null;
            this.setBlend('normal');
        }
        // recorte retangular (coordenadas lógicas totais, sem o deslocamento) — null desliga
        scissor(x, y, w, h) {
            this.flush();
            const gl = this.gl;
            if (x == null) { gl.disable(gl.SCISSOR_TEST); return; }
            const sx = this.canvas.width / this.lw, sy = this.canvas.height / this.lh;
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(Math.round(x * sx), Math.round(this.canvas.height - (y + h) * sy), Math.max(0, Math.round(w * sx)), Math.max(0, Math.round(h * sy)));
        }
        setOffset(x, y) {
            if (x === this.offX && y === this.offY) return;
            this.flush();
            this.offX = x; this.offY = y;
            this.gl.uniform2f(this.uOff, x, y);
        }
        end() { this.flush(); }

        setBlend(mode) {
            if (mode === this.blend) return;
            this.flush();
            const gl = this.gl;
            if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
            else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            this.blend = mode;
        }

        _useTex(t) {
            const tex = (t || this.white).tex;
            if (tex !== this.curTex) {
                this.flush();
                this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
                this.curTex = tex;
            }
        }

        flush() {
            if (this.ni === 0) return;
            const gl = this.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.nv * FLOATS_PER_VERT));
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
            gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.idx.subarray(0, this.ni));
            gl.drawElements(gl.TRIANGLES, this.ni, gl.UNSIGNED_SHORT, 0);
            this.drawCalls++;
            this.nv = 0;
            this.ni = 0;
        }

        _reserve(nv, ni) {
            if (this.nv + nv > this.MAX_VERTS || this.ni + ni > this.MAX_IDX) this.flush();
            return this.nv;
        }

        // um vértice: posição, uv e cor (convertida pra alpha pré-multiplicada)
        _v(x, y, u, v, c) {
            const a = c[3] * this.alpha;
            const o = this.nv * FLOATS_PER_VERT;
            const d = this.data;
            d[o] = x; d[o + 1] = y; d[o + 2] = u; d[o + 3] = v;
            d[o + 4] = c[0] * a; d[o + 5] = c[1] * a; d[o + 6] = c[2] * a;
            d[o + 7] = (this.blend === 'add' || this._additive) ? 0 : a;
            this.nv++;
        }
        _tri(a, b, c) {
            const i = this.ni;
            this.idx[i] = a; this.idx[i + 1] = b; this.idx[i + 2] = c;
            this.ni += 3;
        }

        // Quadrilátero qualquer: cantos em ordem (cima-esq, cima-dir, baixo-dir, baixo-esq).
        quad4(x0, y0, x1, y1, x2, y2, x3, y3, c0, c1, c2, c3, tex, u0, v0, u1, v1) {
            const t = tex || this.white;
            this._useTex(t);
            if (u0 == null) { u0 = t.u0; v0 = t.v0; u1 = t.u1; v1 = t.v1; }
            const b = this._reserve(4, 6);
            this._v(x0, y0, u0, v0, parseColor(c0));
            this._v(x1, y1, u1, v0, parseColor(c1 != null ? c1 : c0));
            this._v(x2, y2, u1, v1, parseColor(c2 != null ? c2 : c0));
            this._v(x3, y3, u0, v1, parseColor(c3 != null ? c3 : c0));
            this._tri(b, b + 1, b + 2);
            this._tri(b, b + 2, b + 3);
        }

        rect(x, y, w, h, color) {
            this.quad4(x, y, x + w, y, x + w, y + h, x, y + h, color);
        }
        // degradê vertical (cor de cima -> cor de baixo)
        rectV(x, y, w, h, cTop, cBottom) {
            this.quad4(x, y, x + w, y, x + w, y + h, x, y + h, cTop, cTop, cBottom, cBottom);
        }
        // degradê horizontal (esquerda -> direita)
        rectH(x, y, w, h, cLeft, cRight) {
            this.quad4(x, y, x + w, y, x + w, y + h, x, y + h, cLeft, cRight, cRight, cLeft);
        }
        // degradê com várias paradas (stops: [[t, cor], ...], t de 0 a 1), vertical ou horizontal
        rectStops(x, y, w, h, stops, horizontal) {
            for (let i = 0; i < stops.length - 1; i++) {
                const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
                if (t1 <= t0) continue;
                if (horizontal) this.rectH(x + w * t0, y, w * (t1 - t0), h, c0, c1);
                else this.rectV(x, y + h * t0, w, h * (t1 - t0), c0, c1);
            }
        }
        poly4(pts, color) {
            this.quad4(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7], color);
        }

        // linha grossa entre dois pontos (quad orientado)
        line(x0, y0, x1, y1, width, color, color1) {
            const dx = x1 - x0, dy = y1 - y0;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len * width / 2, ny = dx / len * width / 2;
            const c1 = color1 != null ? color1 : color;
            this.quad4(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, color, c1, c1, color);
        }

        // "brilho" em volta de uma linha: duas faixas esfumadas (somadas na tela)
        glowLine(x0, y0, x1, y1, width, color, glow, glowAlpha) {
            if (!(glow > 0.3) || !(glowAlpha > 0.005)) return;
            const dx = x1 - x0, dy = y1 - y0;
            const len = Math.hypot(dx, dy) || 1;
            const ux = -dy / len, uy = dx / len;
            const hw = width / 2;
            const cIn = withAlpha(color, glowAlpha);
            const cOut = withAlpha(color, 0);
            const prev = this._additive;
            this._additive = true; // soma na tela sem trocar o blend (alpha 0 com cor pré-multiplicada)
            for (const s of [1, -1]) {
                const ix = ux * hw * s, iy = uy * hw * s;
                const ox = ux * (hw + glow) * s, oy = uy * (hw + glow) * s;
                this.quad4(x0 + ix, y0 + iy, x1 + ix, y1 + iy, x1 + ox, y1 + oy, x0 + ox, y0 + oy, cIn, cIn, cOut, cOut);
            }
            // pontinhas arredondadas simples (continua o brilho um pouco além das pontas)
            const tx = dx / len * glow, ty = dy / len * glow;
            this.quad4(x0 + ux * hw, y0 + uy * hw, x0 - ux * hw, y0 - uy * hw, x0 - ux * hw - tx, y0 - uy * hw - ty, x0 + ux * hw - tx, y0 + uy * hw - ty, cIn, cIn, cOut, cOut);
            this.quad4(x1 - ux * hw, y1 - uy * hw, x1 + ux * hw, y1 + uy * hw, x1 + ux * hw + tx, y1 + uy * hw + ty, x1 - ux * hw + tx, y1 - uy * hw + ty, cIn, cIn, cOut, cOut);
            this._additive = prev;
        }

        // brilho em volta de um retângulo (moldura esfumada pra fora)
        glowRect(x, y, w, h, color, glow, glowAlpha) {
            if (!(glow > 0.3) || !(glowAlpha > 0.005)) return;
            const cIn = withAlpha(color, glowAlpha), cOut = withAlpha(color, 0);
            const prev = this._additive;
            this._additive = true; // soma na tela sem trocar o blend (alpha 0 com cor pré-multiplicada)
            const g = glow;
            // cima, baixo, esquerda, direita (com cantos em "leque" simples)
            this.quad4(x, y - g, x + w, y - g, x + w, y, x, y, cOut, cOut, cIn, cIn);
            this.quad4(x, y + h, x + w, y + h, x + w, y + h + g, x, y + h + g, cIn, cIn, cOut, cOut);
            this.quad4(x - g, y, x, y, x, y + h, x - g, y + h, cOut, cIn, cIn, cOut);
            this.quad4(x + w, y, x + w + g, y, x + w + g, y + h, x + w, y + h, cIn, cOut, cOut, cIn);
            // cantos: triângulo do canto até as bordas
            const corner = (cx, cy, sx, sy) => {
                this._useTex(this.white);
                const b = this._reserve(4, 6);
                const t = this.white;
                this._v(cx, cy, t.u0, t.v0, parseColor(cIn));
                this._v(cx + g * sx, cy, t.u0, t.v0, parseColor(cOut));
                this._v(cx + g * sx * 0.7071, cy + g * sy * 0.7071, t.u0, t.v0, parseColor(cOut));
                this._v(cx, cy + g * sy, t.u0, t.v0, parseColor(cOut));
                this._tri(b, b + 1, b + 2);
                this._tri(b, b + 2, b + 3);
            };
            corner(x, y, -1, -1); corner(x + w, y, 1, -1); corner(x + w, y + h, 1, 1); corner(x, y + h, -1, 1);
            this._additive = prev;
        }

        // contorno de retângulo (4 linhas)
        strokeRect(x, y, w, h, lw, color) {
            const hl = lw / 2;
            this.rect(x - hl, y - hl, w + lw, lw, color);
            this.rect(x - hl, y + h - hl, w + lw, lw, color);
            this.rect(x - hl, y + hl, lw, h - lw, color);
            this.rect(x + w - hl, y + hl, lw, h - lw, color);
        }
        // contorno de um quadrilátero qualquer (pts = 8 números), opcionalmente com brilho
        strokePoly4(pts, lw, color, glow, glowAlpha) {
            for (let i = 0; i < 4; i++) {
                const j = (i + 1) % 4;
                this.line(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], lw, color);
                if (glow) this.glowLine(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], lw, color, glow, glowAlpha);
            }
        }

        _segs(r) { return Math.max(12, Math.min(64, Math.round(r * 0.9))); }

        // elipse cheia com degradê do centro pra borda (cCenter -> cEdge)
        ellipse(cx, cy, rx, ry, cCenter, cEdge, segs) {
            const n = segs || this._segs(Math.max(rx, ry));
            this._useTex(this.white);
            const t = this.white;
            const b = this._reserve(n + 1, n * 3);
            const cc = parseColor(cCenter), ce = parseColor(cEdge != null ? cEdge : cCenter);
            this._v(cx, cy, t.u0, t.v0, cc);
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                this._v(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, t.u0, t.v0, ce);
            }
            for (let i = 0; i < n; i++) this._tri(b, b + 1 + i, b + 1 + ((i + 1) % n));
        }
        circle(cx, cy, r, color) { this.ellipse(cx, cy, r, r, color, color); }

        // anel (faixa entre dois raios) com cor interna/externa própria — base do contorno
        // redondo e do brilho em volta de anéis
        ellipseBand(cx, cy, rxIn, ryIn, rxOut, ryOut, cIn, cOut, segs) {
            const n = segs || this._segs(Math.max(rxOut, ryOut));
            this._useTex(this.white);
            const t = this.white;
            const b = this._reserve(n * 2, n * 6);
            const ci = parseColor(cIn), co = parseColor(cOut != null ? cOut : cIn);
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
                this._v(cx + ca * rxIn, cy + sa * ryIn, t.u0, t.v0, ci);
                this._v(cx + ca * rxOut, cy + sa * ryOut, t.u0, t.v0, co);
            }
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                this._tri(b + i * 2, b + i * 2 + 1, b + j * 2 + 1);
                this._tri(b + i * 2, b + j * 2 + 1, b + j * 2);
            }
        }
        // contorno de elipse (tipo ctx.ellipse + stroke)
        ring(cx, cy, rx, ry, lw, color) {
            const h = lw / 2;
            this.ellipseBand(cx, cy, Math.max(0, rx - h), Math.max(0, ry - h), rx + h, ry + h, color, color);
        }
        // brilho em volta de um contorno de elipse (pra dentro e pra fora)
        ringGlow(cx, cy, rx, ry, lw, color, glow, glowAlpha) {
            if (!(glow > 0.3) || !(glowAlpha > 0.005)) return;
            const h = lw / 2;
            const cIn = withAlpha(color, glowAlpha), cOut = withAlpha(color, 0);
            const prev = this._additive;
            this._additive = true; // soma na tela sem trocar o blend (alpha 0 com cor pré-multiplicada)
            const sy = ry / Math.max(0.001, rx);
            this.ellipseBand(cx, cy, rx + h, ry + h * sy, rx + h + glow, ry + (h + glow) * sy, cIn, cOut);
            const inR = Math.max(0, rx - h - glow);
            this.ellipseBand(cx, cy, inR, inR * sy, Math.max(0, rx - h), Math.max(0, ry - h * sy), cOut, cIn);
            this._additive = prev;
        }
        // "bolinha" de brilho (círculo esfumado) — pra partículas, núcleos, halos
        softDot(cx, cy, r, color, alpha) {
            const prev = this._additive;
            this._additive = true; // soma na tela sem trocar o blend (alpha 0 com cor pré-multiplicada)
            this.ellipse(cx, cy, r, r, withAlpha(color, alpha == null ? 1 : alpha), withAlpha(color, 0), 16);
            this._additive = prev;
        }

        // Textura desenhada na posição da âncora (x, y) — opções: alpha, sx/sy (escala), rot
        // (radianos, gira em volta da âncora), tint (cor multiplicada).
        sprite(t, x, y, o) {
            if (!t || !t.tex) return;
            o = o || {};
            const sx = o.sx != null ? o.sx : 1, sy = o.sy != null ? o.sy : sx;
            const prevA = this.alpha;
            if (o.alpha != null) this.alpha = prevA * o.alpha;
            const c = o.tint || [1, 1, 1, 1];
            const L = -t.ax * sx, T = -t.ay * sy, R = (t.w - t.ax) * sx, B = (t.h - t.ay) * sy;
            if (o.rot) {
                const cs = Math.cos(o.rot), sn = Math.sin(o.rot);
                // gira e depois aplica o "achatamento" extra squashY (pra hexágono deitado etc.)
                const q = o.squashY != null ? o.squashY : 1;
                const P = (px, py) => [x + px * cs - py * sn, y + (px * sn + py * cs) * q];
                const a = P(L, T), b = P(R, T), d = P(R, B), e = P(L, B);
                this.quad4(a[0], a[1], b[0], b[1], d[0], d[1], e[0], e[1], c, c, c, c, t, 0, 0, 1, 1);
            } else {
                this.quad4(x + L, y + T, x + R, y + T, x + R, y + B, x + L, y + B, c, c, c, c, t, 0, 0, 1, 1);
            }
            this.alpha = prevA;
        }
        // pedaço da textura (coordenadas lógicas da textura: tx,ty,tw,th) esticado num retângulo
        spriteSub(t, tx, ty, tw, th, dx, dy, dw, dh, alpha) {
            if (!t || !t.tex || dw <= 0 || dh <= 0) return;
            const prevA = this.alpha;
            if (alpha != null) this.alpha = prevA * alpha;
            const u0 = tx / t.w, v0 = ty / t.h, u1 = (tx + tw) / t.w, v1 = (ty + th) / t.h;
            const c = [1, 1, 1, 1];
            this.quad4(dx, dy, dx + dw, dy, dx + dw, dy + dh, dx, dy + dh, c, c, c, c, t, u0, v0, u1, v1);
            this.alpha = prevA;
        }
    }

    global.GLBatchRenderer = GLBatchRenderer;
    global.glParseColor = parseColor;
    global.glWithAlpha = withAlpha;
})(window);
