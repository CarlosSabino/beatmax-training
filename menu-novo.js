// =====================================================================================
// menu-novo.js — TELA INICIAL (menu) + SELEÇÃO DE MÚSICA reorganizada + janela EQUIPAMENTO.
//
//  • Menu inicial: módulos em cima (Loja, Treinos, Músicas osu!, Desafios, Nuvem, Editor,
//    Análise, Ranking), Arya no meio, carteira/nível + atalhos embaixo. ←/→/↑/↓ + Enter.
//  • Seleção de música: barra de cima própria (Esc = menu), à esquerda só a música, a
//    dificuldade, o recorde e o resumo do equipamento; à direita a lista.
//  • Equipamento (Space): speed, efeitos, skins e velocidade da música numa janela só.
//
// Nada é recriado: os controles de sempre (selects, slider, botões) são só MOVIDOS de lugar,
// então todo o resto do jogo continua funcionando igual.
// =====================================================================================
(function () {
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fala = (k, l) => typeof window.beatmaxFala === 'function' ? window.beatmaxFala(k, l) : l[0];
    const isWeb = !!window.BEATMAX_WEB;
    document.documentElement.classList.add('bm-novo');

    const SVG = {
        loja: '<path d="M6 10h6l5 22h20l5-16H15"/><circle cx="20" cy="39" r="3"/><circle cx="34" cy="39" r="3"/>',
        treinos: '<rect x="8" y="8" width="32" height="32" rx="5"/><path d="M20 16l12 8-12 8z" fill="currentColor"/>',
        osu: '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="6"/><path d="M24 8v4M24 36v4"/>',
        desafios: '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="2" fill="currentColor"/>',
        nuvem: '<path d="M14 34h22a8 8 0 0 0 0-16 11 11 0 0 0-21-2A9 9 0 0 0 14 34z"/>',
        editor: '<path d="M10 38l4-12 18-18 8 8-18 18z"/><path d="M28 12l8 8"/>',
        analise: '<path d="M8 38h32M14 30v8M24 20v18M34 12v26"/>',
        ranking: '<path d="M16 40h16M24 32v8M14 8h20v10a10 10 0 0 1-20 0z"/><path d="M14 12H8a6 6 0 0 0 6 8M34 12h6a6 6 0 0 1-6 8"/>',
        perfil: '<circle cx="24" cy="17" r="8"/><path d="M8 42c2-10 9-14 16-14s14 4 16 14"/>',
        nivel: '<path d="M24 6l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z"/>',
        skins: '<rect x="8" y="14" width="32" height="26" rx="4"/><path d="M18 14v-4h12v4M8 24h32"/>',
        novidades: '<path d="M24 14v12M24 32v1"/><circle cx="24" cy="24" r="17"/>',
        config: '<path d="M10 16h28M10 24h28M10 32h28"/><circle cx="18" cy="16" r="3.5" fill="#060914"/><circle cx="30" cy="24" r="3.5" fill="#060914"/><circle cx="20" cy="32" r="3.5" fill="#060914"/>',
        backup: '<path d="M10 8h24l6 6v26H10z"/><path d="M16 8v10h14V8M16 40V28h16v12"/>',
        sair: '<path d="M24 6v16M13 12a15 15 0 1 0 22 0"/>'
    };
    const icon = (k, cls) => `<svg viewBox="0 0 48 48" class="${cls || ''}">${SVG[k]}</svg>`;

    // ---------- ações ----------
    const click = (id) => { const b = $(id); if (b) b.click(); };
    const TILES = [
        { k: 'loja', t: 'LOJA', d: 'Gears e skins de notas exclusivas. Tudo pago com Beatcoins.', go: () => window.openLojaBeatmax && window.openLojaBeatmax() },
        { sep: true },
        { k: 'treinos', t: 'TREINOS', d: 'Treinos, músicas do osu! e os seus charts — escolha e jogue.', go: () => abrirSelecao() },
        { k: 'osu', t: 'MÚSICAS osu!', d: 'Buscar, baixar e importar músicas do osu!mania.', go: () => click('btn-osu') },
        { k: 'desafios', t: 'DESAFIOS', d: 'Desafio do dia e desafios semanais: Beatcoins e EXP.', go: () => window.openDesafioDoDia && window.openDesafioDoDia(), dot: () => !desafioFeito() },
        { k: 'nuvem', t: 'NUVEM', d: 'Publicar e baixar charts e jogar com os amigos.', go: () => click('btn-nuvem') },
        { k: 'editor', t: 'EDITOR', d: 'Crie e edite os seus próprios charts.', go: () => click('btn-chart-editor') },
        { k: 'analise', t: 'ANÁLISE', d: 'Histórico de partidas, precisão e evolução.', go: () => click('btn-stats') },
        { sep: true },
        { k: 'ranking', t: 'RANKING', d: 'Ranking online por música e por treino (conta da Nuvem).', go: () => window.openRanking && window.openRanking() }
    ];
    const FOOT = [
        { k: 'perfil', t: 'PERFIL', go: () => window.openPerfilPicker && window.openPerfilPicker(false) },
        { k: 'nivel', t: 'NÍVEL', go: () => window.openNivel && window.openNivel() },
        { k: 'skins', t: 'SKINS', go: () => window.openColecao ? window.openColecao() : click('btn-skin') },
        { k: 'novidades', t: 'NOVIDADES', go: () => window.openNovidades ? window.openNovidades() : click('nov-btn'), dot: () => !!document.querySelector('#nov-btn.unseen') },
        { k: 'config', t: 'CONFIG.', go: () => click('btn-settings') },
        { k: 'backup', t: 'BACKUP', go: () => window.openBackupDialog && window.openBackupDialog() }
    ];
    function desafioFeito() {
        try {
            const s = JSON.parse(localStorage.getItem('djmaxBeatcoins_v1') || '{}');
            const d = new Date(), p = (n) => String(n).padStart(2, '0');
            return !!(s.done && s.done[`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`]);
        } catch (e) { return false; }
    }

    // ---------- estilo ----------
    const css = document.createElement('style');
    css.textContent = `
html.bm-novo #app-header{display:none!important}
#bm-hub{position:absolute;inset:0;z-index:31;overflow:hidden;font-family:Rajdhani,sans-serif;color:#e2e8f0;background:#060914;display:none;user-select:none}
#bm-hub.on{display:block}
#bm-hub .bg{position:absolute;inset:0;background:radial-gradient(ellipse 50% 55% at 45% 55%,rgba(34,211,238,.16),transparent 70%),radial-gradient(ellipse 40% 45% at 85% 80%,rgba(244,114,182,.14),transparent 70%),linear-gradient(180deg,#0b1024,#070a16 60%,#05070f)}
#bm-hub .grid{position:absolute;left:-10%;right:-10%;bottom:-6%;height:48%;transform:perspective(700px) rotateX(62deg);transform-origin:50% 100%;background:repeating-linear-gradient(90deg,rgba(34,211,238,.16) 0 2px,transparent 2px 90px),repeating-linear-gradient(0deg,rgba(244,114,182,.14) 0 2px,transparent 2px 70px);-webkit-mask-image:linear-gradient(to top,#000 10%,transparent 90%);mask-image:linear-gradient(to top,#000 10%,transparent 90%);animation:bmGrid 3s linear infinite}
@keyframes bmGrid{to{background-position:0 70px,0 70px}}
#bm-hub .tiles{position:absolute;top:clamp(16px,4vh,44px);left:0;right:0;display:flex;justify-content:center;gap:clamp(6px,.8vw,14px);z-index:2;flex-wrap:nowrap}
#bm-hub .sep{width:2px;background:rgba(148,163,184,.25);margin:14px 4px}
#bm-hub .t{width:clamp(96px,7.8vw,150px);height:clamp(92px,13vh,140px);border-radius:14px;background:linear-gradient(180deg,rgba(51,65,85,.75),rgba(30,41,59,.75));border:1px solid rgba(148,163,184,.25);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(6px,1.1vh,12px);color:#cbd5e1;font:800 clamp(11px,.8vw,15px) Orbitron,monospace;letter-spacing:.05em;position:relative;cursor:pointer;transition:transform .15s,box-shadow .15s,background .15s;text-align:center}
#bm-hub .t svg,#bm-hub .mini svg{width:clamp(34px,2.9vw,56px);height:clamp(34px,2.9vw,56px);stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
#bm-hub .t.on{background:linear-gradient(180deg,rgba(14,116,144,.9),rgba(8,47,73,.9));border:2px solid #22d3ee;box-shadow:0 0 30px rgba(34,211,238,.5);color:#fff;transform:translateY(4px) scale(1.06)}
#bm-hub .t.off{opacity:.45;cursor:default}
#bm-hub .t small{position:absolute;bottom:-22px;font:700 12px Rajdhani;color:#64748b;letter-spacing:.02em}
#bm-hub .dot{position:absolute;top:8px;right:8px;width:12px;height:12px;border-radius:50%;background:#f43f5e;box-shadow:0 0 8px #f43f5e;display:none}
#bm-hub .has-dot .dot{display:block}
#bm-hub .center{position:absolute;left:0;right:clamp(220px,18vw,340px);top:22vh;height:52vh;display:flex;align-items:center;justify-content:center;z-index:2;pointer-events:none}
#bm-hub .logo{text-align:center}
#bm-hub .logo .big{font:900 clamp(64px,6.3vw,120px)/1 Orbitron,monospace;letter-spacing:.08em;background:linear-gradient(180deg,#fff,#a5f3fc 55%,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 30px rgba(34,211,238,.45))}
#bm-hub .logo .sub{font:800 clamp(14px,1.15vw,22px) Orbitron,monospace;letter-spacing:.5em;color:#f472b6;margin-top:6px}
#bm-hub .card{margin-top:clamp(18px,4vh,44px);display:inline-block;padding:16px 30px;border-radius:18px;background:rgba(8,12,28,.8);border:1.5px solid #22d3ee;box-shadow:0 0 40px rgba(34,211,238,.25);max-width:min(560px,60vw)}
#bm-hub .card .k{font:800 13px Orbitron;color:#22d3ee;letter-spacing:.2em}
#bm-hub .card .n{font:900 clamp(22px,1.8vw,34px) Orbitron;color:#fff;letter-spacing:.06em}
#bm-hub .card .d{font:600 clamp(14px,.95vw,18px) Rajdhani;color:#94a3b8}
#bm-hub .arya{position:absolute;right:2vw;bottom:110px;height:min(66vh,700px);z-index:1;filter:drop-shadow(0 0 30px rgba(34,211,238,.3));animation:bmChIn .6s cubic-bezier(.2,1.2,.4,1) both;pointer-events:none}
#bm-hub .say{position:absolute;right:calc(2vw + min(66vh,700px) * .55);top:27vh;z-index:3;max-width:290px;padding:12px 16px;border-radius:14px;background:rgba(15,23,42,.95);border:1.5px solid #22d3ee;font:700 16px/1.3 Rajdhani;color:#f1f5f9;box-shadow:0 8px 24px rgba(0,0,0,.5)}
#bm-hub .say b{color:#22d3ee}#bm-hub .say .nm{display:block;font:900 11px Orbitron;letter-spacing:.12em;color:#22d3ee;margin-bottom:2px}
#bm-hub .foot{position:absolute;left:0;right:0;bottom:48px;height:clamp(110px,14vh,150px);display:flex;align-items:center;padding:0 clamp(20px,5vw,110px);gap:clamp(10px,1.5vw,30px);z-index:3;background:linear-gradient(180deg,rgba(6,9,20,.75),rgba(6,9,20,.96));border-top:1px solid rgba(34,211,238,.25);backdrop-filter:blur(6px)}
#bm-hub .wallet{display:flex;flex-direction:column;gap:6px;min-width:clamp(150px,12vw,230px);cursor:pointer}
#bm-hub .wallet .l{font:700 13px Orbitron;letter-spacing:.12em;color:#94a3b8;border-bottom:1px solid #334155;padding-bottom:2px}
#bm-hub .wallet .v{display:flex;align-items:center;gap:10px;font:900 clamp(18px,1.4vw,26px) Orbitron;color:#fde68a}
#bm-hub .wallet .v.lv{color:#c4b5fd}
#bm-hub .coin{width:28px;height:28px;background:url('assets/beatcoin.png') center/contain no-repeat;flex-shrink:0}
#bm-hub .wbar{width:clamp(70px,7vw,140px);height:6px;border-radius:4px;background:#1e293b;overflow:hidden}#bm-hub .wbar i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#a78bfa)}
#bm-hub .play{display:flex;align-items:center;gap:14px;font:900 clamp(20px,1.6vw,30px) Orbitron;color:#fbbf24;cursor:pointer;padding:6px 14px 6px 6px;border-radius:999px;border:2px solid transparent}
#bm-hub .play .c{width:clamp(52px,3.9vw,74px);height:clamp(52px,3.9vw,74px);border-radius:50%;background:linear-gradient(180deg,#fbbf24,#f59e0b);display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(251,191,36,.5)}
#bm-hub .play .c svg{width:45%;height:45%;fill:#1c1917}
#bm-hub .vsep{width:2px;height:60%;background:rgba(148,163,184,.25)}
#bm-hub .mini{display:flex;flex-direction:column;align-items:center;gap:6px;width:clamp(70px,6.2vw,118px);font:800 clamp(12px,.8vw,15px) Rajdhani;letter-spacing:.06em;color:#e2e8f0;position:relative;cursor:pointer;padding:8px 0;border-radius:12px;border:2px solid transparent}
#bm-hub .mini svg{width:clamp(28px,2.3vw,44px);height:clamp(28px,2.3vw,44px)}
#bm-hub .mini .dot{top:2px;right:22%}
#bm-hub .mini.on,#bm-hub .play.on,#bm-hub .quit.on{border-color:#22d3ee;background:rgba(34,211,238,.12);box-shadow:0 0 18px rgba(34,211,238,.35)}
#bm-hub .quit{margin-left:auto;display:flex;align-items:center;gap:12px;font:800 18px Orbitron;color:#cbd5e1;cursor:pointer;padding:6px 6px 6px 14px;border-radius:999px;border:2px solid transparent}
#bm-hub .quit .c{width:54px;height:54px;border-radius:50%;border:3px solid #cbd5e1;display:flex;align-items:center;justify-content:center}
#bm-hub .quit svg{width:28px;height:28px;stroke:#cbd5e1;fill:none;stroke-width:3.4;stroke-linecap:round}
.bm-hint{position:absolute;left:0;right:0;bottom:0;height:48px;background:rgba(2,6,23,.92);border-top:1px solid #1e293b;display:flex;align-items:center;padding:0 clamp(16px,3vw,60px);gap:clamp(14px,1.8vw,34px);font:700 14px Rajdhani;color:#cbd5e1;z-index:4;white-space:nowrap;overflow:hidden}
.bm-hint kbd{font:800 11px Orbitron;padding:3px 8px;border-radius:5px;background:#e2e8f0;color:#0f172a;margin-right:6px}
.bm-hint .r{margin-left:auto;display:flex;gap:clamp(14px,1.8vw,34px)}
#bm-hub .ver{position:absolute;right:16px;top:10px;font:700 12px Orbitron;color:#64748b;z-index:3;background:rgba(15,23,42,.6);border:1px solid #334155;border-radius:999px;padding:4px 12px;cursor:pointer}
#bm-hub .ver:hover{color:#e2e8f0;border-color:#22d3ee}
#bm-hub .updchip{position:absolute;left:50%;transform:translateX(-50%);top:calc(clamp(16px,4vh,44px) + clamp(92px,13vh,140px) + 34px);z-index:3;display:none;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:linear-gradient(90deg,#047857,#0e7490);border:1.5px solid #6ee7b7;color:#ecfdf5;font:800 15px Rajdhani,sans-serif;cursor:pointer;box-shadow:0 0 24px rgba(16,185,129,.45);animation:bmUpd 1.6s ease-in-out infinite}
#bm-hub .updchip.on{display:flex}
#bm-hub .updchip b{font:900 13px Orbitron;letter-spacing:.06em;background:#ecfdf5;color:#065f46;border-radius:999px;padding:2px 10px}
@keyframes bmUpd{50%{box-shadow:0 0 6px rgba(16,185,129,.2)}}
#bm-top .verb{margin-left:auto;font:700 11px Orbitron;color:#64748b;background:rgba(15,23,42,.6);border:1px solid #334155;border-radius:999px;padding:4px 10px;cursor:pointer}
#bm-top .verb + .me{margin-left:0}
#bm-top .verb.novo{color:#ecfdf5;background:#047857;border-color:#6ee7b7}

/* ---------- seleção de música ---------- */
html.bm-novo #menu-overlay{background:radial-gradient(ellipse 60% 70% at 70% 40%,rgba(34,211,238,.08),transparent 70%),linear-gradient(180deg,#0b1024,#070a16)!important}
html.bm-novo #menu-overlay > .bm-oldtop{display:none!important}
#bm-top{display:flex;align-items:center;gap:18px;padding:14px clamp(16px,3vw,60px) 10px;flex-shrink:0}
#bm-top .back{display:flex;align-items:center;gap:10px;font:800 15px Orbitron;color:#94a3b8;cursor:pointer;background:none;border:0}
#bm-top .back:hover{color:#fff}
#bm-top kbd{font:800 11px Orbitron;padding:3px 8px;border-radius:5px;background:#e2e8f0;color:#0f172a}
#bm-top .ttl{font:900 clamp(20px,1.6vw,30px) Orbitron;letter-spacing:.08em;color:#fff}
#bm-top .me{margin-left:auto;display:flex;align-items:center;gap:14px;padding:5px 16px 5px 5px;border-radius:14px;background:linear-gradient(90deg,rgba(76,29,149,.6),rgba(14,116,144,.4));border:1px solid rgba(167,139,250,.4);cursor:pointer}
#bm-top .me .av{width:44px;height:44px;border-radius:50%;border:3px solid var(--pc,#22d3ee);display:flex;align-items:center;justify-content:center;font:900 19px Orbitron;color:var(--pc,#22d3ee);background:#0f172a}
#bm-top .me .n{font:800 17px Rajdhani;color:#fff;line-height:1.1}#bm-top .me .s{font:700 12px Orbitron;color:#c4b5fd}
#bm-top .me .coins{display:flex;align-items:center;gap:6px;font:900 17px Orbitron;color:#fde68a;margin-left:10px}
#bm-top .me .coin{width:22px;height:22px;background:url('assets/beatcoin.png') center/contain no-repeat}
#bm-top .ico{width:40px;height:40px;border-radius:10px;border:1px solid #334155;background:rgba(15,23,42,.8);color:#cbd5e1;display:flex;align-items:center;justify-content:center;cursor:pointer}
#bm-top .ico:hover{color:#fff;border-color:#22d3ee}
#bm-top .ico svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
html.bm-novo #menu-overlay{padding-bottom:48px}
html.bm-novo .bm-left{width:clamp(360px,25vw,480px)!important;padding:8px 18px 14px clamp(16px,3vw,60px)!important;border-right:0!important;gap:12px!important}
#bm-modes{display:flex;border-radius:12px;overflow:hidden;border:1px solid #334155;flex-shrink:0}
#bm-modes .mode-btn{flex:1;padding:8px 0!important;border:0!important;border-radius:0!important;background:rgba(15,23,42,.85)!important;color:#64748b!important;font:900 20px Orbitron!important}
#bm-modes .mode-btn.active-mode{background:linear-gradient(180deg,#0e7490,#155e75)!important;color:#fff!important;box-shadow:inset 0 -3px 0 #22d3ee}
html.bm-novo #song-preview-card{border-radius:16px!important;border-color:#334155!important;background:linear-gradient(135deg,rgba(30,58,138,.55),rgba(112,26,117,.45) 60%,#0f172a)!important}
html.bm-novo #preview-title{font-size:clamp(18px,1.4vw,26px)!important}
html.bm-novo #preview-desc{font-size:13px!important;color:#cbd5e1!important}
html.bm-novo .bm-diffbox > label{display:none}
html.bm-novo #diff-pills .diff-pill{font-size:12px!important;padding:7px 0!important}
#bm-rec{display:grid;grid-template-columns:1fr 1fr 1fr;border-radius:14px;border:1px solid #334155;background:rgba(15,23,42,.8);flex-shrink:0}
#bm-rec div{text-align:center;padding:9px 0}#bm-rec span{display:block;font:700 13px Rajdhani;color:#fbbf24}#bm-rec b{font:900 clamp(17px,1.25vw,24px) Orbitron;color:#fde68a}
#bm-eq .h{display:flex;justify-content:space-between;font:800 13px Orbitron;letter-spacing:.1em;color:#94a3b8;margin-bottom:7px}
#bm-eq .h kbd{font:800 10px Orbitron;padding:2px 7px;border-radius:5px;background:#e2e8f0;color:#0f172a}
#bm-eq .row{display:flex;gap:9px}
#bm-eq .e{flex:1;min-width:0;border-radius:12px;border:1px solid #334155;background:rgba(15,23,42,.85);padding:8px 6px;display:flex;flex-direction:column;align-items:center;gap:5px;font:800 11px Orbitron;color:#94a3b8;letter-spacing:.06em;cursor:pointer}
#bm-eq .e:hover,#bm-eq .e:focus{border-color:#22d3ee;color:#fff;outline:none}
#bm-eq .sp{width:62px;height:52px;border-radius:8px;background:#be123c;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font:900 22px Orbitron;line-height:1}
#bm-eq .sp small{font:800 8px Orbitron;letter-spacing:.2em;color:#fecdd3}
#bm-eq .v{height:52px;display:flex;align-items:center;justify-content:center;text-align:center;font:800 12px Rajdhani;color:#e2e8f0;line-height:1.15;padding:0 2px;overflow:hidden;width:100%}
#bm-eq .v.fx{color:#f472b6;font:800 10.5px Orbitron;letter-spacing:.02em}
html.bm-novo #btn-start{font-size:22px!important;padding:14px 0!important}
html.bm-novo #lib-tabs [data-lib-tab]{transform:skewX(-12deg);border-radius:4px!important;font-size:13px!important;padding:6px 14px!important}
html.bm-novo #lib-tabs [data-lib-tab] > *{display:inline-block}
html.bm-novo #lib-keys-hint{display:none!important}
html.bm-novo #lib-toolbar{border-bottom:0!important;padding-right:clamp(16px,3vw,60px)!important}
html.bm-novo #pattern-grid{padding-right:clamp(16px,3vw,60px)!important}

/* ---------- janela Equipamento ---------- */
#bm-equip{position:fixed;inset:0;z-index:140;background:rgba(2,6,23,.78);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;color:#e2e8f0}
#bm-equip.on{display:flex}
#bm-equip .mb{width:min(1180px,96vw);max-height:92vh;display:flex;flex-direction:column;border-radius:18px;background:linear-gradient(180deg,#111a2e,#0b1222);border:1px solid #334155;box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden}
#bm-equip .mh{display:flex;align-items:center;padding:16px 26px;background:linear-gradient(90deg,#0e7490,#6d28d9);font:900 24px Orbitron;letter-spacing:.1em;color:#fff}
#bm-equip .mh button{margin-left:auto;font:800 13px Orbitron;color:#fff;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.4);border-radius:8px;padding:6px 12px;cursor:pointer}
#bm-equip .mt{display:flex;gap:4px;padding:12px 26px 0}
#bm-equip .mt button{padding:9px 24px;border-radius:10px 10px 0 0;font:900 15px Orbitron;color:#64748b;background:#0f172a;border:0;cursor:pointer}
#bm-equip .mt button.on{color:#fff;background:#1e293b;box-shadow:inset 0 3px 0 #22d3ee}
#bm-equip .pane{display:none;flex-direction:column;gap:14px;padding:20px 26px 24px;background:#1e293b;overflow-y:auto}
#bm-equip .pane.on{display:flex}
#bm-equip .pane > div{background:#0f172a;border:1px solid #334155;border-radius:12px;padding:12px 16px}
#bm-equip .pane > .grid{display:grid!important;grid-template-columns:1fr 1fr;gap:12px 22px}
#bm-equip label{font:800 13px Rajdhani!important;letter-spacing:.06em;color:#cbd5e1!important;text-transform:uppercase}
#bm-equip select{font:800 15px Rajdhani!important;padding:8px 10px!important;background:#020617!important;border:1px solid #475569!important;border-radius:8px!important;color:#fde68a!important;width:100%}
#bm-equip select:focus,#bm-equip input:focus,#bm-equip button:focus,#bm-equip select.gp-focus{outline:none;border-color:#fbbf24!important;box-shadow:0 0 12px rgba(251,191,36,.35)}
#bm-equip input[type=range]{width:100%;height:8px}
#bm-equip #speed-val{font:900 18px Orbitron;color:#fde68a}
#bm-equip .mf{display:flex;gap:28px;padding:11px 26px;background:#0b1222;font:700 14px Rajdhani;color:#94a3b8;flex-wrap:wrap}
#bm-equip .mf kbd{font:800 11px Orbitron;padding:2px 7px;border-radius:5px;background:#e2e8f0;color:#0f172a;margin-right:6px}
#bm-equip .extra{display:flex;gap:10px;flex-wrap:wrap}
#bm-equip .extra button{padding:9px 16px;border-radius:10px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font:700 15px Rajdhani;cursor:pointer}
#bm-equip .extra button:hover{border-color:#22d3ee}
@media (max-height:900px){html.bm-novo #preview-desc{display:none}#bm-eq .sp,#bm-eq .v{height:42px}#bm-eq .sp{font-size:19px}#bm-rec div{padding:6px 0}html.bm-novo #btn-start{padding:10px 0!important;font-size:19px!important}html.bm-novo .bm-left{gap:9px!important}}
@media (max-height:780px){html.bm-novo #chart-preview-wrap{display:none!important}}
@media (max-width:1100px){#bm-hub .arya,#bm-hub .say{display:none}#bm-hub .center{right:0}}`;
    document.head.appendChild(css);

    // =====================================================================================
    // MENU INICIAL
    // =====================================================================================
    let hub = null, sel = { row: 0, i: 2 }, items = [[], []];
    function buildHub() {
        const ov = $('menu-overlay');
        if (!ov || hub) return;
        hub = document.createElement('div');
        hub.id = 'bm-hub';
        const tiles = TILES.map((t, i) => t.sep ? '<div class="sep"></div>' : `<div class="t${t.off ? ' off' : ''}" data-ti="${i}" tabindex="-1" role="button">${icon(t.k)}${t.t}<span class="dot"></span>${t.sub ? `<small>${t.sub}</small>` : ''}</div>`).join('');
        const foot = FOOT.map((f, i) => `<div class="mini" data-fi="${i}" tabindex="-1" role="button">${icon(f.k)}${f.t}<span class="dot"></span></div>`).join('');
        hub.innerHTML = `<div class="bg"></div><div class="grid"></div><button class="ver" id="bm-ver" type="button" title="Versão e atualizações"></button><button class="updchip" id="bm-upd" type="button"></button>
            <div class="tiles">${tiles}</div>
            <div class="center"><div class="logo"><div class="big">BEATMAX</div><div class="sub">TRAINING</div>
              <div class="card"><div class="k" id="bm-ck"></div><div class="n" id="bm-cn"></div><div class="d" id="bm-cd"></div></div></div></div>
            <img class="arya" src="assets/arya-oi.webp" alt="" draggable="false"><div class="say" id="bm-say"></div>
            <div class="foot">
              <div class="wallet" id="bm-wallet"><div class="l">BEATCOINS</div><div class="v"><span class="coin"></span><span id="bm-coins">0</span></div>
                <div class="l" style="margin-top:4px">NÍVEL</div><div class="v lv"><span id="bm-lv">Lv 1</span><span class="wbar"><i id="bm-lvbar"></i></span></div></div>
              <div class="play" data-play tabindex="-1" role="button"><span class="c"><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg></span>JOGAR</div>
              <div class="vsep"></div>${foot}
              ${isWeb ? '' : `<div class="quit" data-quit tabindex="-1" role="button">SAIR<span class="c">${icon('sair')}</span></div>`}
            </div>
            <div class="bm-hint"><span><kbd>← → ↑ ↓</kbd>SELECIONAR</span><span><kbd>1-8</kbd>ATALHOS</span><div class="r"><span><kbd>ENTER</kbd>OK</span>${isWeb ? '' : '<span><kbd>ESC</kbd>SAIR</span>'}</div></div>`;
        ov.parentElement.insertBefore(hub, ov.nextSibling);
        items[0] = [...hub.querySelectorAll('.t')];
        items[1] = [hub.querySelector('[data-play]'), ...hub.querySelectorAll('.mini'), hub.querySelector('[data-quit]')].filter(Boolean);
        items.flat().forEach(el => {
            el.addEventListener('mouseenter', () => focusItem(el));
            el.addEventListener('focus', () => focusItem(el, true));
            el.addEventListener('click', () => { focusItem(el); activate(el); });
        });
        $('bm-wallet').addEventListener('click', () => window.openNivel && window.openNivel());
        $('bm-ver').addEventListener('click', (e) => { e.stopPropagation(); abrirAtualizacoes(e.currentTarget); });
        $('bm-upd').addEventListener('click', (e) => { e.stopPropagation(); if (typeof updApply === 'function') updApply(); setTimeout(updRefresh, 50); });
        focusItem(items[0][TILES.filter(t => !t.sep).findIndex(t => t.k === 'treinos')]);
    }
    function focusItem(el, fromFocus) {
        const r = items[0].includes(el) ? 0 : 1;
        sel = { row: r, i: items[r].indexOf(el) };
        items.flat().forEach(x => x.classList.toggle('on', x === el));
        if (!fromFocus) { try { el.focus({ preventScroll: true }); } catch (e) {} }
        // cartão do meio
        let k = '', n = '', d = '';
        if (r === 0) { const t = TILES[+el.dataset.ti]; k = t.t; n = { treinos: 'Treinos e Músicas', osu: 'Músicas do osu!', loja: 'Loja BEATMAX', desafios: 'Desafios', nuvem: 'Nuvem', editor: 'Editor de charts', analise: 'Análise', ranking: 'Ranking' }[t.k] || t.t; d = t.d; }
        else if (el.dataset.play != null) { k = 'JOGAR'; n = 'Treinos e Músicas'; d = 'Ir direto pra seleção de música.'; }
        else if (el.dataset.quit != null) { k = 'SAIR'; n = 'Fechar o jogo'; d = 'Até a próxima!'; }
        else { const f = FOOT[+el.dataset.fi]; k = f.t; n = { perfil: 'Trocar de jogador', nivel: 'Nível e recompensas', skins: 'Personalizar skins', novidades: 'Novidades', config: 'Configurações', backup: 'Backup dos dados' }[f.k]; d = { perfil: 'Cada perfil tem os próprios recordes e configurações.', nivel: 'Seu Lv, títulos, molduras e como ganhar EXP.', skins: 'Crie gears e notas do seu jeito.', novidades: 'O que mudou nas últimas versões.', config: 'Sincronia, controles, gráficos e áudio.', backup: 'Guardar ou restaurar tudo num arquivo.' }[f.k]; }
        $('bm-ck').textContent = k; $('bm-cn').textContent = n; $('bm-cd').textContent = d;
    }
    function activate(el) {
        if (!el || el.classList.contains('off')) return;
        if (el.dataset.ti != null) { const t = TILES[+el.dataset.ti]; if (t.k !== 'treinos') hubSom(); t.go(); return; }
        if (el.dataset.fi != null) { FOOT[+el.dataset.fi].go(); return; }
        if (el.dataset.play != null) { abrirSelecao(); return; }
        if (el.dataset.quit != null) { click('btn-sair'); }
    }
    function hubSom() {}
    function refreshHub() {
        if (!hub) return;
        try { $('bm-coins').textContent = typeof window.beatcoinsSaldo === 'function' ? window.beatcoinsSaldo() : '0'; } catch (e) {}
        try {
            const n = window.nivelInfo ? window.nivelInfo() : null;
            if (n) {
                const li = window.nivelCalc ? window.nivelCalc.levelInfo(n.exp) : { pct: 0 };
                $('bm-lv').textContent = `Lv ${n.lv}`; $('bm-lvbar').style.width = (li.pct * 100).toFixed(1) + '%';
            }
        } catch (e) {}
        TILES.forEach((t, i) => { const el = hub.querySelector(`[data-ti="${i}"]`); if (el) el.classList.toggle('has-dot', !!(t.dot && t.dot())); });
        FOOT.forEach((f, i) => { const el = hub.querySelector(`[data-fi="${i}"]`); if (el) el.classList.toggle('has-dot', !!(f.dot && f.dot())); });
        updRefresh();
    }
    // ---------- atualizações (o selo do topo antigo sumiu junto com o cabeçalho) ----------
    function upd() { try { return typeof updState !== 'undefined' ? updState : null; } catch (e) { return null; } }
    function updBusyNow() { try { return typeof updBusy !== 'undefined' && updBusy; } catch (e) { return false; } }
    function updRefresh() {
        const u = upd();
        const vt = ($('app-version-text') || {}).textContent || '';
        const cur = u && u.current ? 'v' + u.current : (vt.match(/v[\d.]+/) || [''])[0];
        const novo = !!(u && u.available);
        const vb = $('bm-ver'); if (vb) vb.textContent = isWeb ? vt : (cur ? `${cur} · atualizações` : 'atualizações');
        const ch = $('bm-upd');
        if (ch) {
            ch.classList.toggle('on', novo && !isWeb);
            ch.innerHTML = updBusyNow() ? `⏳ Atualizando para a v${esc(u.latest)}…` : novo ? `🆕 Versão <b>v${esc(u.latest)}</b> disponível <b>ATUALIZAR</b>` : '';
        }
        const tb = $('bm-top-ver');
        if (tb) { tb.textContent = novo ? `🆕 v${u.latest}` : (cur || ''); tb.classList.toggle('novo', novo); tb.style.display = isWeb ? 'none' : ''; }
    }
    function abrirAtualizacoes(anchor) {
        if (isWeb) { window.openNovidades && window.openNovidades(); return; }
        if (typeof updPanelEnsure !== 'function') return;
        const pn = updPanelEnsure();
        const r = (anchor || $('bm-ver')).getBoundingClientRect();
        pn.style.left = Math.max(8, Math.min(window.innerWidth - 330, r.right - 320)) + 'px';
        pn.style.top = (r.bottom + 8) + 'px';
        pn.classList.remove('hidden');
        try { updPanelUI(); } catch (e) {}
        if (typeof updCheck === 'function') updCheck(true).then(updRefresh);
    }
    window.bmAbrirAtualizacoes = abrirAtualizacoes;
    function hubSay() {
        const nm = (window.perfis && window.perfis.active && window.perfis.active.name) || '';
        const n = window.nivelInfo ? window.nivelInfo() : { lv: 1 };
        const lines = desafioFeito()
            ? [`Oi${nm ? ', <b>' + esc(nm) + '</b>' : ''}! Desafio de hoje já foi. Que tal subir uns níveis?`, `Você está no <b>Lv ${n.lv}</b>. Bora treinar mais um pouco?`, 'Escolhe um treino e vamos nessa!']
            : [`Bem-vindo de volta${nm ? ', <b>' + esc(nm) + '</b>' : ''}! O desafio de hoje ainda está <b>pendente</b>.`, 'Tem desafio do dia esperando por você! Aperta <b>Desafios</b>.', `Bora treinar? Você está no <b>Lv ${n.lv}</b>!`];
        $('bm-say').innerHTML = `<span class="nm">ARYA</span>${fala('arya-hub', lines)}`;
    }
    function hubOn() { return !!(hub && hub.classList.contains('on')); }
    window.bmHubAtivo = () => hubOn() && !document.querySelector('#col-ov, #rk-ov, #bc-ov, #lv-ov, #perfil-ov, #nov-ov, #sair-ov, #bm-equip.on');
    function abrirHub() {
        buildHub(); if (!hub) return;
        if (typeof isPlaying !== 'undefined' && isPlaying) return;
        fecharEquip();
        hub.classList.add('on');
        refreshHub(); hubSay();
        const el = items[sel.row][sel.i] || items[0][2];
        focusItem(el);
    }
    function fecharHub() { if (hub) hub.classList.remove('on'); try { document.activeElement && document.activeElement.blur(); } catch (e) {} }
    function abrirSelecao() {
        fecharHub();
        const ov = $('menu-overlay');
        if (ov && ov.classList.contains('hidden')) { ov.classList.remove('hidden'); }
        refreshSel();
    }
    window.bmAbrirMenu = abrirHub;
    window.bmAbrirSelecao = abrirSelecao;

    // teclado do menu
    const OTHER = '#col-ov, #rk-ov, #bc-ov, #lv-ov, #lv-up, #bc-cele, #perfil-ov, #nov-ov, #sair-ov, #calt-ov, #bm-equip.on';
    function outraJanela() {
        if (document.querySelector(OTHER)) return true;
        // janelas que vivem dentro do jogo (Configurações, osu!, Backup...) ficam por cima do menu
        return ['settings-modal', 'osu-modal', 'backup-modal', 'history-modal', 'nuvem-modal', 'skin-modal', 'chart-editor-modal', 'stats-overlay', 'pause-modal'].some(id => {
            const e = $(id); if (!e) return false;
            if (e.classList.contains('hidden')) return false;
            const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden';
        });
    }
    window.addEventListener('keydown', (e) => {
        if (!hubOn() || outraJanela()) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const k = e.key;
        const nav = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
        if (nav[k]) {
            e.preventDefault(); e.stopImmediatePropagation();
            const [dr, di] = nav[k];
            if (dr) {
                const nr = Math.max(0, Math.min(1, sel.row + dr));
                if (nr !== sel.row) {
                    const cur = items[sel.row][sel.i].getBoundingClientRect(), cx = cur.left + cur.width / 2;
                    let best = items[nr][0], bd = Infinity;
                    items[nr].forEach(x => { const r = x.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - cx); if (d < bd && !x.classList.contains('off')) { bd = d; best = x; } });
                    focusItem(best);
                }
            } else {
                let i = sel.i;
                do { i = Math.max(0, Math.min(items[sel.row].length - 1, i + di)); } while (items[sel.row][i].classList.contains('off') && i > 0 && i < items[sel.row].length - 1);
                if (!items[sel.row][i].classList.contains('off')) focusItem(items[sel.row][i]);
            }
            return;
        }
        if ((k === 'Enter' || k === ' ' || e.code === 'NumpadEnter') && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); activate(items[sel.row][sel.i]); return; }
        if (/^[1-8]$/.test(k)) { e.preventDefault(); e.stopImmediatePropagation(); const el = items[0][+k - 1]; if (el) { focusItem(el); activate(el); } return; }
        if (k === 'Escape') {
            e.preventDefault(); e.stopImmediatePropagation();
            if (!isWeb && !e.repeat) { focusItem(items[1][items[1].length - 1]); click('btn-sair'); }
            return;
        }
        // teclas de jogo/lista não passam pro que está atrás do menu
        if (k.length === 1 || /^(Page|Home|End|Tab|F5|F8)/.test(k)) { e.stopImmediatePropagation(); if (k === 'Tab') e.preventDefault(); }
    }, true);

    // =====================================================================================
    // SELEÇÃO DE MÚSICA
    // =====================================================================================
    let built = false;
    function buildSel() {
        const ov = $('menu-overlay'); const card = $('song-preview-card');
        if (built || !ov || !card) return;
        built = true;
        const left = card.parentElement;
        left.classList.add('bm-left');
        const oldTop = ov.firstElementChild; oldTop.classList.add('bm-oldtop');
        // barra de cima
        const top = document.createElement('div');
        top.id = 'bm-top';
        top.innerHTML = `<button class="back" id="bm-back" type="button"><kbd>ESC</kbd>MENU</button><div class="ttl">TREINOS</div>
            <button class="verb" id="bm-top-ver" type="button" title="Versão e atualizações"></button>
            <div class="me" id="bm-me" title="Nível e recompensas"><span class="av" id="bm-av">J</span><div><div class="n" id="bm-nm"></div><div class="s" id="bm-tt"></div></div><span class="coins"><span class="coin"></span><span id="bm-mc">0</span></span></div>
            <button class="ico" id="bm-rank" type="button" title="Ranking desta música">${icon('ranking')}</button>
            <button class="ico" id="bm-loja" type="button" title="Loja">${icon('loja')}</button>
            <button class="ico" id="bm-cfg" type="button" title="Configurações">${icon('config')}</button>`;
        ov.insertBefore(top, oldTop);
        $('bm-back').onclick = () => abrirHub();
        $('bm-me').onclick = () => window.openNivel && window.openNivel();
        $('bm-top-ver').onclick = (e) => abrirAtualizacoes(e.currentTarget);
        $('bm-rank').onclick = () => window.openRanking && window.openRanking({ aba: 'musica' });
        $('bm-loja').onclick = () => window.openLojaBeatmax && window.openLojaBeatmax();
        $('bm-cfg').onclick = () => click('btn-settings');
        // modos 4B/5B/6B/8B no topo da esquerda
        const modes = document.querySelector('.mode-btn')?.parentElement;
        if (modes) { modes.id = 'bm-modes'; modes.className = ''; left.insertBefore(modes, left.firstChild); }
        // dificuldade
        $('diff-pills')?.parentElement?.classList.add('bm-diffbox');
        // recorde
        const rec = document.createElement('div'); rec.id = 'bm-rec';
        rec.innerHTML = '<div><span>RECORDE</span><b id="bm-r1">—</b></div><div><span>NOTA</span><b id="bm-r2">—</b></div><div><span>JOGADAS</span><b id="bm-r3">0</b></div>';
        // equipamento
        const eq = document.createElement('div'); eq.id = 'bm-eq';
        eq.innerHTML = `<div class="h"><span>EQUIPAMENTO</span><span><kbd>SPACE</kbd> editar</span></div>
            <div class="row"><div class="e" tabindex="0" data-tab="fx"><span class="sp" title="Roda do mouse aqui (ou teclas 1 e 2) muda a velocidade"><small>SPEED</small><span id="bm-eq-sp">3.0</span></span>SPEED</div>
            <div class="e" tabindex="0" data-tab="vis"><span class="v" id="bm-eq-gear">—</span>GEAR</div>
            <div class="e" tabindex="0" data-tab="vis"><span class="v" id="bm-eq-note">—</span>NOTA</div>
            <div class="e" tabindex="0" data-tab="fx"><span class="v fx" id="bm-eq-fx">—</span>EFEITOS</div></div>`;
        const start = $('btn-start');
        const db = $('diff-pills')?.parentElement;
        if (db && db.parentElement === left) { db.after(rec); rec.after(eq); } else { left.insertBefore(rec, start); left.insertBefore(eq, start); }
        eq.querySelectorAll('.e').forEach(b => { b.onclick = () => abrirEquip(b.dataset.tab); b.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); abrirEquip(b.dataset.tab); } }; });
        if (start) start.innerHTML = '▶ JOGAR';
        // dica embaixo
        const hint = document.createElement('div'); hint.className = 'bm-hint'; hint.id = 'bm-sel-hint';
        hint.innerHTML = '<span><kbd>↑↓</kbd>MÚSICA</span><span><kbd>←→</kbd>DIFICULDADE</span><span><kbd>TAB</kbd>MODO 4B/5B/6B/8B</span><div class="r"><span><kbd>F</kbd>FAVORITAR</span><span><kbd>SPACE</kbd>EQUIPAMENTO</span><span><kbd>ENTER</kbd>JOGAR</span><span><kbd>ESC</kbd>MENU</span></div>';
        ov.appendChild(hint);
        buildEquip(left);
        refreshSel();
    }
    function optText(id) { const s = $(id); return s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].text.replace(/\s*\(.*?\)\s*/g, ' ').replace(' ★', '').trim() : '—'; }
    function refreshSel() {
        if (!built) return;
        try { updRefresh(); } catch (e) {}
        try {
            const p = (window.perfis && window.perfis.active) || { name: 'Jogador', color: '#22d3ee' };
            $('bm-av').textContent = (p.name || '?').trim().charAt(0).toUpperCase(); $('bm-av').style.setProperty('--pc', p.color);
            $('bm-nm').textContent = p.name;
            const n = window.nivelInfo ? window.nivelInfo() : null;
            $('bm-tt').textContent = n ? `Lv ${n.lv} · ${n.title}` : '';
            $('bm-mc').textContent = typeof window.beatcoinsSaldo === 'function' ? window.beatcoinsSaldo() : '0';
        } catch (e) {}
        try {
            const ttl = document.querySelector('#bm-top .ttl');
            const tab = (typeof libCfg !== 'undefined' && libCfg.tab) || 'all';
            ttl.textContent = { osu: 'MÚSICAS osu!', custom: 'MEUS CHARTS', fav: 'FAVORITAS', drill: 'TREINOS', played: 'JOGADOS' }[tab] || 'TREINOS';
        } catch (e) {}
        $('bm-eq-sp').textContent = ($('speed-val') || {}).textContent || '';
        $('bm-eq-gear').textContent = optText('main-gear-skin');
        $('bm-eq-note').textContent = optText('main-note-shape');
        const fx = [];
        [['mod-random', 'none'], ['mod-cover', 'none'], ['mod-speed', 'none'], ['mod-fader', 'none']].forEach(([id]) => { const s = $(id); if (s && s.selectedIndex > 0) fx.push(optText(id).split(' ')[0] === 'HALF' ? 'H.RANDOM' : optText(id).replace(/\s*\(.*$/, '').split(' + ')[0]); });
        const r = $('game-rate'); if (r && r.value && Math.abs(parseFloat(r.value) - 1) > 0.001) fx.push(Math.round(parseFloat(r.value) * 100) + '%');
        $('bm-eq-fx').innerHTML = fx.length ? fx.slice(0, 3).map(esc).join('<br>') + (fx.length > 3 ? ' +' + (fx.length - 3) : '') : '<span style="color:#64748b">NENHUM</span>';
        // recorde da música selecionada
        try {
            const pl = typeof libPlays === 'function' && typeof currentPatternType !== 'undefined' ? libPlays(currentPatternType) : null;
            const best = pl && pl.best || 0;
            $('bm-r1').textContent = best ? best.toFixed(2).replace('.', ',') + '%' : '—';
            $('bm-r2').textContent = best ? (best >= 100 ? 'P' : best >= 97 ? 'S' : best >= 90 ? 'A' : best >= 80 ? 'B' : 'C') : '—';
            $('bm-r3').textContent = pl ? pl.n : 0;
        } catch (e) {}
    }
    // speed: o número na tela acompanha na hora (teclas 1/2, botões, roda do mouse)
    if (typeof window.updateSpeedDisplay === 'function') {
        const oUSD = window.updateSpeedDisplay;
        window.updateSpeedDisplay = function () { const r = oUSD.apply(this, arguments); try { const el = $('bm-eq-sp'); if (el) el.textContent = scrollSpeed.toFixed(1); } catch (e) {} return r; };
    }
    // roda do mouse em cima do SPEED (seleção) ou da velocidade no Equipamento: ±0.1 (Shift: ±0.5)
    let spdSave = 0;
    document.addEventListener('wheel', (e) => {
        const t = e.target && e.target.closest && e.target.closest('#bm-eq-sp, .e[data-tab="fx"], #speed-slider, #bm-equip .sp');
        if (!t || (typeof isPlaying !== 'undefined' && isPlaying)) return;
        e.preventDefault();
        const d = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.5 : 0.1);
        if (typeof changeSpeed === 'function') changeSpeed(d);
        clearTimeout(spdSave); spdSave = setTimeout(() => { if (typeof saveSettings === 'function') saveSettings(); }, 400);
    }, { passive: false, capture: true });
    document.addEventListener('change', () => setTimeout(refreshSel, 0), true);
    document.addEventListener('input', (e) => { if (e.target && e.target.id === 'speed-slider') setTimeout(refreshSel, 0); }, true);
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.pattern-card, .diff-pill, .mode-btn, [data-lib-tab]')) setTimeout(refreshSel, 30); }, true);

    // teclado na seleção: Esc = menu · Space = equipamento · Tab = modo
    window.addEventListener('keydown', (e) => {
        if (hubOn()) return;
        if (equipOn()) {
            if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); fecharEquip(); return; }
            if (/^Arrow/.test(e.key)) {
                e.preventDefault(); e.stopImmediatePropagation();
                const els = [...eqEl.querySelectorAll('.pane.on select, .pane.on input[type=range], .pane.on input[type=checkbox], .pane.on button')].filter(x => x.offsetParent);
                let a = document.activeElement; if (!els.includes(a)) { a = null; }
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    if (!a) { els[0] && els[0].focus(); return; }
                    // vai pro mais perto em cima/embaixo
                    const ra = a.getBoundingClientRect(), dir = e.key === 'ArrowDown' ? 1 : -1;
                    let best = null, bs = Infinity;
                    els.forEach(x => { if (x === a) return; const r = x.getBoundingClientRect(); const dy = (r.top - ra.top) * dir; if (dy <= 4) return; const sc = dy + Math.abs(r.left - ra.left) * 0.6; if (sc < bs) { bs = sc; best = x; } });
                    if (best) best.focus();
                    return;
                }
                const dir = e.key === 'ArrowRight' ? 1 : -1;
                if (!a) { els[0] && els[0].focus(); return; }
                if (a.tagName === 'SELECT') {
                    const i = Math.max(0, Math.min(a.options.length - 1, a.selectedIndex + dir));
                    if (i !== a.selectedIndex) { a.selectedIndex = i; a.dispatchEvent(new Event('change', { bubbles: true })); }
                } else if (a.type === 'range') {
                    const st = +a.step || 1; a.value = String(Math.max(+a.min, Math.min(+a.max, +a.value + dir * st)));
                    a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    // lado a lado (ex.: Random | Lane Cover): anda pro vizinho
                    const ra = a.getBoundingClientRect();
                    const side = els.filter(x => x !== a && Math.abs(x.getBoundingClientRect().top - ra.top) < 20 && (x.getBoundingClientRect().left - ra.left) * dir > 0);
                    side[0] && side[0].focus();
                }
                return;
            }
            if (e.key === 'Enter' && document.activeElement && document.activeElement.tagName === 'SELECT') { e.preventDefault(); e.stopImmediatePropagation(); return; }
            if (e.key === 'Backspace' && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) { e.preventDefault(); e.stopImmediatePropagation(); tudoOff(); return; }
            if (e.key === 'Shift' && !e.repeat) { e.preventDefault(); proxAba(e.location === 1 ? -1 : 1); return; }
            return;
        }
        if (!(typeof window.menuListaAtiva === 'function' && window.menuListaAtiva())) return;
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'Escape' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); abrirHub(); return; }
        if (e.key === ' ' && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); abrirEquip(); return; }
        if (e.key === 'Tab' && !e.altKey && !e.ctrlKey) {
            e.preventDefault(); e.stopImmediatePropagation();
            const btns = [...document.querySelectorAll('#bm-modes .mode-btn')];
            const i = btns.findIndex(b => b.classList.contains('active-mode'));
            const j = (i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length;
            btns[j] && btns[j].click();
        }
    }, true);

    // =====================================================================================
    // EQUIPAMENTO
    // =====================================================================================
    let eqEl = null, eqTab = 'fx';
    function buildEquip(left) {
        eqEl = document.createElement('div');
        eqEl.id = 'bm-equip';
        eqEl.innerHTML = `<div class="mb"><div class="mh">EQUIPAMENTO<button type="button" data-x>SPACE · FECHAR</button></div>
            <div class="mt"><button data-t="fx" class="on">EFEITOS</button><button data-t="vis">VISUAL</button><button data-t="mus">MÚSICA</button></div>
            <div class="pane on" data-p="fx"></div><div class="pane" data-p="vis"></div><div class="pane" data-p="mus"></div>
            <div class="mf"><span><kbd>↑↓</kbd>SELECIONAR</span><span><kbd>←→</kbd>ALTERAR</span><span><kbd>SHIFT</kbd>ABA</span><span><kbd>BACKSPACE</kbd>EFEITOS OFF</span><span style="margin-left:auto"><kbd>SPACE</kbd>FECHAR</span></div></div>`;
        document.body.appendChild(eqEl);
        const pane = (p) => eqEl.querySelector(`[data-p="${p}"]`);
        const kids = [...left.children];
        const has = (el, id) => el.id === id || !!el.querySelector('#' + id);
        kids.forEach(el => {
            if (el.id === 'song-preview-card' || el.id === 'bm-modes' || el.id === 'bm-rec' || el.id === 'bm-eq' || el.id === 'btn-start' || el.classList.contains('bm-diffbox') || el.classList.contains('flex-1') || el.classList.contains('hidden')) return;
            if (has(el, 'speed-slider') || has(el, 'mod-random') || has(el, 'mod-speed') || has(el, 'mod-sv')) pane('fx').appendChild(el);
            else if (has(el, 'main-note-shape') || has(el, 'main-gear-skin')) pane('vis').appendChild(el);
            else if (has(el, 'game-rate')) pane('mus').appendChild(el);
            else pane('fx').appendChild(el);
        });
        // atalhos extras no Visual
        const ex = document.createElement('div'); ex.className = 'extra';
        ex.innerHTML = '<button type="button" data-a="skin">🎨 Personalizar (gear, nota, efeitos)…</button><button type="button" data-a="loja">🛒 Loja (gears e notas exclusivas)</button>';
        pane('vis').appendChild(ex);
        ex.querySelector('[data-a="skin"]').onclick = () => { fecharEquip(); window.openColecao ? window.openColecao() : click('btn-skin'); };
        ex.querySelector('[data-a="loja"]').onclick = () => { fecharEquip(); window.openLojaBeatmax && window.openLojaBeatmax(); };
        eqEl.querySelectorAll('.mt button').forEach(b => b.onclick = () => aba(b.dataset.t));
        eqEl.querySelector('[data-x]').onclick = fecharEquip;
        eqEl.addEventListener('mousedown', (e) => { if (e.target === eqEl) fecharEquip(); });
    }
    function aba(t) {
        eqTab = t;
        eqEl.querySelectorAll('.mt button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
        eqEl.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.p === t));
        const f = eqEl.querySelector(`.pane[data-p="${t}"] select, .pane[data-p="${t}"] input`);
        if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
    }
    function proxAba(d) { const order = ['fx', 'vis', 'mus']; aba(order[(order.indexOf(eqTab) + d + 3) % 3]); }
    function equipOn() { return !!(eqEl && eqEl.classList.contains('on')); }
    function abrirEquip(t) { if (!eqEl) return; eqEl.classList.add('on'); aba(t || eqTab); }
    function fecharEquip() { if (!eqEl || !eqEl.classList.contains('on')) return; eqEl.classList.remove('on'); try { document.activeElement && document.activeElement.blur(); } catch (e) {} refreshSel(); }
    function tudoOff() {
        ['mod-random', 'mod-cover', 'mod-speed', 'mod-fader'].forEach(id => { const s = $(id); if (s && s.selectedIndex !== 0) { s.selectedIndex = 0; s.dispatchEvent(new Event('change', { bubbles: true })); } });
        refreshSel();
    }
    window.bmAbrirEquipamento = abrirEquip;

    // =====================================================================================
    // ligações com o resto do jogo
    // =====================================================================================
    function init() {
        buildSel(); buildHub();
        // começou a jogar (por qualquer caminho): o menu some
        $('btn-start')?.addEventListener('click', () => { fecharHub(); fecharEquip(); }, true);
        setInterval(() => {
            if (typeof isPlaying !== 'undefined' && isPlaying) { if (hubOn()) fecharHub(); if (equipOn()) fecharEquip(); return; } // jogando: não mexe no menu escondido
            if (document.hidden) return;
            if (hubOn()) refreshHub();
            else if (built && !$('menu-overlay')?.classList.contains('hidden')) refreshSel();
        }, 1000);
        abrirHub();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
})();
