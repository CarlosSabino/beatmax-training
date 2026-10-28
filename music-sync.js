// =====================================================================================
// music-sync.js — música dos treinos SINCRONIZADA com as notas + sons de toque novos.
//
// Antes, a música procedural era só uma batida em cima da grade, que não tinha nada a ver
// com o que caía na tela. Agora:
//   • Bateria/baixo/acordes seguem a grade do BPM (tempo forte = começo do compasso).
//   • CADA NOTA do treino vira uma nota musical no instante exato dela (tipo o "keysound" do
//     DJMAX): a lane escolhe a altura (dentro do acorde do compasso), então escadinha soa como
//     arpejo, acorde soa como acorde, hold segura o som. A música "é" o treino.
//   • Opção "Melodia das notas": Guia (toca sempre no tempo certo — ótimo pra pegar o ritmo),
//     Keysound (só toca quando você acerta, como no jogo) ou Desligada.
//   • Som do toque das teclas: várias opções (suave, clique, palma, bumbo, chimbal, aro, sino,
//     a nota da música, o antigo) e volume próprio.
// Tudo agendado no relógio de áudio (sample-accurate), com a mesma conta de latência de saída
// e o mesmo offset de áudio de sempre (ver wallToCtxTime / audioPosForChartTime no script.js).
// =====================================================================================

let noteMelodyMode = 'guide';   // 'guide' | 'hit' | 'off'
let hitSoundType = 'soft';      // ver HIT_SOUND_TYPES
let hitSoundVolume = 0.6;       // 0..1 (multiplica o volume geral)
let musicVolume = 0.8;          // 0..1 (multiplica o volume geral)

const HIT_SOUND_TYPES = {
    soft: 'Suave (tic abafado)',
    click: 'Clique de madeira',
    clap: 'Palma',
    kick: 'Bumbo',
    hat: 'Chimbal',
    rim: 'Aro de caixa',
    bell: 'Sino',
    keysound: 'Nota da música (keysound)',
    classic: 'Antigo (bip)'
};

// Estilo musical de cada tipo de treino (drill.music): tom, escala, progressão de acordes
// (graus da escala), bateria e timbre da melodia das notas.
const MUSIC_STYLES = {
    custom:     { root: 57, scale: 'minor', prog: [0, 5, 3, 4], drums: 'steady', lead: 'pluck', pad: true },
    staircase:  { root: 60, scale: 'major', prog: [0, 4, 5, 3], drums: 'house', lead: 'bell', pad: true },
    trill:      { root: 62, scale: 'minor', prog: [0, 6, 5, 6], drums: 'breaks', lead: 'pluck', pad: true },
    chordjack:  { root: 55, scale: 'minor', prog: [0, 5, 2, 6], drums: 'hardcore', lead: 'stab', pad: false },
    speedcore_stream: { root: 64, scale: 'minor', prog: [0, 5, 6, 4], drums: 'speedcore', lead: 'saw', pad: false },
    procedural_synth: { root: 60, scale: 'dorian', prog: [0, 3, 4, 3], drums: 'house', lead: 'pluck', pad: true }
};
const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10]
};
// 16 passos por compasso: quem toca em cada passo
const DRUM_PATTERNS = {
    steady:    { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], ohat: [] },
    house:     { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], ohat: [14] },
    breaks:    { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], ohat: [7] },
    hardcore:  { kick: [0, 4, 8, 12], snare: [4, 12], hat: [1, 3, 5, 7, 9, 11, 13, 15], ohat: [] },
    speedcore: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], ohat: [] }
};

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- buses de volume e ruído reaproveitado ----------
AudioEngine.prototype.ensureBuses = function () {
    if (!this.ctx) return;
    if (!this.musicBus || this.musicBus.context !== this.ctx) {
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 3;
        comp.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.connect(comp);
        this.hitBus = this.ctx.createGain();
        this.hitBus.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 1.0);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    // durante o fade do fim da música não mexe no volume (senão o fade é desfeito)
    if (!this.musicFading) {
        try { this.musicBus.gain.cancelScheduledValues(0); } catch (e) { /* segue */ }
        this.musicBus.gain.value = this.volume * musicVolume;
    }
    this.hitBus.gain.value = this.volume * hitSoundVolume;
};

AudioEngine.prototype._noise = function (t, dur, filterType, freq, q, gainPeak, bus, decay) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainPeak, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (decay || dur));
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t, Math.random() * 0.5, dur + 0.02);
};

AudioEngine.prototype._tone = function (t, freq, type, dur, gainPeak, bus, opts) {
    const o = opts || {};
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.toFreq) osc.frequency.exponentialRampToValueAtTime(o.toFreq, t + (o.sweep || dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = this.ctx.createGain();
    const atk = o.attack || 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + atk);
    if (o.sustainUntil && o.sustainUntil > t + atk) {
        g.gain.setValueAtTime(gainPeak * (o.sustainLevel || 0.6), o.sustainUntil);
        g.gain.exponentialRampToValueAtTime(0.0008, o.sustainUntil + (o.release || 0.18));
    } else {
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    }
    let node = osc;
    if (o.lowpass) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(o.lowpass, t);
        if (o.lowpassTo) f.frequency.exponentialRampToValueAtTime(o.lowpassTo, t + dur);
        osc.connect(f);
        node = f;
    }
    node.connect(g);
    g.connect(bus);
    const end = (o.sustainUntil && o.sustainUntil > t ? o.sustainUntil + (o.release || 0.18) : t + dur) + 0.05;
    osc.start(t);
    osc.stop(end);
};

// ---------- instrumentos da música ----------
// (os nomes playHardcoreKick/Snare/SynthNote continuam, pros testes e pro resto do código)
AudioEngine.prototype.playHardcoreKick = function (when) {
    if (!this.ctx || !this.musicEnabled) return;
    try {
        this.ensureBuses();
        const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
        const hard = this.currentMusicStyle && (this.currentMusicStyle.drums === 'hardcore' || this.currentMusicStyle.drums === 'speedcore');
        this._tone(t, hard ? 190 : 150, 'sine', hard ? 0.18 : 0.26, 0.95, this.musicBus, { toFreq: 42, sweep: 0.11 });
        if (hard) this._tone(t, 120, 'square', 0.05, 0.12, this.musicBus, { toFreq: 50, sweep: 0.05, lowpass: 900 });
        this._noise(t, 0.012, 'highpass', 3000, 0.7, 0.18, this.musicBus);
    } catch (e) { /* segue */ }
};

AudioEngine.prototype.playHardcoreSnare = function (when) {
    if (!this.ctx || !this.musicEnabled) return;
    try {
        this.ensureBuses();
        const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
        const style = this.currentMusicStyle ? this.currentMusicStyle.drums : 'house';
        if (style === 'house' || style === 'steady') {
            // palma (3 estalinhos rápidos + cauda)
            [0, 0.009, 0.019].forEach((d, i) => this._noise(t + d, 0.02, 'bandpass', 1400, 1.1, i === 2 ? 0.5 : 0.35, this.musicBus));
            this._noise(t + 0.02, 0.14, 'bandpass', 1200, 0.8, 0.22, this.musicBus);
        } else {
            this._noise(t, 0.16, 'highpass', 1400, 0.6, 0.45, this.musicBus, 0.15);
            this._tone(t, 200, 'triangle', 0.09, 0.3, this.musicBus, { toFreq: 150, sweep: 0.08 });
        }
    } catch (e) { /* segue */ }
};

AudioEngine.prototype.playHat = function (when, open) {
    if (!this.ctx || !this.musicEnabled) return;
    try {
        this.ensureBuses();
        const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
        this._noise(t, open ? 0.14 : 0.035, 'highpass', 7500, 0.5, open ? 0.14 : 0.11, this.musicBus, open ? 0.13 : 0.03);
    } catch (e) { /* segue */ }
};

AudioEngine.prototype.playSynthNote = function (freq, type = 'sawtooth', duration = 0.08, when) {
    // baixo (na grade): onda serrilhada filtrada, bem redondinha
    if (!this.ctx || !this.musicEnabled) return;
    try {
        this.ensureBuses();
        const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
        this._tone(t, freq, type, Math.max(0.08, duration), 0.32, this.musicBus, { lowpass: 520, lowpassTo: 180 });
    } catch (e) { /* segue */ }
};

AudioEngine.prototype.playPadChord = function (freqs, when, durSec) {
    if (!this.ctx || !this.musicEnabled) return;
    try {
        this.ensureBuses();
        const t = Math.max(this.ctx.currentTime, when);
        freqs.forEach((f, i) => {
            this._tone(t, f, 'sawtooth', durSec, 0.035, this.musicBus, {
                attack: 0.08, sustainUntil: t + durSec * 0.8, sustainLevel: 0.8, release: durSec * 0.25,
                lowpass: 900, detune: i % 2 ? 7 : -7
            });
        });
    } catch (e) { /* segue */ }
};

// Melodia de UMA nota do treino (timbre do estilo). holdSec > 0 = segura (nota longa).
AudioEngine.prototype.playMelodyNote = function (freq, when, holdSec, bus, gainMul) {
    if (!this.ctx) return;
    try {
        this.ensureBuses();
        const b = bus || this.musicBus;
        const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
        const lead = this.currentMusicStyle ? this.currentMusicStyle.lead : 'pluck';
        const gm = gainMul == null ? 1 : gainMul;
        const hold = holdSec > 0.05 ? { sustainUntil: t + holdSec, sustainLevel: 0.55, release: 0.2 } : {};
        if (lead === 'bell') {
            this._tone(t, freq, 'sine', 0.7, 0.34 * gm, b, hold);
            this._tone(t, freq * 2.76, 'sine', 0.25, 0.07 * gm, b);
            this._tone(t, freq * 2, 'triangle', 0.3, 0.06 * gm, b);
        } else if (lead === 'stab') {
            this._tone(t, freq, 'square', 0.2, 0.16 * gm, b, Object.assign({ lowpass: 2600, lowpassTo: 700 }, hold));
            this._tone(t, freq * 1.5, 'square', 0.16, 0.06 * gm, b, { lowpass: 2000, lowpassTo: 600 });
        } else if (lead === 'saw') {
            this._tone(t, freq, 'sawtooth', 0.14, 0.15 * gm, b, Object.assign({ lowpass: 3400, lowpassTo: 900, detune: -8 }, hold));
            this._tone(t, freq, 'sawtooth', 0.14, 0.12 * gm, b, Object.assign({ lowpass: 3400, lowpassTo: 900, detune: 8 }, hold));
        } else { // pluck
            this._tone(t, freq, 'triangle', 0.32, 0.36 * gm, b, Object.assign({ lowpass: 3800, lowpassTo: 900 }, hold));
            this._tone(t, freq * 2, 'sine', 0.12, 0.08 * gm, b);
        }
    } catch (e) { /* segue */ }
};

// ---------- harmonia: acorde do compasso + altura de cada nota ----------
function musicStyleFor(patternType) {
    return MUSIC_STYLES[patternType] || MUSIC_STYLES.staircase;
}

// posição da música (ms) -> índice do compasso (acorde) na progressão
function musicBarIndexAt(ctxInfo, posMs) {
    const rel = posMs - ctxInfo.gridOriginMs;
    const seg = tempoSegmentAt(ctxInfo.segs, rel);
    const beat = Math.floor((rel - seg.start) / seg.msPerBeat + 1e-6);
    return seg.index * 1000 + Math.floor(beat / 4);
}

function chordDegreesAt(ctxInfo, posMs) {
    const st = ctxInfo.style;
    const bar = musicBarIndexAt(ctxInfo, posMs);
    const deg = st.prog[((bar % st.prog.length) + st.prog.length) % st.prog.length];
    return [deg, deg + 2, deg + 4];
}

function scaleMidi(st, degree, octaveShift) {
    const sc = SCALES[st.scale] || SCALES.major;
    const oct = Math.floor(degree / 7);
    const d = ((degree % 7) + 7) % 7;
    return st.root + sc[d] + 12 * (oct + (octaveShift || 0));
}

// Altura (Hz) da nota de uma lane no instante `posMs`: lanes principais sobem pelas notas do
// acorde (arpejo da esquerda pra direita); side track / TRACK L/R tocam a tônica no grave.
function melodyFreqFor(ctxInfo, lane, posMs) {
    const st = ctxInfo.style;
    const chord = chordDegreesAt(ctxInfo, posMs);
    const mainCount = getMainLaneCount(currentMode);
    if (lane >= mainCount) return midiToFreq(scaleMidi(st, chord[0], -1));
    const i = Math.max(0, Math.min(mainCount - 1, lane));
    const tone = chord[i % 3] + 7 * Math.floor(i / 3);
    return midiToFreq(scaleMidi(st, tone, 0));
}

// ---------- música procedural nova (substitui a antiga, mesma assinatura) ----------
AudioEngine.prototype.startProceduralMusic = function (bpm = 150, patternType = 'staircase', audioPosMs = 0, gridOriginMs = 2000, tempoChanges = null) {
    this.stopProceduralMusic();
    this.init();
    this.musicFading = false;
    this.ensureBuses();
    this.bpm = bpm;
    this.currentTrackType = patternType;
    const style = musicStyleFor(patternType);
    this.currentMusicStyle = style;
    const drums = DRUM_PATTERNS[style.drums] || DRUM_PATTERNS.house;
    const stepMs = (60 / this.bpm / 4) * 1000;
    const segs = buildTempoSegments(bpm, tempoChanges);
    const ctxInfo = { style, segs, gridOriginMs };
    this.melodyContext = ctxInfo;

    // velocidade da música (gameRate): a música é sintetizada a partir do chart, então tocar
    // mais devagar/rápido não muda o tom — só o andamento
    const rate = (typeof gameRate === 'number' && gameRate > 0) ? gameRate : 1;
    const ctxAtPos0 = this.wallToCtxTime(performance.now() - audioPosMs / rate);
    const posToCtx = (posMs) => ctxAtPos0 + posMs / 1000 / rate;

    // cursor da grade (mesma lógica de antes: por trecho de BPM, k = passo local de 1/16)
    const relNow = Math.max(0, audioPosMs) - gridOriginMs;
    let seg = tempoSegmentAt(segs, relNow);
    let segStep = seg.msPerBeat / 4;
    let k = Math.ceil((relNow - seg.start) / segStep - 1e-6);
    const normalizeCursor = () => {
        while (isFinite(seg.end) && seg.start + k * segStep >= seg.end - 0.5) {
            seg = segs[seg.index + 1];
            segStep = seg.msPerBeat / 4;
            k = 0;
        }
    };
    normalizeCursor();
    const cursorPos = () => gridOriginMs + seg.start + k * segStep;
    const LOOKAHEAD_MS = 150;
    const startWall = performance.now();

    // notas do treino (tempo do chart = posição na música) em ordem, pro "keysound guia"
    const noteList = (typeof notes !== 'undefined' && Array.isArray(notes) ? notes : [])
        .map(n => ({ t: n.time, lane: n.lane, end: n.holdEnd || 0 }))
        .sort((a, b) => a.t - b.t);
    let ni = 0;
    const startPos = Math.max(0, audioPosMs);
    while (ni < noteList.length && noteList[ni].t < startPos - 1) ni++;
    // vários toques no MESMO instante (acorde) — evita somar volume demais
    const chordCount = new Map();
    noteList.forEach(n => chordCount.set(Math.round(n.t), (chordCount.get(Math.round(n.t)) || 0) + 1));

    const playStep = (stepIdx, when, posMs) => {
        const step = ((stepIdx % 16) + 16) % 16;
        if (drums.kick.includes(step)) this.playHardcoreKick(when);
        if (drums.snare.includes(step)) this.playHardcoreSnare(when);
        if (drums.hat.includes(step)) this.playHat(when, false);
        if (drums.ohat.includes(step)) this.playHat(when, true);
        const chord = chordDegreesAt(ctxInfo, posMs + 1);
        // baixo: tônica do acorde no 1 e no "e" do 3, oitava no contratempo
        if (step === 0 || step === 10) this.playSynthNote(midiToFreq(scaleMidi(style, chord[0], -2)), 'sawtooth', segStep * 3 / 1000 / rate, when);
        else if (step === 6 || step === 14) this.playSynthNote(midiToFreq(scaleMidi(style, chord[0], -1)), 'sawtooth', segStep * 1.5 / 1000 / rate, when);
        if (style.pad && step === 0) {
            const barSec = segStep * 16 / 1000 / rate;
            this.playPadChord(chord.map(d => midiToFreq(scaleMidi(style, d, -1))), when, barSec);
        }
    };

    const tick = () => {
        if (!this.ctx) return;
        const nowPos = audioPosMs + (performance.now() - startWall) * rate;
        let guard = 0;
        while (cursorPos() <= nowPos + LOOKAHEAD_MS && guard++ < 512) {
            const when = posToCtx(cursorPos());
            if (this.musicEnabled && when >= this.ctx.currentTime - 0.01) playStep(k, when, cursorPos());
            k++;
            normalizeCursor();
        }
        // melodia das notas no instante exato de cada nota
        guard = 0;
        while (ni < noteList.length && noteList[ni].t <= nowPos + LOOKAHEAD_MS && guard++ < 256) {
            const n = noteList[ni++];
            const when = posToCtx(n.t);
            if (noteMelodyMode === 'guide' && this.musicEnabled && when >= this.ctx.currentTime - 0.01) {
                const same = chordCount.get(Math.round(n.t)) || 1;
                const holdSec = n.end > n.t ? (n.end - n.t) / 1000 / rate : 0;
                this.playMelodyNote(melodyFreqFor(ctxInfo, n.lane, n.t), when, holdSec, this.musicBus, 1 / Math.sqrt(same));
            }
        }
    };
    this.proceduralScheduleInfo = { stepMs, gridOriginMs, ctxAtPos0 };
    tick();
    this.musicInterval = setInterval(tick, 25);
};

// ---------- sons de toque ----------
AudioEngine.prototype.playHitSound = function (laneIndex = 0, type) {
    if (!this.hitsoundEnabled || !this.ctx) return;
    const kind = hitSoundType;
    if (kind === 'keysound') return; // toca a nota da música no acerto (ver hook em processJudgment)
    try {
        this.ensureBuses();
        const t = this.ctx.currentTime;
        const b = this.hitBus;
        if (kind === 'classic') {
            const baseFreq = this.laneFrequencies[laneIndex % this.laneFrequencies.length];
            this._tone(t, baseFreq, type || 'sine', 0.035, 0.4, b, { toFreq: baseFreq * 0.98, sweep: 0.03 });
        } else if (kind === 'click') {
            this._tone(t, 1750, 'sine', 0.035, 0.5, b, { toFreq: 1100, sweep: 0.03 });
            this._noise(t, 0.01, 'bandpass', 2500, 2, 0.25, b);
        } else if (kind === 'clap') {
            [0, 0.008, 0.017].forEach((d, i) => this._noise(t + d, 0.018, 'bandpass', 1500, 1.2, i === 2 ? 0.7 : 0.45, b));
            this._noise(t + 0.018, 0.1, 'bandpass', 1300, 0.9, 0.25, b);
        } else if (kind === 'kick') {
            this._tone(t, 160, 'sine', 0.16, 0.9, b, { toFreq: 50, sweep: 0.09 });
        } else if (kind === 'hat') {
            this._noise(t, 0.04, 'highpass', 8000, 0.6, 0.35, b, 0.04);
        } else if (kind === 'rim') {
            this._tone(t, 820, 'triangle', 0.04, 0.35, b);
            this._noise(t, 0.02, 'bandpass', 3200, 3, 0.3, b);
        } else if (kind === 'bell') {
            const f = [880, 988, 1109, 1319, 1480, 1760][laneIndex % 6];
            this._tone(t, f, 'sine', 0.3, 0.25, b);
            this._tone(t, f * 2.76, 'sine', 0.1, 0.05, b);
        } else { // soft
            this._tone(t, 520, 'sine', 0.045, 0.35, b, { toFreq: 300, sweep: 0.04 });
            this._noise(t, 0.012, 'lowpass', 1800, 0.7, 0.12, b);
        }
    } catch (e) { /* segue */ }
};

// Keysound: com "Melodia das notas = Keysound" ou som do toque = "Nota da música", o acerto
// toca a nota musical daquela nota (na hora do toque, como no DJMAX).
function playKeysoundForNote(note) {
    if (!note || !audio.ctx) return;
    const usingRealSong = typeof currentPatternType === 'string' && currentPatternType.startsWith('custom:') && audio.customChartSourceNode;
    let ctxInfo = usingRealSong ? null : audio.melodyContext;
    if (!ctxInfo) {
        // música de verdade (MP3 do editor): o modo "Keysound" da melodia não se mete na música,
        // mas o som de toque "Nota da música" continua tocando uma nota do acorde padrão.
        if (hitSoundType !== 'keysound') return;
        ctxInfo = { style: MUSIC_STYLES.custom, segs: getTempoSegmentsForPattern(currentPatternType), gridOriginMs: CUSTOM_CHART_START_DELAY_MS };
        audio.currentMusicStyle = ctxInfo.style;
    }
    if (usingRealSong && noteMelodyMode === 'hit' && hitSoundType !== 'keysound') return;
    const holdSec = note.holdEnd ? Math.min(4, (note.holdEnd - note.time) / 1000) : 0;
    if (noteMelodyMode === 'hit' && audio.musicEnabled) {
        audio.playMelodyNote(melodyFreqFor(ctxInfo, note.lane, note.time), audio.ctx.currentTime, holdSec, audio.musicBus, 1);
    } else if (hitSoundType === 'keysound' && audio.hitsoundEnabled) {
        audio.ensureBuses();
        audio.playMelodyNote(melodyFreqFor(ctxInfo, note.lane, note.time), audio.ctx.currentTime, 0, audio.hitBus, 0.9);
    }
}

// liga o keysound no julgamento (sem mexer na lógica de julgamento em si)
if (typeof processJudgment === 'function') {
    const _origProcessJudgment = processJudgment;
    processJudgment = function (diffMs, note) {
        _origProcessJudgment(diffMs, note);
        try { playKeysoundForNote(note); } catch (e) { /* som é opcional */ }
    };
}

// amostra do som escolhido (botão "ouvir" nas configurações)
function previewHitSound() {
    audio.init();
    audio.ensureBuses();
    if (hitSoundType === 'keysound') {
        const st = musicStyleFor('staircase');
        audio.currentMusicStyle = st;
        audio.playMelodyNote(midiToFreq(scaleMidi(st, 4, 0)), audio.ctx.currentTime, 0, audio.hitBus, 0.9);
    } else {
        const was = audio.hitsoundEnabled;
        audio.hitsoundEnabled = true;
        audio.playHitSound(1);
        audio.hitsoundEnabled = was;
    }
}
