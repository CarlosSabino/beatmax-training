// =====================================================================================
// backup.js — Backup completo num arquivo só: configurações, charts do editor, áudios das
// músicas, imagem de fundo, histórico/recordes e rascunho do editor. Tudo isso vive dentro
// do navegador (localStorage + IndexedDB): limpar os dados do navegador ou trocar de PC
// apagava tudo. Exportar gera um .zip (backup.json + os arquivos de áudio/imagem/vídeo como
// estão, sem converter pra texto); Importar aceita esse .zip e também os .json antigos.
// Por que .zip: o .json antigo virava UM texto gigante (áudio em base64) e com muitas músicas
// passava do limite de texto do navegador ("Invalid string length").
// =====================================================================================

const BACKUP_FORMAT = 'djmax-trainer-backup';

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
    });
}
function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'application/octet-stream' });
}
function idbOpen(name, version, upgrade) {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('sem IndexedDB'));
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = () => upgrade && upgrade(req.result);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function idbAll(db, store) {
    return new Promise((resolve, reject) => {
        const out = [];
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).openCursor();
        req.onsuccess = () => { const c = req.result; if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else resolve(out); };
        req.onerror = () => reject(req.error);
    });
}
function idbPut(db, store, value, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        if (key === undefined) tx.objectStore(store).put(value); else tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// vídeos muito grandes (fundo) ficam de fora do backup — viram um arquivo enorme e o
// navegador pode travar ao montar; a imagem/vídeo original continua no seu PC
const BACKUP_MAX_VIDEO_BYTES = 80 * 1048576;
let backupSkippedVideos = 0;
// files: lista onde vão os arquivos (Blob) do backup; no JSON fica só a referência
async function packValue(v, files) {
    if (v instanceof Blob && /^video\//.test(v.type || '') && v.size > BACKUP_MAX_VIDEO_BYTES) { backupSkippedVideos++; return null; }
    if (v instanceof Blob) {
        if (!files) return { __blob: true, type: v.type, data: await blobToBase64(v) };
        const name = `arquivos/${files.length + 1}`;
        files.push({ name, blob: v });
        return { __file: name, type: v.type };
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)) {
        const o = {};
        for (const k of Object.keys(v)) o[k] = await packValue(v[k], files);
        return o;
    }
    return v;
}
// lê de volta (zip: pega o arquivo pelo nome; json antigo: base64)
async function unpackValueAsync(v, data) {
    if (v && typeof v === 'object' && v.__file) {
        const e = data && data.__files && data.__files.get(v.__file);
        return e ? e.blob(v.type) : null;
    }
    if (v && typeof v === 'object' && v.__blob) return base64ToBlob(v.data, v.type);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = {};
        for (const k of Object.keys(v)) o[k] = await unpackValueAsync(v[k], data);
        return o;
    }
    return v;
}
function unpackValue(v) {
    if (v && typeof v === 'object' && v.__blob) return base64ToBlob(v.data, v.type);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = {};
        for (const k of Object.keys(v)) o[k] = unpackValue(v[k]);
        return o;
    }
    return v;
}

// ---------- zip "de verdade" pra arquivos grandes (sem carregar tudo na memória como texto) ----------
let bkCrcTable = null;
function bkCrcUpdate(crc, buf) {
    if (!bkCrcTable) {
        bkCrcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; bkCrcTable[n] = c >>> 0; }
    }
    for (let i = 0; i < buf.length; i++) crc = bkCrcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return crc;
}
async function bkCrcOfBlob(blob) {
    let crc = 0xFFFFFFFF;
    const STEP = 8 * 1048576;
    for (let i = 0; i < blob.size; i += STEP) crc = bkCrcUpdate(crc, new Uint8Array(await blob.slice(i, i + STEP).arrayBuffer()));
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
// entries: [{ name, blob }] -> Blob .zip (sem compressão; os Blobs entram direto, sem cópia)
let bkUnreadable = 0;
async function bkMakeZip(entries, onProgress) {
    bkUnreadable = 0;
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (onProgress) onProgress(i, entries.length);
        let crc;
        try { crc = await bkCrcOfBlob(e.blob); }
        catch (err) { console.warn('[backup] não deu pra ler', e.name, err); bkUnreadable++; e.blob = new Blob([]); crc = 0; }
        const name = enc.encode(e.name), size = e.blob.size;
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true);
        lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
        lh.setUint16(26, name.length, true);
        parts.push(new Uint8Array(lh.buffer), name, e.blob);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true);
        ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
        ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
        central.push(new Uint8Array(ch.buffer), name);
        offset += 30 + name.length + size;
        if (offset > 0xFFFFFFFF) throw new Error('backup passou de 4 GB');
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
// lê o índice do zip sem carregar o arquivo inteiro; cada entrada vira um pedaço (slice) do arquivo
async function bkReadZip(file) {
    const tailLen = Math.min(file.size, 66000);
    const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer());
    const tdv = new DataView(tail.buffer);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tdv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('arquivo .zip inválido');
    const count = tdv.getUint16(eocd + 10, true), cdSize = tdv.getUint32(eocd + 12, true), cdOff = tdv.getUint32(eocd + 16, true);
    const cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dv = new DataView(cd.buffer);
    const map = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
        const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
        const lho = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nlen));
        map.set(name, { name, method, csize, lho });
        p += 46 + nlen + elen + clen;
    }
    for (const e of map.values()) {
        e.blob = async (type) => {
            const lh = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer());
            const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
            const raw = file.slice(start, start + e.csize);
            if (e.method === 0) return new Blob([raw], { type: type || '' });
            if (e.method !== 8) throw new Error('compressão não suportada');
            return new Blob([await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()], { type: type || '' });
        };
    }
    return map;
}
// abre um backup (.zip novo ou .json antigo) e devolve o objeto (com __files no caso do zip)
async function loadBackupFile(file) {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) {
        const files = await bkReadZip(file);
        const je = files.get('backup.json');
        if (!je) throw new Error('esse .zip não é um backup do BEATMAX Training');
        const data = JSON.parse(await (await je.blob('application/json')).text());
        data.__files = files;
        return data;
    }
    return JSON.parse(await file.text());
}

async function buildBackup(files) {
    const ls = {};
    window.__perfilBypass = true; // chaves "cruas": o backup leva os dados de TODOS os perfis
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && /^djmax/i.test(k)) ls[k] = localStorage.getItem(k);
        }
    } finally { window.__perfilBypass = false; }
    // os charts agora moram no IndexedDB — vão no backup no mesmo lugar de sempre
    if (typeof CUSTOM_CHARTS_KEY !== 'undefined') ls[CUSTOM_CHARTS_KEY] = JSON.stringify(customCharts);
    backupSkippedVideos = 0;
    const out = { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), localStorage: ls, chartAudio: [], media: [] };
    try {
        const db = await openChartAudioDb();
        for (const row of await idbAll(db, CHART_AUDIO_STORE)) out.chartAudio.push(await packValue(row.value, files));
    } catch (e) { console.warn('backup: áudios dos charts', e); }
    try {
        const db = await idbOpen('djmaxTrainerMedia', 1, d => d.createObjectStore('kv'));
        for (const row of await idbAll(db, 'kv')) { if (typeof CHARTS_IDB_KEY !== 'undefined' && row.key === CHARTS_IDB_KEY) continue; out.media.push({ key: row.key, value: await packValue(row.value, files) }); }
        db.close();
    } catch (e) { console.warn('backup: imagem de fundo', e); }
    // replays (o do recorde de cada treino + os últimos)
    try {
        if (typeof replayDb === 'function') {
            const db = await replayDb();
            out.replays = (await idbAll(db, REPLAY_STORE)).map(row => row.value);
        }
    } catch (e) { console.warn('backup: replays', e); }
    return out;
}

// monta o .zip do backup inteiro (usado pelo botão Exportar e pelo "Fazer backup e sair")
async function makeBackupBlob(onStatus) {
    const files = [];
    const data = await buildBackup(files);
    const json = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const blob = await bkMakeZip([{ name: 'backup.json', blob: json }].concat(files), (i, n) => { if (onStatus && n > 5) onStatus(`Montando o arquivo… ${Math.round(i / n * 100)}%`); });
    const d = new Date();
    const name = `beatmax-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
    return { blob, name, data };
}

async function exportBackup() {
    const st = document.getElementById('backup-status');
    if (st) st.textContent = 'Juntando tudo...';
    try {
        const { blob, name, data } = await makeBackupBlob((m) => { if (st) st.textContent = m; });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        if (st) st.textContent = `✅ Backup gerado: ${name} (${(blob.size / 1048576).toFixed(1)} MB · ${Object.keys(data.localStorage).length} itens de configuração, ${data.chartAudio.length} áudio(s) de chart${(data.replays || []).length ? `, ${data.replays.length} replay(s)` : ''}${data.media.length ? ', fundos' : ''})${backupSkippedVideos ? ` — ${backupSkippedVideos} vídeo(s) de fundo grande(s) ficaram de fora` : ''}${bkUnreadable ? ` — ⚠️ ${bkUnreadable} arquivo(s) não puderam ser lidos e ficaram vazios` : ''}.`;
        try { localStorage.setItem('djmaxTrainerLastBackup', String(Date.now())); } catch (e) {}
    } catch (e) {
        if (st) st.textContent = `❌ Não deu pra gerar o backup: ${e.message || e}`;
    }
}

async function importBackupFile(file) {
    const st = document.getElementById('backup-status');
    if (!file) return;
    try {
        const data = await loadBackupFile(file);
        if (!data || data.format !== BACKUP_FORMAT) throw new Error('esse arquivo não é um backup do BEATMAX Training');
        const when = data.createdAt ? new Date(data.createdAt).toLocaleString('pt-BR') : '?';
        if (!confirm(`Restaurar o backup de ${when}?\n\nIsso SUBSTITUI as configurações, charts, áudios, histórico e recordes atuais por os do arquivo. A página recarrega no fim.`)) return;
        if (st) st.textContent = 'Restaurando...';
        // configurações/charts/histórico
        window.__perfilBypass = true;
        Object.keys(localStorage).filter(k => /^djmax/i.test(k)).forEach(k => localStorage.removeItem(k));
        for (const [k, v] of Object.entries(data.localStorage || {})) {
            if (typeof CUSTOM_CHARTS_KEY !== 'undefined' && k === CUSTOM_CHARTS_KEY) { await mediaPut(CHARTS_IDB_KEY, JSON.parse(v || '[]')); continue; }
            try { localStorage.setItem(k, v); } catch (e) { console.warn('restaurar', k, e); }
        }
        window.__perfilBypass = false;
        // áudios
        const adb = await openChartAudioDb();
        for (const row of (data.chartAudio || [])) await idbPut(adb, CHART_AUDIO_STORE, await unpackValueAsync(row, data));
        // imagem de fundo etc.
        if ((data.media || []).length) {
            const mdb = await idbOpen('djmaxTrainerMedia', 1, d => d.createObjectStore('kv'));
            for (const row of data.media) await idbPut(mdb, 'kv', await unpackValueAsync(row.value, data), row.key);
            mdb.close();
        }
        if ((data.replays || []).length && typeof replayDb === 'function') {
            const rdb = await replayDb();
            for (const row of data.replays) await idbPut(rdb, REPLAY_STORE, row);
        }
        if (st) st.textContent = '✅ Backup restaurado — recarregando...';
        setTimeout(() => { window.__beatmaxSaindo = true; location.reload(); }, 600);
    } catch (e) {
        if (st) st.textContent = `❌ Não deu pra restaurar: ${e.message || e}`;
    }
}

function ensureBackupDialog() {
    let m = document.getElementById('backup-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'backup-modal';
    m.className = 'hidden absolute inset-0 bg-slate-950/90 backdrop-blur-md flex justify-center items-center p-4 z-[88]';
    m.innerHTML = `
      <div class="max-w-lg w-full bg-slate-900 border border-cyan-500/40 rounded-2xl p-5 shadow-2xl flex flex-col gap-3">
        <div class="flex items-center justify-between">
            <h2 class="font-orbitron text-xl font-black text-cyan-300">BACKUP DOS SEUS DADOS</h2>
            <button id="btn-backup-close" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] text-slate-200">Fechar</button>
        </div>
        <p class="text-[12px] text-slate-300 leading-snug">Tudo do treinador fica guardado dentro do navegador: configurações e sincronia, charts do editor com os áudios, imagem de fundo, histórico e recordes. Limpar os dados do navegador ou trocar de PC apaga isso — o backup junta tudo num arquivo só.</p>
        <p id="backup-last" class="text-[11px] text-slate-400"></p>
        <div class="flex flex-wrap gap-2">
            <button id="btn-backup-export" class="flex-1 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[12px] font-bold"><i class="fa-solid fa-download mr-1"></i>Exportar backup</button>
            <label class="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[12px] font-bold text-slate-100 text-center cursor-pointer"><i class="fa-solid fa-upload mr-1"></i>Importar backup
                <input id="backup-import-file" type="file" accept=".zip,application/zip,application/json,.json" class="hidden"></label>
        </div>
        <p id="backup-status" class="text-[11px] text-slate-300 min-h-[1.2em]"></p>
      </div>`;
    (document.getElementById('menu-overlay')?.parentElement || document.body).appendChild(m);
    m.querySelector('#btn-backup-close').addEventListener('click', () => m.classList.add('hidden'));
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
    m.querySelector('#btn-backup-export').addEventListener('click', exportBackup);
    m.querySelector('#backup-import-file').addEventListener('change', (e) => { importBackupFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    return m;
}

function openBackupDialog() {
    const m = ensureBackupDialog();
    const last = parseInt(localStorage.getItem('djmaxTrainerLastBackup') || '0', 10);
    m.querySelector('#backup-last').textContent = last ? `Último backup exportado: ${new Date(last).toLocaleString('pt-BR')}` : 'Nenhum backup exportado ainda neste navegador.';
    m.querySelector('#backup-status').textContent = '';
    m.classList.remove('hidden');
}

// atalho nas Configurações
(function addBackupToSettings() {
    const modal = document.getElementById('settings-modal');
    const anchor = [...(modal ? modal.querySelectorAll('div') : [])].find(d => d.textContent.trim() === 'Gear e fundo');
    if (!anchor) return;
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-3';
    row.innerHTML = `<span><span class="text-xs font-bold text-slate-200 block">Backup dos seus dados</span><span class="text-[10px] text-slate-400">Configurações, charts com áudio, histórico e recordes num arquivo só.</span></span>
        <button type="button" id="btn-settings-backup" class="shrink-0 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-cyan-700/60 text-[11px] font-semibold text-cyan-300"><i class="fa-solid fa-box-archive mr-1"></i>Backup</button>`;
    anchor.parentElement.insertBefore(row, anchor);
    row.querySelector('#btn-settings-backup').addEventListener('click', openBackupDialog);
})();
