// =====================================================================================
// web.js — ajustes da VERSÃO WEB (site publicado, ex.: pra jogar no navegador do Xbox).
// Só faz alguma coisa quando o index.html foi gerado pelo instalador/gerar-web.py
// (ele liga window.BEATMAX_WEB). No PC, com o servidor local, não muda nada.
//
//  • Sem servidor local: some o botão Sair, a parte de atualizações (o site já abre sempre
//    na versão mais nova) e a busca do osu! (importar .osz continua funcionando).
//  • Pede pro navegador guardar os dados de forma "persistente" (não apagar sozinho).
//  • Palco 3D começa na qualidade Leve.
// =====================================================================================
(function () {
    if (!window.BEATMAX_WEB) return;
    document.documentElement.classList.add('beatmax-web');
    const css = document.createElement('style');
    css.textContent = `.beatmax-web #btn-sair,.beatmax-web #upd-panel,.beatmax-web #upd-status{display:none !important}
.beatmax-web #ingame-speed-hud button{min-width:30px;height:30px;font-size:14px}
.beatmax-web #btn-hud-pause{height:34px !important;padding:0 14px !important;font-size:14px !important}`;
    document.head.appendChild(css);

    // dados guardados de vez (no Xbox/celular o navegador pode limpar o que não é "persistente")
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}

    // atualizações: o site é sempre a versão mais nova — o selo mostra a versão e abre as Novidades
    window.updCheck = async function () { return null; };
    window.updApply = function () {};
    let ver = '';
    fetch('versao.json', { cache: 'no-store' }).then(r => r.json()).then(j => { ver = j.version || ''; badge(); }).catch(() => {});
    function badge() {
        const t = document.getElementById('app-version-text');
        if (t) t.textContent = ver ? `v${ver} · web` : 'versão web';
    }
    window.updBadgeUI = badge;
    badge();
    document.getElementById('app-version-badge')?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopImmediatePropagation();
        if (typeof openNovidades === 'function') openNovidades();
    }, true);
    // parte de atualizações nas Configurações: troca por um aviso
    (function settings() {
        const chk = document.getElementById('setting-auto-update');
        const box = chk && chk.closest('.flex.flex-col');
        if (!box) return;
        box.innerHTML = `<span class="text-xs font-bold text-slate-200">Versão web${ver ? ' v' + ver : ''}</span>
            <span class="text-[10px] text-slate-400">Este é o site do BEATMAX: ele sempre abre na versão mais nova, não precisa atualizar. Seus recordes, músicas e moedas ficam guardados neste navegador — use a Nuvem pra levar charts entre aparelhos.</span>`;
    })();

    // ---------- Xbox: o B / Esc / "voltar" do navegador não pode fechar o jogo ----------
    // No Edge do Xbox o botão B (e o Esc de um teclado) é o "voltar" do navegador: como o jogo é
    // uma página só, voltar = sair do site. Aqui o "voltar" fica preso dentro do jogo: vira o
    // Esc do jogo (fecha janela/pausa) e a página continua aberta.
    const TRAP = { beatmax: 'trap' };
    const pushTrap = () => { try { if (!history.state || history.state.beatmax !== 'trap') history.pushState(TRAP, ''); } catch (e) {} };
    try { history.replaceState({ beatmax: 'base' }, ''); } catch (e) {}
    pushTrap();
    // o Chrome/Edge ignora entradas de histórico criadas sem o jogador ter mexido em nada:
    // reforça a trava a cada clique/tecla
    ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, pushTrap, true));
    window.addEventListener('popstate', () => {
        pushTrap();
        const playing = typeof isPlaying !== 'undefined' && isPlaying && !(typeof isPaused !== 'undefined' && isPaused);
        if (playing) return; // no meio da música o B é uma tecla do jogo: só segura a página
        // se foi o B do controle, o gamepad-menu.js já tratou (fechou a janela etc.)
        if (performance.now() - (window.__gpLastB || 0) < 500) return;
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    });
    // última proteção: se mesmo assim o navegador tentar sair, pergunta antes
    window.addEventListener('beforeunload', (e) => {
        if (window.__beatmaxSaindo) return;
        e.preventDefault(); e.returnValue = '';
    });

    // Palco 3D: começa leve (só se a pessoa ainda não escolheu)
    try {
        if (!localStorage.getItem('djmaxTrainerPalco_v1') && window.palco3dCfg) window.palco3dCfg.qualidade = 'leve';
    } catch (e) {}
})();
