// =====================================================================================
// osu.js — Músicas do osu!mania: busca pela API oficial do osu! (via servidor.py), prévia do
// áudio, download semiautomático (abre a página oficial; quando o .osz chega na pasta
// Downloads ele é importado sozinho) e importação de .osz arrastado/escolhido na mão.
// Cada dificuldade de 4K/5K/6K/8K vira um chart do treinador, com a música junto.
// =====================================================================================

const OSU_KEYS_SUPPORTED = [4, 5, 6, 8];
const osuState = { server: null, cfg: null, results: [], cursor: null, loading: false, pending: {}, watchTimer: null, preview: null, previewId: null };

// ---------- .zip (o .osz é um zip) ----------
async function readZipEntries(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('arquivo .osz inválido (não é um zip)');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    const dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const flags = dv.getUint16(p + 8, true);
        const method = dv.getUint16(p + 10, true);
        const csize = dv.getUint32(p + 20, true);
        const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
        const lho = dv.getUint32(p + 42, true);
        const nameBytes = buf.subarray(p + 46, p + 46 + nlen);
        const name = (flags & 0x800) ? dec.decode(nameBytes) : new TextDecoder('latin1').decode(nameBytes).normalize();
        entries.push({ name, method, csize, lho });
        p += 46 + nlen + elen + clen;
    }
    const read = async (e) => {
        const ln = dv.getUint16(e.lho + 26, true), le = dv.getUint16(e.lho + 28, true);
        const start = e.lho + 30 + ln + le;
        const data = buf.subarray(start, start + e.csize);
        if (e.method === 0) return data.slice();
        if (e.method !== 8) throw new Error(`compressão ${e.method} não suportada`);
        const ds = new DecompressionStream('deflate-raw');
        const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
        return new Uint8Array(out);
    };
    return entries.map(e => ({ name: e.name, read: () => read(e) }));
}

// ---------- .osu ----------
function parseOsuFile(text) {
    const sec = {};
    let cur = null;
    text.split(/\r?\n/).forEach(raw => {
        const line = raw.trim();
        if (!line || line.startsWith('//')) return;
        const m = line.match(/^\[(.+)\]$/);
        if (m) { cur = m[1]; sec[cur] = []; return; }
        if (cur) sec[cur].push(line);
    });
    const kv = (name) => {
        const o = {};
        (sec[name] || []).forEach(l => { const i = l.indexOf(':'); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
        return o;
    };
    const general = kv('General'), meta = kv('Metadata'), diff = kv('Difficulty');
    const allTiming = (sec.TimingPoints || []).map(l => l.split(',')).filter(a => a.length >= 2).map(a => ({
        time: parseFloat(a[0]), beatLength: parseFloat(a[1]), uninherited: a.length < 7 ? true : a[6] === '1'
    })).filter(t => isFinite(t.time) && isFinite(t.beatLength));
    const timing = allTiming.filter(t => t.uninherited && t.beatLength > 0);
    const keys = Math.round(parseFloat(diff.CircleSize || '0'));
    const objects = (sec.HitObjects || []).map(l => {
        const a = l.split(',');
        const x = parseInt(a[0], 10), time = parseInt(a[2], 10), type = parseInt(a[3], 10);
        const col = Math.max(0, Math.min(keys - 1, Math.floor(x * keys / 512)));
        let end = null;
        if (type & 128) end = parseInt((a[5] || '').split(':')[0], 10);
        return { col, time, end: isFinite(end) && end > time ? end : null };
    }).filter(o => isFinite(o.time));
    return {
        mode: parseInt(general.Mode || '0', 10), audio: general.AudioFilename || '', previewTime: parseInt(general.PreviewTime || '-1', 10),
        title: meta.TitleUnicode || meta.Title || 'Sem título', titleAscii: meta.Title || '', artist: meta.ArtistUnicode || meta.Artist || '',
        creator: meta.Creator || '', version: meta.Version || '', setId: parseInt(meta.BeatmapSetID || '0', 10) || null, beatmapId: parseInt(meta.BeatmapID || '0', 10) || null,
        keys, od: parseFloat(diff.OverallDifficulty || '0'), timing, allTiming, objects
    };
}

// coluna do osu! -> lane do treinador (8K: as pontas viram TRACK L/R do 8B)
function osuLaneMap(keys) {
    if (keys === 4) return { mode: '4K', lanes: [0, 1, 2, 3] };
    if (keys === 5) return { mode: '5K', lanes: [0, 1, 2, 3, 4] };
    if (keys === 6) return { mode: '6K', lanes: [0, 1, 2, 3, 4, 5] };
    if (keys === 8) return { mode: '8K', lanes: [6, 0, 1, 2, 3, 4, 5, 7] };
    return null;
}

// Variações de velocidade (SV) do osu!mania: os pontos "herdados" (verdes) multiplicam a
// velocidade, e trocas de BPM também mudam a velocidade (relativa ao BPM principal da música).
// Vira uma lista [{ t, x }] (x = multiplicador a partir de t). Sem variação nenhuma = null.
function osuScrollVelocity(o, lastEnd) {
    const pts = (o.allTiming || []).slice().sort((a, b) => (a.time - b.time) || ((b.uninherited ? 1 : 0) - (a.uninherited ? 1 : 0)));
    const red = pts.filter(p => p.uninherited && p.beatLength > 0);
    if (!red.length) return null;
    // BPM principal = o que dura mais tempo na música
    const dur = new Map();
    red.forEach((p, i) => {
        const end = i + 1 < red.length ? red[i + 1].time : Math.max(lastEnd, p.time);
        const k = Math.round(p.beatLength * 1000) / 1000;
        dur.set(k, (dur.get(k) || 0) + Math.max(0, end - p.time));
    });
    let mainBL = red[0].beatLength, best = -1;
    dur.forEach((d, k) => { if (d > best) { best = d; mainBL = k; } });
    const out = [];
    let bl = red[0].beatLength, sv = 1;
    pts.forEach(p => {
        if (p.uninherited) { if (p.beatLength > 0) { bl = p.beatLength; sv = 1; } }
        else if (p.beatLength < 0) sv = Math.max(0.01, Math.min(10, -100 / p.beatLength));
        const x = Math.max(0.01, Math.min(15, (mainBL / bl) * sv));
        const t = Math.max(0, Math.round(p.time));
        if (out.length && out[out.length - 1].t === t) out[out.length - 1].x = x;
        else if (!out.length || Math.abs(out[out.length - 1].x - x) > 1e-4) out.push({ t, x: Math.round(x * 10000) / 10000 });
    });
    return out.some(p => Math.abs(p.x - 1) > 0.01) ? out : null;
}

function osuToChart(o, extra = {}) {
    const map = osuLaneMap(o.keys);
    if (!map) return null;
    const notes = o.objects.map(ob => ({ time: Math.max(0, ob.time), lane: map.lanes[ob.col], holdEnd: ob.end != null ? Math.max(0, ob.end) : null }))
        .sort((a, b) => a.time - b.time);
    // remove duplicadas exatas (mapas antigos às vezes têm)
    const seen = new Set();
    const clean = notes.filter(n => { const k = `${n.lane}|${n.time}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const tp = o.timing.length ? o.timing : [{ time: 0, beatLength: 500 }];
    const baseBpm = Math.round(60000 / tp[0].beatLength * 100) / 100;
    // grade do editor alinhada com o osu!: cada ponto de tempo vira uma "mudança de BPM"
    // (o primeiro também, pra a grade começar no lugar certo)
    const changes = [];
    tp.forEach((t, i) => {
        let at = t.time;
        if (i === 0 && at <= 0) { while (at <= 0) at += t.beatLength * 4; if (at > 30000) return; }
        if (at > 0) changes.push({ time: at, bpm: 60000 / t.beatLength });
    });
    const lastEnd = clean.reduce((m, n) => Math.max(m, n.holdEnd || n.time), 0);
    const id = `osu_${o.beatmapId || Date.now()}_${Math.floor(Math.random() * 1e5)}`;
    return {
        id,
        title: `${o.artist ? o.artist + ' - ' : ''}${o.title} [${o.version}]`,
        mode: map.mode,
        bpm: baseBpm,
        snap: 4,
        duration: Math.ceil(Math.max(lastEnd, extra.audioMs || 0) / 1000) + 2,
        notes: clean,
        pins: [], sections: [],
        bpmChanges: sanitizeBpmChanges(changes),
        sv: osuScrollVelocity(o, lastEnd),
        songEndMs: extra.songEndMs != null ? extra.songEndMs : null,
        source: 'osu',
        osu: { setId: o.setId || extra.setId || null, beatmapId: o.beatmapId, creator: o.creator, version: o.version, keys: o.keys, stars: extra.stars || null, previewTime: o.previewTime >= 0 ? o.previewTime : null },
        updatedAt: Date.now()
    };
}

function audioMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return { mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4' }[ext] || 'application/octet-stream';
}

// Lê um .osz e devolve as dificuldades de mania (pra escolher quais importar)
async function inspectOsz(blob) {
    const entries = await readZipEntries(blob);
    const diffs = [];
    for (const e of entries.filter(e => /\.osu$/i.test(e.name))) {
        const text = new TextDecoder().decode(await e.read());
        const o = parseOsuFile(text);
        if (o.mode !== 3) continue;
        diffs.push(o);
    }
    return { entries, diffs };
}

async function importOszBlob(blob, opts = {}) {
    const { entries, diffs } = await inspectOsz(blob);
    const usable = diffs.filter(d => OSU_KEYS_SUPPORTED.includes(d.keys) && (!opts.only || opts.only.includes(d.beatmapId || d.version)));
    if (!diffs.length) throw new Error('esse .osz não tem nenhuma dificuldade de osu!mania');
    if (!usable.length) throw new Error(`só tem mania de ${[...new Set(diffs.map(d => d.keys + 'K'))].join(', ')} — o treinador aceita 4K, 5K, 6K e 8K`);
    // áudio (geralmente um só pra todas as dificuldades)
    const audioCache = {};
    const created = [];
    audio.init();
    for (const d of usable) {
        let a = audioCache[d.audio];
        if (!a) {
            const ent = entries.find(e => e.name.toLowerCase() === d.audio.toLowerCase()) || entries.find(e => e.name.toLowerCase().endsWith('/' + d.audio.toLowerCase()));
            if (!ent) throw new Error(`o áudio "${d.audio}" não está dentro do .osz`);
            const bytes = await ent.read();
            const ablob = new Blob([bytes], { type: audioMime(d.audio) });
            let audioMs = 0, songEndMs = null;
            try {
                const buf = await audio.ctx.decodeAudioData(bytes.slice().buffer);
                audioMs = buf.duration * 1000;
                if (typeof detectSongEndFromAudio === 'function') { const r = detectSongEndFromAudio(buf); if (r && r.silenceMs >= 3000) songEndMs = Math.round(r.endMs); }
            } catch (e) { /* o jogo tenta decodificar de novo na hora de tocar */ }
            a = audioCache[d.audio] = { blob: ablob, audioMs, songEndMs };
        }
        const lastEnd = d.objects.reduce((m, ob) => Math.max(m, ob.end || ob.time), 0);
        // fim da música: onde o som acaba (se tiver silêncio sobrando), nunca antes da última nota
        const songEndMs = a.songEndMs != null ? Math.max(a.songEndMs, lastEnd + 1500) : null;
        const chart = osuToChart(d, { audioMs: a.audioMs, songEndMs, setId: opts.setId, stars: (opts.stars || {})[d.beatmapId] });
        if (!chart) continue;
        // reimportar a mesma dificuldade substitui (não duplica)
        const old = customCharts.findIndex(c => c.source === 'osu' && c.osu && chart.osu.beatmapId && c.osu.beatmapId === chart.osu.beatmapId);
        if (old !== -1) chart.id = customCharts[old].id, customCharts[old] = chart; else customCharts.push(chart);
        await saveChartAudioBlob(chart.id, a.blob, d.audio);
        if (typeof addOrUpdateCustomChartCard === 'function') addOrUpdateCustomChartCard(chart);
        created.push(chart);
    }
    saveCustomCharts();
    if (typeof decoratePatternCards === 'function') decoratePatternCards();
    return created;
}

// ---------- servidor / API ----------
async function osuServer(path, init) {
    init = Object.assign({}, init);
    init.headers = Object.assign({ 'X-DJMAX': '1' }, init.headers || {}); // o servidor só aceita POST da página do jogo
    const r = await fetch(path, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(j.error || `erro ${r.status}`); err.data = j; throw err; }
    return j;
}
async function checkOsuServer() {
    try { const j = await osuServer('/api/ping'); osuState.server = !!j.ok; } catch (e) { osuState.server = false; }
    if (osuState.server) { try { osuState.cfg = await osuServer('/api/osu/config'); } catch (e) { osuState.cfg = null; } }
    return osuState.server;
}
function importedSetIds() {
    const s = new Set();
    customCharts.forEach(c => { if (c.source === 'osu' && c.osu && c.osu.setId) s.add(c.osu.setId); });
    return s;
}

// ---------- tela ----------
function ensureOsuModal() {
    let m = document.getElementById('osu-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'osu-modal';
    m.className = 'hidden absolute inset-0 bg-slate-950/90 backdrop-blur-md flex justify-center items-center p-4 z-[60]';
    m.innerHTML = `
      <div class="max-w-5xl w-full h-full max-h-[94vh] bg-slate-900 border border-pink-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-800">
            <h2 class="font-orbitron text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-cyan-400">MÚSICAS DO OSU!MANIA</h2>
            <div class="flex flex-wrap gap-1.5">
                <label class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200 cursor-pointer"><i class="fa-solid fa-file-import mr-1"></i>Importar .osz
                    <input id="osu-file" type="file" accept=".osz" multiple class="hidden"></label>
                <button id="osu-btn-setup" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200"><i class="fa-solid fa-gear mr-1"></i>Conexão</button>
                <button id="osu-btn-close" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200">Fechar</button>
            </div>
        </div>
        <div id="osu-status" class="hidden px-5 py-2 text-[12px] border-b border-slate-800"></div>
        <div id="osu-setup" class="hidden px-5 py-4 border-b border-slate-800 flex flex-col gap-2 text-[12px] text-slate-200"></div>
        <div id="osu-searchbar" class="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-slate-800 text-[11px]">
            <input id="osu-q" type="text" placeholder="Buscar música, artista ou mapper…" class="flex-1 min-w-[180px] bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-[12px] text-slate-100">
            <select id="osu-keys" class="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-100"><option value="">4/5/6/8K</option><option value="4">4K (4B)</option><option value="5">5K (5B)</option><option value="6">6K (6B)</option><option value="8">8K (8B)</option></select>
            <select id="osu-status-sel" class="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-100"><option value="ranked">Ranked</option><option value="loved">Loved</option><option value="qualified">Qualified</option><option value="any">Todos</option></select>
            <select id="osu-sort" class="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-100"><option value="">Relevância</option><option value="plays_desc">Mais jogados</option><option value="ranked_desc">Mais novos</option><option value="difficulty_asc">Mais fáceis</option><option value="difficulty_desc">Mais difíceis</option></select>
            <button id="osu-go" class="px-3 py-1.5 rounded bg-pink-600 hover:bg-pink-500 text-white font-bold"><i class="fa-solid fa-magnifying-glass mr-1"></i>Buscar</button>
        </div>
        <div id="osu-results" class="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-2 content-start"></div>
        <div id="osu-drop" class="hidden absolute inset-0 m-6 rounded-2xl border-4 border-dashed border-pink-400 bg-slate-950/80 flex items-center justify-center text-pink-200 font-orbitron text-lg pointer-events-none">Solte o .osz aqui</div>
      </div>`;
    (document.getElementById('menu-overlay')?.parentElement || document.body).appendChild(m);
    m.querySelector('#osu-btn-close').addEventListener('click', closeOsuModal);
    m.querySelector('#osu-btn-setup').addEventListener('click', () => renderOsuSetup(true));
    m.querySelector('#osu-go').addEventListener('click', () => osuSearch(false));
    m.querySelector('#osu-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') osuSearch(false); e.stopPropagation(); });
    ['osu-keys', 'osu-status-sel', 'osu-sort'].forEach(id => m.querySelector('#' + id).addEventListener('change', () => osuSearch(false)));
    m.querySelector('#osu-file').addEventListener('change', async (e) => { for (const f of e.target.files) await importOszFileWithStatus(f); e.target.value = ''; });
    // arrastar e soltar
    let dragDepth = 0;
    m.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; m.querySelector('#osu-drop').classList.remove('hidden'); } });
    m.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; m.querySelector('#osu-drop').classList.add('hidden'); } });
    m.addEventListener('dragover', (e) => e.preventDefault());
    m.addEventListener('drop', async (e) => {
        e.preventDefault(); dragDepth = 0; m.querySelector('#osu-drop').classList.add('hidden');
        for (const f of e.dataTransfer.files) if (/\.osz$/i.test(f.name)) await importOszFileWithStatus(f);
    });
    m.querySelector('#osu-results').addEventListener('scroll', (e) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) osuSearch(true);
    });
    return m;
}

function osuStatus(html, kind = 'info') {
    const el = document.getElementById('osu-status');
    if (!el) return;
    if (!html) { el.classList.add('hidden'); return; }
    el.className = `px-5 py-2 text-[12px] border-b border-slate-800 ${kind === 'error' ? 'text-red-300 bg-red-950/30' : kind === 'ok' ? 'text-emerald-300 bg-emerald-950/30' : 'text-slate-200 bg-slate-800/40'}`;
    el.innerHTML = html;
}

async function openOsuModal() {
    const m = ensureOsuModal();
    m.classList.remove('hidden');
    const ok = await checkOsuServer();
    if (!ok) {
        osuStatus(window.BEATMAX_WEB
            ? 'Na versão web não dá pra buscar e baixar do osu! (isso precisa do BEATMAX instalado no PC). Daqui dá pra <b>Importar .osz</b> ou arrastar o arquivo pra cá.'
            : 'Pra buscar e baixar, abra o treinador pelo <b>iniciar.bat</b> (o servidor local faz a ponte com o osu!). Daqui ainda dá pra <b>Importar .osz</b> ou arrastar o arquivo pra cá.', 'error');
        document.getElementById('osu-searchbar').classList.add('hidden');
        return;
    }
    document.getElementById('osu-searchbar').classList.remove('hidden');
    if (!osuState.cfg || !osuState.cfg.configured) { renderOsuSetup(true); return; }
    renderOsuSetup(false);
    osuStatus('');
    if (!osuState.results.length) osuSearch(false);
}
function closeOsuModal() {
    document.getElementById('osu-modal')?.classList.add('hidden');
    stopOsuPreview();
}

function renderOsuSetup(show) {
    const el = document.getElementById('osu-setup');
    if (!el) return;
    if (!show) { el.classList.add('hidden'); return; }
    const cfg = osuState.cfg || {};
    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="font-bold text-pink-300">Conectar ao osu! (uma vez só)</div>
        <ol class="list-decimal ml-5 text-[11px] text-slate-300 space-y-0.5">
            <li>Entre na sua conta do osu! e abra <a href="https://osu.ppy.sh/home/account/edit#oauth" target="_blank" rel="noopener" class="text-cyan-300 underline">Configurações → OAuth</a>.</li>
            <li>Clique em <b>New OAuth Application</b>, dê qualquer nome (ex.: "BEATMAX Training") e em Callback URL coloque <code class="text-pink-200">http://localhost</code>.</li>
            <li>Copie o <b>Client ID</b> e o <b>Client Secret</b> e cole aqui. Eles ficam só no seu PC (arquivo <code>osu-config.json</code> na pasta do treinador).</li>
        </ol>
        <div class="flex flex-wrap gap-2 items-center">
            <input id="osu-cid" type="text" placeholder="Client ID" value="${escapeHtml(cfg.clientId || '')}" class="w-32 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[12px]">
            <input id="osu-secret" type="password" placeholder="${cfg.configured ? '(já salvo — deixe vazio pra manter)' : 'Client Secret'}" class="flex-1 min-w-[220px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[12px]">
            <button id="osu-save" class="px-3 py-1 rounded bg-pink-600 hover:bg-pink-500 text-white font-bold text-[12px]">Salvar e testar</button>
        </div>
        <div class="text-[11px] text-slate-400">Pasta vigiada pros downloads: <code class="text-slate-200">${escapeHtml(cfg.downloadsDir || '')}</code>
            <input id="osu-dir" type="text" placeholder="trocar pasta (opcional)" class="ml-2 w-60 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-[11px]"></div>
        <label class="flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer"><input id="osu-mirror" type="checkbox" ${cfg.mirror ? 'checked' : ''} class="mt-0.5 accent-pink-400">
            <span><b>Baixar direto por espelho não oficial</b> (catboy.best) — um clique, sem abrir o site do osu!. É um site da comunidade, não do osu!: pode sair do ar e redistribui os mapas fora do canal oficial. Desligado = abre a página oficial e o treinador importa sozinho quando o download terminar.</span></label>
        ${cfg.configured ? '<button id="osu-setup-close" class="self-start px-2 py-0.5 rounded bg-slate-800 border border-slate-600 text-[11px]">Fechar conexão</button>' : ''}`;
    el.querySelector('#osu-save').addEventListener('click', async () => {
        const body = { clientId: el.querySelector('#osu-cid').value.trim(), mirror: el.querySelector('#osu-mirror').checked, test: true };
        const sec = el.querySelector('#osu-secret').value.trim();
        if (sec) body.clientSecret = sec;
        const dir = el.querySelector('#osu-dir').value.trim();
        if (dir) body.downloadsDir = dir;
        osuStatus('Testando a conexão com o osu!…');
        try {
            await osuServer('/api/osu/config', { method: 'POST', body: JSON.stringify(body) });
            await checkOsuServer();
            osuStatus('✅ Conectado ao osu!', 'ok');
            renderOsuSetup(false);
            osuSearch(false);
        } catch (e) { osuStatus('❌ ' + escapeHtml(e.message) + ' — confira o Client ID e o Client Secret.', 'error'); }
    });
    el.querySelector('#osu-mirror').addEventListener('change', async (e) => {
        try { await osuServer('/api/osu/config', { method: 'POST', body: JSON.stringify({ mirror: e.target.checked }) }); await checkOsuServer(); renderOsuResults(); } catch (err) {}
    });
    el.querySelector('#osu-setup-close')?.addEventListener('click', () => renderOsuSetup(false));
}

async function osuSearch(more) {
    if (osuState.loading) return;
    if (more && !osuState.cursor) return;
    const m = document.getElementById('osu-modal');
    const keys = m.querySelector('#osu-keys').value;
    let q = m.querySelector('#osu-q').value.trim();
    if (keys) q = `${q} keys=${keys}`.trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('s', m.querySelector('#osu-status-sel').value);
    const sort = m.querySelector('#osu-sort').value;
    if (sort) params.set('sort', sort);
    if (more) params.set('cursor', osuState.cursor);
    osuState.loading = true;
    if (!more) { osuState.results = []; osuState.cursor = null; document.getElementById('osu-results').innerHTML = '<div class="text-slate-400 text-[12px] p-4">Buscando no osu!…</div>'; }
    try {
        const j = await osuServer('/api/osu/search?' + params.toString());
        const sets = (j.beatmapsets || []).filter(s => (s.beatmaps || []).some(b => b.mode === 'mania' && OSU_KEYS_SUPPORTED.includes(Math.round(b.cs))));
        osuState.results = osuState.results.concat(sets);
        osuState.cursor = j.cursor_string || null;
        renderOsuResults();
        if (!more) osuStatus('');
    } catch (e) {
        if (e.data && e.data.needsConfig) { renderOsuSetup(true); osuStatus('Configure a conexão com o osu! primeiro.', 'error'); }
        else osuStatus('❌ Não deu pra buscar: ' + escapeHtml(e.message), 'error');
        if (!more) document.getElementById('osu-results').innerHTML = '';
    } finally { osuState.loading = false; }
}

function fmtLen(sec) { return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`; }
function starColor(s) { return s < 2 ? '#7dd3fc' : s < 3 ? '#86efac' : s < 4 ? '#fde047' : s < 5 ? '#fb923c' : s < 6.5 ? '#f472b6' : '#c084fc'; }

function renderOsuResults() {
    const box = document.getElementById('osu-results');
    if (!box) return;
    const imported = importedSetIds();
    if (!osuState.results.length) { box.innerHTML = '<div class="text-slate-400 text-[12px] p-4">Nada encontrado com esses filtros.</div>'; return; }
    const mirror = osuState.cfg && osuState.cfg.mirror;
    box.innerHTML = osuState.results.map(s => {
        const diffs = (s.beatmaps || []).filter(b => b.mode === 'mania').sort((a, b) => a.difficulty_rating - b.difficulty_rating);
        const len = diffs.length ? diffs[diffs.length - 1].total_length : 0;
        const pend = osuState.pending[s.id];
        const btn = imported.has(s.id) && !pend
            ? `<button data-osu-dl="${s.id}" class="px-2 py-1 rounded bg-emerald-700/50 border border-emerald-500/60 text-emerald-100 text-[11px]" title="Baixar de novo">✓ Importado</button>`
            : pend ? `<span class="px-2 py-1 rounded bg-slate-800 border border-amber-500/60 text-amber-200 text-[11px]">${escapeHtml(pend.text)}</span>`
            : `<button data-osu-dl="${s.id}" class="px-2 py-1 rounded bg-pink-600 hover:bg-pink-500 text-white text-[11px] font-bold"><i class="fa-solid fa-download mr-1"></i>${mirror ? 'Baixar' : 'Baixar (site)'}</button>`;
        return `<div class="flex gap-2 p-2 rounded-lg bg-slate-800/50 border border-slate-700">
            <div class="relative w-20 h-20 shrink-0 rounded overflow-hidden bg-slate-950">
                <img src="${escapeHtml((s.covers && (s.covers['list@2x'] || s.covers.list)) || '')}" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none'">
                <button data-osu-play="${s.id}" class="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white text-xl" title="Ouvir a prévia">${osuState.previewId === s.id ? '■' : '▶'}</button>
            </div>
            <div class="flex-1 min-w-0 flex flex-col gap-1">
                <div class="font-bold text-[13px] text-white truncate" title="${escapeHtml(s.title_unicode || s.title)}">${escapeHtml(s.title_unicode || s.title)}</div>
                <div class="text-[11px] text-slate-300 truncate">${escapeHtml(s.artist_unicode || s.artist)} · <span class="text-slate-400">mapa de ${escapeHtml(s.creator)}</span></div>
                <div class="text-[10px] text-slate-400 font-mono">${Math.round(s.bpm || 0)} BPM · ${fmtLen(len)} · ${escapeHtml(s.status)}</div>
                <div class="flex flex-wrap gap-1">${diffs.slice(0, 10).map(b => {
                    const k = Math.round(b.cs), ok = OSU_KEYS_SUPPORTED.includes(k);
                    return `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono ${ok ? 'bg-slate-900' : 'bg-slate-900/40 line-through text-slate-500'}" style="${ok ? `color:${starColor(b.difficulty_rating)}` : ''}" title="${escapeHtml(b.version)}${ok ? '' : ' — esse número de teclas não existe no BEATMAX'}">${k}K ★${b.difficulty_rating.toFixed(1)}</span>`;
                }).join('')}${diffs.length > 10 ? `<span class="text-[10px] text-slate-500">+${diffs.length - 10}</span>` : ''}</div>
            </div>
            <div class="shrink-0 flex flex-col items-end justify-between gap-1">${btn}
                <a href="https://osu.ppy.sh/beatmapsets/${s.id}" target="_blank" rel="noopener" class="text-[10px] text-slate-400 hover:text-cyan-300">ver no osu!</a></div>
        </div>`;
    }).join('') + (osuState.cursor ? '<div class="md:col-span-2 text-center text-[11px] text-slate-500 p-2">role pra ver mais…</div>' : '');
    box.querySelectorAll('[data-osu-play]').forEach(b => b.addEventListener('click', () => toggleOsuPreview(+b.dataset.osuPlay)));
    box.querySelectorAll('[data-osu-dl]').forEach(b => b.addEventListener('click', () => startOsuDownload(+b.dataset.osuDl)));
}

function stopOsuPreview() {
    if (osuState.preview) { try { osuState.preview.pause(); } catch (e) {} }
    osuState.preview = null; osuState.previewId = null;
}
function toggleOsuPreview(id) {
    const was = osuState.previewId;
    stopOsuPreview();
    if (was !== id) {
        const s = osuState.results.find(x => x.id === id);
        const url = s && s.preview_url ? (s.preview_url.startsWith('//') ? 'https:' + s.preview_url : s.preview_url) : `https://b.ppy.sh/preview/${id}.mp3`;
        const a = new Audio(url);
        a.volume = 0.6;
        a.play().catch(() => osuStatus('Não deu pra tocar a prévia.', 'error'));
        a.addEventListener('ended', () => { if (osuState.previewId === id) { osuState.previewId = null; renderOsuResults(); } });
        osuState.preview = a; osuState.previewId = id;
    }
    renderOsuResults();
}

// ---------- download ----------
async function startOsuDownload(setId) {
    const s = osuState.results.find(x => x.id === setId);
    const stars = {};
    (s && s.beatmaps || []).forEach(b => { stars[b.id] = b.difficulty_rating; });
    if (osuState.cfg && osuState.cfg.mirror) {
        osuState.pending[setId] = { text: 'baixando…' };
        renderOsuResults();
        try {
            const r = await fetch('/api/osu/mirror?id=' + setId);
            if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `erro ${r.status}`);
            const blob = await r.blob();
            await finishOsuImport(setId, blob, stars, s);
        } catch (e) {
            delete osuState.pending[setId];
            osuStatus(`❌ O espelho não entregou esse mapa (${escapeHtml(e.message)}). Tente pelo site oficial desligando o espelho em Conexão.`, 'error');
            renderOsuResults();
        }
        return;
    }
    // caminho oficial: abre a página do mapa; você clica em download lá; o servidor vê o
    // .osz chegar na pasta Downloads e o treinador importa sozinho
    osuState.pending[setId] = { text: 'esperando o download…', since: Date.now() - 3000, stars, set: s };
    window.open(`https://osu.ppy.sh/beatmapsets/${setId}`, '_blank', 'noopener');
    osuStatus(`Abri a página oficial do mapa. Clique em <b>Download</b> lá (logado na sua conta) — quando o arquivo terminar de baixar, ele aparece aqui sozinho. <span class="text-slate-400">(pasta vigiada: ${escapeHtml((osuState.cfg && osuState.cfg.downloadsDir) || 'Downloads')})</span>`);
    renderOsuResults();
    startOsuWatch();
}

function startOsuWatch() {
    if (osuState.watchTimer) return;
    osuState.watchTimer = setInterval(async () => {
        const ids = Object.keys(osuState.pending).filter(k => osuState.pending[k].since);
        if (!ids.length) { clearInterval(osuState.watchTimer); osuState.watchTimer = null; return; }
        const since = Math.min(...ids.map(k => osuState.pending[k].since));
        let j;
        try { j = await osuServer('/api/osu/watch?since=' + since); } catch (e) { return; }
        for (const k of ids) {
            const p = osuState.pending[k];
            if (!p || p.busy) continue;
            if (Date.now() - p.since > 15 * 60000) { delete osuState.pending[k]; renderOsuResults(); continue; }
            const f = (j.files || []).find(f => (f.name.startsWith(k + ' ') || f.name.startsWith(k + '.') || f.name.startsWith(k + '_')) && f.mtime >= p.since);
            if (!f) continue;
            // espera o tamanho parar de mudar (download terminando de gravar)
            if (p.lastSize !== f.size) { p.lastSize = f.size; continue; }
            p.busy = true;
            p.text = 'importando…'; renderOsuResults();
            try {
                const r = await fetch('/api/osu/file?name=' + encodeURIComponent(f.name));
                if (!r.ok) throw new Error(`erro ${r.status}`);
                await finishOsuImport(+k, await r.blob(), p.stars, p.set);
            } catch (e) {
                delete osuState.pending[k];
                osuStatus('❌ Não deu pra importar: ' + escapeHtml(e.message), 'error');
                renderOsuResults();
            }
        }
    }, 1500);
}

async function finishOsuImport(setId, blob, stars, set) {
    try {
        const created = await importOszBlob(blob, { setId, stars });
        delete osuState.pending[setId];
        const names = created.map(c => `${getModeDisplayName(c.mode)} [${escapeHtml(c.osu.version)}]`).join(', ');
        osuStatus(`✅ <b>${escapeHtml((set && (set.title_unicode || set.title)) || created[0].title)}</b> importada: ${names}. Já está na lista de treinos do menu (troque pro modo certo, ex.: 4B).`, 'ok');
    } catch (e) {
        delete osuState.pending[setId];
        osuStatus('❌ ' + escapeHtml(e.message), 'error');
    }
    renderOsuResults();
}

async function importOszFileWithStatus(file) {
    osuStatus(`Importando <b>${escapeHtml(file.name)}</b>…`);
    try {
        const setId = parseInt(file.name, 10) || null;
        const created = await importOszBlob(file, { setId });
        osuStatus(`✅ ${created.length} dificuldade(s) importada(s) de <b>${escapeHtml(file.name)}</b>: ${created.map(c => `${getModeDisplayName(c.mode)} [${escapeHtml(c.osu.version)}]`).join(', ')}.`, 'ok');
        renderOsuResults();
    } catch (e) {
        osuStatus(`❌ ${escapeHtml(file.name)}: ${escapeHtml(e.message)}`, 'error');
    }
}

// ---------- botão no topo ----------
(function addOsuButton() {
    const ref = document.getElementById('btn-chart-editor');
    if (!ref) return;
    const b = document.createElement('button');
    b.id = 'btn-osu';
    b.className = ref.className;
    b.innerHTML = '<i class="fa-solid fa-compact-disc text-pink-400"></i> Músicas osu!';
    ref.parentElement.insertBefore(b, ref);
    b.addEventListener('click', openOsuModal);
})();
