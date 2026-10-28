// =====================================================================================
// personagens.js — as personagens do BEATMAX ao lado das janelas.
//
//   Arya  : Novidades (novidades.js) e Desafios (acenando)
//   Iris  : Loja BEATMAX
//   Echo  : painel de Nível e Ranking
//   Jade  : Personalizar
//
// beatmaxPersonagem(overlay, { img, flip, say, key }) põe a personagem à esquerda da janela
// (.bx) com um balão de fala. Só aparece em telas largas (no celular/Xbox pequeno some).
// =====================================================================================
(function () {
    const css = document.createElement('style');
    css.textContent = `
.bm-ch-wrap{display:none}
@media (min-width:1240px) and (min-height:600px){
  .bm-ch .bm-ch-wrap{display:block;position:relative;align-self:flex-end;height:min(92vh,800px,48vw);margin-right:min(-50px,-4.7vw);flex-shrink:0;z-index:2;pointer-events:none}
  .bm-ch .bm-ch-wrap img{height:100%;width:auto;display:block;filter:drop-shadow(0 10px 30px rgba(0,0,0,.6)) drop-shadow(0 0 22px var(--bm-glow,rgba(34,211,238,.25)));animation:bmChIn .5s cubic-bezier(.2,1.2,.4,1) both}
  .bm-ch .bm-ch-wrap.flip img{transform:scaleX(-1);animation-name:bmChInF}
  .bm-ch.bm-ch-still .bm-ch-wrap img,.bm-ch.bm-ch-still .bm-ch-say{animation:none}
  .bm-ch > .bx{position:relative;z-index:1;padding-left:clamp(56px,5vw,96px) !important;width:min(var(--bm-bxw,980px),calc(97vw - min(470px,30vw))) !important;max-height:94vh}
  .bm-ch .bm-ch-say{position:absolute;bottom:calc(100% + 12px);left:var(--bm-say-left,8%);z-index:3;width:max-content;max-width:250px;padding:10px 14px;border-radius:14px;background:rgba(15,23,42,.95);border:1.5px solid var(--bm-say,#22d3ee);color:#f1f5f9;font:700 14.5px/1.3 Rajdhani,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 16px var(--bm-glow,rgba(34,211,238,.25));animation:bmSay .45s .35s cubic-bezier(.2,1.4,.4,1) both}
  .bm-ch .bm-ch-say b{color:var(--bm-say,#22d3ee)}
  .bm-ch .bm-ch-say:before{content:'';position:absolute;left:var(--bm-say-tail,60%);bottom:-9px;border:8px solid transparent;border-top-color:var(--bm-say,#22d3ee);border-bottom:0}
  .bm-ch .bm-ch-say.dentro{bottom:auto;top:1%;left:auto;right:calc(100% - 30px)}
  .bm-ch .bm-ch-say.dentro:before{left:auto;right:-9px;bottom:auto;top:18px;border:8px solid transparent;border-left-color:var(--bm-say,#22d3ee);border-right:0}
  .bm-ch .bm-ch-say .nm{display:block;font:900 11px Orbitron,monospace;letter-spacing:.12em;color:var(--bm-say,#22d3ee);margin-bottom:2px}
}
@keyframes bmChIn{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:none}}
@keyframes bmChInF{from{opacity:0;transform:scaleX(-1) translateX(40px)}to{opacity:1;transform:scaleX(-1)}}
@keyframes bmSay{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}`;
    document.head.appendChild(css);

    const CH = {
        // left = onde o balão começa (sobre a cabeça, à esquerda); tail = ponta do balão
        arya: { img: 'assets/arya-oi.webp', name: 'ARYA', color: '#22d3ee', glow: 'rgba(34,211,238,.28)', left: '12%', tail: '62%' },
        iris: { img: 'assets/iris.webp', name: 'IRIS', color: '#f472b6', glow: 'rgba(244,114,182,.3)', flip: true, left: '6%', tail: '66%' },
        echoRank: { img: 'assets/echo-rank.webp', name: 'ECHO', color: '#a78bfa', glow: 'rgba(167,139,250,.3)', left: '4%', tail: '55%' },
        jade: { img: 'assets/jade.webp', name: 'JADE', color: '#4ade80', glow: 'rgba(74,222,128,.3)', left: '10%', tail: '60%' },
        echo: { img: 'assets/echo.webp', name: 'ECHO', color: '#a78bfa', glow: 'rgba(167,139,250,.3)', left: '6%', tail: '55%' }
    };
    // uma fala sorteada (não repete a última da mesma lista)
    const lastPick = {};
    window.beatmaxFala = function (key, list) {
        list = (list || []).filter(Boolean);
        if (list.length < 2) return list[0] || '';
        let i; do { i = Math.floor(Math.random() * list.length); } while (i === lastPick[key]);
        lastPick[key] = i;
        return list[i];
    };
    window.beatmaxPersonagem = function (ov, who, say, bxw, still) {
        const c = CH[who];
        const bx = ov && ov.querySelector(':scope > .bx');
        if (!c || !bx) return;
        ov.classList.add('bm-ch');
        // a mesma janela redesenhada (ex.: comprou algo na Loja) não repete a animação de entrada
        if (still) ov.classList.add('bm-ch-still');
        ov.style.setProperty('--bm-say', c.color);
        ov.style.setProperty('--bm-glow', c.glow);
        ov.style.setProperty('--bm-say-left', c.left);
        ov.style.setProperty('--bm-say-tail', c.tail);
        if (bxw) ov.style.setProperty('--bm-bxw', bxw);
        const w = document.createElement('div');
        w.className = 'bm-ch-wrap' + (c.flip ? ' flip' : '');
        w.innerHTML = `<img src="${c.img}" alt="" draggable="false">${say ? `<div class="bm-ch-say"><span class="nm">${c.name}</span>${say}</div>` : ''}`;
        ov.insertBefore(w, bx);
        // o balão fica em cima da cabeça, do lado esquerdo (não cobre a janela). Em tela baixa,
        // sem espaço em cima, ele desce pro lado esquerdo da personagem.
        const sb = w.querySelector('.bm-ch-say');
        // sem espaço em cima → desce pro lado; e nunca sai da tela pela esquerda
        if (sb) setTimeout(() => { try {
            if (sb.getBoundingClientRect().top < 6) sb.classList.add('dentro');
            const r = sb.getBoundingClientRect();
            if (r.left < 8) sb.style.marginLeft = (8 - r.left) + 'px';
            const r2 = sb.getBoundingClientRect();
            if (r2.left < 8) { sb.classList.remove('dentro'); sb.style.marginLeft = ''; sb.style.left = '8px'; sb.style.right = 'auto'; sb.style.top = '1%'; sb.style.bottom = 'auto'; }
        } catch (e) {} }, 900);
    };
})();
