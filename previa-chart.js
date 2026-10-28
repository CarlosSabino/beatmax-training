// =====================================================================================
// previa-chart.js — PRÉVIA DO CHART na tela de seleção (ideia do Spin Rhythm XD).
//
// No card da música selecionada aparece uma pistinha em perspectiva com as notas de verdade
// daquela música/dificuldade descendo. Nas músicas com áudio, ela anda junto com a prévia da
// música que está tocando; nos treinos, mostra um trecho em loop. Trocar a dificuldade (← →)
// troca a prévia na hora.
// =====================================================================================
(function () {
    // quanto tempo de notas aparece na pista: o MESMO tempo da partida na velocidade escolhida
    const windowMs = () => (typeof noteTravelMsForSpeed === 'function' ? noteTravelMsForSpeed(typeof scrollSpeed === 'number' ? scrollSpeed : 3) : 1700);
    const LOOP_MS = 14000;       // trecho em loop quando não tem áudio tocando
    const P = { cv: null, key: null, notes: [], kinds: [], mode: '4K', colors: [], t0: 0, start: 0, end: 0, flashes: [], lastT: null, chartId: null };
    const cache = new Map();
    // estilo: '3d' (pista em perspectiva) ou 'pista' (reta, igual à gear do jogo, com as cores da sua skin)
    const STYLE_KEY = 'beatmaxPreviaChartEstilo';
    let style = '3d';
    try { style = localStorage.getItem(STYLE_KEY) === 'pista' ? 'pista' : '3d'; } catch (e) {}

    function ensureCanvas() {
        const card = document.getElementById('song-preview-card');
        if (!card) return null;
        if (!P.cv) {
            const wrap = document.createElement('div');
            wrap.id = 'chart-preview-wrap';
            wrap.style.cssText = 'position:relative;margin-top:4px;border-radius:10px;overflow:hidden;background:radial-gradient(ellipse at 50% 100%,rgba(34,211,238,.10),rgba(2,6,23,.85) 70%);border:1px solid rgba(51,65,85,.7)';
            const cv = document.createElement('canvas');
            cv.style.cssText = 'display:block;width:100%;height:150px';
            const tag = document.createElement('div');
            tag.id = 'chart-preview-tag';
            tag.style.cssText = 'position:absolute;top:6px;left:8px;font:800 10px Orbitron,monospace;letter-spacing:.1em;color:#94a3b8;pointer-events:none';
            const diff = document.createElement('div');
            diff.id = 'chart-preview-diff';
            diff.style.cssText = 'position:absolute;top:5px;right:8px;font:900 11px Orbitron,monospace;padding:2px 8px;border-radius:999px;pointer-events:none';
            const sw = document.createElement('button');
            sw.id = 'chart-preview-style'; sw.type = 'button';
            sw.title = 'Trocar o estilo da prévia: 3D (perspectiva) ou PISTA (reta, igual à gear)';
            sw.style.cssText = 'position:absolute;bottom:5px;right:8px;font:800 9.5px Orbitron,monospace;letter-spacing:.08em;padding:2px 7px;border-radius:999px;background:rgba(15,23,42,.85);border:1px solid #334155;color:#cbd5e1;cursor:pointer';
            const label = () => { sw.innerHTML = style === '3d' ? '3D <span style="opacity:.45">· PISTA</span>' : '<span style="opacity:.45">3D ·</span> PISTA'; };
            label();
            sw.addEventListener('click', (e) => { e.stopPropagation(); style = style === '3d' ? 'pista' : '3d'; try { localStorage.setItem(STYLE_KEY, style); } catch (er) {} label(); });
            wrap.append(cv, tag, diff, sw);
            const desc = document.getElementById('preview-desc');
            (desc ? desc.parentElement : card).insertBefore(wrap, desc ? desc.nextSibling : null);
            P.cv = cv;
        }
        return P.cv;
    }

    // notas da seleção atual (cacheadas)
    function loadNotes() {
        const pat = typeof currentPatternType !== 'undefined' ? currentPatternType : '';
        const isCustom = String(pat).startsWith('custom:');
        const ch = isCustom && typeof findCustomChart === 'function' ? findCustomChart(pat.slice(7)) : null;
        const mode = ch ? ch.mode : currentMode;
        const rnd = typeof randomMod !== 'undefined' ? randomMod : 'none', spm = typeof speedMod !== 'undefined' ? speedMod : 'none';
        const l8 = typeof lane8Style !== 'undefined' ? lane8Style : '';
        const key = `${pat}|${mode}|${isCustom ? (ch && ch.updatedAt) : currentDifficulty}|${typeof gearSkin !== 'undefined' ? gearSkin : ''}|${rnd}|${spm}|${l8}`;
        if (key === P.key) return;
        P.key = key; P.mode = mode; P.chartId = ch ? ch.id : null; P.flashes = []; P.lastT = null;
        P.laneSpeed = [];
        P.kinds = typeof getLaneKinds === 'function' ? getLaneKinds(mode) : [];
        P.colors = typeof getKeyColorScheme === 'function' ? getKeyColorScheme(mode, gearSkin) : [];
        let notes = cache.get(key);
        if (!notes) {
            if (ch) {
                notes = (ch.notes || []).map(n => ({ t: n.time, lane: n.lane, end: n.holdEnd != null ? n.holdEnd : null }));
                // RANDOM/MIRROR também na prévia (sem mexer no estado da partida)
                if (typeof applyLaneMods === 'function') {
                    const mls = typeof modLaneSpeed !== 'undefined' ? modLaneSpeed.slice() : null;
                    try { applyLaneMods(notes, mode); P.laneSpeed = modLaneSpeed.slice(); } catch (e) {}
                    try { if (mls) modLaneSpeed = mls; } catch (e) {}
                }
            } else if (typeof generateNotes === 'function' && pat && typeof DRILLS !== 'undefined') {
                // gera as notas do treino sem mexer no estado da partida
                const save = { tps: typeof totalPossibleScore !== 'undefined' ? totalPossibleScore : 0, ces: typeof currentEarnedScore !== 'undefined' ? currentEarnedScore : 0, mls: typeof modLaneSpeed !== 'undefined' ? modLaneSpeed.slice() : null };
                try { notes = generateNotes(pat, mode).map(n => ({ t: n.time, lane: n.lane, end: n.holdEnd || null })); P.laneSpeed = modLaneSpeed.slice(); } catch (e) { notes = []; }
                try { totalPossibleScore = save.tps; currentEarnedScore = save.ces; if (save.mls) modLaneSpeed = save.mls; } catch (e) {}
            } else notes = [];
            notes.sort((a, b) => a.t - b.t);
            cache.set(key, notes);
            if (cache.size > 40) cache.delete(cache.keys().next().value);
        }
        P.notes = notes;
        if (!P.laneSpeed.length) { const c = cache.get(key + '|ls'); if (c) P.laneSpeed = c; } else cache.set(key + '|ls', P.laneSpeed);
        // trecho do loop: ponto de prévia do osu!, ou a parte mais "cheia" do começo
        let start = notes.length ? notes[0].t : 0;
        if (ch && ch.osu && ch.osu.previewTime != null) start = ch.osu.previewTime;
        else if (ch && notes.length) start = notes[Math.floor(notes.length * 0.3)].t - 1500;
        P.start = Math.max(0, start); P.end = P.start + LOOP_MS; P.t0 = performance.now();
        // rótulos
        const tag = document.getElementById('chart-preview-tag'), dl = document.getElementById('chart-preview-diff');
        if (tag) tag.textContent = `PRÉVIA · ${typeof getModeDisplayName === 'function' ? getModeDisplayName(mode) : mode}${notes.length ? ' · ' + notes.length + ' notas' : ''}`;
        if (dl) {
            let name = '', color = '#fbbf24';
            if (ch && typeof chartDifficulty === 'function') { const d = chartDifficulty(ch); name = `${DIFF_BY_ID[d.tier].name} ${d.auto ? '≈' : ''}${d.level}`; color = DIFF_BY_ID[d.tier].color; }
            else if (typeof drillDiffLabel === 'function') { name = drillDiffLabel(currentDifficulty); color = { NM: '#38bdf8', HD: '#fbbf24', MX: '#f87171', SC: '#c084fc' }[currentDifficulty] || '#fbbf24'; }
            dl.textContent = name; dl.style.background = color; dl.style.color = '#020617';
        }
    }

    // tempo do chart agora: segue a prévia de áudio se ela estiver tocando esta música
    function chartNow(now) {
        if (P.chartId && typeof previa !== 'undefined' && previa.el && previa.id === P.chartId && !previa.el.paused) return previa.el.currentTime * 1000;
        return P.start + ((now - P.t0) % LOOP_MS);
    }

    function frame(now) {
        requestAnimationFrame(frame);
        const menu = document.getElementById('menu-overlay');
        if (!menu || menu.classList.contains('hidden') || (typeof isPlaying !== 'undefined' && isPlaying)) return;
        const hubEl = document.getElementById('bm-hub');
        if (hubEl && hubEl.classList.contains('on')) return; // menu inicial por cima: a prévia não aparece
        const cv = ensureCanvas();
        if (!cv) return;
        loadNotes();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = cv.clientWidth || 300, H = cv.clientHeight || 150;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
        const g = cv.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, W, H);

        const t = chartNow(now);
        const flat = style === 'pista';
        const topY = flat ? 4 : 18, botY = H - 20, cx = W / 2, topHalf = W * 0.13, botHalf = W * 0.40;
        const proj = flat
            ? (z) => { const f = Math.max(-0.08, Math.min(1.06, 1 - z)); return { y: topY + (botY - topY) * f, half: W * 0.22, f: 0.75 }; }
            : (z) => { const f = Math.max(0, Math.min(1.08, (1 - z) / (1 + 2.4 * z))); return { y: topY + (botY - topY) * f, half: topHalf + (botHalf - topHalf) * f, f }; };
        let accent = '#67e8f9';
        try { const th = GEAR_THEMES[gearSkin]; if (th && th.accent) accent = th.accent; } catch (e) {}
        const xAt = (u, pr) => cx + (u - 0.5) * 2 * pr.half;

        // pista
        const mains = P.kinds.map((k, i) => ({ k, i })).filter(o => o.k === 'main');
        const nMain = Math.max(1, mains.length);
        const a = proj(1.05), b = proj(-0.02);
        g.fillStyle = 'rgba(15,23,42,.92)';
        g.beginPath(); g.moveTo(xAt(0, a), a.y); g.lineTo(xAt(1, a), a.y); g.lineTo(xAt(1, b), b.y); g.lineTo(xAt(0, b), b.y); g.fill();
        g.strokeStyle = 'rgba(148,163,184,.18)'; g.lineWidth = 1;
        for (let i = 1; i < nMain; i++) { const u = i / nMain; g.beginPath(); g.moveTo(xAt(u, a), a.y); g.lineTo(xAt(u, b), b.y); g.stroke(); }
        if (flat) {
            // colunas alternadas, como na gear
            for (let i = 0; i < nMain; i++) if (i % 2) { g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(xAt(i / nMain, a), a.y, xAt((i + 1) / nMain, a) - xAt(i / nMain, a), b.y - a.y); }
        }
        g.strokeStyle = flat ? accent : 'rgba(103,232,249,.55)'; g.lineWidth = flat ? 2 : 1.5;
        [0, 1].forEach(u => { g.beginPath(); g.moveTo(xAt(u, a), a.y); g.lineTo(xAt(u, b), b.y); g.stroke(); });

        // linhas de batida (passam no ritmo das notas): uma a cada nota "forte" não é necessário — usa o BPM se der
        // notas
        const laneSpan = (lane) => {
            const kind = P.kinds[lane];
            if (kind === 'main') { const idx = mains.findIndex(o => o.i === lane); return { u0: idx / nMain, u1: (idx + 1) / nMain, wide: false }; }
            // laterais (side / TRACK L-R): metade da pista, translúcida
            const sameKind = P.kinds.map((k, i) => ({ k, i })).filter(o => o.k === kind);
            const left = sameKind.length && sameKind[0].i === lane;
            return { u0: left ? 0 : 0.5, u1: left ? 0.5 : 1, wide: true, kind };
        };
        const WINDOW_MS = windowMs();
        const tMax = t + WINDOW_MS * 1.6; // (VELOCIDADE CHAOS pode trazer notas de mais longe)
        // VELOCIDADE (CHAOS) e FADER iguais aos da partida
        const spm = typeof speedMod !== 'undefined' ? speedMod : 'none';
        const warp = (z, lane) => {
            if (z <= 0) return z;
            if (spm === 'special_chaos') return z * (P.laneSpeed[lane] || 1);
            if (spm && spm !== 'none' && typeof modWarp === 'function') return modWarp(z, now);
            return z;
        };
        const fade = (u) => (typeof modNoteAlpha === 'function' ? modNoteAlpha(1 - Math.max(0, u), 1, now) : 1);
        // detecta notas que passaram da linha desde o último quadro (pra o brilho de acerto)
        if (P.lastT != null && t >= P.lastT && t - P.lastT < 500) {
            for (const n of P.notes) { if (n.t > t) break; if (n.t > P.lastT) P.flashes.push({ lane: n.lane, life: 1 }); }
        }
        P.lastT = t;
        // laterais primeiro (ficam por baixo)
        [true, false].forEach(widePass => {
            for (const n of P.notes) {
                if (n.t > tMax) break;
                const endT = n.end != null ? n.end : n.t;
                if (endT < t - 60) continue;
                const sp = laneSpan(n.lane);
                if (sp.wide !== widePass) continue;
                const col = P.colors[n.lane] || '#e2e8f0';
                const z0 = Math.max(-0.02, warp((n.t - t) / WINDOW_MS, n.lane));
                if (z0 > 1.05 && (n.end == null)) continue;
                const ph = proj(z0);
                const fa = fade(z0);
                if (n.end != null) {
                    const z1 = Math.min(1.05, warp((n.end - t) / WINDOW_MS, n.lane)), pt = proj(z1);
                    if (z0 > 1.05) continue;
                    const faHold = typeof modFadeOutHolds === 'function' && modFadeOutHolds() ? fade(z1) : fa;
                    g.globalAlpha = (sp.wide ? 0.25 : 0.45) * faHold; g.fillStyle = col;
                    const inset = sp.wide ? 0 : 0.18 / nMain;
                    g.beginPath(); g.moveTo(xAt(sp.u0 + inset, pt), pt.y); g.lineTo(xAt(sp.u1 - inset, pt), pt.y); g.lineTo(xAt(sp.u1 - inset, ph), ph.y); g.lineTo(xAt(sp.u0 + inset, ph), ph.y); g.fill();
                }
                if (n.t < t - 30) continue;
                const hh = (sp.wide ? 4 : 3) + 6 * ph.f;
                const pad = sp.wide ? 0.004 : 0.06 / nMain;
                g.globalAlpha = (sp.wide ? 0.45 : 1) * fa;
                if (g.globalAlpha < 0.01) continue;
                g.fillStyle = col;
                g.shadowColor = col; g.shadowBlur = sp.wide ? 0 : 6 * ph.f;
                const x0 = xAt(sp.u0 + pad, ph), x1 = xAt(sp.u1 - pad, ph);
                g.fillRect(x0, ph.y - hh / 2, x1 - x0, hh);
                g.shadowBlur = 0;
            }
        });
        g.globalAlpha = 1;
        // LANE COVER (SUDDEN / HIDDEN / FOG) igual ao da partida
        const cov = typeof coverMod !== 'undefined' ? coverMod : 'none';
        const band = (z0, z1, alpha) => {
            const pa = proj(z1), pb = proj(z0);
            g.fillStyle = `rgba(6,11,24,${alpha})`;
            g.beginPath(); g.moveTo(xAt(-0.01, pa), pa.y); g.lineTo(xAt(1.01, pa), pa.y); g.lineTo(xAt(1.01, pb), pb.y); g.lineTo(xAt(-0.01, pb), pb.y); g.fill();
        };
        if (cov === 'sudden') band(0.52, 1.06, 0.97);
        else if (cov === 'hidden') band(0.02, 0.2, 0.97);
        else if (cov === 'fog') for (let k = 0; k < 3; k++) { const c = ((now * 0.00005 + k / 3) % 1.2) - 0.1; band(Math.max(0, 1 - c - 0.16), Math.min(1.06, 1 - c), 0.9); }
        // linha de julgamento
        const jl = proj(0);
        g.strokeStyle = flat ? accent : '#22d3ee'; g.lineWidth = 2.5; g.shadowColor = g.strokeStyle; g.shadowBlur = 10;
        g.beginPath(); g.moveTo(xAt(0, jl), jl.y); g.lineTo(xAt(1, jl), jl.y); g.stroke(); g.shadowBlur = 0;
        // brilho de "acerto"
        P.flashes = P.flashes.filter(f => {
            const sp = laneSpan(f.lane), col = P.colors[f.lane] || '#fff';
            const x0 = xAt(sp.u0, jl), x1 = xAt(sp.u1, jl);
            const gr = g.createLinearGradient(0, jl.y - 30, 0, jl.y);
            gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, col);
            g.globalAlpha = f.life * (sp.wide ? 0.35 : 0.7); g.fillStyle = gr; g.fillRect(x0, jl.y - 30, x1 - x0, 30);
            f.life -= 0.07;
            return f.life > 0;
        });
        g.globalAlpha = 1;
        if (!P.notes.length) {
            g.fillStyle = '#64748b'; g.font = '600 12px Rajdhani, sans-serif'; g.textAlign = 'center';
            g.fillText('sem notas pra mostrar', W / 2, H / 2);
        }
    }
    requestAnimationFrame(frame);

    // trocar de modo/dificuldade/gear também troca a prévia (a chave muda sozinha); limpa o cache quando a lista de charts muda
    if (typeof window.saveCustomCharts === 'function') {
        const orig = window.saveCustomCharts;
        window.saveCustomCharts = function () { cache.clear(); P.key = null; return orig.apply(this, arguments); };
    }
})();
