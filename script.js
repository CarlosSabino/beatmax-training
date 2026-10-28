class AudioEngine {
    constructor() {
        this.ctx = null;
        this.hitsoundEnabled = true;
        this.musicEnabled = true;
        this.volume = 0.7;
        this.musicInterval = null;
        this.step = 0;
        this.bpm = 150;
        this.currentTrackType = 'staircase';

        this.laneFrequencies = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];

        // Áudio original de um chart CUSTOM (feito no editor), recuperado do IndexedDB —
        // ver preloadCustomChartAudioIfNeeded/loadChartAudioBlob.
        this.customChartBuffer = null;
        this.customChartId = null;
        this.customChartSourceNode = null;
        this.customChartGainNode = null;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
            // amostra o relógio do áudio em instantes "soltos" (fora do ritmo da tela), pra o
            // envelope achar o topo do degrau rápido em qualquer placa de som
            this._clkTimer = setInterval(() => this.sampleClock(), 5);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    // Latência de SAÍDA do áudio (o tempo entre agendar um som e ele sair de verdade na caixa/
    // fone), em segundos. Antes ninguém descontava isso: tudo era agendado "pra agora" e saía
    // alguns ms (dezenas, em alguns PCs/fones Bluetooth) DEPOIS da nota passar na linha.
    // Travado em 0..250ms pra um valor maluco reportado pelo navegador não estragar tudo.
    getOutputLatencySec() {
        if (!this.ctx) return 0;
        const lat = Math.max(0, Math.min(0.25, (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)));
        // "Trava" o valor: o navegador vai refinando a estimativa nos primeiros segundos e ela
        // oscila alguns ms — antes cada música pegava um número um pouco diferente (e o
        // julgamento parecia mudar de uma música pra outra). Só troca se mudar de verdade (fone
        // Bluetooth conectado, troca de saída de som etc.).
        if (this._latLatched == null || Math.abs(lat - this._latLatched) > 0.015) this._latLatched = lat;
        return this._latLatched;
    }

    // ===== Relógio do áudio x relógio da tela =====
    // ctx.currentTime não anda liso: ele pula em blocos (a cada ~3-20ms, conforme o PC/placa de
    // som). Antes, a música era agendada lendo esse valor UMA vez no START — e caía num ponto
    // aleatório do "degrau", deixando a música até ~20ms adiantada/atrasada em relação às notas,
    // diferente a cada partida. Agora o jogo amostra o relógio do áudio o tempo todo e guarda o
    // "topo" do degrau (envelope), que é sempre o mesmo ponto: a ligação áudio <-> tela fica
    // estável e igual em toda música, toda gear e toda partida.
    sampleClock() {
        const ctx = this.ctx;
        if (!ctx || ctx.state !== 'running') return;
        const s = ctx.currentTime * 1000 - performance.now();
        if (this._clk == null || s > this._clk || s < this._clk - 80) this._clk = s; // sobe na hora; queda grande = relógio reiniciou
        else this._clk -= 0.002; // desce bem devagar pra acompanhar a deriva entre os dois relógios
        this._clkSamples = (this._clkSamples || 0) + 1;
    }
    // Instante do relógio do áudio que corresponde a um instante da tela (ms, performance.now())
    ctxTimeAtWall(wallMs) {
        if (this._clk != null && this._clkSamples > 8) return (wallMs + this._clk) / 1000;
        return this.ctx.currentTime + (wallMs - performance.now()) / 1000;
    }

    // Converte um instante do relógio de parede (performance.now(), o mesmo das notas caindo
    // e do teclado) no instante do relógio de ÁUDIO em que um som precisa ser agendado pra
    // SAIR exatamente nesse instante — já descontando a latência de saída. É a base de toda a
    // sincronia música <-> notas.
    wallToCtxTime(wallMs) {
        this.sampleClock();
        return this.ctxTimeAtWall(wallMs) - this.getOutputLatencySec();
    }

    playHitSound(laneIndex = 0, type = 'sine') {
        if (!this.hitsoundEnabled || !this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const baseFreq = this.laneFrequencies[laneIndex % this.laneFrequencies.length];

            osc.type = type;
            osc.frequency.setValueAtTime(baseFreq, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.98, this.ctx.currentTime + 0.03);
            
            gain.gain.setValueAtTime(this.volume * 0.4, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.035);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.035);
        } catch(e) {}
    }

    // Metrônomo (contagem 3-2-1, calibrador) e Clap do editor NÃO dependem do "Som das teclas":
    // desligar o tic das teclas não pode deixar o calibrador mudo.
    playMetronomeBeat() {
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, this.ctx.currentTime);
            gain.gain.setValueAtTime(this.volume * 0.3, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.05);
        } catch(e) {}
    }

    // Igual ao playMetronomeBeat, mas agendado num instante EXATO do relógio de áudio
    // (sample-accurate) em vez de tocar imediatamente — essencial pro calibrador de offset,
    // já que agendar via setTimeout/rAF tem alguns ms de imprecisão que um metrônomo de
    // calibração não pode se dar ao luxo de ter.
    scheduleMetronomeBeat(atAudioTime) {
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, atAudioTime);
            gain.gain.setValueAtTime(this.volume * 0.3, atAudioTime);
            gain.gain.exponentialRampToValueAtTime(0.001, atAudioTime + 0.05);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(atAudioTime);
            osc.stop(atAudioTime + 0.05);
        } catch (e) {}
    }

    // "Clap" de teste de sincronia (inspirado no Clap do Moonscraper Chart Editor): som curto
    // e seco, BEM diferente do hitsound normal (tom puro) ou do metrônomo (triângulo), pra dar
    // pra distinguir de ouvido — toca exatamente quando o playhead do editor cruza uma nota
    // durante a reprodução (ver editorState.clapEnabled/lastClapMs em startEditorPlayback), pra
    // confirmar se a nota está mesmo em cima da batida da música ou levemente errada. Sintetiza
    // ruído branco filtrado (passa-banda ~1.8kHz) com envelope bem rápido — imita o "tec" seco
    // de uma palma sem precisar de um arquivo de amostra.
    playClap() {
        if (!this.ctx) return;
        try {
            const dur = 0.08;
            const bufferSize = Math.ceil(this.ctx.sampleRate * dur);
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;

            const bandpass = this.ctx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.frequency.value = 1800;
            bandpass.Q.value = 0.9;

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(this.volume * 0.6, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

            noise.connect(bandpass);
            bandpass.connect(gain);
            gain.connect(this.ctx.destination);
            noise.start();
            noise.stop(this.ctx.currentTime + dur);
        } catch (e) {}
    }

    // `when` (relógio de áudio) permite AGENDAR o som num instante exato em vez de tocar
    // "agora" — é o que o agendador da música procedural usa (ver startProceduralMusic).
    playHardcoreKick(when) {
        if (!this.ctx || !this.musicEnabled) return;
        try {
            const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, t);
            osc.frequency.exponentialRampToValueAtTime(35, t + 0.06);
            gain.gain.setValueAtTime(this.volume * 0.6, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(t);
            osc.stop(t + 0.06);
        } catch(e) {}
    }

    playHardcoreSnare(when) {
        if (!this.ctx || !this.musicEnabled) return;
        try {
            const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
            const bufferSize = this.ctx.sampleRate * 0.05;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const output = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
            const whiteNoise = this.ctx.createBufferSource();
            whiteNoise.buffer = buffer;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(this.volume * 0.35, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
            whiteNoise.connect(gain);
            gain.connect(this.ctx.destination);
            whiteNoise.start(t);
        } catch(e) {}
    }

    playSynthNote(freq, type = 'sawtooth', duration = 0.08, when) {
        if (!this.ctx || !this.musicEnabled) return;
        try {
            const t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(this.volume * 0.28, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(t);
            osc.stop(t + duration);
        } catch(e) {}
    }

    // Música procedural com agendamento PRECISO no relógio de áudio (antes era um setInterval
    // tocando cada passo "na hora que o timer disparasse"). Isso tinha 3 problemas, todos
    // deixando a batida fora da nota por dezenas de ms — exatamente o "muito MAX 90% mesmo
    // jogando certo" relatado:
    //   1. O 1º passo só tocava depois de um intervalo inteiro (setInterval não dispara na hora),
    //      e a grade da música começava no t=0 enquanto as notas começam em 2000ms: dependendo
    //      do BPM, a batida ficava 0 a ~60ms fora da nota (ex.: 175 BPM ~29ms, 140 BPM ~36ms),
    //      um valor DIFERENTE em cada exercício — por isso nenhum offset único resolvia.
    //   2. Jitter do timer (alguns ms pra lá e pra cá em cada batida, pior com a tela pesada).
    //   3. Depois de pausar/voltar/loop, recomeçava do passo 0 em qualquer ponto — fase aleatória.
    // Agora: cada passo j tem um tempo EXATO na timeline da música (gridOriginMs + j*stepMs, a
    // mesma grade das notas), e um agendador olha ~150ms à frente e marca cada som no instante
    // certo do relógio de áudio (já descontando a latência de saída — ver wallToCtxTime).
    // `audioPosMs` = em que ponto da música estamos AGORA (0 no início do jogo).
    // `tempoChanges` (opcional): mudanças de BPM do chart custom [{ time, bpm }], em ms a partir
    // do início do chart (= gridOriginMs na timeline do jogo) — a batida acompanha cada trecho.
    startProceduralMusic(bpm = 150, patternType = 'staircase', audioPosMs = 0, gridOriginMs = 2000, tempoChanges = null) {
        this.stopProceduralMusic();
        this.init();
        this.bpm = bpm;
        this.currentTrackType = patternType;
        const stepMs = (60 / this.bpm / 4) * 1000;
        const segs = buildTempoSegments(bpm, tempoChanges);

        const scales = {
            staircase: [110, 130.81, 146.83, 164.81, 196.00],
            chordjack: [65.41, 82.41, 98.00, 110.00],
            trill: [174.61, 196.00, 220.00, 261.63, 293.66],
            procedural_synth: [261.63, 329.63, 392.00, 493.88],
            complex_staircase: [130.81, 146.83, 164.81, 196.00, 220.00],
            interleaved_chords: [110.00, 146.83, 164.81, 220.00],
            fast_alt_doubles: [174.61, 220.00, 261.63, 329.63],
            layered_jacks: [130.81, 164.81, 196.00, 261.63],
            speedcore_stream: [220.00, 261.63, 293.66, 329.63, 392.00, 440.00],
            custom: [146.83, 174.61, 220.00, 261.63]
        };
        const currentScale = scales[patternType] || scales.staircase;

        // Um único mapeamento "posição da música -> relógio de áudio", calculado AGORA e reusado
        // pra música inteira (estável, sem jitter de recalcular a cada tick).
        const ctxAtPos0 = this.wallToCtxTime(performance.now() - audioPosMs);
        const posToCtx = (posMs) => ctxAtPos0 + posMs / 1000;

        // Cursor da grade: trecho de BPM atual + passo LOCAL dentro dele (k). Primeiro passo a
        // tocar = o próximo da grade a partir de agora (nunca antes do início da música). No 1º
        // trecho k pode ser negativo (lead-in antes da 1ª nota continua com música, como antes).
        // Cada mudança de BPM recomeça a contagem (k=0 = tempo forte na mudança).
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

        const playStep = (stepIdx, when) => {
            const step = ((stepIdx % 32) + 32) % 32;
            if (patternType === 'speedcore_stream') {
                if (step % 2 === 0) this.playHardcoreKick(when);
                if (step % 4 === 2) this.playHardcoreSnare(when);
                this.playSynthNote(currentScale[step % currentScale.length], 'sawtooth', 0.06, when);
            } else if (patternType === 'staircase' || patternType === 'complex_staircase') {
                if (step % 4 === 0) this.playHardcoreKick(when);
                if (step % 8 === 4) this.playHardcoreSnare(when);
                if (step % 2 === 0) this.playSynthNote(currentScale[(step / 2) % currentScale.length], 'sawtooth', 0.12, when);
            } else if (patternType === 'chordjack' || patternType === 'interleaved_chords') {
                if (step % 2 === 0) this.playHardcoreKick(when);
                if (step % 4 === 2) this.playHardcoreSnare(when);
                this.playSynthNote(currentScale[Math.floor((step / 2) % currentScale.length)], 'square', 0.14, when);
            } else if (patternType === 'trill' || patternType === 'fast_alt_doubles') {
                if (step % 4 === 0) this.playHardcoreKick(when);
                if (step % 4 === 2) this.playHardcoreSnare(when);
                this.playSynthNote(currentScale[step % currentScale.length], 'triangle', 0.08, when);
            } else if (patternType === 'procedural_synth' || patternType === 'layered_jacks') {
                if (step % 4 === 0) this.playHardcoreKick(when);
                if (step % 8 === 4) this.playHardcoreSnare(when);
                if (step % 2 === 0) this.playSynthNote(currentScale[Math.floor(Math.random() * currentScale.length)], 'square', 0.09, when);
            } else if (patternType === 'custom') {
                // Backing simples (click track) pros charts feitos no editor — kick em cada tempo,
                // alinhado à MESMA grade de batida do chart (tempo 0 do chart = tempo forte).
                if (step % 4 === 0) this.playHardcoreKick(when);
                if (step % 8 === 4) this.playHardcoreSnare(when);
                if (step % 8 === 0) this.playSynthNote(currentScale[Math.floor(step / 8) % currentScale.length], 'triangle', 0.05, when);
            }
        };

        const tick = () => {
            if (!this.ctx) return;
            const nowPos = audioPosMs + (performance.now() - startWall);
            let guard = 0;
            while (cursorPos() <= nowPos + LOOKAHEAD_MS && guard++ < 512) {
                const when = posToCtx(cursorPos());
                // Passo que já ficou pra trás (aba em 2º plano etc.) é pulado em vez de tocar
                // tudo atrasado de uma vez.
                if (this.musicEnabled && when >= this.ctx.currentTime - 0.01) playStep(k, when);
                k++;
                normalizeCursor();
            }
        };
        this.proceduralScheduleInfo = { stepMs, gridOriginMs, ctxAtPos0 }; // exposto pra teste/diagnóstico
        tick();
        this.musicInterval = setInterval(tick, 25);
    }

    stopProceduralMusic() {
        if (this.musicInterval) {
            clearInterval(this.musicInterval);
            this.musicInterval = null;
        }
    }

    // Toca o áudio original de um chart custom (já carregado em this.customChartBuffer
    // por preloadCustomChartAudioIfNeeded). `delaySec` agenda o início pro FUTURO (no
    // relógio de ÁUDIO, sample-accurate — mesma técnica do scheduleMetronomeBeat do
    // calibrador) em vez de tocar imediatamente — usado pro lead-in de 2s antes do 1º
    // acorde gravado (ver CUSTOM_CHART_START_DELAY_MS em startTrackForCurrentPattern).
    playCustomChartTrack(offsetSec = 0, delaySec = 0) {
        this.stopCustomChartTrack();
        if (!this.customChartBuffer || !this.musicEnabled) return;
        this.init();
        try {
            const source = this.ctx.createBufferSource();
            source.buffer = this.customChartBuffer;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
            source.connect(gain);
            gain.connect(this.ctx.destination);
            // Desconta a latência de saída: agenda um pouco ANTES (ou, se já não dá tempo,
            // começa agora um pouco mais pra frente no buffer) pra o som SAIR no instante certo.
            let when = this.wallToCtxTime(performance.now() + Math.max(0, delaySec) * 1000);
            let startOffset = offsetSec;
            if (when < this.ctx.currentTime) {
                startOffset += this.ctx.currentTime - when;
                when = this.ctx.currentTime;
            }
            const safeOffset = Math.max(0, Math.min(startOffset, this.customChartBuffer.duration - 0.01));
            source.start(when, safeOffset);
            this.customChartSourceNode = source;
            this.customChartGainNode = gain;
        } catch (e) { /* offset fora do intervalo ou música ainda terminando de decodificar */ }
    }

    stopCustomChartTrack() {
        if (this.customChartSourceNode) {
            try { this.customChartSourceNode.stop(); } catch (e) {}
            this.customChartSourceNode = null;
        }
        this.customChartGainNode = null;
    }

    // Áudio do chart em outra velocidade, sem mudar o tom (player de mídia do navegador ligado
    // na mesma saída de som). O começo de um player de mídia não é preciso — por isso o jogo
    // passa a seguir a posição dele (ver followMediaClock).
    playCustomChartMedia(offsetSec = 0, delaySec = 0, rate = 1) {
        this.stopCustomChartMedia();
        if (!this.customChartBlob || !this.musicEnabled) return;
        this.init();
        try {
            const el = new Audio();
            el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true;
            el.src = URL.createObjectURL(this.customChartBlob);
            el.playbackRate = rate;
            el.defaultPlaybackRate = rate;
            const src = this.ctx.createMediaElementSource(el);
            const gain = this.ctx.createGain();
            gain.gain.value = this.volume;
            src.connect(gain); gain.connect(this.ctx.destination);
            this.customMedia = { el, src, gain, url: el.src, rate, lastT: -1, lastPerf: 0, err: null };
            this.customChartGainNode = gain;
            const begin = () => {
                if (!this.customMedia || this.customMedia.el !== el) return;
                try { el.currentTime = offsetSec; } catch (e) {}
                el.play().catch(() => {});
            };
            if (delaySec > 0.005) this.customMedia.timer = setTimeout(begin, delaySec * 1000);
            else begin();
        } catch (e) { this.customMedia = null; }
    }

    stopCustomChartMedia() {
        const m = this.customMedia;
        if (!m) return;
        this.customMedia = null;
        clearTimeout(m.timer);
        try { m.el.pause(); } catch (e) {}
        try { m.src.disconnect(); m.gain.disconnect(); } catch (e) {}
        try { URL.revokeObjectURL(m.url); } catch (e) {}
    }
}

const audio = new AudioEngine();

// ===== Julgamento no estilo DJMAX RESPECT V =====
// Degraus de 10% (MAX 100%, 90%, 80% ... 10%), depois MAX 1% (mantém o combo) e BREAK.
// Fonte (namu.wiki, sistema do DJMAX RESPECT V): no julgamento NORMAL a faixa do MAX 100% é de
// ±41,6ms (2,5 quadros a 60fps); no DIFÍCIL é ±20,8ms (metade). Antes este treinador usava ±25ms
// pro MAX 100% — quase o "difícil" do jogo —, por isso saía tanto MAX 90% jogando certo.
// As faixas dos outros degraus não são publicadas: aqui cada degrau soma 1/2 quadro (8,33ms),
// e o MAX 1% vai até a borda da janela. 'MÁXIMO' = um quarto do normal (estimativa).
const JUDGE_PROFILES = {
    // MAX 90% em ±53,3ms (tabela do Respect V 2.0); os degraus seguintes seguem o mesmo passo
    // (11,67ms) até o MAX 10% (±146,7ms), e o MAX 1% vai até ±166,7ms (10 quadros a 60fps).
    // Difícil = metade de tudo; Máximo = um quarto.
    normal: { label: 'Normal (MAX 100% ±41,6ms)', max100: 41.67, step: 11.667, outer: 166.67 },
    hard:   { label: 'Difícil (MAX 100% ±20,8ms)',        max100: 20.83, step: 5.833, outer: 100 },
    max:    { label: 'Máximo (MAX 100% ±10,4ms)',         max100: 10.42, step: 2.917, outer: 70 }
};
let judgeDifficulty = 'normal';
// TIMING.MAX100..MAX10 = limite (ms, pra mais e pra menos) de cada degrau; MAX1 = borda da janela
// (passou disso: a nota vira BREAK; antes disso o toque nem conta).
const TIMING = {};
const JUDGE_STEPS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
function applyJudgeProfile(name) {
    judgeDifficulty = JUDGE_PROFILES[name] ? name : 'normal';
    const pr = JUDGE_PROFILES[judgeDifficulty];
    JUDGE_STEPS.forEach((pct, i) => { TIMING['MAX' + pct] = +(pr.max100 + i * pr.step).toFixed(2); });
    TIMING.MAX1 = pr.outer;
}
applyJudgeProfile('normal');
// % de um toque a `absDiff` ms do tempo certo (0 = fora da janela)
function judgePctFor(absDiff) {
    for (const pct of JUDGE_STEPS) if (absDiff <= TIMING['MAX' + pct]) return pct;
    return absDiff <= TIMING.MAX1 ? 1 : 0;
}
// Janelas de tolerância para soltar uma nota longa (hold) perto do fim dela
const HOLD_TIMING = { PERFECT: 60, OK: 180 };

// (Side Track agora é um overlay translúcido sobre as lanes principais, não uma lane própria —
// por isso ela julga na MESMA linha de julgamento das lanes principais, sem offset dedicado.)

// Única fonte de verdade para o BPM de cada padrão (evita generateNotes/togglePause/startPractice
// ficarem dessincronizados quando um padrão novo for adicionado)
const PATTERN_BPM = {
    staircase: 140,
    chordjack: 155,
    trill: 165,
    procedural_synth: 175,
    complex_staircase: 160,
    interleaved_chords: 155,
    fast_alt_doubles: 175,
    layered_jacks: 165,
    speedcore_stream: 220
};
function getBpmForPattern(patternType) {
    if (typeof patternType === 'string' && patternType.startsWith('custom:')) {
        const chart = findCustomChart(patternType.slice(7));
        return chart?.bpm || 150;
    }
    const drill = DRILLS[resolvePatternId(patternType)];
    return drill ? drill.bpm : (PATTERN_BPM[patternType] || 150);
}

// Trechos de BPM de um padrão/chart (chart custom pode ter mudanças de BPM — ver
// editorState.bpmChanges); tempos relativos ao início do chart (2000ms na timeline do jogo).
function getTempoSegmentsForPattern(patternType) {
    if (typeof patternType === 'string' && patternType.startsWith('custom:')) {
        const chart = findCustomChart(patternType.slice(7));
        return buildTempoSegments(chart?.bpm || 150, chart?.bpmChanges);
    }
    return buildTempoSegments(getBpmForPattern(patternType), null);
}

// Lead-in (silêncio antes da 1ª nota) de um chart CUSTOM tocado com backing procedural
// (click track) — dá um respiro pro jogador depois da contagem 3-2-1, igual aos padrões
// procedurais de sempre. Só existe timeline pra frente daqui (generateNotes desloca TODAS
// as notas por isso), então quem toca ÁUDIO REAL de um chart custom (startTrackForCurrentPattern)
// precisa saber desse mesmo valor pra agendar o início do áudio no instante certo — ver
// comentário ali. Compartilhado (em vez de duplicar "2000" nos dois lugares) de propósito:
// mudar um dos dois sem o outro é exatamente o tipo de bug que causou o delay relatado.
const CUSTOM_CHART_START_DELAY_MS = 2000;

// Tempo do chart (o das notas/julgamento) = tempo do áudio + offset de áudio (globalOffset).
// Então a posição em que a MÚSICA precisa estar pra um dado tempo do chart é o inverso disso.
function audioPosForChartTime(chartMs) {
    return chartMs - globalOffset * gameRate;
}

// Ponto único de decisão: toca a faixa importada (se o padrão selecionado for o MP3 do usuário
// e ele já tiver sido decodificado), o áudio original de um chart custom (se tiver sido salvo —
// ver preloadCustomChartAudioIfNeeded, chamado ANTES daqui pra já estar pronto neste ponto), a
// música procedural sintetizada, ou o backing simples (click track) pra chart custom sem áudio
// salvo (feito só na mão, ou salvo antes dessa função existir).
// `offsetMs` = posição da MÚSICA agora (0 = começo). Atenção: é a posição do ÁUDIO, que é o
// tempo do chart MENOS o offset de áudio (globalOffset) — ver audioPosForChartTime. Antes, a
// pausa/loop passavam o tempo do chart direto, e o offset de áudio "sumia" depois da 1ª pausa.
// Deriva entre o relógio do áudio e o da tela durante a música (alguns ms em músicas longas):
// o jogo vai "puxando" o startTime devagarinho pra as notas seguirem a música que está tocando.
let songClockRef = null;
function followAudioClock() {
    if (!isPlaying || isPaused || isCountingDown || isSongFinished) return;
    audio.sampleClock();
    if (audio._clk == null) return;
    if (!songClockRef) { songClockRef = { env0: audio._clk, applied: 0 }; return; } // relógio do áudio só ficou pronto agora
    const delta = (songClockRef.env0 - audio._clk) - songClockRef.applied;
    if (Math.abs(delta) < 0.4) return;
    const step = Math.max(-0.25, Math.min(0.25, delta)); // no máximo 0,25ms por quadro: imperceptível
    startTime += step;
    songClockRef.applied += step;
}

// Com a música do chart tocando pelo player de mídia (velocidade ≠ 100%), quem manda no
// tempo é a posição do player: o jogo vai acertando o relógio das notas pra bater com ela.
function followMediaClock() {
    const m = audio.customMedia;
    if (!m || !isPlaying || isPaused || isCountingDown || isSongFinished) return;
    const el = m.el;
    if (el.paused || el.readyState < 2) return;
    const nowP = performance.now();
    const t = el.currentTime;
    if (t !== m.lastT) { m.lastT = t; m.lastPerf = nowP; }
    const pos = (t + Math.min(0.1, (nowP - m.lastPerf) / 1000 * m.rate)) * 1000 - audio.getOutputLatencySec() * 1000 * m.rate;
    const expected = CUSTOM_CHART_START_DELAY_MS + pos + globalOffset * gameRate; // tempo do chart que está SOANDO agora
    const err = expected - chartTimeAt(nowP);
    m.err = m.err == null ? err : m.err * 0.85 + err * 0.15;
    if (Math.abs(err) > 120) { startTime -= err / gameRate; m.err = 0; return; } // começou agora / pulou: alinha de uma vez
    if (Math.abs(m.err) < 1) return;
    const step = Math.max(-1.5, Math.min(1.5, m.err * 0.2));
    startTime -= step / gameRate;
    m.err -= step;
}

function startTrackForCurrentPattern(offsetMs = 0) {
    if (audio.ctx) audio.sampleClock();
    songClockRef = audio._clk != null ? { env0: audio._clk, applied: 0 } : null;
    if (typeof currentPatternType === 'string' && currentPatternType.startsWith('custom:')) {
        const id = currentPatternType.slice(7);
        if (audio.customChartId === id && audio.customChartBuffer) {
            // As notas desse chart vivem numa timeline com +CUSTOM_CHART_START_DELAY_MS de
            // silêncio ANTES do que foi de fato gravado (ver generateNotes) — mas o buffer de
            // áudio real não tem esse silêncio, começa direto no que foi gravado. Sem isso, a
            // música tocava "no zero" (imediatamente) enquanto as notas só chegavam na linha
            // 2s depois — exatamente o atraso relatado. Se o offset pedido ainda está DENTRO
            // do lead-in (início do jogo, offsetMs=0), agenda o áudio pra começar só quando o
            // lead-in acabar (sample-accurate, sem jitter — mesma técnica do calibrador); se já
            // passou (seek/loop no meio da música), toca já, na posição equivalente do buffer real.
            const audioOffsetMs = offsetMs - CUSTOM_CHART_START_DELAY_MS;
            if (Math.abs(gameRate - 1) > 0.001) {
                // música mais lenta/rápida SEM mudar o tom: player de mídia + o jogo segue a posição dele
                audio.playCustomChartMedia(Math.max(0, audioOffsetMs) / 1000, Math.max(0, -audioOffsetMs) / 1000 / gameRate, gameRate);
            } else if (audioOffsetMs < 0) {
                audio.playCustomChartTrack(0, -audioOffsetMs / 1000);
            } else {
                audio.playCustomChartTrack(audioOffsetMs / 1000);
            }
        } else {
            const bpm = getBpmForPattern(currentPatternType);
            const chart = findCustomChart(id);
            audio.startProceduralMusic(bpm, 'custom', offsetMs, CUSTOM_CHART_START_DELAY_MS, chart ? chart.bpmChanges : null);
        }
    } else {
        const bpm = getBpmForPattern(currentPatternType);
        const drill = DRILLS[resolvePatternId(currentPatternType)];
        audio.startProceduralMusic(bpm, drill ? drill.music : currentPatternType, offsetMs, 2000);
    }
}

// Fim da música: o que acabar por ÚLTIMO entre a última nota (contando o FIM das holds e das
// Side Tracks — antes só via o começo da última nota da lista, e a música cortava no meio de
// uma hold) e, nos charts do editor com áudio, o fim do próprio áudio. Nos treinos, ainda dá um
// compasso de "respiro" depois da última nota pra música fechar.
function getSongEndChartMs() {
    let end = 0;
    for (const n of notes) end = Math.max(end, n.time, n.holdEnd || 0);
    if (typeof currentPatternType === 'string' && currentPatternType.startsWith('custom:')) {
        const id = currentPatternType.slice(7);
        const chart = findCustomChart(id);
        if (chart && typeof chart.songEndMs === 'number' && chart.songEndMs > 0) {
            // FIM DA MÚSICA marcado no editor: termina ali (a música some num fade curto), sem
            // esperar o silêncio que sobra no fim do arquivo — mas nunca antes da última nota
            return Math.max(end + 600, CUSTOM_CHART_START_DELAY_MS + chart.songEndMs + globalOffset * gameRate);
        }
        if (audio.customChartId === id && audio.customChartBuffer) {
            end = Math.max(end, CUSTOM_CHART_START_DELAY_MS + audio.customChartBuffer.duration * 1000 + globalOffset * gameRate);
        }
        return end + 600;
    }
    const segs = getTempoSegmentsForPattern(currentPatternType);
    const seg = tempoSegmentAt(segs, end - CUSTOM_CHART_START_DELAY_MS);
    return end + Math.max(800, seg.msPerBeat * 4);
}

// Abaixa o volume da música até sumir (em vez de cortar seco) e então para.
function fadeOutTrackForCurrentPattern(ms) {
    try {
        audio.musicFading = true;
        if (audio.ctx) {
            const t = audio.ctx.currentTime, sec = Math.max(0.05, ms / 1000);
            [audio.musicBus, audio.customChartGainNode].forEach(g => {
                if (!g) return;
                g.gain.cancelScheduledValues(t);
                g.gain.setValueAtTime(g.gain.value, t);
                g.gain.linearRampToValueAtTime(0.0001, t + sec);
            });
        }
    } catch (e) { /* segue */ }
    audio.stopProceduralMusic(); // não agenda mais nada novo; o que já tocou some no fade
    setTimeout(() => { if (isSongFinished) audio.stopCustomChartTrack(); }, ms + 50);
}

function stopTrackForCurrentPattern() {
    audio.stopProceduralMusic();
    audio.stopCustomChartTrack();
    audio.stopCustomChartMedia();
}

// IMPORTANTE sobre compatibilidade: os índices 0..(N-1) de cada modo abaixo que já
// existiam em versões anteriores NUNCA mudam de posição/significado — só acrescentamos
// índices NOVOS no final de cada array. Isso é o que mantém charts custom já salvos
// (que guardam número de lane cru) tocando do jeito que foram desenhados depois desta
// atualização. A ORDEM VISUAL (esquerda->direita na tela) é outra coisa, resolvida por
// getVisualOrder() — pode (e precisa) diferir da ordem do array pro 8B.
let KEY_CONFIGS = {
    // TRACK 1..4 (índices 0-3, como sempre) + SIDE TRACK L/R (novas, acrescentadas no fim)
    '4K': ['KeyD', 'KeyF', 'KeyJ', 'KeyK', 'ShiftLeft', 'ShiftRight'],
    // TRACK 1..5 (índices 0-4, como sempre) + SIDE TRACK L/R
    '5K': ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'ShiftLeft', 'ShiftRight'],
    // TRACK 1..6 (índices 0-5, como sempre) + SIDE TRACK L/R
    '6K': ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'ShiftLeft', 'ShiftRight'],
    // 8B = TRACK 1..6 (índices 0-5, igual ao núcleo do 6B) + TRACK L/R (índices 6-7) +
    // SIDE NOTE L/R (índices 8-9, NOVO) = 10 lanes lógicas no total. No 8B de verdade do
    // DJMAX Respect V existem as duas mecânicas ao mesmo tempo (confirmado com o usuário):
    // TRACK L/R (vermelho, alimentado pelo grave/kick, PODE coexistir com notas principais
    // — ver suppressMainNotesDuringSideNotes) e SIDE NOTE L/R (verde, a mesma mecânica que
    // já existia em 4K/5K/6K, suprime as principais enquanto ativa). Índices 8-9 são
    // ACRESCENTADOS NO FINAL do array (nunca reordena os já existentes 0-7), então charts
    // custom salvos antes desta atualização continuam tocando exatamente igual — ver
    // comentário no topo do arquivo sobre compatibilidade. As duas lanes extra desenham
    // por cima da MESMA área de meia tela (getSideOverlayRect) — nunca colidem porque
    // nunca ficam ativas ao mesmo tempo do mesmo lado (ver preventSameHalfOverlap).
    '8K': ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']
};
// Cópia dos padrões (antes de qualquer tecla salva ser carregada) — usada por "Restaurar padrão".
const DEFAULT_KEY_CONFIGS = JSON.parse(JSON.stringify(KEY_CONFIGS));
// TECLA EXTRA (opcional) por lane: a mesma lane com DUAS teclas — no 5B é o clássico da
// TRACK 3 com duas teclas (Espaço + V), alternando os dedões pra repetir a nota do meio
// bem rápido. Índice = lane lógica (igual ao KEY_CONFIGS); null/ausente = sem tecla extra.
let ALT_KEY_CONFIGS = { '4K': [], '5K': [null, null, 'KeyV'], '6K': [], '8K': [] };
const DEFAULT_ALT_KEY_CONFIGS = JSON.parse(JSON.stringify(ALT_KEY_CONFIGS));
let listeningAltIndex = null;
// lane da tecla (principal ou extra) no modo, ou -1
function laneForKey(mode, code) {
    const main = (KEY_CONFIGS[mode] || []).indexOf(code);
    if (main !== -1) return main;
    if (!code) return -1;
    return (ALT_KEY_CONFIGS[mode] || []).indexOf(code);
}
// teclas apertadas por lane (com 2 teclas na mesma lane, soltar uma enquanto a outra
// continua apertada NÃO solta a nota — dá pra trocar de dedo no meio de uma hold)
const heldKeysByLane = {};
// Modo cujas teclas estão sendo editadas nas Configurações (null = o modo atual do jogo).
let keybindEditMode = null;

// Cada gear skin tem sua própria paleta de cores de nota (não só a decoração de fundo).
// "edge" = colunas das pontas, "altA"/"altB" = colunas intermediárias, "center" = coluna
// central (5K).
// "side" (as side notes, em 4K/5K/6K) é sempre VERDE em todas as skins, e "trackLR"
// (TRACK L/R, exclusivas do 8B) é sempre VERMELHO — no DJMAX Respect V real essas cores
// de identidade não mudam com o skin da gear escolhido.
const SIDE_NOTE_COLOR = '#4ade80';
// 8B: 'djmax' = TRACK L/R como barras vermelhas por cima da pista · 'osu' = 8 colunas iguais
const LANE8_KEY = 'djmaxTrainerLane8_v1';
let lane8Style = 'djmax';
try { lane8Style = localStorage.getItem(LANE8_KEY) === 'osu' ? 'osu' : 'djmax'; } catch (e) {}
function setLane8Style(v) {
    lane8Style = v === 'osu' ? 'osu' : 'djmax';
    try { localStorage.setItem(LANE8_KEY, lane8Style); } catch (e) {}
    try { if (typeof glResetGearCache === 'function') glResetGearCache(); } catch (e) {}
    try { if (typeof setupControls === 'function') setupControls(); } catch (e) {}
}
// Vermelho mais intenso que o padrão do Tailwind (#ef4444) — o usuário reportou que ficava
// difícil de enxergar contra o fundo escuro das lanes, principalmente no flash rápido do
// toque simples (ver isTrackLRLane em render(), que agora sempre desenha essa lane em
// brilho "ativo" — preenchimento mais forte + brilho — em vez do brilho "de repouso" fraco).
const TRACK_LR_COLOR = '#ff1a1a';
const SKIN_PALETTES = {
    cyan:    { edge: '#06b6d4', altA: '#ec4899', altB: '#3b82f6', center: '#eab308', side: SIDE_NOTE_COLOR },
    crimson: { edge: '#ef4444', altA: '#f97316', altB: '#dc2626', center: '#facc15', side: SIDE_NOTE_COLOR },
    gold:    { edge: '#eab308', altA: '#f59e0b', altB: '#ca8a04', center: '#fde047', side: SIDE_NOTE_COLOR },
    sakura:  { edge: '#ec4899', altA: '#a855f7', altB: '#c026d3', center: '#f9a8d4', side: SIDE_NOTE_COLOR },
    chrome:  { edge: '#94a3b8', altA: '#38bdf8', altB: '#64748b', center: '#e2e8f0', side: SIDE_NOTE_COLOR },
    // Bônus: 2 gears novas, pedidas pelo usuário — mesma estrutura das outras (só paleta +
    // decoração de fundo em render(), ver gearSkin === 'matrix'/'void' mais abaixo).
    matrix:  { edge: '#22c55e', altA: '#4ade80', altB: '#16a34a', center: '#bef264', side: SIDE_NOTE_COLOR },
    void:    { edge: '#8b5cf6', altA: '#6366f1', altB: '#a78bfa', center: '#e9d5ff', side: SIDE_NOTE_COLOR }
};

function getKeyColorScheme(mode, skin) {
    const p = SKIN_PALETTES[skin] || SKIN_PALETTES.cyan;
    const schemes = {
        '4K': [p.edge, p.altA, p.altA, p.edge, SIDE_NOTE_COLOR, SIDE_NOTE_COLOR],
        '5K': [p.edge, p.altA, p.center, p.altA, p.edge, SIDE_NOTE_COLOR, SIDE_NOTE_COLOR],
        '6K': [p.edge, p.altB, p.altA, p.altA, p.altB, p.edge, SIDE_NOTE_COLOR, SIDE_NOTE_COLOR],
        // 6 principais (mesmo miolo do 6K) + TRACK L/R (vermelho) + SIDE NOTE L/R (verde)
        '8K': lane8Style === 'osu'
            ? [p.altB, p.altA, p.center, p.center, p.altA, p.altB, p.edge, p.edge, SIDE_NOTE_COLOR, SIDE_NOTE_COLOR]
            : [p.edge, p.altB, p.altA, p.altA, p.altB, p.edge, TRACK_LR_COLOR, TRACK_LR_COLOR, SIDE_NOTE_COLOR, SIDE_NOTE_COLOR]
    };
    return schemes[mode] || schemes['4K'];
}

// Quais "tipos" de lane extra (acrescentadas depois das TRACK 1..N principais) um modo
// tem, em ORDEM DE ÍNDICE no array de KEY_CONFIGS — cada tipo ocupa um PAR (L,R) de
// índices consecutivos. Hoje: SIDE TRACK (verde, suprime as principais enquanto ativa)
// em 4K/5K/6K/8K, e ADICIONALMENTE TRACK L/R (vermelho, pode coexistir com as principais)
// só no 8B, vindo ANTES do par de side note no array (índices 6-7 vs 8-9 — ver
// KEY_CONFIGS). Generalizado pra uma LISTA (em vez de um tipo só) porque o 8B de verdade
// tem as DUAS mecânicas ao mesmo tempo — getLaneKinds/getVisualOrder/getMainLaneCount
// abaixo lidam com quantos pares vierem aqui, não só com exatamente um.
function getExtraLaneKinds(mode) {
    // 8B em "8 COLUNAS": TRACK L/R viram lanes principais comuns (6 = ponta esquerda, 7 = direita)
    if (mode === '8K' && lane8Style === 'osu') return ['side'];
    return mode === '8K' ? ['trackLR', 'side'] : ['side'];
}
// 8 COLUNAS: ordem da esquerda pra direita das 8 principais (índices lógicos)
const LANE8_OSU_ORDER = [6, 0, 1, 2, 3, 4, 5, 7];

// Quantas das lanes de um modo são "principais" (TRACK 1..N, as que os padrões
// procedurais/detecção de áudio tratam como o esqueleto do chart) — as lanes extra (ver
// getExtraLaneKinds) ficam sempre DEPOIS dessas no array, 2 índices por tipo extra.
function getMainLaneCount(mode) {
    return KEY_CONFIGS[mode].length - getExtraLaneKinds(mode).length * 2;
}

// Tipo de cada lane POR ÍNDICE LÓGICO (a mesma indexação de KEY_CONFIGS/note.lane) —
// usado pra decidir largura visual e cor. Ver getVisualOrder() pra ordem esquerda->direita.
function getLaneKinds(mode) {
    const mainCount = getMainLaneCount(mode);
    const extraKinds = getExtraLaneKinds(mode);
    return [...Array(mainCount).fill('main'), ...extraKinds.flatMap(k => [k, k])];
}

// Ordem ESQUERDA->DIREITA na tela, como lista de índices lógicos. Cada par extra (ver
// getExtraLaneKinds) sempre aparece nas DUAS PONTAS visuais, aninhado por ordem do array:
// o PRIMEIRO tipo extra (TRACK L/R no 8B) fica mais junto das principais, os seguintes
// (SIDE NOTE) mais pra fora — em todo modo com só 1 tipo extra isso vira exatamente o
// comportamento de sempre (a única lane extra nas duas pontas).
function getVisualOrder(mode) {
    if (mode === '8K' && lane8Style === 'osu') return [8, ...LANE8_OSU_ORDER, 9];
    const mainCount = getMainLaneCount(mode);
    const extraKinds = getExtraLaneKinds(mode);
    const mains = Array.from({ length: mainCount }, (_, i) => i);
    const leftSide = [], rightSide = [];
    extraKinds.forEach((kind, i) => {
        const l = mainCount + i * 2, r = mainCount + i * 2 + 1;
        leftSide.unshift(l);
        rightSide.push(r);
    });
    return [...leftSide, ...mains, ...rightSide];
}

// Índices LÓGICOS (na ordem em que aparecem no array, não a ordem visual) de só as lanes
// "main" (TRACK N) — hoje sempre [0..mainCount-1] em todo modo (as mains vêm primeiro no
// array em todo mundo; a lane extra de cada modo, side ou TRACK L/R, sempre vem DEPOIS —
// ver KEY_CONFIGS). Mantido como função (em vez de inline) porque toda geração de padrão
// (staircase, âncora de grave, trilado, corrida de solo...) caminha por "posição
// 0,1,2..." entre as lanes principais e precisa converter pro índice LÓGICO por aqui.
function getMainLaneIndices(mode) {
    // os padrões dos treinos andam "posição 0,1,2..." da esquerda pra direita
    if (mode === '8K' && lane8Style === 'osu') return LANE8_OSU_ORDER.slice();
    const kinds = getLaneKinds(mode);
    const indices = [];
    kinds.forEach((k, i) => { if (k === 'main') indices.push(i); });
    return indices;
}

// Layout de colunas — usado SÓ pelo editor de chart (renderEditorTrackLabels,
// renderEditorCanvas, editorPointFromEvent): lá cada lane (inclusive side note) ainda
// aparece como uma coluna própria, porque é mais fácil clicar/editar nota por nota vendo
// cada lane separada. A side note tem o dobro da largura (2 colunas), só nessa visão de
// edição. NO JOGO EM SI a side note NÃO é uma coluna — ver getGameplayColumnLayout() logo
// abaixo, que é o que render()/createHitParticles() usam de verdade.
function getColumnLayoutForWidth(mode, totalWidth) {
    const kinds = getLaneKinds(mode);
    const order = getVisualOrder(mode);
    const weightOf = (kind) => (kind === 'main' ? 1 : 2);
    const totalWeight = kinds.reduce((sum, k) => sum + weightOf(k), 0);
    const unit = totalWidth / totalWeight;

    const columns = new Array(kinds.length);
    let x = 0;
    order.forEach(logicalIdx => {
        const kind = kinds[logicalIdx];
        const width = weightOf(kind) * unit;
        columns[logicalIdx] = { x, width, isSide: kind === 'side', isTrackLR: kind === 'trackLR' };
        x += width;
    });
    return columns;
}

function getColumnLayout(mode) {
    return getColumnLayoutForWidth(mode, canvas.logicalWidth);
}

// Índices lógicos (L, R) da lane extra de um TIPO específico num modo, ou null se esse
// modo não tem lane desse tipo. getSideLaneIndices/getTrackLRIndices abaixo são só essa
// função especializada pro tipo que cada uma procura — side note existe em TODO modo
// (4K/5K/6K/8K), TRACK L/R só no 8B, e no 8B AS DUAS existem ao mesmo tempo (ver
// getExtraLaneKinds) — escrita de forma genérica desde o início, então já funciona certo
// com mais de um tipo extra por modo sem precisar mudar nada aqui.
function getLaneIndicesOfKind(mode, kind) {
    const kinds = getLaneKinds(mode);
    const indices = [];
    kinds.forEach((k, i) => { if (k === kind) indices.push(i); });
    return indices.length === 2 ? indices : null;
}
function getSideLaneIndices(mode) {
    return getLaneIndicesOfKind(mode, 'side');
}
// Índices lógicos (L, R) do TRACK L/R num modo, ou null se o modo não tiver essa lane
// (hoje só o 8B tem — ver getExtraLaneKinds/KEY_CONFIGS).
function getTrackLRIndices(mode) {
    if (mode === '8K' && lane8Style === 'osu') return null; // 8 COLUNAS: TRACK L/R viram colunas normais
    return getLaneIndicesOfKind(mode, 'trackLR');
}

// Layout de colunas usado NO JOGO (render(), createHitParticles()): a lane extra (side
// note ou TRACK L/R) NÃO reserva coluna própria aqui — no DJMAX real ela não aumenta a
// largura da gear, é uma sobreposição translúcida desenhada por cima da metade
// esquerda/direita das lanes principais (ver drawOverlayLane() em render()). Por isso
// essa função só devolve coluna pras lanes "main" — os índices da lane extra ficam de
// propósito sem entrada aqui; quem for desenhar uma nota dela calcula o retângulo
// (metade da tela) na hora, com getSideOverlayRect().
function getGameplayColumnLayout(mode, totalWidth) {
    // 8B em "8 COLUNAS" (osu! 8K / EZ2ON): TRACK L (6) na ponta esquerda, as 6 principais no
    // meio e TRACK R (7) na ponta direita — 8 colunas iguais, sem as barras por cima da pista
    if (mode === '8K' && lane8Style === 'osu') {
        const u = totalWidth / 8, cols = new Array(8);
        for (let i = 0; i < 6; i++) cols[i] = { x: (i + 1) * u, width: u };
        cols[6] = { x: 0, width: u }; cols[7] = { x: 7 * u, width: u };
        return cols;
    }
    const mainCount = getMainLaneCount(mode);
    const unit = totalWidth / mainCount;
    const columns = new Array(mainCount);
    for (let i = 0; i < mainCount; i++) {
        columns[i] = { x: i * unit, width: unit };
    }
    return columns;
}

// Retângulo (metade esquerda ou direita da gear) que a lane extra (side note OU TRACK
// L/R — a matemática é a mesma pras duas, só muda a cor/rótulo de quem desenha) ocupa no jogo.
function getSideOverlayRect(totalWidth, isLeft) {
    const half = totalWidth / 2;
    return isLeft ? { x: 0, width: half } : { x: half, width: half };
}

// No DJMAX Respect V de verdade, os modos são chamados de "4B/5B/6B/8B" (Button), não
// "4K/5K/6K/8K" (Key) — mantemos as chaves internas '4K'/'5K'/'6K'/'8K' (usadas em
// KEY_CONFIGS, localStorage já salvo, charts custom, etc.) e só trocamos o texto exibido.
function getModeDisplayName(mode) {
    return (mode || '').replace('K', 'B');
}

// Nome de cada trilha (track) igual à tela de "INPUT SETTING" do jogo real: TRACK 1..N
// nas colunas principais, L/R SIDE TRACK nas colunas extra de SIDE NOTE (todo modo), e
// TRACK L / TRACK R nas colunas extra de TRACK L/R (só 8B). Descobre L ou R perguntando
// pra getLaneIndicesOfKind qual é o par (L,R) DAQUELE tipo específico — em vez de comparar
// com mainCount direto — porque com mais de um tipo extra por modo (8B: trackLR + side)
// cada tipo tem seu próprio par de índices, não necessariamente logo depois das mains.
function getTrackLabel(mode, laneIndex) {
    const kinds = getLaneKinds(mode);
    const kind = kinds[laneIndex];
    if (kind === 'main') return `TRACK ${laneIndex + 1}`;
    const pair = getLaneIndicesOfKind(mode, kind);
    const isLeft = !!pair && pair[0] === laneIndex;
    if (kind === 'side') return isLeft ? 'L SIDE TRACK' : 'R SIDE TRACK';
    if (kind === 'trackLR') return isLeft ? 'TRACK L' : 'TRACK R';
    return `TRACK ${laneIndex + 1}`;
}

let currentMode = '4K';
let currentPatternType = 'timing';
let currentDifficulty = 'HD';
// Nomes que aparecem na tela pra dificuldade dos TREINOS (o código interno continua NM/HD/MX/SC,
// pra não perder recordes/replays já salvos). Músicas/charts usam a dificuldade própria
// (dificuldade.js): EASY/NORMAL/HARD/EXPERT/MASTER + nível.
const DRILL_DIFF_LABEL = { NM: 'NORMAL', HD: 'HARD', MX: 'EXPERT', SC: 'MASTER' };
function drillDiffLabel(code) { return DRILL_DIFF_LABEL[code] || String(code || ''); }
function difficultyLabel(pattern) {
    pattern = pattern || currentPatternType;
    if (typeof pattern === 'string' && pattern.startsWith('custom:') && typeof chartDifficulty === 'function' && typeof findCustomChart === 'function') {
        const ch = findCustomChart(pattern.slice(7));
        if (ch) { const d = chartDifficulty(ch); return `${DIFF_BY_ID[d.tier].name} ${d.level}`; }
    }
    return drillDiffLabel(currentDifficulty);
}
let noteShape = 'djmax'; 
let gearSkin = 'respect'; 
let noFailMode = false;
let enableLongNotes = false;
// Padrão (false) = fiel ao DJMAX real: quando a SIDE TRACK aparece, ela vem "sozinha" —
// nenhuma nota normal cai nas lanes principais enquanto ela está ativa. Ligado = mantém o
// comportamento antigo (notas normais podem continuar caindo durante a SIDE TRACK).
let enhancedSideNotes = false;
let scrollSpeed = 3.0; // Velocidade (1.0x a 10.0x)
// Tamanho da "gear" (a nota em si — o feedback pedido foi "a gear está muito pequena"): antes
// era um valor fixo (NOTE_HEIGHT_BASE, 1.0x nessa escala) direto no código, sem opção nenhuma
// pra ajustar. Multiplicador aplicado em cima da base — 1.0 = tamanho antigo, o padrão agora
// é um pouco maior (1.3x) pra já sair mais legível sem precisar mexer em nada.
const noteSizeScale = 1.3; // tamanho FIXO da nota (o ajuste por slider foi removido — mais confuso do que útil)
// Visual da tela de JOGO: 'classic' (gear DJMAX reta, de cima pra baixo) ou 'highway' (Pista
// 3D em perspectiva, a mesma do editor, estilo Moonscraper/Guitar Hero). Só muda o DESENHO:
// notas, tempos, julgamento e teclas são exatamente os mesmos nos dois.
let gameView = 'classic';
// Renderizador da tela de jogo: 'webgl' (placa de vídeo, ver gl-renderer.js/game-gl.js) ou
// '2d' (Canvas 2D antigo, modo compatibilidade). O WebGL cai sozinho pro 2D se falhar.
let rendererPref = 'webgl';
let showFpsMeter = false;
let laneOpacityPct = 100;
// (legado) ajuste por visual: hoje é sempre o MESMO valor nos dois — ver getActiveJudgeOffset.
let judgeOffsetByView = { classic: 0, highway: 0 };
// Com os dois visuais desenhando as notas igual, o padrão é UM ajuste só valendo pros dois.
let judgeOffsetLinked = true;
// Ajuste extra da música do editor que está tocando agora (chart.judgeOffsetLocal) — o
// resultado de um chart ajusta SÓ ele, sem bagunçar o ajuste dos treinos.
let activeChartJudgeOffset = 0;
let hudShow = {};             // o que aparece na gear: { combo, judge, fastslow, rate, meter, hp, panel, title } (false = esconde)
let hudLayout = 'djmax';       // 'djmax' (igual ao jogo: combo no alto, julgamento logo acima da linha) ou 'center'
let autoFullscreen = false;     // entra em tela cheia no START e sai ao terminar/sair     // opacidade do corpo da pista (0..100) — com imagem de fundo, deixa ver atrás
let gearPosition = 'center';  // posição da gear na tela: left / center / right
let bgDimPct = 55;            // escurecimento da imagem de fundo (0..90)   // medidor de FPS / tempo de frame no canto da tela
let lowLatencyMode = false; // WebGL "desynchronized" (menos atraso de imagem; pode rasgar em alguns PCs)
// Usados só na hora de transformar uma skin em textura (WebGL): congela a animação do
// hexágono e deixa de fora a onda do Pulse Core (a GPU anima essas partes à parte).
let noteAnimClockOverride = null;
let noteAnimSkipPulseRing = false;
const NOTE_HEIGHT_BASE = 42;
let globalOffset = 0;
// AJUSTE DE JULGAMENTO (ms) — separado do offset de áudio de propósito. O globalOffset move
// as notas caindo E o julgamento JUNTOS (só alinha a música com o chart); pra quem joga olhando
// a nota chegar na linha, ele literalmente não muda nada — era o "mexo no offset e não muda
// nada" relatado. O que atrasa quem joga pelo visual é a latência da TELA + teclado (a nota
// aparece na linha alguns ms depois do instante real dela), e isso só se compensa deslocando
// SÓ o julgamento. Positivo = "eu aperto atrasado": desconta esse tanto de cada toque.
let judgeOffset = 0;
let randomMod = 'none';
let coverMod = 'none';
let speedMod = 'none';   // VELOCIDADE (CHAOS) — ver modificadores.js
let faderMod = 'none';   // FADER — ver modificadores.js
let isPlaying = false;
let isPaused = false;
let isCountingDown = false;
let isSongFinished = false;
let completionBannerText = "";
let countdownText = "";
let beatPulse = 0;
// Índice do último batida (beat) que já disparou o pulso visual — usado pra derivar o
// pulso diretamente do tempo decorrido + BPM (ver render()), em vez de depender só do
// callback da música procedural (setInterval), que nunca roda com áudio real (MP3
// importado ou chart custom com áudio salvo) — sem isso o efeito de pulso do BPM ficava
// invisível na maioria das partidas de verdade.
let lastPulseBeatIndex = -Infinity;
let startTime = 0;
// Velocidade da música no jogo (1 = normal; 0.8 = 80%...). O relógio do chart anda nessa
// velocidade; o julgamento continua em ms REAIS (MAX 100% = ±41,6ms de verdade em qualquer
// velocidade) e os ajustes de sincronia também (são atrasos do PC, em ms reais).
let gameRate = 1.0;
let pendingSection = null;  // { from, to } pedido pelo "Treinar este trecho"
let activeSection = null;
let sectionFullNotes = null;
function chartTimeAt(wallMs) { return (wallMs - startTime + globalOffset) * gameRate; }
// tempo do chart "do ponto de vista do julgamento" (desconta a sincronia do julgamento)
function judgeTimeAt(wallMs) { return (wallMs - startTime + globalOffset - getActiveJudgeOffset()) * gameRate; }
let pauseStartTime = 0;
let notes = [];
let keyState = [];
let keyLighting = [];
let activeHolds = []; // nota de hold em andamento por lane (ou null)
let hp = 100;
let totalPossibleScore = 0;
let currentEarnedScore = 0;
let gameCheckInterval = null;

// Loop de trecho: marca início/fim (em ms do tempo da música) para repetir um trecho automaticamente
let loopStart = null;
let loopEnd = null;
let loopEnabled = false;

// Calibrador automático de offset
let isCalibrating = false;

let stats = {
    score: 0, combo: 0, maxCombo: 0,
    judgments: { max100: 0, max90: 0, lower: 0, break: 0 },
    earlyHits: 0, lateHits: 0, hitOffsets: []
};

let lastJudgment = { text: '', color: '#ffffff', subText: '' };
let hitParticles = [];
let hitFlashes = []; // anéis de explosão no acerto, estilo DJMAX
let listeningKeyIndex = null;

// --- Controle de tempo do loop de render, independente de FPS ---
// Efeitos como partículas, flashes e o pulso de batida antes decaíam um valor fixo POR
// FRAME (ex: -0.05). Isso os fazia sumir rápido demais em monitores 144Hz+ e devagar
// demais a 30fps. Normalizamos tudo pelo delta real entre frames (dt = 1.0 equivale a
// um frame de 60fps) para que a duração real (em ms) dos efeitos seja sempre a mesma,
// não importa o refresh rate da tela.
let lastFrameTimestamp = null;
let hpDisplayed = 100; // HP "visual", suavizado — some por interpolação em vez de saltar
// VELOCIDADE = TEMPO que a nota fica na tela (do topo até a linha), não "pixels por ms"
// solto. Antes era scrollSpeed * 0.8 px/ms numa gear de 1080px de altura lógica: no 3.0 a
// nota atravessava a tela inteira em ~440ms (e no 5.0 em ~260ms) — rápido demais pro número
// mostrado, o "impossível de ver as notas" relatado. Agora: tempo na tela = 3000ms / speed
// (3.0 -> ~1000ms, 5.0 -> ~600ms, 10.0 -> ~300ms), e a conta usa a altura da tela de cada
// visual — jogo e Simulador do editor com a MESMA sensação pro mesmo número.
// (O 3.0 antigo equivale a ~6.9 nessa escala nova.)
const SPEED_TRAVEL_BASE_MS = 3000;
function noteTravelMsForSpeed(speed) {
    return SPEED_TRAVEL_BASE_MS / Math.max(0.1, speed || 3.0);
}
// travelPx = distância do limite de desenho (-50) até a linha de julgamento (altura - 80)
function speedFactorForTravel(speed, canvasHeight) {
    return (canvasHeight - 30) / noteTravelMsForSpeed(speed);
}
function gameSpeedFactorTarget() {
    return speedFactorForTravel(scrollSpeed, (typeof canvas !== 'undefined' && canvas && canvas.logicalHeight) || 1080);
}
let renderedSpeedFactor = 1080 / noteTravelMsForSpeed(3.0); // velocidade de scroll suavizada (evita "pulo" das notas ao mudar speed no meio da run)
let missShake = 0; // intensidade do "shake" de tela ao errar/quebrar hold, decai com o tempo

const canvas = document.getElementById('gameCanvas');
// 'let' (não const): o WebGL troca o ctx por um canvas escondido por um instante pra
// transformar skins/fundos em textura com as MESMAS funções de desenho (ver glGetSprite).
let ctx = canvas.getContext('2d');

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;

    // Resolução lógica FIXA, na proporção real da gear do DJMAX (520:1080) — todo o
    // desenho/hitbox do jogo usa essas coordenadas, independente do tamanho exibido.
    // O tamanho exibido em si é controlado pelo CSS (#gameCanvas { aspect-ratio: 520/1080 }),
    // então aqui só lemos de volta o tamanho real na tela (getBoundingClientRect) pra
    // dimensionar o buffer interno do canvas com nitidez em qualquer DPI.
    // Gear 3D usa uma tela larga (16:9) em vez da proporção alta da gear; o tamanho exibido
    // é calculado aqui (maior 16:9 que cabe no espaço) em vez de só pelo CSS.
    // Na Gear 3D a tela de jogo ocupa TODA a altura disponível (antes ficava presa em 16:9 e
    // sobrava faixa vazia embaixo/em cima): a resolução lógica tem sempre 720 de altura e a
    // largura acompanha a proporção real do espaço, então a pista fica mais comprida na
    // vertical mantendo a mesma largura de antes.
    if (gameView === 'highway_tilt') {
        const box = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
        const boxW = box && box.width ? box.width : 1280;
        const boxH = box && box.height ? box.height : 720;
        const aspect = Math.max(1.1, Math.min(21 / 9, boxW / boxH));
        let w = boxW, h = boxW / aspect;
        if (h > boxH) { h = boxH; w = h * aspect; }
        canvas.logicalHeight = 720;
        canvas.logicalWidth = Math.round(720 * aspect);
        canvas.style.aspectRatio = `${canvas.logicalWidth} / 720`;
        canvas.style.width = Math.max(320, Math.floor(w)) + 'px';
        canvas.style.height = Math.max(180, Math.floor(h)) + 'px';
    } else {
        canvas.logicalWidth = 520;
        canvas.logicalHeight = typeof gearProp === 'function' ? gearProp().H : 1080; // ver PROPORÇÃO DA GEAR (gear-themes.js)
        canvas.style.aspectRatio = '';
        canvas.style.width = '';
        canvas.style.height = '';
    }

    // Gears com moldura (ver gear-themes.js): a área das lanes continua 520x1080, e a moldura
    // acrescenta espaço em volta — o tamanho TOTAL desenhado fica em totalWidth/totalHeight.
    const gearL = typeof getGearLayout === 'function' ? getGearLayout() : null;
    canvas.totalWidth = gearL ? gearL.totalW : canvas.logicalWidth;
    canvas.totalHeight = gearL ? gearL.totalH : canvas.logicalHeight;
    if (gameView !== 'highway_tilt') {
        canvas.style.aspectRatio = `${canvas.totalWidth} / ${canvas.totalHeight}`;
    }
    applyGearPositionStyle();

    // Com o WebGL ligado, quem aparece na tela é o canvas #gameCanvasGL (o 2D fica escondido):
    // ele recebe o mesmo tamanho e é dele que se mede o tamanho real exibido.
    const glCanvasEl = typeof getVisibleGLCanvas === 'function' ? getVisibleGLCanvas() : null;
    if (glCanvasEl) {
        // Tamanho do canvas WebGL definido AQUI (não só no style.css): se o navegador estiver
        // com um style.css antigo guardado, sem a regra do #gameCanvasGL, ele caía no tamanho
        // padrão de canvas (300x150) e a gear aparecia esticada/achatada.
        if (gameView === 'highway_tilt') {
            glCanvasEl.style.aspectRatio = canvas.style.aspectRatio;
            glCanvasEl.style.width = canvas.style.width;
            glCanvasEl.style.height = canvas.style.height;
            glCanvasEl.style.maxHeight = '';
        } else {
            glCanvasEl.style.aspectRatio = `${canvas.totalWidth} / ${canvas.totalHeight}`;
            glCanvasEl.style.width = 'auto';
            glCanvasEl.style.height = '100%';
            glCanvasEl.style.maxHeight = '100vh';
        }
    }
    const rect = (glCanvasEl || canvas).getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (glCanvasEl) {
        if (glCanvasEl.width !== canvas.width) glCanvasEl.width = canvas.width;
        if (glCanvasEl.height !== canvas.height) glCanvasEl.height = canvas.height;
        onGLCanvasResized();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(canvas.width / canvas.totalWidth, canvas.height / canvas.totalHeight);
}

// Posição da gear na tela (opção do jogo original: esquerda / centro / direita)
function applyGearPositionStyle() {
    const box = document.getElementById('game-container');
    if (!box) return;
    box.style.justifyContent = gearPosition === 'left' ? 'flex-start' : gearPosition === 'right' ? 'flex-end' : 'center';
    box.style.paddingLeft = gearPosition === 'left' ? '4%' : '';
    box.style.paddingRight = gearPosition === 'right' ? '4%' : '';
}
window.addEventListener('resize', resizeCanvas);
// O espaço do jogo muda de tamanho sem 'resize' da janela (ex.: o cabeçalho some ao começar a
// prática) — acompanha o container direto pra o canvas nunca ficar esticado/borrado.
if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
    new ResizeObserver(() => resizeCanvas()).observe(canvas.parentElement);
}
resizeCanvas();

function isGameHighwayView() {
    return gameView === 'highway' || gameView === 'highway_tilt';
}

function viewKeyForJudge(view) { return view === 'classic' ? 'classic' : 'highway'; }
// SINCRONIA ÚNICA: um ajuste só pro PC inteiro (tela + teclado), igual a todas as músicas,
// gears, visuais e modos — como no DJMAX, onde a janela é fixa e a sincronia se acerta UMA vez.
// (Antes existiam ajustes por visual e por música do editor, e a tela de resultado oferecia
// mudar a cada partida — o que fazia o julgamento "andar" o tempo todo.)
function getActiveJudgeOffset() { return judgeOffset; }

function setGameView(view) {
    gameView = ['highway', 'highway_tilt'].includes(view) ? view : 'classic';
    if (typeof updateJudgeOffsetDisplay === 'function' && document.getElementById('judge-offset-val')) updateJudgeOffsetDisplay();
    resizeCanvas();
    renderedSpeedFactor = gameSpeedFactorTarget();
}

function updateSpeedDisplay() {
    scrollSpeed = Math.min(10.0, Math.max(1.0, parseFloat(scrollSpeed.toFixed(1))));
    document.getElementById('speed-val').innerText = scrollSpeed.toFixed(1);
    const travelEl = document.getElementById('speed-travel-ms');
    if (travelEl) travelEl.innerText = `~${Math.round(noteTravelMsForSpeed(scrollSpeed))}ms na tela`;
    document.getElementById('speed-slider').value = scrollSpeed;
    document.getElementById('hud-speed-val').innerText = `${scrollSpeed.toFixed(1)}x`;
}

function changeSpeed(delta) {
    scrollSpeed += delta;
    updateSpeedDisplay();
}




// ===================== TREINOS FIXOS =====================
// Cada treino é FIXO: mesma sequência toda vez (gerador com semente fixa por treino + modo +
// dificuldade), pra dar pra medir evolução de verdade. A dificuldade muda a densidade/forma,
// não sorteia outra coisa. Tudo é escrito em "passos" de 1/16 (16 por compasso), sempre em
// cima da grade do BPM do treino — nenhuma nota fora do tempo.
function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
// Aleatoriedade usada DENTRO da geração (holds automáticas, duração da side) — com semente
// durante generateNotes, pra o treino sair igual sempre; Math.random fora disso.
let drillRandom = Math.random;

const DIFF_LEVEL = { NM: 0, HD: 1, MX: 2, SC: 3 };

function makeDrillWriter() {
    const out = [];
    return {
        out,
        tap(step, pos, extra) { out.push({ step, pos, ghost: !!(extra && extra.ghost) }); },
        hold(step, pos, len) { out.push({ step, pos, len }); },
        side(step, isLeft, len) { out.push({ step, side: isLeft ? 'L' : 'R', len }); },
        // TRACK L/R (só existe no 8B — nos outros modos essas notas simplesmente não entram)
        track(step, isLeft) { out.push({ step, track: isLeft ? 'L' : 'R' }); }
    };
}
// 0,1,2,...,L-1,L-2,...,1,0,1,... (vai e volta pelas colunas)
function drillPingPong(i, L) {
    if (L <= 1) return 0;
    const cycle = L * 2 - 2;
    const k = ((i % cycle) + cycle) % cycle;
    return k < L ? k : cycle - k;
}
function drillHands(L) {
    const half = Math.floor(L / 2);
    const left = Array.from({ length: half }, (_, i) => i);
    const right = Array.from({ length: L - half }, (_, i) => half + i); // no 5B a coluna do meio fica com a direita
    return { left: left.length ? left : [0], right: right.length ? right : [L - 1] };
}

function genDrillTiming(w, L, d, m0, mc) {
    const blocks = [[4, 4, 4, 4, 4, 4, 4, 4], [4, 4, 2, 2, 4, 2, 2, 2], [2, 2, 1, 2, 2, 1, 1, 2], [2, 1, 1, 2, 1, 1, 1, 1]][d];
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const sub = blocks[Math.floor((m - m0) / 4) % blocks.length];
        for (let s = 0; s < 16; s += sub) w.tap(m * 16 + s, drillPingPong(k++, L));
    }
}
function genDrillStaircase(w, L, d, m0, mc) {
    const sub = [4, 2, 1, 1][d];
    const evensOdds = [...Array.from({ length: L }, (_, i) => i).filter(i => i % 2 === 0), ...Array.from({ length: L }, (_, i) => i).filter(i => i % 2 === 1)];
    for (let m = m0; m < m0 + mc; m++) {
        const up = (m - m0) % 2 === 0;
        const broken = d === 3 && Math.floor((m - m0) / 2) % 2 === 1;
        let idx = 0;
        for (let s = 0; s < 16; s += sub, idx++) {
            const i = idx % L;
            let pos = broken ? evensOdds[i] : i;
            if (!up) pos = L - 1 - pos;
            w.tap(m * 16 + s, pos);
        }
    }
}
function genDrillTrill(w, L, d, m0, mc) {
    const mid = Math.floor(L / 2);
    const raw = [[0, 1], [L - 2, L - 1], [0, L - 1], [1, L - 2], [mid - 1, mid]];
    const pairs = raw.filter(p => p[0] !== p[1] && p[0] >= 0 && p[1] < L);
    const sub = [4, 2, 1, 1][d];
    const every = d === 3 ? 1 : 2;
    for (let m = m0; m < m0 + mc; m++) {
        const pair = pairs[Math.floor((m - m0) / every) % pairs.length];
        let alt = 0;
        for (let s = 0; s < 16; s += sub) w.tap(m * 16 + s, pair[alt++ % 2]);
    }
}
function genDrillJacks(w, L, d, m0, mc) {
    const g = [2, 3, 4, 4][d];
    const sub = [4, 2, 2, 1][d];
    const rest = d <= 1;
    let lanePtr = 0, count = 0;
    const end = (m0 + mc) * 16;
    for (let step = m0 * 16; step < end; step += sub) {
        w.tap(step, drillPingPong(lanePtr, L));
        if (++count === g) { count = 0; lanePtr++; if (rest) step += sub; }
    }
}
function genDrillChords(w, L, d, m0, mc) {
    const mid = Math.floor(L / 2);
    const uniq = (arr) => arr.map(a => [...new Set(a)].filter(x => x >= 0 && x < L)).filter(a => a.length >= 2)
        .filter((a, i, all) => all.findIndex(b => b.join() === a.join()) === i);
    const s2 = uniq([[0, L - 1], [1, L - 2], [0, mid], [mid - 1, L - 1], [0, 1], [L - 2, L - 1]]);
    const s3 = L >= 3 ? uniq([[0, 1, L - 1], [0, L - 2, L - 1], [0, mid, L - 1], [1, mid, L - 2]]).filter(a => a.length >= 3) : s2;
    const s4 = L >= 4 ? [[0, 1, L - 2, L - 1]] : s3;
    const sub = [8, 4, 2, 2][d];
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        for (let s = 0; s < 16; s += sub, k++) {
            let shape;
            if (d === 0) shape = s2[k % 2];
            else if (d === 1) shape = s2[k % s2.length];
            else if (d === 2) shape = s % 4 === 0 ? s3[k % s3.length] : s2[k % s2.length];
            else shape = s % 8 === 0 ? s4[0] : (s % 4 === 0 ? s3[k % s3.length] : s2[k % s2.length]);
            shape.forEach(pos => w.tap(m * 16 + s, pos));
        }
    }
}
function genDrillIndependence(w, L, d, m0, mc) {
    const hands = drillHands(L);
    const subL = [4, 2, 2, 1][d];
    const masksR = [[0, 8], [4, 12], [0, 3, 6, 10, 12], [1, 3, 6, 9, 11, 14]][d];
    let kA = 0, kB = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const swap = Math.floor((m - m0) / 8) % 2 === 1;
        const steady = swap ? hands.right : hands.left;
        const rhythm = swap ? hands.left : hands.right;
        for (let s = 0; s < 16; s += subL) w.tap(m * 16 + s, steady[kA++ % steady.length]);
        masksR.forEach(s => w.tap(m * 16 + s, rhythm[kB++ % rhythm.length]));
    }
}
function genDrillOffbeat(w, L, d, m0, mc) {
    const masks = [[2, 6, 10, 14], [0, 3, 6, 8, 11, 14], [0, 3, 6, 8, 10, 11, 14], [1, 3, 4, 6, 7, 10, 12, 13, 15]][d];
    const ref = [0, 4, 8, 12];
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const mask = (m - m0) % 4 === 0 ? ref : masks; // 1 compasso de referência no tempo a cada 4
        mask.forEach(s => w.tap(m * 16 + s, drillPingPong(k++, L)));
    }
}
function genDrillHolds(w, L, d, m0, mc) {
    const hands = drillHands(L);
    const phaseMeasures = d === 3 ? 1 : 2;
    const holdLen = [8, 12, 28, 12][d];
    const holdEvery = d === 2 ? 32 : 16;
    const sub = [4, 2, 2, 1][d];
    let phase = 0, hk = 0, tk = 0;
    for (let m = m0; m < m0 + mc; m += phaseMeasures, phase++) {
        const holdHand = phase % 2 === 0 ? hands.left : hands.right;
        const tapHand = phase % 2 === 0 ? hands.right : hands.left;
        const p0 = m * 16, pEnd = Math.min(m0 + mc, m + phaseMeasures) * 16;
        for (let st = p0; st + 4 <= pEnd; st += holdEvery) {
            const len = Math.min(holdLen, pEnd - st - 4);
            if (len >= 4) w.hold(st, holdHand[hk++ % holdHand.length], len);
        }
        for (let st = p0; st < pEnd - 2; st += sub) w.tap(st, tapHand[tk++ % tapHand.length]);
    }
}
function genDrillSideTrack(w, L, d, m0, mc) {
    const sub = [4, 2, 2, 1][d];
    const sideLen = [16, 12, 12, 8][d];
    let k = 0, cycle = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const phase = (m - m0) % 4;
        if (phase === 2) {
            w.side(m * 16, cycle % 2 === 0, sideLen);
            cycle++;
            if (d >= 2) for (let s = sideLen + 2; s < 16; s += sub) w.tap(m * 16 + s, drillPingPong(k++, L));
            continue;
        }
        for (let s = 0; s < 16; s += sub) w.tap(m * 16 + s, drillPingPong(k++, L));
    }
}
function genDrillStream(w, L, d, m0, mc) {
    const sub = [4, 2, 1, 1][d];
    const kinds = ['up', 'down', 'trill', 'zigzag', 'rand'];
    let k = 0, last = -1;
    for (let m = m0; m < m0 + mc; m++) {
        const kind = kinds[Math.floor((m - m0) / 2) % kinds.length];
        for (let s = 0, i = 0; s < 16; s += sub, i++, k++) {
            let pos;
            if (kind === 'up') pos = i % L;
            else if (kind === 'down') pos = L - 1 - (i % L);
            else if (kind === 'trill') pos = i % 2 === 0 ? 0 : L - 1;
            else if (kind === 'zigzag') pos = [0, 2, 1, 3, 2, 4, 3, 5].map(v => v % L)[i % 8];
            else { do { pos = Math.floor(drillRandom() * L); } while (pos === last && L > 1); }
            w.tap(m * 16 + s, pos);
            if (d === 3 && s % 4 === 0) w.tap(m * 16 + s, (pos + Math.floor(L / 2)) % L);
            last = pos;
        }
    }
}
function genDrillMix(w, L, d, m0, mc) {
    const seq = [genDrillTiming, genDrillStaircase, genDrillTrill, genDrillChords, genDrillSideTrack, genDrillOffbeat, genDrillJacks, genDrillHolds, genDrillStream];
    let m = m0;
    for (const gen of seq) {
        if (m >= m0 + mc) break;
        const len = Math.min(4, m0 + mc - m);
        gen(w, L, d, m, len);
        m += len;
    }
}

// ===== Calibração (≈30s) =====
// Fase 1 (6 compassos): notas aparecendo, uma por tempo — mede o atraso de quem joga OLHANDO
// (vira o Ajuste de Julgamento). Fase 2 (6 compassos): as notas ficam INVISÍVEIS e só a música
// marca o tempo — mede o atraso do SOM. A diferença entre as duas fases vira o Offset de Áudio.
// Vale pra todos os modos, visuais e gears (o ajuste é um só).
const CALIB_VISIBLE_MEASURES = 6, CALIB_GHOST_MEASURES = 6;
function genDrillCalibrate(w, L, d, m0, mc) {
    let k = 0;
    for (let m = m0; m < m0 + CALIB_VISIBLE_MEASURES; m++) for (let s = 0; s < 16; s += 4) w.tap(m * 16 + s, drillPingPong(k++, L));
    // 1 compasso de respiro entre as fases (o aviso "SÓ OUVINDO" aparece)
    const g0 = m0 + CALIB_VISIBLE_MEASURES + 1;
    for (let m = g0; m < g0 + CALIB_GHOST_MEASURES; m++) for (let s = 0; s < 16; s += 4) w.tap(m * 16 + s, drillPingPong(k++, L), { ghost: true });
}

// ===== Treinos avançados =====
// Escada rápida: rolo contínuo subindo/descendo. NM 8ths, HD 16ths em escadas de ida e volta,
// MX 16ths sem parar, SC 16ths com escada "quebrada" e uma rajada de 32ths no fim de cada frase.
function genDrillFastStair(w, L, d, m0, mc) {
    const sub = [2, 1, 1, 1][d];
    const broken = [];
    for (let i = 0; i < L; i += 2) broken.push(i);
    for (let i = 1; i < L; i += 2) broken.push(i);
    let k = 0, last = -1;
    const put = (step, pos) => {
        if (pos === last) pos = (pos + 1) % L; // nunca repete a mesma tecla seguida numa escada
        w.tap(step, pos);
        last = pos;
    };
    for (let m = m0; m < m0 + mc; m++) {
        const rel = m - m0;
        const brokenBar = d === 3 && Math.floor(rel / 2) % 2 === 1;
        const burstBar = d === 3 && rel % 4 === 3;
        for (let s = 0; s < 16; s += sub) {
            if (burstBar && s >= 12) break;
            put(m * 16 + s, brokenBar ? broken[k % L] : drillPingPong(k, L));
            k++;
        }
        if (burstBar) for (let j = 0; j < 8; j++) put(m * 16 + 12 + j * 0.5, drillPingPong(k++, L));
    }
}
// Escada alternada: as mãos se revezam a cada nota (1-3-2-4 / 4-2-3-1 no 4B), com variações
// que mudam a cada 2 compassos.
function genDrillAltStair(w, L, d, m0, mc) {
    const { left, right } = drillHands(L);
    const n = Math.max(left.length, right.length);
    const seqs = [];
    const up = [], down = [];
    for (let i = 0; i < n; i++) { up.push(left[i % left.length]); up.push(right[i % right.length]); }
    for (let i = n - 1; i >= 0; i--) { down.push(right[i % right.length]); down.push(left[i % left.length]); }
    seqs.push(up, down);
    // "de fora pra dentro" e "de dentro pra fora"
    const outIn = [], inOut = [];
    for (let i = 0; i < n; i++) { outIn.push(left[i % left.length]); outIn.push(right[right.length - 1 - (i % right.length)]); }
    for (let i = n - 1; i >= 0; i--) { inOut.push(left[i % left.length]); inOut.push(right[right.length - 1 - (i % right.length)]); }
    seqs.push(outIn, inOut);
    const sub = [2, 2, 1, 1][d];
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const rel = m - m0;
        const seq = seqs[(d >= 2 ? Math.floor(rel / 2) : Math.floor(rel / 4)) % (d === 0 ? 2 : seqs.length)];
        for (let s = 0; s < 16; s += sub) {
            if (d === 3 && rel % 4 === 3 && (s === 6 || s === 14)) { k++; continue; } // respiro (síncope) no SC
            w.tap(m * 16 + s, seq[k++ % seq.length]);
        }
    }
}
// Duplas rápidas: duas notas juntas em sequência rápida, alternando os pares
// (pontas / miolo, mão esquerda / direita, "jumptrill"). MX mistura dupla + nota simples.
function genDrillFastDoubles(w, L, d, m0, mc) {
    const { left, right } = drillHands(L);
    const pairs = [];
    pairs.push([[left[0], right[0]], [left[left.length - 1], right[right.length - 1]]]);      // alternando dentro das mãos
    pairs.push([[left[0], left[left.length - 1]], [right[0], right[right.length - 1]]]);       // jumptrill (mão x mão)
    pairs.push([[0, L - 1], [left[left.length - 1], right[0]]]);                                // pontas x miolo
    const sub = [4, 2, 2, 1][d];
    for (let m = m0; m < m0 + mc; m++) {
        const rel = m - m0;
        const pr = pairs[Math.floor(rel / 2) % pairs.length];
        let k = 0;
        for (let s = 0; s < 16; s += sub, k++) {
            const pair = pr[k % 2];
            if (d === 2 && k % 2 === 1) {
                // MX: dupla + simples (jumpstream leve)
                w.tap(m * 16 + s, pair[k % 4 === 1 ? 0 : 1]);
            } else {
                pair.forEach(pos => w.tap(m * 16 + s, pos));
            }
        }
    }
}
// Tercinas: 3 notas por tempo (fora da grade de 16 avos) — treina sentir ritmo ternário.
// NM: tercinas de semínima; HD: de colcheia; MX: colcheia com escadas; SC: tercinas de
// semicolcheia em rajadas.
function genDrillTriplets(w, L, d, m0, mc) {
    const tri = [8 / 3, 4 / 3, 4 / 3, 2 / 3][d];
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const rel = m - m0;
        if (d === 3) {
            // 2 tempos de tercina de colcheia + 1 tempo de rajada de semicolcheia em tercina + 1 tempo de pausa/semínima
            for (let j = 0; j < 6; j++) w.tap(m * 16 + j * (4 / 3), drillPingPong(k++, L));
            for (let j = 0; j < 6; j++) w.tap(m * 16 + 8 + j * (2 / 3), drillPingPong(k++, L));
            w.tap(m * 16 + 12, drillPingPong(k++, L));
            continue;
        }
        const ref = rel % 4 === 0; // 1 compasso de referência em semínimas a cada 4
        if (ref) { for (let s = 0; s < 16; s += 4) w.tap(m * 16 + s, drillPingPong(k++, L)); continue; }
        for (let t = 0; t < 16 - 1e-6; t += tri) w.tap(m * 16 + t, d === 2 ? drillPingPong(k++, L) : (k++ % 2 === 0 ? drillHands(L).left[0] : drillHands(L).right[0]));
    }
}
// Rajadas: pulso de base (semínimas) com rajadas curtas de 3, 5 ou 7 notas rápidas em
// lugares diferentes do compasso — o "burst" típico dos charts do DJMAX.
function genDrillBursts(w, L, d, m0, mc) {
    const burstLen = [3, 3, 5, 7][d];
    const step = [1, 1, 1, 0.5][d];
    const starts = [8, 4, 10, 6, 12, 2];
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const rel = m - m0;
        const st = starts[rel % starts.length];
        const bEnd = st + burstLen * step;
        for (let s = 0; s < 16; s += 4) if (s < st - 1e-6 || s >= bEnd - 1e-6) w.tap(m * 16 + s, drillHands(L).left[(k++) % drillHands(L).left.length]);
        for (let j = 0; j < burstLen; j++) w.tap(m * 16 + st + j * step, drillPingPong(j + rel, L));
    }
}

const DRILL_BADGE_STYLES = {
    cyan: { badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', icon: 'from-cyan-500/30 text-cyan-300 border-cyan-500/30' },
    green: { badge: 'bg-green-500/20 text-green-400 border-green-500/30', icon: 'from-green-500/30 text-green-300 border-green-500/30' },
    pink: { badge: 'bg-pink-500/20 text-pink-400 border-pink-500/30', icon: 'from-pink-500/30 text-pink-300 border-pink-500/30' },
    amber: { badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: 'from-amber-500/30 text-amber-300 border-amber-500/30' },
    purple: { badge: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: 'from-purple-500/30 text-purple-300 border-purple-500/30' },
    blue: { badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: 'from-blue-500/30 text-blue-300 border-blue-500/30' },
    red: { badge: 'bg-red-600/30 text-red-300 border-red-500/40', icon: 'from-red-500/30 text-red-300 border-red-500/40' }
};


// ===== Treinos que usam TODOS os botões =====
// "Todos os Botões": apresenta e mistura cada tecla do modo — lanes principais, SIDE (holds,
// esquerda/direita/as duas) e, no 8B, TRACK L/R (o "grave" nas teclas Shift). Em blocos de 4
// compassos: varredura com o grave, side tracks, acordes com o grave do outro lado e o "giro
// completo" passando por todas as teclas em ordem (side L → track L → 1..N → track R → side R).
function genDrillAllKeys(w, L, d, m0, mc) {
    const sub = [4, 2, 2, 1][d];
    const { left, right } = drillHands(L);
    let k = 0;
    for (let b = m0; b < m0 + mc; b += 16) {
        const blk = (i) => b + i; // compasso relativo do bloco
        // B1: varredura (vai e volta) + grave alternando L/R
        for (let m = blk(0); m < Math.min(blk(4), m0 + mc); m++) {
            for (let st = 0; st < 16; st += sub) w.tap(m * 16 + st, drillPingPong(k++, L));
            [0, 8].forEach((st, i) => w.track(m * 16 + st, i === 0));
            if (d >= 2) [4, 12].forEach((st, i) => w.track(m * 16 + st, i === 0));
        }
        // B2: side tracks (esquerda, direita e, do MX pra cima, as duas juntas)
        for (let i = 0; i < 4 && blk(4 + i) < m0 + mc; i++) {
            const m = blk(4 + i), base = m * 16;
            const both = d >= 2 && i === 3;
            if (i % 2 === 0 || both) {
                if (both) { w.side(base, true, 8); w.side(base, false, 8); }
                else w.side(base, i === 0, 8);
                for (let st = 10; st < 16; st += Math.max(1, sub)) w.tap(base + st, drillPingPong(k++, L));
            } else {
                for (let st = 0; st < 16; st += sub) w.tap(base + st, drillPingPong(k++, L));
                w.track(base, i === 1); w.track(base + 8, i !== 1);
            }
        }
        // B3: acordes de uma mão + grave do outro lado
        for (let m = blk(8); m < Math.min(blk(12), m0 + mc); m++) {
            for (let st = 0; st < 16; st += (d >= 1 ? 4 : 8)) {
                const useLeft = (st / 4) % 2 === 0;
                const hand = useLeft ? left : right;
                const notes = d >= 2 ? hand : hand.slice(0, 2);
                notes.forEach(p => w.tap(m * 16 + st, p));
                w.track(m * 16 + st, !useLeft); // grave do lado da outra mão
                if (d >= 3) w.tap(m * 16 + st + 2, (useLeft ? right : left)[0]);
            }
        }
        // B4: giro completo por todas as teclas, 2 compassos cada
        for (let m = blk(12); m + 1 < Math.min(blk(16), m0 + mc) + 1 && m < m0 + mc; m += 2) {
            const base = m * 16;
            w.side(base, true, 6);
            w.track(base + 8, true);
            const st0 = base + 10, gap = d >= 2 ? 1 : 2;
            for (let i = 0; i < L; i++) w.tap(st0 + i * gap, i);
            const after = st0 + L * gap + 2;
            w.track(after, false);
            if (after + 2 + 6 <= base + 32) w.side(after + 2, false, 6);
        }
    }
}

// "TRACK 3 Turbo" (5B): repetição rápida na lane do MEIO — no 5B ela tem DUAS teclas
// (Espaço + V por padrão, ver Configurações → Teclas → "+ tecla extra"), e alternar os
// dedões é o que permite trechos bem rápidos. Nos outros modos vira jack nas lanes do meio.
function genDrillCenterJack(w, L, d, m0, mc) {
    const c = Math.floor(L / 2);
    const c2 = L % 2 === 0 ? c - 1 : c; // modos pares: alterna as duas do meio
    const nb = [Math.max(0, c2 - 1), Math.min(L - 1, c + 1)];
    let flip = 0;
    const C = () => (c === c2 ? c : (flip++ % 2 ? c : c2));
    const runLen = [2, 4, 6, 8][d];
    for (let m = m0; m < m0 + mc; m++) {
        const base = m * 16;
        const phase = Math.floor((m - m0) / 2) % 4;
        if (phase === 0) {
            // rajada no meio + vizinhos marcando o tempo
            for (let i = 0; i < runLen; i++) w.tap(base + i * (d === 0 ? 2 : 1), C());
            w.tap(base + 8, nb[0]); w.tap(base + 12, nb[1]);
            if (d >= 2) for (let i = 0; i < runLen / 2; i++) w.tap(base + 12 + i, C());
        } else if (phase === 1) {
            // meio intercalado com os vizinhos: C L C R
            const step = d === 0 ? 2 : 1;
            for (let st = 0, i = 0; st < 16; st += step, i++) w.tap(base + st, i % 2 === 0 ? C() : nb[(i >> 1) % 2]);
        } else if (phase === 2) {
            // stream comprido só no meio (o teste de verdade das duas teclas)
            const len = [4, 8, 12, 16][d];
            const step = d === 0 ? 2 : 1;
            for (let i = 0; i < len && i * step < 16; i++) w.tap(base + i * step, C());
        } else {
            // meio com acordes nas pontas a cada tempo
            for (let st = 0; st < 16; st += (d >= 2 ? 1 : 2)) {
                w.tap(base + st, C());
                if (st % 4 === 0) w.tap(base + st, st % 8 === 0 ? 0 : L - 1);
            }
        }
    }
}

// "Grave + Side (8B)": as 10 teclas do 8B juntas — o grave nas TRACK L/R (Shift) por baixo
// de escadas/trilos nas 6 lanes, Side Track (Ctrl) segurada de um lado enquanto o grave
// continua do OUTRO lado, e acordes com o grave.
function genDrillTrackBass(w, L, d, m0, mc) {
    const sub = [4, 2, 2, 1][d];
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const base = m * 16;
        const phase = Math.floor((m - m0) / 2) % 4;
        if (phase === 0) {
            // escada + grave nos tempos (L R L R)
            for (let st = 0; st < 16; st += sub) w.tap(base + st, drillPingPong(k++, L));
            for (let st = 0; st < 16; st += (d >= 2 ? 2 : 4)) w.track(base + st, (st / (d >= 2 ? 2 : 4)) % 2 === 0);
        } else if (phase === 1) {
            // side de um lado (Ctrl segurando) enquanto o grave toca do outro
            const leftSide = (m - m0) % 2 === 0;
            w.side(base, leftSide, 12);
            for (let st = 0; st < 16; st += (d >= 2 ? 2 : 4)) w.track(base + st, !leftSide);
        } else if (phase === 2) {
            // trilo de uma mão + grave
            const a = (m % 2) ? 1 : L - 2, b = (m % 2) ? 2 : L - 3;
            for (let st = 0, i = 0; st < 16; st += sub, i++) w.tap(base + st, i % 2 ? a : b);
            for (let st = 2; st < 16; st += 8) w.track(base + st, (m % 2) === 0);
        } else {
            // acordes com o grave junto (do MX: grave dobrado)
            for (let st = 0; st < 16; st += 4) {
                const shape = [[0, L - 1], [1, L - 2], [2, L - 3], [0, 2]][(st / 4) % 4];
                shape.forEach(p => w.tap(base + st, Math.max(0, Math.min(L - 1, p))));
                w.track(base + st, (st / 4) % 2 === 0);
                if (d >= 2) w.track(base + st + 2, (st / 4) % 2 !== 0);
            }
        }
    }
}

// ===== Treinos exclusivos do 8B (TRACK L/R = grave nos polegares) =====
// Grave Alternado: as mãos num pulso simples e os polegares alternando o grave em vários desenhos
function genDrillBassAlt(w, L, d, m0, mc) {
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const base = m * 16, phase = Math.floor((m - m0) / 4) % 4, last = (m - m0) % 4 === 3;
        const handSub = [8, 4, 4, 2][d];
        for (let st = 0; st < 16; st += handSub) w.tap(base + st, drillPingPong(k++, L));
        const bassSub = [4, 2, 2, 2][d];
        if (phase === 0) {            // L R L R
            for (let st = 0, i = 0; st < 16; st += bassSub, i++) w.track(base + st, i % 2 === 0);
        } else if (phase === 1) {     // L L R R
            for (let st = 0, i = 0; st < 16; st += bassSub, i++) w.track(base + st, Math.floor(i / 2) % 2 === 0);
        } else if (phase === 2) {     // L no tempo, R no contratempo
            for (let st = 0; st < 16; st += 4) { w.track(base + st, true); if (d >= 1) w.track(base + st + 2, false); }
        } else {                      // acordes nas mãos + grave dos dois lados
            for (let st = 0; st < 16; st += 8) { w.track(base + st, true); w.track(base + st, false); }
            for (let st = 4; st < 16; st += 8) w.track(base + st, st === 4);
        }
        // fim de frase: rolinho rápido L-R (MX/SC)
        if (last && d >= 2) for (let st = 12, i = 0; st < 16; st += (d >= 3 ? 1 : 2), i++) w.track(base + st, i % 2 === 0);
    }
}
// Contra-Grave: mãos no tempo, grave fora do tempo (e, do MX, o grave em 3-3-2)
function genDrillBassOffbeat(w, L, d, m0, mc) {
    const { left, right } = drillHands(L);
    let k = 0;
    for (let m = m0; m < m0 + mc; m++) {
        const base = m * 16, sync = d >= 2 && Math.floor((m - m0) / 4) % 2 === 1;
        const handSub = [4, 4, 2, 2][d];
        for (let st = 0; st < 16; st += handSub) {
            if (d >= 1 && st % 8 === 0) { w.tap(base + st, left[k % left.length]); w.tap(base + st, right[(k + 1) % right.length]); k++; }
            else w.tap(base + st, drillPingPong(k++, L));
        }
        if (sync) [0, 6, 12].forEach((st, i) => w.track(base + st + (d >= 3 && i === 2 ? 2 : 0), i % 2 === 0));
        else for (let st = 2, i = 0; st < 16; st += (d >= 3 ? 2 : 4), i++) w.track(base + st, i % 2 === 0);
    }
}
// Gear Completa: tudo do 8B em blocos de 2 compassos — escada com grave, Side de um lado e grave
// do outro, acorde "todas as teclas" e troca rápida Side <-> grave do mesmo lado
function genDrillFullGear(w, L, d, m0, mc) {
    const sub = [4, 2, 2, 1][d];
    let k = 0;
    for (let m = m0; m + 1 < m0 + mc + 1 && m < m0 + mc; m += 2) {
        const base = m * 16, blk = Math.floor((m - m0) / 2) % 4, two = m + 1 < m0 + mc;
        if (blk === 0) {
            for (let st = 0; st < (two ? 32 : 16); st += sub) w.tap(base + st, drillPingPong(k++, L));
            for (let st = 0, i = 0; st < (two ? 32 : 16); st += (d >= 2 ? 2 : 4), i++) w.track(base + st, i % 2 === 0);
        } else if (blk === 1) {
            const leftSide = (Math.floor((m - m0) / 8) % 2) === 0;
            w.side(base, leftSide, 12);
            for (let st = 0; st < 16; st += (d >= 2 ? 2 : 4)) w.track(base + st, !leftSide);
            if (two) {
                const hand = leftSide ? drillHands(L).right : drillHands(L).left;
                for (let st = 16, i = 0; st < 32; st += sub, i++) w.tap(base + st, hand[i % Math.min(2, hand.length)]);
                for (let st = 16; st < 32; st += 8) w.track(base + st, leftSide);
            }
        } else if (blk === 2) {
            const size = [2, 3, 4, L][d];
            for (let st = 0; st < (two ? 32 : 16); st += 8) {
                const big = st % 16 === 0;
                const shape = big ? Array.from({ length: Math.min(L, size) }, (_, i) => Math.round(i * (L - 1) / Math.max(1, Math.min(L, size) - 1))) : [k % L, (k + Math.floor(L / 2)) % L];
                shape.forEach(p => w.tap(base + st, p));
                if (big) { w.track(base + st, true); w.track(base + st, false); } else w.track(base + st, (st / 8) % 2 === 1);
                k++;
                if (d >= 1) w.tap(base + st + 4, drillPingPong(k++, L));
            }
        } else {
            // troca rápida: Side L -> grave L -> Side R -> grave R
            const len = d >= 2 ? 4 : 6;
            w.side(base, true, len); w.track(base + len + 2, true);
            w.side(base + 8, false, len); w.track(base + 8 + len + 2, false);
            if (two) {
                for (let st = 16; st < 32; st += sub) w.tap(base + st, drillPingPong(k++, L));
                [16, 24].forEach((st, i) => w.track(base + st, i === 0));
            }
        }
    }
}

// Grave (TRACK L/R) nos treinos que não escrevem o próprio: no 8B os polegares tocam um
// grave que acompanha a música, em vez de ficarem parados (antes esses treinos saíam iguais
// ao 6B). Fica só dentro do trecho que tem notas, e a densidade sobe com a dificuldade.
function addDrillBassLine(seq, trackIdx, level, firstStep, lastStep, msPerStep, startDelay) {
    if (!trackIdx || lastStep < firstStep) return;
    const m0 = Math.floor(firstStep / 16), m1 = Math.floor(lastStep / 16);
    const put = (step, left) => { if (step < firstStep || step > lastStep) return; seq.push({ time: startDelay + step * msPerStep, lane: left ? trackIdx[0] : trackIdx[1], holdEnd: null }); };
    let i = 0;
    for (let m = m0; m <= m1; m++) {
        const base = m * 16, rel = m - m0, phraseStart = rel % 4 === 0;
        const beats = level === 0 ? [0, 8] : [0, 4, 8, 12];
        beats.forEach(st => {
            if (phraseStart && st === 0 && level >= 1) { put(base, true); put(base, false); return; } // começo de frase: os dois juntos
            put(base + st, i++ % 2 === 0);
        });
        if (level >= 2 && rel % 2 === 1) put(base + 14, i++ % 2 === 0);              // anacruse antes do compasso
        if (level >= 3 && rel % 4 >= 2) [6, 10].forEach(st => put(base + st, i++ % 2 === 0)); // contratempos no SC
    }
}

const DRILLS = {
    calibrate: { pure: true, calibration: true, title: 'Calibração (30s)', icon: 'CAL', badge: 'AJUSTE', color: 'cyan', bpm: 110, music: 'custom', measures: 14, skill: 'Acerta o tempo de tudo', gen: genDrillCalibrate,
        desc: 'Música curta pra calibrar de uma vez: primeiro você toca OLHANDO as notas, depois só OUVINDO a batida (as notas somem). No fim o jogo já aplica o Ajuste de Julgamento e o Offset de Áudio pra todos os modos, visuais e gears.' },
    timing: { pure: true, title: 'Pulso no Tempo', icon: 'PT', badge: 'TIMING', color: 'cyan', bpm: 120, music: 'custom', skill: 'Precisão / calibrar', gen: genDrillTiming,
        desc: 'Uma nota de cada vez, certinho na batida, com metrônomo bem claro. O melhor treino pra achar seu Ajuste de Julgamento e firmar o ritmo.' },
    staircase: { pure: true, title: 'Escadinha', icon: 'ES', badge: 'ROLL', color: 'green', bpm: 140, music: 'staircase', skill: 'Fluidez', gen: genDrillStaircase,
        desc: 'Sobe e desce pelas colunas em sequência (1-2-3-4-3-2-1). Treina passar de dedo em dedo sem perder o tempo. No SC a escada vem "quebrada".' },
    trill: { pure: true, title: 'Trilo', icon: 'TR', badge: 'CONTROLE', color: 'pink', bpm: 150, music: 'trill', skill: 'Velocidade', gen: genDrillTrill,
        desc: 'Alternância rápida entre duas teclas, trocando o par a cada 2 compassos (vizinhas, pontas, miolo). Treina velocidade com controle.' },
    jacks: { pure: true, title: 'Jacks (mesma tecla)', icon: 'JK', badge: 'REPETIÇÃO', color: 'amber', bpm: 125, music: 'chordjack', skill: 'Repetição', gen: genDrillJacks,
        desc: 'A mesma tecla 2, 3 ou 4 vezes seguidas (conforme a dificuldade), andando pelas colunas. Treina repetir sem acelerar nem atrasar.' },
    chords: { pure: true, title: 'Acordes', icon: 'AC', badge: 'FORÇA', color: 'amber', bpm: 135, music: 'chordjack', skill: 'Notas juntas', gen: genDrillChords,
        desc: 'Duas, três e quatro notas juntas, com formas que mudam (pontas, miolo, lados). Treina apertar tudo no mesmo instante.' },
    independence: { pure: true, title: 'Independência de Mãos', icon: 'IM', badge: 'COORDENAÇÃO', color: 'purple', bpm: 128, music: 'staircase', skill: 'Coordenação', gen: genDrillIndependence,
        desc: 'Uma mão mantém uma batida fixa enquanto a outra toca um ritmo diferente. A cada 8 compassos as mãos trocam de papel.' },
    offbeat: { pure: true, title: 'Contratempo', icon: 'CT', badge: 'RITMO', color: 'blue', bpm: 118, music: 'trill', skill: 'Leitura de ritmo', gen: genDrillOffbeat,
        desc: 'Notas fora da batida (no "e" do tempo e síncopes 3-3-2), com um compasso de referência no tempo a cada 4. Treina ler e sentir o ritmo.' },
    holds: { title: 'Holds + Toques', icon: 'HD', badge: 'HOLD', color: 'purple', bpm: 120, music: 'custom', skill: 'Notas longas', gen: genDrillHolds, fixedHolds: true,
        desc: 'Uma mão segura notas longas enquanto a outra toca, e as mãos se revezam. Treina segurar e soltar no tempo certo.' },
    sidetrack: { title: 'Side Track', icon: 'SD', badge: 'SIDE', color: 'green', bpm: 130, music: 'staircase', skill: 'Teclas laterais', gen: genDrillSideTrack, ownSides: true,
        desc: 'Trechos normais intercalados com Side Track, alternando esquerda e direita. Treina sair e voltar das teclas laterais sem perder o ritmo.' },
    stream: { pure: true, title: 'Resistência (Stream)', icon: 'RS', badge: 'STAMINA', color: 'red', bpm: 170, music: 'speedcore_stream', measures: 40, skill: 'Fôlego', gen: genDrillStream,
        desc: 'Corrida contínua de notas por 40 compassos, alternando escadas, trilos e zigue-zagues. Treina fôlego e constância.' },
    fast_stair: { pure: true, title: 'Escada Rápida', icon: 'ER', badge: 'VELOCIDADE', color: 'green', bpm: 165, music: 'speedcore_stream', skill: 'Escada em alta velocidade', gen: genDrillFastStair,
        desc: 'Rolo contínuo subindo e descendo em semicolcheias rápidas. No SC a escada vem quebrada (ímpares/pares) e termina cada frase com uma rajada de fusas.' },
    alt_stair: { pure: true, title: 'Escada Alternada', icon: 'EA', badge: 'MÃOS', color: 'cyan', bpm: 155, music: 'trill', skill: 'Alternar as mãos', gen: genDrillAltStair,
        desc: 'Escada em que as mãos se revezam a cada nota (1-3-2-4, 4-2-3-1, de fora pra dentro...). Treina velocidade sem travar uma mão.' },
    fast_doubles: { pure: true, title: 'Duplas Rápidas', icon: 'DR', badge: 'DUPLAS', color: 'amber', bpm: 150, music: 'chordjack', skill: 'Notas duplas em sequência', gen: genDrillFastDoubles,
        desc: 'Duas notas juntas em sequência rápida, alternando os pares (dentro das mãos, mão contra mão, pontas x miolo). No MX vira dupla + simples.' },
    triplets: { pure: true, title: 'Tercinas', icon: '3T', badge: 'RITMO', color: 'blue', bpm: 128, music: 'custom', skill: 'Ritmo ternário', gen: genDrillTriplets,
        desc: 'Três notas por tempo (fora da grade normal), com um compasso de referência a cada 4. No SC tem rajadas de tercina de semicolcheia.' },
    bursts: { pure: true, title: 'Rajadas', icon: 'RJ', badge: 'BURST', color: 'red', bpm: 150, music: 'staircase', skill: 'Explosões curtas', gen: genDrillBursts,
        desc: 'Pulso firme numa mão e rajadas curtas de 3, 5 ou 7 notas rápidas aparecendo em lugares diferentes do compasso.' },
    allkeys: { pure: true, ownSides: true, fixedHolds: true, title: 'Todos os Botões', icon: 'TB', badge: 'GEAR', color: 'cyan', bpm: 120, music: 'staircase', skill: 'Cada tecla do modo', gen: genDrillAllKeys,
        desc: 'Passa por TODAS as teclas do modo: lanes, Side Track (esquerda, direita e as duas) e, no 8B, o grave nas TRACK L/R (Shift). Termina cada bloco com o "giro completo", tecla por tecla em ordem.' },
    center_jack: { pure: true, modes: ['5K'], title: 'TRACK 3 Turbo (5B)', icon: 'T3', badge: '5B', color: 'pink', bpm: 140, music: 'speedcore_stream', skill: 'Meio rápido com 2 teclas', gen: genDrillCenterJack,
        desc: 'Repetições rápidas na lane do meio, o diferencial do 5B. Use as DUAS teclas da TRACK 3 (Espaço + V, ou a que você escolher em Configurações → Teclas → "+ tecla extra") alternando os dedões.' },
    track_bass: { pure: true, ownSides: true, fixedHolds: true, modes: ['8K'], title: 'Grave + Side (8B)', icon: '8B', badge: '8B', color: 'red', bpm: 132, music: 'staircase', skill: 'As 10 teclas juntas', gen: genDrillTrackBass,
        desc: 'O 8B completo: grave nas TRACK L/R (Shift) por baixo de escadas e trilos, Side Track (Ctrl) segurada de um lado enquanto o grave continua do outro, e acordes com o grave.' },
    bass_alt: { pure: true, ownSides: true, fixedHolds: true, modes: ['8K'], title: 'Grave Alternado (8B)', icon: 'GA', badge: '8B', color: 'red', bpm: 130, music: 'staircase', skill: 'Polegares no grave', gen: genDrillBassAlt,
        desc: 'Os polegares fazem o grave nas TRACK L/R em vários desenhos (L-R-L-R, L-L-R-R, tempo e contratempo, os dois juntos) enquanto as mãos seguram um pulso simples. Do MX pra cima cada frase termina num rolinho rápido L-R.' },
    bass_offbeat: { pure: true, ownSides: true, fixedHolds: true, modes: ['8K'], title: 'Contra-Grave (8B)', icon: 'CG', badge: '8B', color: 'purple', bpm: 124, music: 'trill', skill: 'Grave fora do tempo', gen: genDrillBassOffbeat,
        desc: 'Mãos no tempo e grave no contratempo (o "e" de cada tempo). Do MX pra cima, metade das frases traz o grave em 3-3-2 contra as mãos. Treina não deixar o polegar "puxar" pro tempo.' },
    full_gear: { pure: true, ownSides: true, fixedHolds: true, modes: ['8K'], title: 'Gear Completa (8B)', icon: 'GC', badge: '8B', color: 'pink', bpm: 140, music: 'speedcore_stream', skill: 'Todas as 10 teclas', gen: genDrillFullGear,
        desc: 'Blocos de 2 compassos com tudo do 8B: escada com grave, Side de um lado e grave do outro, acorde com o grave dos dois lados (no SC, as 8 teclas juntas) e troca rápida Side → grave do mesmo lado.' },
    mix: { title: 'Desafio Misto', icon: 'DM', badge: 'DESAFIO', color: 'pink', bpm: 150, music: 'staircase', measures: 36, skill: 'Tudo junto', gen: genDrillMix, ownSides: true,
        desc: 'Um pouco de tudo em sequência, como um chart de verdade: pulso, escada, trilo, acordes, Side Track, contratempo, jacks, holds e stream.' }
};
// Nomes antigos (configurações salvas de versões anteriores) -> treino novo equivalente
const LEGACY_PATTERN_ALIASES = {
    chordjack: 'chords', procedural_synth: 'timing', complex_staircase: 'staircase', interleaved_chords: 'chords',
    fast_alt_doubles: 'trill', layered_jacks: 'jacks', speedcore_stream: 'stream'
};
function resolvePatternId(patternType) {
    if (typeof patternType !== 'string') return 'timing';
    if (patternType.startsWith('custom:')) return patternType;
    if (DRILLS[patternType]) return patternType;
    return LEGACY_PATTERN_ALIASES[patternType] || 'timing';
}

function renderDrillCards() {
    const grid = document.getElementById('pattern-grid');
    if (!grid) return;
    grid.querySelectorAll('.pattern-card[data-drill]').forEach(c => c.remove());
    const frag = document.createDocumentFragment();
    Object.entries(DRILLS).forEach(([id, dr]) => {
        const st = DRILL_BADGE_STYLES[dr.color] || DRILL_BADGE_STYLES.cyan;
        const card = document.createElement('div');
        card.className = 'pattern-card flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700 hover:border-cyan-400 cursor-pointer transition';
        card.dataset.drill = '1';
        card.dataset.pattern = id;
        card.dataset.title = dr.title;
        card.dataset.desc = dr.desc;
        card.dataset.bpm = String(dr.bpm);
        card.dataset.track = dr.skill;
        card.dataset.badge = dr.badge;
        card.dataset.badgeClass = st.badge;
        card.dataset.icon = dr.icon;
        card.dataset.iconClass = st.icon;
        card.innerHTML = `
            <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${st.icon} to-slate-800 flex items-center justify-center font-orbitron font-bold text-[11px] shrink-0 border">${dr.icon}</div>
            <div class="flex-1 min-w-0">
                <div class="font-orbitron font-bold text-sm ${dr.color === 'red' ? 'text-red-400' : 'text-white'} truncate">${escapeHtml(dr.title)}</div>
                <div class="text-[10px] text-slate-500 truncate font-mono">BPM ${dr.bpm} · ${escapeHtml(dr.skill)}</div>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold shrink-0 border ${st.badge}">${dr.badge}</span>`;
        frag.appendChild(card);
    });
    grid.insertBefore(frag, grid.firstChild);
}

function generateNotes(patternType, mode) {
    // fullLaneCount inclui as lanes extras (side notes em todos os modos, TRACK L/R só
    // no 8B) — usado pelo áudio importado e pelos charts custom, que podem ocupar
    // qualquer lane. Os padrões PROCEDURAIS abaixo usam só `laneCount` (= lanes
    // principais, sem as extras): eles nunca cicla(va)m pelas lanes extras como se
    // fossem mais uma coluna igual — essas são inseridas à parte, esporadicamente
    // (ver injectAccentLaneNotes), depois do laço principal.
    const fullLaneCount = KEY_CONFIGS[mode].length;
    const laneCount = getMainLaneCount(mode);

    // Padrão especial: chart feito à mão no editor de charts (posições exatas de nota/hold,
    // sem geração procedural nenhuma — é literalmente o que o usuário desenhou)
    if (patternType.startsWith('custom:')) {
        const chart = findCustomChart(patternType.slice(7));
        const START_DELAY_MS = CUSTOM_CHART_START_DELAY_MS;
        const laneSequence = (chart?.notes || [])
            .map(n => ({
                time: START_DELAY_MS + n.time,
                lane: Math.min(n.lane, fullLaneCount - 1),
                holdEnd: n.holdEnd != null ? START_DELAY_MS + n.holdEnd : null
            }))
            .sort((a, b) => a.time - b.time)
            // FIM DA MÚSICA marcado no editor: nota depois dele é sobra/engano — fica de fora
            .filter(n => !(chart && typeof chart.songEndMs === 'number' && chart.songEndMs > 0 && n.time > START_DELAY_MS + chart.songEndMs + 1));

        if (typeof applyLaneMods === 'function') applyLaneMods(laneSequence, mode);
        const holdCount = laneSequence.filter(n => n.holdEnd).length;
        totalPossibleScore = laneSequence.length * 100; // nota longa = UMA nota (Respect V 2.0)
        currentEarnedScore = 0;

        return laneSequence.map(n => ({
            time: n.time, lane: n.lane, hit: false, missed: false,
            holdEnd: n.holdEnd || null, holdActive: false, holdResolved: false, pointsEarned: 0
        }));
    }

    const drillId = resolvePatternId(patternType);
    const drill = DRILLS[drillId] || DRILLS.timing;
    const bpm = drill.bpm;
    const msPerStep = (60 / bpm / 4) * 1000;
    const measures = drill.measures || 32;
    const totalSteps = measures * 16;
    const START_DELAY_MS = 2000;
    const level = DIFF_LEVEL[currentDifficulty] ?? 1;

    // Semente fixa: o mesmo treino no mesmo modo/dificuldade sai SEMPRE igual
    drillRandom = mulberry32(hashString(`${drillId}|${mode}|${currentDifficulty}`));

    const writer = makeDrillWriter();
    drill.gen(writer, laneCount, level, 0, measures);
    const seen = new Set();
    let laneSequence = [];
    const sideEntries = [];
    const trackEntries = [];
    writer.out.forEach(e => {
        if (e.side) { sideEntries.push(e); return; }
        if (e.track) { trackEntries.push(e); return; }
        const key = `${e.step}|${e.pos}`;
        if (seen.has(key) || e.pos < 0 || e.pos >= laneCount) return;
        seen.add(key);
        const nt = {
            time: START_DELAY_MS + e.step * msPerStep,
            lane: e.pos,
            holdEnd: e.len ? START_DELAY_MS + (e.step + e.len) * msPerStep : null
        };
        if (e.ghost) nt.ghost = true; // nota invisível (fase "só ouvindo" da calibração)
        laneSequence.push(nt);
    });

    // (RANDOM/MIRROR agora é aplicado no fim, igual pra treinos e músicas — ver applyLaneMods)

    // Todo o laço acima (e o mirror/random logo ali em cima) trabalha em "posição entre as
    // mains" (0..laneCount-1) pra manter a matemática de cada padrão simples. Só agora, no
    // fim, converte pro índice LÓGICO de verdade (hoje sempre identidade — as mains são
    // sempre os primeiros índices do array em todo modo — mas passa por getMainLaneIndices
    // mesmo assim, caso isso mude no futuro).
    const mainIdx = getMainLaneIndices(mode);
    laneSequence.forEach(n => { n.lane = mainIdx[n.lane]; });

    // Side Track escrita pelo próprio treino (treino "Side Track" e "Desafio Misto")
    const sideIdxForDrill = getSideLaneIndices(mode);
    if (sideIdxForDrill) {
        sideEntries.forEach(e => laneSequence.push({
            time: START_DELAY_MS + e.step * msPerStep,
            lane: e.side === 'L' ? sideIdxForDrill[0] : sideIdxForDrill[1],
            holdEnd: e.len ? START_DELAY_MS + (e.step + e.len) * msPerStep : null
        }));
    }

    const trackIdxForDrill = getTrackLRIndices(mode);
    if (trackIdxForDrill) {
        const seenTrack = new Set();
        trackEntries.forEach(e => {
            const k = `${e.step}|${e.track}`;
            if (seenTrack.has(k)) return;
            seenTrack.add(k);
            laneSequence.push({ time: START_DELAY_MS + e.step * msPerStep, lane: e.track === 'L' ? trackIdxForDrill[0] : trackIdxForDrill[1], holdEnd: null });
        });
    }

    // 8B: treino que não escreve o próprio grave ganha um (antes ficava igual ao 6B)
    if (trackIdxForDrill && !trackEntries.length && !drill.calibration) {
        const steps = writer.out.filter(e => !e.side && !e.track && !e.ghost).map(e => e.step);
        if (steps.length) addDrillBassLine(laneSequence, trackIdxForDrill, level, Math.min(...steps), Math.max(...steps), msPerStep, START_DELAY_MS);
    }

    const totalDurationMs = START_DELAY_MS + totalSteps * msPerStep;
    // Treinos "puros" (técnica específica: escada, trilo, independência...) não ganham Side
    // Track nem holds sorteados — no Independência, holds curtinhas aleatórias na mão do pulso
    // viravam BREAK pra quem tocava o padrão certinho (parecia "julgamento quebrado").
    if (!drill.pure) {
        laneSequence = injectAccentLaneNotes(laneSequence, mode, currentDifficulty, totalDurationMs, START_DELAY_MS, bpm, { noSide: !!drill.ownSides });
        if (!drill.fixedHolds) laneSequence = applyLongNotes(laneSequence, msPerStep);
    }
    laneSequence = forceHoldForLanes(laneSequence, getSideLaneIndices(mode), 500, 1400);
    laneSequence = suppressMainNotesDuringSideNotes(laneSequence, mode);
    laneSequence = preventSameHalfOverlap(laneSequence, mode);

    drillRandom = Math.random;
    if (typeof applyLaneMods === 'function' && !drill.calibration) applyLaneMods(laneSequence, mode);
    laneSequence.sort((a, b) => a.time - b.time);

    const holdCount = laneSequence.filter(n => n.holdEnd).length;
    totalPossibleScore = laneSequence.length * 100; // nota longa conta como UMA nota (cabeça + soltura juntas), igual ao Respect V 2.0
    currentEarnedScore = 0;

    return laneSequence.map(n => ({
        time: n.time, lane: n.lane, hit: false, missed: false,
        holdEnd: n.holdEnd || null, holdActive: false, holdResolved: false, pointsEarned: 0,
        ...(n.ghost ? { ghost: true } : {})
    }));
}

// Insere, à parte do laço principal, as lanes "extras" nos padrões PROCEDURAIS: side
// note (todo modo, nas 2 pontas) e TRACK L/TRACK R (exclusivas do 8B). Padrão procedural
// não tem áudio real pra decidir "isolado" vs "corrida" como o áudio importado faz, então
// aqui é sempre esparso e periódico — side note de vez em quando (o efeito/sintetizador
// pontual do 8B real) e, só no 8B, um grave fixo alternando entre TRACK L/R.
function injectAccentLaneNotes(laneSequence, mode, difficulty, totalDurationMs, startDelayMs = 2000, bpm = null, opts = {}) {
    if (difficulty === 'NM') return laneSequence; // NM fica limpo, sem gimmick notes

    const sideIdx = getSideLaneIndices(mode);
    const trackIdx = getTrackLRIndices(mode);
    if (!sideIdx && !trackIdx) return laneSequence; // modo sem nenhuma lane extra

    if (sideIdx && !opts.noSide) {
        // Trecho esporádico (~a cada 7s), mas SEMPRE começando num início de compasso: antes
        // caía em qualquer instante (ex.: 6200ms num padrão de 140 BPM = ~21ms fora da batida),
        // e quem joga pelo som tomava MAX 90% nela sem ter errado nada.
        const measureMs = bpm ? (60000 / bpm) * 4 : 2000;
        const everyMeasures = Math.max(2, Math.round(7000 / measureMs));
        let sideToggle = 0;
        for (let m = Math.max(1, Math.round(everyMeasures * 0.6)); startDelayMs + m * measureMs < totalDurationMs; m += everyMeasures) {
            laneSequence.push({ time: startDelayMs + m * measureMs, lane: sideToggle % 2 === 0 ? sideIdx[0] : sideIdx[1] });
            sideToggle++;
        }
    }

    // TRACK L/R (só 8B): só injeta o pulso SINTÉTICO se a sequência ainda não tiver
    // nenhuma nota de TRACK L/R — evita duplicar caso algum chamador já tenha colocado
    // grave de verdade ali antes de chegar aqui.
    if (trackIdx) {
        const alreadyHasTrackLR = laneSequence.some(n => n.lane === trackIdx[0] || n.lane === trackIdx[1]);
        if (!alreadyHasTrackLR) {
            // Pulso a cada 2 tempos (meia nota) no BPM do padrão, simulando um grave/kick
            // constante alternando de lado — bem mais frequente que a side note, pra dar a
            // sensação de groove de baixo (o papel que o grave tem nos outros modos via
            // âncora/jack). Sem BPM disponível, cai num intervalo fixo razoável.
            const TRACK_LR_INTERVAL_MS = bpm ? (60000 / bpm) * 2 : 900;
            let trackToggle = 0;
            for (let t = startDelayMs + TRACK_LR_INTERVAL_MS * 0.5; t < totalDurationMs; t += TRACK_LR_INTERVAL_MS) {
                laneSequence.push({ time: t, lane: trackToggle % 2 === 0 ? trackIdx[0] : trackIdx[1] });
                trackToggle++;
            }
        }
    }

    return laneSequence.sort((a, b) => a.time - b.time);
}

// Converte algumas notas normais em notas longas (hold), quando há espaço suficiente
// até a próxima nota da mesma lane, pra nunca gerar sobreposição impossível de jogar
function applyLongNotes(laneSequence, msPerStep) {
    if (!enableLongNotes) return laneSequence;

    const byLane = {};
    laneSequence.forEach(n => {
        if (!byLane[n.lane]) byLane[n.lane] = [];
        byLane[n.lane].push(n);
    });

    Object.values(byLane).forEach(laneNotes => {
        laneNotes.sort((a, b) => a.time - b.time);
        for (let i = 0; i < laneNotes.length - 1; i++) {
            const gap = laneNotes[i + 1].time - laneNotes[i].time;
            const minGapForHold = msPerStep * 6;
            if (gap >= minGapForHold && drillRandom() < 0.18) {
                const holdDuration = Math.min(gap - msPerStep * 2, msPerStep * 12);
                if (holdDuration >= msPerStep * 4) { // nunca menor que 1 tempo (não confunde com toque)
                    laneNotes[i].holdEnd = laneNotes[i].time + holdDuration;
                }
            }
        }
    });

    return laneSequence;
}

// A side note SEMPRE é uma hold (o jogador segura a tecla dedicada enquanto a faixa
// translúcida estiver na tela) — nunca um toque simples. Isso vale mesmo com "hold notes"
// desligada nas opções (applyLongNotes não roda nesse caso) e mesmo quando applyLongNotes
// rodou mas não sorteou hold pra essa nota em particular (ela sorteia por chance, não é
// garantido). Chamar isso por último, depois de applyLongNotes, garante a hold sem
// depender de nenhuma dessas configurações/sorteios.
function forceHoldForLanes(laneSequence, laneIndices, minMs, maxMs) {
    if (!laneIndices || !laneIndices.length) return laneSequence;
    const idxSet = new Set(laneIndices);
    const byLane = {};
    laneSequence.forEach(n => {
        if (idxSet.has(n.lane)) (byLane[n.lane] = byLane[n.lane] || []).push(n);
    });
    Object.values(byLane).forEach(arr => {
        arr.sort((a, b) => a.time - b.time);
        arr.forEach((n, i) => {
            if (n.holdEnd != null && n.holdEnd > n.time) return; // já é uma hold válida
            const next = arr[i + 1];
            const maxAllowed = next ? Math.max(minMs, next.time - n.time - 60) : maxMs;
            const dur = Math.min(maxMs, maxAllowed, Math.max(minMs, minMs + drillRandom() * (maxMs - minMs)));
            n.holdEnd = n.time + dur;
        });
    });
    return laneSequence;
}

// No DJMAX real, quando a SIDE TRACK aparece ela costuma vir "sozinha": nenhuma nota
// normal toca junto enquanto ela está ativa (é um respiro isolado, não mais uma camada
// sobreposta às lanes principais). Chamada por último (depois de forceHoldForLanes, já
// com toda side note virada hold) em todos os 3 caminhos de geração automática — remove
// qualquer nota de lane PRINCIPAL cujo tempo caia dentro (com uma pequena folga) da janela
// [início, fim da hold] de alguma side note. Só roda quando "Enhanced Side Notes" está
// DESLIGADO nas configurações (o padrão) — ligado, mantém o comportamento antigo.
function suppressMainNotesDuringSideNotes(laneSequence, mode) {
    if (enhancedSideNotes) return laneSequence;
    const sideIdx = getSideLaneIndices(mode);
    if (!sideIdx) return laneSequence;
    const sideNotes = laneSequence.filter(n => n.lane === sideIdx[0] || n.lane === sideIdx[1]);
    if (!sideNotes.length) return laneSequence;
    const trackIdxS = getTrackLRIndices(mode);
    const BUFFER_MS = 120; // pequena folga antes/depois pra não deixar uma nota "colada" na borda
    return laneSequence.filter(n => {
        if (n.lane === sideIdx[0] || n.lane === sideIdx[1]) return true; // nunca remove a própria side note
        // TRACK L/R (8B) não some: do lado OPOSTO ela pode tocar junto com a side (o grave
        // continua); do mesmo lado quem resolve é preventSameHalfOverlap
        if (trackIdxS && (n.lane === trackIdxS[0] || n.lane === trackIdxS[1])) return true;
        // BUG corrigido: antes só comparava o INÍCIO da nota (n.time) com a janela da side
        // note. Uma hold normal que COMEÇA antes da side note mas cuja CAUDA (n.holdEnd)
        // se estende pra dentro da janela passava batido — por isso hold notes normais
        // ainda apareciam durante a SIDE TRACK mesmo com Enhanced Side Notes desligado.
        // Agora compara o INTERVALO inteiro da nota ([n.time, n.holdEnd ?? n.time]) contra
        // o intervalo inteiro de cada side note.
        const nStart = n.time;
        const nEnd = n.holdEnd ?? n.time;
        return !sideNotes.some(s => {
            const sStart = s.time - BUFFER_MS;
            const sEnd = (s.holdEnd ?? s.time) + BUFFER_MS;
            return nStart <= sEnd && nEnd >= sStart;
        });
    });
}

// Só importa em modos com MAIS DE UM tipo de lane extra ao mesmo tempo (hoje só o 8B:
// TRACK L/R + SIDE NOTE). As duas desenham a MESMA sobreposição de meia tela (ver
// getSideOverlayRect) — então, se calhassem de ficar ativas ao mesmo tempo NO MESMO LADO,
// ficariam desenhando uma por cima da outra na mesma área. Diferente de
// suppressMainNotesDuringSideNotes (que só roda com Enhanced Side Notes desligado, porque
// ali é uma escolha de dificuldade/"respiro"), esta aqui roda SEMPRE — não é uma questão
// de dificuldade, é as duas overlays literais disputando o mesmo desenho na tela. Só
// remove o lado do TRACK L/R que colidiria; a SIDE NOTE (mais rara e sempre virada hold
// por forceHoldForLanes) nunca é removida por aqui.
function preventSameHalfOverlap(laneSequence, mode) {
    const sideIdx = getSideLaneIndices(mode);
    const trackIdx = getTrackLRIndices(mode);
    if (!sideIdx || !trackIdx) return laneSequence; // precisa das DUAS lanes extra no modo
    const sideNotes = laneSequence.filter(n => n.lane === sideIdx[0] || n.lane === sideIdx[1]);
    if (!sideNotes.length) return laneSequence;
    const BUFFER_MS = 120;
    return laneSequence.filter(n => {
        if (n.lane !== trackIdx[0] && n.lane !== trackIdx[1]) return true; // só filtra TRACK L/R aqui
        const isLeft = n.lane === trackIdx[0];
        const nStart = n.time, nEnd = n.holdEnd ?? n.time;
        return !sideNotes.some(s => {
            if ((s.lane === sideIdx[0]) !== isLeft) return false; // lado diferente, sem colisão possível
            const sStart = s.time - BUFFER_MS;
            const sEnd = (s.holdEnd ?? s.time) + BUFFER_MS;
            return nStart <= sEnd && nEnd >= sStart;
        });
    });
}

// --- Importação de música ---
//
// A importação só decodifica o áudio — não existe mais geração automática de chart (nem
// heurística por frequência, nem IA/Demucs): testado com uma faixa real contra um chart
// feito à mão pra ela, a melhor versão heurística só acertava uns 40-56% das notas, e nem
// a separação por IA resolvia isso de verdade. A montagem da chart ficou 100% manual, no
// Chart Editor (desenhando na grade e/ou gravando ao vivo no modo Simulador). O único
// auxílio automático que sobrou é a detecção de BPM (ver detectBpmOnly, mais abaixo) — ela
// só sugere o andamento pro campo do editor, nunca inventa nota nenhuma.

function mixToMono(audioBuffer) {
    const { numberOfChannels, length } = audioBuffer;
    const mono = new Float32Array(length);
    for (let c = 0; c < numberOfChannels; c++) {
        const data = audioBuffer.getChannelData(c);
        for (let i = 0; i < length; i++) mono[i] += data[i] / numberOfChannels;
    }
    return mono;
}

// --- Espectrograma (usado só pra estimar BPM — ver detectBpmOnly, mais abaixo) ---
function fftMagnitude(real) {
    const n = real.length;
    const re = Float64Array.from(real);
    const im = new Float64Array(n);
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len;
        const wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curWr = 1, curWi = 0;
            for (let k = 0; k < len / 2; k++) {
                const ur = re[i + k], ui = im[i + k];
                const vr = re[i + k + len / 2] * curWr - im[i + k + len / 2] * curWi;
                const vi = re[i + k + len / 2] * curWi + im[i + k + len / 2] * curWr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
                const nwr = curWr * wr - curWi * wi;
                const nwi = curWr * wi + curWi * wr;
                curWr = nwr; curWi = nwi;
            }
        }
    }
    const mags = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) mags[k] = Math.hypot(re[k], im[k]);
    return mags;
}

// Cede o controle pro navegador pintar a tela/responder a eventos — usado pra fatiar o
// trabalho pesado do HPSS em pedaços, senão a aba fica "congelada" por vários segundos.
function yieldToUI() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// Espectrograma: FFT por bloco com janela de Hann e sobreposição (hop < blockSize).
// Cede o controle periodicamente pra não travar a aba (uma música de ~5min gera ~12mil
// frames, e isso sozinho pode levar 1-2s).
async function computeSpectrogramAsync(samples, blockSize, hop) {
    const win = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (blockSize - 1));
    const numFrames = Math.max(0, Math.floor((samples.length - blockSize) / hop) + 1);
    const numBins = blockSize / 2;
    const frames = new Array(numFrames);
    const frameBuf = new Float32Array(blockSize);
    const YIELD_EVERY = 1500;
    for (let f = 0; f < numFrames; f++) {
        const start = f * hop;
        for (let i = 0; i < blockSize; i++) frameBuf[i] = samples[start + i] * win[i];
        frames[f] = fftMagnitude(frameBuf);
        if (f > 0 && f % YIELD_EVERY === 0) await yieldToUI();
    }
    return { frames, numFrames, numBins };
}


// --- Estimativa de andamento (BPM) ---
//
// Só usada hoje pra sugerir o campo BPM do Chart Editor quando um áudio é importado (ver
// detectBpmOnly) — não detecta onset nem gera nota nenhuma. É feito em 3 passos clássicos
// de beat tracking: (1) função de novidade espectral por frame, (2) autocorrelação dessa
// função pra achar o PERÍODO da batida, (3) busca de fase pra achar em que instante o grid
// começa (útil se algum dia esse gridOffsetSec for usado pra alinhar o snap do editor).
function onsetStrengthEnvelope(frames, numBins) {
    const n = frames.length;
    const env = new Float32Array(n);
    for (let f = 1; f < n; f++) {
        let sum = 0;
        const cur = frames[f], prev = frames[f - 1];
        for (let k = 0; k < numBins; k++) {
            const d = cur[k] - prev[k];
            if (d > 0) sum += d; // meia-onda: só crescimento de energia conta como "novidade"
        }
        env[f] = sum;
    }
    return env;
}

// Se o andamento é constante, o envelope de novidade se repete a cada período de batida — a
// autocorrelação tem um pico exatamente nesse lag. Busca só na faixa de BPM plausível pra
// jogo de ritmo (70-200bpm cobre de balada a metal/speedcore rápido; andamentos mais rápidos
// que isso normalmente são "sentidos" como o dobro de um andamento mais lento dentro da faixa).
// Erro de OITAVA: o problema clássico de qualquer estimador de BPM por autocorrelação. Em
// gêneros com groove marcado de 2 em 2 tempos (muito comum em dubstep/drumstep/eletrônico —
// bumbo/baixo batendo forte só na "batida de trás", criando uma modulação de amplitude no
// envelope que se repete a cada 2 batidas, mais forte até que a repetição de 1 batida só),
// a autocorrelação prefere o lag do DOBRO do período real — metade do BPM verdadeiro.
// Validado com um chart de osu!mania de verdade pra uma faixa eletrônica densa: o candidato
// correto (147bpm) tinha só a 2ª/3ª maior pontuação bruta, atrás de exatamente a metade
// (73.8bpm). A correção clássica de MIR (usada por exemplo no beat tracker da librosa): um
// PRIOR log-normal no tempo, favorecendo BPMs "de música de verdade" (a maioria fica entre
// ~90-160bpm) sobre extremos — reponderar cada candidato por isso ANTES de escolher o
// melhor resolve a ambiguidade sem prejudicar faixas onde o candidato certo já era o mais
// forte (testado e confirmado com uma 2ª faixa real, que continuou dando o mesmo BPM de antes).
const TEMPO_PRIOR_CENTER_BPM = 120;
const TEMPO_PRIOR_SIGMA_OCTAVES = 0.6;
function tempoPriorWeight(bpm) {
    const octavesFromCenter = Math.log2(bpm / TEMPO_PRIOR_CENTER_BPM);
    return Math.exp(-0.5 * (octavesFromCenter / TEMPO_PRIOR_SIGMA_OCTAVES) ** 2);
}

function autocorrelateTempo(env, hopSec, minBpm = 70, maxBpm = 200) {
    const n = env.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += env[i];
    mean /= (n || 1);
    const centered = new Float32Array(n);
    for (let i = 0; i < n; i++) centered[i] = env[i] - mean;

    const minLag = Math.max(1, Math.round((60 / maxBpm) / hopSec));
    const maxLag = Math.max(minLag + 1, Math.round((60 / minBpm) / hopSec));
    const rawScores = new Map();
    let bestLag = minLag, bestWeightedScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i + lag < n; i++) sum += centered[i] * centered[i + lag];
        const norm = sum / (n - lag);
        rawScores.set(lag, norm);
        const weighted = norm * tempoPriorWeight(60 / (lag * hopSec));
        if (weighted > bestWeightedScore) { bestWeightedScore = weighted; bestLag = lag; }
    }

    // Interpolação parabólica em cima dos 3 pontos (lag-1, lag, lag+1) da pontuação BRUTA (a
    // ponderação do prior é só pra ESCOLHER qual pico seguir, não pra distorcer a forma do
    // pico em si) — refina o período pra além da resolução inteira de lag, que fica grosseira
    // bem no meio da faixa de BPM que mais importa pra jogo de ritmo (perto de 150-200bpm).
    let refinedLag = bestLag;
    const sPrev = rawScores.get(bestLag - 1), sCur = rawScores.get(bestLag), sNext = rawScores.get(bestLag + 1);
    if (sPrev != null && sNext != null) {
        const denom = (sPrev - 2 * sCur + sNext);
        if (Math.abs(denom) > 1e-9) {
            const delta = 0.5 * (sPrev - sNext) / denom;
            if (Math.abs(delta) < 1) refinedLag = bestLag + delta;
        }
    }

    return { bpm: 60 / (refinedLag * hopSec), lag: refinedLag };
}

// Com o PERÍODO já estimado, falta a FASE: em que instante exato começa o "tempo 1". Testa
// várias frações do período como offset inicial e fica com a que cai mais em cima da energia
// real (a fase certa tem os pulsos do grid alinhados com os picos do envelope de novidade).
function bestGridPhase(env, hopSec, periodSec, steps = 60) {
    const n = env.length;
    const periodFrames = periodSec / hopSec;
    let bestOffsetFrames = 0, bestScore = -Infinity;
    for (let s = 0; s < steps; s++) {
        const offsetFrames = (s / steps) * periodFrames;
        let sum = 0, count = 0;
        for (let f = offsetFrames; f < n; f += periodFrames) {
            const idx = Math.round(f);
            if (idx >= 0 && idx < n) { sum += env[idx]; count++; }
        }
        if (count > 0) {
            const score = sum / count;
            if (score > bestScore) { bestScore = score; bestOffsetFrames = offsetFrames; }
        }
    }
    return bestOffsetFrames * hopSec;
}

// Ponto único: espectrograma -> {bpm, gridOffsetSec}. Prototipado e validado com a faixa real
// do usuário antes de entrar em produção: achou um andamento plausível pro gênero (confirmado
// pelas próximas melhores pontuações da autocorrelação serem relacionadas por proporções
// musicais simples ao 1º lugar — sinal clássico de estimativa de BPM funcionando de verdade,
// não ruído), com boa concentração dos onsets reais perto do grid resultante.
function estimateTempoGrid(spec, hopSec) {
    const env = onsetStrengthEnvelope(spec.frames, spec.numBins);
    const { bpm, lag } = autocorrelateTempo(env, hopSec);
    const gridOffsetSec = bestGridPhase(env, hopSec, lag * hopSec);
    return { bpm, gridOffsetSec };
}

// Ponto único usado pelo Chart Editor (ver autoDetectEditorBpm): estima só o BPM de um
// áudio importado, sem detectar onset nem gerar nota nenhuma — é só um chute inicial pro
// campo BPM, que continua 100% editável à mão.
async function detectBpmOnly(audioBuffer, onProgress) {
    const sampleRate = audioBuffer.sampleRate;
    const mono = mixToMono(audioBuffer);
    const blockSize = 2048, hop = 1024;
    if (onProgress) onProgress('Calculando espectrograma do áudio...');
    const spec = await computeSpectrogramAsync(mono, blockSize, hop);
    const hopSec = hop / sampleRate;
    if (onProgress) onProgress('Estimando o andamento (BPM) da música...');
    return estimateTempoGrid(spec, hopSec);
}

// ============================================================================
// CHART EDITOR
// Permite desenhar notas manualmente numa grade piano-roll (lane x tempo),
// salvar localmente e jogar o resultado como qualquer outro padrão da tela
// inicial. Os DADOS do chart (tempo/lane/hold, texto pequeno) ficam no
// localStorage, como sempre. O ÁUDIO original importado no editor (pode ter
// alguns MB) fica no IndexedDB — ver bloco "ÁUDIO DOS CHARTS CUSTOM" logo
// abaixo — associado ao id do chart, pra tocar de verdade na hora de jogar,
// não só aqui dentro do editor. Um chart sem áudio salvo (feito só na mão,
// sem nunca importar um MP3, ou salvo antes dessa função existir) continua
// tocando com o backing procedural simples (click track) no BPM configurado.
// ============================================================================

const CUSTOM_CHARTS_KEY = 'djmaxCustomCharts_v1';
let customCharts = [];

// Os charts ficam no IndexedDB (banco "djmaxTrainerMedia", chave CHARTS_IDB_KEY): o
// localStorage tem só ~5 MB e enchia com os charts do osu!, aí NADA mais salvava (nem
// charts novos, nem skins). Versões antigas guardavam no localStorage — se ainda tiver lá
// (ou se acabou de vir de um backup), ele vale e é migrado pro IndexedDB.
const CHARTS_IDB_KEY = 'charts:' + CUSTOM_CHARTS_KEY;
let chartsSaveFailed = false;
async function loadCustomCharts() {
    let fromLs = null, fromIdb = null;
    try {
        const raw = localStorage.getItem(CUSTOM_CHARTS_KEY);
        if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) fromLs = p; }
    } catch (e) {}
    try { const v = await mediaGet(CHARTS_IDB_KEY); if (Array.isArray(v)) fromIdb = v; } catch (e) {}
    if (fromLs) {
        customCharts = fromLs;
        try {
            await mediaPut(CHARTS_IDB_KEY, fromLs);
            localStorage.removeItem(CUSTOM_CHARTS_KEY); // libera o espaço do localStorage
        } catch (e) { console.warn('[charts] migração pro IndexedDB falhou', e); }
    } else if (fromIdb) {
        customCharts = fromIdb;
    }
}

let chartsSaveChain = Promise.resolve();
function saveCustomCharts() {
    const snapshot = customCharts.slice();
    chartsSaveChain = chartsSaveChain.then(() => mediaPut(CHARTS_IDB_KEY, snapshot)).then(() => {
        chartsSaveFailed = false;
    }, (e) => {
        console.warn('[charts] não salvou', e);
        if (!chartsSaveFailed && typeof libToast === 'function') libToast('⚠️ Não consegui salvar a biblioteca de charts no navegador. Faça um Backup agora.');
        chartsSaveFailed = true;
    });
    return chartsSaveChain;
}

// ---- Áudio dos charts custom (IndexedDB) ----
// Guarda o ARQUIVO original (Blob comprimido — MP3/OGG/etc., não o AudioBuffer decodificado
// cru, que seria dezenas de MB pra uma música de 3-4min) associado ao id do chart. IndexedDB
// aguenta bem mais espaço que o limite de ~5-10MB do localStorage e guarda Blob nativamente
// (sem precisar converter pra base64, que já infla o tamanho em ~33%).
const CHART_AUDIO_DB_NAME = 'djmax-trainer-chart-audio';
const CHART_AUDIO_STORE = 'audio';
let chartAudioDbPromise = null;

function openChartAudioDb() {
    if (chartAudioDbPromise) return chartAudioDbPromise;
    chartAudioDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('IndexedDB não disponível neste navegador')); return; }
        const req = indexedDB.open(CHART_AUDIO_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(CHART_AUDIO_STORE)) {
                db.createObjectStore(CHART_AUDIO_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return chartAudioDbPromise;
}

function saveChartAudioBlob(id, blob, fileName) {
    return openChartAudioDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(CHART_AUDIO_STORE, 'readwrite');
        tx.objectStore(CHART_AUDIO_STORE).put({ id, blob, fileName, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

function loadChartAudioBlob(id) {
    return openChartAudioDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(CHART_AUDIO_STORE, 'readonly');
        const req = tx.objectStore(CHART_AUDIO_STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    }));
}

function deleteChartAudioBlob(id) {
    return openChartAudioDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(CHART_AUDIO_STORE, 'readwrite');
        tx.objectStore(CHART_AUDIO_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

// Ponto único usado antes de jogar um chart 'custom:<id>' de verdade (ver startPractice/
// startTrackForCurrentPattern): garante que audio.customChartBuffer esteja com o áudio
// certo carregado ANTES da contagem 3-2-1 terminar, pra música e notas nunca saírem
// dessincronizadas (ver comentário no chamador). Sem áudio salvo pra esse chart (ou
// qualquer erro no meio do caminho), simplesmente não faz nada — startTrackForCurrentPattern
// cai de volta pro click track de sempre, como já fazia antes dessa função existir.
async function preloadCustomChartAudioIfNeeded(patternType) {
    if (typeof patternType !== 'string' || !patternType.startsWith('custom:')) return;
    const id = patternType.slice(7);
    if (audio.customChartId === id && audio.customChartBuffer) return; // já carregado
    try {
        const row = await loadChartAudioBlob(id);
        if (!row || !row.blob) { audio.customChartBuffer = null; audio.customChartId = null; return; }
        audio.init();
        const arrayBuffer = await row.blob.arrayBuffer();
        audio.customChartBuffer = await audio.ctx.decodeAudioData(arrayBuffer);
        audio.customChartBlob = row.blob;
        audio.customChartId = id;
    } catch (e) {
        console.warn('Não foi possível carregar o áudio salvo desse chart custom:', e);
        audio.customChartBuffer = null;
        audio.customChartId = null;
    }
}

function findCustomChart(id) {
    return customCharts.find(c => c.id === id);
}

const NOTE_HEIGHT_PX = 10;

// Estado de trabalho do editor — completamente separado do estado da partida em si
let editorState = {
    id: null,               // null = chart novo, ainda não salvo
    title: 'Meu Chart',
    mode: '4K',
    bpm: 150,
    snap: 4,                // subdivisões por batida (1, 2, 4, 8, 16, ou 3/6 pra tercinas)
    duration: 90,           // segundos
    zoom: 70,               // pixels por segundo
    notes: [],              // { time (ms), lane, holdEnd (ms|null) }
    selectedIndex: -1,
    dragNote: null,         // referência à nota sendo criada/estendida (hold) no momento
    dragStartClientY: null, // Y (em pixel de tela, cru) de onde o arraste começou — ver
                             // EDITOR_HOLD_DRAG_DEADZONE_PX/handleEditorWindowMouseMove: só
                             // depois de passar essa "zona morta" que o arraste vira hold de
                             // verdade, pra um clique tremido não virar hold sem querer.
    clapEnabled: false,     // "Clap" de teste (inspirado no Moonscraper) — toca um som seco
                            // exatamente quando o playhead cruza cada nota durante o play, pra
                            // confirmar de ouvido se ela está mesmo em cima da batida.
    lastClapMs: 0,          // até onde já checamos claps nesta rodada de play — ver
                            // startEditorPlayback/stopEditorPlayback (zerado/realinhado a cada
                            // play novo, inclusive depois de um seek, pra nunca "metralhar"
                            // claps atrasados de notas já passadas antes do play começar).
    isRefAudioPlaying: false,
    audioBuffer: null,
    audioFileName: null,    // nome do arquivo importado, só pra identificação/log na separação por IA
    audioFileBlob: null,    // arquivo original (Blob comprimido) — o que de fato é salvo no IndexedDB, ver saveCurrentEditorChart
    audioLoadedFromSaved: false, // true quando audioBuffer veio do IndexedDB (chart reaberto), não de um import novo nesta sessão
    audioSourceNode: null,
    audioGainNode: null,
    playStartPerf: 0,
    playStartOffsetSec: 0,
    playbackRAF: null,
    simulatorMode: false,   // só o VISUAL (grade clássica vs. visual de jogo do Simulador) —
                             // não liga gravação sozinho, ver recordingArmed logo abaixo
    recordingArmed: false,  // armado pelo botão "Gravar com Teclas" — independente do visual
                             // escolhido acima: funciona tanto na grade clássica quanto no
                             // visual do Simulador (pedido do usuário: gravar por teclado
                             // também na grade clássica, não só no visual de jogo)
    isRecording: false,     // true só enquanto recordingArmed está armado E a música está tocando
    recordingHeld: {},       // lane -> { note, startMs } pra teclas ainda seguradas durante a gravação
    lastRecordedIndex: -1,   // índice da última nota criada na sessão de gravação atual (ver stopEditorPlayback)
    gamePausedMs: 0,         // posição pausada no Modo Simulador (que não tem scroll — ver getEditorElapsedMs)
    // Só pra deixar mais fácil de TESTAR (acompanhar a queda, reagir a tempo) — NÃO é salvo
    // no chart e não muda nenhuma nota gravada: getEditorElapsedMs() sempre devolve o tempo
    // REAL da música (ver comentário lá), só a velocidade que esse tempo avança no relógio
    // de parede é que muda. 1.0 = normal; valores < 1.0 tocam mais devagar (áudio e notas
    // caindo juntos, sem perder sincronia entre si).
    practiceSpeed: 1.0,
    cueMs: null,            // ponto de retorno (R): ao pausar, a leitura volta pra cá
    recordHolds: true,      // gravar com teclas cria holds (segurando ≥ meio tempo e ≥ 250ms)
    mediaEl: null, mediaPlaying: false,
    // Só a velocidade de QUEDA VISUAL das notas no visual do Simulador (renderEditorGameView)
    // — completamente separado de practiceSpeed/scrollSpeed: não toca no áudio, no BPM, nem em
    // nenhuma configuração de jogo real. Só deixa a queda mais lenta/rápida NA TELA aqui do
    // editor pra ajudar a mirar o clique; o chart salvo (n.time) nunca é tocado por isso.
    noteFallSpeedMultiplier: 1.0,
    timelineHeightPx: 400,   // altura TOTAL da timeline (duração x zoom) — o <canvas> real é pequeno
    canvasWindowTopPx: 0,    // e "flutua" dentro dela; ver resizeEditorCanvas/positionEditorCanvasWindow
    simKeyGlow: {},          // lane -> intensidade (0..1, decai a cada frame) do brilho de tecla
                             // pressionada no Modo Simulador (ver renderEditorGameView)
    // Multi-seleção pra copiar/colar várias notas de uma vez (ver toggleEditorNoteSelection/
    // selectEditorNotesInRect/copySelectedEditorNotes) — selectedIndex continua sendo "a nota
    // de destaque" de sempre (clique simples, arraste de hold), selectedIndices é o conjunto
    // extra marcado com Shift.
    selectedIndices: new Set(),
    marqueeStart: null,      // { lane, timeMs } de onde um arraste com Shift em área vazia começou
    marqueeCurrent: null,    // { lane, timeMs } atualizado a cada mousemove durante o arraste — usado só pra desenhar o retângulo
    clipboard: [],           // notas copiadas (tempo relativo à mais antiga do grupo) — ver colar
    // Marcações de tempo só pra se localizar no chart (ver toggleEditorPin) — nunca entram em
    // generateNotes/julgamento, é só uma bengala de navegação. Salva/carrega junto do chart
    // (ver saveCurrentEditorChart/loadChartIntoEditor) mas nunca afeta o jogo de verdade.
    pins: [],
    // Forma de onda do áudio (só referência visual pra mirar a nota no transiente certo — ver
    // computeEditorWaveformPeaks/renderEditorCanvas) — inspirada no WaveformDraw.cs do
    // Moonscraper. Recalculada sempre que o áudio muda; nunca salva no chart nem lida por
    // generateNotes()/julgamento do jogo real.
    waveformPeaks: null,     // Float32Array de picos (0..1) por bucket de tempo
    waveformBucketMs: 12,    // duração de cada bucket, em ms
    // Seções nomeadas (evolução dos pins — ver toggleEditorAddSection/renderEditorSectionsList)
    // inspiradas no Section.cs do Moonscraper: cada uma é só um NOME + um instante (o "fim" de
    // uma seção é implícito, é onde a próxima começa — igual em Moonscraper/Clone Hero). Só
    // apoio de navegação/estrutura, nunca afeta generateNotes()/julgamento nem é lido pelo jogo.
    sections: [],
    // MUDANÇAS DE BPM no meio da música (inspirado nos marcadores de BPM do Moonscraper):
    // [{ time (ms), bpm }]. O BPM "base" (campo BPM do topo) vale do 0 até a 1ª mudança; cada
    // mudança vale até a próxima. A grade/snap de cada trecho começa exatamente na mudança
    // (ver buildTempoSegments/snapEditorTime). Salvo no chart e usado no backing do jogo.
    bpmChanges: [],
    songEndMs: null,         // FIM DA MÚSICA marcado no editor (ms da timeline); null = automático
    // Ferramenta ativa da barra estilo Moonscraper (ver setEditorTool): 'select' (Seleção:
    // seleciona/move/marquee), 'tap' (só nota simples, nunca vira hold), 'note' (padrão, o
    // comportamento de sempre: clique = nota, arrastar = hold) e 'eraser' (Borracha).
    tool: 'note',
    moveDrag: null,          // arraste de mover notas no modo Seleção (ver handleEditorWindowMouseMove)
    eraserDragging: false,   // arrastando com a Borracha: apaga toda nota que passar embaixo
    hoverPoint: null,        // { lane, timeMs } do cursor sobre o canvas (fantasma na Gear 3D)
    // Visual "Gear 3D" (estilo Moonscraper) — é uma variação do visual do Simulador
    // (simulatorMode continua true junto, reaproveitando relógio/scroll/gravação dele), só
    // que desenhada em perspectiva e com TODAS as lanes (inclusive side) como colunas.
    highwayMode: false
};

// ===== Mapa de tempo (mudanças de BPM) — compartilhado entre editor e jogo =====
// Monta os trechos de BPM: [{ start, end, bpm, msPerBeat, measureStart }]. Cada mudança
// começa um compasso novo (a contagem de compasso "zera" nela), igual ao que se espera
// numa mudança de andamento.
function buildTempoSegments(baseBpm, changes) {
    const base = (isFinite(baseBpm) && baseBpm > 0) ? baseBpm : 150;
    const segs = [{ start: 0, bpm: base }];
    (Array.isArray(changes) ? changes : [])
        .filter(c => c && isFinite(c.time) && isFinite(c.bpm) && c.bpm > 0 && c.time >= 0)
        .slice()
        .sort((a, b) => a.time - b.time)
        .forEach(c => {
            const last = segs[segs.length - 1];
            if (c.time <= last.start + 0.5) last.bpm = c.bpm;
            else segs.push({ start: c.time, bpm: c.bpm });
        });
    let measure = 0;
    segs.forEach((seg, i) => {
        seg.msPerBeat = 60000 / seg.bpm;
        seg.end = i + 1 < segs.length ? segs[i + 1].start : Infinity;
        seg.measureStart = measure;
        seg.index = i;
        if (isFinite(seg.end)) measure += Math.max(1, Math.ceil((seg.end - seg.start) / seg.msPerBeat / 4 - 1e-6));
    });
    return segs;
}

// Normaliza uma lista de mudanças de BPM vinda de chart salvo/importado/autosave.
function sanitizeBpmChanges(list) {
    return (Array.isArray(list) ? list : [])
        .filter(c => c && typeof c.time === 'number' && typeof c.bpm === 'number' && isFinite(c.time) && isFinite(c.bpm) && c.bpm > 0 && c.time > 0)
        .map(c => ({ time: Math.round(c.time), bpm: Math.round(c.bpm * 100) / 100 }))
        .sort((a, b) => a.time - b.time);
}

function tempoSegmentAt(segs, t) {
    for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start) return segs[i];
    return segs[0];
}

function getEditorTempoSegments() {
    return buildTempoSegments(editorState.bpm, editorState.bpmChanges);
}
function editorBpmAt(timeMs) {
    return tempoSegmentAt(getEditorTempoSegments(), timeMs).bpm;
}
// Tamanho de UM passo da grade (snap) no trecho de BPM em que timeMs cai.
function editorSnapMsAt(timeMs) {
    return 60000 / editorBpmAt(timeMs) / editorState.snap;
}

// Chama cb(t, isBeat, isMeasure, measureNumber) pra cada linha da grade entre t0 e t1,
// respeitando as mudanças de BPM (cada trecho tem a sua grade, começando na mudança).
function forEachEditorGridLine(t0, t1, cb) {
    const snap = editorState.snap;
    const segs = getEditorTempoSegments();
    let guard = 0;
    for (const seg of segs) {
        if (seg.end < t0 || seg.start > t1) continue;
        const stepMs = seg.msPerBeat / snap;
        if (!(stepMs > 0)) continue;
        let k = Math.max(0, Math.ceil((Math.max(t0, seg.start) - seg.start) / stepMs - 1e-6));
        for (;; k++) {
            const t = seg.start + k * stepMs;
            if (t > t1 || t >= seg.end - 0.5 || guard++ > 40000) break;
            const beatLocal = k / snap;
            const beatInt = Math.round(beatLocal);
            const isBeat = Math.abs(beatLocal - beatInt) < 1e-6;
            const isMeasure = isBeat && beatInt % 4 === 0;
            cb(t, isBeat, isMeasure, seg.measureStart + Math.floor(beatInt / 4) + 1);
        }
    }
}

// "Compasso 3 · tempo 2.50" pra um instante (usado no painel de propriedades).
function describeEditorBeatPosition(timeMs) {
    const seg = tempoSegmentAt(getEditorTempoSegments(), timeMs);
    const local = Math.max(0, (timeMs - seg.start) / seg.msPerBeat);
    const measure = seg.measureStart + Math.floor(local / 4 + 1e-6) + 1;
    const beat = (local % 4) + 1;
    return `Compasso ${measure} · tempo ${beat.toFixed(2).replace(/\.00$/, '')}`;
}

function formatEditorTime(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function currentEditorAudioStatusText() {
    if (editorState.audioBuffer) {
        const dur = formatEditorTime(editorState.audioBuffer.duration * 1000);
        return `🎵 áudio carregado (${dur}) — toca aqui no editor pra te ajudar a posicionar as notas, e é salvo junto com o chart (toca de verdade também na hora de jogar)`;
    }
    return 'Importe um áudio pra montar a chart manualmente (o BPM é sugerido automaticamente) — o áudio é salvo junto com o chart e toca de verdade na hora de jogar';
}

// Desarma o modo simulador (usado ao trocar de chart, fechar o editor, ou parar a
// reprodução) — nunca deixa uma tecla "presa" de uma sessão de gravação anterior.
function resetEditorSimulatorState() {
    editorState.simulatorMode = false;
    editorState.recordingArmed = false;
    editorState.isRecording = false;
    editorState.recordingHeld = {};
    editorState.lastRecordedIndex = -1;
    editorState.gamePausedMs = 0;
    editorState.simKeyGlow = {};
    updateEditorSimulatorUI();
}

function setEditorAudioStatus(text) {
    const el = document.getElementById('editor-audio-status');
    if (el) el.textContent = text;
}

// Pré-calcula os picos do áudio em buckets de tempo fixo (waveformBucketMs), pra desenhar a
// forma de onda de fundo na grade clássica (ver renderEditorCanvas) sem precisar reprocessar
// o AudioBuffer inteiro a cada frame/scroll — só quando o áudio muda de verdade (import novo
// ou carregado do chart salvo). Inspirado no WaveformDraw.cs do Moonscraper (lá o pico de
// cada ponto vem de uma leitura em stream via SampleData; aqui, como o áudio já está inteiro
// decodificado em memória — AudioBuffer —, é mais simples só varrer e guardar o pico (valor
// absoluto máximo) de cada bucket uma vez só). É só uma referência VISUAL pra mirar a nota no
// transiente certo; nunca é salvo no chart nem lido por generateNotes()/julgamento do jogo real.
function computeEditorWaveformPeaks() {
    const buffer = editorState.audioBuffer;
    if (!buffer) { editorState.waveformPeaks = null; return; }
    try {
        const bucketMs = editorState.waveformBucketMs;
        const samplesPerBucket = Math.max(1, Math.round(buffer.sampleRate * bucketMs / 1000));
        const totalBuckets = Math.max(1, Math.ceil(buffer.length / samplesPerBucket));
        const peaks = new Float32Array(totalBuckets);
        const channels = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));

        for (let b = 0; b < totalBuckets; b++) {
            const start = b * samplesPerBucket;
            const end = Math.min(buffer.length, start + samplesPerBucket);
            let peak = 0;
            // Amostra com passo maior que 1 em buckets grandes (áudio com sampleRate alto) —
            // ~300 amostras por bucket já dão uma leitura de pico estável visualmente, sem
            // precisar varrer amostra por amostra numa música de vários minutos.
            const step = Math.max(1, Math.floor((end - start) / 300));
            for (let i = start; i < end; i += step) {
                for (let c = 0; c < channels.length; c++) {
                    const v = Math.abs(channels[c][i]);
                    if (v > peak) peak = v;
                }
            }
            peaks[b] = peak;
        }
        editorState.waveformPeaks = peaks;
    } catch (e) {
        console.warn('Não foi possível gerar a forma de onda do áudio (só afeta o visual, o áudio continua funcionando normalmente):', e);
        editorState.waveformPeaks = null;
    }
}

function flashEditorStatus(msg) {
    setEditorAudioStatus(msg);
    setTimeout(() => setEditorAudioStatus(currentEditorAudioStatusText()), 2200);
}

function setEditorFormValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function openChartEditor(chartId = null) {
    stopEditorPlayback();
    const modal = document.getElementById('chart-editor-modal');
    if (!modal) return;

    if (chartId && findCustomChart(chartId)) {
        loadChartIntoEditor(findCustomChart(chartId));
    } else {
        newBlankChartInEditor();
    }

    modal.classList.remove('hidden');
    renderEditorChartList();
    resizeEditorCanvas();
    scrollEditorGridToStart();
    renderEditorCanvas();
    // Se existir um autosave relevante pra este momento (mesmo chart, ou nenhum chart
    // específico pedido), oferece recuperar ANTES de qualquer edição nova sobrescrever o
    // que está na tela — ver comentário em maybeOfferEditorAutosaveRecovery.
    maybeOfferEditorAutosaveRecovery(chartId);
}

function closeChartEditor() {
    stopEditorPlayback();
    document.getElementById('chart-editor-modal')?.classList.add('hidden');
    // O chart pode ter sido editado/salvo — reflete no card certo da tela inicial
    applySettingsToUI();
}

function newBlankChartInEditor() {
    editorState.id = null;
    editorState.difficulty = null;
    if (typeof window.edDiffUI === 'function') setTimeout(window.edDiffUI, 0);
    editorState.title = 'Meu Chart';
    editorState.mode = currentMode || '4K';
    editorState.bpm = 150;
    editorState.snap = 4;
    editorState.duration = 90;
    editorState.zoom = editorState.zoom || 70;
    editorState.notes = [];
    editorState.selectedIndex = -1;
    editorState.selectedIndices = new Set();
    editorState.marqueeStart = null;
    editorState.marqueeCurrent = null;
    editorState.pins = [];
    editorState.cueMs = null;
    editorState.sections = [];
    editorState.bpmChanges = [];
    editorState.songEndMs = null;
    editorState.audioBuffer = null;
    editorState.waveformPeaks = null;
    editorState.audioFileBlob = null;
    editorState.audioFileName = null;
    editorState.audioLoadedFromSaved = false;
    resetEditorSimulatorState();
    setEditorFormValue('editor-title', editorState.title);
    setEditorFormValue('editor-mode', editorState.mode);
    setEditorFormValue('editor-bpm', editorState.bpm);
    setEditorFormValue('editor-snap', String(editorState.snap)); if (typeof updateEditorSnapButtons === 'function') updateEditorSnapButtons();
    setEditorFormValue('editor-duration', editorState.duration);
    setEditorAudioStatus(currentEditorAudioStatusText());
    renderEditorPinsList();
    renderEditorSectionsList();
}

// Assíncrona: além dos dados do chart (síncrono, como sempre), tenta recuperar o áudio
// original salvo no IndexedDB (ver saveCurrentEditorChart/preloadCustomChartAudioIfNeeded)
// pra reativar a prévia sonora do editor mesmo depois de fechar/reabrir — antes disso, o
// áudio de referência se perdia por completo ao reabrir um chart já salvo.
async function loadChartIntoEditor(chart) {
    const loadingId = chart.id; // guarda pra não pisar em outro chart aberto nesse meio-tempo
    editorState.id = chart.id;
    editorState.title = chart.title;
    editorState.mode = chart.mode;
    editorState.bpm = chart.bpm;
    editorState.snap = chart.snap || 4;
    editorState.duration = chart.duration || 90;
    editorState.notes = (chart.notes || []).map(n => ({ time: n.time, lane: n.lane, holdEnd: n.holdEnd ?? null }));
    editorState.selectedIndex = -1;
    editorState.selectedIndices = new Set();
    editorState.marqueeStart = null;
    editorState.marqueeCurrent = null;
    // (chart.pins || []) e (chart.sections || []) cobrem charts salvos ANTES dessas
    // funcionalidades existirem (sem o campo).
    editorState.pins = (chart.pins || []).slice();
    editorState.cueMs = null;
    editorState.sections = (chart.sections || []).map(s => ({ time: s.time, name: s.name })).sort((a, b) => a.time - b.time);
    editorState.bpmChanges = sanitizeBpmChanges(chart.bpmChanges);
    editorState.songEndMs = (typeof chart.songEndMs === 'number' && chart.songEndMs > 0) ? chart.songEndMs : null;
    editorState.difficulty = chart.difficulty && chart.difficulty.tier ? { tier: chart.difficulty.tier, level: chart.difficulty.level } : null;
    if (typeof window.edDiffUI === 'function') window.edDiffUI();
    editorState.audioBuffer = null;
    editorState.waveformPeaks = null;
    editorState.audioFileBlob = null;
    editorState.audioFileName = null;
    editorState.audioLoadedFromSaved = false;
    resetEditorSimulatorState();
    setEditorFormValue('editor-title', editorState.title);
    setEditorFormValue('editor-mode', editorState.mode);
    setEditorFormValue('editor-bpm', editorState.bpm);
    setEditorFormValue('editor-snap', String(editorState.snap)); if (typeof updateEditorSnapButtons === 'function') updateEditorSnapButtons();
    setEditorFormValue('editor-duration', editorState.duration);
    setEditorAudioStatus(currentEditorAudioStatusText());
    renderEditorPinsList();
    renderEditorSectionsList();

    setEditorAudioStatus('Verificando se esse chart tem áudio salvo...');
    try {
        const row = await loadChartAudioBlob(chart.id);
        if (editorState.id !== loadingId) return; // usuário já trocou de chart nesse meio-tempo
        if (row && row.blob) {
            audio.init();
            const arrayBuffer = await row.blob.arrayBuffer();
            const decoded = await audio.ctx.decodeAudioData(arrayBuffer);
            if (editorState.id !== loadingId) return;
            editorState.audioBuffer = decoded;
            editorState.audioFileName = row.fileName || editorState.audioFileName;
            editorState.audioLoadedFromSaved = true;
            // A forma de onda só fica pronta depois desse decode assíncrono — o render
            // síncrono que openChartEditor() já disparou antes não tinha esse dado ainda,
            // então redesenha aqui assim que ele chega.
            computeEditorWaveformPeaks();
            renderEditorCanvas();
        }
    } catch (e) {
        console.warn('Não foi possível recuperar o áudio salvo desse chart:', e);
    } finally {
        if (editorState.id === loadingId) setEditorAudioStatus(currentEditorAudioStatusText());
    }
}

// O <canvas> de verdade fica PEQUENO e de tamanho fixo (seguro em qualquer navegador/GPU,
// mesmo os mais fracos) — ele "flutua" (via position:absolute + top) dentro da janelinha
// visível do wrap, cobrindo só ela + uma margem, e é reposicionado a cada scroll (ver
// positionEditorCanvasWindow). Quem dá ao wrap o tamanho de scroll CORRETO pra timeline
// inteira (duração x zoom, sem limite prático de duração/zoom) é um spacer invisível.
// Antes, o canvas tinha a altura da timeline inteira, com um teto de 20000px — músicas
// longas + zoom alto passavam fácil disso, e mesmo abaixo do teto, canvases muito altos
// silenciosamente PARAM DE DESENHAR em GPUs/navegadores mais fracos (fica tudo com a cor
// de fundo só, sem nota nenhuma aparecendo) — o mais provável pra tela ter ficado escura
// numa gravação longa.
const EDITOR_CANVAS_WINDOW_PX = 3000;

// Dispatcher: o Modo Simulador troca o <canvas> inteiro pra um layout DIFERENTE (visual de
// jogo de verdade, tamanho fixo, sem scroll) — ver layoutEditorCanvasGame. Fora dele, é o
// layout de sempre (grade rolável/piano-roll, canvas pequeno "flutuando" numa timeline
// virtualizada). Chamado ao abrir/trocar de chart, ao redimensionar, e sempre que o Modo
// Simulador liga/desliga (ver updateEditorSimulatorUI).
function resizeEditorCanvas() {
    if (editorState.simulatorMode) { layoutEditorCanvasGame(); return; }
    const canvasEl = document.getElementById('editorCanvas');
    const wrap = document.getElementById('editor-canvas-wrap');
    const spacer = document.getElementById('editor-canvas-spacer');
    if (!canvasEl || !wrap) return;
    wrap.style.overflowY = ''; // garante que volta a rolar (game view desliga isso)
    const width = editorGridWidth();
    const fullHeight = Math.max(400, Math.round(editorState.duration * editorState.zoom) + 200);
    editorState.timelineHeightPx = fullHeight;
    if (spacer) { spacer.style.height = fullHeight + 'px'; spacer.classList.remove('hidden'); }

    const winHeight = Math.min(fullHeight, Math.max(600, EDITOR_CANVAS_WINDOW_PX));
    canvasEl.width = width;
    canvasEl.height = winHeight;
    canvasEl.style.width = width + 'px';
    canvasEl.style.height = winHeight + 'px';
    canvasEl.style.position = 'absolute';
    canvasEl.style.left = '50%';
    canvasEl.style.marginLeft = (-width / 2) + 'px'; // mx-auto não funciona com absolute
    const ph = document.getElementById('editor-playhead');
    if (ph) ph.style.width = width + 'px';
    renderEditorTrackLabels(width);
    positionEditorCanvasWindow();
}

// Largura da grade clássica: usa o espaço da tela cheia (antes era fixa em 480px), sem
// deixar cada coluna larga demais. Sobra espaço dos dois lados pra régua de linhas.
const EDITOR_RULER_W = 64;
function editorGridWidth() {
    const wrap = document.getElementById('editor-canvas-wrap');
    const units = getLaneKinds(editorState.mode).reduce((s, k) => s + (k === 'main' ? 1 : 2), 0);
    const avail = ((wrap && wrap.clientWidth) || 640) - 2 * (EDITOR_RULER_W + 14);
    return Math.round(Math.max(420, Math.min(avail, 920, units * 74)));
}

// Layout do Modo Simulador: canvas de tamanho FIXO (não "flutua" nem depende de scroll —
// não tem timeline pra rolar, é uma vista ao vivo, igual à tela de jogo de verdade), preso
// no topo do wrap. Desliga o scroll do wrap (nada pra rolar) e some com o espaçador (só
// serve pra dar altura de scroll no modo grade).
// Mesma proporção da gear de verdade (520:1080 — ver #gameCanvas em style.css/resizeCanvas
// em cima), alta e estreita. Antes a largura e a altura do visual do Simulador eram
// calculadas cada uma pro seu próprio lado (largura só limitada por um teto de 820px,
// altura = clientHeight do wrap), o que dava um retângulo baixo e largo — bem diferente do
// jogo de verdade, e ainda mais curto quando o cabeçalho de opções acima ocupava várias
// linhas. Agora encaixa o MAIOR retângulo 520:1080 possível dentro do espaço disponível
// (mesma ideia do object-fit:contain que o jogo de verdade usa), priorizando a altura --
// só reduz se a largura resultante não couber.
const EDITOR_GEAR_ASPECT = 520 / 1080;

function layoutEditorCanvasGame() {
    const canvasEl = document.getElementById('editorCanvas');
    const wrap = document.getElementById('editor-canvas-wrap');
    const spacer = document.getElementById('editor-canvas-spacer');
    if (!canvasEl || !wrap) return;
    if (spacer) spacer.classList.add('hidden');
    wrap.style.overflowY = 'hidden';
    wrap.scrollTop = 0;
    const availWidth = Math.round(wrap.clientWidth) || 480;
    const availHeight = Math.round(wrap.clientHeight) || 560;

    let height = Math.max(360, availHeight - 8);
    let width = height * EDITOR_GEAR_ASPECT;
    if (editorState.highwayMode) {
        // Gear 3D: usa a área toda (larga, como no Moonscraper), não a proporção da gear.
        width = Math.max(420, Math.min(availWidth - 16, 1100));
    } else if (width > availWidth - 16) {
        width = Math.max(280, availWidth - 16);
        height = width / EDITOR_GEAR_ASPECT;
    }
    width = Math.round(width);
    height = Math.round(height);

    canvasEl.width = width;
    canvasEl.height = height;
    canvasEl.style.width = width + 'px';
    canvasEl.style.height = height + 'px';
    canvasEl.style.position = 'relative';
    canvasEl.style.left = '50%';
    canvasEl.style.marginLeft = (-width / 2) + 'px';
    canvasEl.style.top = '0px';
    renderEditorTrackLabels(width);
}

// Reposiciona o <canvas> pequeno pra cobrir a região visível atual (+ margem) da timeline,
// sem nunca deixá-lo "flutuar" além do que a timeline de verdade tem (0..timelineHeightPx -
// canvas.height). Chamado a cada scroll e sempre antes de renderEditorCanvas.
function positionEditorCanvasWindow() {
    const canvasEl = document.getElementById('editorCanvas');
    const wrap = document.getElementById('editor-canvas-wrap');
    if (!canvasEl || !wrap) return;
    const maxTop = Math.max(0, editorState.timelineHeightPx - canvasEl.height);
    const desiredTop = wrap.scrollTop - 400;
    editorState.canvasWindowTopPx = Math.max(0, Math.min(maxTop, desiredTop));
    canvasEl.style.top = editorState.canvasWindowTopPx + 'px';
}

// Cabeçalho fixo (não rola com o canvas) com o nome real de cada trilha — TRACK 1..6,
// L/R SIDE TRACK no 8B — igual à tela de INPUT SETTING do jogo, pra ficar claro qual
// coluna é qual na hora de desenhar o chart.
function renderEditorTrackLabels(width = 480) {
    const row = document.getElementById('editor-track-labels');
    if (!row) return;
    row.style.width = width + 'px';
    row.innerHTML = '';
    // Na Gear 3D os rótulos são desenhados dentro do próprio canvas (embaixo da linha de acerto)
    row.style.display = editorState.highwayMode ? 'none' : '';
    if (editorState.highwayMode) return;

    // Modo Simulador (visual de jogo): só as lanes PRINCIPAIS têm coluna própria aí — side
    // note/TRACK L/R são overlay sem coluna (ver getGameplayColumnLayout/renderEditorGameView),
    // então a fileira de rótulos tem que seguir esse MESMO layout, senão ficava desalinhada
    // com as colunas de verdade desenhadas embaixo.
    if (editorState.simulatorMode) {
        const columns = getGameplayColumnLayout(editorState.mode, width);
        columns.forEach((col, i) => {
            const cell = document.createElement('div');
            cell.style.width = col.width + 'px';
            cell.className = 'text-center text-[8px] font-mono font-bold py-1 leading-tight text-slate-300';
            cell.style.borderRight = i < columns.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none';
            cell.textContent = getTrackLabel(editorState.mode, i);
            row.appendChild(cell);
        });
        alignEditorTrackLabels();
        return;
    }

    const layout = getColumnLayoutForWidth(editorState.mode, width);
    // `layout` é indexado pelo índice LÓGICO da lane (mesmo índice de note.lane), que não
    // é mais igual à ordem visual esquerda->direita (side notes agora ficam nas pontas
    // visuais mas em índices altos/baixos "emprestados"; no 8B, TRACK L/R ficam em índices
    // altos mas aparecem visualmente coladas nas TRACK 1..6). Como essa linha é montada
    // por fluxo normal do DOM (não por posição absoluta), tem que iterar na ORDEM VISUAL.
    const order = getVisualOrder(editorState.mode);
    order.forEach((logicalIdx, i) => {
        const col = layout[logicalIdx];
        if (!col) return;
        const cell = document.createElement('div');
        cell.style.width = col.width + 'px';
        cell.className = `text-center text-[8px] font-mono font-bold py-1 leading-tight ${col.isSide ? 'text-green-400' : (col.isTrackLR ? 'text-red-400' : 'text-slate-300')}`;
        cell.style.borderRight = i < order.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none';
        cell.textContent = getTrackLabel(editorState.mode, logicalIdx);
        row.appendChild(cell);
    });
    alignEditorTrackLabels();
}

// O cabeçalho das trilhas fica FORA da área que rola (não some no scroll), então a posição
// dele não acompanha sozinha a do canvas — a barra de rolagem vertical come uns pixels do
// lado direito da área da grade e o canvas (centralizado nela) ficava deslocado em relação ao
// cabeçalho (centralizado na largura inteira). Alinha pela posição REAL do canvas na tela.
function alignEditorTrackLabels() {
    const row = document.getElementById('editor-track-labels');
    const cv = document.getElementById('editorCanvas');
    if (!row || !cv || !row.parentElement) return;
    row.style.marginLeft = '0px';
    const cr = cv.getBoundingClientRect();
    if (!cr.width) return;
    const pr = row.parentElement.getBoundingClientRect();
    row.style.marginLeft = Math.round(cr.left - pr.left) + 'px';
}

// Desenha o grid/notas. A grade de tempo só é desenhada dentro do trecho visível da
// scrollável (mais uma margem) — com BPM alto + snap fino, o total de linhas da timeline
// inteira pode passar de dezenas de milhares, então desenhar só o que aparece na tela é
// o que mantém isso responsivo em charts longos.
function renderEditorCanvas() {
    scheduleEditorSideUIRender();
    if (editorState.simulatorMode) { renderEditorGameView(); return; }
    const canvasEl = document.getElementById('editorCanvas');
    const wrap = document.getElementById('editor-canvas-wrap');
    if (!canvasEl || !wrap) return;
    // Nunca deixa um erro pontual de desenho travar a tela num estado escuro/em branco pro
    // resto da sessão (as notas em editorState.notes não dependem do render pra existir —
    // ver handleSimulatorNoteDown/Up) — loga e mostra um aviso acionável, mas a PRÓXIMA
    // tentativa de desenhar (próxima tecla, próximo scroll) continua acontecendo normalmente.
    try {
        positionEditorCanvasWindow();
        const ctx2 = canvasEl.getContext('2d');
        const width = canvasEl.width;
        const winTop = editorState.canvasWindowTopPx || 0;
        const winHeight = canvasEl.height;
        const fullHeight = editorState.timelineHeightPx || winHeight;
        const pxPerSec = editorState.zoom;
        const layout = getColumnLayoutForWidth(editorState.mode, width);
        const colors = getKeyColorScheme(editorState.mode, gearSkin);

        ctx2.clearRect(0, 0, width, winHeight);
        ctx2.fillStyle = '#0b1120';
        ctx2.fillRect(0, 0, width, winHeight);

        // Forma de onda do áudio (referência visual pra mirar a nota no transiente/batida
        // certa — nunca salva no chart nem lida pelo jogo, ver computeEditorWaveformPeaks).
        // Desenhada ANTES das faixas coloridas de lane (que são translúcidas), pra elas
        // continuarem por cima marcando cada coluna normalmente. Espelhada dos dois lados do
        // centro da tela (parece uma forma de onda "deitada", virada 90° por causa da grade
        // vertical) — só varre as linhas realmente visíveis (viewTop..viewBottom), igual ao
        // corte de visibilidade que o WaveformDraw.cs do Moonscraper faz.
        if (editorState.waveformPeaks && editorState.waveformPeaks.length) {
            const peaks = editorState.waveformPeaks;
            const bucketMs = editorState.waveformBucketMs;
            const centerX = width / 2;
            const maxHalfW = width / 2 - 4;
            const totalMsForWave = editorState.duration * 1000;
            ctx2.fillStyle = 'rgba(103,232,249,0.16)';
            const step = 2;
            for (let y = 0; y < winHeight; y += step) {
                const t = editorAbsYToTime(y + winTop);
                if (t < 0 || t > totalMsForWave) continue;
                const bucketIdx = Math.floor(t / bucketMs);
                const amp = peaks[bucketIdx] || 0;
                if (amp <= 0.001) continue;
                const halfW = Math.min(maxHalfW, amp * maxHalfW);
                ctx2.fillRect(centerX - halfW, y, halfW * 2, step);
            }
        }

        layout.forEach((col, i) => {
            ctx2.fillStyle = col.isSide ? 'rgba(74,222,128,0.07)' : (col.isTrackLR ? 'rgba(239,68,68,0.08)' : (i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.04)'));
            ctx2.fillRect(col.x, 0, col.width, winHeight);
        });

        // viewTop/viewBottom em pixel ABSOLUTO da timeline inteira (não do canvas pequeno) —
        // é contra eles que filtramos o que é visível; só na hora de desenhar de fato é que
        // convertemos pra coordenada LOCAL do canvas, subtraindo winTop.
        const viewTop = Math.max(0, winTop);
        const viewBottom = Math.min(fullHeight, winTop + winHeight);
        const totalMs = editorState.duration * 1000;
        // Tempo invertido (ver editorTimeToAbsY): yAbs MENOR = tempo MAIOR, então o tempo mais
        // ANTIGO visível vem do fundo da janela (viewBottom) e o mais NOVO do topo (viewTop).
        // A grade segue o mapa de tempo (cada trecho de BPM tem a sua — ver forEachEditorGridLine).
        const tStart = Math.max(0, editorAbsYToTime(viewBottom));
        const tEnd = Math.min(totalMs, editorAbsYToTime(viewTop));

        ctx2.font = '10px monospace';
        if (isFinite(tStart) && isFinite(tEnd)) {
            forEachEditorGridLine(tStart, tEnd, (t, isBeat, isMeasure, measureNum) => {
                const y = editorTimeToAbsY(t) - winTop;
                ctx2.strokeStyle = isMeasure ? 'rgba(34,211,238,0.5)' : (isBeat ? 'rgba(148,163,184,0.4)' : 'rgba(100,116,139,0.18)');
                ctx2.lineWidth = isMeasure ? 1.5 : 1;
                ctx2.beginPath();
                ctx2.moveTo(0, y + 0.5);
                ctx2.lineTo(width, y + 0.5);
                ctx2.stroke();
                if (isMeasure) {
                    ctx2.fillStyle = 'rgba(103,232,249,0.8)';
                    ctx2.fillText(`${formatEditorTime(t)}  #${measureNum}`, 4, y + 11);
                }
            });
        }

        // Mudanças de BPM (linha laranja cheia com o valor) — ver editorState.bpmChanges.
        drawEditorBpmMarkersFlat(ctx2, width, (t) => editorTimeToAbsY(t) - winTop, -20, winHeight + 20);

        ctx2.strokeStyle = 'rgba(255,255,255,0.12)';
        layout.forEach(col => ctx2.strokeRect(col.x + 0.5, 0, col.width - 1, winHeight));

        editorState.notes.forEach((n, idx) => {
            const col = layout[n.lane];
            if (!col) return;
            const headYAbs = editorTimeToAbsY(n.time);
            const tailYAbs = n.holdEnd != null ? editorTimeToAbsY(n.holdEnd) : headYAbs;
            // Com o tempo invertido, holdEnd (mais tarde) tem yAbs MENOR que note.time (mais
            // cedo) — o contrário de antes — então não dá mais pra assumir qual dos dois é o
            // "topo"/"fundo" do retângulo da hold: usa min/max explícito.
            if (Math.max(headYAbs, tailYAbs) < viewTop - 20 || Math.min(headYAbs, tailYAbs) > viewBottom + 20) return;
            const headY = headYAbs - winTop;
            const tailY = tailYAbs - winTop;

            const color = colors[n.lane] || '#22d3ee';
            const isSelected = idx === editorState.selectedIndex || editorState.selectedIndices.has(idx);

            if (n.holdEnd != null) {
                const holdTop = Math.min(headY, tailY);
                const holdHeight = Math.max(2, Math.abs(tailY - headY));
                ctx2.fillStyle = color + '55';
                ctx2.fillRect(col.x + col.width * 0.2, holdTop, col.width * 0.6, holdHeight);
                ctx2.strokeStyle = color;
                ctx2.lineWidth = 2;
                ctx2.strokeRect(col.x + col.width * 0.2, holdTop, col.width * 0.6, holdHeight);
            }

            // A cabeça (marcador clicável do início da nota) sempre fica exatamente em cima
            // da posição de n.time — isso não muda com a inversão, só o retângulo da hold acima.
            ctx2.fillStyle = isSelected ? '#ffffff' : color;
            ctx2.strokeStyle = isSelected ? color : 'rgba(0,0,0,0.4)';
            ctx2.lineWidth = 1.5;
            ctx2.fillRect(col.x + 3, headY - NOTE_HEIGHT_PX / 2, col.width - 6, NOTE_HEIGHT_PX);
            ctx2.strokeRect(col.x + 3, headY - NOTE_HEIGHT_PX / 2, col.width - 6, NOTE_HEIGHT_PX);
        });

        // Pins de navegação (nunca fazem parte do chart/gameplay — só apoio visual, ver
        // editorState.pins/toggleEditorPin) — linha tracejada âmbar atravessando a tela toda.
        if (editorState.cueMs != null) {
            const yAbs = editorTimeToAbsY(editorState.cueMs);
            if (yAbs >= viewTop - 4 && yAbs <= viewBottom + 4) {
                const y = yAbs - winTop;
                ctx2.save();
                ctx2.strokeStyle = '#34d399'; ctx2.lineWidth = 3;
                ctx2.beginPath(); ctx2.moveTo(0, y + 0.5); ctx2.lineTo(width, y + 0.5); ctx2.stroke();
                ctx2.fillStyle = '#34d399'; ctx2.font = 'bold 11px monospace'; ctx2.textAlign = 'left';
                ctx2.fillText('↩ RETORNO', 4, y - 4);
                ctx2.restore();
            }
        }
        if (editorState.pins && editorState.pins.length) {
            ctx2.save();
            ctx2.strokeStyle = '#f59e0b';
            ctx2.lineWidth = 2;
            ctx2.setLineDash([6, 4]);
            editorState.pins.forEach(p => {
                const yAbs = editorTimeToAbsY(p);
                if (yAbs < viewTop - 4 || yAbs > viewBottom + 4) return;
                const y = yAbs - winTop;
                ctx2.beginPath();
                ctx2.moveTo(0, y + 0.5);
                ctx2.lineTo(width, y + 0.5);
                ctx2.stroke();
            });
            ctx2.restore();
        }

        // Seções nomeadas (evolução dos pins — ver editorState.sections/toggleEditorAddSection)
        // — linha tracejada VIOLETA (cor diferente da dos pins, pra não confundir os dois tipos
        // de marcador) com o nome escrito ao lado, igual às linhas de compasso.
        if (editorState.sections && editorState.sections.length) {
            ctx2.save();
            ctx2.strokeStyle = '#a78bfa';
            ctx2.lineWidth = 2;
            ctx2.setLineDash([2, 5]);
            editorState.sections.forEach(s => {
                const yAbs = editorTimeToAbsY(s.time);
                if (yAbs < viewTop - 4 || yAbs > viewBottom + 4) return;
                const y = yAbs - winTop;
                ctx2.beginPath();
                ctx2.moveTo(0, y + 0.5);
                ctx2.lineTo(width, y + 0.5);
                ctx2.stroke();
                ctx2.fillStyle = '#c4b5fd';
                ctx2.font = 'bold 10px monospace';
                ctx2.fillText(`🚩 ${s.name}`, 4, y - 3);
            });
            ctx2.restore();
        }

        // Retângulo da marquee em andamento (Shift+arraste numa área vazia — ver
        // handleEditorCanvasMouseDown/handleEditorWindowMouseMove). Desenhado por último pra
        // ficar por cima de tudo enquanto o usuário está arrastando.
        if (editorState.marqueeStart && editorState.marqueeCurrent) {
            const laneMin = Math.min(editorState.marqueeStart.lane, editorState.marqueeCurrent.lane);
            const laneMax = Math.max(editorState.marqueeStart.lane, editorState.marqueeCurrent.lane);
            let xStart = width, xEnd = 0;
            for (let i = laneMin; i <= laneMax; i++) {
                const col = layout[i];
                if (!col) continue;
                xStart = Math.min(xStart, col.x);
                xEnd = Math.max(xEnd, col.x + col.width);
            }
            const y1 = editorTimeToAbsY(editorState.marqueeStart.timeMs) - winTop;
            const y2 = editorTimeToAbsY(editorState.marqueeCurrent.timeMs) - winTop;
            if (xEnd > xStart) {
                ctx2.save();
                ctx2.fillStyle = editorState.marqueeErase ? 'rgba(239,68,68,0.18)' : 'rgba(34,211,238,0.15)';
                ctx2.strokeStyle = editorState.marqueeErase ? 'rgba(248,113,113,0.95)' : 'rgba(34,211,238,0.8)';
                ctx2.lineWidth = 1.5;
                ctx2.fillRect(xStart, Math.min(y1, y2), xEnd - xStart, Math.abs(y2 - y1));
                ctx2.strokeRect(xStart, Math.min(y1, y2), xEnd - xStart, Math.abs(y2 - y1));
                ctx2.restore();
            }
        }
    } catch (e) {
        console.warn('Falha ao desenhar o canvas do editor (as notas já criadas continuam salvas):', e);
        setEditorAudioStatus('⚠️ Deu um problema pra desenhar a tela agora (suas notas continuam salvas) — role um pouco ou mude o zoom pra atualizar.');
    }
}

// --- Visual do Modo Simulador: MESMO jeito de jogar do jogo de verdade ---
// Em vez da grade que rola pro lado (piano-roll, pra edição fina por clique), o Modo
// Simulador mostra as colunas com as notas CAINDO até uma linha de julgamento fixa embaixo
// — igual à tela de jogo normal — pra tocar/gravar no mesmo sentido que se joga de verdade,
// em vez de "ler" uma partitura horizontal. Reaproveita as mesmas funções de layout/cor do
// jogo de verdade (getGameplayColumnLayout, getKeyColorScheme, getSideOverlayRect) pra ficar
// visualmente igual, só com um desenho de nota mais simples (sem partículas/efeitos de
// entrada) — aqui é uma prévia de trabalho, não a gear de jogo propriamente dita.
function renderEditorGameView() {
    if (editorState.highwayMode) { renderEditorHighwayView(); return; }
    const canvasEl = document.getElementById('editorCanvas');
    if (!canvasEl) return;
    try {
        const ctx2 = canvasEl.getContext('2d');
        const width = canvasEl.width;
        const height = canvasEl.height;
        const targetY = height - 80;
        const mode = editorState.mode;
        const mainLaneCount = getMainLaneCount(mode);
        const kinds = getLaneKinds(mode);
        const columns = getGameplayColumnLayout(mode, width);
        const sideIdx = getSideLaneIndices(mode);
        const trackLRIdx = getTrackLRIndices(mode);
        const colors = getKeyColorScheme(mode, gearSkin);
        // Mesmo relógio que o jogo de verdade usaria (getEditorElapsedMs já inclui o
        // globalOffset calibrado quando tocando — ver comentário na função) e a MESMA
        // velocidade de queda configurada em Configurações (scrollSpeed), pra sentir
        // igual ao que a pessoa já está acostumada jogando de verdade.
        const currentTimeMs = getEditorElapsedMs();
        const speedFactor = editorGameSpeedFactor();

        ctx2.clearRect(0, 0, width, height);
        ctx2.fillStyle = '#0b1120';
        ctx2.fillRect(0, 0, width, height);

        columns.forEach((col, i) => {
            ctx2.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.045)';
            ctx2.fillRect(col.x, 0, col.width, height);
            // Brilho de tecla pressionada — feedback ao vivo enquanto grava (ver
            // handleSimulatorNoteDown), decaído a cada frame como no jogo de verdade.
            const glow = editorState.simKeyGlow[i] || 0;
            if (glow > 0.01) {
                const grad = ctx2.createLinearGradient(0, height, 0, 0);
                grad.addColorStop(0, colors[i] || '#22d3ee');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx2.save();
                ctx2.globalAlpha = glow * 0.4;
                ctx2.fillStyle = grad;
                ctx2.fillRect(col.x, 0, col.width, height);
                ctx2.restore();
                editorState.simKeyGlow[i] = glow - 0.06;
            }
        });
        ctx2.strokeStyle = 'rgba(255,255,255,0.12)';
        columns.forEach(col => ctx2.strokeRect(col.x + 0.5, 0, col.width - 1, height));

        // Linha de julgamento
        ctx2.strokeStyle = '#22d3ee';
        ctx2.lineWidth = 3;
        ctx2.shadowColor = '#22d3ee';
        ctx2.shadowBlur = 10;
        ctx2.beginPath();
        ctx2.moveTo(0, targetY + 0.5);
        ctx2.lineTo(width, targetY + 0.5);
        ctx2.stroke();
        ctx2.shadowBlur = 0;

        // Sem julgamento de verdade nessa prévia (o editor não "acerta/erra" nota) — então,
        // diferente do jogo real (onde a nota some na hora que é julgada), uma nota que já
        // passou da linha continuaria caindo pra sempre e empilhando visualmente bem embaixo
        // da tela se não cortássemos ela logo depois de passar. É exatamente isso que o
        // usuário via como "as notas não aparecem, ficam na parte debaixo": ao pausar/tocar
        // no meio de um chart, dezenas de notas já passadas ficavam coladas ali, e as poucas
        // notas futuras ainda estavam longas demais acima da tela pra aparecer — parecia que
        // nada se movia. PASSED_HIDE_PX soma uma folga pequena (não some exatamente NA linha,
        // que ficaria abrupto) antes de parar de desenhar.
        const PASSED_HIDE_PX = 40;
        editorState.notes.forEach((n, idx) => {
            const headY = targetY - (n.time - currentTimeMs) * speedFactor;
            const tailY = n.holdEnd != null ? targetY - (n.holdEnd - currentTimeMs) * speedFactor : headY;
            const topMost = Math.min(headY, tailY);
            const bottomMost = Math.max(headY, tailY);
            if (bottomMost < -60) return; // ainda longe demais acima da tela
            if (topMost > targetY + PASSED_HIDE_PX) return; // já passou da linha faz tempo -- some, como uma nota julgada no jogo real

            const color = colors[n.lane] || '#22d3ee';
            const isSelected = idx === editorState.selectedIndex || editorState.selectedIndices.has(idx);
            const kind = kinds[n.lane];

            if (kind === 'main') {
                const col = columns[n.lane];
                if (!col) return;
                drawGameViewNote(ctx2, col, headY, tailY, color, isSelected);
            } else {
                // Side note / TRACK L/R: overlay translúcido numa metade do canvas, igual ao
                // jogo de verdade — nunca uma coluna própria (ver getSideOverlayRect).
                const pair = kind === 'side' ? sideIdx : trackLRIdx;
                const isLeft = !!pair && pair[0] === n.lane;
                const rect = getSideOverlayRect(width, isLeft);
                drawGameViewOverlay(ctx2, rect, headY, tailY, color, isSelected);
            }
        });

        // Pins de navegação — mesma linha tracejada âmbar do modo grade, usando a mesma
        // fórmula de queda das notas (targetY - (t - currentTime) * speedFactor) pra
        // aparecer na posição visual certa dentro do visual de jogo.
        if (editorState.cueMs != null) {
            const y = targetY - (editorState.cueMs - currentTimeMs) * speedFactor;
            if (y > -20 && y < height + 20) {
                ctx2.save();
                ctx2.strokeStyle = '#34d399'; ctx2.lineWidth = 3;
                ctx2.beginPath(); ctx2.moveTo(0, y + 0.5); ctx2.lineTo(width, y + 0.5); ctx2.stroke();
                ctx2.restore();
            }
        }
        if (editorState.pins && editorState.pins.length) {
            ctx2.save();
            ctx2.strokeStyle = '#f59e0b';
            ctx2.lineWidth = 2;
            ctx2.setLineDash([6, 4]);
            editorState.pins.forEach(p => {
                const y = targetY - (p - currentTimeMs) * speedFactor;
                if (y < -20 || y > height + 20) return;
                ctx2.beginPath();
                ctx2.moveTo(0, y + 0.5);
                ctx2.lineTo(width, y + 0.5);
                ctx2.stroke();
            });
            ctx2.restore();
        }

        // Seções nomeadas — mesma linha violeta do modo grade, mesma fórmula de queda das pins
        // acima pra aparecer na posição visual certa dentro do visual de jogo.
        if (editorState.sections && editorState.sections.length) {
            ctx2.save();
            ctx2.strokeStyle = '#a78bfa';
            ctx2.lineWidth = 2;
            ctx2.setLineDash([2, 5]);
            editorState.sections.forEach(s => {
                const y = targetY - (s.time - currentTimeMs) * speedFactor;
                if (y < -20 || y > height + 20) return;
                ctx2.beginPath();
                ctx2.moveTo(0, y + 0.5);
                ctx2.lineTo(width, y + 0.5);
                ctx2.stroke();
                ctx2.fillStyle = '#c4b5fd';
                ctx2.font = 'bold 10px monospace';
                ctx2.fillText(`🚩 ${s.name}`, 4, y - 3);
            });
            ctx2.restore();
        }

        drawEditorBpmMarkersFlat(ctx2, width, (t) => targetY - (t - currentTimeMs) * speedFactor, -20, height + 20);

        // Retângulo da marquee em andamento — mesma ideia do modo grade, só que a posição Y
        // usa a fórmula de queda em vez de tempo/zoom em linha reta.
        if (editorState.marqueeStart && editorState.marqueeCurrent) {
            const laneMin = Math.min(editorState.marqueeStart.lane, editorState.marqueeCurrent.lane);
            const laneMax = Math.max(editorState.marqueeStart.lane, editorState.marqueeCurrent.lane);
            let xStart = width, xEnd = 0;
            for (let i = laneMin; i <= laneMax; i++) {
                const col = columns[i];
                if (!col) continue;
                xStart = Math.min(xStart, col.x);
                xEnd = Math.max(xEnd, col.x + col.width);
            }
            const y1 = targetY - (editorState.marqueeStart.timeMs - currentTimeMs) * speedFactor;
            const y2 = targetY - (editorState.marqueeCurrent.timeMs - currentTimeMs) * speedFactor;
            if (xEnd > xStart) {
                ctx2.save();
                ctx2.fillStyle = editorState.marqueeErase ? 'rgba(239,68,68,0.18)' : 'rgba(34,211,238,0.15)';
                ctx2.strokeStyle = editorState.marqueeErase ? 'rgba(248,113,113,0.95)' : 'rgba(34,211,238,0.8)';
                ctx2.lineWidth = 1.5;
                ctx2.fillRect(xStart, Math.min(y1, y2), xEnd - xStart, Math.abs(y2 - y1));
                ctx2.strokeRect(xStart, Math.min(y1, y2), xEnd - xStart, Math.abs(y2 - y1));
                ctx2.restore();
            }
        }
    } catch (e) {
        console.warn('Falha ao desenhar a prévia do Modo Simulador:', e);
        setEditorAudioStatus('⚠️ Deu um problema pra desenhar a prévia agora (suas notas continuam salvas).');
    }
}

function drawGameViewNote(ctx2, col, headY, tailY, color, isSelected) {
    const isHold = tailY < headY - 1; // tailY sempre "antes" (menor) que headY quando ainda não chegou
    if (isHold) {
        const w = Math.min(col.width - 10, 74);
        const x = col.x + col.width / 2 - w / 2;
        const top = tailY, bottom = headY, h = Math.max(w, bottom - top);
        ctx2.save();
        ctx2.fillStyle = color + 'aa';
        ctx2.strokeStyle = isSelected ? '#ffffff' : color;
        ctx2.lineWidth = 2;
        ctx2.shadowColor = color;
        ctx2.shadowBlur = 10;
        if (typeof ctx2.roundRect === 'function') {
            ctx2.beginPath();
            ctx2.roundRect(x, top, w, h, w / 2);
            ctx2.fill();
            ctx2.stroke();
        } else {
            ctx2.fillRect(x, top, w, h);
            ctx2.strokeRect(x, top, w, h);
        }
        ctx2.restore();
    }
    const noteH = 20;
    const x = col.x + 4, w = col.width - 8;
    ctx2.save();
    ctx2.fillStyle = isSelected ? '#ffffff' : color;
    ctx2.strokeStyle = '#ffffff';
    ctx2.lineWidth = 1.5;
    ctx2.shadowColor = color;
    ctx2.shadowBlur = 12;
    ctx2.fillRect(x, headY - noteH / 2, w, noteH);
    ctx2.strokeRect(x, headY - noteH / 2, w, noteH);
    ctx2.restore();
}

function drawGameViewOverlay(ctx2, rect, headY, tailY, color, isSelected) {
    const top = Math.min(headY, tailY);
    const bottom = Math.max(headY, tailY);
    const height = Math.max(6, bottom - top);
    ctx2.save();
    ctx2.globalAlpha = 0.22;
    ctx2.fillStyle = color;
    ctx2.fillRect(rect.x, top, rect.width, height);
    ctx2.globalAlpha = 0.8;
    ctx2.strokeStyle = isSelected ? '#ffffff' : color;
    ctx2.lineWidth = 2;
    ctx2.shadowColor = color;
    ctx2.shadowBlur = 10;
    ctx2.strokeRect(rect.x + 2, top, rect.width - 4, height);
    ctx2.restore();
}

// Converte um evento de mouse na posição (lane, tempo em ms) do editor. Com clamp=true,
// posições fora da área do canvas são "presas" nas bordas (usado durante um arraste que
// saiu do canvas, pra continuar estendendo a hold em vez de simplesmente parar de responder).
function editorPointFromEvent(e, clamp = false) {
    const canvasEl = document.getElementById('editorCanvas');
    if (!canvasEl) return { lane: null, timeMs: null };
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { lane: null, timeMs: null };
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    let x = (e.clientX - rect.left) * scaleX;
    let y = (e.clientY - rect.top) * scaleY;

    if (clamp) {
        x = Math.max(0, Math.min(canvasEl.width - 0.01, x));
        y = Math.max(0, Math.min(canvasEl.height, y));
    } else if (x < 0 || x > canvasEl.width || y < 0 || y > canvasEl.height) {
        return { lane: null, timeMs: null };
    }

    const layout = getColumnLayoutForWidth(editorState.mode, canvasEl.width);
    let lane = layout.length - 1;
    for (let i = 0; i < layout.length; i++) {
        if (x >= layout[i].x && x < layout[i].x + layout[i].width) { lane = i; break; }
    }
    // y é local ao canvas pequeno (a "janela" atual dentro da timeline) — soma o topo da
    // janela pra voltar à posição ABSOLUTA na timeline antes de converter pra tempo (ver
    // positionEditorCanvasWindow/resizeEditorCanvas). editorAbsYToTime já cuida da inversão
    // (tempo sobe pra cima na grade clássica — ver comentário lá).
    const yAbs = y + (editorState.canvasWindowTopPx || 0);
    const timeMs = editorAbsYToTime(yAbs);
    return { lane, timeMs };
}

// Mesma ideia de editorPointFromEvent, mas pro visual de jogo do Simulador (canvas de
// tamanho fixo, notas caindo até a linha de julgamento — ver renderEditorGameView) em vez
// da grade rolável. Só reconhece lanes PRINCIPAIS (a mesma limitação do próprio visual: side
// note/TRACK L/R não tem coluna própria aí, é um overlay sobre a tela toda — ver
// getSideOverlayRect/renderEditorGameView. Pra inserir essas, ainda dá pra desarmar o
// Simulador e usar a grade normal.) Inverte a fórmula de queda (headY = targetY - (time -
// currentTime) * speedFactor) pra achar o tempo a partir da posição Y clicada.
function editorPointFromGameViewEvent(e, clamp = false) {
    if (editorState.highwayMode) return editorPointFromHighwayEvent(e, clamp);
    const canvasEl = document.getElementById('editorCanvas');
    if (!canvasEl) return { lane: null, timeMs: null };
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { lane: null, timeMs: null };
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    let x = (e.clientX - rect.left) * scaleX;
    let y = (e.clientY - rect.top) * scaleY;

    if (clamp) {
        x = Math.max(0, Math.min(canvasEl.width - 0.01, x));
        y = Math.max(-100000, Math.min(canvasEl.height + 100000, y)); // nota pode estar bem acima/abaixo da tela ainda
    } else if (x < 0 || x > canvasEl.width || y < -100000 || y > canvasEl.height + 100000) {
        return { lane: null, timeMs: null };
    }

    const columns = getGameplayColumnLayout(editorState.mode, canvasEl.width);
    let lane = columns.length - 1;
    for (let i = 0; i < columns.length; i++) {
        if (x >= columns[i].x && x < columns[i].x + columns[i].width) { lane = i; break; }
    }

    const targetY = canvasEl.height - 80;
    const speedFactor = editorGameSpeedFactor();
    const currentTimeMs = getEditorElapsedMs();
    const timeMs = currentTimeMs + (targetY - y) / speedFactor;
    return { lane, timeMs };
}


// ===== Visual "Gear 3D" (estilo Moonscraper Chart Editor) =====
// A pista é desenhada em perspectiva de verdade (projeção 1/(1+z)): z = 0 é a linha de acerto,
// z cresce pro "fundo". Largura e altura encolhem juntas com a distância, então as linhas de
// lane ficam retas convergindo pro horizonte e as notas "vêm vindo" do fundo, igual ao
// highway do Moonscraper/Guitar Hero. getHighwayProjection é a ÚNICA fonte da conta —
// desenho (renderEditorHighwayView) e clique (editorPointFromHighwayEvent, a conta inversa
// exata) usam a mesma, então o clique cai sempre exatamente onde a nota aparece.
const HIGHWAY_BASE_WINDOW_MS = 2400; // quanto de música aparece na pista (no multiplicador 1x)
const HIGHWAY_FAR_SCALE = 0.36;       // largura lá no fundo = 36% da largura na linha de acerto
const HIGHWAY_PAST_Z = -0.07;         // um pouquinho do "passado" ainda aparece abaixo da linha

// `windowMs`/`opts` opcionais: a tela de JOGO usa a mesma projeção com outra janela de tempo
// (a da velocidade do jogador) e outras margens (ver getGameHighwayProjection).
function getHighwayProjection(w, h, windowMsOverride, opts) {
    const o = opts || {};
    const strikeY = h - (o.strikeFromBottom ?? 74);
    const topY = o.topY ?? 26;
    const sFar = o.farScale ?? HIGHWAY_FAR_SCALE;
    const vanishY = (topY - strikeY * sFar) / (1 - sFar);
    const zFar = 1 / sFar - 1;
    const nearWidth = o.nearWidth ?? Math.min(w - 110, 760, Math.max(260, w * 0.72));
    const cx = w / 2;
    const windowMs = windowMsOverride ?? (HIGHWAY_BASE_WINDOW_MS / (editorState.noteFallSpeedMultiplier || 1));
    const scaleAt = (z) => 1 / (1 + z);
    return {
        w, h, strikeY, topY, vanishY, zFar, zPast: HIGHWAY_PAST_Z, nearWidth, cx, windowMs, scaleAt,
        zOfTime: (t, now) => ((t - now) / windowMs) * zFar,
        timeOfZ: (z, now) => now + (z / zFar) * windowMs,
        yOfZ: (z) => vanishY + (strikeY - vanishY) * scaleAt(z),
        zOfY: (y) => { const sc = (y - vanishY) / (strikeY - vanishY); return sc > 0.01 ? 1 / sc - 1 : Infinity; },
        tilted: true,
        xOf: (u, z) => cx + (u - 0.5) * nearWidth * scaleAt(z)
    };
}

// Conta inversa exata da projeção: posição na tela -> (u = posição horizontal 0..1 na pista, tempo).
function highwayUnproject(proj, x, y, now) {
    const s = (y - proj.vanishY) / (proj.strikeY - proj.vanishY);
    if (!(s > 0.01)) return null;
    const z = 1 / s - 1;
    return { z, s, t: proj.timeOfZ(z, now), u: (x - proj.cx) / (proj.nearWidth * s) + 0.5 };
}

function editorPointFromHighwayEvent(e, clamp = false) {
    const canvasEl = document.getElementById('editorCanvas');
    if (!canvasEl) return { lane: null, timeMs: null };
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { lane: null, timeMs: null };
    let x = (e.clientX - rect.left) * (canvasEl.width / rect.width);
    let y = (e.clientY - rect.top) * (canvasEl.height / rect.height);
    const proj = getHighwayProjection(canvasEl.width, canvasEl.height);
    const yBottom = proj.yOfZ(proj.zPast);
    if (clamp) {
        y = Math.max(proj.topY, Math.min(yBottom, y));
    } else if (y < proj.topY - 4 || y > yBottom + 4) {
        return { lane: null, timeMs: null };
    }
    const r = highwayUnproject(proj, x, y, getEditorElapsedMs());
    if (!r) return { lane: null, timeMs: null };
    let u = r.u;
    if (u < 0 || u >= 1) {
        if (!clamp) return { lane: null, timeMs: null };
        u = Math.max(0, Math.min(0.9999, u));
    }
    const layout = getColumnLayoutForWidth(editorState.mode, 1);
    let lane = null;
    for (let i = 0; i < layout.length; i++) {
        if (layout[i] && u >= layout[i].x && u < layout[i].x + layout[i].width) { lane = i; break; }
    }
    if (lane == null) return { lane: null, timeMs: null };
    return { lane, timeMs: r.t };
}

// Rótulo curtinho de cada lane pros "botões" embaixo da linha de acerto.
function getShortTrackLabel(mode, laneIdx) {
    const kind = getLaneKinds(mode)[laneIdx];
    if (kind === 'main') return String(laneIdx + 1);
    const pair = getLaneIndicesOfKind(mode, kind);
    const isLeft = !!pair && pair[0] === laneIdx;
    if (kind === 'side') return isLeft ? 'SL' : 'SR';
    if (kind === 'trackLR') return isLeft ? 'L' : 'R';
    return String(laneIdx + 1);
}

function renderEditorHighwayView() {
    const canvasEl = document.getElementById('editorCanvas');
    if (!canvasEl) return;
    try {
        const ctx2 = canvasEl.getContext('2d');
        const w = canvasEl.width, h = canvasEl.height;
        const proj = getHighwayProjection(w, h);
        const { xOf, yOfZ, zOfTime, zFar, zPast, strikeY, topY } = proj;
        const now = getEditorElapsedMs();
        const mode = editorState.mode;
        const layout = getColumnLayoutForWidth(mode, 1);
        const kinds = getLaneKinds(mode);
        const colors = getKeyColorScheme(mode, gearSkin);
        const totalMs = editorState.duration * 1000;
        const tMin = proj.timeOfZ(zPast, now);
        const tMax = proj.timeOfZ(zFar, now);
        const quad = (u0, u1, z0, z1) => {
            ctx2.beginPath();
            ctx2.moveTo(xOf(u0, z0), yOfZ(z0));
            ctx2.lineTo(xOf(u1, z0), yOfZ(z0));
            ctx2.lineTo(xOf(u1, z1), yOfZ(z1));
            ctx2.lineTo(xOf(u0, z1), yOfZ(z1));
            ctx2.closePath();
        };

        // Fundo
        const bg = ctx2.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#020617');
        bg.addColorStop(1, '#0b1120');
        ctx2.fillStyle = bg;
        ctx2.fillRect(0, 0, w, h);

        // Corpo da pista + faixas de cada lane
        const body = ctx2.createLinearGradient(0, topY, 0, strikeY);
        body.addColorStop(0, '#0b1224');
        body.addColorStop(1, '#131c33');
        quad(0, 1, zPast, zFar);
        ctx2.fillStyle = body;
        ctx2.fill();
        layout.forEach((col, i) => {
            if (!col) return;
            quad(col.x, col.x + col.width, zPast, zFar);
            ctx2.fillStyle = col.isSide ? 'rgba(74,222,128,0.09)' : (col.isTrackLR ? 'rgba(239,68,68,0.10)' : (i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.045)'));
            ctx2.fill();
        });

        // Forma de onda deitada ao longo da pista (referência pra mirar no transiente)
        if (editorState.waveformPeaks && editorState.waveformPeaks.length) {
            const peaks = editorState.waveformPeaks;
            const bucketMs = editorState.waveformBucketMs;
            const yBottom = yOfZ(zPast);
            ctx2.fillStyle = 'rgba(103,232,249,0.14)';
            for (let y = topY; y < yBottom; y += 2) {
                const r = highwayUnproject(proj, proj.cx, y, now);
                if (!r || r.t < 0 || r.t > totalMs) continue;
                const amp = peaks[Math.floor(r.t / bucketMs)] || 0;
                if (amp <= 0.002) continue;
                const halfW = amp * proj.nearWidth * r.s * 0.46;
                ctx2.fillRect(proj.cx - halfW, y, halfW * 2, 2);
            }
        }

        // Grade de batidas (segue as mudanças de BPM)
        ctx2.textAlign = 'right';
        forEachEditorGridLine(Math.max(0, tMin), Math.min(totalMs, tMax), (t, isBeat, isMeasure, measureNum) => {
            const z = zOfTime(t, now);
            if (z < zPast || z > zFar) return;
            const y = yOfZ(z);
            const sc = proj.scaleAt(z);
            ctx2.strokeStyle = isMeasure ? 'rgba(34,211,238,0.6)' : (isBeat ? 'rgba(148,163,184,0.42)' : 'rgba(100,116,139,0.2)');
            ctx2.lineWidth = (isMeasure ? 2.2 : 1) * Math.max(0.5, sc);
            ctx2.beginPath();
            ctx2.moveTo(xOf(0, z), y);
            ctx2.lineTo(xOf(1, z), y);
            ctx2.stroke();
            if (isMeasure) {
                ctx2.fillStyle = 'rgba(103,232,249,0.85)';
                ctx2.font = `bold ${Math.round(9 + 4 * sc)}px monospace`;
                ctx2.fillText(String(measureNum), xOf(0, z) - 6, y + 4);
            }
        });

        // Divisórias das lanes (retas convergindo pro fundo)
        const bounds = new Set([0, 1]);
        layout.forEach(col => { if (col) { bounds.add(+col.x.toFixed(6)); bounds.add(+(col.x + col.width).toFixed(6)); } });
        [...bounds].forEach(u => {
            const edge = u <= 0.0001 || u >= 0.9999;
            ctx2.strokeStyle = edge ? 'rgba(34,211,238,0.55)' : 'rgba(255,255,255,0.10)';
            ctx2.lineWidth = edge ? 2.5 : 1;
            ctx2.beginPath();
            ctx2.moveTo(xOf(u, zPast), yOfZ(zPast));
            ctx2.lineTo(xOf(u, zFar), yOfZ(zFar));
            ctx2.stroke();
        });

        // Marcadores: seções (violeta), pins (âmbar), mudanças de BPM (laranja) — linha através
        // da pista + rótulo do lado de fora, à direita
        const drawMarker = (t, color, dash, label, labelColor) => {
            const z = zOfTime(t, now);
            if (z < zPast || z > zFar) return;
            const y = yOfZ(z);
            ctx2.save();
            ctx2.strokeStyle = color;
            ctx2.lineWidth = 2;
            ctx2.setLineDash(dash);
            ctx2.beginPath();
            ctx2.moveTo(xOf(0, z), y);
            ctx2.lineTo(xOf(1, z), y);
            ctx2.stroke();
            if (label) {
                ctx2.setLineDash([]);
                ctx2.fillStyle = labelColor;
                ctx2.font = 'bold 11px monospace';
                ctx2.textAlign = 'left';
                ctx2.fillText(label, xOf(1, z) + 8, y + 4);
            }
            ctx2.restore();
        };
        if (editorState.cueMs != null) drawMarker(editorState.cueMs, '#34d399', [], '↩ RETORNO', '#6ee7b7');
        (editorState.pins || []).forEach(p => drawMarker(p, '#f59e0b', [6, 4], '📍', '#fcd34d'));
        (editorState.sections || []).forEach(sec => drawMarker(sec.time, '#a78bfa', [2, 5], `🚩 ${sec.name}`, '#c4b5fd'));
        (editorState.bpmChanges || []).forEach(c => drawMarker(c.time, '#fb923c', [], `♩ ${formatBpmValue(c.bpm)}`, '#fdba74'));

        // Notas — de trás pra frente (as mais distantes primeiro, pras de perto ficarem por cima)
        const visible = [];
        editorState.notes.forEach((n, idx) => {
            const end = n.holdEnd != null ? n.holdEnd : n.time;
            if (end < tMin || n.time > tMax) return;
            visible.push({ n, idx });
        });
        visible.sort((a, b) => b.n.time - a.n.time);
        const HEAD_DZ = 0.05;
        const drawGem = (col, z, color, isSelected, alpha) => {
            const pad = col.width * 0.07;
            const u0 = col.x + pad, u1 = col.x + col.width - pad;
            ctx2.save();
            ctx2.globalAlpha = alpha;
            quad(u0, u1, z - HEAD_DZ / 2, z + HEAD_DZ / 2);
            ctx2.fillStyle = isSelected ? '#ffffff' : color;
            ctx2.shadowColor = color;
            ctx2.shadowBlur = 8;
            ctx2.fill();
            ctx2.shadowBlur = 0;
            ctx2.lineWidth = isSelected ? 2.5 : 1.2;
            ctx2.strokeStyle = isSelected ? color : 'rgba(255,255,255,0.85)';
            ctx2.stroke();
            // brilho em cima (dá volume de "peça")
            quad(u0 + col.width * 0.05, u1 - col.width * 0.05, z + HEAD_DZ * 0.05, z + HEAD_DZ * 0.45);
            ctx2.fillStyle = 'rgba(255,255,255,0.35)';
            ctx2.fill();
            ctx2.restore();
        };
        visible.forEach(({ n, idx }) => {
            const col = layout[n.lane];
            if (!col) return;
            const color = colors[n.lane] || '#22d3ee';
            const isSelected = idx === editorState.selectedIndex || editorState.selectedIndices.has(idx);
            const zHead = zOfTime(n.time, now);
            const alpha = zHead < 0 ? 0.45 : 1;
            if (n.holdEnd != null) {
                const z0 = Math.max(zPast, zHead);
                const z1 = Math.min(zFar, zOfTime(n.holdEnd, now));
                if (z1 > z0) {
                    const inset = col.width * (kinds[n.lane] === 'main' ? 0.27 : 0.32);
                    ctx2.save();
                    ctx2.globalAlpha = zHead < 0 ? 0.6 : 1;
                    quad(col.x + inset, col.x + col.width - inset, z0, z1);
                    ctx2.fillStyle = color + '88';
                    ctx2.fill();
                    ctx2.lineWidth = isSelected ? 2 : 1.2;
                    ctx2.strokeStyle = isSelected ? '#ffffff' : color;
                    ctx2.stroke();
                    ctx2.restore();
                }
            }
            if (zHead >= zPast && zHead <= zFar) drawGem(col, zHead, color, isSelected, alpha);
        });

        // Fantasma do cursor (onde a nota seria criada) / alvo da borracha
        const hp = editorState.hoverPoint;
        if (hp && !editorState.isRefAudioPlaying && editorState.tool !== 'select' && !editorState.moveDrag) {
            const col = layout[hp.lane];
            if (col) {
                if (editorState.tool === 'eraser') {
                    const hit = findNoteAt(hp.lane, hp.timeMs);
                    if (hit !== -1) {
                        const z = zOfTime(editorState.notes[hit].time, now);
                        quad(col.x, col.x + col.width, z - HEAD_DZ * 0.8, z + HEAD_DZ * 0.8);
                        ctx2.strokeStyle = '#ef4444';
                        ctx2.lineWidth = 3;
                        ctx2.stroke();
                    }
                } else if (findNoteAt(hp.lane, hp.timeMs) === -1) {
                    const z = zOfTime(snapEditorTime(hp.timeMs), now);
                    if (z >= zPast && z <= zFar) drawGem(col, z, colors[hp.lane] || '#22d3ee', false, 0.35);
                }
            }
        }

        // Marquee (seleção por retângulo) projetada na pista
        if (editorState.marqueeStart && editorState.marqueeCurrent) {
            const laneMin = Math.min(editorState.marqueeStart.lane, editorState.marqueeCurrent.lane);
            const laneMax = Math.max(editorState.marqueeStart.lane, editorState.marqueeCurrent.lane);
            let u0 = 1, u1 = 0;
            layout.forEach((col, i) => {
                if (!col || i < laneMin || i > laneMax) return;
                u0 = Math.min(u0, col.x);
                u1 = Math.max(u1, col.x + col.width);
            });
            const za = Math.max(zPast, Math.min(zFar, zOfTime(editorState.marqueeStart.timeMs, now)));
            const zb = Math.max(zPast, Math.min(zFar, zOfTime(editorState.marqueeCurrent.timeMs, now)));
            if (u1 > u0) {
                quad(u0, u1, Math.min(za, zb), Math.max(za, zb));
                ctx2.fillStyle = editorState.marqueeErase ? 'rgba(239,68,68,0.18)' : 'rgba(34,211,238,0.15)';
                ctx2.fill();
                ctx2.strokeStyle = editorState.marqueeErase ? 'rgba(248,113,113,0.95)' : 'rgba(34,211,238,0.85)';
                ctx2.lineWidth = 1.5;
                ctx2.stroke();
            }
        }

        // Névoa no fundo da pista (profundidade)
        const fog = ctx2.createLinearGradient(0, topY - 2, 0, topY + 90);
        fog.addColorStop(0, 'rgba(2,6,23,1)');
        fog.addColorStop(1, 'rgba(2,6,23,0)');
        ctx2.fillStyle = fog;
        ctx2.fillRect(0, topY - 2, w, 92);

        // Linha de acerto + "botões" de cada lane embaixo dela
        ctx2.save();
        ctx2.strokeStyle = '#22d3ee';
        ctx2.lineWidth = 4;
        ctx2.shadowColor = '#22d3ee';
        ctx2.shadowBlur = 12;
        ctx2.beginPath();
        ctx2.moveTo(xOf(0, 0), strikeY);
        ctx2.lineTo(xOf(1, 0), strikeY);
        ctx2.stroke();
        ctx2.restore();
        const keys = KEY_CONFIGS[mode] || [];
        layout.forEach((col, i) => {
            if (!col) return;
            const x0 = xOf(col.x, 0) + 3, x1 = xOf(col.x + col.width, 0) - 3;
            const padTop = strikeY + 8;
            const glow = editorState.simKeyGlow[i] || 0;
            ctx2.fillStyle = colors[i] || '#22d3ee';
            ctx2.globalAlpha = 0.25 + Math.min(0.6, glow * 0.6);
            ctx2.fillRect(x0, padTop, x1 - x0, 22);
            ctx2.globalAlpha = 1;
            if (glow > 0.01) editorState.simKeyGlow[i] = glow - 0.06;
            ctx2.fillStyle = '#e2e8f0';
            ctx2.font = 'bold 11px monospace';
            ctx2.textAlign = 'center';
            ctx2.fillText(getShortTrackLabel(mode, i), (x0 + x1) / 2, padTop + 15);
            ctx2.fillStyle = '#94a3b8';
            ctx2.font = '9px monospace';
            ctx2.fillText(keys[i] ? formatKeyCode(keys[i]) : '', (x0 + x1) / 2, padTop + 34);
        });

        // HUD: posição e BPM do trecho atual
        ctx2.textAlign = 'left';
        ctx2.fillStyle = '#94a3b8';
        ctx2.font = 'bold 12px monospace';
        ctx2.fillText(`${formatEditorTime(now)} · ♩ ${formatBpmValue(editorBpmAt(now))} BPM · ${describeEditorBeatPosition(Math.max(0, now))}`, 10, 16);
    } catch (e) {
        console.warn('Falha ao desenhar a Gear 3D:', e);
        setEditorAudioStatus('⚠️ Deu um problema pra desenhar a Gear 3D agora (suas notas continuam salvas).');
    }
}

// Liga/desliga o visual Gear 3D. Por baixo ele é o visual do Simulador (mesmo relógio,
// mesmo scroll pela roda, mesma gravação), só desenhado em perspectiva — então entrar nele a
// partir da grade faz a mesma sincronização de posição que entrar no Simulador.
function toggleEditorHighwayMode() {
    if (editorState.highwayMode) {
        editorState.highwayMode = false;
        editorState.hoverPoint = null;
        // sai direto pra grade (simulatorMode é desligado pela troca normal)
        if (editorState.simulatorMode) { toggleEditorSimulatorMode(true); return; }
    } else {
        if (!editorState.simulatorMode) {
            editorState.highwayMode = true;
            toggleEditorSimulatorMode(true);
            return;
        }
        editorState.highwayMode = true;
    }
    updateEditorSimulatorUI();
    resizeEditorCanvas();
    renderEditorCanvas();
}

// Velocidade de queda usada SÓ no visual do Simulador (desenho e clique/hit-test, que
// precisam usar exatamente a mesma conta pra não desalinhar onde a nota aparece do onde o
// clique acerta). scrollSpeed é a config real de Configurações (mesma sensação de jogo); o
// multiplicador extra é só uma conveniência do editor pra mirar melhor e NUNCA é salvo no
// chart nem afeta scrollSpeed/BPM/áudio de verdade (ver editorState.noteFallSpeedMultiplier).
function editorGameSpeedFactor() {
    const edCanvas = document.getElementById('editorCanvas');
    const base = speedFactorForTravel(typeof scrollSpeed === 'number' ? scrollSpeed : 3.0, (edCanvas && edCanvas.height) || 1080);
    return base * (editorState.noteFallSpeedMultiplier || 1.0);
}

// GRADE CLÁSSICA (piano-roll) com o tempo invertido — pedido explícito do usuário: a nota
// mais antiga (t=0) fica lá embaixo da timeline inteira, e o fim da música fica no topo (ao
// contrário do padrão "tempo desce" de antes). Escolha explícita: SÓ afeta a grade — o
// visual do Modo Simulador continua caindo de cima pra baixo, igual ao jogo de verdade, de
// propósito (é uma prévia de como vai *sentir* jogando de verdade, então não devia inverter).
//
// yAbs é sempre a posição em pixel absoluta dentro do espaço virtualizado inteiro (0..
// timelineHeightPx) — o MESMO espaço que scrollTop/canvasWindowTopPx/spacer sempre usaram.
// Só a direção do tempo DENTRO desse espaço que essas duas funções decidem — então toda a
// virtualização (positionEditorCanvasWindow, o <canvas> pequeno "flutuando", o spacer que dá
// a altura de scroll) continua funcionando sem precisar mexer em mais nada.
function editorTimeToAbsY(timeMs) {
    return editorState.timelineHeightPx - (timeMs / 1000) * editorState.zoom;
}
function editorAbsYToTime(yAbs) {
    return ((editorState.timelineHeightPx - yAbs) / editorState.zoom) * 1000;
}

// Como o tempo agora sobe pra cima na grade (t=0 lá embaixo), o scrollTop=0 padrão do
// navegador deixaria de mostrar o INÍCIO da música por padrão — mostraria o FIM. Chamado só
// quando um chart é criado/aberto/importado do zero (nunca num ajuste de zoom/duração/modo
// no meio da edição, que devem preservar onde a pessoa estava), pra a tela já abrir mostrando
// o começo da música, do jeito que se espera.
function scrollEditorGridToStart() {
    if (editorState.simulatorMode) return;
    const wrap = document.getElementById('editor-canvas-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function snapEditorTime(timeMs) {
    // Respeita o mapa de tempo: encaixa na grade do trecho de BPM em que o instante cai (a
    // grade de cada trecho começa na própria mudança de BPM). Sem mudanças, é exatamente a
    // conta de sempre (um trecho só, começando no 0).
    const totalMs = editorState.duration * 1000;
    const seg = tempoSegmentAt(getEditorTempoSegments(), timeMs);
    const snapMs = seg.msPerBeat / editorState.snap;
    let snapped = seg.start + Math.round((timeMs - seg.start) / snapMs) * snapMs;
    if (isFinite(seg.end) && (snapped > seg.end || Math.abs(timeMs - seg.end) < Math.abs(timeMs - snapped))) snapped = seg.end;
    snapped = Math.max(0, Math.min(totalMs, snapped));
    return Math.round(snapped);
}

function findNoteAt(lane, timeMs) {
    const tolMs = Math.max(15, editorSnapMsAt(timeMs) * 0.6);
    for (let i = editorState.notes.length - 1; i >= 0; i--) {
        const n = editorState.notes[i];
        if (n.lane !== lane) continue;
        if (n.holdEnd != null) {
            if (timeMs >= n.time - tolMs && timeMs <= n.holdEnd + tolMs) return i;
        } else if (Math.abs(timeMs - n.time) <= tolMs) {
            return i;
        }
    }
    return -1;
}

// Clique/arraste pra inserir e ajustar nota funciona nos DOIS visuais do editor: a grade
// abstrata de sempre (editorPointFromEvent) e, quando PAUSADO, o visual de jogo do Simulador
// também (editorPointFromGameViewEvent) — pra poder ver a queda de verdade, pausar num
// ponto, clicar pra inserir/ajustar bem ali, e apertar Play de novo pra testar, sem precisar
// ficar trocando de tela. Enquanto está TOCANDO/GRAVANDO no Simulador, o clique continua
// desligado (é hora de tocar de verdade, não de editar) — só quando pausado.
function isGameViewEditable() {
    return editorState.simulatorMode && !editorState.isRefAudioPlaying && !editorState.isRecording;
}

// Antes desta zona morta, QUALQUER mouse-move (mesmo 1px de tremida da mão, super comum com
// mouse físico) já convertia a nota nova em hold, ou encolhia/apagava a hold de uma nota
// existente ao só clicar nela pra selecionar — era basicamente impossível colocar uma nota
// simples de propósito. Só depois de arrastar mais que isso (em pixel de TELA, não de grade —
// assim funciona igual em qualquer zoom/BPM/snap) é que o arraste passa a valer como criação
// real de hold. Abaixo disso, a nota fica como estava (tap continua tap; hold existente não
// muda) mesmo que o mouse tenha se mexido um pouco durante o clique.
const EDITOR_HOLD_DRAG_DEADZONE_PX = 14; // era 6: um clique tremido já virava hold

// Ponto (lane, tempo) do evento no visual que estiver na tela (grade, Simulador ou Gear 3D).
function editorPointFromAnyView(e, clamp = false) {
    return editorState.simulatorMode ? editorPointFromGameViewEvent(e, clamp) : editorPointFromEvent(e, clamp);
}

// ===== Ferramentas (barra estilo Moonscraper) =====
const EDITOR_TOOLS = {
    select: { label: 'Seleção', hint: 'Seleção: clique seleciona, arraste uma nota pra MOVER (tempo e lane), arraste no vazio pra selecionar várias' },
    tap: { label: 'Tap', hint: 'Tap: clique cria só nota simples — nunca vira hold, mesmo arrastando' },
    note: { label: 'Nota/Hold', hint: 'Nota/Hold: clique cria nota, arraste pra cima (tempo) pra virar hold' },
    eraser: { label: 'Borracha', hint: 'Borracha: clique ou arraste por cima das notas pra apagar' },
    stair: { label: 'Escada', hint: 'Escada: arraste de uma lane até outra (pra cima = pra frente no tempo) e a escadinha nasce sozinha no passo escolhido — não precisa trocar o SNAP' }
};
const EDITOR_TOOL_KEYS = {
    Digit1: 'select', Numpad1: 'select',
    Digit2: 'tap', Numpad2: 'tap',
    Digit3: 'note', Numpad3: 'note',
    Digit4: 'eraser', Numpad4: 'eraser',
    Digit5: 'stair', Numpad5: 'stair'
};

function setEditorTool(tool) {
    if (!EDITOR_TOOLS[tool]) return;
    editorState.tool = tool;
    editorState.dragNote = null;
    editorState.moveDrag = null;
    editorState.eraserDragging = false;
    editorState.stairDrag = null;
    updateEditorToolUI();
    flashEditorStatus(`🛠️ ${EDITOR_TOOLS[tool].hint}`);
    renderEditorCanvas();
}

function updateEditorToolUI() {
    document.querySelectorAll('[data-editor-tool]').forEach(btn => {
        const active = btn.dataset.editorTool === editorState.tool;
        btn.classList.toggle('bg-cyan-500', active);
        btn.classList.toggle('text-slate-950', active);
        btn.classList.toggle('border-cyan-300', active);
        btn.classList.toggle('bg-slate-800', !active);
        btn.classList.toggle('text-slate-300', !active);
        btn.classList.toggle('border-slate-700', !active);
    });
    const canvasEl = document.getElementById('editorCanvas');
    if (canvasEl) canvasEl.style.cursor = editorState.tool === 'select' ? 'default' : (editorState.tool === 'eraser' ? 'not-allowed' : 'crosshair');
}

// Apaga UMA nota pelo índice, reindexando seleção/multi-seleção (apagar do meio do array
// desloca todo índice depois dela em -1).
function deleteEditorNoteAt(hitIdx) {
    if (hitIdx < 0 || hitIdx >= editorState.notes.length) return;
    editorState.notes.splice(hitIdx, 1);
    if (editorState.selectedIndex === hitIdx) editorState.selectedIndex = -1;
    else if (editorState.selectedIndex > hitIdx) editorState.selectedIndex--;
    const reindexed = new Set();
    editorState.selectedIndices.forEach(i => {
        if (i === hitIdx) return;
        reindexed.add(i > hitIdx ? i - 1 : i);
    });
    editorState.selectedIndices = reindexed;
}

function handleEditorCanvasMouseDown(e) {
    if (e.button !== 0) return; // botão direito é tratado à parte (apagar)
    if (editorState.simulatorMode && !isGameViewEditable()) return; // tocando/gravando: só visual
    const { lane, timeMs } = editorState.simulatorMode ? editorPointFromGameViewEvent(e) : editorPointFromEvent(e);
    if (lane == null) return;

    const hitIdx = findNoteAt(lane, timeMs);

    if (e.shiftKey) {
        // Shift+Clique numa nota = alterna ela dentro/fora da multi-seleção, sem criar
        // nota nem iniciar arraste de hold. Shift+Clique/arraste numa área VAZIA = começa
        // uma marquee (retângulo de seleção) — ver handleEditorWindowMouseMove/MouseUp e
        // selectEditorNotesInRect. Funciona igual nos dois visuais (grade e jogo pausado).
        if (hitIdx !== -1) {
            toggleEditorNoteSelection(hitIdx);
        } else {
            editorState.marqueeStart = { lane, timeMs };
            editorState.marqueeCurrent = { lane, timeMs };
        }
        renderEditorCanvas();
        return;
    }

    const tool = editorState.tool || 'note';

    // Nota que já faz parte de uma seleção de VÁRIAS (ex.: o que acabou de ser colado) ou
    // Alt+arraste: move o grupo com qualquer ferramenta (menos a borracha) — antes só dava
    // na ferramenta Seleção, e o colado ficava "preso".
    if (tool !== 'eraser' && hitIdx !== -1 && (e.altKey || (editorState.selectedIndices.size > 1 && editorState.selectedIndices.has(hitIdx)))) {
        if (!getSelectedEditorNoteIndices().has(hitIdx)) {
            editorState.selectedIndices = new Set();
            editorState.selectedIndex = hitIdx;
        }
        startEditorMoveDrag(e, hitIdx, lane, timeMs);
        return;
    }

    if (tool === 'stair') {
        const t0 = snapEditorTime(timeMs);
        editorState.selectedIndices = new Set();
        editorState.selectedIndex = -1;
        editorState.stairDrag = { lane0: lane, t0, lane1: lane, t1: t0, generated: [] };
        rebuildEditorStair();
        renderEditorCanvas();
        return;
    }

    if (tool === 'eraser') {
        if (hitIdx !== -1) deleteEditorNoteAt(hitIdx);
        editorState.eraserDragging = true;
        renderEditorCanvas();
        return;
    }

    if (tool === 'select') {
        if (hitIdx === -1) {
            // Arraste no vazio = marquee (não precisa de Shift nessa ferramenta)
            editorState.selectedIndex = -1;
            editorState.selectedIndices = new Set();
            editorState.marqueeStart = { lane, timeMs };
            editorState.marqueeCurrent = { lane, timeMs };
            renderEditorCanvas();
            return;
        }
        if (!getSelectedEditorNoteIndices().has(hitIdx)) {
            editorState.selectedIndices = new Set();
            editorState.selectedIndex = hitIdx;
        }
        startEditorMoveDrag(e, hitIdx, lane, timeMs);
        return;
    }

    // Clique normal (sem Shift) sempre reinicia a multi-seleção — evita confundir "ajustar
    // uma nota específica" com "mexer no grupo inteiro" de uma vez.
    editorState.selectedIndices = new Set();
    if (hitIdx !== -1) {
        editorState.selectedIndex = hitIdx;
        // Ferramenta Tap: só seleciona, nunca começa arraste de hold
        editorState.dragNote = tool === 'tap' ? null : editorState.notes[hitIdx];
    } else {
        const snapped = snapEditorTime(timeMs);
        const newNote = { time: snapped, lane, holdEnd: null };
        editorState.notes.push(newNote);
        editorState.selectedIndex = editorState.notes.length - 1;
        editorState.dragNote = tool === 'tap' ? null : newNote;
    }
    editorState.dragStartClientY = e.clientY;
    renderEditorCanvas();
}

function startEditorMoveDrag(e, hitIdx, lane, timeMs) {
    const originals = [...getSelectedEditorNoteIndices()].map(i => {
        const n = editorState.notes[i];
        return { note: n, time: n.time, lane: n.lane, holdEnd: n.holdEnd };
    });
    editorState.moveDrag = {
        anchorLane: lane, anchorTime: timeMs, anchorNoteTime: editorState.notes[hitIdx].time,
        startClientX: e.clientX, startClientY: e.clientY, originals, moved: false
    };
    renderEditorCanvas();
}

// ===== Ferramenta Escada =====
// Passo da escada (subdivisões por batida) — separado do SNAP da grade, assim dá pra fazer
// escada rápida de 1/16 sem precisar trocar o SNAP e depois voltar.
let editorStairDiv = 4;
let editorStairMode = 'repeat'; // 'repeat' (1234 1234) ou 'bounce' (1234 321)
function editorMainLaneOrder(mode) {
    const kinds = getLaneKinds(mode);
    return getVisualOrder(mode).filter(i => kinds[i] === 'main');
}
// Recria as notas da escada que está sendo arrastada (apaga as anteriores e gera de novo)
function rebuildEditorStair() {
    const sd = editorState.stairDrag;
    if (!sd) return;
    if (sd.generated.length) {
        const gen = new Set(sd.generated);
        editorState.notes = editorState.notes.filter(n => !gen.has(n));
        sd.generated = [];
    }
    const order = editorMainLaneOrder(editorState.mode);
    if (!order.length) return;
    const nearestPos = (lane) => {
        const p = order.indexOf(lane);
        if (p !== -1) return p;
        // lane extra (side): usa a lane principal mais perto na tela
        const layout = getColumnLayoutForWidth(editorState.mode, 1000);
        const cx = layout[lane] ? layout[lane].x + layout[lane].width / 2 : 0;
        let best = 0, bd = Infinity;
        order.forEach((l, i) => { const d = Math.abs(layout[l].x + layout[l].width / 2 - cx); if (d < bd) { bd = d; best = i; } });
        return best;
    };
    // começo = o ponto mais cedo; a escada anda da lane do começo pra lane do fim
    const forward = sd.t1 >= sd.t0;
    const tA = forward ? sd.t0 : sd.t1, tB = forward ? sd.t1 : sd.t0;
    const pA = nearestPos(forward ? sd.lane0 : sd.lane1), pB = nearestPos(forward ? sd.lane1 : sd.lane0);
    const seg = tempoSegmentAt(getEditorTempoSegments(), tA);
    const step = seg.msPerBeat / editorStairDiv;
    const count = Math.max(1, Math.min(512, Math.round((tB - tA) / step) + 1));
    // sequência de posições: de pA até pB; se for a mesma lane, atravessa todas as lanes
    let seq = [];
    if (pA === pB) {
        for (let i = 0; i < order.length; i++) seq.push((pA + i) % order.length);
    } else {
        const dir = pB > pA ? 1 : -1;
        for (let p = pA; p !== pB + dir; p += dir) seq.push(p);
    }
    if (editorStairMode === 'bounce' && seq.length > 2) seq = seq.concat(seq.slice(1, -1).reverse());
    const existing = new Set(editorState.notes.map(n => `${n.lane}|${n.time}`));
    for (let k = 0; k < count; k++) {
        const time = Math.round(tA + k * step);
        const lane = order[seq[k % seq.length]];
        if (existing.has(`${lane}|${time}`)) continue;
        const note = { time, lane, holdEnd: null };
        editorState.notes.push(note);
        sd.generated.push(note);
    }
}
function finishEditorStair() {
    const sd = editorState.stairDrag;
    editorState.stairDrag = null;
    if (!sd) return;
    const gen = new Set(sd.generated);
    editorState.selectedIndex = -1;
    editorState.selectedIndices = new Set();
    editorState.notes.forEach((n, i) => { if (gen.has(n)) editorState.selectedIndices.add(i); });
    flashEditorStatus(`🪜 Escada com ${sd.generated.length} nota(s) (passo ${editorSnapLabel(editorStairDiv)}). Ficou selecionada: arraste pra mover, Ctrl+C pra copiar, Delete pra apagar.`);
    renderEditorCanvas();
}
// Nome musical do snap (o valor guardado é "divisões por batida": 4 = semicolcheia = 1/16)
function editorSnapLabel(div) {
    return `1/${Math.round(div * 4)}`;
}
const EDITOR_SNAP_STEPS = [1, 2, 4, 8, 16]; // Q/E andam só nos binários (1/4 → 1/8 → 1/16 → 1/32 → 1/64)
function setEditorSnap(div, announce = true) {
    editorState.snap = div;
    setEditorFormValue('editor-snap', String(div));
    updateEditorSnapButtons();
    if (announce) flashEditorStatus(`📐 SNAP ${editorSnapLabel(div)} (${div} por batida)`);
    renderEditorCanvas();
}
function stepEditorSnap(dir) {
    const cur = editorState.snap || 4;
    let i = EDITOR_SNAP_STEPS.indexOf(cur);
    if (i === -1) {
        // tercina: vai pro binário vizinho na direção pedida
        i = dir > 0 ? EDITOR_SNAP_STEPS.findIndex(v => v > cur) : EDITOR_SNAP_STEPS.map(v => v < cur).lastIndexOf(true);
        if (i === -1) i = dir > 0 ? EDITOR_SNAP_STEPS.length - 1 : 0;
    } else {
        i = Math.max(0, Math.min(EDITOR_SNAP_STEPS.length - 1, i + dir));
    }
    setEditorSnap(EDITOR_SNAP_STEPS[i]);
}
function updateEditorSnapButtons() {
    document.querySelectorAll('[data-editor-snap]').forEach(b => {
        const on = parseFloat(b.dataset.editorSnap) === editorState.snap;
        b.classList.toggle('bg-cyan-500', on);
        b.classList.toggle('text-slate-950', on);
        b.classList.toggle('bg-slate-800', !on);
        b.classList.toggle('text-slate-300', !on);
    });
}

// Setas pra cima/baixo empurram a seleção um passo do SNAP (Shift = uma batida);
// Ctrl+←/→ troca as notas selecionadas de lane.
function nudgeEditorSelection(deltaSteps, deltaLane, wholeBeat) {
    const idx = [...getSelectedEditorNoteIndices()];
    if (!idx.length) return false;
    const sel = idx.map(i => editorState.notes[i]).filter(Boolean);
    const ref = Math.min(...sel.map(n => n.time));
    const seg = tempoSegmentAt(getEditorTempoSegments(), ref);
    const stepMs = wholeBeat ? seg.msPerBeat : seg.msPerBeat / (editorState.snap || 4);
    let dT = deltaSteps * stepMs;
    if (ref + dT < 0) dT = -ref;
    const laneCount = (KEY_CONFIGS[editorState.mode] || []).length;
    if (deltaLane) {
        const order = getVisualOrder(editorState.mode);
        const ok = sel.every(n => { const p = order.indexOf(n.lane) + deltaLane; return p >= 0 && p < order.length; });
        if (!ok) return true;
        sel.forEach(n => { n.lane = order[order.indexOf(n.lane) + deltaLane]; });
    }
    if (dT) sel.forEach(n => {
        const nt = Math.round(n.time + dT);
        if (n.holdEnd != null) n.holdEnd = Math.round(n.holdEnd + (nt - n.time));
        n.time = nt;
    });
    if (laneCount) renderEditorCanvas();
    return true;
}

// Onde colar: no ponto do mouse em cima da grade (se ele estiver lá), senão no meio do que
// está visível — antes colava na borda de baixo, e as notas sumiam pra fora da vista.
function getEditorPasteTimeMs() {
    const lp = editorState.lastPointer;
    if (lp && lp.inside && lp.timeMs != null && performance.now() - lp.at < 60000) return lp.timeMs;
    if (editorState.simulatorMode) return editorState.gamePausedMs || 0;
    const wrap = document.getElementById('editor-canvas-wrap');
    if (wrap && !editorState.isRefAudioPlaying) return Math.max(0, editorAbsYToTime(wrap.scrollTop + wrap.clientHeight * 0.5));
    return getEditorElapsedMs();
}

// Alterna um índice de nota dentro/fora do conjunto de multi-seleção (Shift+Clique).
function toggleEditorNoteSelection(idx) {
    if (editorState.selectedIndices.has(idx)) {
        editorState.selectedIndices.delete(idx);
    } else {
        editorState.selectedIndices.add(idx);
    }
}

// Marca (adiciona ao conjunto de multi-seleção) toda nota cuja lane esteja dentro do
// intervalo de lanes da marquee E cujo corpo (cabeça até o fim da hold, se houver) cruze o
// intervalo de tempo da marquee — não precisa estar 100% contida, só tocar o retângulo.
function selectEditorNotesInRect(start, end) {
    const laneMin = Math.min(start.lane, end.lane);
    const laneMax = Math.max(start.lane, end.lane);
    const timeMin = Math.min(start.timeMs, end.timeMs);
    const timeMax = Math.max(start.timeMs, end.timeMs);
    editorState.notes.forEach((n, i) => {
        if (n.lane < laneMin || n.lane > laneMax) return;
        const noteStart = n.time;
        const noteEnd = n.holdEnd != null ? n.holdEnd : n.time;
        if (noteEnd < timeMin || noteStart > timeMax) return;
        editorState.selectedIndices.add(i);
    });
}

function handleEditorWindowMouseMove(e) {
    const modal = document.getElementById('chart-editor-modal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (editorState.marqueeStart) {
        const { lane, timeMs } = editorState.simulatorMode ? editorPointFromGameViewEvent(e, true) : editorPointFromEvent(e, true);
        if (lane != null && timeMs != null) {
            // Alt + botão direito: apaga só na coluna onde começou (ver editor-apagar.js)
            editorState.marqueeCurrent = { lane: editorState.marqueeLockLane != null ? editorState.marqueeLockLane : lane, timeMs };
            renderEditorCanvas();
        }
        return;
    }

    if (editorState.stairDrag) {
        const { lane, timeMs } = editorPointFromAnyView(e, true);
        if (lane == null || timeMs == null) return;
        const sd = editorState.stairDrag;
        // o fim encaixa no PASSO da escada (não no SNAP da grade)
        const stepMs = tempoSegmentAt(getEditorTempoSegments(), sd.t0).msPerBeat / editorStairDiv;
        const t1 = Math.max(0, Math.round(sd.t0 + Math.round((timeMs - sd.t0) / stepMs) * stepMs));
        if (lane !== sd.lane1 || t1 !== sd.t1) {
            sd.lane1 = lane; sd.t1 = t1;
            rebuildEditorStair();
            renderEditorCanvas();
        }
        return;
    }

    if (editorState.eraserDragging) {
        const { lane, timeMs } = editorPointFromAnyView(e);
        if (lane == null || timeMs == null) return;
        const hitIdx = findNoteAt(lane, timeMs);
        if (hitIdx !== -1) { deleteEditorNoteAt(hitIdx); renderEditorCanvas(); }
        return;
    }

    if (editorState.moveDrag) {
        const md = editorState.moveDrag;
        if (!md.moved && Math.hypot(e.clientX - md.startClientX, e.clientY - md.startClientY) < EDITOR_HOLD_DRAG_DEADZONE_PX) return;
        const { lane, timeMs } = editorPointFromAnyView(e, true);
        if (lane == null || timeMs == null) return;
        md.moved = true;
        const laneCount = (KEY_CONFIGS[editorState.mode] || []).length;
        let deltaLane = lane - md.anchorLane;
        const minLane = Math.min(...md.originals.map(o => o.lane));
        const maxLane = Math.max(...md.originals.map(o => o.lane));
        deltaLane = Math.max(-minLane, Math.min(laneCount - 1 - maxLane, deltaLane));
        let deltaT = snapEditorTime(md.anchorNoteTime + (timeMs - md.anchorTime)) - md.anchorNoteTime;
        const minTime = Math.min(...md.originals.map(o => o.time));
        if (minTime + deltaT < 0) deltaT = -minTime;
        md.originals.forEach(o => {
            o.note.time = o.time + deltaT;
            o.note.holdEnd = o.holdEnd != null ? o.holdEnd + deltaT : null;
            o.note.lane = o.lane + deltaLane;
        });
        renderEditorCanvas();
        return;
    }

    if (!editorState.dragNote) return;
    // Zona morta: abaixo de EDITOR_HOLD_DRAG_DEADZONE_PX de arraste (em pixel de tela desde o
    // mousedown), não mexe em holdEnd de jeito nenhum — nem cria hold numa nota nova nem
    // encolhe/apaga a hold de uma nota existente que só foi clicada (ver comentário na
    // constante, acima de handleEditorCanvasMouseDown).
    const draggedPx = Math.abs(e.clientY - (editorState.dragStartClientY ?? e.clientY));
    if (draggedPx < EDITOR_HOLD_DRAG_DEADZONE_PX) return;
    const { timeMs } = editorState.simulatorMode ? editorPointFromGameViewEvent(e, true) : editorPointFromEvent(e, true);
    if (timeMs == null) return;
    const note = editorState.dragNote;
    const snappedEnd = snapEditorTime(timeMs);
    // hold só a partir de meio tempo de comprimento (um passo do snap fino é curto demais)
    const minHoldMs = Math.max(editorSnapMsAt(note.time), 60000 / Math.max(30, editorState.bpm || 120) / 2 - 1);
    note.holdEnd = (snappedEnd >= note.time + minHoldMs) ? snappedEnd : null;
    renderEditorCanvas();
}

function handleEditorWindowMouseUp() {
    if (editorState.stairDrag) { finishEditorStair(); return; }
    if (editorState.marqueeStart && editorState.marqueeCurrent) {
        selectEditorNotesInRect(editorState.marqueeStart, editorState.marqueeCurrent);
        editorState.marqueeStart = null;
        editorState.marqueeCurrent = null;
        renderEditorCanvas();
        return;
    }
    editorState.marqueeStart = null;
    editorState.marqueeCurrent = null;
    editorState.dragNote = null;
    editorState.dragStartClientY = null;
    editorState.eraserDragging = false;
    if (editorState.moveDrag) {
        const md = editorState.moveDrag;
        editorState.moveDrag = null;
        if (md.moved) {
            flashEditorStatus(`↕️ ${md.originals.length} nota(s) movida(s).`);
            renderEditorCanvas();
        }
    }
}

// Cursor passando por cima do canvas (sem botão apertado): guarda a posição pra desenhar o
// "fantasma" da nota que seria criada ali (só na Gear 3D, estilo Moonscraper).
let editorHoverRAF = null;
function handleEditorCanvasHover(e) {
    {
        const p0 = editorPointFromAnyView(e);
        editorState.lastPointer = { lane: p0.lane, timeMs: p0.timeMs, inside: p0.timeMs != null, at: performance.now() };
    }
    if (!editorState.highwayMode) { editorState.hoverPoint = null; return; }
    const p = editorPointFromAnyView(e);
    editorState.hoverPoint = (p.lane != null && p.timeMs != null) ? p : null;
    if (editorState.isRefAudioPlaying || editorHoverRAF) return;
    editorHoverRAF = requestAnimationFrame(() => { editorHoverRAF = null; renderEditorCanvas(); });
}
function handleEditorCanvasLeave() {
    if (editorState.lastPointer) editorState.lastPointer.inside = false;
    if (!editorState.hoverPoint) return;
    editorState.hoverPoint = null;
    if (!editorState.isRefAudioPlaying) renderEditorCanvas();
}

function handleEditorCanvasContextMenu(e) {
    e.preventDefault();
    if (editorState.simulatorMode && !isGameViewEditable()) return; // tocando/gravando: só visual
    const { lane, timeMs } = editorState.simulatorMode ? editorPointFromGameViewEvent(e) : editorPointFromEvent(e);
    if (lane == null) return;
    const hitIdx = findNoteAt(lane, timeMs);
    if (hitIdx !== -1) {
        deleteEditorNoteAt(hitIdx);
        renderEditorCanvas();
    }
}

// Une a seleção "clássica" (clique simples) com a multi-seleção (Shift+Clique/marquee) num
// único conjunto — usado por copiar e apagar, pra tratar as duas formas de selecionar do
// mesmo jeito sem duplicar lógica.
function getSelectedEditorNoteIndices() {
    const set = new Set(editorState.selectedIndices);
    if (editorState.selectedIndex !== -1) set.add(editorState.selectedIndex);
    return set;
}

function selectAllEditorNotes() {
    editorState.selectedIndices = new Set(editorState.notes.map((_, i) => i));
    editorState.selectedIndex = -1;
    renderEditorCanvas();
}

// Copia a seleção atual pro "clipboard" do editor (não é a área de transferência do sistema
// operacional — é só um estado interno, ver editorState.clipboard) guardando lane + o tempo
// RELATIVO à nota mais antiga do grupo, pra poder colar reposicionado em qualquer lugar
// mantendo a formação intacta (e a duração de cada hold, se houver).
function copySelectedEditorNotes() {
    const indices = getSelectedEditorNoteIndices();
    if (indices.size === 0) {
        flashEditorStatus('Nada selecionado pra copiar — clique numa nota, ou Shift+Clique/arraste pra selecionar várias.');
        return;
    }
    const notes = [...indices].map(i => editorState.notes[i]).filter(Boolean);
    if (notes.length === 0) return;
    const earliestTime = Math.min(...notes.map(n => n.time));
    editorState.clipboard = notes.map(n => ({
        lane: n.lane,
        timeOffset: n.time - earliestTime,
        holdDuration: n.holdEnd != null ? n.holdEnd - n.time : null,
    }));
    flashEditorStatus(`📋 ${notes.length} nota(s) copiada(s) — Ctrl+V pra colar na posição atual.`);
}

// Cola o clipboard na posição atual (a mesma "cabeça de leitura" usada por play/seek/pin —
// ver getEditorElapsedMs), reconstruindo cada nota a partir do tempo relativo salvo em
// copySelectedEditorNotes e encaixando tudo no grid de BPM/snap, igual a um clique manual.
function pasteEditorClipboard() {
    if (!editorState.clipboard || editorState.clipboard.length === 0) {
        flashEditorStatus('Nada copiado ainda — selecione notas e use Ctrl+C primeiro.');
        return;
    }
    const pasteAtMs = snapEditorTime(getEditorPasteTimeMs());
    const newIndices = new Set();
    const existing = new Map(editorState.notes.map((n, i) => [`${n.lane}|${n.time}`, i]));
    editorState.clipboard.forEach(c => {
        // mantém a formação exata (só a 1ª nota encaixa no grid) — encaixar cada nota de novo
        // podia "amassar" uma escada de 1/16 colada com o SNAP em 1/8
        const time = Math.round(pasteAtMs + c.timeOffset);
        const key = `${c.lane}|${time}`;
        if (existing.has(key)) { newIndices.add(existing.get(key)); return; }
        const note = { time, lane: c.lane, holdEnd: c.holdDuration != null ? time + c.holdDuration : null };
        editorState.notes.push(note);
        existing.set(key, editorState.notes.length - 1);
        newIndices.add(editorState.notes.length - 1);
    });
    editorState.selectedIndex = -1;
    editorState.selectedIndices = newIndices; // já deixa o que acabou de colar selecionado, pronto pra ajustar/mover de novo
    renderEditorCanvas();
    flashEditorStatus(`📋 ${editorState.clipboard.length} nota(s) colada(s) em ${formatEditorTime(pasteAtMs)} — arraste qualquer uma delas pra mover o grupo (ou Alt+↑/↓ e Ctrl+←/→).`);
}

// Roda do mouse sobre o visual de jogo do Simulador = navega no tempo (não tem scroll nativo
// pra usar ali — ver layoutEditorCanvasGame). Na grade normal o listener nem chega a chamar
// isso (o próprio 'wheel' do wrap é interceptado só quando simulatorMode está ligado — ver
// setupEditorEventListeners), deixando o scroll nativo de sempre intocado.
function handleEditorCanvasWheel(e) {
    if (!editorState.simulatorMode) return;
    e.preventDefault();
    // Um "passo" do grid de BPM/snap por notch da roda — rola por COMPASSO em vez de um
    // valor de segundos meio arbitrário, então navega junto com a grade de notas.
    const snapMs = editorSnapMsAt(getEditorElapsedMs());
    const notches = e.deltaY !== 0 ? Math.sign(e.deltaY) : Math.sign(e.deltaX);
    if (notches === 0) return;
    seekEditorPlayback((notches * snapMs) / 1000);
}

function handleEditorKeydown(e) {
    const modal = document.getElementById('chart-editor-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

    // Setas de avançar/retroceder funcionam SEMPRE — inclusive gravando — porque
    // seekEditorPlayback já cuida de fechar e retomar a gravação direitinho na nova posição
    // (ver comentário lá), e nenhum modo usa seta como tecla de lane (KEY_CONFIGS), então
    // nunca "rouba" o toque de uma lane de verdade.
    if ((e.ctrlKey || e.metaKey) && !editorState.isRecording && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        if (getSelectedEditorNoteIndices().size) {
            e.preventDefault();
            nudgeEditorSelection(0, e.code === 'ArrowRight' ? 1 : -1, false);
            return;
        }
    }
    if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && !editorState.isRecording) {
        e.preventDefault();
        const dir = e.code === 'ArrowUp' ? 1 : -1;
        // ↑/↓ sozinhas só NAVEGAM; mover notas selecionadas pede Alt (antes ↑/↓ movia a seleção —
        // e a última nota gravada fica selecionada sozinha: segurar ↑ pra rolar a tela levava
        // essa nota lá pro fim da música sem a pessoa perceber)
        if (!(e.altKey && nudgeEditorSelection(dir, 0, e.shiftKey))) {
            // sem seleção: anda um passo do SNAP (Shift = uma batida)
            const seg = tempoSegmentAt(getEditorTempoSegments(), getEditorElapsedMs());
            seekEditorPlayback(dir * (e.shiftKey ? seg.msPerBeat : seg.msPerBeat / (editorState.snap || 4)) / 1000);
        }
        return;
    }
    if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seekEditorPlayback(e.shiftKey ? -1 : -5);
        return;
    }
    if (e.code === 'ArrowRight') {
        e.preventDefault();
        seekEditorPlayback(e.shiftKey ? 1 : 5);
        return;
    }

    // Gravando no modo simulador: as teclas do PRÓPRIO modo (as mesmas do jogo de
    // verdade) criam notas em tempo real e têm prioridade sobre qualquer atalho normal
    // do editor — em alguns modos uma tecla de lane é Space (o 5K usa Space numa lane),
    // que senão cairia no play/pause.
    if (editorState.isRecording) {
        if (e.code === 'Escape') { e.preventDefault(); stopEditorPlayback(); return; }
        const laneIdx = laneForKey(editorState.mode, e.code);
        if (laneIdx !== -1) {
            e.preventDefault();
            if (!e.repeat) {
                // a outra tecla da mesma lane já estava apertada (repetição rápida com 2 teclas):
                // fecha a nota anterior e começa uma nova
                if (editorState.recordingHeld[laneIdx]) handleSimulatorNoteUp(laneIdx);
                (heldKeysByLane['ed' + laneIdx] = heldKeysByLane['ed' + laneIdx] || new Set()).add(e.code);
                handleSimulatorNoteDown(laneIdx);
            }
        }
        // Outras teclas (Espaço, Delete...) ficam mudas de propósito durante a gravação —
        // evita bagunçar o timing sendo capturado.
        return;
    }

    // Copiar/colar/selecionar tudo — 'C'/'V'/'A' também nunca são tecla de lane (ver
    // KEY_CONFIGS), então combinadas com Ctrl/Cmd ficam livres em qualquer modo.
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
        e.preventDefault();
        copySelectedEditorNotes();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
        e.preventDefault();
        pasteEditorClipboard();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        e.preventDefault();
        selectAllEditorNotes();
        return;
    }

    if (e.code === 'Space') {
        e.preventDefault();
        toggleEditorAudioPlayback();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
        // Apaga TODA a seleção de uma vez (clique simples + Shift+Clique/marquee juntos —
        // ver getSelectedEditorNoteIndices) — remove de trás pra frente pra não bagunçar os
        // índices dos que ainda faltam apagar no mesmo lote.
        const indices = getSelectedEditorNoteIndices();
        if (indices.size > 0) {
            e.preventDefault();
            [...indices].sort((a, b) => b - a).forEach(i => editorState.notes.splice(i, 1));
            editorState.selectedIndex = -1;
            editorState.selectedIndices = new Set();
            renderEditorCanvas();
        }
    } else if (e.code === 'KeyP') {
        // 'P' nunca é usada como tecla de lane em nenhum modo (ver KEY_CONFIGS) — livre
        // pra alternar (criar/remover) um pin na posição atual.
        e.preventDefault();
        toggleEditorPin();
    } else if (e.code === 'KeyN') {
        // 'N' também nunca é tecla de lane em nenhum modo — livre pra marcar/renomear/remover
        // uma seção nomeada na posição atual (ver toggleEditorAddSection).
        e.preventDefault();
        toggleEditorAddSection();
    } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        e.preventDefault();
        if (typeof window.applyEditorSpeed === 'function') window.applyEditorSpeed((editorState.practiceSpeed || 1) + (e.code === 'BracketRight' ? 0.05 : -0.05), true);
    } else if (e.code === 'KeyR') {
        // 'R' = ponto de retorno (pausar volta pra ele)
        e.preventDefault();
        toggleEditorCuePoint();
    } else if (e.code === 'KeyB') {
        // 'B' = marcar/editar/remover mudança de BPM na posição atual (nunca é tecla de lane).
        e.preventDefault();
        toggleEditorBpmChange();
    } else if (!e.ctrlKey && !e.metaKey && (e.code === 'KeyQ' || e.code === 'KeyE')) {
        // Q = SNAP mais grosso, E = mais fino (troca rápida 1/8 ↔ 1/16 sem ir no menu)
        e.preventDefault();
        stepEditorSnap(e.code === 'KeyE' ? 1 : -1);
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && EDITOR_TOOL_KEYS[e.code]) {
        // 1/2/3/4 = ferramentas (Seleção/Tap/Nota+Hold/Borracha), igual aos atalhos do Moonscraper.
        e.preventDefault();
        setEditorTool(EDITOR_TOOL_KEYS[e.code]);
    }
}

function handleEditorKeyup(e) {
    if (!editorState.isRecording) return;
    const laneIdx = laneForKey(editorState.mode, e.code);
    if (laneIdx !== -1) {
        e.preventDefault();
        const held = heldKeysByLane['ed' + laneIdx];
        if (held) { held.delete(e.code); if (held.size) return; }
        handleSimulatorNoteUp(laneIdx);
    }
}

async function handleEditorAudioImport(file) {
    if (!file) return;
    setEditorAudioStatus('Decodificando áudio...');
    try {
        audio.init();
        const arrayBuffer = await file.arrayBuffer();
        editorState.audioBuffer = await audio.ctx.decodeAudioData(arrayBuffer);
        editorState.audioFileName = file.name;
        // Guarda o ARQUIVO original (Blob comprimido) — é o que saveCurrentEditorChart manda
        // pro IndexedDB pra esse chart tocar de verdade na hora de jogar, não só aqui no
        // editor. O `file` em si nunca é afetado pelo decodeAudioData acima (só o ArrayBuffer
        // que já tiramos dele), então continua intacto pra guardar.
        editorState.audioFileBlob = file;
        editorState.audioLoadedFromSaved = false; // é um import novo desta sessão, precisa ser (re)salvo
        // Recalcula a forma de onda de fundo pro áudio novo (ver computeEditorWaveformPeaks) —
        // só um cache visual, refeito sempre que o AudioBuffer muda de verdade.
        computeEditorWaveformPeaks();

        // Num chart novo (ainda sem notas), a duração já acompanha o áudio — evita sobrar
        // timeline vazia de 90s pra uma faixa de 6s. Se já havia notas, só cresce.
        const wasEmpty = editorState.notes.length === 0;
        const audioDurationSec = Math.ceil(editorState.audioBuffer.duration) + 2;
        editorState.duration = wasEmpty
            ? Math.min(900, Math.max(10, audioDurationSec))
            : Math.min(900, Math.max(editorState.duration, audioDurationSec));
        setEditorFormValue('editor-duration', editorState.duration);
        resizeEditorCanvas();
        renderEditorCanvas();

        // Não gera nota nenhuma automaticamente — só sugere o BPM (ver detectBpmOnly), pra
        // já deixar o grid de snap do editor no andamento certo. A chart em si é 100% manual
        // a partir daqui: desenhe na grade e/ou grave tocando no modo Simulador.
        setEditorAudioStatus(`Áudio importado: ${file.name}. Detectando o BPM...`);
        await autoDetectEditorBpm();
    } catch (e) {
        editorState.audioBuffer = null;
        editorState.waveformPeaks = null;
        editorState.audioFileBlob = null;
        setEditorAudioStatus('Não foi possível decodificar esse arquivo de áudio (tente outro formato, como MP3 ou WAV).');
    }
}

// Estima só o BPM (andamento) do áudio importado, sem tentar adivinhar nota nenhuma —
// reaproveita o mesmo cálculo de espectrograma + autocorrelação que o antigo gerador
// automático de chart usava pra estimar o andamento (ver detectBpmOnly), só que aqui o
// único resultado usado é o BPM em si, pra sugerir o campo (que continua 100% editável à
// mão — essa função só preenche um chute inicial, nunca sobrescreve sem avisar).
async function autoDetectEditorBpm() {
    if (!editorState.audioBuffer) {
        flashEditorStatus('Importe um áudio primeiro — a detecção de BPM precisa dele.');
        return;
    }
    try {
        const { bpm } = await detectBpmOnly(editorState.audioBuffer, msg => setEditorAudioStatus(msg));
        if (bpm) {
            editorState.bpm = Math.round(bpm * 100) / 100;
            setEditorFormValue('editor-bpm', editorState.bpm);
            flashEditorStatus(`✅ BPM detectado: ~${Math.round(bpm)}. Confira se bate com a música e ajuste à mão se precisar — aí é só desenhar as notas.`);
        } else {
            setEditorAudioStatus('Não consegui estimar o BPM automaticamente — digite à mão no campo BPM.');
        }
    } catch (e) {
        setEditorAudioStatus('Não consegui estimar o BPM automaticamente — digite à mão no campo BPM.');
    }
}

function toggleEditorAudioPlayback() {
    if (editorState.isRefAudioPlaying) {
        stopEditorPlayback();
        // Ponto de retorno marcado (R): pausar volta pra ele — o próximo Play recomeça dali
        if (editorState.cueMs != null) goToEditorTime(editorState.cueMs / 1000);
    } else startEditorPlayback();
}

// Liga/desliga o PONTO DE RETORNO na posição atual (tecla R): enquanto estiver marcado, toda
// vez que pausar a música a leitura volta pra ele, pra ouvir/ajustar o mesmo trecho de novo.
function toggleEditorCuePoint() {
    const t = getEditorElapsedMs();
    if (editorState.cueMs != null && Math.abs(editorState.cueMs - t) <= Math.max(200, 60000 / editorState.bpm)) {
        editorState.cueMs = null;
        flashEditorStatus('↩ Ponto de retorno removido.');
    } else {
        editorState.cueMs = Math.max(0, Math.round(t));
        flashEditorStatus(`↩ Ponto de retorno em ${formatEditorTime(editorState.cueMs)} — ao pausar, a música volta pra cá. (R de novo aqui remove)`);
    }
    updateEditorCueUI();
    renderEditorCanvas();
}
function updateEditorCueUI() {
    const b = document.getElementById('btn-editor-cue');
    if (!b) return;
    b.innerHTML = editorState.cueMs != null
        ? `<i class="fa-solid fa-rotate-left mr-1"></i> Retorno ${formatEditorTime(editorState.cueMs)} (R)`
        : '<i class="fa-solid fa-rotate-left mr-1"></i> Ponto de retorno (R)';
    b.classList.toggle('border-emerald-400', editorState.cueMs != null);
}

// Player de mídia (com o tom preservado) pra tocar a música mais devagar no editor.
function editorAudioBufferToWavBlob(buf) {
    const ch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate, len = buf.length;
    const bytes = 44 + len * ch * 2;
    const ab = new ArrayBuffer(bytes);
    const dv = new DataView(ab);
    const wstr = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
    wstr(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); wstr(8, 'WAVE'); wstr(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    wstr(36, 'data'); dv.setUint32(40, len * ch * 2, true);
    const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
        const v = Math.max(-1, Math.min(1, data[c][i]));
        dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
    }
    return new Blob([ab], { type: 'audio/wav' });
}
function getEditorMediaElement() {
    if (!editorState.mediaEl) {
        editorState.mediaEl = new Audio();
        editorState.mediaEl.preload = 'auto';
    }
    const el = editorState.mediaEl;
    if (editorState.mediaSourceBuffer !== editorState.audioBuffer) {
        if (editorState.mediaUrl) URL.revokeObjectURL(editorState.mediaUrl);
        const blob = editorState.audioFileBlob || editorAudioBufferToWavBlob(editorState.audioBuffer);
        editorState.mediaUrl = URL.createObjectURL(blob);
        el.src = editorState.mediaUrl;
        editorState.mediaSourceBuffer = editorState.audioBuffer;
    }
    return el;
}

// Posição atual da "cabeça de leitura" do editor, em milissegundos — tocando, é calculada
// a partir do relógio de performance.now() (mesma base do RAF de startEditorPlayback) MAIS
// o globalOffset calibrado pelo usuário (Configurações > calibrar), exatamente como o
// currentTime do jogo de verdade (`performance.now() - startTime + globalOffset` em
// render()) — sem isso, uma nota gravada no "sente certo" do simulador ficava com um
// deslocamento constante (do tamanho do globalOffset calibrado) na hora de jogar de
// verdade, porque um relógio levava o offset em conta e o outro não. Pausada, é lida
// direto do scroll (é o mesmo valor que startEditorPlayback usaria como offset inicial) —
// aí NÃO entra offset, porque é navegação manual, não julgamento em tempo real.
// Único ponto de cálculo, reaproveitado pelo playback, pelo seek e pela gravação do modo
// simulador — assim os três nunca podem ficar com contas diferentes.
function getEditorElapsedMs() {
    if (editorState.isRefAudioPlaying && editorState.mediaPlaying && editorState.mediaEl) {
        // Música mais lenta SEM ficar grave (player de mídia do navegador, com preservesPitch):
        // a posição vem do próprio player, suavizada entre as atualizações dele.
        const el = editorState.mediaEl;
        const speed = editorState.practiceSpeed || 1.0;
        const t = el.currentTime;
        const nowP = performance.now();
        if (t !== editorState.mediaLastT) { editorState.mediaLastT = t; editorState.mediaLastPerf = nowP; }
        const extra = el.paused ? 0 : Math.min(0.12, (nowP - editorState.mediaLastPerf) / 1000 * speed);
        return (t + extra) * 1000 + globalOffset;
    }
    if (editorState.isRefAudioPlaying) {
        // practiceSpeed só muda a velocidade que o relógio de parede avança AQUI — o tempo
        // devolvido continua sendo a posição REAL da música (áudio + notas caindo continuam
        // em sincronia entre si, só tudo junto mais devagar). Nada do que é GRAVADO ou
        // SALVO passa por essa conta de novo, então não distorce o chart (ver comentário em
        // editorState.practiceSpeed).
        const speed = editorState.practiceSpeed || 1.0;
        const wallElapsedSec = (performance.now() - editorState.playStartPerf) / 1000;
        return (editorState.playStartOffsetSec + wallElapsedSec * speed) * 1000 + globalOffset;
    }
    // Modo Simulador não tem scroll (canvas de tamanho fixo — ver layoutEditorCanvasGame),
    // então a posição pausada vive num campo próprio em vez de "emprestar" o scrollTop do
    // wrap como a grade faz.
    if (editorState.simulatorMode) return editorState.gamePausedMs;
    // Na grade clássica o tempo agora sobe pra cima (ver editorTimeToAbsY) — então a "posição
    // atual" pausada passa a ser lida da BORDA DE BAIXO da janela visível (scrollTop +
    // clientHeight), não mais do topo: é o espelho exato de como era antes (era a borda de
    // cima, já que o tempo descia). Sem essa troca, o valor lido ficaria de cabeça pra baixo
    // (leria uma posição no futuro da música, não a que a pessoa está realmente vendo).
    const wrap = document.getElementById('editor-canvas-wrap');
    // Nunca negativo: com uma música curta numa janela alta, a borda de baixo da janela pode
    // ficar "antes do começo" da timeline — isso é só o começo da música (0).
    return wrap ? Math.max(0, editorAbsYToTime(wrap.scrollTop + wrap.clientHeight)) : 0;
}

function startEditorPlayback() {
    if (editorState.isRefAudioPlaying) return;
    const wrap = document.getElementById('editor-canvas-wrap');
    // Grade clássica: mesma borda de baixo usada por getEditorElapsedMs (ver comentário lá) —
    // tem que ser exatamente a mesma conta, senão o play começaria de um instante diferente
    // do que o display de tempo/pausa mostrava um instante atrás.
    const startOffsetSec = editorState.simulatorMode
        ? (editorState.gamePausedMs / 1000)
        : (wrap ? (editorAbsYToTime(wrap.scrollTop + wrap.clientHeight) / 1000) : 0);
    editorState.playStartOffsetSec = startOffsetSec;
    editorState.playStartPerf = performance.now();
    editorState.isRefAudioPlaying = true;
    // Realinha o "até onde já demos clap" pro ponto de início deste play (novo play OU seek
    // no meio de um play já em andamento, que reinicia por aqui de novo) — sem isso, um seek
    // pra frente faria todas as notas "puladas" tocarem clap de uma vez ao reiniciar.
    editorState.lastClapMs = startOffsetSec * 1000;
    // Gravação armada (botão "Gravar com Teclas") + música tocando = gravando de verdade —
    // funciona igual na grade clássica e no visual do Simulador, já que agora são
    // independentes (ver editorState.recordingArmed). Zera qualquer tecla que tenha ficado
    // "presa" de uma sessão de gravação anterior antes de começar esta.
    editorState.isRecording = editorState.recordingArmed;
    editorState.recordingHeld = {};
    editorState.lastRecordedIndex = -1;
    updateEditorSimulatorUI();

    editorState.mediaPlaying = false;
    const slowSpeed = (editorState.practiceSpeed || 1.0) !== 1 && editorState.audioBuffer;
    if (slowSpeed) {
        try {
            const el = getEditorMediaElement();
            const safeOffset = Math.max(0, Math.min(startOffsetSec, editorState.audioBuffer.duration - 0.01));
            el.playbackRate = editorState.practiceSpeed;
            el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true;
            el.volume = Math.max(0, Math.min(1, audio.volume));
            el.currentTime = safeOffset;
            editorState.mediaLastT = el.currentTime;
            editorState.mediaLastPerf = performance.now();
            el.onended = () => { if (editorState.mediaPlaying) stopEditorPlayback(); };
            const pr = el.play();
            if (pr && pr.catch) pr.catch(() => {});
            editorState.mediaPlaying = true;
        } catch (e) { editorState.mediaPlaying = false; }
    }
    if (editorState.audioBuffer && !editorState.mediaPlaying) {
        try {
            audio.init();
            const source = audio.ctx.createBufferSource();
            source.buffer = editorState.audioBuffer;
            // Mesma velocidade "de teste" usada em getEditorElapsedMs — áudio e notas caindo
            // andam sempre juntos, só mudando quão rápido em relação ao relógio de parede.
            source.playbackRate.value = editorState.practiceSpeed || 1.0;
            const gain = audio.ctx.createGain();
            gain.gain.setValueAtTime(audio.volume, audio.ctx.currentTime);
            source.connect(gain);
            gain.connect(audio.ctx.destination);
            const safeOffset = Math.max(0, Math.min(startOffsetSec, editorState.audioBuffer.duration - 0.01));
            source.start(0, safeOffset);
            source.onended = () => { if (editorState.audioSourceNode === source) stopEditorPlayback(); };
            editorState.audioSourceNode = source;
            editorState.audioGainNode = gain;
        } catch (e) { /* offset fora do intervalo ou áudio ainda terminando de decodificar */ }
    }

    const btn = document.getElementById('btn-editor-playpause');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-pause mr-1"></i> Play/Pause (Espaço)';
    const playhead = document.getElementById('editor-playhead');
    if (playhead) playhead.classList.remove('hidden');

    const step = () => {
        if (!editorState.isRefAudioPlaying) return;
        const elapsedSec = getEditorElapsedMs() / 1000;
        const nowMs = elapsedSec * 1000;

        // "Clap" de teste: toca pra cada nota cujo início (note.time) ficou pra trás do
        // playhead DESDE O ÚLTIMO FRAME (janela lastClapMs..nowMs) — não só "a mais próxima",
        // senão notas bem coladas perderiam o clap umas das outras. Só o INÍCIO da nota conta
        // (não o fim de uma hold) — é o que confirma se ela está em cima da batida.
        if (editorState.clapEnabled && nowMs > editorState.lastClapMs) {
            for (let i = 0; i < editorState.notes.length; i++) {
                const n = editorState.notes[i];
                if (n.time > editorState.lastClapMs && n.time <= nowMs) { audio.playClap(); break; }
            }
        }
        editorState.lastClapMs = nowMs;

        if (editorState.simulatorMode) {
            // Visual de jogo de verdade: não tem timeline pra rolar (playhead fixo/não usado
            // aqui) — as notas é que se movem a cada frame, então precisa redesenhar sempre.
            if (playhead) playhead.classList.add('hidden');
            renderEditorCanvas();
        } else {
            // Tempo sobe pra cima na grade agora — o "futuro" (mais tocado ainda por vir) fica
            // ACIMA da cabeça de leitura, não abaixo como antes. Pra manter a mesma folga
            // visual de antes (deixava ~60% da tela mostrando o que ainda vinha), espelha a
            // fração: antes a cabeça ficava a 40% do topo (60% de folga embaixo, pro futuro
            // que vinha descendo); agora fica a 60% do topo = 40% de baixo pra cima, sobrando
            // 60% ACIMA dela pra esse mesmo futuro que agora sobe.
            const yAbs = editorTimeToAbsY(elapsedSec * 1000);
            if (playhead) { playhead.style.top = yAbs + 'px'; playhead.classList.remove('hidden'); }
            if (wrap) wrap.scrollTop = Math.max(0, yAbs - wrap.clientHeight * 0.6);
        }

        const timeDisp = document.getElementById('editor-time-display');
        if (timeDisp) timeDisp.textContent = `${formatEditorTime(elapsedSec * 1000)} / ${formatEditorTime(editorState.duration * 1000)}`;

        if (elapsedSec >= editorState.duration) {
            stopEditorPlayback();
            return;
        }
        editorState.playbackRAF = requestAnimationFrame(step);
    };
    editorState.playbackRAF = requestAnimationFrame(step);
}

// Avança/retrocede a "cabeça de leitura" do editor em `deltaSec` segundos (negativo pra
// voltar). A posição atual é sempre = wrap.scrollTop / zoom (é o mesmo valor que
// startEditorPlayback usa como offset inicial), então mover o scroll já move a posição —
// se estiver tocando, reinicia o playback nesse novo ponto (áudio + timer) pra não desincronizar.
function seekEditorPlayback(deltaSec) {
    // Pular tempo no meio de uma gravação é seguro: goToEditorTime chama
    // stopEditorPlayback() quando estava tocando (fecha corretamente o trecho gravado até
    // aqui — mesma lógica de pausar com Esc, qualquer tecla ainda segurada vira tap, não
    // perde a nota) e startEditorPlayback() no final RETOMA a gravação automaticamente na
    // nova posição, já que o Simulador continua armado. Dá pra avançar/retroceder à
    // vontade, inclusive tocando, sem perder o que já foi gravado.
    const currentSec = getEditorElapsedMs() / 1000;
    goToEditorTime(currentSec + deltaSec);
}

// Pula a leitura direto pra um instante ABSOLUTO (em segundos) da música — extraído de
// seekEditorPlayback (que só soma um delta relativo) pra ser reaproveitado também pelo
// pulo direto a um pin (jumpToEditorPin) e por qualquer outro "ir pra X" que apareça no
// futuro, sem duplicar a lógica de pausar/retomar/atualizar a UI.
function goToEditorTime(targetSec) {
    const wrap = document.getElementById('editor-canvas-wrap');
    if (!wrap) return;
    const wasPlaying = editorState.isRefAudioPlaying;
    targetSec = Math.max(0, Math.min(editorState.duration, targetSec));

    if (wasPlaying) stopEditorPlayback();
    if (editorState.simulatorMode) {
        editorState.gamePausedMs = targetSec * 1000;
    } else {
        // Grade clássica: mesma borda de baixo usada por getEditorElapsedMs/startEditor-
        // Playback (ver comentários lá) — coloca o instante alvo na base da janela visível,
        // com o "futuro" (que agora sobe) sobrando acima dele.
        wrap.scrollTop = Math.max(0, editorTimeToAbsY(targetSec * 1000) - wrap.clientHeight);
    }

    const timeDisp = document.getElementById('editor-time-display');
    if (timeDisp) timeDisp.textContent = `${formatEditorTime(targetSec * 1000)} / ${formatEditorTime(editorState.duration * 1000)}`;

    if (wasPlaying) {
        startEditorPlayback();
    } else if (editorState.simulatorMode) {
        renderEditorCanvas(); // sem playhead no visual de jogo — a própria posição das notas já mostra onde parou
    } else {
        // Dá um feedback visual rápido de onde a cabeça de leitura ficou, mesmo pausado.
        const playhead = document.getElementById('editor-playhead');
        if (playhead) {
            playhead.style.top = editorTimeToAbsY(targetSec * 1000) + 'px';
            playhead.classList.remove('hidden');
            clearTimeout(editorState.seekPlayheadTimeout);
            editorState.seekPlayheadTimeout = setTimeout(() => {
                if (!editorState.isRefAudioPlaying) playhead.classList.add('hidden');
            }, 1200);
        }
    }
}

// --- Pins: marcadores de navegação, só pra se nortear na tela (NUNCA lidos por
// generateNotes()/julgamento do jogo real — ver editorState.pins). 'P' alterna: se já
// existe um pin bem perto da posição atual, remove; senão, cria um novo ali.
function toggleEditorPin() {
    const t = getEditorElapsedMs();
    const tolMs = Math.max(200, 60000 / editorState.bpm); // ~1 tempo de tolerância pra "clicar nele de novo" remover
    const existingIdx = editorState.pins.findIndex(p => Math.abs(p - t) <= tolMs);
    if (existingIdx !== -1) {
        editorState.pins.splice(existingIdx, 1);
        flashEditorStatus('📌 Pin removido.');
    } else {
        editorState.pins.push(Math.round(t));
        editorState.pins.sort((a, b) => a - b);
        flashEditorStatus('📌 Pin adicionado.');
    }
    renderEditorPinsList();
    // A barra de pins pode ter acabado de aparecer/sumir (ver renderEditorPinsList), o que
    // muda a altura disponível pro canvas — sem isso, a "gear" só se ajustaria ao tamanho
    // certo na próxima interação (scroll, resize da janela etc.), não na hora.
    resizeEditorCanvas();
    renderEditorCanvas();
}

// Pula direto pra um pin específico (chip clicado na lista — ver renderEditorPinsList).
function jumpToEditorPin(ms) {
    goToEditorTime(ms / 1000);
}

function removeEditorPin(ms) {
    editorState.pins = editorState.pins.filter(p => p !== ms);
    renderEditorPinsList();
    resizeEditorCanvas();
    renderEditorCanvas();
}

// Desenha a lista de chips (tempo formatado + "×" pra remover) — clicar no tempo pula pra
// lá, clicar no "×" remove só aquele pin.
function renderEditorPinsList() {
    const container = document.getElementById('editor-pins-list');
    const bar = document.getElementById('editor-pins-bar');
    if (!container) return;
    container.innerHTML = '';
    const hasPins = editorState.pins && editorState.pins.length > 0;
    // A barra inteira some quando não há pin nenhum — em vez de mostrar uma linha vazia
    // "Nenhum pin ainda" à toa, devolve essa altura pro resto da tela (o botão "Pin (P)" já
    // explica a funcionalidade sozinho, via tooltip). Isso ajuda principalmente o visual do
    // Modo Simulador, que é sensível a cada linha de cabeçalho a mais.
    if (bar) bar.classList.toggle('hidden', !hasPins);
    if (bar) bar.classList.toggle('flex', hasPins);
    if (!hasPins) return;
    editorState.pins.forEach(ms => {
        const chip = document.createElement('div');
        chip.className = 'flex items-center gap-1 bg-amber-500/20 border border-amber-500/50 rounded px-1.5 py-0.5 text-[10px] font-mono text-amber-200';
        const label = document.createElement('span');
        label.textContent = formatEditorTime(ms);
        label.className = 'cursor-pointer hover:text-white';
        label.title = 'Clique para pular até este pin';
        label.addEventListener('click', () => jumpToEditorPin(ms));
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.className = 'text-amber-300 hover:text-white font-bold leading-none px-0.5';
        removeBtn.title = 'Remover este pin';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeEditorPin(ms);
        });
        chip.appendChild(label);
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
}

// --- Seções nomeadas: evolução dos pins acima, inspirada no Section.cs/PlaceSection.cs do
// Moonscraper Chart Editor — cada seção é só um NOME + um instante (o "fim" de uma seção é
// IMPLÍCITO: é onde a próxima seção começa, ou o fim da música pra última — igual em
// Moonscraper/Clone Hero, sem precisar guardar um intervalo). 'N' alterna: se já existe uma
// seção bem perto da posição atual, oferece renomear/remover; senão, pede um nome e cria uma
// nova ali. Só apoio de navegação/estrutura — NUNCA lida por generateNotes()/julgamento do
// jogo real (ver editorState.sections), igual aos pins.
function toggleEditorAddSection() {
    const t = getEditorElapsedMs();
    const tolMs = Math.max(200, 60000 / editorState.bpm);
    const existing = editorState.sections.find(s => Math.abs(s.time - t) <= tolMs);
    if (existing) {
        const novoNome = prompt('Renomear esta seção (deixe vazio pra remover):', existing.name);
        if (novoNome === null) return; // cancelou — não mexe em nada
        if (novoNome.trim() === '') {
            editorState.sections = editorState.sections.filter(s => s !== existing);
            flashEditorStatus('🚩 Seção removida.');
        } else {
            existing.name = novoNome.trim().slice(0, 40);
            flashEditorStatus(`🚩 Seção renomeada: ${existing.name}`);
        }
    } else {
        const nome = prompt('Nome da nova seção:', `Seção ${editorState.sections.length + 1}`);
        if (nome === null || nome.trim() === '') return; // cancelou ou deixou vazio
        const nomeFinal = nome.trim().slice(0, 40);
        editorState.sections.push({ time: Math.round(t), name: nomeFinal });
        editorState.sections.sort((a, b) => a.time - b.time);
        flashEditorStatus(`🚩 Seção "${nomeFinal}" adicionada.`);
    }
    renderEditorSectionsList();
    resizeEditorCanvas();
    renderEditorCanvas();
}

// Pula direto pra uma seção específica (chip clicado na lista — ver renderEditorSectionsList).
// ===== Mudanças de BPM (tecla B / botão "♩ BPM") =====
function formatBpmValue(bpm) {
    return (Math.round(bpm * 100) / 100).toString().replace('.', ',');
}

function parseBpmInput(v) {
    const n = parseFloat(String(v).trim().replace(',', '.'));
    return (isFinite(n) && n >= 20 && n <= 999) ? Math.round(n * 100) / 100 : null;
}

// Marca/edita/remove uma mudança de BPM na posição atual (encaixada na grade). Clicar de novo
// perto de uma mudança já existente abre ela pra editar (vazio = remover), igual às seções.
// As notas NÃO se mexem quando o BPM muda: elas ficam presas no tempo real da música (em ms);
// o que muda é a grade/snap dali pra frente — que é o que se quer ao mapear uma música que
// acelera/desacelera.
function toggleEditorBpmChange() {
    const t = snapEditorTime(getEditorElapsedMs());
    if (!Array.isArray(editorState.bpmChanges)) editorState.bpmChanges = [];
    const tolMs = Math.max(120, editorSnapMsAt(t) * 0.75);
    const existing = editorState.bpmChanges.find(c => Math.abs(c.time - t) <= tolMs);
    if (existing) {
        const v = prompt(`BPM a partir de ${formatEditorTime(existing.time)} (deixe vazio pra remover a mudança):`, formatBpmValue(existing.bpm));
        if (v === null) return;
        if (v.trim() === '') {
            editorState.bpmChanges = editorState.bpmChanges.filter(c => c !== existing);
            flashEditorStatus('♩ Mudança de BPM removida.');
        } else {
            const bpm = parseBpmInput(v);
            if (bpm == null) { flashEditorStatus('BPM inválido — use um número entre 20 e 999.'); return; }
            existing.bpm = bpm;
            flashEditorStatus(`♩ BPM agora é ${formatBpmValue(bpm)} a partir de ${formatEditorTime(existing.time)}.`);
        }
    } else {
        if (t <= 0) { flashEditorStatus('No começo da música o BPM é o do campo BPM lá em cima — avance um pouco pra marcar uma mudança.'); return; }
        const v = prompt(`Novo BPM a partir de ${formatEditorTime(t)}:`, formatBpmValue(editorBpmAt(t)));
        if (v === null || v.trim() === '') return;
        const bpm = parseBpmInput(v);
        if (bpm == null) { flashEditorStatus('BPM inválido — use um número entre 20 e 999.'); return; }
        editorState.bpmChanges.push({ time: t, bpm });
        flashEditorStatus(`♩ Mudança pra ${formatBpmValue(bpm)} BPM marcada em ${formatEditorTime(t)} — a grade dali pra frente segue o novo BPM.`);
    }
    editorState.bpmChanges = sanitizeBpmChanges(editorState.bpmChanges);
    renderEditorCanvas();
}

function removeEditorBpmChange(ms) {
    editorState.bpmChanges = (editorState.bpmChanges || []).filter(c => c.time !== ms);
    renderEditorCanvas();
}

// Linha laranja cheia + rótulo "♩ 180 BPM", nos visuais planos (grade e Simulador).
function drawEditorBpmMarkersFlat(ctx2, width, yOf, yMin, yMax) {
    const changes = editorState.bpmChanges || [];
    if (!changes.length) return;
    ctx2.save();
    ctx2.strokeStyle = '#fb923c';
    ctx2.lineWidth = 2;
    ctx2.setLineDash([]);
    ctx2.font = 'bold 10px monospace';
    ctx2.textAlign = 'right';
    changes.forEach(c => {
        const y = yOf(c.time);
        if (y < yMin || y > yMax) return;
        ctx2.beginPath();
        ctx2.moveTo(0, y + 0.5);
        ctx2.lineTo(width, y + 0.5);
        ctx2.stroke();
        ctx2.fillStyle = '#fdba74';
        ctx2.fillText(`♩ ${formatBpmValue(c.bpm)} BPM`, width - 4, y - 3);
    });
    ctx2.restore();
}

function jumpToEditorSection(ms) {
    goToEditorTime(ms / 1000);
}

function removeEditorSection(ms) {
    editorState.sections = editorState.sections.filter(s => s.time !== ms);
    renderEditorSectionsList();
    resizeEditorCanvas();
    renderEditorCanvas();
}

// Desenha a lista de chips (tempo + nome, "×" pra remover) — clicar no chip pula pra lá,
// clicar no "×" remove só aquela seção. Mesmo padrão visual/estrutural de renderEditorPinsList,
// só com cor diferente (violeta) pra não confundir os dois tipos de marcador na tela.
function renderEditorSectionsList() {
    const container = document.getElementById('editor-sections-list');
    const bar = document.getElementById('editor-sections-bar');
    if (!container) return;
    container.innerHTML = '';
    const hasSections = editorState.sections && editorState.sections.length > 0;
    if (bar) bar.classList.toggle('hidden', !hasSections);
    if (bar) bar.classList.toggle('flex', hasSections);
    if (!hasSections) return;
    editorState.sections.forEach(s => {
        const chip = document.createElement('div');
        chip.className = 'flex items-center gap-1 bg-violet-500/20 border border-violet-500/50 rounded px-1.5 py-0.5 text-[10px] font-mono text-violet-200';
        const label = document.createElement('span');
        label.textContent = `${formatEditorTime(s.time)} ${s.name}`;
        label.className = 'cursor-pointer hover:text-white max-w-[140px] truncate';
        label.title = 'Clique para pular até esta seção — marque de novo na mesma posição (N) pra renomear';
        label.addEventListener('click', () => jumpToEditorSection(s.time));
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.className = 'text-violet-300 hover:text-white font-bold leading-none px-0.5 shrink-0';
        removeBtn.title = 'Remover esta seção';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeEditorSection(s.time);
        });
        chip.appendChild(label);
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
}

// --- Verificação do chart: checagens rápidas antes de salvar/exportar, inspiradas no
// SongValidate.cs/ValidationMenu.cs do Moonscraper — lá as checagens são de formato de
// arquivo/MIDI (chords abertos, limite de seções do GH3 etc.); aqui são as que fazem sentido
// pro nosso formato de jogo de teclas. NADA aqui bloqueia salvar/exportar — é só um aviso pra
// pegar engano comum antes de descobrir jogando (nota fora da duração, BPM digitado errado,
// duas notas coladas demais na mesma lane pra dar tempo humano de reação, etc.).
function validateEditorChart() {
    const warnings = []; // { level: 'error'|'warn'|'ok', text }
    const totalMs = editorState.duration * 1000;
    const notes = editorState.notes;

    if (!editorState.audioBuffer) {
        warnings.push({ level: 'warn', text: 'Nenhum áudio importado ainda — esse chart não vai tocar música na hora de jogar.' });
    }
    if (notes.length === 0) {
        warnings.push({ level: 'error', text: 'Nenhuma nota criada ainda neste chart.' });
    }
    (editorState.bpmChanges || []).forEach(c => {
        if (c.time > editorState.duration * 1000) warnings.push({ level: 'warn', text: `Mudança de BPM em ${formatEditorTime(c.time)} está depois do fim da música — não tem efeito.` });
        if (c.bpm < 40 || c.bpm > 400) warnings.push({ level: 'warn', text: `Mudança de BPM incomum (${formatBpmValue(c.bpm)}) em ${formatEditorTime(c.time)} — confira.` });
    });
    if (editorState.bpm < 40 || editorState.bpm > 400) {
        warnings.push({ level: 'warn', text: `BPM incomum (${editorState.bpm}) — confira se não foi engano de digitação.` });
    }
    if (editorState.audioBuffer) {
        const audioDurSec = editorState.audioBuffer.duration;
        const diffSec = Math.abs(audioDurSec - editorState.duration);
        if (diffSec > 5) {
            warnings.push({ level: 'warn', text: `A duração do chart (${formatEditorTime(totalMs)}) está bem diferente da duração do áudio importado (${formatEditorTime(audioDurSec * 1000)}) — confira o campo "Duração".` });
        }
    }

    // Notas fora da duração do chart (depois do fim da música, ou com tempo negativo).
    let outOfRange = 0;
    notes.forEach(n => {
        if (n.time < 0 || n.time > totalMs || (n.holdEnd != null && n.holdEnd > totalMs)) outOfRange++;
    });
    if (outOfRange > 0) {
        warnings.push({ level: 'error', text: `${outOfRange} nota(s) fora da duração da música (depois do fim, ou com tempo negativo).` });
    }

    // Notas muito coladas (ou sobrepostas) na MESMA lane — abaixo de meio-tempo de 32avos não
    // dá tempo humano de reação real; normalmente é engano de clique duplo ou uma hold que
    // ficou se sobrepondo à próxima nota sem querer.
    const minGapMs = Math.max(20, (60000 / editorState.bpm) / 8);
    const byLane = {};
    notes.forEach(n => { (byLane[n.lane] = byLane[n.lane] || []).push(n); });
    let overlapCount = 0;
    Object.values(byLane).forEach(list => {
        list.sort((a, b) => a.time - b.time);
        for (let i = 1; i < list.length; i++) {
            const prevEnd = list[i - 1].holdEnd != null ? list[i - 1].holdEnd : list[i - 1].time;
            if (list[i].time < prevEnd + minGapMs) overlapCount++;
        }
    });
    if (overlapCount > 0) {
        warnings.push({ level: 'warn', text: `${overlapCount} par(es) de notas muito coladas (ou sobrepostas) na mesma lane — pode ficar impossível de tocar, ou ser uma nota duplicada por engano.` });
    }

    if (warnings.length === 0) {
        warnings.push({ level: 'ok', text: 'Nenhum problema encontrado — o chart parece consistente!' });
    }
    return warnings;
}

function showEditorValidationReport() {
    const warnings = validateEditorChart();
    const container = document.getElementById('editor-validate-results');
    const modal = document.getElementById('editor-validate-modal');
    if (!container || !modal) return;
    container.innerHTML = '';
    const styles = {
        error: 'bg-red-950/50 border border-red-700/50 text-red-200',
        warn: 'bg-amber-950/50 border border-amber-700/50 text-amber-200',
        ok: 'bg-emerald-950/50 border border-emerald-700/50 text-emerald-200',
    };
    const icons = { error: '❌', warn: '⚠️', ok: '✅' };
    warnings.forEach(w => {
        const row = document.createElement('div');
        row.className = `rounded px-3 py-2 ${styles[w.level] || styles.warn}`;
        row.textContent = `${icons[w.level] || '⚠️'} ${w.text}`;
        container.appendChild(row);
    });
    modal.classList.remove('hidden');
}

function closeEditorValidationReport() {
    document.getElementById('editor-validate-modal')?.classList.add('hidden');
}

// --- Autosave: protege contra fechar a aba/travar o navegador sem ter salvo manualmente
// ainda. Inspirado no AutoSaveSystem.cs do Moonscraper (lá grava um arquivo .chart separado a
// cada 60s): aqui grava um snapshot leve (notas/pins/seções/metadados — SEM o áudio, que já
// fica seguro no IndexedDB assim que salvo manualmente uma vez, ver saveChartAudioBlob) num
// slot separado do localStorage, nunca sobrescrevendo o chart salvo de verdade
// (saveCurrentEditorChart). Puramente um seguro contra perda de trabalho — nunca é lido pelo
// jogo nem conta como "o chart salvo" sozinho.
const EDITOR_AUTOSAVE_KEY = 'djmax_editor_autosave_v1';
const EDITOR_AUTOSAVE_INTERVAL_MS = 30000; // a cada 30s
let editorAutosaveTimer = null;
let editorLastAutosaveJSON = null;

function startEditorAutosaveTimer() {
    if (editorAutosaveTimer) return; // já rodando — idempotente, seguro chamar de novo
    editorAutosaveTimer = setInterval(runEditorAutosave, EDITOR_AUTOSAVE_INTERVAL_MS);
}

function runEditorAutosave() {
    const modal = document.getElementById('chart-editor-modal');
    if (!modal || modal.classList.contains('hidden')) return; // editor fechado, nada pra proteger agora
    if (editorState.notes.length === 0) return; // nada de valor pra proteger ainda

    const snapshot = {
        id: editorState.id,
        title: editorState.title,
        mode: editorState.mode,
        bpm: editorState.bpm,
        snap: editorState.snap,
        duration: editorState.duration,
        notes: editorState.notes,
        pins: editorState.pins,
        sections: editorState.sections,
        bpmChanges: editorState.bpmChanges,
        songEndMs: editorState.songEndMs,
        difficulty: editorState.difficulty || null,
        savedAt: Date.now()
    };
    const json = JSON.stringify(snapshot);
    // Compara SEM o campo savedAt (senão nunca bateria igual, já que muda a cada chamada) —
    // só regrava de verdade quando o CONTEÚDO mudou, pra não gastar localStorage à toa.
    const jsonNoTimestamp = json.replace(/"savedAt":\d+/, '"savedAt":0');
    if (jsonNoTimestamp === editorLastAutosaveJSON) return;
    try {
        localStorage.setItem(EDITOR_AUTOSAVE_KEY, json);
        editorLastAutosaveJSON = jsonNoTimestamp;
    } catch (e) {
        console.warn('Autosave do chart falhou (não afeta o chart em edição, só a recuperação em caso de fechar sem salvar):', e);
    }
}

function readEditorAutosave() {
    try {
        const raw = localStorage.getItem(EDITOR_AUTOSAVE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

// Oferece recuperar um autosave só quando ele é RELEVANTE pro momento: é do mesmo chart que
// está sendo aberto agora (id bate), ou nenhum chart específico foi pedido (aí é o candidato
// mais provável do que a pessoa quer continuar). Chamado logo depois de abrir o editor.
function maybeOfferEditorAutosaveRecovery(requestedChartId) {
    const snap = readEditorAutosave();
    if (!snap || !Array.isArray(snap.notes) || snap.notes.length === 0) return;
    const relevant = (requestedChartId == null) || (snap.id === requestedChartId);
    if (!relevant) return;
    // Se o que já está carregado é idêntico ao autosave, não tem nada "extra" pra recuperar —
    // evita perguntar à toa toda vez que abre um chart sem alterações desde o último save.
    const alreadyIdentical = editorState.id === snap.id
        && JSON.stringify(editorState.notes) === JSON.stringify(snap.notes)
        && JSON.stringify(editorState.pins) === JSON.stringify(snap.pins || [])
        && JSON.stringify(editorState.sections) === JSON.stringify(snap.sections || [])
        && JSON.stringify(editorState.bpmChanges || []) === JSON.stringify(sanitizeBpmChanges(snap.bpmChanges));
    if (alreadyIdentical) return;
    // O rascunho é igual ao que JÁ ESTÁ SALVO na biblioteca (ou mais velho que o último save):
    // não tem nada perdido — antes perguntava "alterações não salvas" à toa toda vez que abria
    // o editor (e a caixa de pergunta do navegador ainda tirava o jogo da tela cheia).
    const saved = snap.id ? findCustomChart(snap.id) : null;
    if (saved) {
        const norm = (arr) => (arr || []).map(n => `${Math.round(n.time)}|${n.lane}|${n.holdEnd != null ? Math.round(n.holdEnd) : ''}`).sort().join(',');
        const same = norm(saved.notes) === norm(snap.notes);
        if (same || (saved.updatedAt && snap.savedAt && saved.updatedAt >= snap.savedAt)) {
            try { localStorage.removeItem(EDITOR_AUTOSAVE_KEY); } catch (e) {}
            return;
        }
    }

    const minsAgo = Math.max(0, Math.round((Date.now() - (snap.savedAt || 0)) / 60000));
    const tempoTexto = minsAgo <= 1 ? 'menos de 1 minuto' : `~${minsAgo} minutos`;
    const msg = `Encontramos alterações não salvas de "${snap.title || 'um chart'}" (${snap.notes.length} notas) de ${tempoTexto} atrás — provavelmente de uma sessão que fechou sem dar tempo de salvar. Restaurar essas alterações agora?`;
    if (confirm(msg)) {
        editorState.id = snap.id;
        editorState.title = snap.title || editorState.title;
        editorState.mode = snap.mode || editorState.mode;
        editorState.bpm = snap.bpm || editorState.bpm;
        editorState.snap = snap.snap || editorState.snap;
        editorState.duration = snap.duration || editorState.duration;
        editorState.notes = snap.notes.map(n => ({ time: n.time, lane: n.lane, holdEnd: n.holdEnd ?? null }));
        editorState.pins = (snap.pins || []).slice();
        editorState.sections = (snap.sections || []).map(s => ({ time: s.time, name: s.name }));
        editorState.bpmChanges = sanitizeBpmChanges(snap.bpmChanges);
        editorState.songEndMs = typeof snap.songEndMs === 'number' ? snap.songEndMs : null;
        setEditorFormValue('editor-title', editorState.title);
        setEditorFormValue('editor-mode', editorState.mode);
        setEditorFormValue('editor-bpm', editorState.bpm);
        setEditorFormValue('editor-snap', String(editorState.snap)); if (typeof updateEditorSnapButtons === 'function') updateEditorSnapButtons();
        setEditorFormValue('editor-duration', editorState.duration);
        renderEditorPinsList();
        renderEditorSectionsList();
        resizeEditorCanvas();
        scrollEditorGridToStart();
        renderEditorCanvas();
        flashEditorStatus('♻️ Alterações recuperadas do autosave — não esqueça de salvar de verdade (botão Salvar) pra não depender só dele.');
    }
}

function stopEditorPlayback() {
    // Modo Simulador não tem scrollTop pra "lembrar" a posição sozinho (ver getEditorElapsedMs)
    // — precisa congelar o instante atual explicitamente antes de desligar isRefAudioPlaying,
    // senão a próxima leitura pausada voltaria pra onde gamePausedMs estava antes de tocar.
    if (editorState.simulatorMode && editorState.isRefAudioPlaying) {
        editorState.gamePausedMs = getEditorElapsedMs();
    }
    editorState.isRefAudioPlaying = false;
    // Se parou no meio de uma nota ainda sendo gravada (tecla segurada quando a música
    // parou/acabou), ela já está em editorState.notes como tap desde o keydown — só
    // limpa o controle, sem tentar "completar" a hold retroativamente.
    const wasRecording = editorState.isRecording;
    editorState.isRecording = false;
    editorState.recordingHeld = {};
    // Pra "gravar por partes" (segmentos curtos, pausar, ajustar, continuar) ser fácil de
    // usar: ao pausar uma sessão de gravação, já seleciona (destaca em branco) a ÚLTIMA nota
    // criada nela — o usuário não precisa procurar na tela pra achar o que acabou de gravar
    // e arrastar/ajustar/apagar.
    if (wasRecording && editorState.lastRecordedIndex !== -1) {
        editorState.selectedIndex = editorState.lastRecordedIndex;
    }
    updateEditorSimulatorUI();
    if (editorState.playbackRAF) {
        cancelAnimationFrame(editorState.playbackRAF);
        editorState.playbackRAF = null;
    }
    if (editorState.audioSourceNode) {
        try { editorState.audioSourceNode.stop(); } catch (e) {}
        editorState.audioSourceNode = null;
    }
    if (editorState.mediaEl) { try { editorState.mediaEl.pause(); } catch (e) {} }
    editorState.mediaPlaying = false;
    editorState.audioGainNode = null;
    const btn = document.getElementById('btn-editor-playpause');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Play/Pause (Espaço)';
    const playhead = document.getElementById('editor-playhead');
    if (playhead) playhead.classList.add('hidden');
    renderEditorCanvas();
}

// Arma/desarma a GRAVAÇÃO por teclado (botão dedicado, separado do visual — ver
// toggleEditorSimulatorMode). Não começa a gravar sozinho — só passa a gravar de verdade
// quando a música é tocada (startEditorPlayback), pra deixar claro pro usuário quando o
// timing das teclas está sendo capturado. Funciona igual na grade clássica ou no visual do
// Simulador, o que estiver na tela no momento.
function toggleEditorRecordingArmed() {
    if (editorState.isRecording) { stopEditorPlayback(); return; } // clique durante a gravação = parar
    editorState.recordingArmed = !editorState.recordingArmed;
    updateEditorSimulatorUI();
}

// Alterna SÓ o visual do editor (grade clássica rolável vs. visual de jogo de verdade do
// Simulador) — não liga/desliga gravação sozinho (ver toggleEditorRecordingArmed pra isso).
// Seguro trocar até no meio de uma gravação em andamento: a sincronização de posição abaixo
// só roda quando NÃO está tocando (curMs fica null nesse caso, ver isRefAudioPlaying), e o
// loop de playback (startEditorPlayback) já se auto-corrige pro visual novo no frame seguinte.
function toggleEditorSimulatorMode(fromHighwayToggle = false) {
    // Botão "Simulador" com a Gear 3D ligada: só troca pro Simulador plano (continua no
    // mesmo relógio, então não precisa sincronizar posição nenhuma).
    if (editorState.highwayMode && editorState.simulatorMode && !fromHighwayToggle) {
        editorState.highwayMode = false;
        editorState.hoverPoint = null;
        updateEditorSimulatorUI();
        resizeEditorCanvas();
        renderEditorCanvas();
        return;
    }
    // Cada modo guarda a posição pausada de um jeito diferente (ver getEditorElapsedMs) —
    // lê ANTES de trocar o modo (senão getEditorElapsedMs já leria pela fonte nova/errada) e
    // escreve na fonte do modo que está prestes a virar o atual, pra não "pular" o tempo ao
    // alternar entre grade e visual de jogo no meio da edição.
    const curMs = editorState.isRefAudioPlaying ? null : getEditorElapsedMs();
    editorState.simulatorMode = !editorState.simulatorMode;
    if (curMs != null) {
        if (editorState.simulatorMode) {
            editorState.gamePausedMs = curMs;
        } else {
            // Mesma borda de baixo usada em todo o resto da grade clássica (ver
            // getEditorElapsedMs/goToEditorTime) — sem isso, voltar do Simulador pra grade
            // pularia pro instante errado.
            const wrap = document.getElementById('editor-canvas-wrap');
            if (wrap) wrap.scrollTop = Math.max(0, editorTimeToAbsY(curMs) - wrap.clientHeight);
        }
    }
    updateEditorSimulatorUI();
    // Troca o <canvas> pro layout certo (grade rolável vs. visual de jogo de verdade — ver
    // resizeEditorCanvas/layoutEditorCanvasGame) e já desenha um frame na hora, sem esperar
    // o próximo scroll/tecla — senão o canvas ficava "preso" no layout antigo até alguma
    // outra interação disparar um redesenho.
    resizeEditorCanvas();
    renderEditorCanvas();
}

function updateEditorSimulatorUI() {
    const btn = document.getElementById('btn-editor-simulator');
    const recordBtn = document.getElementById('btn-editor-record-arm');
    const hint = document.getElementById('editor-simulator-hint');
    const speedSelect = document.getElementById('editor-practice-speed');
    if (!btn || !hint) return;

    // Botão do VISUAL — só reflete qual desenho está na tela agora (grade ou visual de jogo),
    // nunca gravação (ver btn-editor-record-arm/toggleEditorRecordingArmed pra isso).
    const hwBtn = document.getElementById('btn-editor-highway');
    if (hwBtn) {
        hwBtn.className = editorState.highwayMode
            ? 'px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-xs font-bold text-slate-950'
            : 'px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-xs font-semibold text-white';
        hwBtn.innerHTML = editorState.highwayMode ? '<i class="fa-solid fa-road mr-1"></i> Visual: Gear 3D' : '<i class="fa-solid fa-road mr-1"></i> Gear 3D';
    }
    if (editorState.simulatorMode && editorState.highwayMode) {
        btn.innerHTML = '<i class="fa-solid fa-gamepad mr-1"></i> Simulador';
        btn.className = 'px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-xs font-semibold text-white';
    } else if (editorState.simulatorMode) {
        btn.innerHTML = '<i class="fa-solid fa-gamepad mr-1"></i> Visual: Simulador';
        btn.className = 'px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 rounded text-xs font-bold text-white';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-gamepad mr-1"></i> Visual: Grade Clássica';
        btn.className = 'px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-xs font-semibold text-white';
    }

    // Botão de GRAVAÇÃO por teclado — independente do visual acima: funciona igual na grade
    // clássica ou no visual do Simulador, o que estiver na tela.
    if (recordBtn) {
        if (editorState.isRecording) {
            recordBtn.innerHTML = '<i class="fa-solid fa-circle-stop mr-1"></i> Gravando... (Esc p/ parar)';
            recordBtn.className = 'px-2.5 py-1.5 bg-red-600 hover:bg-red-500 rounded text-xs font-bold text-white animate-pulse';
        } else if (editorState.recordingArmed) {
            recordBtn.innerHTML = '<i class="fa-solid fa-circle-dot mr-1"></i> Gravação: ARMADA';
            recordBtn.className = 'px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-xs font-bold text-white';
        } else {
            recordBtn.innerHTML = '<i class="fa-solid fa-keyboard mr-1"></i> Gravar com Teclas';
            recordBtn.className = 'px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-xs font-semibold text-white';
        }
    }

    // Texto CURTO na tela (cabe numa linha, sem forçar quebra no cabeçalho — isso é o que
    // deixava a "gear" do visual de jogo mais baixa do que devia) + o texto completo, de
    // sempre, só no title (tooltip ao passar o mouse) pra quem quiser o detalhe.
    if (editorState.recordingArmed || editorState.simulatorMode) {
        const keys = KEY_CONFIGS[editorState.mode] || [];
        const mapping = keys.map((code, i) => `${getTrackLabel(editorState.mode, i)}=${formatKeyCode(code)}`).join(' · ');
        if (editorState.isRecording) {
            hint.textContent = `🔴 Gravando: ${mapping} — segure=hold, solte=fim, Esc=pausa`;
            hint.title = `Gravando com: ${mapping} — segure pra criar hold, solte pra encerrar. Esc pausa sem perder o lugar. Funciona tanto na grade clássica quanto no visual do Simulador.`;
        } else if (editorState.recordingArmed && editorState.lastRecordedIndex !== -1) {
            // Já gravou pelo menos um trecho e pausou — sugere exatamente o fluxo "gravar por
            // partes" (gravar, parar, ajustar/ouvir, continuar) em vez de tentar tudo de uma vez.
            hint.textContent = `⏸️ Pausado — última nota selecionada. Play/Espaço continua a gravação (passe o mouse aqui pra mais detalhes)`;
            hint.title = 'Pausado — a última nota gravada está selecionada (branca): clique nela pra apagar (botão direito) ou arraste pra criar/ajustar hold — dá pra clicar em qualquer ponto da tela pra inserir nota nova também, e ouvir com Play normal. Quando estiver bom, clique em Play (ou Espaço) de novo pra CONTINUAR gravando de onde parou.';
        } else if (editorState.recordingArmed) {
            hint.textContent = `⌨️ Gravação armada — Play/Espaço grava com: ${mapping} (passe o mouse aqui pra mais detalhes)`;
            hint.title = `Gravação por teclado armada — clique em Play (ou Espaço) pra gravar tocando com: ${mapping}. Funciona tanto na grade clássica quanto no visual do Simulador — escolha o visual que preferir enquanto grava. Dica: grave em trechos curtos e pause pra ajustar antes de continuar.`;
        } else if (editorState.highwayMode) {
            hint.textContent = `🛣️ Gear 3D — pausado, clique na pista pra editar · roda do mouse navega (passe o mouse aqui pra mais detalhes)`;
            hint.title = 'Visual Gear 3D (estilo Moonscraper): todas as lanes aparecem como colunas em perspectiva. Pausado, clique na pista pra inserir/editar conforme a ferramenta escolhida (barra da esquerda, atalhos 1-4). A roda do mouse anda pela música passo a passo; o seletor de queda (seta pra baixo) muda quanto da música cabe na pista.';
        } else {
            // só o visual do Simulador está ativo, sem gravação armada
            hint.textContent = `🎮 Visual do Simulador — pausado, clique na tela pra inserir/ajustar nota (passe o mouse aqui pra mais detalhes)`;
            hint.title = 'Visual de jogo de verdade ativo, sem gravação armada. Pausado, dá pra clicar na tela pra inserir/apagar/ajustar nota igual na grade normal, direto no visual de queda. Arme "Gravar com Teclas" pra também poder gravar tocando com as teclas do modo.';
        }
        hint.classList.remove('hidden');
    } else {
        hint.classList.add('hidden');
    }

    // A velocidade de teste (áudio) só pode mudar PAUSADO — trocar no meio do play
    // desalinharia o relógio (playStartOffsetSec/playStartPerf) da velocidade que o áudio já
    // está tocando. A velocidade de QUEDA VISUAL (fall-speed) é só desenho e pode mudar a
    // qualquer momento, então seu <select> nunca é desabilitado aqui.
    if (speedSelect) speedSelect.disabled = false; // pode trocar tocando (recomeça do mesmo ponto)
}

// keydown de uma tecla-de-lane durante a gravação: cria a nota já como tap no instante
// atual, e guarda a referência em recordingHeld — se a tecla for solta rápido, fica tap
// mesmo; se ficar segurada além do limiar de hold do próprio editor, handleSimulatorNoteUp
// converte pra hold quando soltar.
function handleSimulatorNoteDown(laneIdx) {
    if (editorState.recordingHeld[laneIdx]) return; // já em andamento (não devia acontecer sem repeat, mas por segurança)
    // getEditorElapsedMs() inclui o globalOffset calibrado (de propósito — é o mesmo relógio
    // que o jogo de verdade usaria, pra o teste no Simulador "sentir" igual). Mas o que vai
    // pro CHART em si (note.time) precisa ser o tempo "cru" da música, sem esse offset
    // embutido — senão, toda vez que o chart fosse jogado de verdade, o globalOffset seria
    // aplicado DE NOVO em cima do que já foi salvo aqui, somando duas vezes (e se o jogador
    // recalibrar o offset depois de gravar, o chart salvo ficaria com a calibração antiga
    // "grudada" nele pra sempre). Tira de volta antes de guardar.
    // Tira também a sincronia do jogador (atraso da tela/teclado que a calibração mediu): a
    // nota gravada fica no tempo REAL da música, e jogar o chart depois dá o mesmo julgamento
    // de qualquer treino — sem precisar de ajuste "só desta música".
    const rawStartMs = getEditorElapsedMs() - globalOffset - judgeOffset;
    // Encaixa no mesmo grid de BPM/snap que um clique na grade normal já usa (ver
    // snapEditorTime/handleEditorCanvasMouseDown). Sem isso, qualquer gravação "ao vivo"
    // (tocando junto com a música) acaba com um pequeno atraso de reação humana — alguns
    // dezenas de ms, inevitável, ninguém aperta EXATAMENTE em cima da batida — embutido
    // pra sempre na nota. Na hora de jogar de verdade, a nota fica sistematicamente atrás
    // da batida real: exatamente o "as notas chegam com atraso" relatado. Quantizar corrige
    // esse desvio (desde que o BPM configurado no chart esteja certo).
    const snappedStart = snapEditorTime(rawStartMs);
    const note = { time: snappedStart, lane: laneIdx, holdEnd: null };
    editorState.notes.push(note);
    editorState.recordingHeld[laneIdx] = { note, rawStartMs, wallStart: performance.now() };
    editorState.simKeyGlow[laneIdx] = 1.0; // feedback visual imediato no Modo Simulador
    // Guarda o índice da última nota gravada nesta sessão — ao pausar (Esc/botão), stopEditorPlayback
    // seleciona ela automaticamente, pra já aparecer destacada (branca) e fácil de achar/arrastar
    // pra ajuste fino sem precisar procurar na tela.
    editorState.lastRecordedIndex = editorState.notes.length - 1;
    renderEditorCanvas();
}

function handleSimulatorNoteUp(laneIdx) {
    const held = editorState.recordingHeld[laneIdx];
    if (!held) return;
    delete editorState.recordingHeld[laneIdx];
    // Mesmo motivo do rawStartMs em handleSimulatorNoteDown: tira o globalOffset de volta
    // antes de decidir/guardar qualquer coisa.
    const rawEndMs = getEditorElapsedMs() - globalOffset - judgeOffset;
    // Piso de ~90ms além do passo do grid: em BPM/snap altos, um passo de grid sozinho pode
    // ser bem menor que isso (ex.: 120 BPM, snap 16 = ~31ms) — um toque rápido normal no
    // teclado facilmente segura mais que isso sem ser intenção de hold. 90ms é curto o
    // bastante pra não atrapalhar uma hold de verdade (bem mais longa na prática).
    // Critério novo (antes bastava segurar 90ms — um toque normal de teclado já passava disso
    // e virava hold): só vira hold se segurar pelo menos MEIO TEMPO da música E pelo menos
    // 250ms de verdade no relógio (mesmo com a música mais lenta) — e dá pra desligar as holds
    // na gravação.
    const beatMs = 60000 / Math.max(30, editorState.bpm || 120);
    const minHoldMs = Math.max(editorSnapMsAt(held.note.time), beatMs / 2, 120);
    const wallHeld = performance.now() - (held.wallStart || performance.now());
    if (editorState.recordHolds !== false && rawEndMs - held.rawStartMs >= minHoldMs && wallHeld >= 250) {
        const snappedEnd = snapEditorTime(rawEndMs);
        // Grid grosseiro + hold bem curtinho podiam quantizar o fim pro MESMO passo do
        // início (ou antes) — empurra pro próximo passo do grid nesse caso, pra nunca virar
        // uma hold de duração zero/negativa.
        held.note.holdEnd = snappedEnd > held.note.time ? snappedEnd : held.note.time + minHoldMs;
    }
    renderEditorCanvas();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

// Cria (ou atualiza) o card de um chart custom na tela inicial, igual ao card do áudio
// importado, mas com selo "CUSTOM" e cor verde pra diferenciar de cara
// Nome da música separado das outras informações. Música do osu! vem como
// "Artista - Título [Dificuldade]" — aqui vira { title: Título, artist, version }.
function splitOsuTitle(full) {
    const m = String(full || '').match(/^(.*?)\s+-\s+(.*?)\s*\[([^\]]*)\]\s*$/);
    if (m) return { artist: m[1].trim(), title: m[2].trim(), version: m[3].trim() };
    const v = String(full || '').match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
    return v ? { artist: '', title: v[1].trim(), version: v[2].trim() } : { artist: '', title: String(full || ''), version: '' };
}
// { title, sub, meta } da música/treino tocado — usado no card, na prévia e na análise
function songInfoFor(pattern) {
    pattern = pattern || currentPatternType;
    if (typeof pattern === 'string' && pattern.startsWith('custom:')) {
        const ch = findCustomChart(pattern.slice(7));
        if (!ch) return { title: 'Chart (apagado)', sub: '', meta: '', kind: 'custom' };
        const notes = (ch.notes || []).length;
        if (ch.source === 'osu') {
            const o = ch.osu || {}, t = splitOsuTitle(ch.title);
            const metaParts = [t.version || o.version, getModeDisplayName(ch.mode), `${notes} notas`, o.stars ? `★${(+o.stars).toFixed(2)}` : '', o.creator ? `mapa de ${o.creator}` : ''].filter(Boolean);
            return { title: t.title, sub: t.artist, meta: metaParts.join(' · '), version: t.version || o.version || '', kind: 'osu', bpm: Math.round(ch.bpm) };
        }
        return { title: ch.title, sub: 'Feito por você', meta: `${getModeDisplayName(ch.mode)} · ${notes} notas · ${Math.round(ch.bpm)} BPM`, kind: 'custom', bpm: Math.round(ch.bpm) };
    }
    const id = typeof resolvePatternId === 'function' ? resolvePatternId(pattern) : pattern;
    const dr = DRILLS[id];
    return { title: dr ? dr.title : String(pattern), sub: dr ? dr.skill : '', meta: dr ? `Treino · ${dr.bpm} BPM` : '', kind: 'drill', bpm: dr ? dr.bpm : null };
}

function addOrUpdateCustomChartCard(chart) {
    const grid = document.getElementById('pattern-grid');
    if (!grid) return;
    const cardId = `pattern-card-custom-${chart.id}`;
    let card = document.getElementById(cardId);
    if (!card) {
        card = document.createElement('div');
        card.id = cardId;
        card.className = 'pattern-card flex items-center gap-3 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700 hover:border-cyan-400 cursor-pointer transition';
        grid.appendChild(card);
    }
    card.dataset.pattern = `custom:${chart.id}`;
    if (chart.source === 'osu') {
        // música importada do osu!mania
        const o = chart.osu || {};
        const si = songInfoFor(`custom:${chart.id}`);
        card.dataset.title = si.title;
        card.dataset.desc = `${si.sub ? si.sub + ' · ' : ''}${si.meta}. Importada do osu!mania, toca com a música original.`;
        card.dataset.bpm = String(Math.round(chart.bpm));
        card.dataset.track = `osu! · ${o.creator || ''}`;
        card.dataset.badge = 'OSU!';
        card.dataset.badgeClass = 'bg-pink-500/20 text-pink-300 border-pink-500/30';
        card.dataset.icon = '♪';
        card.dataset.iconClass = 'from-pink-500/30 text-pink-300 border-pink-500/30';
        card.innerHTML = `
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-pink-500/30 to-slate-800 flex items-center justify-center text-pink-300 font-orbitron font-bold text-base shrink-0 border border-pink-500/30">♪</div>
        <div class="flex-1 min-w-0">
            <div class="font-orbitron font-bold text-sm text-white truncate">${escapeHtml(si.title)}</div>
            <div class="text-[11px] text-pink-200/80 truncate">${escapeHtml(si.sub || '')}${si.sub && si.version ? ' · ' : ''}<b class="text-pink-300">${escapeHtml(si.version || '')}</b></div>
            <div class="text-[10px] text-slate-500 truncate font-mono">${getModeDisplayName(chart.mode)} · ${chart.notes.length} notas${o.stars ? ` · ★${(+o.stars).toFixed(1)}` : ''}${o.creator ? ` · mapa de ${escapeHtml(o.creator)}` : ''}</div>
        </div>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold shrink-0 border bg-pink-500/20 text-pink-300 border-pink-500/30">OSU!</span>`;
        return;
    }
    card.dataset.title = `✏️ ${chart.title}`;
    card.dataset.desc = `Chart feito no editor (${getModeDisplayName(chart.mode)}, ${chart.notes.length} notas) — toca com backing procedural simples no BPM configurado.`;
    card.dataset.bpm = String(Math.round(chart.bpm));
    card.dataset.track = 'Feito por você';
    card.dataset.badge = 'CUSTOM';
    card.dataset.badgeClass = 'bg-green-500/20 text-green-400 border-green-500/30';
    card.dataset.icon = '✏️';
    card.dataset.iconClass = 'from-green-500/30 text-green-300 border-green-500/30';
    card.innerHTML = `
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br from-green-500/30 to-slate-800 flex items-center justify-center text-green-300 font-orbitron font-bold text-base shrink-0 border border-green-500/30">✏️</div>
        <div class="flex-1 min-w-0">
            <div class="font-orbitron font-bold text-sm text-white truncate">${escapeHtml(chart.title)}</div>
            <div class="text-[10px] text-slate-500 truncate font-mono">${getModeDisplayName(chart.mode)} · ${chart.notes.length} notas · Feito por você</div>
        </div>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold shrink-0 bg-green-500/20 text-green-400 border border-green-500/30">CUSTOM</span>
    `;
}

function removeCustomChartCard(id) {
    document.getElementById(`pattern-card-custom-${id}`)?.remove();
}

async function saveCurrentEditorChart() {
    const titleInput = document.getElementById('editor-title');
    const title = (titleInput?.value || '').trim() || 'Meu Chart';
    editorState.title = title;

    if (editorState.notes.length === 0) {
        alert('Adicione pelo menos uma nota antes de salvar.');
        return;
    }

    const id = editorState.id || `custom_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const isNew = !editorState.id;
    const chart = {
        id,
        title,
        mode: editorState.mode,
        bpm: editorState.bpm,
        snap: editorState.snap,
        duration: editorState.duration,
        notes: editorState.notes
            .map(n => ({ time: Math.round(n.time), lane: n.lane, holdEnd: n.holdEnd != null ? Math.round(n.holdEnd) : null }))
            .sort((a, b) => a.time - b.time),
        // Só bengala de navegação (ver editorState.pins/editorState.sections) — nunca lido
        // por generateNotes/julgamento, não influencia o jogo de verdade de jeito nenhum.
        pins: editorState.pins.map(p => Math.round(p)).sort((a, b) => a - b),
        sections: editorState.sections.map(s => ({ time: Math.round(s.time), name: s.name })).sort((a, b) => a.time - b.time),
        bpmChanges: sanitizeBpmChanges(editorState.bpmChanges),
        songEndMs: editorState.songEndMs != null ? Math.round(editorState.songEndMs) : null,
        difficulty: editorState.difficulty || null,
        updatedAt: Date.now()
    };

    const existingIndex = customCharts.findIndex(c => c.id === id);
    // campos que o editor não mexe (ajuste só desta música) continuam como estavam
    if (existingIndex !== -1 && typeof customCharts[existingIndex].judgeOffsetLocal === 'number') chart.judgeOffsetLocal = customCharts[existingIndex].judgeOffsetLocal;
    // chart importado (osu!) editado no editor continua marcado como importado
    if (existingIndex !== -1 && customCharts[existingIndex].source) {
        const ex = customCharts[existingIndex];
        chart.source = ex.source; chart.osu = ex.osu;
        // mexeu nas notas, no tempo ou na dificuldade? então deixa de ser o chart original (não dá EXP)
        const sig = (c) => JSON.stringify([(c.notes || []).map(n => [Math.round(n.time), n.lane, n.holdEnd != null ? Math.round(n.holdEnd) : null]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), c.difficulty ? [c.difficulty.tier, +c.difficulty.level] : null, Math.round((+c.bpm || 0) * 100), Math.round(c.songEndMs || 0)]);
        if (ex.editado || sig(ex) !== sig(chart)) chart.editado = true;
    }
    if (existingIndex !== -1) customCharts[existingIndex] = chart;
    else customCharts.push(chart);

    editorState.id = id;
    saveCustomCharts();
    addOrUpdateCustomChartCard(chart);
    renderEditorChartList();

    // Só grava/sobrescreve o áudio no IndexedDB quando tem um Blob NOVO desta sessão
    // (import feito agora, ainda não persistido) — se o usuário só ajustou notas sem
    // reimportar nada, audioFileBlob fica null e o áudio já salvo antes (se tinha) continua
    // intocado. Isso evita duas coisas erradas: apagar áudio de uma edição que não tocou
    // nele, e regravar o mesmo Blob de novo a cada "salvar" sem necessidade.
    let audioSavedNote = '';
    if (editorState.audioFileBlob && !editorState.audioLoadedFromSaved) {
        try {
            await saveChartAudioBlob(id, editorState.audioFileBlob, editorState.audioFileName);
            editorState.audioLoadedFromSaved = true;
            audioSavedNote = ' + áudio salvo';
        } catch (e) {
            console.warn('Não foi possível salvar o áudio deste chart:', e);
            audioSavedNote = ' (áudio NÃO salvo — ficará só o click track ao jogar; tente de novo)';
        }
    }

    flashEditorStatus((isNew ? `✅ Chart salvo! (${chart.notes.length} notas${audioSavedNote})` : `✅ Chart atualizado! (${chart.notes.length} notas${audioSavedNote})`));
    // Atualiza o autosave pra refletir esse estado recém-salvo — assim, se nada mudar depois
    // disso, a próxima abertura do editor não vai oferecer "recuperar" algo que já está salvo.
    runEditorAutosave();
}

// Salva uma CÓPIA independente em "Meus charts" (ex.: pegar uma música do osu! e mudar tudo).
// A original não é tocada; o áudio é copiado; daqui pra frente o editor edita a cópia.
async function saveEditorChartAsCopy() {
    if (editorState.notes.length === 0) { alert('Adicione pelo menos uma nota antes de salvar.'); return; }
    const origId = editorState.id;
    const orig = origId ? customCharts.find(c => c.id === origId) : null;
    const titleInput = document.getElementById('editor-title');
    let title = (titleInput?.value || '').trim() || 'Meu Chart';
    if (orig && orig.title === title) title = orig.source === 'osu' ? title.replace(/\s*\[([^\]]*)\]\s*$/, ' [$1 · meu]') : title + ' (cópia)';
    if (orig && orig.title === title) title += ' (meu)';
    const id = `custom_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const chart = Object.assign({}, orig || {}, {
        id, title,
        mode: editorState.mode, bpm: editorState.bpm, snap: editorState.snap, duration: editorState.duration,
        notes: editorState.notes.map(n => ({ time: Math.round(n.time), lane: n.lane, holdEnd: n.holdEnd != null ? Math.round(n.holdEnd) : null })).sort((a, b) => a.time - b.time),
        pins: editorState.pins.map(p => Math.round(p)).sort((a, b) => a - b),
        sections: editorState.sections.map(s => ({ time: Math.round(s.time), name: s.name })).sort((a, b) => a.time - b.time),
        bpmChanges: sanitizeBpmChanges(editorState.bpmChanges),
        songEndMs: editorState.songEndMs != null ? Math.round(editorState.songEndMs) : null,
        difficulty: editorState.difficulty || null,
        updatedAt: Date.now()
    });
    // vira um chart SEU: sai do grupo "Músicas do osu!" e vai pra "Meus charts"
    if (orig && orig.source) chart.origem = { source: orig.source, title: orig.title, beatmapId: orig.osu && orig.osu.beatmapId || null, setId: orig.osu && orig.osu.setId || null };
    delete chart.source; delete chart.osu; delete chart.editado;
    let audioNote = '';
    try {
        if (editorState.audioFileBlob && !editorState.audioLoadedFromSaved) { await saveChartAudioBlob(id, editorState.audioFileBlob, editorState.audioFileName); audioNote = ' + áudio'; }
        else if (origId) { const a = await loadChartAudioBlob(origId); if (a && a.blob) { await saveChartAudioBlob(id, a.blob, a.fileName); audioNote = ' + áudio'; } }
    } catch (e) { console.warn('cópia do áudio falhou', e); audioNote = ' (áudio NÃO copiado)'; }
    customCharts.push(chart);
    saveCustomCharts();
    addOrUpdateCustomChartCard(chart);
    editorState.id = id;
    editorState.title = title;
    if (titleInput) titleInput.value = title;
    editorState.audioLoadedFromSaved = true;
    renderEditorChartList();
    try { if (typeof libApply === 'function') libApply(); } catch (e) {}
    flashEditorStatus(`✅ Cópia salva em Meus charts: "${title}" (${chart.notes.length} notas${audioNote}). Agora você está editando a cópia.`);
    runEditorAutosave();
}

function exportCurrentEditorChart() {
    if (editorState.notes.length === 0) {
        alert('Adicione pelo menos uma nota antes de exportar.');
        return;
    }
    const chart = {
        id: editorState.id || `custom_${Date.now()}`,
        title: editorState.title,
        mode: editorState.mode,
        bpm: editorState.bpm,
        snap: editorState.snap,
        duration: editorState.duration,
        notes: editorState.notes
            .map(n => ({ time: Math.round(n.time), lane: n.lane, holdEnd: n.holdEnd != null ? Math.round(n.holdEnd) : null }))
            .sort((a, b) => a.time - b.time),
        // Bengalas de navegação (ver editorState.pins/editorState.sections) — incluídas no
        // export só pra não se perderem ao reimportar o mesmo chart depois; nunca afetam o
        // jogo de verdade nem são obrigatórias pra um chart ser válido.
        pins: editorState.pins.map(p => Math.round(p)).sort((a, b) => a - b),
        sections: editorState.sections.map(s => ({ time: Math.round(s.time), name: s.name })).sort((a, b) => a.time - b.time),
        bpmChanges: sanitizeBpmChanges(editorState.bpmChanges),
        songEndMs: editorState.songEndMs != null ? Math.round(editorState.songEndMs) : null,
        difficulty: editorState.difficulty || null
    };
    const blob = new Blob([JSON.stringify(chart, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(chart.title || 'chart').replace(/[^a-z0-9_\-]+/gi, '_')}.bmchart.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importChartFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            if (!parsed || !Array.isArray(parsed.notes) || !parsed.mode || !KEY_CONFIGS[parsed.mode]) {
                alert('Arquivo de chart inválido.');
                return;
            }
            const id = `custom_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
            const chart = {
                id,
                title: parsed.title || 'Chart importado',
                mode: parsed.mode,
                bpm: (typeof parsed.bpm === 'number' && parsed.bpm > 0) ? parsed.bpm : 150,
                snap: parsed.snap || 4,
                duration: (typeof parsed.duration === 'number' && parsed.duration > 0) ? parsed.duration : 90,
                notes: parsed.notes
                    .filter(n => typeof n.time === 'number' && typeof n.lane === 'number')
                    .map(n => ({ time: n.time, lane: n.lane, holdEnd: (typeof n.holdEnd === 'number') ? n.holdEnd : null })),
                pins: Array.isArray(parsed.pins) ? parsed.pins.filter(p => typeof p === 'number') : [],
                sections: Array.isArray(parsed.sections)
                    ? parsed.sections.filter(s => s && typeof s.time === 'number' && typeof s.name === 'string')
                    : [],
                bpmChanges: sanitizeBpmChanges(parsed.bpmChanges),
                songEndMs: (typeof parsed.songEndMs === 'number' && parsed.songEndMs > 0) ? parsed.songEndMs : null,
                difficulty: (parsed.difficulty && typeof parsed.difficulty.tier === 'string') ? { tier: parsed.difficulty.tier, level: Math.max(1, Math.min(15, parseInt(parsed.difficulty.level, 10) || 1)) } : null,
                updatedAt: Date.now()
            };
            customCharts.push(chart);
            saveCustomCharts();
            addOrUpdateCustomChartCard(chart);
            loadChartIntoEditor(chart);
            renderEditorChartList();
            resizeEditorCanvas();
            scrollEditorGridToStart();
            renderEditorCanvas();
        } catch (e) {
            alert('Não foi possível ler esse arquivo como um chart válido.');
        }
    };
    reader.readAsText(file);
}

function deleteCustomChart(id) {
    customCharts = customCharts.filter(c => c.id !== id);
    saveCustomCharts();
    removeCustomChartCard(id);
    // Só volta a tela pro início se o chart apagado era o que estava aberto (virou um chart
    // em branco) — apagar outro da lista não pode "teleportar" quem está editando aqui agora
    // de volta pro começo sem motivo.
    const wasCurrentChart = editorState.id === id;
    if (wasCurrentChart) newBlankChartInEditor();
    renderEditorChartList();
    resizeEditorCanvas();
    if (wasCurrentChart) scrollEditorGridToStart();
    renderEditorCanvas();

    // Apaga também o áudio salvo desse chart no IndexedDB (se tinha algum) — senão ficaria
    // lixo órfão acumulando lá pra sempre, sem chart nenhum apontando pra ele.
    deleteChartAudioBlob(id).catch(e => console.warn('Não foi possível remover o áudio salvo desse chart:', e));
    if (audio.customChartId === id) {
        audio.stopCustomChartTrack();
        audio.customChartBuffer = null;
        audio.customChartId = null;
    }

    if (currentPatternType === `custom:${id}`) {
        currentPatternType = 'staircase';
        applySettingsToUI();
        saveSettings();
    }
}

function renderEditorChartList() {
    const list = document.getElementById('editor-chart-list');
    if (!list) return;
    list.innerHTML = '';

    if (customCharts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-[10px] text-slate-500 text-center py-4';
        empty.textContent = 'Nenhum chart salvo ainda.';
        list.appendChild(empty);
        return;
    }

    [...customCharts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach(chart => {
        const row = document.createElement('div');
        row.dataset.chartId = chart.id;
        row.className = `flex items-center gap-1.5 p-1.5 rounded border text-xs ${chart.id === editorState.id ? 'border-cyan-400 bg-slate-800/80' : 'border-slate-700 bg-slate-800/40'}`;

        const info = document.createElement('button');
        info.className = 'flex-1 min-w-0 text-left';
        info.innerHTML = `<div class="font-semibold text-white truncate">${escapeHtml(chart.title)}</div><div class="text-[9px] text-slate-500 font-mono">${getModeDisplayName(chart.mode)} · ${chart.notes.length} notas · ${Math.round(chart.bpm)}bpm</div>`;
        info.addEventListener('click', () => {
            if (editorState.notes.length > 0 && editorState.id !== chart.id && !confirm('Descartar as alterações não salvas e abrir este chart?')) return;
            loadChartIntoEditor(chart);
            resizeEditorCanvas();
            scrollEditorGridToStart();
            renderEditorCanvas();
            renderEditorChartList();
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'shrink-0 w-6 h-6 flex items-center justify-center rounded text-red-400 hover:bg-red-950/60';
        delBtn.innerHTML = '<i class="fa-solid fa-trash text-[10px]"></i>';
        delBtn.title = 'Excluir chart';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`Excluir o chart "${chart.title}"? Ele vai para a Lixeira (dá pra restaurar por 30 dias).`)) return;
            deleteCustomChart(chart.id);
        });

        row.appendChild(info);
        row.appendChild(delBtn);
        list.appendChild(row);
    });
}

// Liga todos os controles do editor (chamado uma vez, em window.onload)
function bindChartEditorEvents() {
    // Liga o timer de autosave uma vez só, pro resto da sessão inteira (a própria função
    // no-opa sozinha quando o editor está fechado — ver runEditorAutosave) — mais simples e
    // seguro do que ligar/desligar toda vez que o editor abre/fecha.
    startEditorAutosaveTimer();
    document.getElementById('btn-chart-editor')?.addEventListener('click', () => openChartEditor());
    document.getElementById('btn-editor-close')?.addEventListener('click', () => closeChartEditor());
    document.getElementById('btn-editor-playpause')?.addEventListener('click', () => toggleEditorAudioPlayback());
    document.getElementById('btn-editor-rewind')?.addEventListener('click', () => seekEditorPlayback(-5));
    document.getElementById('btn-editor-forward')?.addEventListener('click', () => seekEditorPlayback(5));
    document.getElementById('btn-editor-simulator')?.addEventListener('click', () => toggleEditorSimulatorMode());
    document.getElementById('btn-editor-record-arm')?.addEventListener('click', () => toggleEditorRecordingArmed());
    const speedInput = document.getElementById('editor-practice-speed');
    const applyEditorSpeed = (v, restartIfNeeded) => {
        v = Math.max(0.25, Math.min(1.5, Math.round(v * 20) / 20));
        editorState.practiceSpeed = v;
        if (speedInput && +speedInput.value !== v) speedInput.value = String(v);
        const lbl = document.getElementById('editor-speed-val');
        if (lbl) lbl.textContent = `${Math.round(v * 100)}%`;
        if (editorState.isRefAudioPlaying && editorState.mediaPlaying && editorState.mediaEl) {
            editorState.mediaEl.playbackRate = v; // muda na hora, sem parar
        } else if (restartIfNeeded && editorState.isRefAudioPlaying && v !== 1) {
            // estava tocando no modo normal: recomeça do mesmo ponto já no player com tom preservado
            const cur = getEditorElapsedMs() - globalOffset;
            stopEditorPlayback();
            goToEditorTime(cur / 1000);
            startEditorPlayback();
        }
        if (v !== 1 && editorState.audioBuffer && !editorState.mediaPlaying) {
            try { getEditorMediaElement().load(); } catch (err) { /* segue */ }
        }
    };
    window.applyEditorSpeed = applyEditorSpeed;
    speedInput?.addEventListener('input', (e) => applyEditorSpeed(parseFloat(e.target.value) || 1, false));
    speedInput?.addEventListener('change', (e) => applyEditorSpeed(parseFloat(e.target.value) || 1, true));
    document.getElementById('btn-editor-speed-reset')?.addEventListener('click', () => applyEditorSpeed(1, true));
    document.getElementById('btn-editor-cue')?.addEventListener('click', () => toggleEditorCuePoint());
    document.getElementById('editor-record-holds')?.addEventListener('change', (e) => { editorState.recordHolds = !!e.target.checked; });
    document.getElementById('editor-fall-speed')?.addEventListener('change', (e) => {
        editorState.noteFallSpeedMultiplier = parseFloat(e.target.value) || 1.0;
        renderEditorCanvas();
    });
    document.getElementById('btn-editor-toggle-pin')?.addEventListener('click', () => toggleEditorPin());
    document.getElementById('btn-editor-add-section')?.addEventListener('click', () => toggleEditorAddSection());
    document.getElementById('btn-editor-validate')?.addEventListener('click', () => showEditorValidationReport());
    document.getElementById('btn-editor-validate-close')?.addEventListener('click', () => closeEditorValidationReport());
    document.getElementById('editor-clap-toggle')?.addEventListener('change', (e) => {
        editorState.clapEnabled = e.target.checked;
        if (editorState.clapEnabled) { try { audio.init(); } catch (err) {} }
    });

    document.getElementById('editor-import-audio')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handleEditorAudioImport(file);
    });

    document.getElementById('btn-editor-detect-bpm')?.addEventListener('click', () => autoDetectEditorBpm());

    document.getElementById('btn-editor-new')?.addEventListener('click', () => {
        if (editorState.notes.length > 0 && !confirm('Descartar as notas atuais e começar um chart novo?')) return;
        newBlankChartInEditor();
        resizeEditorCanvas();
        scrollEditorGridToStart();
        renderEditorCanvas();
        renderEditorChartList();
    });

    document.getElementById('btn-editor-save')?.addEventListener('click', () => saveCurrentEditorChart());
    document.getElementById('btn-editor-save-copy')?.addEventListener('click', () => saveEditorChartAsCopy());
    document.getElementById('btn-editor-export')?.addEventListener('click', () => exportCurrentEditorChart());

    document.getElementById('editor-import-json')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) importChartFromFile(file);
        e.target.value = '';
    });

    document.getElementById('btn-editor-clear')?.addEventListener('click', () => {
        if (editorState.notes.length === 0) return;
        if (confirm('Apagar todas as notas deste chart?')) {
            editorState.notes = [];
            editorState.selectedIndex = -1;
            renderEditorCanvas();
        }
    });

    document.getElementById('editor-title')?.addEventListener('input', (e) => { editorState.title = e.target.value; });

    document.getElementById('editor-mode')?.addEventListener('change', (e) => {
        editorState.mode = e.target.value;
        const laneCount = KEY_CONFIGS[editorState.mode].length;
        editorState.notes.forEach(n => { if (n.lane >= laneCount) n.lane = laneCount - 1; });
        renderEditorTrackLabels();
        resizeEditorCanvas();
        renderEditorCanvas();
        updateEditorSimulatorUI(); // o mapa de teclas do hint depende do modo
    });

    document.getElementById('editor-bpm')?.addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        editorState.bpm = (isFinite(v) && v > 0) ? v : 150;
        renderEditorCanvas();
    });

    document.getElementById('editor-snap')?.addEventListener('change', (e) => {
        editorState.snap = parseFloat(e.target.value) || 4;
        updateEditorSnapButtons();
        renderEditorCanvas();
    });
    document.querySelectorAll('[data-editor-snap]').forEach(b => {
        b.addEventListener('click', () => setEditorSnap(parseFloat(b.dataset.editorSnap) || 4, false));
    });
    document.getElementById('editor-stair-step')?.addEventListener('change', (e) => {
        editorStairDiv = parseFloat(e.target.value) || 4;
        if (editorState.tool !== 'stair') setEditorTool('stair');
    });
    document.getElementById('editor-stair-mode')?.addEventListener('change', (e) => {
        editorStairMode = e.target.value === 'bounce' ? 'bounce' : 'repeat';
    });
    updateEditorSnapButtons();

    document.getElementById('editor-zoom')?.addEventListener('input', (e) => {
        editorState.zoom = parseFloat(e.target.value) || 70;
        resizeEditorCanvas();
        renderEditorCanvas();
    });

    document.getElementById('editor-duration')?.addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        editorState.duration = (isFinite(v) && v > 0) ? v : 90;
        resizeEditorCanvas();
        renderEditorCanvas();
    });

    const canvasEl = document.getElementById('editorCanvas');
    if (canvasEl) {
        canvasEl.addEventListener('mousedown', handleEditorCanvasMouseDown);
        canvasEl.addEventListener('contextmenu', handleEditorCanvasContextMenu);
        canvasEl.addEventListener('mousemove', handleEditorCanvasHover);
        canvasEl.addEventListener('mouseleave', handleEditorCanvasLeave);
    }
    document.querySelectorAll('[data-editor-tool]').forEach(btn => {
        btn.addEventListener('click', () => setEditorTool(btn.dataset.editorTool));
    });
    document.getElementById('btn-editor-bpm-change')?.addEventListener('click', () => toggleEditorBpmChange());
    document.getElementById('btn-editor-highway')?.addEventListener('click', () => toggleEditorHighwayMode());
    updateEditorToolUI();
    bindEditorSidePanels();
    window.addEventListener('mousemove', handleEditorWindowMouseMove);
    window.addEventListener('mouseup', handleEditorWindowMouseUp);
    window.addEventListener('keydown', handleEditorKeydown);
    window.addEventListener('keyup', handleEditorKeyup);

    const wrap = document.getElementById('editor-canvas-wrap');
    if (wrap) {
        let scrollRAF = null;
        wrap.addEventListener('scroll', () => {
            if (scrollRAF) return;
            scrollRAF = requestAnimationFrame(() => {
                scrollRAF = null;
                renderEditorCanvas();
            });
        });

        // No modo Simulador o canvas é de tamanho fixo (ver layoutEditorCanvasGame) — não
        // tem scroll nativo pra rolar a timeline, então a roda do mouse não fazia nada ali.
        // Na grade normal, deixa o scroll nativo de sempre acontecer (não intercepta).
        wrap.addEventListener('wheel', handleEditorCanvasWheel, { passive: false });
    }
}


// ===== Timeline lateral + painel de propriedades (estilo Moonscraper) =====
// Redesenhados "de carona" em todo renderEditorCanvas, mas agrupados num único frame (rAF) e,
// durante o play, a timeline no máximo ~12x por segundo — sai praticamente de graça.
let editorSideUIRAF = null;
let editorTimelineLastDraw = 0;
function scheduleEditorSideUIRender() {
    if (editorSideUIRAF) return;
    editorSideUIRAF = requestAnimationFrame(() => {
        editorSideUIRAF = null;
        const nowPerf = performance.now();
        if (!editorState.isRefAudioPlaying || nowPerf - editorTimelineLastDraw > 80) {
            editorTimelineLastDraw = nowPerf;
            renderEditorTimeline();
        }
        renderEditorPropertiesPanel();
    });
}

// Trecho da música que está aparecendo no visual atual — pra desenhar a "janela" na timeline.
function getEditorVisibleTimeRange() {
    const now = getEditorElapsedMs();
    if (editorState.highwayMode) {
        const c = document.getElementById('editorCanvas');
        const proj = getHighwayProjection(c?.width || 800, c?.height || 600);
        return [now, now + proj.windowMs];
    }
    if (editorState.simulatorMode) {
        const c = document.getElementById('editorCanvas');
        const h = c?.height || 600;
        return [now, now + (h - 30) / editorGameSpeedFactor()];
    }
    const wrap = document.getElementById('editor-canvas-wrap');
    if (!wrap) return [now, now];
    return [editorAbsYToTime(wrap.scrollTop + wrap.clientHeight), editorAbsYToTime(wrap.scrollTop)];
}

function editorTimelineGeometry() {
    const c = document.getElementById('editor-timeline');
    const wrap = document.getElementById('editor-timeline-wrap');
    if (!c || !wrap) return null;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return null;
    const totalMs = Math.max(1, editorState.duration * 1000);
    const PAD = 10;
    return {
        c, W, H, totalMs, PAD,
        yOf: (t) => H - PAD - (t / totalMs) * (H - PAD * 2),
        tOf: (y) => Math.max(0, Math.min(totalMs, ((H - PAD - y) / (H - PAD * 2)) * totalMs))
    };
}

function renderEditorTimeline() {
    const g = editorTimelineGeometry();
    if (!g) return;
    const { c, W, H, totalMs, yOf } = g;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
    }
    const t2 = c.getContext('2d');
    t2.setTransform(dpr, 0, 0, dpr, 0, 0);
    t2.clearRect(0, 0, W, H);
    t2.fillStyle = '#020617';
    t2.fillRect(0, 0, W, H);

    // trilho
    const railX = 8, railW = W - 16;
    t2.fillStyle = '#0f172a';
    t2.fillRect(railX, yOf(totalMs), railW, yOf(0) - yOf(totalMs));

    // densidade de notas (quanto mais notas naquela altura, mais larga/clara a barra)
    const rows = Math.max(1, Math.floor(H / 2));
    const counts = new Array(rows).fill(0);
    let maxCount = 0;
    editorState.notes.forEach(n => {
        const r = Math.floor(yOf(Math.min(totalMs, Math.max(0, n.time))) / 2);
        if (r >= 0 && r < rows) { counts[r]++; if (counts[r] > maxCount) maxCount = counts[r]; }
    });
    if (maxCount > 0) {
        for (let r = 0; r < rows; r++) {
            if (!counts[r]) continue;
            const f = counts[r] / maxCount;
            const bw = Math.max(3, railW * (0.25 + 0.75 * f));
            t2.fillStyle = `rgba(34,211,238,${0.35 + 0.5 * f})`;
            t2.fillRect(railX + (railW - bw) / 2, r * 2, bw, 2);
        }
    }

    // janela visível
    const [v0, v1] = getEditorVisibleTimeRange();
    if (isFinite(v0) && isFinite(v1)) {
        const ya = yOf(Math.max(0, Math.min(totalMs, v1))), yb = yOf(Math.max(0, Math.min(totalMs, v0)));
        t2.fillStyle = 'rgba(148,163,184,0.14)';
        t2.strokeStyle = 'rgba(148,163,184,0.55)';
        t2.lineWidth = 1;
        t2.fillRect(2, ya, W - 4, Math.max(2, yb - ya));
        t2.strokeRect(2.5, ya + 0.5, W - 5, Math.max(2, yb - ya) - 1);
    }

    t2.font = 'bold 9px monospace';
    // seções
    (editorState.sections || []).forEach(sec => {
        const y = yOf(sec.time);
        t2.fillStyle = '#a78bfa';
        t2.fillRect(0, y - 1, W, 2);
        t2.fillStyle = '#ddd6fe';
        t2.textAlign = 'left';
        t2.fillText(String(sec.name).slice(0, 11), 2, y - 3);
    });
    // mudanças de BPM
    (editorState.bpmChanges || []).forEach(ch => {
        const y = yOf(ch.time);
        t2.fillStyle = '#fb923c';
        t2.fillRect(W - 14, y - 1, 14, 2);
        t2.fillStyle = '#fdba74';
        t2.textAlign = 'right';
        t2.fillText(`♩${formatBpmValue(ch.bpm)}`, W - 2, y + 10);
    });
    // pins
    (editorState.pins || []).forEach(pm => {
        const y = yOf(pm);
        t2.fillStyle = '#f59e0b';
        t2.beginPath();
        t2.moveTo(0, y - 4); t2.lineTo(6, y); t2.lineTo(0, y + 4);
        t2.closePath();
        t2.fill();
    });
    // posição atual
    const yNow = yOf(Math.max(0, Math.min(totalMs, getEditorElapsedMs())));
    t2.fillStyle = '#ef4444';
    t2.fillRect(0, yNow - 1, W, 2);
    // início / fim
    t2.fillStyle = '#475569';
    t2.textAlign = 'center';
    t2.font = '8px monospace';
    t2.fillText(formatEditorTime(totalMs), W / 2, 8);
    t2.fillText('0:00', W / 2, H - 1);
}

let editorTimelineDragging = false;
let editorTimelineLastSeek = 0;
function seekFromEditorTimelineEvent(e, force) {
    const g = editorTimelineGeometry();
    if (!g) return;
    const nowPerf = performance.now();
    if (!force && nowPerf - editorTimelineLastSeek < 60) return;
    editorTimelineLastSeek = nowPerf;
    const rect = g.c.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (g.H / (rect.height || g.H));
    goToEditorTime(g.tOf(y) / 1000);
    renderEditorTimeline();
}

// ----- Painel de propriedades -----
let editorPropsSignature = '';
function renderEditorPropertiesPanel(force = false) {
    const el = document.getElementById('editor-properties');
    if (!el) return;
    const sel = [...getSelectedEditorNoteIndices()].filter(i => editorState.notes[i]).sort((a, b) => a - b);
    const sig = JSON.stringify([
        sel.map(i => { const n = editorState.notes[i]; return [i, n.time, n.lane, n.holdEnd]; }),
        editorState.notes.length, editorState.bpm, editorState.bpmChanges, editorState.snap,
        editorState.mode, (editorState.sections || []).length, editorState.duration
    ]);
    if (!force && sig === editorPropsSignature) return;
    // Não reconstrói o painel embaixo de quem está digitando num campo dele
    if (!force && el.contains(document.activeElement)) return;
    editorPropsSignature = sig;

    const mode = editorState.mode;
    const laneCount = (KEY_CONFIGS[mode] || []).length;
    const btn = (id, label, cls = '') => `<button type="button" data-prop-action="${id}" class="px-2 py-1 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold ${cls}">${label}</button>`;

    if (sel.length === 1) {
        const n = editorState.notes[sel[0]];
        const holdMs = n.holdEnd != null ? Math.round(n.holdEnd - n.time) : 0;
        const beats = holdMs > 0 ? (holdMs / (60000 / editorBpmAt(n.time))).toFixed(2) : '0';
        const laneOpts = Array.from({ length: laneCount }, (_, i) => `<option value="${i}" ${i === n.lane ? 'selected' : ''}>${escapeHtml(getTrackLabel(mode, i))}</option>`).join('');
        el.innerHTML = `
            <div class="flex items-center justify-between"><span class="font-bold text-cyan-300">Nota selecionada</span>
                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${n.holdEnd != null ? 'bg-purple-500/20 text-purple-300' : 'bg-cyan-500/20 text-cyan-300'}">${n.holdEnd != null ? 'HOLD' : 'TAP'}</span></div>
            <div class="text-[10px] text-slate-400">${escapeHtml(describeEditorBeatPosition(n.time))} · ${formatEditorTime(n.time)} · ♩${formatBpmValue(editorBpmAt(n.time))}</div>
            <label class="flex items-center justify-between gap-2">Tempo (ms)
                <input data-prop-field="time" type="number" step="1" min="0" value="${Math.round(n.time)}" class="w-24 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-white text-right"></label>
            <label class="flex items-center justify-between gap-2">Lane
                <select data-prop-field="lane" class="w-32 bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-white">${laneOpts}</select></label>
            <label class="flex items-center justify-between gap-2">Hold (ms)
                <input data-prop-field="hold" type="number" step="1" min="0" value="${holdMs}" class="w-24 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-white text-right"></label>
            <div class="text-[10px] text-slate-500 text-right">0 = tap · ${beats} batida(s)</div>
            <div class="flex flex-wrap gap-1">${btn('time-', '◀ passo')}${btn('time+', 'passo ▶')}${btn('lane-', '◀ lane')}${btn('lane+', 'lane ▶')}${btn('delete', 'Apagar', 'text-red-300 border-red-700/60')}</div>`;
    } else if (sel.length > 1) {
        const notes = sel.map(i => editorState.notes[i]);
        const holds = notes.filter(n => n.holdEnd != null).length;
        const t0 = Math.min(...notes.map(n => n.time)), t1 = Math.max(...notes.map(n => n.holdEnd ?? n.time));
        el.innerHTML = `
            <div class="font-bold text-cyan-300">${sel.length} notas selecionadas</div>
            <div class="text-[10px] text-slate-400">${sel.length - holds} tap · ${holds} hold · de ${formatEditorTime(t0)} a ${formatEditorTime(t1)}</div>
            <div class="flex flex-wrap gap-1">${btn('time-', '◀ passo')}${btn('time+', 'passo ▶')}${btn('lane-', '◀ lane')}${btn('lane+', 'lane ▶')}${btn('delete', 'Apagar todas', 'text-red-300 border-red-700/60')}</div>
            <div class="text-[10px] text-slate-500">Ctrl+C / Ctrl+V copiam e colam o grupo inteiro. Na ferramenta Seleção (1), arraste uma delas pra mover todas juntas.</div>`;
    } else {
        const holds = editorState.notes.filter(n => n.holdEnd != null).length;
        const changes = editorState.bpmChanges || [];
        const chips = changes.map(ch => `<span class="inline-flex items-center gap-1 bg-orange-500/15 border border-orange-500/40 rounded px-1.5 py-0.5 text-[10px] text-orange-200">
                <button type="button" data-prop-jump="${ch.time}" class="hover:text-white">${formatEditorTime(ch.time)} ♩${formatBpmValue(ch.bpm)}</button>
                <button type="button" data-prop-remove-bpm="${ch.time}" class="font-bold hover:text-white" title="Remover esta mudança de BPM">×</button></span>`).join(' ');
        el.innerHTML = `
            <div class="font-bold text-cyan-300">Chart</div>
            <div class="text-[10px] text-slate-400">${editorState.notes.length} notas (${editorState.notes.length - holds} tap · ${holds} hold) · ${formatEditorTime(editorState.duration * 1000)}</div>
            <div class="text-[10px] text-slate-400">BPM inicial ${formatBpmValue(editorState.bpm)} · ${changes.length ? `${changes.length} mudança(s) de BPM:` : 'sem mudanças de BPM (B marca uma)'}</div>
            ${changes.length ? `<div class="flex flex-wrap gap-1">${chips}</div>` : ''}
            <div class="text-[10px] text-slate-500 leading-snug">Selecione uma nota pra editar tempo, lane e duração da hold com precisão. Ferramentas: 1 Seleção · 2 Tap · 3 Nota/Hold · 4 Borracha.</div>`;
    }
}

function applyEditorPropertyField(field, value) {
    const sel = [...getSelectedEditorNoteIndices()].filter(i => editorState.notes[i]);
    if (sel.length !== 1) return;
    const n = editorState.notes[sel[0]];
    const totalMs = editorState.duration * 1000;
    if (field === 'time') {
        const v = Math.round(parseFloat(value));
        if (!isFinite(v)) return;
        const hold = n.holdEnd != null ? n.holdEnd - n.time : null;
        n.time = Math.max(0, Math.min(totalMs, v));
        n.holdEnd = hold != null ? n.time + hold : null;
    } else if (field === 'lane') {
        const v = parseInt(value, 10);
        if (isFinite(v) && v >= 0 && v < (KEY_CONFIGS[editorState.mode] || []).length) n.lane = v;
    } else if (field === 'hold') {
        const v = Math.round(parseFloat(value));
        if (!isFinite(v)) return;
        n.holdEnd = v > 0 ? n.time + v : null;
    }
    renderEditorCanvas();
    renderEditorPropertiesPanel(true);
}

function nudgeSelectedEditorNotes(action) {
    const sel = [...getSelectedEditorNoteIndices()].filter(i => editorState.notes[i]);
    if (!sel.length) return;
    const notes = sel.map(i => editorState.notes[i]);
    if (action === 'delete') {
        sel.sort((a, b) => b - a).forEach(i => editorState.notes.splice(i, 1));
        editorState.selectedIndex = -1;
        editorState.selectedIndices = new Set();
    } else if (action === 'time-' || action === 'time+') {
        const dir = action === 'time+' ? 1 : -1;
        notes.forEach(n => {
            const newTime = Math.max(0, snapEditorTime(n.time + dir * editorSnapMsAt(n.time)));
            const delta = newTime - n.time;
            n.time = newTime;
            if (n.holdEnd != null) n.holdEnd += delta;
        });
    } else if (action === 'lane-' || action === 'lane+') {
        const order = getVisualOrder(editorState.mode);
        const dir = action === 'lane+' ? 1 : -1;
        const positions = notes.map(n => order.indexOf(n.lane));
        if (positions.some(p => p + dir < 0 || p + dir >= order.length)) return;
        notes.forEach((n, k) => { n.lane = order[positions[k] + dir]; });
    }
    renderEditorCanvas();
    renderEditorPropertiesPanel(true);
}

function bindEditorSidePanels() {
    const props = document.getElementById('editor-properties');
    if (props) {
        props.addEventListener('change', (e) => {
            const field = e.target?.dataset?.propField;
            if (field) applyEditorPropertyField(field, e.target.value);
        });
        props.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target?.dataset?.propField) { e.preventDefault(); e.target.blur(); }
        });
        props.addEventListener('click', (e) => {
            const t = e.target.closest('button');
            if (!t) return;
            if (t.dataset.propAction) nudgeSelectedEditorNotes(t.dataset.propAction);
            else if (t.dataset.propJump) goToEditorTime(parseFloat(t.dataset.propJump) / 1000);
            else if (t.dataset.propRemoveBpm) { removeEditorBpmChange(parseFloat(t.dataset.propRemoveBpm)); renderEditorPropertiesPanel(true); }
        });
    }
    const tl = document.getElementById('editor-timeline');
    if (tl) {
        tl.addEventListener('mousedown', (e) => { if (e.button !== 0) return; editorTimelineDragging = true; seekFromEditorTimelineEvent(e, true); });
        window.addEventListener('mousemove', (e) => { if (editorTimelineDragging) seekFromEditorTimelineEvent(e, false); });
        window.addEventListener('mouseup', (e) => { if (editorTimelineDragging) { editorTimelineDragging = false; seekFromEditorTimelineEvent(e, true); } });
    }
    window.addEventListener('resize', () => scheduleEditorSideUIRender());
}

// Nome curto e legível de um KeyboardEvent.code, usado nos botões de toque e no rebind
// de teclas das configurações — um lugar só pra essa formatação (inclui os dois novos
// códigos do TRACK L/R do 8B: ControlLeft/ControlRight).
function formatKeyCode(code) {
    return code
        .replace('ShiftLeft', 'L-SHIFT').replace('ShiftRight', 'R-SHIFT')
        .replace('ControlLeft', 'L-CTRL').replace('ControlRight', 'R-CTRL')
        .replace('Key', '').replace('Digit', '');
}

function setupControls() {
    const keys = KEY_CONFIGS[currentMode];
    keyState = new Array(keys.length).fill(false);
    keyLighting = new Array(keys.length).fill(0);
    activeHolds = new Array(keys.length).fill(null);

    const touchContainer = document.getElementById('touch-controls');
    touchContainer.innerHTML = '';
    keys.forEach((k, idx) => {
        const btn = document.createElement('button');
        btn.className = `flex-1 py-6 bg-slate-800/80 border border-slate-700 active:bg-cyan-500/50 rounded-lg text-xs font-orbitron font-bold text-slate-300`;
        btn.innerText = formatKeyCode(k);
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); handleKeyPress(idx, inputTimeFromEvent(e)); });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); handleKeyRelease(idx, inputTimeFromEvent(e)); });
        touchContainer.appendChild(btn);
    });
}

function stopAllGameLoops() {
    isPlaying = false;
    activeSection = null;
    isPaused = false;
    isCountingDown = false;
    isSongFinished = false;
    stopTrackForCurrentPattern();
    if (gameCheckInterval) {
        clearInterval(gameCheckInterval);
        gameCheckInterval = null;
    }
}

function togglePause() {
    if (!isPlaying || isCountingDown || isSongFinished) return;
    isPaused = !isPaused;
    const modal = document.getElementById('pause-modal');
    
    if (isPaused) {
        pauseStartTime = performance.now();
        stopTrackForCurrentPattern();
        updateLoopStatus();
        modal.classList.remove('hidden');
    } else {
        // Posição (ms) em que o jogo estava pausado, já contando rewind/skip/loop feitos durante a pausa
        const resumeChartMs = chartTimeAt(pauseStartTime);
        startTime += (performance.now() - pauseStartTime);
        startTrackForCurrentPattern(audioPosForChartTime(resumeChartMs));
        modal.classList.add('hidden');
    }
}

// Instante REAL em que a tecla foi apertada (e.timeStamp, mesma base do performance.now()),
// em vez do instante em que o JavaScript conseguiu rodar o handler — com a tela pesada (muito
// brilho/sombra desenhando), o handler pode rodar vários ms depois, e cada toque chegava com um
// atraso diferente (jitter), empurrando MAX 100% pra MAX 90% de forma aleatória.
function inputTimeFromEvent(e) {
    const now = performance.now();
    const ts = e && typeof e.timeStamp === 'number' ? e.timeStamp : NaN;
    if (isFinite(ts) && ts > 0 && ts <= now + 5 && now - ts < 1000) return ts;
    return now;
}

function handleKeyPress(laneIndex, inputTime = performance.now()) {
    audio.init();
    keyState[laneIndex] = true;
    keyLighting[laneIndex] = 1.0;
    
    audio.playHitSound(laneIndex);

    if (!isPlaying || isPaused || isCountingDown || isSongFinished) return;

    const currentTime = judgeTimeAt(inputTime);
    const winChart = TIMING.MAX1 * gameRate; // janela em ms reais -> ms do chart
    // Pega a nota MAIS PRÓXIMA no tempo, não a primeira que aparece no array — com duas
    // notas na mesma lane com janelas de MAX10 (170ms) se sobrepondo (padrões densos/rápidos),
    // find() antigo podia julgar contra a nota errada (mais distante) e "roubar" o acerto
    // certo da nota seguinte, dando a sensação de julgamento falhando às vezes.
    let targetNote = null;
    let bestDiff = Infinity;
    for (const n of notes) {
        if (n.lane !== laneIndex || n.hit || n.missed) continue;
        const d = Math.abs(n.time - currentTime);
        if (d <= winChart && d < bestDiff) { bestDiff = d; targetNote = n; }
    }

    if (targetNote) {
        const diff = (currentTime - targetNote.time) / gameRate; // ms reais
        targetNote.hit = true;
        processJudgment(diff, targetNote);
        createHitParticles(laneIndex, Math.abs(diff));

        if (targetNote.holdEnd) {
            targetNote.holdActive = true;
            activeHolds[laneIndex] = targetNote;
        }
    }
}

function handleKeyRelease(laneIndex, inputTime = performance.now()) {
    keyState[laneIndex] = false;

    const holdNote = activeHolds[laneIndex];
    if (holdNote && !holdNote.holdResolved) {
        const currentTime = judgeTimeAt(inputTime);
        resolveHoldTail(holdNote, (currentTime - holdNote.holdEnd) / gameRate);
    }
    activeHolds[laneIndex] = null;
}

// Soltura da nota longa, regra do DJMAX: só o começo e o fim são julgados. Se soltar dentro da
// faixa do MAX 10% em volta do fim (ou segurar até o fim), a hold vale O MESMO % da entrada —
// a precisão da soltura não importa. Soltar antes disso = BREAK.
function resolveHoldTail(note, tailDiffMs) {
    if (note.holdResolved) return;
    note.holdResolved = true;
    note.holdActive = false;

    if (tailDiffMs < -TIMING.MAX10) {
        // Nota longa é UMA nota só: soltou cedo, ela toda vira BREAK — tira o que a cabeça
        // tinha rendido (a cabeça já tinha contado como 1 nota na precisão).
        const headPct = note.headPct || 0;
        currentEarnedScore -= headPct;
        stats.rateSum = (stats.rateSum || 0) - headPct;
        note.pointsEarned = Math.max(0, (note.pointsEarned || 0) - headPct);
        if (headPct === 100) stats.judgments.max100 = Math.max(0, stats.judgments.max100 - 1);
        else if (headPct === 90) stats.judgments.max90 = Math.max(0, stats.judgments.max90 - 1);
        else if (headPct) stats.judgments.lower = Math.max(0, stats.judgments.lower - 1);
        if (headPct && stats.pctCounts && stats.pctCounts[headPct]) stats.pctCounts[headPct]--;
        (stats.events = stats.events || []).push({ t: note.time, lane: note.lane, b: 1, tail: 1 });
        stats.judgments.break++;
        stats.combo = 0;
        if (!noFailMode) hp = Math.max(0, hp - 5);
        lastJudgment = { text: 'BREAK', color: '#ef4444', subText: 'Soltou a nota longa cedo' };
        missShake = Math.min(1, missShake + 0.6);
        pushSideFx(note, 'break');
        return;
    }
    pushSideFx(note, 'ok');

    // Soltou no tempo (ou segurou até o fim): vale o MESMO % da cabeça — que já entrou na
    // precisão quando ela foi apertada. Aqui só soma o combo.
    const pct = note.headPct || 100;
    stats.combo++;
    if (stats.combo > stats.maxCombo) stats.maxCombo = stats.combo;
    if (pct > 1) hp = Math.min(100, hp + 1);
    lastJudgment = { text: `MAX ${pct}%`, color: JUDGE_COLORS[pct] || '#ffffff', subText: 'NOTA LONGA' };
}

// Combo extra enquanto segura a nota longa (o jogo também soma combo no meio da hold):
// +1 a cada meio tempo segurado. Não mexe no RATE.
function tickHoldCombo(note, currentTime) {
    if (!note.holdActive || note.holdResolved) return;
    if (!note.holdTickMs) {
        const segs = getTempoSegmentsForPattern(currentPatternType);
        const seg = tempoSegmentAt(segs, note.time - CUSTOM_CHART_START_DELAY_MS);
        note.holdTickMs = Math.max(60, seg.msPerBeat / 2);
        note.holdTicks = 0;
    }
    const until = Math.min(currentTime, note.holdEnd - note.holdTickMs * 0.5);
    const ticks = Math.max(0, Math.floor((until - note.time) / note.holdTickMs));
    if (ticks > note.holdTicks) {
        stats.combo += ticks - note.holdTicks;
        if (stats.combo > stats.maxCombo) stats.maxCombo = stats.combo;
        note.holdTicks = ticks;
    }
}

window.addEventListener('keydown', (e) => {
    // Captura de keybind tem prioridade sobre QUALQUER atalho (inclusive Digit1/Digit2/
    // Numpad1/Numpad2) — senão nunca dava pra vincular essas teclas a uma lane, já que
    // o atalho de velocidade abaixo roubava o evento antes de chegar aqui.
    if (listeningAltIndex !== null) {
        e.preventDefault();
        const mode = keybindEditMode || currentMode;
        const arr = (ALT_KEY_CONFIGS[mode] = (ALT_KEY_CONFIGS[mode] || []).slice());
        // Esc/Backspace/Delete = sem tecla extra; tecla que já é principal de outra lane não vale
        const clash = KEY_CONFIGS[mode].indexOf(e.code);
        if (['Escape', 'Backspace', 'Delete'].includes(e.code) || (clash !== -1 && clash !== listeningAltIndex)) arr[listeningAltIndex] = null;
        else arr[listeningAltIndex] = e.code === KEY_CONFIGS[mode][listeningAltIndex] ? null : e.code;
        arr.forEach((c, i) => { if (i !== listeningAltIndex && c && c === arr[listeningAltIndex]) arr[i] = null; });
        listeningAltIndex = null;
        renderKeybindInputs();
        saveSettings();
        return;
    }
    if (listeningKeyIndex !== null) {
        e.preventDefault();
        KEY_CONFIGS[keybindEditMode || currentMode][listeningKeyIndex] = e.code;
        listeningKeyIndex = null;
        renderKeybindInputs();
        setupControls();
        saveSettings();
        return;
    }

    // Enquanto o editor de charts está aberto, ou o foco está num campo de texto/número/select
    // (título do chart, BPM, etc.), nenhum atalho global de jogo deve disparar — senão digitar
    // "p" no nome do chart pausaria o jogo, ou "1"/"2" mexeriam na velocidade de scroll.
    const activeTag = document.activeElement && document.activeElement.tagName;
    const isTypingField = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
    const editorModalEl = document.getElementById('chart-editor-modal');
    const isEditorOpen = editorModalEl && !editorModalEl.classList.contains('hidden');
    if (isTypingField || isEditorOpen) return;

    if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); return; }

    // F8 reinicia a partida atual do zero (mesmo chart/padrão), a qualquer momento — jogando,
    // pausado, ou já na tela de resultado. startPractice() já cuida de tudo: para os loops
    // antigos, regenera as notas, zera stats/HP e refaz a contagem regressiva.
    if (e.code === 'F8') {
        e.preventDefault();
        if (isPlaying) startPractice();
        return;
    }

    const laneIdx = laneForKey(currentMode, e.code);

    // Atalho de troca rápida de velocidade (Digit1 = diminuir, Digit2 = aumentar).
    // Só dispara se a tecla NÃO estiver mapeada a uma lane no modo atual — do contrário,
    // depois de vincular Digit1/Digit2/Numpad1/Numpad2 a uma coluna, o atalho continuaria
    // roubando o input e a nota nunca seria registrada como acerto.
    if (laneIdx === -1) {
        if (e.code === 'Digit1' || e.code === 'Numpad1') {
            e.preventDefault();
            changeSpeed(-0.1);
            saveSettings();
            return;
        }
        if (e.code === 'Digit2' || e.code === 'Numpad2') {
            e.preventDefault();
            changeSpeed(0.1);
            saveSettings();
            return;
        }
    }

    if (e.repeat) return;
    if (laneIdx !== -1) {
        (heldKeysByLane[laneIdx] = heldKeysByLane[laneIdx] || new Set()).add(e.code);
        handleKeyPress(laneIdx, inputTimeFromEvent(e));
    }
});

window.addEventListener('keyup', (e) => {
    const idx = laneForKey(currentMode, e.code);
    if (idx === -1) return;
    const held = heldKeysByLane[idx];
    if (held) { held.delete(e.code); if (held.size) return; } // a outra tecla da lane ainda está apertada
    handleKeyRelease(idx, inputTimeFromEvent(e));
});
window.addEventListener('blur', () => { Object.keys(heldKeysByLane).forEach(k => heldKeysByLane[k].clear()); });

const JUDGE_COLORS = { 100: '#fcd34d', 90: '#5eead4', 80: '#86efac', 70: '#a3e635', 60: '#facc15', 50: '#fb923c', 40: '#f97316', 30: '#f472b6', 20: '#c084fc', 10: '#a78bfa', 1: '#94a3b8' };

function processJudgment(diffMs, note) {
    const absDiff = Math.abs(diffMs);
    stats.hitOffsets.push(diffMs);
    if (note && isCalibrationRun()) (note.ghost ? (stats.calAudio = stats.calAudio || []) : (stats.calVisual = stats.calVisual || [])).push(diffMs);

    const scoreVal = Math.max(1, judgePctFor(absDiff));
    const text = `MAX ${scoreVal}%`;
    const color = JUDGE_COLORS[scoreVal] || '#ffffff';
    if (scoreVal === 100) stats.judgments.max100++;
    else if (scoreVal === 90) stats.judgments.max90++;
    else stats.judgments.lower++;
    stats.pctCounts = stats.pctCounts || {};
    stats.pctCounts[scoreVal] = (stats.pctCounts[scoreVal] || 0) + 1;
    if (note) note.headPct = scoreVal;
    if (note) (stats.events = stats.events || []).push({ t: note.time, lane: note.lane, d: Math.round(diffMs * 10) / 10, p: scoreVal });

    if (diffMs < 0) stats.earlyHits++; else stats.lateHits++;

    currentEarnedScore += scoreVal;
    stats.rateSum = (stats.rateSum || 0) + scoreVal;
    stats.rateCount = (stats.rateCount || 0) + 1;
    if (note) note.pointsEarned = (note.pointsEarned || 0) + scoreVal;
    stats.combo++;
    if (stats.combo > stats.maxCombo) stats.maxCombo = stats.combo;
    // MAX 1% mantém o combo mas não enche o HP (igual ao jogo)
    if (scoreVal > 1) hp = Math.min(100, hp + 1);

    const fastLateText = diffMs < -4 ? `FAST (${Math.round(diffMs)}ms)` : (diffMs > 4 ? `SLOW (+${Math.round(diffMs)}ms)` : 'PERFECT');
    lastJudgment = { text, color, subText: fastLateText };
}

function registerBreak(note) {
    if (note) (stats.events = stats.events || []).push({ t: note.time, lane: note.lane, b: 1 });
    stats.judgments.break++;
    stats.rateCount = (stats.rateCount || 0) + 1;
    stats.combo = 0;
    if (!noFailMode) {
        hp = Math.max(0, hp - 8);
    }
    lastJudgment = { text: 'BREAK', color: '#ef4444', subText: 'MISSED' };
    missShake = Math.min(1, missShake + 0.8);
}

// absDiffMs (opcional) é o quão perto do tempo ideal foi o acerto — usado pra dar um
// impacto visual maior em MAX100 do que em MAX50, igual ao "juice" de um MAX real no
// DJMAX. Sem o parâmetro (ex: soltura de hold), cai no impacto "bom" por padrão.
function createHitParticles(laneIndex, absDiffMs = 0) {
    // Lane extra (side note OU TRACK L/R) não tem coluna própria no jogo (é sobreposição
    // de meia tela) — usa o retângulo dela pra centralizar a faísca; lanes normais usam a
    // coluna de sempre.
    const mainLaneCount = getMainLaneCount(currentMode);
    const extraIdx = getSideLaneIndices(currentMode) || getTrackLRIndices(currentMode);
    const isExtraLane = extraIdx && laneIndex >= mainLaneCount;
    const column = isExtraLane
        ? getSideOverlayRect(canvas.logicalWidth, laneIndex === extraIdx[0])
        : getGameplayColumnLayout(currentMode, canvas.logicalWidth)[laneIndex];
    let x = column.x + column.width / 2;
    let y = canvas.logicalHeight - 80;
    if (isGameHighwayView()) {
        const hp = getGameHighwayHitPoint(laneIndex);
        x = hp.x;
        y = hp.y;
    }
    const color = getKeyColorScheme(currentMode, gearSkin)[laneIndex];

    const isPerfect = absDiffMs <= TIMING.MAX100;
    const particleCount = isPerfect ? 24 : 16;
    const speedBase = isPerfect ? 4 : 3;
    const speedRange = isPerfect ? 9 : 6;

    for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
        const speed = speedBase + Math.random() * speedRange;
        hitParticles.push({
            x, y,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 1.0, color
        });
    }

    if (isExtraLane && !isGameHighwayView() || (isExtraLane && gameView !== 'highway_tilt')) {
        // side track / TRACK L/R: clarão largo na metade inteira, faíscas espalhadas pela largura
        hitParticles.splice(hitParticles.length - particleCount, particleCount);
        for (let i = 0; i < particleCount; i++) {
            hitParticles.push({ x: column.x + Math.random() * column.width, y, vx: (Math.random() - 0.5) * 2.5, vy: -3 - Math.random() * 7, life: 1.0, color });
        }
        hitFlashes.push({ x: column.x + column.width / 2, y, life: 1.0, color, big: isPerfect, wide: column.width });
        return;
    }
    hitFlashes.push({ x, y, life: 1.0, color, big: isPerfect });
}

// Clareia (amount > 0) ou escurece (amount < 0) uma cor hex, misturando com branco/preto
// na proporção de |amount| (0..1) — usado pro sombreamento cilíndrico da hold note (ver
// drawHoldNote) e em qualquer outro lugar que precise de uma variação clara/escura de uma
// cor sem precisar de uma segunda cor "fixa" combinando com toda paleta de gear skin.
function shadeColor(hex, amount) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    const target = amount > 0 ? 255 : 0;
    const t = Math.min(1, Math.abs(amount));
    const mix = (c) => Math.round(c + (target - c) * t);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Nota "orbe": anel externo + gradiente radial + núcleo branco (inspirado em Cytus/Arcaea)
function drawCytusOrb(xCenter, yCenter, radius, colorHex) {
    ctx.save();
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.shadowColor = colorHex;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(xCenter, yCenter, radius, 0, Math.PI * 2);
    ctx.stroke();

    const radGrad = ctx.createRadialGradient(xCenter, yCenter, radius * 0.1, xCenter, yCenter, radius * 0.85);
    radGrad.addColorStop(0, '#ffffff');
    radGrad.addColorStop(0.4, colorHex);
    radGrad.addColorStop(1, 'rgba(0,0,0,0.85)');

    ctx.shadowBlur = 0;
    ctx.fillStyle = radGrad;
    ctx.beginPath();
    ctx.arc(xCenter, yCenter, radius * 0.85, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(xCenter, yCenter, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Bônus: 2 note skins novas, pedidas pelo usuário — "efeitos legais" contínuos (a
// animação roda pelo próprio relógio do navegador, performance.now(), não pelo tempo da
// música, então é só decoração passiva — não interfere no julgamento de acerto).

// "Hex Gem": gema hexagonal girando devagar sem parar, com gradiente radial por dentro.
function drawHexGem(xCenter, yCenter, radius, colorHex) {
    ctx.save();
    const rot = ((noteAnimClockOverride ?? performance.now()) / 900) % (Math.PI * 2);

    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = colorHex;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = rot + (Math.PI * 2 * i) / 6;
        const px = xCenter + Math.cos(a) * radius, py = yCenter + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    const grad = ctx.createRadialGradient(xCenter, yCenter, radius * 0.1, xCenter, yCenter, radius * 0.85);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.45, colorHex);
    grad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.shadowBlur = 0;
    ctx.fillStyle = grad;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = rot + (Math.PI * 2 * i) / 6;
        const px = xCenter + Math.cos(a) * radius * 0.82, py = yCenter + Math.sin(a) * radius * 0.82;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// "Pulse Core": núcleo com anel de pulso tipo "sonar" se expandindo pra fora sem parar.
function drawPulseCore(xCenter, yCenter, radius, colorHex) {
    ctx.save();
    const cyclePos = (performance.now() / 480) % 1; // 0 -> 1, sempre repetindo
    if (!noteAnimSkipPulseRing) {
        const ringRadius = radius * (0.9 + cyclePos * 0.9);
        const baseAlpha = ctx.globalAlpha;
        ctx.globalAlpha = baseAlpha * 0.5 * (1 - cyclePos);
        ctx.strokeStyle = colorHex;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(xCenter, yCenter, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = baseAlpha;
    }

    ctx.shadowColor = colorHex;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(xCenter, yCenter, radius * 0.78, 0, Math.PI * 2);
    ctx.stroke();

    const grad = ctx.createRadialGradient(xCenter, yCenter, radius * 0.05, xCenter, yCenter, radius * 0.7);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, colorHex);
    grad.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.shadowBlur = 0;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(xCenter, yCenter, radius * 0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Skins redondas novas na gear clássica (vista de cima): Disco, Esfera e Anel.
function drawRoundSkinFlat(x, y, r, color, shape) {
    ctx.save();
    if (shape === 'disc') {
        ctx.beginPath(); ctx.arc(x, y + r * 0.12, r, 0, Math.PI * 2);
        ctx.fillStyle = shadeColor(color, -0.55); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = shadeColor(color, -0.35); ctx.fill();
    } else if (shape === 'orb') {
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, shadeColor(color, 0.35));
        g.addColorStop(0.75, color); g.addColorStop(1, shadeColor(color, -0.5));
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.shadowColor = color; ctx.shadowBlur = 16; ctx.fill();
    } else {
        ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, r * 0.3); ctx.shadowColor = color; ctx.shadowBlur = 16; ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = Math.max(1, r * 0.07); ctx.stroke();
    }
    ctx.restore();
}

// Notas "barra fina" no estilo Respect V (skins novas): 'djmax' (barra fina com brilho em
// cima), 'hexbar' (pontas em bico) e 'crossbar' (barra com marquinhas em X). x/y = canto de
// cima-esquerda; usado na gear clássica e na cabeça da nota da Gear 3D.
const THIN_NOTE_SHAPES = ['djmax', 'hexbar', 'crossbar'];
function drawThinNoteShape(x, y, w, h, color, shape) {
    ctx.save();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shadeColor(color, 0.6));
    g.addColorStop(0.35, color);
    g.addColorStop(1, shadeColor(color, -0.4));
    ctx.beginPath();
    if (shape === 'hexbar') {
        const tip = Math.min(h * 0.55, w * 0.18);
        ctx.moveTo(x, y + h / 2);
        ctx.lineTo(x + tip, y);
        ctx.lineTo(x + w - tip, y);
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w - tip, y + h);
        ctx.lineTo(x + tip, y + h);
        ctx.closePath();
    } else if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, Math.min(4, h * 0.25));
    } else {
        ctx.rect(x, y, w, h);
    }
    ctx.fillStyle = g;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = shape === 'hexbar' ? 2 : 1.3;
    ctx.stroke();
    // reflexo de luz na metade de cima
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    const inset = shape === 'hexbar' ? Math.min(h * 0.55, w * 0.18) : 3;
    ctx.fillRect(x + inset, y + 2, w - inset * 2, Math.max(1, h * 0.22));
    if (shape === 'crossbar') {
        ctx.strokeStyle = shadeColor(color, -0.55);
        ctx.lineWidth = 2.2;
        const r = Math.min(h * 0.28, 6);
        [x + w * 0.3, x + w * 0.7].forEach(cx => {
            const cy = y + h / 2;
            ctx.beginPath();
            ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
            ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
            ctx.stroke();
        });
    }
    ctx.restore();
}

function drawNote(lane, noteY, column, noteHeight) {
    const color = getKeyColorScheme(currentMode, gearSkin)[lane];
    const laneWidth = column.width;
    const xCenter = column.x + laneWidth / 2;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;

    if (noteShape === 'circle') {
        const radius = Math.min(laneWidth / 2 - 2, noteHeight * 0.9);
        ctx.restore(); // drawCytusOrb cuida do próprio save/restore/shadow
        drawCytusOrb(xCenter, noteY, radius, color);
        return;
    } else if (noteShape === 'hex') {
        const radius = Math.min(laneWidth / 2 - 2, noteHeight * 0.95);
        ctx.restore(); // drawHexGem cuida do próprio save/restore/shadow
        drawHexGem(xCenter, noteY, radius, color);
        return;
    } else if (noteShape === 'pulse') {
        const radius = Math.min(laneWidth / 2 - 2, noteHeight * 0.9);
        ctx.restore(); // drawPulseCore cuida do próprio save/restore/shadow
        drawPulseCore(xCenter, noteY, radius, color);
        return;
    } else if (THIN_NOTE_SHAPES.includes(noteShape)) {
        ctx.restore();
        const h = noteHeight * 0.52;
        drawThinNoteShape(column.x + 4, noteY - h / 2, laneWidth - 8, h, color, noteShape);
        return;
    } else if (noteShape === 'disc' || noteShape === 'orb' || noteShape === 'ring') {
        const radius = Math.min(laneWidth / 2 - 4, noteHeight * 0.85);
        ctx.restore();
        drawRoundSkinFlat(xCenter, noteY, radius, color, noteShape);
        return;
    } else if (noteShape === 'diamond') {
        const halfW = laneWidth / 2 - 4;
        const halfH = noteHeight * 0.9;
        ctx.beginPath();
        ctx.moveTo(xCenter, noteY - halfH);
        ctx.lineTo(xCenter + halfW, noteY);
        ctx.lineTo(xCenter, noteY + halfH);
        ctx.lineTo(xCenter - halfW, noteY);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    } else {
        const w = laneWidth - 6;
        const h = noteHeight;
        const x = column.x + 3;
        const y = noteY - h / 2;

        const barGrad = ctx.createLinearGradient(x, y, x, y + h);
        barGrad.addColorStop(0, '#ffffff');
        barGrad.addColorStop(0.3, color);
        barGrad.addColorStop(0.7, color);
        barGrad.addColorStop(1, '#0f172a');

        ctx.fillStyle = barGrad;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = '#ef4444';
        ctx.fillRect(xCenter - 3, y + h / 2 - 3, 6, 6);
    }

    ctx.restore();
}

// Rastro de luz (comet tail) atrás da nota enquanto ela desce — alonga com a velocidade
// de scroll, então em speeds altas parece "riscar" mais, reforçando a sensação de movimento
function drawNoteTrail(lane, noteY, column, noteHeight, speedFactor, alpha) {
    const color = getKeyColorScheme(currentMode, gearSkin)[lane];
    const xCenter = column.x + column.width / 2;
    const trailW = column.width * 0.5;
    const steps = 4;
    const stepPx = Math.max(6, speedFactor * 2.2);

    for (let i = steps; i >= 1; i--) {
        const trailY = noteY - i * stepPx;
        if (trailY < -70) continue;
        const stepAlpha = alpha * (1 - i / (steps + 1)) * 0.28;
        if (stepAlpha <= 0.01) continue;

        ctx.save();
        ctx.globalAlpha = stepAlpha;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.fillRect(xCenter - trailW / 2, trailY - noteHeight * 0.18, trailW, noteHeight * 0.36);
        ctx.restore();
    }
}

// Desenha a nota com efeito de entrada: fade-in rápido perto do topo da tela (spawnT, em
// PIXELS a partir do limite de desenho -50, não por tempo — assim acontece sempre na mesma
// faixa da tela, com qualquer velocidade) MAIS um crescimento de profundidade bem mais suave e
// contínuo (depthT), ao longo de praticamente a queda visível INTEIRA até a linha de
// julgamento — não só um "pulo" de tamanho perto do topo como antes. É a aproximação possível
// de "profundidade"/3D em canvas 2D: a nota nasce um pouco menor (mais "longe") e cresce aos
// poucos conforme se aproxima, terminando um pouco MAIOR que o tamanho-base bem em cima da
// linha (um "pop" sutil de chegada) — sem mexer em hit-test/julgamento, que continuam 100%
// baseados em note.time, nunca no tamanho desenhado.
function drawNoteWithEntryFx(lane, noteY, column, noteHeight, speedFactor) {
    const FADE_PX = 90;
    const spawnT = noteY < (-50 + FADE_PX) ? Math.max(0, Math.min(1, (noteY + 50) / FADE_PX)) : 1;

    if (spawnT <= 0.02) return;

    const targetY = canvas.logicalHeight - 80;
    const GROW_PX = Math.max(150, targetY + 50); // do limite de desenho (-50) até a linha de julgamento
    const depthT = Math.max(0, Math.min(1, (noteY + 50) / GROW_PX));
    // Tamanho CONSTANTE (como no DJMAX): a nota crescendo na descida fazia a borda de baixo
    // "acelerar" perto da linha e mudava a sensação de tempo entre os visuais.
    const depthScale = 1 + 0 * depthT;

    drawNoteTrail(lane, noteY, column, noteHeight, speedFactor, spawnT);

    ctx.globalAlpha = spawnT * modAlphaNow;
    drawNote(lane, noteY, column, noteHeight * depthScale);
    ctx.globalAlpha = modAlphaNow;
}

// Desenha o corpo de uma nota longa (hold), do topo (cauda) até a base (cabeça), mais
// brilhante enquanto está sendo segurada corretamente. Ideia do usuário (via o filho
// dele): em vez da barra genérica de antes (retângulo com cantinho arredondado + a note
// skin só aparecendo como um "boné" separado na ponta durante a entrada — ver
// drawNoteWithEntryFx), a hold agora é UMA PEÇA SÓ, sólida, no formato de um cilindro de
// verdade: cápsula com as duas pontas em semicírculo CHEIO (raio = metade da largura, não
// só um cantinho) e sombreamento HORIZONTAL simulando luz batendo numa superfície redonda
// (escuro-clareado com "brilho" quase branco de um lado, escuro do outro) — em vez do
// preenchimento chapado de uma cor só que existia antes.
function drawHoldNote(lane, headY, tailY, column, isActive) {
    const color = getKeyColorScheme(currentMode, gearSkin)[lane];
    const laneWidth = column.width;
    const xCenter = column.x + laneWidth / 2;
    const bodyWidth = Math.min(laneWidth - 10, 74);
    const radius = bodyWidth / 2;
    const x = xCenter - bodyWidth / 2;
    const top = Math.min(headY, tailY);
    const bottom = Math.max(headY, tailY);
    const height = Math.max(radius * 2, bottom - top);

    ctx.save();
    ctx.globalAlpha = isActive ? 0.97 : 0.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = isActive ? 30 : 6;

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, top, bodyWidth, height, radius);
    } else {
        // Fallback manual da cápsula pra navegador sem roundRect: reto nos lados, semicírculo
        // cheio nas duas pontas (mesmo resultado visual do roundRect com raio = metade da largura).
        ctx.moveTo(x, top + radius);
        ctx.arc(xCenter, top + radius, radius, Math.PI, Math.PI * 2);
        ctx.lineTo(x + bodyWidth, bottom - radius);
        ctx.arc(xCenter, bottom - radius, radius, 0, Math.PI);
        ctx.closePath();
    }

    // Gradiente HORIZONTAL (não vertical) — é isso que faz parecer um tubo 3D redondo em
    // vez de uma barra chapada: sombra na borda esquerda, brilho quase branco perto do
    // centro (onde a luz "bateria" num cilindro real), volta pra cor cheia, sombra na
    // borda direita.
    const tubeGrad = ctx.createLinearGradient(x, 0, x + bodyWidth, 0);
    tubeGrad.addColorStop(0, shadeColor(color, -0.55));
    tubeGrad.addColorStop(0.22, shadeColor(color, -0.15));
    tubeGrad.addColorStop(0.42, shadeColor(color, 0.45));
    tubeGrad.addColorStop(0.58, '#ffffff');
    tubeGrad.addColorStop(0.72, color);
    tubeGrad.addColorStop(1, shadeColor(color, -0.6));
    ctx.fillStyle = tubeGrad;
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isActive ? '#ffffff' : shadeColor(color, -0.35);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;
    ctx.restore();
}

// Lane extra (SIDE TRACK verde OU TRACK L/R vermelho) no jogo: NÃO é uma coluna própria
// — é uma faixa translúcida por cima da metade esquerda/direita da gear (rect vem de
// getSideOverlayRect), do topo até a linha de julgamento, igual uma hold gigante.
// Desenhada ANTES das notas normais (mais abaixo em render()) pra elas continuarem
// visíveis por cima, como no jogo real. color/label generalizam entre os dois tipos —
// mesma mecânica visual, só muda a identidade.
function drawSideTrackOverlay(rect, headY, tailY, isActive, color = SIDE_NOTE_COLOR, label = 'SIDE TRACK', held = false) {
    // isActive pode ser true/false ou o brilho 0..1 (sideGlowStep) — mesmo visual do WebGL
    const glow = typeof isActive === 'number' ? isActive : (isActive ? 1 : 0);
    const top = Math.min(headY, tailY);
    const bottom = Math.max(headY, tailY);
    const h = Math.max(2, bottom - top);
    const x = rect.x, w = rect.width;
    const base = 0.12 + 0.2 * glow;
    const fade = Math.min(90, h * 0.45);
    const P = make2DFxPainter(ctx);
    ctx.save();
    P.rectV(x, top, w, fade, glWithAlpha(color, 0), glWithAlpha(color, base));
    if (h > fade) P.rect(x, top + fade, w, h - fade, glWithAlpha(color, base));
    const ea = 0.45 + 0.45 * glow;
    P.rectV(x + 2, top, 2.5, Math.min(fade, h), glWithAlpha(color, 0), glWithAlpha(color, ea));
    P.rectV(x + w - 4.5, top, 2.5, Math.min(fade, h), glWithAlpha(color, 0), glWithAlpha(color, ea));
    if (h > fade) {
        P.rect(x + 2, top + fade, 2.5, h - fade, glWithAlpha(color, ea));
        P.rect(x + w - 4.5, top + fade, 2.5, h - fade, glWithAlpha(color, ea));
    }
    if (!held) P.rectV(x + 4, bottom - 12, w - 8, 12, glWithAlpha('#ffffff', 0.85), glWithAlpha(color, 0.95));
    if (h > 70) {
        ctx.globalAlpha = 0.35 + 0.35 * glow;
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 18px Orbitron';
        ctx.textAlign = 'center';
        const labelY = Math.max(top + fade * 0.6 + 18, Math.min(bottom - 22, (top + bottom) / 2));
        ctx.fillText(label, x + w / 2, labelY);
    }
    ctx.restore();
}

// Pintor do Canvas 2D que entende o "_additive" das funções de efeito do WebGL (game-gl.js)
function make2DFxPainter(c) {
    const P = make2DPainter(c);
    Object.defineProperty(P, '_additive', {
        get() { return c.globalCompositeOperation === 'lighter'; },
        set(v) { c.globalCompositeOperation = v ? 'lighter' : 'source-over'; }
    });
    return P;
}

// Aviso de "vem uma side track" ANTES dela ficar visível na tela — um selo perto do topo
// que pisca por um tempinho antes do início real da faixa, dando tempo do jogador reagir
// (é exatamente o "aviso" que o usuário descreveu, com o nome do lado que está chegando).
// introT: 0 (aviso acabou de aparecer) -> 1 (a side track está prestes a chegar). Usado
// pra uma ENTRADA suave (fade-in) em vez de já nascer no brilho máximo. pulseT: fase de
// um pulso BEM lento (pouco mais de 1 ciclo em toda a janela de aviso) — antes eram ~3
// ciclos inteiros em só 900ms, o que piscava rápido demais pra ler com conforto.
function drawSideTrackWarning(rect, isLeft, pulseT, introT) {
    // Mais perto do meio da tela do que antes (era y=54, quase colado no topo) — mas sem
    // encostar na zona do COMBO/julgamento (ver render(): textos ficam entre
    // logicalHeight/2-94 e logicalHeight/2+64, ou seja ~446-604 numa tela de 1080). y=300
    // deixa uma folga bem confortável acima disso mesmo com a caixa maior.
    const y = canvas.logicalHeight * SIDE_WARNING_Y_FRAC; // abaixo do COMBO
    const fadeIn = Math.min(1, introT / 0.25); // suaviza a chegada nos primeiros 25% da janela
    const slowPulse = 0.78 + 0.22 * Math.sin(pulseT * Math.PI * 2);
    const alpha = fadeIn * slowPulse;
    if (alpha <= 0.02) return;

    const label = isLeft ? '◄ SIDE TRACK' : 'SIDE TRACK ►';
    // Caixa maior que antes (era 340x56) — pedido do usuário pra ficar mais fácil de ler.
    const boxW = Math.min(rect.width * 0.94, 420);
    const boxH = 78;
    const boxX = rect.x + rect.width / 2 - boxW / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(74, 222, 128, 0.28)';
    ctx.fillRect(boxX, y - boxH / 2, boxW, boxH);
    ctx.strokeStyle = SIDE_NOTE_COLOR;
    ctx.lineWidth = 3;
    ctx.shadowColor = SIDE_NOTE_COLOR;
    ctx.shadowBlur = 16;
    ctx.strokeRect(boxX, y - boxH / 2, boxW, boxH);
    ctx.shadowBlur = 0;

    // Fonte bem maior que antes (era até 30px) — com um teto que encolhe sozinho só se a
    // caixa for estreita demais pro texto caber, pra nunca vazar da faixa.
    let fontSize = 38;
    ctx.textAlign = 'center';
    ctx.font = `900 ${fontSize}px Orbitron`;
    const maxTextWidth = boxW - 24;
    while (fontSize > 18 && ctx.measureText(label).width > maxTextWidth) {
        fontSize -= 2;
        ctx.font = `900 ${fontSize}px Orbitron`;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, rect.x + rect.width / 2, y + fontSize * 0.32);
    ctx.restore();
}

// Ciclo de vida de uma nota a cada frame, IGUAL nos dois visuais de jogo (gear clássica e
// Gear 3D): marca BREAK quando passa da janela de julgamento sem ser tocada e resolve sozinha
// a hold segurada até o fim. Devolve false se a nota já saiu de cena (não desenhar).
function drawGameHpBar(mainColor) {
    const barW = gameView === 'highway_tilt' ? Math.min(canvas.logicalWidth * 0.5, 620) : canvas.logicalWidth - 20;
    const x = (canvas.logicalWidth - barW) / 2;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x, 10, barW, 8);
    ctx.fillStyle = hpDisplayed > 30 ? mainColor : '#ef4444';
    ctx.fillRect(x, 10, barW * (hpDisplayed / 100), 8);
}

// ===== Side Track: brilho animado e efeitos de fim =====
// Altura do aviso "SIDE TRACK" (fração da altura da gear): mais pra baixo que antes (ficava
// atrás do número do COMBO), entre o combo e o julgamento.
const SIDE_WARNING_Y_FRAC = 0.45;
let sideFx = [];
// Brilho da faixa acende rápido ao acertar e apaga suave ao soltar (em vez de trocar seco).
function sideGlowStep(note, dtMs) {
    const target = note.holdActive ? 1 : 0;
    const g = note.sideGlow || 0;
    const k = 1 - Math.exp(-Math.max(0, dtMs) / (target > g ? 55 : 160));
    note.sideGlow = g + (target - g) * k;
    return note.sideGlow;
}
function pushSideFx(note, kind) {
    const ov = note && note._ov;
    if (!ov) return;
    sideFx.push({ x: ov.x, w: ov.w, top: ov.top, bottom: ov.bottom, color: ov.color, kind, life: 1 });
    if (sideFx.length > 12) sideFx.shift();
}

function advanceNoteLifecycle(note, currentTime) {
    const isHold = !!note.holdEnd;
    if (note.hit && !isHold) return false; // nota tap normal já resolvida
    if (isHold && note.holdResolved) return false; // hold já concluída (acerto ou break)
    const timeDiff = note.time - currentTime;
    if (!note.hit) {
        // mesma janela do julgamento (que desconta judgeOffset)
        if (!isCountingDown && !isSongFinished && timeDiff < -(TIMING.MAX1 + getActiveJudgeOffset()) * gameRate && !note.missed) {
            note.missed = true;
            if (isHold) note.holdResolved = true; // hold nunca começou, não dá pra soltar depois
            pushSideFx(note, 'miss');
            registerBreak(note);
        }
        if (note.missed) return false;
    }
    if (isHold) {
        tickHoldCombo(note, currentTime - getActiveJudgeOffset() * gameRate);
        // Segurou até o fim sem soltar: resolve automaticamente como acerto perfeito
        if (note.holdActive && !note.holdResolved && currentTime - getActiveJudgeOffset() * gameRate > note.holdEnd + HOLD_TIMING.PERFECT * gameRate) {
            resolveHoldTail(note, 0);
            return false;
        }
        if (note.holdResolved) return false;
    }
    return true;
}

// ===== Tela de jogo na Gear 3D (mesma projeção do editor, com a velocidade do jogador) =====
function getGameHighwayProjection() {
    const w = canvas.logicalWidth, h = canvas.logicalHeight;
    const windowMs = (h - 30) / Math.max(0.0001, renderedSpeedFactor); // = tempo na tela da SPEED
    if (gameView === 'highway_tilt') {
        return getHighwayProjection(w, h, windowMs, { strikeFromBottom: 64, topY: 22, farScale: 0.3, nearWidth: Math.min(w * 0.62, h * 1.6) });
    }
    // Gear 3D reta: exatamente o tamanho/geometria da Gear clássica (mesma tela 520:1080, linha
    // de acerto no mesmo lugar, nota nascendo no mesmo ponto e na mesma velocidade) — só a
    // pista e as notas é que são desenhadas com volume.
    return getFlatHighwayProjection(w, h, windowMs, w); // lanes nas MESMAS colunas da gear clássica
}

// Gear 3D "reta": mesmo desenho 3D (volume, brilho, trilhos), mas SEM inclinação/afunilamento —
// a pista tem a mesma largura de cima a baixo e a nota desce em velocidade CONSTANTE, igual à
// gear clássica. Na versão inclinada, a perspectiva faz a nota andar devagar lá no fundo e
// acelerar perto da linha, o que atrapalha calcular o instante exato do toque.
// Mesma "interface" da projeção em perspectiva (xOf/yOfZ/zOfTime...), então todo o resto do
// desenho funciona igual nas duas.
function getFlatHighwayProjection(w, h, windowMs, nearWidth) {
    const strikeY = h - 80;  // mesma linha de acerto da gear clássica
    const topY = -50;        // mesmo ponto onde a nota "nasce" na clássica
    const zFar = 1;
    const cx = w / 2;
    const span = strikeY - topY;
    return {
        w, h, strikeY, topY, zFar, zPast: -0.07, nearWidth, cx, windowMs, tilted: false,
        vanishY: -Infinity,
        scaleAt: () => 1,
        zOfTime: (t, now) => ((t - now) / windowMs) * zFar,
        timeOfZ: (z, now) => now + (z / zFar) * windowMs,
        yOfZ: (z) => strikeY - (z / zFar) * span,
        zOfY: (y) => ((strikeY - y) / span) * zFar,
        xOf: (u) => cx + (u - 0.5) * nearWidth
    };
}

// Posição (u de 0..1 na pista) do centro de uma lane no jogo — lanes principais têm coluna;
// side/TRACK L/R cobrem a metade esquerda/direita, igual à gear clássica.
function getGameHighwayLaneSpan(laneIndex) {
    const kinds = getLaneKinds(currentMode);
    const kind = kinds[laneIndex];
    if (kind === 'main') {
        const col = getGameplayColumnLayout(currentMode, 1)[laneIndex];
        return { u0: col.x, u1: col.x + col.width, overlay: false };
    }
    const pair = getLaneIndicesOfKind(currentMode, kind);
    const rect = getSideOverlayRect(1, !!pair && pair[0] === laneIndex);
    return { u0: rect.x, u1: rect.x + rect.width, overlay: true, kind };
}

function getGameHighwayHitPoint(laneIndex) {
    const proj = getGameHighwayProjection();
    const span = getGameHighwayLaneSpan(laneIndex);
    return { x: proj.xOf((span.u0 + span.u1) / 2, 0), y: proj.strikeY, width: proj.xOf(span.u1, 0) - proj.xOf(span.u0, 0) };
}

function drawGameHighwayScene(currentTime, mainColor, dt, withNotes) {
    const proj = getGameHighwayProjection();
    const { xOf, yOfZ, zOfTime, zFar, zPast, strikeY, topY } = proj;
    const W = canvas.logicalWidth, H = canvas.logicalHeight;
    const mode = currentMode;
    const colors = getKeyColorScheme(mode, gearSkin);
    const mainCols = getGameplayColumnLayout(mode, 1);
    const mainCount = getMainLaneCount(mode);
    const quad = (u0, u1, z0, z1) => {
        ctx.beginPath();
        ctx.moveTo(xOf(u0, z0), yOfZ(z0));
        ctx.lineTo(xOf(u1, z0), yOfZ(z0));
        ctx.lineTo(xOf(u1, z1), yOfZ(z1));
        ctx.lineTo(xOf(u0, z1), yOfZ(z1));
        ctx.closePath();
    };

    // Gear com moldura (gears novas): corpo pronto da gear no lugar do fundo/pista 3D
    const themeL = typeof getGearLayout === 'function' && getGearLayout().frame ? getGearLayout() : null;
    const themeP = themeL ? make2DPainter(ctx) : null;
    if (themeL) drawGearLaneBase(themeP, themeL, true);
    else {
    // Fundo com um "brilho" do horizonte na cor da skin, pulsando na batida
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#01030a');
    bg.addColorStop(0.55, '#050a18');
    bg.addColorStop(1, '#0a1022');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // (na Gear 3D reta a pista cobre a tela toda e escondia esse brilho — só na inclinada)
    if (proj.tilted) {
    const halo = ctx.createRadialGradient(W / 2, topY + 10, 10, W / 2, topY + 10, W * 0.45);
    halo.addColorStop(0, mainColor + '33');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalAlpha = 0.6 + beatPulse * 0.4;
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H * 0.6);
    ctx.restore();
    }

    // Pista + faixas das lanes principais
    const body = ctx.createLinearGradient(0, topY, 0, strikeY);
    body.addColorStop(0, '#070d1c');
    body.addColorStop(1, '#101a30');
    quad(0, 1, zPast, zFar);
    ctx.fillStyle = body;
    ctx.fill();
    mainCols.forEach((col, i) => {
        quad(col.x, col.x + col.width, zPast, zFar);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.05)';
        ctx.fill();
    });
    }

    // Feixe de luz da tecla apertada (subindo pela pista a partir da linha)
    for (let i = 0; i < keyLighting.length; i++) {
        if (!(keyLighting[i] > 0)) continue;
        const span = getGameHighwayLaneSpan(i);
        const grad = ctx.createLinearGradient(0, strikeY, 0, yOfZ(zFar * 0.55));
        grad.addColorStop(0, colors[i] || mainColor);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.globalAlpha = keyLighting[i] * (span.overlay ? 0.25 : 0.45);
        quad(span.u0, span.u1, 0, zFar * 0.55);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
        keyLighting[i] -= 0.05 * dt;
    }

    // Linhas de batida (seguem o BPM do padrão/chart, inclusive mudanças de BPM)
    if (isPlaying) {
        const segs = getTempoSegmentsForPattern(currentPatternType);
        const tMin = proj.timeOfZ(0, currentTime), tMax = proj.timeOfZ(zFar, currentTime);
        segs.forEach(seg => {
            const segStart = CUSTOM_CHART_START_DELAY_MS + seg.start;
            const segEnd = CUSTOM_CHART_START_DELAY_MS + seg.end;
            if (segEnd < tMin || segStart > tMax) return;
            let k = Math.max(0, Math.ceil((Math.max(tMin, segStart) - segStart) / seg.msPerBeat));
            for (let guard = 0; guard < 200; guard++, k++) {
                const t = segStart + k * seg.msPerBeat;
                if (t > tMax || t >= segEnd - 0.5) break;
                const z = zOfTime(t, currentTime);
                const isMeasure = k % 4 === 0;
                ctx.strokeStyle = isMeasure ? mainColor + 'aa' : 'rgba(148,163,184,0.22)';
                ctx.lineWidth = (isMeasure ? 2.4 : 1.2) * Math.max(0.4, proj.scaleAt(z));
                ctx.beginPath();
                ctx.moveTo(xOf(0, z), yOfZ(z));
                ctx.lineTo(xOf(1, z), yOfZ(z));
                ctx.stroke();
            }
        });
    }

    // Divisórias e bordas (as bordas brilham na batida)
    if (!themeL) mainCols.forEach(col => {
        ctx.strokeStyle = 'rgba(255,255,255,0.09)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xOf(col.x, zPast), yOfZ(zPast));
        ctx.lineTo(xOf(col.x, zFar), yOfZ(zFar));
        ctx.stroke();
    });
    if (!proj.tilted && !themeL) {
        // Trilhos laterais com volume (metal escovado + brilho da skin) — é o que dá a cara
        // de "3D" à gear reta, junto do volume das notas.
        [[0, -1], [1, 1]].forEach(([u, dir]) => {
            const x = xOf(u, 0);
            const railW = 10;
            const x0 = dir < 0 ? x : x - railW; // por dentro da tela (a pista agora vai de ponta a ponta)
            const g = ctx.createLinearGradient(x0, 0, x0 + railW, 0);
            g.addColorStop(0, dir < 0 ? '#0b1224' : '#475569');
            g.addColorStop(0.5, '#94a3b8');
            g.addColorStop(1, dir < 0 ? '#475569' : '#0b1224');
            ctx.fillStyle = g;
            ctx.globalAlpha = 0.55;
            ctx.fillRect(x0, topY, railW, yOfZ(zPast) - topY);
            ctx.globalAlpha = 1;
        });
        // sombra interna perto das bordas (dá profundidade de "canaleta")
        [[0, 1], [1, -1]].forEach(([u, dir]) => {
            const x = xOf(u, 0);
            const g = ctx.createLinearGradient(x, 0, x + dir * 40, 0);
            g.addColorStop(0, 'rgba(0,0,0,0.45)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(dir > 0 ? x : x - 40, topY, 40, yOfZ(zPast) - topY);
        });
    }
    ctx.save();
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 3 + beatPulse * 2;
    ctx.shadowColor = mainColor;
    ctx.shadowBlur = 8 + beatPulse * 14;
    if (!themeL) [0, 1].forEach(u => {
        ctx.beginPath();
        ctx.moveTo(xOf(u, zPast), yOfZ(zPast));
        ctx.lineTo(xOf(u, zFar), yOfZ(zFar));
        ctx.stroke();
    });
    ctx.restore();

    if (withNotes) drawGameHighwayNotes(proj, quad, currentTime, colors, dt);

    // Cobertura (mods SUDDEN/HIDDEN) no espaço da pista: SUDDEN esconde o fundo (as notas
    // "aparecem de repente" mais perto), HIDDEN esconde o trecho perto da linha. (Na Gear 3D
    // reta a cobertura é a mesma da clássica, desenhada depois das notas em render().)
    if (!proj.tilted) {
        // nada aqui
    } else if (coverMod === 'sudden') {
        quad(-0.02, 1.02, zFar * 0.42, zFar);
        ctx.fillStyle = '#060b18';
        ctx.fill();
    } else if (coverMod === 'hidden') {
        quad(-0.02, 1.02, zFar * 0.05, zFar * 0.3);
        ctx.fillStyle = '#060b18';
        ctx.fill();
    }

    // Névoa no fundo (profundidade)
    if (themeL) {
        drawGearStrikeLine(themeP, themeL, mainColor);
    } else {
    const fog = ctx.createLinearGradient(0, topY - 4, 0, topY + 110);
    fog.addColorStop(0, 'rgba(1,3,10,1)');
    fog.addColorStop(1, 'rgba(1,3,10,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, topY - 4, W, 114);

    // Linha de acerto
    ctx.save();
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 5 + beatPulse * 4;
    ctx.shadowColor = mainColor;
    ctx.shadowBlur = 14 + beatPulse * 12;
    ctx.beginPath();
    ctx.moveTo(xOf(0, 0), strikeY);
    ctx.lineTo(xOf(1, 0), strikeY);
    ctx.stroke();
    ctx.restore();
    }

    // Brilho na linha de cada lane enquanto a tecla está apertada (sempre visível)
    const keys = KEY_CONFIGS[mode] || [];
    for (let i = 0; i < keys.length; i++) {
        if (!(keyState && keyState[i])) continue;
        const span = getGameHighwayLaneSpan(i);
        ctx.save();
        ctx.fillStyle = colors[i] || mainColor;
        ctx.globalAlpha = span.overlay ? 0.35 : 0.8;
        ctx.shadowColor = colors[i] || mainColor;
        ctx.shadowBlur = 18;
        ctx.fillRect(xOf(span.u0, 0) + 3, strikeY - 4, xOf(span.u1, 0) - xOf(span.u0, 0) - 6, 8);
        ctx.restore();
    }

    // Etiquetas das teclas: aparecem na contagem (e com o jogo pausado) e somem logo depois
    // que a música começa, pra não ocupar espaço/atenção durante a partida.
    const labelAlpha = themeL ? 0 : getGameKeyLabelAlpha(currentTime);
    if (labelAlpha > 0.01) {
        const padY = strikeY + 8;
        ctx.save();
        ctx.globalAlpha = labelAlpha;
        mainCols.forEach((col, i) => {
            const x0 = xOf(col.x, 0) + 4, x1 = xOf(col.x + col.width, 0) - 4;
            ctx.fillStyle = colors[i] || mainColor;
            ctx.globalAlpha = labelAlpha * 0.35;
            ctx.fillRect(x0, padY, x1 - x0, 26);
            ctx.globalAlpha = labelAlpha;
            ctx.fillStyle = '#f1f5f9';
            ctx.font = 'bold 15px Orbitron, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(keys[i] ? formatKeyCode(keys[i]) : String(i + 1), (x0 + x1) / 2, padY + 19);
        });
        for (let i = mainCount; i < keys.length; i++) {
            const span = getGameHighwayLaneSpan(i);
            const x0 = xOf(span.u0, 0) + 4, x1 = xOf(span.u1, 0) - 4;
            const y = padY + 30 + (span.kind === 'side' ? 0 : 14);
            ctx.fillStyle = colors[i] || '#4ade80';
            ctx.globalAlpha = labelAlpha * 0.3;
            ctx.fillRect(x0, y, x1 - x0, 12);
            ctx.globalAlpha = labelAlpha;
            ctx.fillStyle = '#e2e8f0';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${span.kind === 'side' ? 'SIDE' : 'TRACK'} ${formatKeyCode(keys[i])}`, (x0 + x1) / 2, y + 10);
        }
        ctx.restore();
    }
}

// Opacidade das etiquetas de tecla na Gear 3D: 100% na contagem/pausa, some entre 1.5s e
// 2.5s depois da música começar.
function getGameKeyLabelAlpha(currentTime) {
    if (!isPlaying || isPaused || isCountingDown) return 1;
    return Math.max(0, Math.min(1, 1 - (currentTime - 1500) / 1000));
}

function drawGameHighwaySideWarning(proj, quad, lane, isLeft, timeToStart, currentTime) {
    const { xOf, yOfZ, zFar, h } = proj;
    const W = canvas.logicalWidth;
    const span = getGameHighwayLaneSpan(lane);
    const pulse = 0.5 + 0.5 * Math.sin(currentTime / 110);
    const keys = KEY_CONFIGS[currentMode] || [];
    // entra suave (primeiros 250ms do aviso)
    const appear = Math.max(0, Math.min(1, (proj.windowMs + 1600 - timeToStart) / 250));

    ctx.save();
    // faixa na metade da pista
    ctx.globalAlpha = appear * (0.07 + pulse * 0.1);
    quad(span.u0, span.u1, 0, zFar);
    ctx.fillStyle = SIDE_NOTE_COLOR;
    ctx.fill();

    // letreiro fora da pista, na altura de ~38% da tela
    const y = h * 0.38;
    const z = proj.zOfY(y);
    const edgeX = xOf(isLeft ? 0 : 1, z);
    let cx = isLeft ? Math.max(90, edgeX / 2) : Math.min(W - 90, edgeX + (W - edgeX) / 2);
    let boxW = Math.min(220, Math.max(150, isLeft ? edgeX - 16 : W - edgeX - 16));
    if (!proj.tilted) {
        // gear reta ocupa a tela toda na largura: o letreiro vai DENTRO da metade certa
        cx = xOf((span.u0 + span.u1) / 2, z);
        boxW = Math.min(220, xOf(span.u1, z) - xOf(span.u0, z) - 20);
    }
    ctx.globalAlpha = appear * (0.75 + pulse * 0.25);
    ctx.fillStyle = 'rgba(5, 46, 22, 0.85)';
    ctx.strokeStyle = SIDE_NOTE_COLOR;
    ctx.lineWidth = 3;
    ctx.shadowColor = SIDE_NOTE_COLOR;
    ctx.shadowBlur = 18 + pulse * 18;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(cx - boxW / 2, y - 58, boxW, 116, 14);
    else ctx.rect(cx - boxW / 2, y - 58, boxW, 116);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#bbf7d0';
    ctx.font = 'bold 40px Orbitron, sans-serif';
    ctx.fillText(isLeft ? '◀◀' : '▶▶', cx, y - 14);
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SIDE TRACK', cx, y + 16);
    ctx.font = 'bold 14px Orbitron, monospace';
    ctx.fillStyle = '#86efac';
    const secs = Math.max(0, timeToStart / 1000).toFixed(1);
    ctx.fillText(`${keys[lane] ? formatKeyCode(keys[lane]) : ''} · ${secs}s`, cx, y + 42);
    ctx.restore();
}

function drawGameHighwayNotes(proj, quad, currentTime, colors, dt) {
    const { zOfTime, zFar, strikeY, xOf, yOfZ } = proj;
    const HEAD_DZ = proj.tilted ? 0.05 * noteSizeScale : (NOTE_HEIGHT_BASE * noteSizeScale) / (proj.strikeY - proj.topY);
    const sideIdx = getSideLaneIndices(currentMode);

    // Aviso de SIDE TRACK chegando: bem visível — faixa verde pulsando na metade certa da pista
    // + um letreiro grande "◀ SIDE TRACK" do lado de fora da pista, com a tecla e a contagem,
    // desde 1.6s antes de a faixa entrar na tela até ela chegar na linha.
    if (sideIdx) {
        const upcoming = {};
        notes.forEach(note => {
            if (note.lane !== sideIdx[0] && note.lane !== sideIdx[1]) return;
            if (note.hit || note.missed || note.holdResolved) return;
            const timeToStart = note.time - currentTime;
            if (timeToStart <= 0 || timeToStart > proj.windowMs + 1600) return;
            if (upcoming[note.lane] == null || timeToStart < upcoming[note.lane]) upcoming[note.lane] = timeToStart;
        });
        Object.keys(upcoming).forEach(laneStr => {
            const lane = +laneStr;
            drawGameHighwaySideWarning(proj, quad, lane, lane === sideIdx[0], upcoming[lane], currentTime);
        });
    }

    // Coleta o que aparece e desenha de trás pra frente
    const visible = [];
    notes.forEach(note => {
        if (!advanceNoteLifecycle(note, frameLogicT)) return;
        const zHead = note.hit ? 0 : zOfTime(note.time, currentTime);
        if (zHead > zFar) return;
        const zTail = note.holdEnd ? zOfTime(note.holdEnd, currentTime) : zHead;
        if (zTail < proj.zPast) return;
        visible.push({ note, zHead, zTail });
    });
    visible.sort((a, b) => b.zHead - a.zHead);

    visible.forEach(({ note, zHead, zTail }) => {
        const span = getGameHighwayLaneSpan(note.lane);
        const color = span.overlay ? (span.kind === 'trackLR' ? TRACK_LR_COLOR : SIDE_NOTE_COLOR) : (colors[note.lane] || '#22d3ee');
        const isHold = !!note.holdEnd;

        if (span.overlay) {
            // Side/TRACK L/R: faixa translúcida na metade da pista (mesma mecânica da gear clássica)
            const z0 = Math.max(0, zHead - (isHold ? 0 : HEAD_DZ));
            const z1 = Math.min(zFar, isHold ? zTail : zHead + HEAD_DZ);
            if (z1 <= z0) return;
            ctx.save();
            ctx.globalAlpha = note.holdActive ? 0.42 : 0.24;
            quad(span.u0 + 0.004, span.u1 - 0.004, z0, z1);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = note.holdActive ? 18 : 8;
            ctx.stroke();
            ctx.restore();
            return;
        }

        const inset = (span.u1 - span.u0) * 0.24;
        if (isHold) {
            const z0 = Math.max(0, zHead), z1 = Math.min(zFar, zTail);
            if (z1 > z0) {
                ctx.save();
                const grad = ctx.createLinearGradient(0, yOfZ(z0), 0, yOfZ(z1));
                grad.addColorStop(0, color + (note.holdActive ? 'ee' : 'aa'));
                grad.addColorStop(1, color + '55');
                quad(span.u0 + inset, span.u1 - inset, z0, z1);
                ctx.fillStyle = grad;
                if (note.holdActive) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
                ctx.fill();
                ctx.restore();
            }
            if (note.holdActive) {
                // Anel pulsante achatado (em perspectiva) + faíscas na linha enquanto segura
                const cx = xOf((span.u0 + span.u1) / 2, 0);
                const pulse = 0.5 + Math.sin(currentTime / 90) * 0.5;
                ctx.save();
                ctx.globalAlpha = 0.5 + pulse * 0.4;
                ctx.strokeStyle = color;
                ctx.lineWidth = 4;
                ctx.shadowColor = color;
                ctx.shadowBlur = 20 + pulse * 15;
                ctx.beginPath();
                const rx = 26 + pulse * 8;
                ctx.ellipse(cx, strikeY, rx, rx * 0.42, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                const laneW = xOf(span.u1, 0) - xOf(span.u0, 0);
                const sparkChance = Math.min(1, 0.6 * dt);
                for (let s = 0; s < 3; s++) {
                    if (Math.random() < sparkChance) {
                        hitParticles.push({ x: cx + (Math.random() - 0.5) * (laneW - 16), y: strikeY, vx: (Math.random() - 0.5) * 3, vy: -3 - Math.random() * 3, life: 0.8, color });
                    }
                }
            }
        }
        if (!note.hit && zHead >= 0 - HEAD_DZ && zHead <= zFar) {
            const pad = (span.u1 - span.u0) * 0.06;
            ctx.save();
            // Passou da linha sem ser tocada: some rapidinho em vez de cobrir os botões
            if (zHead < 0) ctx.globalAlpha = Math.max(0, 1 + zHead / HEAD_DZ);
            drawGameHighwayGem(proj, quad, span, zHead, color, HEAD_DZ, pad, currentTime);
            ctx.restore();
        }
    });
}

// Desenha a cabeça da nota na Gear 3D seguindo a Note Skin escolhida. As formas redondas são
// elipses "deitadas" na pista (achatadas pela perspectiva), menos a Esfera, que fica em pé.
function drawGameHighwayGem(proj, quad, span, z, color, HEAD_DZ, pad, t) {
    const { xOf, yOfZ } = proj;
    const uc = (span.u0 + span.u1) / 2;
    const cx = xOf(uc, z), cy = yOfZ(z);
    const laneW = xOf(span.u1, z) - xOf(span.u0, z);
    const rx = Math.max(4, laneW * 0.4);
    const ry = Math.min(rx * 0.55, Math.max(2.5, Math.abs(yOfZ(z - HEAD_DZ * 0.9) - yOfZ(z + HEAD_DZ * 0.9)) * 0.75, rx * 0.34));
    const ellipse = (sx, sy) => { ctx.beginPath(); ctx.ellipse(cx, cy, rx * sx, ry * sy, 0, 0, Math.PI * 2); };

    switch (noteShape) {
        case 'circle': { // Orbe (Cytus): anel + gradiente radial
            const g = ctx.createRadialGradient(cx, cy - ry * 0.2, 1, cx, cy, rx);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.35, color);
            g.addColorStop(1, 'rgba(0,0,0,0.75)');
            ellipse(1, 1);
            ctx.fillStyle = g;
            ctx.shadowColor = color;
            ctx.shadowBlur = 14;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            break;
        }
        case 'disc': { // Disco estilo Guitar Hero: espessura + face + anel branco + miolo
            ctx.beginPath();
            ctx.ellipse(cx, cy + ry * 0.45, rx, ry, 0, 0, Math.PI * 2);
            ctx.fillStyle = shadeColor(color, -0.55);
            ctx.fill();
            ellipse(1, 1);
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
            ellipse(0.62, 0.62);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1.5, rx * 0.12);
            ctx.stroke();
            ellipse(0.3, 0.3);
            ctx.fillStyle = shadeColor(color, -0.35);
            ctx.fill();
            break;
        }
        case 'orb': { // Esfera 3D em pé: sombra na pista + bola com brilho
            const r = rx * 0.62;
            ellipse(0.85, 0.7);
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fill();
            const bx = cx, by = cy - r * 0.55;
            const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.4, r * 0.08, bx, by, r);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.3, shadeColor(color, 0.35));
            g.addColorStop(0.75, color);
            g.addColorStop(1, shadeColor(color, -0.5));
            ctx.beginPath();
            ctx.arc(bx, by, r, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.shadowColor = color;
            ctx.shadowBlur = 16;
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
        }
        case 'ring': { // Anel vazado com brilho
            ellipse(0.82, 0.82);
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(3, rx * 0.3);
            ctx.shadowColor = color;
            ctx.shadowBlur = 16;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ellipse(0.82, 0.82);
            ctx.strokeStyle = 'rgba(255,255,255,0.75)';
            ctx.lineWidth = Math.max(1, rx * 0.07);
            ctx.stroke();
            break;
        }
        case 'pulse': { // Núcleo + onda de sonar achatada
            const cyc = (t / 480) % 1;
            ctx.save();
            if (noteAnimSkipPulseRing) ctx.globalAlpha = 0;
            ctx.globalAlpha *= 0.55 * (1 - cyc);
            ellipse(0.8 + cyc * 0.7, 0.8 + cyc * 0.7);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx * 0.7);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.5, color);
            g.addColorStop(1, 'rgba(0,0,0,0.6)');
            ellipse(0.7, 0.7);
            ctx.fillStyle = g;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
        }
        case 'hex': { // Hexágono girando, deitado na pista
            const rot = t / 900;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = rot + (Math.PI * 2 * i) / 6;
                const px = cx + Math.cos(a) * rx * 0.95, py = cy + Math.sin(a) * ry * 0.95;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.45, color);
            g.addColorStop(1, 'rgba(0,0,0,0.7)');
            ctx.fillStyle = g;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            break;
        }
        case 'diamond': {
            ctx.beginPath();
            ctx.moveTo(cx, yOfZ(z + HEAD_DZ * 0.9));
            ctx.lineTo(xOf(span.u1 - pad, z), cy);
            ctx.lineTo(cx, yOfZ(z - HEAD_DZ * 0.9));
            ctx.lineTo(xOf(span.u0 + pad, z), cy);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            break;
        }
        case 'djmax':
        case 'hexbar':
        case 'crossbar': { // barras finas (Respect): mesmo desenho da gear clássica
            const x0 = xOf(span.u0 + pad * 0.6, z), x1 = xOf(span.u1 - pad * 0.6, z);
            const h = Math.abs(yOfZ(z - HEAD_DZ / 2) - yOfZ(z + HEAD_DZ / 2)) * 0.52;
            drawThinNoteShape(x0, cy - h / 2, x1 - x0, h, color, noteShape);
            break;
        }
        default: { // 'bar' (DJMAX): barra com brilho em cima
            quad(span.u0 + pad, span.u1 - pad, z - HEAD_DZ / 2, z + HEAD_DZ / 2);
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 1.4;
            ctx.stroke();
            quad(span.u0 + pad * 2, span.u1 - pad * 2, z + HEAD_DZ * 0.05, z + HEAD_DZ * 0.42);
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fill();
        }
    }
}

let renderClockMs = 0;
let modAlphaNow = 1; // opacidade da nota sendo desenhada (FADER, ver modificadores.js)
// Tempo do chart pra LÓGICA do quadro (erros por passar da linha, ticks de nota longa): continua
// pelo performance.now(), como sempre — o replay depende dessa ordem exata. Só o desenho usa o
// relógio do quadro (renderClockMs).
let frameLogicT = 0;
let _menuEl = null, _hubEl = null;
function menuCobreJogo() {
    if (!_menuEl) _menuEl = document.getElementById('menu-overlay');
    if (!_hubEl || !_hubEl.isConnected) _hubEl = document.getElementById('bm-hub');
    return !!((_hubEl && _hubEl.classList.contains('on')) || (_menuEl && !_menuEl.classList.contains('hidden')));
}
function render(timestamp) {
    // dt normalizado: 1.0 equivale a um frame de 60fps. Usado para que decaimentos
    // (partículas, flashes, pulso de batida, faíscas) e a suavização de HP/speed durem
    // sempre o mesmo tempo REAL, não importa o refresh rate da tela (60/144/240Hz etc.)
    if (typeof timestamp !== 'number') timestamp = performance.now();
    // Relógio do QUADRO: as notas são posicionadas pelo horário do quadro (o mesmo pra tudo
    // que é desenhado nele, espaçado certinho pelo vsync), e não pelo performance.now() do
    // meio do desenho — esse variava alguns ms de quadro pra quadro (GC, outros timers,
    // tempo de desenho) e fazia as notas "tremerem" de leve, mais visível em speed alta.
    // Só o DESENHO usa isso: o julgamento continua pelo horário exato de cada tecla.
    // Fora da partida, com o menu (ou o menu inicial) cobrindo a tela, não tem o que desenhar:
    // pula o quadro. Desenhar a gear inteira escondida a 60fps pesava e fazia o vídeo do menu travar.
    if (!isPlaying && !isCountingDown && menuCobreJogo()) { lastFrameTimestamp = null; requestAnimationFrame(render); return; }
    renderClockMs = timestamp;
    if (typeof trackFrameStats === 'function') trackFrameStats(timestamp);
    if (audio.ctx) { audio.sampleClock(); if (audio.customMedia) followMediaClock(); else followAudioClock(); }
    // Placa de vídeo (WebGL): o mesmo frame, desenhado por game-gl.js. Se der qualquer erro,
    // desliga o WebGL e segue no Canvas 2D daqui pra frente.
    if (typeof isGLGameActive === 'function' && isGLGameActive()) {
        try {
            renderGLFrame(timestamp);
            requestAnimationFrame(render);
            return;
        } catch (e) {
            console.error('[WebGL] erro no frame, voltando pro Canvas 2D:', e);
            glFailReason = 'erro durante o jogo: ' + (e && e.message);
            glGame = null;
            applyRendererVisibility();
            resizeCanvas();
        }
    }
    if (lastFrameTimestamp === null) lastFrameTimestamp = timestamp;
    const dtMs = Math.min(timestamp - lastFrameTimestamp, 100); // trava salto grande (aba em 2º plano etc.)
    lastFrameTimestamp = timestamp;
    const dt = dtMs / (1000 / 60);

    ctx.clearRect(0, 0, canvas.totalWidth || canvas.logicalWidth, canvas.totalHeight || canvas.logicalHeight);
    // Gear com moldura: desenha pilares/painel e passa a desenhar a área das lanes deslocada
    const gearL = typeof getGearLayout === 'function' ? getGearLayout() : { frame: false, F: 0 };
    const gearP2 = gearL.frame ? make2DPainter(ctx) : null;
    if (gearL.frame) drawGearFrame2DBack(gearL);
    ctx.save();
    if (gearL.frame) {
        ctx.translate(gearL.F, 0);
        ctx.beginPath();
        ctx.rect(0, 0, canvas.logicalWidth, canvas.logicalHeight);
        ctx.clip();
    }
    else if (!isGameHighwayView()) { // a Gear 3D pinta o próprio fundo por cima
        ctx.fillStyle = `rgba(2, 6, 23, ${0.92 * laneOpacityPct / 100})`;
        ctx.fillRect(0, 0, canvas.logicalWidth, canvas.logicalHeight);
    }

    // Shake de tela ao errar/quebrar hold — pequeno deslocamento aleatório que decai com o tempo
    if (missShake > 0) {
        const shakeMag = missShake * 7;
        ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
        missShake = Math.max(0, missShake - 0.05 * dt);
    }

    // A gear no jogo mostra SÓ as lanes principais — a side note não reserva coluna
    // própria (ver getGameplayColumnLayout / getSideOverlayRect): ela é uma sobreposição
    // translúcida desenhada por cima da metade esquerda/direita dessas colunas, mais
    // abaixo, exatamente como no jogo real, sem aumentar a largura da gear.
    const mainLaneCount = getMainLaneCount(currentMode);
    const columns = getGameplayColumnLayout(currentMode, canvas.logicalWidth);
    const sideIdx = getSideLaneIndices(currentMode); // [SIDE_L, SIDE_R] ou null (4K/5K/6K)
    const trackLRIdx = getTrackLRIndices(currentMode); // [TRACK_L, TRACK_R] ou null (só 8B)
    const targetY = canvas.logicalHeight - 80;

    const currentTime = isPlaying ? chartTimeAt(isPaused ? pauseStartTime : renderClockMs) : 0;
    frameLogicT = isPlaying ? chartTimeAt(isPaused ? pauseStartTime : performance.now()) : 0;

    // Pulso visual sincronizado ao BPM da música, calculado direto do tempo decorrido —
    // funciona igual pra música procedural (que já tinha seu próprio gatilho por step, ainda
    // deixado como está, redundante mas inofensivo), MP3 importado, e chart custom com áudio
    // real, que antes nunca disparavam esse efeito (só o setInterval da música procedural
    // fazia isso). Detecta a TROCA de batida (não fica marcando o mesmo beat de novo a cada
    // frame) comparando o índice do beat atual com o último que já pulsou.
    if (isPlaying && !isPaused) {
        const pulseSegs = getTempoSegmentsForPattern(currentPatternType);
        {
            // Grade de batida começa em 2000ms (lead-in antes da 1ª nota, ver generateNotes/
            // CUSTOM_CHART_START_DELAY_MS) e segue as mudanças de BPM do chart, se houver.
            const rel = currentTime - CUSTOM_CHART_START_DELAY_MS;
            const seg = tempoSegmentAt(pulseSegs, rel);
            const beatIdx = seg.index * 1e6 + Math.floor((rel - seg.start) / seg.msPerBeat);
            if (beatIdx > lastPulseBeatIndex) {
                beatPulse = 1.0;
                lastPulseBeatIndex = beatIdx;
            }
        }
    }

    const useHighway = isGameHighwayView();
    if (gearL.frame && !useHighway) {
        // gear com moldura: corpo da pista pronto + feixe das teclas
        drawGearLaneBase(gearP2, gearL, true);
        const kc = getKeyColorScheme(currentMode, gearSkin);
        for (let i = 0; i < mainLaneCount; i++) {
            if (keyLighting[i] > 0) {
                const col = columns[i];
                gearP2.rectV(col.x, 0, col.width, targetY, glWithAlpha(kc[i], 0), glWithAlpha(kc[i], keyLighting[i] * 0.4));
                keyLighting[i] -= 0.05 * dt;
            }
        }
    }
    for (let i = 0; i < ((useHighway || gearL.frame) ? 0 : mainLaneCount); i++) {
        const col = columns[i];
        ctx.fillStyle = i % 2 === 0 ? 'rgba(15, 23, 42, 0.6)' : 'rgba(30, 41, 59, 0.6)';
        ctx.fillRect(col.x, 0, col.width, canvas.logicalHeight);

        if (gearSkin === 'cyan') {
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.15)';
            ctx.lineWidth = 1;
            ctx.strokeRect(col.x, 0, col.width, canvas.logicalHeight);
        } else if (gearSkin === 'crimson') {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.05)';
            ctx.fillRect(col.x + col.width / 2 - 2, 0, 4, canvas.logicalHeight);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
            ctx.strokeRect(col.x, 0, col.width, canvas.logicalHeight);
        } else if (gearSkin === 'gold') {
            ctx.strokeStyle = 'rgba(234, 179, 8, 0.25)';
            ctx.lineWidth = 2;
            ctx.strokeRect(col.x + 2, 0, col.width - 4, canvas.logicalHeight);
        } else if (gearSkin === 'sakura') {
            const sakuraGrad = ctx.createLinearGradient(col.x, 0, col.x, canvas.logicalHeight);
            sakuraGrad.addColorStop(0, 'rgba(236, 72, 153, 0.10)');
            sakuraGrad.addColorStop(1, 'rgba(168, 85, 247, 0.04)');
            ctx.fillStyle = sakuraGrad;
            ctx.fillRect(col.x, 0, col.width, canvas.logicalHeight);
            ctx.strokeStyle = 'rgba(236, 72, 153, 0.25)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(col.x + 2, 0, col.width - 4, canvas.logicalHeight);
        } else if (gearSkin === 'chrome') {
            ctx.fillStyle = 'rgba(148, 163, 184, 0.06)';
            ctx.fillRect(col.x + col.width / 2 - 3, 0, 6, canvas.logicalHeight);
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(col.x, 0, col.width, canvas.logicalHeight);
        } else if (gearSkin === 'matrix') {
            // "Chuva de código": tracinhos verdes descendo em loop contínuo (fase por
            // performance.now(), não por frame — velocidade igual em qualquer FPS).
            ctx.fillStyle = 'rgba(34, 197, 94, 0.04)';
            ctx.fillRect(col.x, 0, col.width, canvas.logicalHeight);
            ctx.strokeStyle = 'rgba(34, 197, 94, 0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(col.x, 0, col.width, canvas.logicalHeight);
            const dashLen = 22, gapLen = 34, cycle = dashLen + gapLen;
            const scrollOffset = (performance.now() / 8 + i * 71) % cycle; // fase por lane, não cai tudo junto
            ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
            ctx.lineWidth = 2;
            const streakX = col.x + col.width / 2;
            for (let y = -cycle + scrollOffset; y < canvas.logicalHeight; y += cycle) {
                ctx.beginPath();
                ctx.moveTo(streakX, y);
                ctx.lineTo(streakX, y + dashLen);
                ctx.stroke();
            }
        } else if (gearSkin === 'void') {
            // Nebulosa violeta suave + estrelinhas cintilantes (posição fixa por lane,
            // só o brilho pulsa com o tempo — não "chacoalha" a cada frame).
            const nebulaGrad = ctx.createRadialGradient(col.x + col.width / 2, canvas.logicalHeight * 0.35, 4, col.x + col.width / 2, canvas.logicalHeight * 0.35, col.width * 1.4);
            nebulaGrad.addColorStop(0, 'rgba(139, 92, 246, 0.16)');
            nebulaGrad.addColorStop(1, 'rgba(139, 92, 246, 0)');
            ctx.fillStyle = nebulaGrad;
            ctx.fillRect(col.x, 0, col.width, canvas.logicalHeight);
            ctx.strokeStyle = 'rgba(167, 139, 250, 0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(col.x, 0, col.width, canvas.logicalHeight);
            const starSeedBase = i * 97;
            for (let s = 0; s < 5; s++) {
                const sx = col.x + ((starSeedBase + s * 53) % 100) / 100 * col.width;
                const sy = ((starSeedBase + s * 137) % 1000) / 1000 * canvas.logicalHeight;
                const twinkle = 0.3 + 0.5 * Math.abs(Math.sin(performance.now() / 600 + s));
                ctx.globalAlpha = twinkle;
                ctx.fillStyle = '#e9d5ff';
                ctx.fillRect(sx, sy, 2, 2);
                ctx.globalAlpha = 1;
            }
        }

        if (keyLighting[i] > 0) {
            const gradient = ctx.createLinearGradient(0, canvas.logicalHeight, 0, 0);
            gradient.addColorStop(0, getKeyColorScheme(currentMode, gearSkin)[i]);
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.globalAlpha = keyLighting[i] * 0.4;
            ctx.fillRect(col.x, 0, col.width, canvas.logicalHeight);
            ctx.globalAlpha = 1.0;
            keyLighting[i] -= 0.05 * dt;
        }
    }

    let mainColor = '#06b6d4';
    if (gearL.theme) mainColor = gearL.theme.accent;
    else if (typeof GEAR_THEMES !== 'undefined' && GEAR_THEMES[gearSkin]) mainColor = GEAR_THEMES[gearSkin].accent;
    if (gearSkin === 'crimson') mainColor = '#ef4444';
    if (gearSkin === 'gold') mainColor = '#eab308';
    if (gearSkin === 'sakura') mainColor = '#ec4899';
    if (gearSkin === 'chrome') mainColor = '#e2e8f0';
    if (gearSkin === 'matrix') mainColor = '#22c55e';
    if (gearSkin === 'void') mainColor = '#8b5cf6';

    if (useHighway) {
        // Gear 3D parada (menu): só a pista vazia. Jogando, a cena inteira (com as notas) é
        // desenhada mais abaixo, depois da suavização da velocidade.
        if (!isPlaying) drawGameHighwayScene(currentTime, mainColor, dt, false);
    } else if (gearL.frame) {
        drawGearStrikeLine(gearP2, gearL, mainColor);
    } else {
    ctx.fillStyle = beatPulse > 0 ? mainColor : '#1e293b';
    ctx.fillRect(0, 0, 6, canvas.logicalHeight);
    ctx.fillRect(canvas.logicalWidth - 6, 0, 6, canvas.logicalHeight);

    // Uma linha de julgamento só, atravessando a gear inteira — a side note usa a MESMA
    // linha (ela é uma sobreposição por cima das lanes principais, não uma fileira própria).
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 4 + beatPulse * 4;
    ctx.shadowColor = mainColor;
    ctx.shadowBlur = 12 * beatPulse;
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(canvas.logicalWidth, targetY);
    ctx.stroke();
    ctx.shadowBlur = 0;
    }
    if (beatPulse > 0) beatPulse -= 0.05 * dt;

    if (isPlaying) {
        // HP "visual" suavizado por interpolação exponencial (independente de FPS) em vez
        // de saltar direto pro valor real — a barra desliza em vez de "piscar" a cada dano
        const hpSmoothing = 1 - Math.pow(0.001, dtMs / 1000);
        hpDisplayed += (hp - hpDisplayed) * hpSmoothing;
        if (Math.abs(hpDisplayed - hp) < 0.05) hpDisplayed = hp;

        if (!useHighway && !gearL.frame) drawGameHpBar(mainColor);
    }

    if (isPlaying) {
        const noteHeight = NOTE_HEIGHT_BASE * noteSizeScale;

        // Velocidade de scroll suavizada: evita que as notas "pulem" de posição quando o
        // jogador muda a velocidade no meio da run (HUD +/- ou tecla 1/2). A suavização é
        // só visual — o julgamento de acerto continua usando o tempo real da nota.
        const speedSmoothing = 1 - Math.pow(0.0001, dtMs / 1000);
        renderedSpeedFactor += (gameSpeedFactorTarget() - renderedSpeedFactor) * speedSmoothing;
        const speedFactor = renderedSpeedFactor;

        // Gear 3D reta = MESMAS notas, mesma posição e mesmo tamanho da Gear clássica (só a pista
        // muda) — assim o julgamento "sente" igual nos dois visuais. Só a inclinada (fora do menu)
        // ainda usa as notas em perspectiva.
        const flatHighway = useHighway && gameView !== 'highway_tilt';
        if (useHighway) {
            drawGameHighwayScene(currentTime, mainColor, dt, !flatHighway);
            if (!gearL.frame) drawGameHpBar(mainColor);
        }
        if (!useHighway || flatHighway) {
        // Aviso de "SIDE TRACK chegando" ANTES da faixa translúcida entrar na tela — dá
        // um tempinho pro jogador reagir e saber de qual lado (L ou R) vem a próxima.
        // 1.6s de antecedência (era 900ms — pouco tempo pra reagir) com uma entrada suave
        // e um pulso bem mais lento (ver drawSideTrackWarning), em vez do piscar rápido de antes.
        const SIDE_WARNING_LEAD_MS = 1600;
        if (sideIdx) {
            notes.forEach(note => {
                if (note.lane !== sideIdx[0] && note.lane !== sideIdx[1]) return;
                if (note.hit || note.missed || note.holdResolved) return;
                const timeToStart = note.time - currentTime;
                if (timeToStart > 0 && timeToStart < SIDE_WARNING_LEAD_MS) {
                    const rect = getSideOverlayRect(canvas.logicalWidth, note.lane === sideIdx[0]);
                    const elapsedFrac = 1 - timeToStart / SIDE_WARNING_LEAD_MS; // 0 -> 1 ao longo da janela toda
                    const pulseT = elapsedFrac * 1.2; // pouco mais de 1 ciclo em 1.6s (bem devagar)
                    drawSideTrackWarning(rect, note.lane === sideIdx[0], pulseT, elapsedFrac);
                }
            });
        }

        notes.forEach(note => {
            const isHold = !!note.holdEnd;
            const isSideLane = !!sideIdx && (note.lane === sideIdx[0] || note.lane === sideIdx[1]);
            const isTrackLRLane = !!trackLRIdx && (note.lane === trackLRIdx[0] || note.lane === trackLRIdx[1]);
            const isOverlayLane = isSideLane || isTrackLRLane;
            // Lane extra (side track OU TRACK L/R) não tem coluna própria — usa a metade
            // esquerda/direita da gear (ver getSideOverlayRect); lanes normais usam a coluna
            // de sempre. Mesma linha de julgamento pra todo mundo (a lane extra não julga
            // separado das principais).
            const overlayPair = isSideLane ? sideIdx : trackLRIdx;
            const column = isOverlayLane ? getSideOverlayRect(canvas.logicalWidth, note.lane === overlayPair[0]) : columns[note.lane];
            const overlayColor = isTrackLRLane ? TRACK_LR_COLOR : SIDE_NOTE_COLOR;
            const overlayLabel = isTrackLRLane ? 'TRACK L/R' : 'SIDE TRACK';
            const noteTargetY = targetY;

            // Miss/auto-resolução da hold — mesma regra pros dois visuais (ver advanceNoteLifecycle)
            if (!advanceNoteLifecycle(note, frameLogicT)) return;
            if (note.ghost) return; // calibração "só ouvindo": nota invisível

            const timeDiff = note.time - currentTime;
            const noteY = modNoteY(timeDiff, speedFactor, note.lane, noteTargetY);
            const fadeHold = isHold && typeof modFadeOutHolds === 'function' && modFadeOutHolds();
            modAlphaNow = fadeHold
                ? modNoteAlpha(modNoteY(note.holdEnd - currentTime, speedFactor, note.lane, noteTargetY), noteTargetY, renderClockMs) // longa: vale a cauda
                : modNoteAlpha(isHold && note.hit ? noteTargetY : noteY, noteTargetY, renderClockMs);
            if (modAlphaNow < 0.01 && !note.holdActive) return;
            ctx.globalAlpha = modAlphaNow;

            if (isHold) {
                const tailTimeDiff = note.holdEnd - currentTime;
                const tailY = modNoteY(tailTimeDiff, speedFactor, note.lane, noteTargetY);
                let headY = note.hit ? noteTargetY : noteY; // cabeça trava na linha alvo assim que acertada
                if (fadeHold) headY = Math.min(headY, modFadeZeroY(noteTargetY)); // FADE OUT: corta onde o fade termina

                if (isOverlayLane) {
                    // SIDE TRACK/TRACK L/R: sobreposição translúcida (nunca a "coluna+círculo" normal)
                    const glow = sideGlowStep(note, dt * 16.67);
                    note._ov = { x: column.x, w: column.width, top: Math.min(headY, tailY), bottom: Math.max(headY, tailY), color: overlayColor };
                    drawSideTrackOverlay(column, headY, tailY, glow, overlayColor, overlayLabel, note.hit);
                    if (glow > 0.02 && typeof glDrawSideHeldEnergy === 'function') glDrawSideHeldEnergy(make2DFxPainter(ctx), column, noteTargetY, glow, overlayColor);
                } else {
                    drawHoldNote(note.lane, headY, tailY, column, note.holdActive);
                }

                // Faíscas contínuas + anel pulsante na linha de acerto enquanto segura a
                // hold corretamente, pra dar a sensação de "energia fluindo" (estilo DJMAX)
                if (note.holdActive && !isOverlayLane) {
                    const color = getKeyColorScheme(currentMode, gearSkin)[note.lane];
                    const laneCenterX = column.x + column.width / 2;

                    // Anel pulsante (igual ao flash de acerto, mas contínuo enquanto segura)
                    const pulse = 0.5 + Math.sin(currentTime / 90) * 0.5;
                    ctx.save();
                    ctx.globalAlpha = 0.5 + pulse * 0.4;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 4;
                    ctx.shadowColor = color;
                    ctx.shadowBlur = 20 + pulse * 15;
                    ctx.beginPath();
                    ctx.arc(laneCenterX, noteTargetY, 18 + pulse * 6, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();

                    // Faíscas subindo — chance por tentativa normalizada por dt (senão, a
                    // 144Hz nasciam faíscas numa taxa ~2.4x maior que a 60fps)
                    const sparkChance = Math.min(1, 0.6 * dt);
                    for (let s = 0; s < 3; s++) {
                        if (Math.random() < sparkChance) {
                            const sparkX = laneCenterX + (Math.random() - 0.5) * (column.width - 16);
                            hitParticles.push({
                                x: sparkX, y: noteTargetY,
                                vx: (Math.random() - 0.5) * 3, vy: -3 - Math.random() * 3,
                                life: 0.8, color
                            });
                        }
                    }
                }

                // A hold agora é UMA PEÇA SÓ (ver drawHoldNote) — antes, durante a entrada
                // (scroll-in, !note.hit), ainda desenhava por cima a note skin escolhida
                // (círculo/hexágono/pulse/losango/barra) como um "boné" separado na cabeça,
                // o que ia contra a ideia de peça única sólida. Removido: a ponta arredondada
                // da própria cápsula já é a "cabeça" da hold, sem precisar de outro sprite
                // colado em cima. Nota comum (não-hold) continua com o efeito de entrada
                // normal — ver o outro drawNoteWithEntryFx mais abaixo, fora deste bloco.
            } else if (isOverlayLane) {
                // Nota de lane extra sem hold — no TRACK L/R (8B) isso é o caso COMUM (grave/
                // kick vira toque simples, não hold — ver injectAccentLaneNotes), não uma
                // exceção rara como na side note. De qualquer forma, mostra como um
                // flash curto da faixa translúcida, nunca o círculo normal, pra manter a
                // identidade visual da mecânica.
                if (noteY > -80 && noteY < canvas.logicalHeight + 50) {
                    // TRACK L/R (8B) sempre desenha no brilho "ativo" (preenchimento mais forte +
                    // glow) mesmo sem hold — é o toque simples mais comum nessa lane (grave/kick),
                    // e no brilho "de repouso" ficava fraco demais pra enxergar a tempo. SIDE TRACK
                    // (verde) continua como antes — não foi essa a reclamada.
                    note._ov = { x: column.x, w: column.width, top: noteY - 24, bottom: noteY + 24, color: overlayColor };
                    drawSideTrackOverlay(column, noteY - 24, noteY + 24, isTrackLRLane ? 0.6 : 0.25, overlayColor, overlayLabel);
                }
            } else if (noteY > -50 && noteY < canvas.logicalHeight + 50) {
                drawNoteWithEntryFx(note.lane, noteY, column, noteHeight, speedFactor);
            }
        });
        }
    }

    ctx.globalAlpha = 1; modAlphaNow = 1; // FADER: volta ao normal depois das notas
    if (useHighway && gameView === 'highway_tilt') {
        // (cobertura SUDDEN/HIDDEN da Gear 3D inclinada é desenhada dentro de drawGameHighwayScene)
    } else if (coverMod === 'sudden') {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, canvas.logicalWidth, canvas.logicalHeight * 0.45);
    } else if (coverMod === 'hidden') {
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, targetY - 200, canvas.logicalWidth, 180);
    } else if (coverMod === 'fog' && isPlaying && typeof drawModFog === 'function') {
        drawModFog(make2DPainter(ctx), canvas.logicalWidth, targetY, currentTime);
    }

    if (gearL.frame && isPlaying) drawGearKeyPanel(gearP2, gearL, currentTime);

    if (sideFx.length && typeof glDrawSideFx === 'function') { ctx.save(); glDrawSideFx(make2DFxPainter(ctx), dt); ctx.restore(); }
    hitFlashes.forEach(f => {
        if (f.wide && typeof glDrawWideFlash === 'function') { ctx.save(); glDrawWideFlash(make2DFxPainter(ctx), f); ctx.restore(); f.life -= 0.07 * dt; return; }
        if (gearL.theme) { drawGearHitFlash(gearP2, f); f.life -= 0.07 * dt; return; }
        const maxRadius = f.big ? 78 : 55;
        const radius = (1 - f.life) * maxRadius + 8;
        ctx.save();
        ctx.globalAlpha = f.life * 0.9;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = f.big ? 4 : 3;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = f.big ? 22 : 16;
        ctx.beginPath();
        ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        // MAX100 ganha um segundo anel mais largo e mais fraco — reforça o impacto de um
        // acerto perfeito em relação a um MAX90/80/70/50, como no DJMAX real
        if (f.big) {
            ctx.globalAlpha = f.life * 0.5;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(f.x, f.y, radius * 1.4, 0, Math.PI * 2);
            ctx.stroke();
        }

        // núcleo branco central, mais forte no início do flash
        ctx.globalAlpha = Math.max(0, f.life - 0.6) * 2.2;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.big ? 13 : 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        f.life -= 0.07 * dt;
    });
    hitFlashes = hitFlashes.filter(f => f.life > 0);

    hitParticles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= 0.04 * dt;
    });
    hitParticles = hitParticles.filter(p => p.life > 0);
    ctx.globalAlpha = 1.0;

    if (isCountingDown) {
        ctx.font = '900 72px Orbitron';
        ctx.fillStyle = mainColor;
        ctx.shadowColor = mainColor;
        ctx.shadowBlur = 20;
        ctx.textAlign = 'center';
        ctx.fillText(countdownText, canvas.logicalWidth / 2, canvas.logicalHeight / 2);
        ctx.shadowBlur = 0;
    }

    if (isSongFinished && completionBannerText) {
        ctx.save();
        ctx.font = '900 38px Orbitron';
        ctx.fillStyle = completionBannerText.includes('PERFECT') ? '#06b6d4'
            : completionBannerText === 'GAME OVER' ? '#ef4444'
            : '#eab308';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 25;
        ctx.textAlign = 'center';
        ctx.fillText(completionBannerText, canvas.logicalWidth / 2, canvas.logicalHeight / 2 - 10);
        
        ctx.font = '700 16px Rajdhani';
        ctx.fillStyle = '#ffffff';
        const subtitle = completionBannerText === 'GAME OVER' ? 'HP ZERADO - PREPARING ANALYSIS...' : 'STAGE CLEAR - PREPARING ANALYSIS...';
        ctx.fillText(subtitle, canvas.logicalWidth / 2, canvas.logicalHeight / 2 + 30);
        ctx.restore();
    }

    // HUD estilo DJMAX (combo grande no alto, julgamento dourado, RATE, medidor de timing)
    if (typeof drawGameHud === 'function') drawGameHud(gearP2 || make2DPainter(ctx), canvas.logicalWidth, canvas.logicalHeight);

    ctx.restore(); // desfaz o translate do shake aplicado no início do frame
    if (gearL.frame) drawGearFrameDynamic(gearP2, gearL, currentTime);
    if (showFpsMeter && typeof frameStats !== 'undefined' && frameStats.text) {
        ctx.font = '600 13px monospace';
        ctx.fillStyle = '#a3e635';
        ctx.textAlign = 'left';
        ctx.fillText(frameStats.text, 10, canvas.logicalHeight - 14);
    }
    requestAnimationFrame(render);
}

function startPractice() {
    if (ensureChartMode()) saveSettings(); // trava de segurança: o chart toca no modo dele
    stopAllGameLoops();
    sideFx = [];
    audio.musicFading = false;
    enterGameFullscreen();
    activeChartJudgeOffset = 0; // (ajuste por música não existe mais — ver getActiveJudgeOffset)

    notes = generateNotes(currentPatternType, currentMode);
    // SV (velocidade que muda sozinha) do chart do osu!
    if (typeof svLoadForChart === 'function') svLoadForChart(String(currentPatternType).startsWith('custom:') ? findCustomChart(currentPatternType.slice(7)) : null);
    stats = {
        score: 0, combo: 0, maxCombo: 0,
        judgments: { max100: 0, max90: 0, lower: 0, break: 0 },
        earlyHits: 0, lateHits: 0, hitOffsets: [], rateSum: 0, rateCount: 0, pctCounts: {},
        // Ajuste de julgamento que VALEU nesta partida — a sugestão do resultado parte dele,
        // não do valor atual (que pode já ter sido mudado depois), senão reabrir o resultado
        // depois de aplicar somava a correção duas vezes.
        judgeOffsetUsed: getActiveJudgeOffset()
    };
    hp = 100;
    hpDisplayed = 100;
    renderedSpeedFactor = gameSpeedFactorTarget(); // evita "sweep" visual da run anterior no início desta
    missShake = 0;
    lastJudgment = { text: '', color: '', subText: '' };
    completionBannerText = "";
    isSongFinished = false;
    loopStart = null;
    loopEnd = null;
    loopEnabled = false;
    // "Treinar este trecho" (resultado): só as notas do trecho, repetindo em loop
    const section = (typeof pendingSection !== 'undefined' && pendingSection) ? pendingSection : null;
    if (typeof pendingSection !== 'undefined') pendingSection = null;
    activeSection = null;
    if (section) {
        sectionFullNotes = notes; // a música inteira — volta se o loop for desligado no meio (ver progress.js)
        notes = notes.filter(n => n.time >= section.from - 1 && n.time <= section.to + 1);
        totalPossibleScore = notes.length * 100;
        activeSection = { from: section.from, to: section.to, startAt: Math.max(0, section.from - 1600) };
        loopStart = activeSection.startAt;
        loopEnd = section.to + Math.max(700, getTempoSegmentsForPattern(currentPatternType)[0].msPerBeat);
        loopEnabled = true;
    }
    const loopCheckbox = document.getElementById('setting-loop-enabled');
    if (loopCheckbox) loopCheckbox.checked = loopEnabled;
    updateLoopStatus();
    
    document.getElementById('menu-overlay').classList.add('hidden');
    document.getElementById('stats-overlay').classList.add('hidden');
    document.getElementById('pause-modal').classList.add('hidden');

    // Some o cabeçalho durante a prática — mais tela pro jogo, visual mais "clean"
    const appHeader = document.getElementById('app-header');
    if (appHeader) appHeader.classList.add('hidden');

    setupControls();
    updateSpeedDisplay();
    isPlaying = true;
    isPaused = false;
    isCountingDown = true;

    // Dispara AGORA (em paralelo com a contagem 3-2-1) o carregamento do áudio original de
    // um chart custom, se tiver algum salvo — ver preloadCustomChartAudioIfNeeded. A
    // contagem já leva pelo menos alguns cientos de ms/poucos segundos, então na prática
    // o carregamento quase sempre já terminou bem antes do "START!"; o await lá na frente
    // (antes de startTrackForCurrentPattern) é só uma garantia pro caso raro de demorar
    // mais que isso — sem essa espera, a música podia começar um pouco DEPOIS do startTime
    // já ter sido fixado, tocando fora de sincronia com as notas caindo.
    const customAudioPreload = preloadCustomChartAudioIfNeeded(currentPatternType);

    let count = 3;
    countdownText = "3";
    audio.playMetronomeBeat();
    beatPulse = 1.0;
    lastPulseBeatIndex = -Infinity; // reseta pra não "pular" pulsos no início de uma nova tentativa

    const bpm = getBpmForPattern(currentPatternType);

    const beatIntervalMs = (60 / bpm) * 1000;
    startTime = performance.now() + (count * beatIntervalMs);

    const timer = setInterval(async () => {
        count--;
        if (count > 0) {
            countdownText = count.toString();
            audio.playMetronomeBeat();
            beatPulse = 1.0;
        } else if (count === 0) {
            countdownText = "START!";
            audio.playMetronomeBeat();
            beatPulse = 1.0;
        } else {
            clearInterval(timer);
            await customAudioPreload;
            isCountingDown = false;

            const startAtChart = activeSection ? activeSection.startAt : 0;
            // posição da música = startAtChart agora (0 no começo normal)
            startTime = performance.now() - startAtChart / gameRate;
            startTrackForCurrentPattern(startAtChart);

            gameCheckInterval = setInterval(() => {
                if (!isPlaying || isPaused || isCountingDown || isSongFinished) return;

                const currentTime = chartTimeAt(performance.now());

                if (loopEnabled && loopStart != null && loopEnd != null && loopEnd > loopStart && currentTime >= loopEnd) {
                    // treino de trecho: no fim de cada passada mostra como foi e pergunta se continua (progress.js)
                    if (activeSection && typeof onSectionLoopPass === 'function' && onSectionLoopPass()) return;
                    jumpToTime(loopStart);
                    return;
                }

                const failedByHp = !noFailMode && hp <= 0;

                if (currentTime > getSongEndChartMs() || failedByHp) {
                    // game over corta na hora; fim normal deixa a música terminar (fade curto)
                    if (failedByHp) stopTrackForCurrentPattern();
                    else fadeOutTrackForCurrentPattern(1400);
                    isSongFinished = true;

                    // GAME OVER com a tela de vídeo + estatísticas (telas.js): entra direto, sem o
                    // letreiro antigo "GAME OVER" no meio da pista antes do vídeo
                    const goScreen = failedByHp && typeof gameOverScreenEnabled === 'function' && gameOverScreenEnabled();
                    if (goScreen) {
                        completionBannerText = "";
                    } else if (failedByHp) {
                        completionBannerText = "GAME OVER";
                    } else {
                        const accuracy = totalPossibleScore > 0 ? (currentEarnedScore / totalPossibleScore) * 100 : 0;
                        if (accuracy >= 100.0) {
                            completionBannerText = "★ PERFECT PLAY ★";
                        } else if (stats.judgments.break === 0) {
                            completionBannerText = "◆ MAX COMBO ◆";
                        } else {
                            completionBannerText = "STAGE CLEAR";
                        }
                    }

                    setTimeout(() => {
                        stopAllGameLoops();
                        if (goScreen && showGameOverScreen()) {
                            // a análise completa fica a um clique (ANÁLISE); o histórico já é salvo agora
                            if (typeof afterRunFinished === 'function') { try { afterRunFinished(true); } catch (e) { console.error(e); } }
                            return;
                        }
                        showAnalysis();
                        // histórico/recordes/mapa de erros/escada de BPM (progress.js)
                        if (typeof afterRunFinished === 'function') { try { afterRunFinished(failedByHp); } catch (e) { console.error(e); } }
                    }, goScreen ? 0 : 2500);
                }
            }, 200);
        }
    }, beatIntervalMs);
}

let gameWentFullscreen = false;
function enterGameFullscreen() {
    if (!autoFullscreen || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    // instalado como aplicativo (janela própria): não força a tela cheia do navegador
    if (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)) return;
    try {
        const p = document.documentElement.requestFullscreen();
        gameWentFullscreen = true;
        if (p && p.catch) p.catch(() => { gameWentFullscreen = false; /* sem clique do usuário ou bloqueado */ });
    } catch (e) { gameWentFullscreen = false; }
}
function leaveGameFullscreen() {
    if (!gameWentFullscreen) return;
    gameWentFullscreen = false;
    try {
        if (document.fullscreenElement && document.exitFullscreen) {
            const p = document.exitFullscreen();
            if (p && p.catch) p.catch(() => {});
        }
    } catch (e) { /* segue */ }
}

function showAnalysis() {
    leaveGameFullscreen();
    document.getElementById('stats-overlay').classList.remove('hidden');
    const accuracy = totalPossibleScore > 0 ? Math.min(100, (currentEarnedScore / totalPossibleScore) * 100).toFixed(2) : "0.00";
    document.getElementById('summary-rate').innerText = `${accuracy}%`;

    // Ranks do DJMAX RESPECT V: S 97%+, A 90%+, B 80%+, C abaixo disso
    let rank = 'RANK C';
    if (accuracy >= 100) rank = 'PERFECT · S';
    else if (accuracy >= 97) rank = 'RANK S';
    else if (accuracy >= 90) rank = 'RANK A';
    else if (accuracy >= 80) rank = 'RANK B';
    document.getElementById('summary-rank').innerText = rank;

    const badgeContainer = document.getElementById('completion-badge');
    badgeContainer.innerHTML = '';

    if (parseFloat(accuracy) === 100.00) {
        badgeContainer.innerHTML = `<span class="px-3 py-1 rounded-md bg-cyan-500/20 text-cyan-300 font-orbitron font-black text-xs border border-cyan-400 shadow-lg shadow-cyan-500/30">★ PERFECT PLAY ★</span>`;
    } else if (stats.judgments.break === 0) {
        badgeContainer.innerHTML = `<span class="px-3 py-1 rounded-md bg-amber-500/20 text-amber-300 font-orbitron font-black text-xs border border-amber-400 shadow-lg shadow-amber-500/30">◆ MAX COMBO ◆</span>`;
    } else {
        badgeContainer.innerHTML = `<span class="text-xs text-slate-400 font-mono">Precisão de batida e análise de timing Fast/Slow</span>`;
    }

    document.getElementById('stat-max100').innerText = stats.judgments.max100;
    document.getElementById('stat-max90').innerText = stats.judgments.max90;
    document.getElementById('stat-lower').innerText = stats.judgments.lower;
    document.getElementById('stat-break').innerText = stats.judgments.break;
    const mcEl = document.getElementById('stat-maxcombo');
    if (mcEl) mcEl.innerText = stats.maxCombo || 0;
    const si = songInfoFor(currentPatternType);
    const sT = document.getElementById('summary-song-title'), sS = document.getElementById('summary-song-sub'), sM = document.getElementById('summary-song-meta');
    if (sT) sT.textContent = si.title || '';
    if (sS) { sS.textContent = si.sub || ''; sS.classList.toggle('hidden', !si.sub); }
    if (sM) {
        const rate = typeof gameRate === 'number' && Math.abs(gameRate - 1) > 0.001 ? ` · velocidade ${Math.round(gameRate * 100)}%` : '';
        sM.textContent = `${si.meta}${si.kind !== 'osu' && si.kind !== 'custom' ? ` · ${getModeDisplayName(currentMode)}` : ''} · ${difficultyLabel()}${rate}`;
    }

    const totalHits = stats.earlyHits + stats.lateHits || 1;
    const earlyPct = Math.round((stats.earlyHits / totalHits) * 100);
    const latePct = 100 - earlyPct;

    document.getElementById('bar-early').style.width = `${earlyPct}%`;
    document.getElementById('bar-late').style.width = `${latePct}%`;
    
    const tendencyText = earlyPct > 55 ? 'FAST/EARLY (Pressione mais tarde)' : (latePct > 55 ? 'SLOW/LATE (Pressione mais cedo)' : 'BALANCED');
    document.getElementById('timing-bias-text').innerText = tendencyText;

    renderTimingMeanSuggestion();
    drawTimingScatter();
}

// Média aparada (descarta 10% de cada ponta) dos offsets de acerto da partida, em ms.
// Positivo = você apertou, em média, DEPOIS do instante da nota.
function computeTrimmedMeanOffset(offsets) {
    if (!offsets || offsets.length < 10) return null;
    const sorted = [...offsets].sort((a, b) => a - b);
    const trim = Math.floor(sorted.length * 0.1);
    const kept = sorted.slice(trim, sorted.length - trim);
    return kept.reduce((s, v) => s + v, 0) / kept.length;
}

// Análise de timing da partida pra sugerir o Ajuste de Julgamento: MEDIANA (não se deixa
// levar por meia dúzia de toques muito fora) e a dispersão (consistência) dos toques.
function analyzeRunTiming(runStats) {
    const offs = (runStats?.hitOffsets || []).filter(v => Math.abs(v) <= 120);
    if (offs.length < 16) return null;
    const sorted = [...offs].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    const mean = offs.reduce((s, v) => s + v, 0) / offs.length;
    const spread = Math.sqrt(offs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / offs.length);
    const used = typeof runStats.judgeOffsetUsed === 'number' ? runStats.judgeOffsetUsed : judgeOffset;
    const suggested = Math.round(Math.max(-120, Math.min(120, used + median)));
    return { median, spread, used, suggested, count: offs.length };
}

// Mostra a análise de timing da partida e oferece aplicar o valor sugerido. O valor é
// ABSOLUTO (ajuste usado nesta partida + onde os toques caíram), então aplicar, reabrir o
// resultado ou jogar de novo nunca "acumula" a correção.
function isCalibrationRun() {
    const d = DRILLS[resolvePatternId(currentPatternType)];
    return !!(d && d.calibration);
}

// Resultado da calibração: calcula e JÁ APLICA os dois ajustes (dá pra desfazer).
let calibUndo = null;
function renderCalibrationResult() {
    const textEl = document.getElementById('timing-mean-text');
    const btn = document.getElementById('btn-apply-judge-offset');
    const undoBtn = document.getElementById('btn-calib-undo');
    btn?.classList.add('hidden');
    const med = (arr) => { const a = (arr || []).filter(v => Math.abs(v) <= 150).sort((x, y) => x - y); return a.length ? { m: a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2, n: a.length } : { m: NaN, n: 0 }; };
    const vis = med(stats.calVisual), aud = med(stats.calAudio);
    if (vis.n < 12) {
        textEl.innerText = `Calibração: poucos toques na fase "olhando" (${vis.n}/24) pra calcular. Tente de novo tocando todas as notas.`;
        undoBtn?.classList.add('hidden');
        return;
    }
    const used = typeof stats.judgeOffsetUsed === 'number' ? stats.judgeOffsetUsed : judgeOffset;
    calibUndo = { judgeOffset, judgeOffsetByView: { ...judgeOffsetByView }, judgeOffsetLinked, globalOffset };
    const newJudge = Math.round(Math.max(-120, Math.min(120, used + vis.m)));
    let audioMsg = '';
    if (aud.n >= 12) {
        const delta = aud.m - vis.m; // som chegando mais tarde que a imagem -> adianta a música
        const newGlobal = Math.round(Math.max(-200, Math.min(200, globalOffset - delta)));
        audioMsg = ` · Offset de áudio: ${globalOffset > 0 ? '+' : ''}${globalOffset} → ${newGlobal > 0 ? '+' : ''}${newGlobal}ms (som ${delta > 0 ? 'atrasado' : 'adiantado'} ${Math.abs(Math.round(delta))}ms em relação à imagem)`;
        globalOffset = newGlobal;
        const sl = document.getElementById('offset-slider'); if (sl) sl.value = globalOffset;
        const lv = document.getElementById('offset-val'); if (lv) lv.innerText = `${globalOffset} ms`;
    } else {
        audioMsg = ` · Offset de áudio mantido (poucos toques na fase "só ouvindo": ${aud.n}/24).`;
    }
    judgeOffsetLinked = true;
    judgeOffset = newJudge;
    updateJudgeOffsetDisplay();
    const linkEl = document.getElementById('setting-judge-linked'); if (linkEl) linkEl.checked = true;
    saveSettings();
    textEl.innerText = `✅ Calibração aplicada pra todos os modos, visuais e gears — Ajuste de julgamento: ${newJudge > 0 ? '+' : ''}${newJudge}ms${audioMsg}. Variação dos toques: ±${Math.round(analyzeRunTiming(stats)?.spread || 0)}ms.`;
    undoBtn?.classList.remove('hidden');
}

document.getElementById('btn-calib-undo')?.addEventListener('click', (e) => {
    if (!calibUndo) return;
    judgeOffsetLinked = calibUndo.judgeOffsetLinked;
    judgeOffsetByView = { ...calibUndo.judgeOffsetByView };
    judgeOffset = calibUndo.judgeOffset;
    globalOffset = calibUndo.globalOffset;
    updateJudgeOffsetDisplay();
    const sl = document.getElementById('offset-slider'); if (sl) sl.value = globalOffset;
    const lv = document.getElementById('offset-val'); if (lv) lv.innerText = `${globalOffset} ms`;
    saveSettings();
    calibUndo = null;
    e.currentTarget.classList.add('hidden');
    const textEl = document.getElementById('timing-mean-text');
    if (textEl) textEl.innerText = '↩ Calibração desfeita: os ajustes voltaram ao que eram antes.';
});

function renderTimingMeanSuggestion() {
    const textEl = document.getElementById('timing-mean-text');
    const btn = document.getElementById('btn-apply-judge-offset');
    if (!textEl || !btn) return;
    document.getElementById('btn-calib-undo')?.classList.add('hidden');
    if (isCalibrationRun()) { renderCalibrationResult(); return; }
    const a = analyzeRunTiming(stats);
    if (!a) {
        textEl.innerText = 'Poucas notas acertadas pra calcular o timing (precisa de pelo menos 16).';
        btn.classList.add('hidden');
        return;
    }
    const fmt = (v) => `${v > 0 ? '+' : ''}${Math.round(v)}ms`;
    const med = Math.round(a.median);
    const side = med > 5 ? 'atrasados (SLOW)' : (med < -5 ? 'adiantados (FAST)' : 'no alvo');
    let text = `Sincronia: ${fmt(a.used)} (a mesma pra tudo) · seus toques saíram ${fmt(med)} ${side} (mediana de ${a.count} notas) · variação ±${Math.round(a.spread)}ms`;
    // A sincronia é FIXA: um desvio pequeno numa partida é o seu timing daquele dia, não
    // motivo pra mexer no ajuste (era isso que fazia o julgamento "mudar toda hora"). Só
    // sugere quando o desvio é grande E consistente, numa partida com notas suficientes —
    // sinal de que algo mudou no PC (outro monitor, fone Bluetooth, modo de baixa latência).
    const flu = typeof fluidezResumo === 'function' ? fluidezResumo() : null;
    const travou = !!(flu && flu.heavy);
    const clearlyOff = !travou && Math.abs(med) >= 15 && a.count >= 40 && a.spread <= 35;
    if (travou && Math.abs(med) >= 15) {
        text += ' → esta partida teve muitas travadas: com o jogo engasgando, as notas aparecem atrasadas e o toque sai SLOW. Não mexa na sincronia por causa dela.';
    } else if (clearlyOff) {
        text += ` → desvio grande e constante: se isso se repetir, refaça a CALIBRAÇÃO (ou aplique ${fmt(a.suggested)}).`;
    } else {
        text += ' — dentro do normal; a sincronia continua a mesma (não precisa mexer).';
    }
    if (a.spread > 35) text += ' Seus toques variaram bastante: isso é consistência, não sincronia (o treino "Pulso no Tempo" ajuda).';
    textEl.innerText = text;
    btn.dataset.value = String(a.suggested);
    btn.innerText = 'Aplicar na sincronia geral';
    btn.classList.toggle('hidden', !clearlyOff || a.suggested === getActiveJudgeOffset());
    const chartBox = document.getElementById('chart-offset-box');
    if (chartBox) chartBox.classList.add('hidden');
}

function currentCustomChartForJudge() {
    if (typeof currentPatternType === 'string' && currentPatternType.startsWith('custom:')) return findCustomChart(currentPatternType.slice(7)) || null;
    return null;
}

document.getElementById('btn-apply-judge-offset')?.addEventListener('click', (e) => {
    const val = parseInt(e.currentTarget.dataset.value, 10);
    if (!isFinite(val)) return;
    const textEl = document.getElementById('timing-mean-text');
    e.currentTarget.classList.add('hidden');
    judgeOffset = val;
    updateJudgeOffsetDisplay();
    saveSettings();
    if (textEl) textEl.innerText = `✅ Sincronia agora em ${judgeOffset > 0 ? '+' : ''}${judgeOffset}ms — vale pra todas as músicas, gears e modos.`;
});

function renderChartOffsetInfo(chart) {
    const el = document.getElementById('chart-offset-info');
    if (!el || !chart) return;
    const v = chart.judgeOffsetLocal || 0;
    el.innerText = `Ajuste só desta música: ${v > 0 ? '+' : ''}${v}ms (somado à sincronia geral: ${judgeOffset > 0 ? '+' : ''}${judgeOffset}ms)`;
}
document.getElementById('btn-reset-chart-offset')?.addEventListener('click', () => {
    const chart = currentCustomChartForJudge();
    if (!chart) return;
    chart.judgeOffsetLocal = 0;
    activeChartJudgeOffset = 0;
    saveCustomCharts();
    renderChartOffsetInfo(chart);
});

// Desenha um scatter simples do offset (ms) de cada nota acertada ao longo da run,
// pra visualizar tendência (early/late) e consistência ponto a ponto, não só o % agregado
function drawTimingScatter() {
    const canvasEl = document.getElementById('timing-scatter');
    if (!canvasEl) return;

    const c2d = canvasEl.getContext('2d');
    const w = canvasEl.clientWidth || 400;
    const h = canvasEl.height || 120;
    canvasEl.width = w;
    c2d.clearRect(0, 0, w, h);

    const offsets = stats.hitOffsets;
    const zeroY = h / 2;

    c2d.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    c2d.beginPath();
    c2d.moveTo(0, zeroY);
    c2d.lineTo(w, zeroY);
    c2d.stroke();

    if (offsets.length === 0) {
        c2d.fillStyle = '#64748b';
        c2d.font = '12px Rajdhani';
        c2d.textAlign = 'center';
        c2d.fillText('Sem dados de timing nesta run', w / 2, zeroY + 4);
        return;
    }

    const maxAbs = Math.max(TIMING.MAX1, ...offsets.map(o => Math.abs(o)));

    offsets.forEach((offset, i) => {
        const x = offsets.length > 1 ? (i / (offsets.length - 1)) * (w - 12) + 6 : w / 2;
        const y = zeroY - (offset / maxAbs) * (zeroY - 8);
        c2d.beginPath();
        c2d.fillStyle = offset < 0 ? '#f59e0b' : '#a855f7'; // amber = early (adiantado), roxo = late (atrasado)
        c2d.globalAlpha = 0.85;
        c2d.arc(x, y, 3, 0, Math.PI * 2);
        c2d.fill();
    });
    c2d.globalAlpha = 1;

    c2d.fillStyle = '#64748b';
    c2d.font = '10px Rajdhani';
    c2d.textAlign = 'left';
    c2d.fillText('FAST', 4, 12);
    c2d.textAlign = 'right';
    c2d.fillText('SLOW', w - 4, h - 4);
}

function renderKeybindInputs() {
    const container = document.getElementById('keybinds-config');
    const mode = keybindEditMode || currentMode;
    document.getElementById('key-mode-label').innerText = getModeDisplayName(mode);
    container.innerHTML = '';
    document.querySelectorAll('[data-keybind-mode]').forEach(b => {
        const active = b.dataset.keybindMode === mode;
        b.classList.toggle('bg-cyan-500', active);
        b.classList.toggle('text-slate-950', active);
        b.classList.toggle('text-slate-300', !active);
    });

    KEY_CONFIGS[mode].forEach((code, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col gap-1';
        const label = document.createElement('span');
        label.className = 'text-[10px] text-slate-400 font-mono';
        label.innerText = getTrackLabel(mode, idx);

        const btn = document.createElement('button');
        btn.className = `key-input p-2 rounded bg-slate-800 border border-slate-700 text-cyan-400 font-orbitron font-bold text-center hover:border-cyan-400 ${listeningKeyIndex === idx ? 'listening' : ''}`;
        btn.innerText = listeningKeyIndex === idx ? 'APERTE A TECLA...' : formatKeyCode(code);

        btn.addEventListener('click', () => { listeningAltIndex = null; listeningKeyIndex = idx; renderKeybindInputs(); });
        wrapper.appendChild(label);
        wrapper.appendChild(btn);
        // tecla extra (opcional) da mesma lane
        const altCode = (ALT_KEY_CONFIGS[mode] || [])[idx] || null;
        const alt = document.createElement('button');
        const listeningAlt = listeningAltIndex === idx;
        alt.className = `key-input px-2 py-1 rounded border text-[10px] font-bold text-center ${altCode ? 'bg-slate-800 border-pink-500/60 text-pink-300' : 'bg-slate-900/60 border-slate-700 border-dashed text-slate-500'} hover:border-pink-400 ${listeningAlt ? 'listening' : ''}`;
        alt.innerText = listeningAlt ? 'APERTE (Esc = nenhuma)' : (altCode ? `+ ${formatKeyCode(altCode)}` : '+ tecla extra');
        alt.title = 'Segunda tecla pra MESMA lane (opcional) — pra repetir a nota rápido alternando dois dedos, como a TRACK 3 do 5B. Clique e aperte a tecla; Esc remove.';
        alt.addEventListener('click', () => { listeningKeyIndex = null; listeningAltIndex = idx; renderKeybindInputs(); });
        wrapper.appendChild(alt);
        container.appendChild(wrapper);
    });
}

document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.mode-btn').forEach(b => {
            b.className = "mode-btn px-3 py-1.5 rounded text-sm font-orbitron font-bold border border-slate-700 bg-slate-800 text-slate-400 hover:text-white";
        });
        e.target.className = "mode-btn active-mode px-3 py-1.5 rounded text-sm font-orbitron font-bold border border-cyan-500 bg-cyan-950/50 text-cyan-300";
        currentMode = e.target.dataset.mode;
        renderKeybindInputs();
        setupControls();
        saveSettings();
    });
});

// Chart do editor/osu! SEMPRE toca no modo em que foi feito (4B, 5B...). Antes dava pra
// selecionar um chart 4B, clicar em 5B e jogar o chart 4B "em 5B" — e isso contava nos desafios.
function ensureChartMode() {
    if (typeof currentPatternType !== 'string' || !currentPatternType.startsWith('custom:')) return false;
    const chart = findCustomChart(currentPatternType.slice(7));
    if (!chart || !chart.mode || chart.mode === currentMode) return false;
    currentMode = chart.mode;
    document.querySelectorAll('.mode-btn').forEach(b => {
        const active = b.dataset.mode === currentMode;
        b.className = active
            ? "mode-btn active-mode px-3 py-1.5 rounded text-sm font-orbitron font-bold border border-cyan-500 bg-cyan-950/50 text-cyan-300"
            : "mode-btn px-3 py-1.5 rounded text-sm font-orbitron font-bold border border-slate-700 bg-slate-800 text-slate-400 hover:text-white";
    });
    renderKeybindInputs();
    setupControls();
    return true;
}

document.getElementById('pattern-grid').addEventListener('click', (e) => {
    const card = e.target.closest('.pattern-card');
    if (!card) return;

    document.querySelectorAll('.pattern-card').forEach(c => {
        c.classList.remove('border-cyan-400', 'bg-slate-800/80', 'border-red-400', 'bg-red-950/80');
        c.classList.add('border-slate-700', 'bg-slate-800/60');
    });

    if (card.dataset.pattern === 'stream') {
        card.classList.remove('border-slate-700', 'bg-slate-800/60');
        card.classList.add('border-red-400', 'bg-red-950/80');
    } else {
        card.classList.remove('border-slate-700', 'bg-slate-800/60');
        card.classList.add('border-cyan-400', 'bg-slate-800/80');
    }
    currentPatternType = card.dataset.pattern;

    // Chart feito no editor: força o modo de tecla (4K/5K/6K/8K) pro modo em que ele foi
    // desenhado — senão as lanes ficariam fora de sincronia com o teclado configurado
    if (currentPatternType.startsWith('custom:')) ensureChartMode();

    updateSongPreview(card);
    saveSettings();
});

// Atualiza o card de preview (esquerda) com os dados do padrão selecionado na lista
function updateSongPreview(card) {
    if (!card) return;
    const iconEl = document.getElementById('preview-icon');
    const badgeEl = document.getElementById('preview-badge');
    const titleEl = document.getElementById('preview-title');
    const descEl = document.getElementById('preview-desc');
    const bpmEl = document.getElementById('preview-bpm');
    const trackEl = document.getElementById('preview-track');
    if (!iconEl || !badgeEl || !titleEl || !descEl || !bpmEl || !trackEl) return;

    iconEl.textContent = card.dataset.icon || '??';
    iconEl.className = `w-11 h-11 rounded-lg bg-gradient-to-br ${card.dataset.iconClass || 'from-cyan-500/30 text-cyan-300 border-cyan-500/30'} to-slate-800 flex items-center justify-center font-orbitron font-bold text-sm shrink-0 border`;

    badgeEl.textContent = card.dataset.badge || '';
    badgeEl.className = `px-2 py-0.5 rounded text-[10px] font-bold ${card.dataset.badgeClass || 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'} border`;

    titleEl.textContent = card.dataset.title || '';
    descEl.textContent = card.dataset.desc || '';
    bpmEl.textContent = card.dataset.bpm ? `BPM: ${card.dataset.bpm}` : '';
    trackEl.textContent = card.dataset.track || '';
}


document.getElementById('speed-slider').addEventListener('input', (e) => {
    scrollSpeed = parseFloat(e.target.value);
    updateSpeedDisplay();
    saveSettings();
});

document.getElementById('btn-speed-up').addEventListener('click', () => { changeSpeed(0.1); saveSettings(); });
// botão PAUSA na tela (pra quem joga com controle/cursor, ex.: Xbox, sem tecla Esc)
document.getElementById('btn-hud-pause')?.addEventListener('click', (e) => {
    e.preventDefault(); e.currentTarget.blur();
    if (isPlaying && !isPaused && !isCountingDown) togglePause();
});
document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
    gameWentFullscreen = false; // quem controla agora é o jogador
    try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
    } catch (e) { /* navegador sem suporte — F11 continua funcionando */ }
});
document.getElementById('btn-speed-down').addEventListener('click', () => { changeSpeed(-0.1); saveSettings(); });

document.getElementById('offset-slider').addEventListener('input', (e) => {
    globalOffset = parseInt(e.target.value);
    document.getElementById('offset-val').innerText = `${globalOffset} ms`;
    saveSettings();
});

function updateJudgeOffsetDisplay() {
    judgeOffset = Math.round(Math.max(-120, Math.min(120, judgeOffset || 0)));
    const valEl = document.getElementById('judge-offset-val');
    if (valEl) valEl.innerText = `${judgeOffset > 0 ? '+' : ''}${judgeOffset} ms`;
    const sliderEl = document.getElementById('judge-offset-slider');
    if (sliderEl) sliderEl.value = judgeOffset;
    judgeOffsetLinked = true;
    judgeOffsetByView = { classic: judgeOffset, highway: judgeOffset };
    const lbl = document.getElementById('judge-offset-view-label');
    if (lbl) lbl.innerText = 'vale pra tudo';
}

document.getElementById('judge-offset-slider')?.addEventListener('input', (e) => {
    judgeOffset = parseInt(e.target.value, 10) || 0;
    updateJudgeOffsetDisplay();
    saveSettings();
});

document.getElementById('mod-random').addEventListener('change', (e) => { randomMod = e.target.value; saveSettings(); });
document.getElementById('mod-cover').addEventListener('change', (e) => { coverMod = e.target.value; saveSettings(); });

document.getElementById('btn-start').addEventListener('click', startPractice);
document.getElementById('btn-retry').addEventListener('click', startPractice);
document.getElementById('btn-back-menu').addEventListener('click', () => {
    leaveGameFullscreen();
    stopAllGameLoops();
    document.getElementById('stats-overlay').classList.add('hidden');
    document.getElementById('menu-overlay').classList.remove('hidden');
    document.getElementById('app-header')?.classList.remove('hidden');
});

// Pula a linha do tempo da música para targetTime (ms), reabrindo (reset de hit/missed/hold)
// qualquer nota que fique à frente da nova posição. Funciona tanto pausado quanto tocando.
function jumpToTime(targetTime) {
    // Trava a posição entre 0 e o fim da última nota: sem isso, rebobinar perto do
    // início da música manda o "relógio" pra um valor negativo e cria uma zona morta
    // onde nenhuma nota aparece até o tempo alcançar o começo real do chart — o que
    // parece (mas não é) um travamento.
    const lastNoteTime = notes.length ? Math.max(...notes.map(n => n.holdEnd || n.time)) : 0;
    const clampedTarget = Math.max(0, Math.min(targetTime, lastNoteTime));

    const nowRef = isPaused ? pauseStartTime : performance.now();
    startTime = nowRef + globalOffset - clampedTarget / gameRate;

    notes.forEach(n => {
        if (n.time > clampedTarget) {
            // Se a nota já tinha rendido pontos (acerto anterior a este rewind), desconta
            // do placar antes de reabri-la — sem isso, rebobinar e acertar de novo somava
            // pontos em cima de pontos já contados, inflando a % de acerto além de 100%
            // e disparando "PERFECT PLAY" mesmo com erros de verdade em outro trecho.
            if (n.pointsEarned) {
                currentEarnedScore -= n.pointsEarned;
                n.pointsEarned = 0;
            }
            n.hit = false;
            n.missed = false;
            n.holdActive = false;
            n.holdResolved = false;
        }
    });
    activeHolds.fill(null);

    // Se o jogo está rodando de verdade (ex: loop de trecho automático), reposiciona a
    // trilha sonora também — se for só rewind/skip feito em pausa, o resume já cuida disso.
    if (isPlaying && !isPaused && !isCountingDown) {
        startTrackForCurrentPattern(audioPosForChartTime(clampedTarget));
    }
}

function seekBy(deltaMs) {
    // deltaMs negativo = rewind (currentTime diminui), positivo = skip forward
    const currentTime = chartTimeAt(pauseStartTime);
    jumpToTime(currentTime + deltaMs);
}

function updateLoopStatus() {
    const el = document.getElementById('loop-status');
    if (!el) return;
    if (loopStart == null || loopEnd == null) {
        el.innerText = 'Loop: marque início e fim';
    } else if (loopEnd <= loopStart) {
        el.innerText = 'Loop: fim precisa ser depois do início';
    } else {
        const durSec = ((loopEnd - loopStart) / 1000).toFixed(1);
        el.innerText = `Loop: ${durSec}s ${loopEnabled ? '(ativo)' : '(inativo)'}`;
    }
}

document.getElementById('btn-loop-start').addEventListener('click', () => {
    loopStart = chartTimeAt(pauseStartTime);
    updateLoopStatus();
});
document.getElementById('btn-loop-end').addEventListener('click', () => {
    loopEnd = chartTimeAt(pauseStartTime);
    updateLoopStatus();
});
document.getElementById('btn-loop-clear').addEventListener('click', () => {
    loopStart = null;
    loopEnd = null;
    loopEnabled = false;
    document.getElementById('setting-loop-enabled').checked = false;
    updateLoopStatus();
});
document.getElementById('setting-loop-enabled').addEventListener('change', (e) => {
    loopEnabled = e.target.checked;
    updateLoopStatus();
});

document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-pause-restart').addEventListener('click', startPractice);
document.getElementById('btn-rw5').addEventListener('click', () => seekBy(-5000));
document.getElementById('btn-ff5').addEventListener('click', () => seekBy(5000));
document.getElementById('btn-pause-menu').addEventListener('click', () => {
    leaveGameFullscreen();
    stopAllGameLoops();
    document.getElementById('pause-modal').classList.add('hidden');
    document.getElementById('menu-overlay').classList.remove('hidden');
    document.getElementById('app-header')?.classList.remove('hidden');
});

const openSettings = () => { keybindEditMode = null; listeningKeyIndex = null; renderKeybindInputs(); document.getElementById('settings-modal').classList.remove('hidden'); };

document.querySelectorAll('[data-keybind-mode]').forEach(b => {
    b.addEventListener('click', () => { keybindEditMode = b.dataset.keybindMode; listeningKeyIndex = null; renderKeybindInputs(); });
});
document.getElementById('btn-reset-keybinds')?.addEventListener('click', () => {
    const mode = keybindEditMode || currentMode;
    if (!confirm(`Voltar as teclas do ${getModeDisplayName(mode)} pro padrão?`)) return;
    KEY_CONFIGS[mode] = DEFAULT_KEY_CONFIGS[mode].slice();
    ALT_KEY_CONFIGS[mode] = (DEFAULT_ALT_KEY_CONFIGS[mode] || []).slice();
    listeningKeyIndex = null;
    listeningAltIndex = null;
    renderKeybindInputs();
    setupControls();
    saveSettings();
});
document.getElementById('btn-reset-judge-offset')?.addEventListener('click', () => {
    judgeOffset = 0;
    updateJudgeOffsetDisplay();
    saveSettings();
});
document.getElementById('btn-reset-audio-offset')?.addEventListener('click', () => {
    globalOffset = 0;
    document.getElementById('offset-slider').value = 0;
    document.getElementById('offset-val').innerText = '0 ms';
    saveSettings();
});
document.getElementById('main-game-view')?.addEventListener('change', (e) => {
    setGameView(e.target.value);
    saveSettings();
});
document.getElementById('setting-renderer')?.addEventListener('change', (e) => {
    setRendererPref(e.target.value);
    saveSettings();
});
document.getElementById('setting-show-fps')?.addEventListener('change', (e) => {
    showFpsMeter = !!e.target.checked;
    saveSettings();
});
document.getElementById('btn-start-calibration')?.addEventListener('click', () => {
    document.getElementById('settings-modal')?.classList.add('hidden');
    currentPatternType = 'calibrate';
    applySettingsToUI();
    saveSettings();
    document.getElementById('menu-overlay')?.classList.add('hidden');
    startPractice();
});
document.getElementById('setting-judge-linked')?.addEventListener('change', (e) => {
    judgeOffsetLinked = !!e.target.checked;
    updateJudgeOffsetDisplay();
    saveSettings();
});
document.getElementById('setting-judge-difficulty')?.addEventListener('change', (e) => { applyJudgeProfile(e.target.value); saveSettings(); });
document.getElementById('setting-hud-layout')?.addEventListener('change', (e) => { hudLayout = e.target.value === 'djmax' ? 'djmax' : 'center'; saveSettings(); });
// "Mostrar na gear": cada checkbox liga/desliga uma informação
function syncHudShowUI() {
    document.querySelectorAll('[data-hud-show]').forEach(el => { el.checked = hudShow[el.dataset.hudShow] !== false; });
}
document.querySelectorAll('[data-hud-show]').forEach(el => {
    el.addEventListener('change', () => { hudShow[el.dataset.hudShow] = el.checked; saveSettings(); });
});
document.getElementById('btn-hud-show-all')?.addEventListener('click', () => { hudShow = {}; syncHudShowUI(); saveSettings(); });
document.getElementById('btn-hud-show-min')?.addEventListener('click', () => {
    // modo limpo: só o julgamento e as notas
    hudShow = { combo: false, judge: true, fastslow: false, rate: false, meter: false, hp: false, panel: false, title: false };
    syncHudShowUI(); saveSettings();
});
document.getElementById('setting-auto-fullscreen')?.addEventListener('change', (e) => { autoFullscreen = !!e.target.checked; saveSettings(); });
document.getElementById('audio-note-melody')?.addEventListener('change', (e) => { noteMelodyMode = e.target.value; saveSettings(); });
document.getElementById('audio-hit-type')?.addEventListener('change', (e) => { hitSoundType = e.target.value; saveSettings(); previewHitSound(); });
document.getElementById('btn-hit-preview')?.addEventListener('click', () => previewHitSound());
document.getElementById('audio-hit-volume')?.addEventListener('input', (e) => {
    hitSoundVolume = Math.max(0, Math.min(1, +e.target.value));
    const v = document.getElementById('hit-vol-val'); if (v) v.innerText = `${Math.round(hitSoundVolume * 100)}%`;
    saveSettings();
});
document.getElementById('audio-music-volume')?.addEventListener('input', (e) => {
    musicVolume = Math.max(0, Math.min(1, +e.target.value));
    const v = document.getElementById('music-vol-val'); if (v) v.innerText = `${Math.round(musicVolume * 100)}%`;
    if (audio.ctx && audio.ensureBuses) audio.ensureBuses();
    saveSettings();
});
document.getElementById('setting-lane-opacity')?.addEventListener('input', (e) => {
    laneOpacityPct = Math.max(0, Math.min(100, Math.round(+e.target.value / 10) * 10));
    const v = document.getElementById('lane-opacity-val');
    if (v) v.innerText = `${laneOpacityPct}%`;
    saveSettings();
});
document.getElementById('setting-gear-position')?.addEventListener('change', (e) => {
    gearPosition = e.target.value;
    applyGearPositionStyle();
    saveSettings();
});
document.getElementById('setting-bg-dim')?.addEventListener('input', (e) => {
    bgDimPct = Math.max(0, Math.min(90, +e.target.value));
    const v = document.getElementById('bg-dim-val');
    if (v) v.innerText = `${bgDimPct}%`;
    if (typeof applyGameBackground === 'function') applyGameBackground();
    saveSettings();
});
document.getElementById('setting-bg-image')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f && typeof setGameBackgroundFile === 'function') setGameBackgroundFile(f);
    e.target.value = '';
});
document.getElementById('btn-bg-remove')?.addEventListener('click', () => {
    if (typeof setGameBackgroundFile === 'function') setGameBackgroundFile(null);
});
document.getElementById('setting-low-latency')?.addEventListener('change', (e) => {
    lowLatencyMode = !!e.target.checked;
    if (typeof recreateGLCanvas === 'function') recreateGLCanvas();
    saveSettings();
});
const closeSettings = () => { listeningKeyIndex = null; document.getElementById('settings-modal').classList.add('hidden'); };

document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
document.getElementById('btn-close-settings-x').addEventListener('click', closeSettings);
document.getElementById('btn-stats').addEventListener('click', () => { if (typeof openHistoryModal === 'function') openHistoryModal(); else showAnalysis(); });

document.getElementById('audio-hitsounds').addEventListener('change', (e) => { audio.hitsoundEnabled = e.target.checked; saveSettings(); });
document.getElementById('audio-music').addEventListener('change', (e) => { audio.musicEnabled = e.target.checked; saveSettings(); });
document.getElementById('audio-volume').addEventListener('input', (e) => {
    audio.volume = parseFloat(e.target.value);
    document.getElementById('vol-val').innerText = `${Math.round(audio.volume * 100)}%`;
    saveSettings();
});

const settingLongNotes = document.getElementById('setting-long-notes');
if (settingLongNotes) {
    settingLongNotes.addEventListener('change', (e) => { enableLongNotes = e.target.checked; saveSettings(); });
}

const settingEnhancedSideNotes = document.getElementById('setting-enhanced-side-notes');
if (settingEnhancedSideNotes) {
    settingEnhancedSideNotes.addEventListener('change', (e) => { enhancedSideNotes = e.target.checked; saveSettings(); });
}

// --- Importar música: abre direto no Chart Editor pra montagem manual da chart ---
// Não existe mais geração automática de chart a partir do áudio (nem heurística, nem IA/
// Demucs) — só a importação do áudio em si. O trabalho de montar a chart é manual, com o
// Simulador (grava tocando com as teclas reais) e/ou clicando na grade. O único auxílio
// automático que sobra é a detecção de BPM (ver detectBpmOnly/handleEditorAudioImport),
// que só sugere o andamento — nunca inventa nota nenhuma.
const importAudioInput = document.getElementById('import-audio-file');
if (importAudioInput) {
    importAudioInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const statusEl = document.getElementById('import-audio-status');
        statusEl.innerText = `Abrindo "${file.name}" no Chart Editor...`;
        openChartEditor();
        await handleEditorAudioImport(file);
        statusEl.innerText = 'Nenhum arquivo importado ainda.';
        importAudioInput.value = ''; // permite importar o mesmo arquivo de novo depois
    });
}

// --- Calibrador automático de offset ---
let calibratorCancelFn = null;

function startOffsetCalibration() {
    // audio.init() pode falhar em navegadores/estados incomuns — isso não deve impedir
    // a parte visual/matemática da calibração de funcionar (o áudio é só um apoio)
    try { audio.init(); } catch (e) { /* segue sem áudio */ }
    isCalibrating = true;

    const totalBeats = 20; // mais batidas = média mais confiável (sugestão de capturar mais amostras)
    const skipBeats = 3;   // primeiras batidas são só aquecimento, não entram no cálculo
    const intervalSec = 0.6; // 100 BPM
    const leadInSec = 0.4;   // tempo antes do 1º beep, pra dar folga pro agendamento
    const matchWindowMs = 300;

    document.getElementById('settings-modal').classList.add('hidden');
    document.getElementById('calibrator-modal').classList.remove('hidden');
    document.getElementById('calibrator-instructions').classList.remove('hidden');
    document.getElementById('calibrator-pulse').classList.remove('hidden');
    document.getElementById('calibrator-result').classList.add('hidden');
    document.getElementById('calibrator-result').classList.remove('flex');
    document.getElementById('btn-calibrator-apply').classList.add('hidden');
    document.getElementById('calibrator-count').innerText = '0';
    document.getElementById('calibrator-captures').innerText = 'Capturas: 0';

    // Correlação entre o relógio de áudio (sample-accurate) e performance.now() (usado
    // pro keydown) — captura os dois no mesmo instante pra poder converter um pro outro.
    // Isso é o que dá precisão de verdade: os beeps são agendados no relógio de ÁUDIO
    // (sem jitter de setTimeout/rAF), e só then convertemos pra comparar com o input.
    const hasAudioClock = !!(audio.ctx && typeof audio.ctx.currentTime === 'number');
    const referenceAudioTime = hasAudioClock ? audio.ctx.currentTime : 0;
    const referencePerfTime = performance.now();
    const audioTimeToPerf = (audioTime) => referencePerfTime + (audioTime - referenceAudioTime) * 1000;

    const beatTimesPerf = Array.from({ length: totalBeats }, (_, i) =>
        audioTimeToPerf(referenceAudioTime + leadInSec + i * intervalSec)
    );

    // Agenda TODOS os beeps de uma vez, no relógio de áudio — sample-accurate, sem
    // depender de nenhum timer de JS pra disparar o som na hora certa
    if (hasAudioClock) {
        for (let i = 0; i < totalBeats; i++) {
            audio.scheduleMetronomeBeat(referenceAudioTime + leadInSec + i * intervalSec);
        }
    }

    const deltas = [];
    let nextBeatIndex = 0;
    let rafId = null;

    // Aceita QUALQUER tecla (não só espaço) — o importante é a consistência do timing,
    // não qual tecla específica a pessoa usa pra bater o ritmo
    function onKeydown(e) {
        if (e.repeat) return;
        if (e.code === 'Space') e.preventDefault();
        if (nextBeatIndex === 0) return;

        const lastFiredIndex = nextBeatIndex - 1;
        if (lastFiredIndex < skipBeats) return;

        const delta = inputTimeFromEvent(e) - beatTimesPerf[lastFiredIndex];
        if (Math.abs(delta) <= matchWindowMs) {
            deltas.push(delta);
            document.getElementById('calibrator-captures').innerText = `Capturas: ${deltas.length}`;
        }
    }
    window.addEventListener('keydown', onKeydown);

    function loop() {
        const now = performance.now();
        while (nextBeatIndex < totalBeats && now >= beatTimesPerf[nextBeatIndex]) {
            if (!hasAudioClock) {
                try { audio.playMetronomeBeat(); } catch (e) { /* segue sem áudio */ }
            }
            document.getElementById('calibrator-count').innerText = String(nextBeatIndex + 1);
            const pulseEl = document.getElementById('calibrator-pulse');
            pulseEl.style.transform = 'scale(1.15)';
            setTimeout(() => { pulseEl.style.transform = 'scale(1)'; }, 100);
            nextBeatIndex++;
        }

        if (nextBeatIndex >= totalBeats && now >= beatTimesPerf[totalBeats - 1] + 700) {
            window.removeEventListener('keydown', onKeydown);
            finishCalibration(deltas);
            return;
        }
        rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);

    calibratorCancelFn = () => {
        window.removeEventListener('keydown', onKeydown);
        if (rafId) cancelAnimationFrame(rafId);
        calibratorCancelFn = null;
    };
}

function finishCalibration(deltas) {
    isCalibrating = false;
    calibratorCancelFn = null;
    document.getElementById('calibrator-instructions').classList.add('hidden');
    document.getElementById('calibrator-pulse').classList.add('hidden');

    const resultEl = document.getElementById('calibrator-result');
    resultEl.classList.remove('hidden');
    resultEl.classList.add('flex');

    const applyBtn = document.getElementById('btn-calibrator-apply');

    if (deltas.length < 5) {
        document.getElementById('calibrator-suggested').innerText = '—';
        document.getElementById('calibrator-sample-count').innerText = 'Poucas batidas capturadas — tente de novo, tentando acompanhar o ritmo.';
        applyBtn.classList.add('hidden');
        return;
    }

    // Média aparada: descarta os ~15% mais extremos de cada lado antes de tirar a média —
    // mais robusta que a mediana sozinha quando tem uns toques bem fora do padrão no meio
    const sorted = [...deltas].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * 0.15);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount || sorted.length);
    const finalSet = trimmed.length >= 3 ? trimmed : sorted;
    const avg = finalSet.reduce((sum, d) => sum + d, 0) / finalSet.length;
    const suggested = Math.round(Math.max(-200, Math.min(200, -avg)) / 5) * 5;

    document.getElementById('calibrator-suggested').innerText = `${suggested >= 0 ? '+' : ''}${suggested} ms`;
    document.getElementById('calibrator-sample-count').innerText = `Baseado em ${finalSet.length} de ${deltas.length} batida(s) capturada(s) (de até 17 possíveis).`;
    applyBtn.dataset.value = String(suggested);
    applyBtn.classList.remove('hidden');
}

function closeCalibratorModal() {
    document.getElementById('calibrator-modal').classList.add('hidden');
    document.getElementById('settings-modal').classList.remove('hidden');
}

const btnOpenCalibrator = document.getElementById('btn-open-calibrator');
if (btnOpenCalibrator) btnOpenCalibrator.addEventListener('click', startOffsetCalibration);

const btnCalibratorApply = document.getElementById('btn-calibrator-apply');
if (btnCalibratorApply) {
    btnCalibratorApply.addEventListener('click', (e) => {
        const val = parseInt(e.target.dataset.value, 10) || 0;
        globalOffset = val;
        document.getElementById('offset-slider').value = val;
        document.getElementById('offset-val').innerText = `${val} ms`;
        saveSettings();
        closeCalibratorModal();
    });
}

const btnCalibratorCancel = document.getElementById('btn-calibrator-cancel');
if (btnCalibratorCancel) {
    btnCalibratorCancel.addEventListener('click', () => {
        if (calibratorCancelFn) calibratorCancelFn();
        isCalibrating = false;
        closeCalibratorModal();
    });
}

function bindUIEvents() {
    const mainNoteShape = document.getElementById('main-note-shape');
    if (mainNoteShape) {
        mainNoteShape.addEventListener('change', (e) => { noteShape = e.target.value; saveSettings(); });
    }

    const mainGearSkin = document.getElementById('main-gear-skin');
    if (mainGearSkin) {
        mainGearSkin.addEventListener('change', (e) => { gearSkin = e.target.value; resizeCanvas(); saveSettings(); });
    }

    const mainDiffSelect = document.getElementById('main-diff-select');
    if (mainDiffSelect) {
        mainDiffSelect.addEventListener('change', (e) => {
            currentDifficulty = e.target.value;
            updateDiffPills();
            saveSettings();
        });
    }

    document.querySelectorAll('.diff-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const select = document.getElementById('main-diff-select');
            if (!select) return;
            select.value = pill.dataset.diff;
            select.dispatchEvent(new Event('change'));
        });
    });

    const settingNoFail = document.getElementById('setting-no-fail');
    if (settingNoFail) {
        settingNoFail.addEventListener('change', (e) => { noFailMode = e.target.checked; saveSettings(); });
    }
}

// Reflete a dificuldade atual no visual das pills (a <select> oculta continua sendo a fonte da verdade)
function updateDiffPills() {
    document.querySelectorAll('.diff-pill').forEach(pill => {
        const active = pill.dataset.diff === currentDifficulty;
        pill.className = active
            ? 'diff-pill py-1.5 rounded text-[11px] font-orbitron font-bold border border-amber-500 bg-amber-950/50 text-amber-300'
            : 'diff-pill py-1.5 rounded text-[11px] font-orbitron font-bold border border-slate-700 bg-slate-800 text-slate-400';
    });
}

// --- Persistência (localStorage) ---
const STORAGE_KEY = 'djmaxTrainerSettings_v1';

function collectSettings() {
    return {
        currentMode, currentPatternType, currentDifficulty, noteShape, gearSkin,
        noFailMode, enableLongNotes, enhancedSideNotes, scrollSpeed, gameView, rendererPref, showFpsMeter, lowLatencyMode, laneOpacityPct, gearPosition, bgDimPct, gearSkinV2: true, judgeOffsetByView, judgeOffsetLinked, hudLayout, hudV2: true, fsV2: true, hudShow, autoFullscreen, judgeDifficulty, noteMelodyMode: (typeof noteMelodyMode !== 'undefined' ? noteMelodyMode : 'guide'), hitSoundType: (typeof hitSoundType !== 'undefined' ? hitSoundType : 'soft'), hitSoundVolume: (typeof hitSoundVolume !== 'undefined' ? hitSoundVolume : 0.6), musicVolume: (typeof musicVolume !== 'undefined' ? musicVolume : 0.8), globalOffset, judgeOffset, randomMod, coverMod, speedMod, faderMod,
        keyConfigs: KEY_CONFIGS,
        altKeyConfigs: ALT_KEY_CONFIGS,
        audio: { hitsoundEnabled: audio.hitsoundEnabled, musicEnabled: audio.musicEnabled, volume: audio.volume }
    };
}

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collectSettings()));
    } catch (e) {
        // localStorage indisponível (modo privado, quota cheia etc.) — segue sem persistir
    }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);

        if (saved.altKeyConfigs && typeof saved.altKeyConfigs === 'object') {
            Object.keys(ALT_KEY_CONFIGS).forEach(mode => {
                const a = saved.altKeyConfigs[mode];
                if (Array.isArray(a) && a.length <= KEY_CONFIGS[mode].length) ALT_KEY_CONFIGS[mode] = a.map(c => (typeof c === 'string' ? c : null));
            });
        }
        if (saved.keyConfigs) {
            Object.keys(saved.keyConfigs).forEach(mode => {
                // Só aceita o keyConfig salvo se o COMPRIMENTO bater com o padrão atual
                // desse modo. Sem essa checagem, um keyConfig salvo por uma versão
                // ANTERIOR do app (com menos ou mais lanes que a atual — ex: 4B tinha 4
                // teclas antes das side notes existirem, ou tinha 6 numa versão
                // intermediária que testamos) sobrescreve KEY_CONFIGS[mode] com um array
                // de tamanho errado. Isso corrompe TUDO que deriva o número de lanes a
                // partir de KEY_CONFIGS[mode].length (getMainLaneCount, render(),
                // geração de nota, etc.), fazendo colunas ficarem com larguras erradas
                // mesmo com o script.js certinho — é exatamente o bug que apareceu
                // quando um ajuste salvo de uma versão antiga ficava no localStorage do
                // navegador (compartilhado entre QUALQUER página aberta via file://,
                // não importa a pasta) e "vazava" pra versões novas do arquivo.
                if (KEY_CONFIGS[mode] && Array.isArray(saved.keyConfigs[mode]) && saved.keyConfigs[mode].length === KEY_CONFIGS[mode].length) {
                    KEY_CONFIGS[mode] = saved.keyConfigs[mode];
                }
            });
        }

        if (saved.currentMode) currentMode = saved.currentMode;
        // 'imported_audio' nunca é restaurado: era o padrão de "áudio importado" da tela
        // inicial (removido — ver comentário no topo da seção de importação de música), mas
        // alguém que salvou config numa versão antiga pode ainda ter esse valor guardado.
        if (saved.currentPatternType && saved.currentPatternType !== 'imported_audio') {
            currentPatternType = resolvePatternId(saved.currentPatternType);
        }
        if (saved.currentDifficulty) currentDifficulty = saved.currentDifficulty;
        if (saved.noteShape) noteShape = saved.noteShape;
        if (saved.gearSkin) gearSkin = saved.gearSkin;
        if (typeof saved.noFailMode === 'boolean') noFailMode = saved.noFailMode;
        if (typeof saved.enableLongNotes === 'boolean') enableLongNotes = saved.enableLongNotes;
        if (typeof saved.enhancedSideNotes === 'boolean') enhancedSideNotes = saved.enhancedSideNotes;
        if (typeof saved.scrollSpeed === 'number') scrollSpeed = saved.scrollSpeed;
        if (['classic', 'highway', 'highway_tilt'].includes(saved.gameView)) gameView = saved.gameView;
        // A Gear 3D inclinada saiu do menu (a perspectiva atrapalhava o timing) — vira a Gear 3D reta.
        if (gameView === 'highway_tilt') gameView = 'highway';
        // A Gear 3D saiu do jogo (ficou só a gear clássica — a 3D era a mesma gear com outro
        // fundo, e ainda "sentia" diferente pra tocar). O visual 3D do Chart Editor continua.
        gameView = 'classic';
        if (saved.rendererPref === 'webgl' || saved.rendererPref === '2d') rendererPref = saved.rendererPref;
        if (typeof saved.showFpsMeter === 'boolean') showFpsMeter = saved.showFpsMeter;
        // 'Baixa latência de imagem' saiu (1.22.7): o julgamento usa o horário da tecla, não a imagem, e o
        // modo podia rasgar a tela. Fica sempre desligado, mesmo pra quem tinha ligado.
        lowLatencyMode = false;
        if (typeof saved.laneOpacityPct === 'number') laneOpacityPct = Math.max(0, Math.min(100, Math.round(saved.laneOpacityPct / 10) * 10));
        if (['left', 'center', 'right'].includes(saved.gearPosition)) gearPosition = saved.gearPosition;
        if (typeof saved.bgDimPct === 'number') bgDimPct = Math.max(0, Math.min(90, saved.bgDimPct));
        // Uma vez só: quem já usava a versão anterior passa a ver a gear nova "Respect" (dá pra
        // voltar pras antigas no seletor Gear Skin a qualquer hora).
        if (!saved.gearSkinV2) { gearSkin = 'respect'; if (noteShape === 'bar') noteShape = 'djmax'; }
        if (typeof saved.globalOffset === 'number') globalOffset = saved.globalOffset;
        if (typeof saved.judgeOffset === 'number') judgeOffset = saved.judgeOffset;
        if (saved.judgeOffsetByView && typeof saved.judgeOffsetByView === 'object') {
            ['classic', 'highway'].forEach(k => { if (typeof saved.judgeOffsetByView[k] === 'number') judgeOffsetByView[k] = saved.judgeOffsetByView[k]; });
        } else if (typeof saved.judgeOffset === 'number') {
            judgeOffsetByView = { classic: saved.judgeOffset, highway: saved.judgeOffset };
        }
        // Ajuste único (padrão novo): quem tinha separado passa a usar o da Gear clássica — o visual
        // que já estava bom — nos dois.
        // Sincronia única: quem tinha valores separados fica com o da Gear clássica (o que
        // estava bom), valendo pra tudo.
        judgeOffsetLinked = true;
        judgeOffsetByView = { classic: judgeOffsetByView.classic || 0, highway: judgeOffsetByView.classic || 0 };
        judgeOffset = judgeOffsetByView.classic || 0;
        // v2: o padrão passou a ser o layout do jogo (pedido com a imagem de referência)
        if (saved.hudV2 && (saved.hudLayout === 'center' || saved.hudLayout === 'djmax')) hudLayout = saved.hudLayout;
        if (saved.hudShow && typeof saved.hudShow === 'object') hudShow = { ...saved.hudShow };
        if (JUDGE_PROFILES[saved.judgeDifficulty]) applyJudgeProfile(saved.judgeDifficulty);
        // v2: tela cheia automática passou a vir DESLIGADA (o jogo já roda em janela própria/tela cheia)
        if (saved.fsV2 && typeof saved.autoFullscreen === 'boolean') autoFullscreen = saved.autoFullscreen;
        if (typeof noteMelodyMode !== 'undefined' && ['guide', 'hit', 'off'].includes(saved.noteMelodyMode)) noteMelodyMode = saved.noteMelodyMode;
        if (typeof hitSoundType !== 'undefined' && saved.hitSoundType && HIT_SOUND_TYPES[saved.hitSoundType]) hitSoundType = saved.hitSoundType;
        if (typeof saved.hitSoundVolume === 'number') hitSoundVolume = Math.max(0, Math.min(1, saved.hitSoundVolume));
        if (typeof saved.musicVolume === 'number') musicVolume = Math.max(0, Math.min(1, saved.musicVolume));
        if (saved.randomMod) randomMod = saved.randomMod;
        if (saved.coverMod) coverMod = saved.coverMod;
        if (saved.speedMod) speedMod = saved.speedMod;
        if (saved.faderMod) faderMod = saved.faderMod;

        if (saved.audio) {
            if (typeof saved.audio.hitsoundEnabled === 'boolean') audio.hitsoundEnabled = saved.audio.hitsoundEnabled;
            if (typeof saved.audio.musicEnabled === 'boolean') audio.musicEnabled = saved.audio.musicEnabled;
            if (typeof saved.audio.volume === 'number') audio.volume = saved.audio.volume;
        }
    } catch (e) {
        // dados corrompidos no localStorage — ignora e segue com os padrões
    }
}

// Reflete o estado carregado (ou padrão) nos controles visuais da tela inicial e configurações
function applySettingsToUI() {
    document.querySelectorAll('.mode-btn').forEach(b => {
        const active = b.dataset.mode === currentMode;
        b.className = active
            ? "mode-btn active-mode px-3 py-1.5 rounded text-sm font-orbitron font-bold border border-cyan-500 bg-cyan-950/50 text-cyan-300"
            : "mode-btn px-3 py-1.5 rounded text-sm font-orbitron font-bold border border-slate-700 bg-slate-800 text-slate-400 hover:text-white";
    });

    document.querySelectorAll('.pattern-card').forEach(c => {
        c.classList.remove('border-cyan-400', 'bg-slate-800/80', 'border-red-400', 'bg-red-950/80');
        c.classList.add('border-slate-700', 'bg-slate-800/60');
        if (c.dataset.pattern === currentPatternType) {
            c.classList.remove('border-slate-700', 'bg-slate-800/60');
            if (c.dataset.pattern === 'stream') c.classList.add('border-red-400', 'bg-red-950/80');
            else c.classList.add('border-cyan-400', 'bg-slate-800/80');
            updateSongPreview(c);
        }
    });

    updateDiffPills();

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el != null && val !== undefined && val !== null) el.value = val;
    };
    setVal('main-note-shape', noteShape);
    setVal('main-gear-skin', gearSkin);
    setVal('main-diff-select', currentDifficulty);
    setVal('mod-random', randomMod);
    setVal('mod-cover', coverMod);
    setVal('mod-speed', speedMod);
    setVal('mod-fader', faderMod);

    const noFailEl = document.getElementById('setting-no-fail');
    if (noFailEl) noFailEl.checked = noFailMode;

    const longNotesEl = document.getElementById('setting-long-notes');
    if (longNotesEl) longNotesEl.checked = enableLongNotes;

    const enhancedSideNotesEl = document.getElementById('setting-enhanced-side-notes');
    if (enhancedSideNotesEl) enhancedSideNotesEl.checked = enhancedSideNotes;

    const hitsoundEl = document.getElementById('audio-hitsounds');
    if (hitsoundEl) hitsoundEl.checked = audio.hitsoundEnabled;

    const musicEl = document.getElementById('audio-music');
    if (musicEl) musicEl.checked = audio.musicEnabled;

    const volEl = document.getElementById('audio-volume');
    if (volEl) volEl.value = audio.volume;
    document.getElementById('vol-val').innerText = `${Math.round(audio.volume * 100)}%`;

    document.getElementById('offset-slider').value = globalOffset;
    document.getElementById('offset-val').innerText = `${globalOffset} ms`;
    updateJudgeOffsetDisplay();

    updateSpeedDisplay();
    const gameViewEl = document.getElementById('main-game-view');
    if (gameViewEl) gameViewEl.value = gameView;
    setVal('setting-renderer', rendererPref);
    const fpsEl = document.getElementById('setting-show-fps');
    if (fpsEl) fpsEl.checked = showFpsMeter;
    const lowLatEl = document.getElementById('setting-low-latency');
    if (lowLatEl) lowLatEl.checked = lowLatencyMode;
    setVal('setting-hud-layout', hudLayout);
    syncHudShowUI();
    setVal('setting-judge-difficulty', judgeDifficulty);
    const linkEl = document.getElementById('setting-judge-linked');
    if (linkEl) linkEl.checked = judgeOffsetLinked;
    const afsEl = document.getElementById('setting-auto-fullscreen');
    if (afsEl) afsEl.checked = autoFullscreen;
    if (typeof noteMelodyMode !== 'undefined') {
        setVal('audio-note-melody', noteMelodyMode);
        setVal('audio-hit-type', hitSoundType);
        setVal('audio-hit-volume', hitSoundVolume);
        setVal('audio-music-volume', musicVolume);
        const hv = document.getElementById('hit-vol-val'); if (hv) hv.innerText = `${Math.round(hitSoundVolume * 100)}%`;
        const mv = document.getElementById('music-vol-val'); if (mv) mv.innerText = `${Math.round(musicVolume * 100)}%`;
    }
    setVal('setting-lane-opacity', laneOpacityPct);
    const laneOpVal = document.getElementById('lane-opacity-val');
    if (laneOpVal) laneOpVal.innerText = `${laneOpacityPct}%`;
    setVal('setting-gear-position', gearPosition);
    setVal('setting-bg-dim', bgDimPct);
    const bgDimVal = document.getElementById('bg-dim-val');
    if (bgDimVal) bgDimVal.innerText = `${bgDimPct}%`;
    if (typeof setRendererPref === 'function') setRendererPref(rendererPref);
    if (typeof applyGameBackground === 'function') applyGameBackground();
    setGameView(gameView);
    renderKeybindInputs();
}

window.onload = async () => {
    renderDrillCards();
    loadSettings();
    await loadCustomCharts();
    customCharts.forEach(addOrUpdateCustomChartCard);

    // Se a config salva apontava pra um chart custom que foi apagado (ou nunca existiu),
    // volta pro padrão default em vez de deixar a prática vazia
    if (typeof currentPatternType === 'string' && currentPatternType.startsWith('custom:') && !findCustomChart(currentPatternType.slice(7))) {
        currentPatternType = 'timing';
    }

    setupControls();
    applySettingsToUI();
    bindUIEvents();
    bindChartEditorEvents();
    resizeCanvas();
    render();
};