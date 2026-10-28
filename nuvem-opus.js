// =====================================================================================
// nuvem-opus.js — converte o áudio de uma chart para Opus (.opus / Ogg) antes de subir
// pra nuvem: uma música em FLAC de ~40 MB vira ~4 MB, quase sem diferença no som.
//
// Como: o navegador decodifica o arquivo original (mp3/flac/ogg/wav…) em PCM 48 kHz, o
// WebCodecs AudioEncoder comprime em Opus, e a gente empacota os pacotes num arquivo Ogg
// (formato padrão do .opus). O "pre-skip" do OpusHead faz o decodificador descartar o
// atraso do codificador — então a música começa EXATAMENTE no mesmo ponto e a sincronia
// das notas não muda (testado com um clique em posição conhecida).
// Se o navegador não tiver AudioEncoder, devolve null (aí sobe o arquivo original).
// =====================================================================================

const OPUS_RATE = 48000;

let oggCrcTable = null;
function oggCrc(data) {
    if (!oggCrcTable) {
        oggCrcTable = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let r = i << 24;
            for (let k = 0; k < 8; k++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) : (r << 1);
            oggCrcTable[i] = r >>> 0;
        }
    }
    let crc = 0;
    for (let i = 0; i < data.length; i++) crc = ((crc << 8) ^ oggCrcTable[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
    return crc >>> 0;
}

// monta UMA página Ogg com os pacotes dados (cada pacote < 255*255 bytes)
function oggPage(packets, granule, serial, seq, flags) {
    const lacing = [];
    packets.forEach(p => {
        let n = p.length;
        while (n >= 255) { lacing.push(255); n -= 255; }
        lacing.push(n);
    });
    const bodyLen = packets.reduce((s, p) => s + p.length, 0);
    const page = new Uint8Array(27 + lacing.length + bodyLen);
    const dv = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
    page[4] = 0; page[5] = flags;
    dv.setUint32(6, granule % 0x100000000, true);
    dv.setUint32(10, Math.floor(granule / 0x100000000), true);
    dv.setUint32(14, serial, true);
    dv.setUint32(18, seq, true);
    dv.setUint32(22, 0, true);
    page[26] = lacing.length;
    page.set(lacing, 27);
    let off = 27 + lacing.length;
    packets.forEach(p => { page.set(p, off); off += p.length; });
    dv.setUint32(22, oggCrc(page), true);
    return page;
}

function opusTagsPacket() {
    const vendor = new TextEncoder().encode('BEATMAX Training');
    const p = new Uint8Array(8 + 4 + vendor.length + 4);
    p.set(new TextEncoder().encode('OpusTags'), 0);
    new DataView(p.buffer).setUint32(8, vendor.length, true);
    p.set(vendor, 12);
    return p; // 0 comentários
}

// blob de áudio qualquer -> Blob 'audio/ogg; codecs=opus' (ou null se não der)
async function transcodeToOpus(blob, opts) {
    opts = opts || {};
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
    const bitrate = opts.bitrate || 128000;
    const sup = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 2, bitrate }).catch(() => null);
    if (!sup || !sup.supported) return null;

    // 1) decodifica em 48 kHz estéreo
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const tmp = new Ctx(2, OPUS_RATE, OPUS_RATE);
    const buf = await tmp.decodeAudioData(await blob.arrayBuffer());
    const total = buf.length;
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;

    // 2) codifica
    const packets = [];
    let head = null, failed = null;
    const enc = new AudioEncoder({
        output: (chunk, meta) => {
            const d = new Uint8Array(chunk.byteLength);
            chunk.copyTo(d);
            packets.push({ data: d, dur: chunk.duration || 20000 });
            if (!head && meta && meta.decoderConfig && meta.decoderConfig.description) head = new Uint8Array(meta.decoderConfig.description);
        },
        error: (e) => { failed = e; }
    });
    enc.configure({ codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: 2, bitrate });
    const STEP = OPUS_RATE; // 1 s por vez
    for (let i = 0; i < total; i += STEP) {
        const n = Math.min(STEP, total - i);
        const planar = new Float32Array(n * 2);
        planar.set(L.subarray(i, i + n), 0);
        planar.set(R.subarray(i, i + n), n);
        enc.encode(new AudioData({ format: 'f32-planar', sampleRate: OPUS_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / OPUS_RATE), data: planar }));
        if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
        if (opts.onProgress && (i / STEP) % 10 === 0) opts.onProgress(i / total);
        if (failed) break;
    }
    await enc.flush();
    enc.close();
    if (failed) throw failed;
    if (!packets.length) return null;

    // 3) OpusHead (do codificador, com o pre-skip certo) — ou um padrão se não vier
    if (!head || head.length < 19) {
        head = new Uint8Array(19);
        head.set(new TextEncoder().encode('OpusHead'), 0);
        head[8] = 1; head[9] = 2;
        new DataView(head.buffer).setUint16(10, 312, true);
        new DataView(head.buffer).setUint32(12, OPUS_RATE, true);
    }
    const preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);

    // 4) Ogg: página do cabeçalho, página das tags, depois ~1 s de áudio por página
    const serial = (Math.random() * 0xffffffff) >>> 0;
    const pages = [oggPage([head], 0, serial, 0, 0x02), oggPage([opusTagsPacket()], 0, serial, 1, 0)];
    let seq = 2, granule = 0, group = [], groupSize = 0;
    const end = preSkip + total; // granule final = amostras reais + pre-skip
    packets.forEach((p, idx) => {
        granule += Math.round(p.dur * OPUS_RATE / 1e6);
        group.push(p.data); groupSize += p.data.length;
        const last = idx === packets.length - 1;
        if (group.length >= 50 || groupSize > 60000 || last) {
            pages.push(oggPage(group, last ? Math.min(granule, end) : granule, serial, seq++, last ? 0x04 : 0));
            group = []; groupSize = 0;
        }
    });
    if (opts.onProgress) opts.onProgress(1);
    return new Blob(pages, { type: 'audio/ogg; codecs=opus' });
}
