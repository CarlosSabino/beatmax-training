// =====================================================================================
// arya-lofi.js — fundo e música do menu inicial.
//  • Vídeo da Arya lo-fi em loop (assets/arya-lofi.mp4 / .webm, preparado pra emendar sem
//    corte) como fundo do menu inteiro. Só começa depois da abertura.
//  • Música do menu (Configurações › Áudio › "Música do menu inicial"):
//      lofi        → trilha da Arya (assets/arya-lofi.ogg) em loop exato pelo Web Audio
//      aleatoria   → uma música sua (osu!/charts) sorteada a cada vez que volta ao menu
//      chart:<id>  → sempre aquela música, a partir do trecho de prévia
//      off         → sem música
//    Segue o volume da música, para ao sair do menu inicial; o botão no canto liga/desliga.
// =====================================================================================
(function () {
    const MUTE_KEY = 'djmaxLofiMudo_v1';
    const CFG_KEY = 'djmaxMenuMusica_v1';
    const VOL_LOFI = 0.55, VOL_SONG = 0.7; // relativo ao volume da música
    const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    let mudo = ls(MUTE_KEY, '0') === '1';
    let escolha = ls(CFG_KEY, 'lofi');

    const css = document.createElement('style');
    css.textContent = `
#bm-hub .lofi{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;opacity:0;transition:opacity 1.2s ease}
#bm-hub .lofi.ok{opacity:1}
#bm-hub .lofi-g{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity 1.2s ease;
  background:linear-gradient(180deg,rgba(6,9,20,.55),transparent 26%,transparent 62%,rgba(6,9,20,.9)),linear-gradient(90deg,transparent 45%,rgba(6,9,20,.4)),rgba(4,6,16,.38)}
#bm-hub .lofi.ok + .lofi-g{opacity:1}
#bm-hub.has-lofi .arya,#bm-hub.has-lofi .grid,#bm-hub.has-lofi .say{display:none!important}
#bm-hub.has-lofi .center{left:38vw;right:0}
#bm-hub.has-lofi .foot{backdrop-filter:none}
/* janelas por cima do menu: o desfoque de fundo tinha que ser refeito a cada quadro do vídeo (pesado); o fundo delas já é quase opaco */
#bc-ov,#col-ov,#rk-ov,#lv-ov,#perfil-ov,#nov-ov,#sair-ov,#bm-equip,#calt-ov{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
#bm-lofi-snd{position:absolute;right:20px;bottom:calc(48px + clamp(110px,14vh,150px) + 14px);z-index:4;display:none;align-items:center;gap:7px;padding:6px 13px;border-radius:999px;max-width:340px;
  background:rgba(8,12,28,.72);border:1px solid rgba(34,211,238,.45);color:#a5f3fc;font:800 11px Orbitron,monospace;letter-spacing:.1em;cursor:pointer}
#bm-lofi-snd span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bm-lofi-snd:hover{background:rgba(14,116,144,.6);color:#fff}
#bm-lofi-snd.mudo{color:#64748b;border-color:#334155}
#bm-hub.has-lofi #bm-lofi-snd.tem{display:inline-flex}
#bm-lofi-snd i{display:inline-flex;align-items:flex-end;gap:2px;height:12px;flex-shrink:0}
#bm-lofi-snd i b{width:3px;background:currentColor;border-radius:1px;animation:lofiEq 1s ease-in-out infinite}
#bm-lofi-snd i b:nth-child(2){animation-delay:-.35s}#bm-lofi-snd i b:nth-child(3){animation-delay:-.7s}
#bm-lofi-snd.mudo i b{animation:none;height:3px!important}
@keyframes lofiEq{0%,100%{height:3px}50%{height:12px}}
@media (max-width:1100px){#bm-hub.has-lofi .center{left:0}}`;
    document.head.appendChild(css);

    const volMusica = () => (typeof musicVolume === 'number' ? Math.max(0, Math.min(1, musicVolume)) : 0.8);

    // ================= trilha lo-fi (Web Audio, loop exato) =================
    let actx = null, buf = null, src = null, gain = null, carregando = null;
    function ctxOk() {
        if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
        return actx;
    }
    function carregarLofi() {
        if (buf || carregando) return carregando;
        const c = ctxOk(); if (!c) return null;
        carregando = fetch('assets/arya-lofi.ogg').then(r => r.arrayBuffer()).then(a => c.decodeAudioData(a)).then(b => { buf = b; return b; }).catch(e => { console.warn('[lofi]', e); carregando = null; });
        return carregando;
    }
    function lofiTocar() {
        if (src) return;
        const c = ctxOk(); if (!c) return;
        if (!buf) { const p = carregarLofi(); if (p) p.then(() => sync()); return; }
        if (c.state === 'suspended') c.resume().catch(() => {});
        gain = c.createGain(); gain.gain.value = 0; gain.connect(c.destination);
        src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(gain);
        const off = video && isFinite(video.currentTime) ? video.currentTime % buf.duration : 0; // anda junto com o vídeo
        src.start(0, off);
        gain.gain.setTargetAtTime(volMusica() * VOL_LOFI, c.currentTime, 0.35);
    }
    function lofiParar() {
        if (!src || !actx) return;
        const s = src, g = gain; src = null; gain = null;
        try { g.gain.cancelScheduledValues(actx.currentTime); g.gain.setTargetAtTime(0, actx.currentTime, 0.12); } catch (e) {}
        setTimeout(() => { try { s.stop(); s.disconnect(); g.disconnect(); } catch (e) {} }, 600);
    }

    // ================= uma música da biblioteca =================
    let song = null; // { id, el, url, fade }
    function musicasDisponiveis() {
        const all = (typeof customCharts !== 'undefined' && Array.isArray(customCharts)) ? customCharts : [];
        const seen = new Map();
        all.forEach(c => {
            const nome = String(c.title || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim() || 'Sem título';
            const k = nome.toLowerCase() + '|' + ((c.osu && c.osu.setId) || '');
            if (!seen.has(k)) seen.set(k, { id: c.id, nome, artista: c.artist || (c.osu && c.osu.artist) || '' });
        });
        return [...seen.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }
    function nomeDe(id) {
        const c = typeof findCustomChart === 'function' ? findCustomChart(id) : null;
        return c ? String(c.title || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim() : '';
    }
    let sorteada = null;
    function idDaVez() {
        if (escolha.startsWith('chart:')) return escolha.slice(6);
        if (escolha === 'aleatoria') {
            if (!sorteada) { const l = musicasDisponiveis(); sorteada = l.length ? l[Math.floor(Math.random() * l.length)].id : null; }
            return sorteada;
        }
        return null;
    }
    let songFalhou = {};
    function songTocar(id) {
        if (song && song.id === id) { if (song.el.paused) song.el.play().catch(() => {}); fadeSong(volMusica() * VOL_SONG); return; }
        songParar(true);
        if (typeof loadChartAudioBlob !== 'function') return;
        const me = { id, el: new Audio(), url: null, fade: 0, pronto: false };
        song = me;
        loadChartAudioBlob(id).then(row => {
            if (song !== me) return;
            if (!row || !row.blob) { songFalhou[id] = true; song = null; sync(); return; } // sem áudio salvo: volta pro lo-fi
            me.url = URL.createObjectURL(row.blob);
            me.el.src = me.url; me.el.loop = true; me.el.volume = 0;
            const ch = findCustomChart(id);
            const prev = ch && ch.osu && ch.osu.previewTime > 0 ? ch.osu.previewTime / 1000 : 0;
            me.el.addEventListener('loadedmetadata', () => { try { if (prev && prev < me.el.duration - 5) me.el.currentTime = prev; } catch (e) {} }, { once: true });
            me.pronto = true;
            if (deveTocar()) { me.el.play().catch(() => {}); fadeSong(volMusica() * VOL_SONG); }
        }).catch(() => { songFalhou[id] = true; if (song === me) song = null; sync(); });
    }
    function fadeSong(alvo, depois) {
        if (!song) return;
        const s = song; clearInterval(s.fade);
        s.fade = setInterval(() => {
            const v = s.el.volume, d = alvo - v;
            if (Math.abs(d) < 0.03) { s.el.volume = Math.max(0, Math.min(1, alvo)); clearInterval(s.fade); if (depois) depois(); return; }
            s.el.volume = Math.max(0, Math.min(1, v + Math.sign(d) * 0.04));
        }, 40);
    }
    function songParar(descartar) {
        if (!song) return;
        const s = song;
        if (descartar) { song = null; clearInterval(s.fade); try { s.el.pause(); } catch (e) {} if (s.url) URL.revokeObjectURL(s.url); return; }
        fadeSong(0, () => { try { s.el.pause(); } catch (e) {} });
    }

    // ================= quando tocar =================
    let hub = null, video = null, btn = null, revelado = false, hubEstava = false, ultimoT = -1, travado = 0;
    const COBRE = '#bc-ov, #col-ov, #rk-ov, #lv-ov, #perfil-ov, #nov-ov, #sair-ov, #lv-up, #bc-cele, #calt-ov, #settings-modal:not(.hidden), #backup-modal:not(.hidden), #nuvem-modal:not(.hidden), #osu-modal:not(.hidden), #skin-modal.open';
    const naAbertura = () => (typeof introEl !== 'undefined' && !!introEl) || !!document.getElementById('tela-abertura');
    function hubVisivel() {
        return !!(hub && hub.classList.contains('on') && !document.hidden && !naAbertura() && !(typeof isPlaying !== 'undefined' && isPlaying));
    }
    function deveTocar() { return hubVisivel() && !mudo && escolha !== 'off'; }
    function fonteDaVez() {
        if (escolha === 'off') return null;
        const id = idDaVez();
        if (id && !songFalhou[id]) return { tipo: 'song', id };
        return { tipo: 'lofi' };
    }
    function rotulo() {
        const f = fonteDaVez();
        if (!f) return '';
        return f.tipo === 'lofi' ? 'LO-FI' : (nomeDe(f.id) || 'MÚSICA').toUpperCase();
    }
    function sync() {
        if (!hub) return;
        const hubOn = hub.classList.contains('on');
        // a prévia da música da seleção não pode continuar tocando por baixo do menu inicial
        if (hubOn && typeof previa !== 'undefined' && previa.el && typeof stopPrevia === 'function') stopPrevia();
        // voltou do menu inicial pra seleção: retoma a prévia da música selecionada
        if (!hubOn && hubEstava && typeof playPrevia === 'function' && typeof currentPatternType === 'string' && currentPatternType.startsWith('custom:')) {
            const m = document.getElementById('menu-overlay');
            if (m && !m.classList.contains('hidden') && !(typeof isPlaying !== 'undefined' && isPlaying)) setTimeout(() => playPrevia(currentPatternType.slice(7)), 350);
        }
        hubEstava = hubOn;
        // vídeo "congelado": devia estar rodando mas o tempo não anda há ~2 s → tenta de novo
        if (video && revelado && !video.paused) {
            const t = video.currentTime;
            if (t === ultimoT) { travado++; if (travado >= 5) { travado = 0; try { const k = video.currentTime; video.pause(); video.currentTime = (k + 0.05) % (video.duration || 6); video.play().catch(() => {}); } catch (e) {} } }
            else travado = 0;
            ultimoT = t;
        } else { travado = 0; ultimoT = -1; }
        const vis = hubVisivel();
        const coberto = [...document.querySelectorAll(COBRE)].some(e => e.getClientRects().length > 0); // Loja, Nível, Ranking… por cima: o vídeo espera (a música continua)
        if (!video) {} else if (vis && !coberto) {
            if (!revelado && video.readyState >= 3) { revelado = true; try { video.currentTime = 0; } catch (e) {} video.classList.add('ok'); }
            if (revelado && video.paused) video.play().catch(() => {});
        } else if (!video.paused) video.pause();
        const f = deveTocar() ? fonteDaVez() : null;
        if (f && f.tipo === 'lofi') { songParar(); lofiTocar(); }
        else if (f && f.tipo === 'song') { lofiParar(); songTocar(f.id); }
        else { lofiParar(); songParar(); }
        if (!vis && escolha === 'aleatoria' && !hub.classList.contains('on')) sorteada = null; // na próxima volta ao menu, outra música
        if (btn) {
            btn.classList.toggle('tem', escolha !== 'off');
            btn.classList.toggle('mudo', mudo);
            btn.title = (mudo ? 'Ligar' : 'Desligar') + ' a música do menu (troque em Configurações › Áudio)';
            const t = rotulo() + (mudo ? ' · MUDO' : '');
            if (btn.lastChild.textContent !== t) btn.lastChild.textContent = t;
        }
        if (actx && gain) { const v = volMusica() * VOL_LOFI; if (Math.abs(gain.gain.value - v) > 0.01) gain.gain.setTargetAtTime(v, actx.currentTime, 0.2); }
        if (song && song.pronto && !song.el.paused && f && f.tipo === 'song') { const v = volMusica() * VOL_SONG; if (Math.abs(song.el.volume - v) > 0.05) fadeSong(v); }
    }
    function montar(h) {
        hub = h;
        if (hub.querySelector('.lofi')) return;
        video = document.createElement('video');
        video.className = 'lofi'; video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
        video.setAttribute('aria-hidden', 'true');
        video.addEventListener('canplaythrough', sync);
        video.addEventListener('error', () => { hub.classList.remove('has-lofi'); video.remove(); video = null; }); // sem vídeo: volta a Arya acenando
        // H.264 (decodificado pela placa de vídeo) quando der; senão WebM. Carregado inteiro na memória
        // pra volta do loop não depender do servidor.
        const mp4 = video.canPlayType('video/mp4; codecs="avc1.640028"') ? 'assets/arya-lofi.mp4' : '';
        const url = mp4 || 'assets/arya-lofi.webm';
        fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
            .then(b => { video.src = URL.createObjectURL(b); video.load(); })
            .catch(() => { video.src = url; });
        const g = document.createElement('div'); g.className = 'lofi-g';
        const tiles = hub.querySelector('.tiles');
        hub.insertBefore(video, tiles); hub.insertBefore(g, tiles);
        btn = document.createElement('button'); btn.id = 'bm-lofi-snd'; btn.type = 'button';
        btn.innerHTML = '<i><b></b><b></b><b></b></i><span></span>';
        btn.addEventListener('click', (e) => { e.stopPropagation(); mudo = !mudo; lsSet(MUTE_KEY, mudo ? '1' : '0'); sync(); });
        hub.appendChild(btn);
        hub.classList.add('has-lofi');
        new MutationObserver(sync).observe(hub, { attributes: true, attributeFilter: ['class'] });
        setTimeout(carregarLofi, 1500);
        sync();
    }
    setInterval(() => {
        // jogando: nada a fazer aqui (o menu já parou tudo ao começar a partida)
        if (typeof isPlaying !== 'undefined' && isPlaying && !src && !(song && !song.el.paused) && !(video && !video.paused)) return;
        sync();
    }, 400); // abertura terminando, volume mudando, jogo começando…
    document.addEventListener('visibilitychange', sync);
    const destrava = () => { const c = ctxOk(); if (c && c.state === 'suspended') c.resume().then(sync).catch(() => {}); else sync(); };
    ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, destrava, { capture: true, passive: true }));

    const pegar = () => { const h = document.getElementById('bm-hub'); if (h) { montar(h); return true; } return false; };
    if (!pegar()) {
        const mo = new MutationObserver(() => { if (pegar()) mo.disconnect(); });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    // ================= Configurações › Áudio: "Música do menu inicial" =================
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function preencher(sel) {
        const l = musicasDisponiveis();
        sel.innerHTML = `<option value="lofi">Lo-fi da Arya (padrão)</option><option value="aleatoria">Aleatória — uma das minhas músicas</option><option value="off">Sem música</option>`
            + (l.length ? `<optgroup label="Minhas músicas">${l.map(m => `<option value="chart:${esc(m.id)}">${esc(m.nome)}${m.artista ? ' — ' + esc(m.artista) : ''}</option>`).join('')}</optgroup>` : '');
        const v = escolha.startsWith('chart:') && !l.some(m => 'chart:' + m.id === escolha) ? 'lofi' : escolha;
        sel.value = v;
    }
    function montarOpcao() {
        const vol = document.getElementById('audio-music-volume');
        if (!vol || document.getElementById('audio-menu-music')) return !!vol;
        const box = vol.closest('div');
        const lab = document.createElement('label');
        lab.className = 'flex flex-col gap-1';
        lab.innerHTML = `<span class="text-xs font-bold text-slate-200">Música do menu inicial</span>
            <select id="audio-menu-music" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100"></select>
            <span class="text-[11px] text-slate-400">Toca no menu inicial com o vídeo da Arya. As músicas começam no trecho de prévia.</span>`;
        box.insertAdjacentElement('afterend', lab);
        const sel = lab.querySelector('select');
        preencher(sel);
        ['focus', 'mousedown'].forEach(ev => sel.addEventListener(ev, () => { const v = sel.value; preencher(sel); sel.value = v; }));
        sel.addEventListener('change', () => { escolha = sel.value; lsSet(CFG_KEY, escolha); sorteada = null; songFalhou = {}; songParar(true); sync(); });
        return true;
    }
    if (!montarOpcao()) document.addEventListener('DOMContentLoaded', montarOpcao);

    window.bmMenuMusica = { sync, escolha: () => escolha, definir: (v) => { escolha = v; lsSet(CFG_KEY, v); sorteada = null; songFalhou = {}; songParar(true); sync(); } };
})();
