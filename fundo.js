// =====================================================================================
// fundo.js — Fundo do jogo em IMAGEM ou VÍDEO, e o fundo próprio de cada música do osu!
// (imagem e vídeo/BGA que vêm dentro do .osz, com o vídeo sincronizado com a música).
//
// Desempenho: o vídeo é um <video> comum ATRÁS da gear — quem decodifica é a placa de vídeo
// do PC (H.264/MP4), separado do desenho das notas. Se mesmo assim o jogo começar a perder
// quadros durante a partida, o vídeo é congelado sozinho até a próxima partida.
// =====================================================================================

const FUNDO_CFG_KEY = 'djmaxTrainerFundo_v1';
const FUNDO_MAX_MB = 600;
let fundoCfg = { useChartBg: true, autoPause: true };
try { Object.assign(fundoCfg, JSON.parse(localStorage.getItem(FUNDO_CFG_KEY) || '{}')); } catch (e) {}
function saveFundoCfg() { try { localStorage.setItem(FUNDO_CFG_KEY, JSON.stringify(fundoCfg)); } catch (e) {} }

const fundo = {
    global: null,        // { url, kind: 'image'|'video', size }
    chart: null,         // { chartId, imageUrl, videoUrl, offsetMs } do chart que está tocando
    active: null,        // o que está na tela agora: { kind, url, sync, offsetMs }
    videoEl: null, dimEl: null,
    degraded: false,     // vídeo congelado por queda de FPS nesta partida
    perf: { last: 0, win: [], best: Infinity }
};

function fundoKindOf(blob) { return blob && /^video\//.test(blob.type || '') ? 'video' : 'image'; }

// ---------- camadas na tela ----------
function fundoEnsureLayers() {
    const box = document.getElementById('game-container');
    if (!box) return null;
    if (!fundo.videoEl) {
        const v = document.createElement('video');
        v.id = 'game-bg-video';
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
        v.setAttribute('aria-hidden', 'true');
        v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:12px;pointer-events:none;z-index:0;display:none;';
        const dim = document.createElement('div');
        dim.id = 'game-bg-dim';
        dim.style.cssText = 'position:absolute;inset:0;border-radius:12px;pointer-events:none;z-index:0;display:none;';
        box.insertBefore(dim, box.firstChild);
        box.insertBefore(v, box.firstChild);
        // as telas do jogo ficam POR CIMA do vídeo
        ['gameCanvas', 'gameCanvasGL'].forEach(id => { const c = document.getElementById(id); if (c) { c.style.position = 'relative'; c.style.zIndex = '1'; } });
        v.addEventListener('error', () => {
            // formato que o navegador não toca (ex.: .avi/.flv antigos): fica na imagem
            if (fundo.active && fundo.active.kind === 'video') {
                console.warn('[fundo] o navegador não conseguiu tocar esse vídeo');
                const img = fundo.active.fallbackImage || (fundo.global && fundo.global.kind === 'image' ? fundo.global.url : null);
                fundoShow(img ? { kind: 'image', url: img } : null);
            }
        });
        fundo.videoEl = v; fundo.dimEl = dim;
    }
    return box;
}

function fundoShow(src) {
    const box = fundoEnsureLayers();
    if (!box) return;
    const same = fundo.active && src && fundo.active.url === src.url && fundo.active.kind === src.kind;
    fundo.active = src;
    const d = (typeof bgDimPct === 'number' ? bgDimPct : 55) / 100;
    const v = fundo.videoEl, dim = fundo.dimEl;
    if (!src) {
        box.style.backgroundImage = '';
        v.pause(); v.style.display = 'none'; dim.style.display = 'none';
        if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
        return;
    }
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    box.style.borderRadius = '12px';
    if (src.kind === 'image') {
        box.style.backgroundImage = `linear-gradient(rgba(0,0,0,${d}), rgba(0,0,0,${d})), url("${src.url}")`;
        v.pause(); v.style.display = 'none'; dim.style.display = 'none';
        if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
        return;
    }
    // vídeo: a imagem da música (se tiver) fica embaixo, aparecendo antes do vídeo começar
    box.style.backgroundImage = src.fallbackImage ? `linear-gradient(rgba(0,0,0,${d}), rgba(0,0,0,${d})), url("${src.fallbackImage}")` : '';
    dim.style.background = `rgba(0,0,0,${d})`;
    dim.style.display = '';
    if (!same) {
        v.loop = !src.sync;
        v.src = src.url;
        v.currentTime = 0;
    }
    v.style.display = src.sync ? 'none' : '';
    if (!src.sync && !fundo.degraded) v.play().catch(() => {});
}

function fundoStatusText() {
    const g = fundo.global;
    if (!g) return 'Nenhum';
    return g.kind === 'video' ? `Vídeo (${(g.size / 1048576).toFixed(g.size < 10485760 ? 1 : 0)} MB)` : 'Imagem';
}
function fundoUpdateStatus() {
    const st = document.getElementById('bg-image-status');
    if (st) st.textContent = fundoStatusText();
}

// o que deve estar na tela agora
function fundoRefresh() {
    const c = fundo.chart;
    const playingChart = c && isPlaying && typeof currentPatternType === 'string' && currentPatternType === 'custom:' + c.chartId && fundoCfg.useChartBg;
    if (playingChart && c.videoUrl && !fundo.degraded) fundoShow({ kind: 'video', url: c.videoUrl, sync: true, offsetMs: c.offsetMs || 0, fallbackImage: c.imageUrl });
    else if (playingChart && (c.imageUrl || c.videoUrl)) fundoShow(c.imageUrl ? { kind: 'image', url: c.imageUrl } : fundoGlobalSrc());
    else fundoShow(fundoGlobalSrc());
    fundoUpdateStatus();
}
function fundoGlobalSrc() {
    const g = fundo.global;
    return g ? { kind: g.kind, url: g.url } : null;
}

// substitui as funções antigas (gear-themes.js) — o slider de escurecer e o botão de imagem
// continuam chamando pelo mesmo nome
window.applyGameBackground = function () {
    if (fundo.active) { const a = fundo.active; fundo.active = null; fundoShow(a); } else fundoRefresh();
    fundoUpdateStatus();
};
window.setGameBackgroundFile = async function (file) {
    if (file && file.size > FUNDO_MAX_MB * 1048576) { alert(`Esse arquivo tem ${(file.size / 1048576).toFixed(0)} MB — o limite é ${FUNDO_MAX_MB} MB. Dica: um vídeo 1080p de poucos minutos fica bem menor.`); return; }
    if (file && fundoKindOf(file) === 'video') {
        const probe = document.createElement('video');
        if (!probe.canPlayType(file.type || 'video/mp4')) { alert('Esse formato de vídeo o navegador não toca. Use MP4 (H.264) ou WEBM.'); return; }
    }
    if (fundo.global) URL.revokeObjectURL(fundo.global.url);
    fundo.global = file ? { url: URL.createObjectURL(file), kind: fundoKindOf(file), size: file.size } : null;
    fundo.degraded = false;
    fundoRefresh();
    try { await mediaPut('bgImage', file || null); } catch (e) { console.warn('[fundo] não deu pra salvar', e); }
};

// ---------- relógio: vídeo da música acompanha a música ----------
function fundoTick(ts) {
    requestAnimationFrame(fundoTick);
    const a = fundo.active, v = fundo.videoEl;
    fundoPerfTick(ts);
    if (!a || a.kind !== 'video' || !v) return;
    if (fundo.degraded) { if (!v.paused) v.pause(); return; }
    if (!a.sync) {
        // fundo geral em loop: só para junto com a pausa do jogo
        const shouldPause = isPlaying && isPaused;
        if (shouldPause && !v.paused) v.pause();
        else if (!shouldPause && v.paused && document.visibilityState === 'visible') v.play().catch(() => {});
        const rate = isPlaying ? gameRate : 1;
        if (Math.abs(v.playbackRate - rate) > 0.001) v.playbackRate = rate;
        return;
    }
    // vídeo da música: posição = posição da música - offset do vídeo
    if (!isPlaying || isCountingDown) { if (!v.paused) v.pause(); v.style.display = 'none'; return; }
    const now = isPaused ? pauseStartTime : performance.now();
    const songMs = audioPosForChartTime(chartTimeAt(now)) - CUSTOM_CHART_START_DELAY_MS;
    const t = (songMs - (a.offsetMs || 0)) / 1000;
    const dur = isFinite(v.duration) ? v.duration : Infinity;
    if (t < 0 || t >= dur) { if (!v.paused) v.pause(); v.style.display = 'none'; return; }
    v.style.display = '';
    if (Math.abs(v.playbackRate - gameRate) > 0.001) v.playbackRate = gameRate;
    if (isPaused || isSongFinished) { if (!v.paused) v.pause(); }
    else if (v.paused) v.play().catch(() => {});
    // corrige a deriva (ou um pulo de 5s / loop de trecho)
    if (v.readyState >= 1 && Math.abs(v.currentTime - t) > (isPaused ? 0.05 : 0.15)) v.currentTime = t;
}
requestAnimationFrame(fundoTick);

// ---------- proteção de desempenho ----------
// Compara o tempo entre quadros com o melhor que este PC já fez. Se ficar bem pior por ~2s
// durante a partida com vídeo, congela o vídeo (fica a imagem parada) até a próxima partida.
function fundoPerfTick(ts) {
    const p = fundo.perf;
    if (!p.last) { p.last = ts; return; }
    const dt = ts - p.last;
    p.last = ts;
    const watching = isPlaying && !isPaused && !isCountingDown && document.visibilityState === 'visible';
    if (!watching || dt > 250) { p.win = []; return; }
    p.win.push(dt);
    if (p.win.length < 90) return;
    const avg = p.win.reduce((s, x) => s + x, 0) / p.win.length;
    p.win = [];
    p.best = Math.min(p.best, avg);
    const videoOn = fundo.active && fundo.active.kind === 'video' && fundo.videoEl && !fundo.videoEl.paused;
    if (!videoOn || !fundoCfg.autoPause || fundo.degraded) return;
    if (avg > Math.max(p.best * 1.45, p.best + 5)) {
        p.bad = (p.bad || 0) + 1;
        if (p.bad >= 2) {
            fundo.degraded = true;
            fundo.videoEl.pause();
            if (typeof showToast === 'function') showToast('Fundo em vídeo congelado: o jogo estava perdendo quadros. Volta na próxima partida (dá pra desligar isso nas Configurações).');
        }
    } else p.bad = 0;
}

// ---------- cada partida: carrega o fundo da música (se tiver) ----------
const _fundoOrigGenerate = window.generateNotes;
window.generateNotes = function (pattern, mode) {
    const out = _fundoOrigGenerate(pattern, mode);
    fundo.degraded = false;
    fundo.perf.bad = 0;
    fundoLoadChart(pattern).then(fundoRefresh);
    return out;
};
const _fundoOrigStop = window.stopAllGameLoops;
window.stopAllGameLoops = function () {
    const out = _fundoOrigStop.apply(this, arguments);
    setTimeout(fundoRefresh, 0);
    return out;
};

async function fundoLoadChart(pattern) {
    const id = typeof pattern === 'string' && pattern.startsWith('custom:') ? pattern.slice(7) : null;
    const chart = id && typeof findCustomChart === 'function' ? findCustomChart(id) : null;
    if (!chart || !chart.bga || !chart.bga.key) { fundoSetChart(null); return; }
    if (fundo.chart && fundo.chart.key === chart.bga.key) { fundo.chart.chartId = id; fundo.chart.offsetMs = chart.bga.offsetMs || 0; return; }
    let rec = null;
    try { rec = await mediaGet(chart.bga.key); } catch (e) {}
    if (!rec) { fundoSetChart(null); return; }
    fundoSetChart({
        key: chart.bga.key, chartId: id, offsetMs: chart.bga.offsetMs || 0,
        imageUrl: rec.image ? URL.createObjectURL(rec.image) : null,
        videoUrl: rec.video ? URL.createObjectURL(rec.video) : null
    });
}
function fundoSetChart(c) {
    const old = fundo.chart;
    if (old && (!c || old.key !== c.key)) {
        if (old.imageUrl) URL.revokeObjectURL(old.imageUrl);
        if (old.videoUrl) URL.revokeObjectURL(old.videoUrl);
    }
    fundo.chart = c;
}

// ---------- osu!: imagem e vídeo de fundo que vêm no .osz ----------
const FUNDO_VIDEO_EXT = /\.(mp4|m4v|webm|mov)$/i;   // .avi/.flv/.wmv antigos o navegador não toca
function fundoMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[ext] || 'application/octet-stream';
}
// [Events] do .osu:  0,0,"bg.jpg",0,0   e   Video,1234,"video.mp4"  (ou 1,1234,"...")
function osuEventsMedia(text) {
    const m = text.match(/\[Events\]([\s\S]*?)(\n\[|$)/);
    if (!m) return {};
    let image = null, video = null, videoOffset = 0;
    m[1].split(/\r?\n/).forEach(raw => {
        const l = raw.trim();
        if (!l || l.startsWith('//')) return;
        const a = l.split(',');
        const file = (a[2] || '').trim().replace(/^"|"$/g, '');
        if (!file) return;
        if ((a[0] === '0') && !image) image = file;
        else if ((a[0] === 'Video' || a[0] === '1') && !video) { video = file; videoOffset = parseInt(a[1], 10) || 0; }
    });
    return { image, video, videoOffset };
}
function osuFindEntry(entries, name) {
    const n = name.replace(/\\/g, '/').toLowerCase();
    return entries.find(e => e.name.toLowerCase() === n) || entries.find(e => e.name.toLowerCase().endsWith('/' + n));
}

const _fundoOrigImportOsz = window.importOszBlob;
window.importOszBlob = async function (blob, opts = {}) {
    const created = await _fundoOrigImportOsz(blob, opts);
    try { await fundoAttachOszMedia(blob, created); } catch (e) { console.warn('[fundo] fundo do .osz não importado:', e); }
    return created;
};
async function fundoAttachOszMedia(blob, created) {
    if (!created || !created.length) return;
    const entries = await readZipEntries(blob);
    const osuFiles = entries.filter(e => /\.osu$/i.test(e.name));
    const byBeatmap = {};
    for (const e of osuFiles) {
        const text = new TextDecoder().decode(await e.read());
        const id = (text.match(/BeatmapID\s*:\s*(\d+)/) || [])[1];
        const ver = (text.match(/^Version\s*:(.*)$/m) || [])[1];
        byBeatmap[id || ('v:' + (ver || '').trim())] = osuEventsMedia(text);
    }
    const cache = {};
    for (const chart of created) {
        const media = byBeatmap[chart.osu && chart.osu.beatmapId] || byBeatmap['v:' + ((chart.osu && chart.osu.version) || '').trim()] || Object.values(byBeatmap)[0] || {};
        let videoName = media.video && FUNDO_VIDEO_EXT.test(media.video) ? media.video : null;
        const imageName = media.image || null;
        if (!videoName && !imageName) continue;
        const key = `bga:${(chart.osu && chart.osu.setId) || chart.id}|${videoName || ''}|${imageName || ''}`;
        if (!cache[key]) {
            const rec = { image: null, video: null };
            const ie = imageName && osuFindEntry(entries, imageName);
            if (ie) rec.image = new Blob([await ie.read()], { type: fundoMime(imageName) });
            const ve = videoName && osuFindEntry(entries, videoName);
            if (ve) rec.video = new Blob([await ve.read()], { type: fundoMime(videoName) });
            if (!rec.image && !rec.video) continue;
            await mediaPut(key, rec);
            cache[key] = rec;
        }
        chart.bga = { key, offsetMs: media.videoOffset || 0, video: !!cache[key].video, image: !!cache[key].image };
    }
    if (typeof saveCustomCharts === 'function') saveCustomCharts();
    created.forEach(c => { if (typeof addOrUpdateCustomChartCard === 'function') addOrUpdateCustomChartCard(c); });
}

// ---------- imagem por LINK (Personalizar e fundo) ----------
// Baixa direto pelo navegador; se o site não deixar (CORS), pede pro servidor local do
// BEATMAX (só no PC — na versão web não existe). Devolve um Blob de imagem (ou vídeo, se
// allowVideo e o site deixar baixar direto).
window.beatmaxFetchMedia = async function (url, allowVideo) {
    if (!/^https?:\/\//i.test(url || '')) throw new Error('Cole um link começando com http:// ou https://');
    const okType = (t) => /^image\//.test(t) || (allowVideo && /^video\/(mp4|webm)/.test(t));
    try {
        const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (r.ok) { const b = await r.blob(); if (okType(b.type)) return b; }
    } catch (e) {}
    if (!window.BEATMAX_WEB) {
        let r = null;
        try { r = await fetch('/api/imagem?url=' + encodeURIComponent(url), { headers: { 'X-DJMAX': '1' } }); } catch (e) {}
        if (r && r.ok) return await r.blob();
        if (r) { const j = await r.json().catch(() => ({})); if (j.error && j.error !== 'rota desconhecida') throw new Error('Não deu: ' + j.error); }
    }
    throw new Error('Esse site não deixa baixar por link. Salve o arquivo no computador e use "Escolher…".');
};

// ---------- configurações ----------
(function fundoSettingsUI() {
    const input = document.getElementById('setting-bg-image');
    if (input) {
        input.accept = 'image/*,video/mp4,video/webm';
        const lbl = input.closest('label');
        if (lbl && lbl.firstChild && lbl.firstChild.nodeType === 3) lbl.firstChild.nodeValue = 'Escolher imagem ou vídeo…';
        const title = lbl && lbl.parentElement && lbl.parentElement.previousElementSibling;
        if (title && /Imagem de fundo/.test(title.textContent)) title.textContent = 'Fundo (imagem ou vídeo)';
        const box = lbl && lbl.closest('.flex.flex-col');
        // fundo por LINK
        if (lbl && !document.getElementById('btn-bg-link')) {
            const lb = document.createElement('button');
            lb.id = 'btn-bg-link'; lb.type = 'button';
            lb.className = 'px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs border border-slate-600';
            lb.textContent = '🔗 Link…'; lb.title = 'Usar uma imagem da internet (colar o link)';
            lbl.insertAdjacentElement('afterend', lb);
            const row = document.createElement('div');
            row.className = 'hidden flex gap-2 items-center';
            row.innerHTML = '<input id="bg-link-url" type="url" placeholder="Cole o link da imagem (https://…)" class="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100"><button id="bg-link-ok" type="button" class="px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-slate-950">Usar</button>';
            lbl.parentElement.insertAdjacentElement('afterend', row);
            const inp = row.querySelector('#bg-link-url'), okb = row.querySelector('#bg-link-ok'), stEl = document.getElementById('bg-image-status');
            lb.addEventListener('click', () => { row.classList.toggle('hidden'); if (!row.classList.contains('hidden')) inp.focus(); });
            const use = async () => {
                okb.disabled = true; if (stEl) stEl.textContent = 'Baixando…';
                try {
                    const blob = await window.beatmaxFetchMedia(inp.value.trim(), true);
                    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                    await window.setGameBackgroundFile(new File([blob], 'link.' + ext, { type: blob.type }));
                    row.classList.add('hidden'); inp.value = '';
                } catch (e) { if (stEl) stEl.textContent = '⚠️ ' + e.message; }
                finally { okb.disabled = false; }
            };
            okb.addEventListener('click', use);
            inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); use(); } });
        }
        if (box) {
            const extra = document.createElement('div');
            extra.className = 'flex flex-col gap-1.5 mt-1';
            extra.innerHTML = `
                <span class="text-[10px] text-slate-400">Vídeo: MP4 (H.264) ou WEBM, de preferência 1080p ou menos. Ele fica sem som, em loop, e pausa junto com o jogo.</span>
                <label class="flex items-center justify-between gap-3 cursor-pointer"><span class="text-[11px] text-slate-300">Usar o fundo da música (imagem/vídeo do osu!) quando tiver</span>
                    <input type="checkbox" id="setting-chart-bg" ${fundoCfg.useChartBg ? 'checked' : ''} class="accent-cyan-400 w-4 h-4 cursor-pointer shrink-0"></label>
                <label class="flex items-center justify-between gap-3 cursor-pointer"><span class="text-[11px] text-slate-300">Congelar o vídeo se o jogo ficar lento</span>
                    <input type="checkbox" id="setting-bg-autopause" ${fundoCfg.autoPause ? 'checked' : ''} class="accent-cyan-400 w-4 h-4 cursor-pointer shrink-0"></label>`;
            box.appendChild(extra);
            extra.querySelector('#setting-chart-bg').addEventListener('change', (e) => { fundoCfg.useChartBg = !!e.target.checked; saveFundoCfg(); fundoRefresh(); });
            extra.querySelector('#setting-bg-autopause').addEventListener('change', (e) => { fundoCfg.autoPause = !!e.target.checked; saveFundoCfg(); });
        }
    }
})();

// fundo salvo (imagem ou vídeo) — o carregamento antigo de gear-themes.js também roda, mas
// este decide o que fica na tela
(async function fundoLoadGlobal() {
    try {
        const blob = await mediaGet('bgImage');
        if (blob) fundo.global = { url: URL.createObjectURL(blob), kind: fundoKindOf(blob), size: blob.size || 0 };
    } catch (e) { /* sem IndexedDB */ }
    fundoRefresh();
})();
