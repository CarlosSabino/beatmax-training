// =====================================================================================
// config-abas.js — Configurações em abas (no visual novo do jogo).
//
// Não recria nenhum controle: pega as linhas que já existem (do index.html e as que os
// outros arquivos põem lá — palco 3D, fundo, telas, backup…) e só as REORGANIZA em abas.
// Assim todos os eventos continuam funcionando. Linha que ninguém mapeou cai em "Visual ›
// Outros", pra nada sumir.
//   JOGO · SINCRONIA · VISUAL · ÁUDIO · CONTROLES · SISTEMA      (Q / E ou clique troca a aba)
// =====================================================================================
(function () {
    const TAB_KEY = 'djmaxCfgAba_v1';
    const $ = (id) => document.getElementById(id);
    const TABS = [
        { k: 'jogo', t: 'JOGO', i: 'fa-gamepad' },
        { k: 'sync', t: 'SINCRONIA', i: 'fa-stopwatch' },
        { k: 'visual', t: 'VISUAL', i: 'fa-palette' },
        { k: 'audio', t: 'ÁUDIO', i: 'fa-volume-high' },
        { k: 'ctrl', t: 'CONTROLES', i: 'fa-keyboard' },
        { k: 'sis', t: 'SISTEMA', i: 'fa-gear' }
    ];
    // controle → [aba, cartão]  (a linha inteira do controle é movida)
    const MAPA = {
        'setting-ghost': ['jogo', 'Partida'],
        'setting-gear-position': ['visual', 'Gear'],
        'setting-gear-prop': ['visual', 'Gear'],
        'cfg-fx-full': ['visual', 'Gear'],
        'setting-skinfx': ['visual', 'Gear'],
        'setting-hud-layout': ['visual', 'Na tela durante a partida'],
        'hud-show-box': ['visual', 'Na tela durante a partida'],
        'setting-show-fps': ['visual', 'Na tela durante a partida'],
        'setting-palco': ['visual', 'Fundo e palco'],
        'setting-chart-bg': ['visual', 'Fundo e palco'],
        'setting-lane-opacity': ['visual', 'Fundo e palco'],
        'setting-renderer': ['sis', 'Tela'],
        'setting-always-fs': ['sis', 'Tela'],
        'setting-intro': ['sis', 'Telas do jogo'],
        'setting-gameover-video': ['sis', 'Telas do jogo'],
        'setting-bcanim': ['sis', 'Telas do jogo'],
        'btn-app-install': ['sis', 'Aplicativo e dados'],
        'btn-upd-check': ['sis', 'Aplicativo e dados'],
        'btn-settings-backup': ['sis', 'Aplicativo e dados']
    };
    // sem utilidade: some da tela (o valor também é desligado em script.js)
    const REMOVER = ['setting-low-latency', 'setting-auto-fullscreen'];

    const css = document.createElement('style');
    css.textContent = `
#settings-modal{backdrop-filter:none!important;background:rgba(2,6,23,.9)!important}
#settings-modal > div.cfg-box{max-width:none!important;width:min(1240px,96vw);height:min(880px,94vh);max-height:none!important;background:linear-gradient(180deg,#111a2e,#0b1222)!important;border-radius:18px!important}
#settings-modal .cfg-hd{display:flex;align-items:center;gap:14px;padding:14px 24px;background:linear-gradient(90deg,#0e7490,#4c1d95);color:#fff}
#settings-modal .cfg-hd h3{font:900 24px Orbitron,monospace!important;letter-spacing:.1em;color:#fff!important;margin:0}
#settings-modal .cfg-hd #btn-close-settings-x{margin-left:auto;color:#fff;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.4);border-radius:8px;padding:4px 12px;font-size:16px}
#settings-modal .cfg-hd p{font:600 12px Rajdhani,sans-serif;color:rgba(255,255,255,.75);margin:0}
#settings-modal .cfg-tabs{display:flex;gap:6px;padding:12px 24px 0;align-items:flex-end;background:#0b1222;flex-wrap:wrap}
#settings-modal .cfg-tabs button{display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border-radius:10px 10px 0 0;border:0;background:#0f172a;color:#64748b;font:900 13px Orbitron,monospace;letter-spacing:.06em;cursor:pointer}
#settings-modal .cfg-tabs button:hover{color:#cbd5e1}
#settings-modal .cfg-tabs button.on{background:#1e293b;color:#fff;box-shadow:inset 0 3px 0 #22d3ee}
#settings-modal .cfg-tabs .kb{margin-left:auto;font:700 11px Rajdhani;color:#475569;padding-bottom:8px}
#settings-modal .cfg-tabs .kb b{display:inline-block;padding:0 6px;border-radius:4px;background:#1e293b;color:#cbd5e1;margin:0 2px}
#settings-modal .cfg-body{flex:1;overflow-y:auto;background:#1e293b;padding:18px 24px 24px}
#settings-modal .cfg-pane{display:none}
#settings-modal .cfg-pane.on{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:16px;align-items:start}
#settings-modal .cfg-pane.um.on{grid-template-columns:1fr}
#settings-modal .cfg-pane > section,#settings-modal .cfg-card{background:rgba(15,23,42,.55)!important;border:1px solid #334155!important;border-radius:14px!important;padding:16px!important;display:flex;flex-direction:column;gap:12px;margin:0!important}
#settings-modal .cfg-card > h5{font:900 12px Orbitron,monospace;letter-spacing:.12em;color:#22d3ee;margin:0 0 2px}
#settings-modal .cfg-pane > section > div:first-child h4,#settings-modal .cfg-pane > section > h4{font:900 12px Orbitron,monospace!important;letter-spacing:.12em;color:#22d3ee!important}
#settings-modal .cfg-ft{padding:10px 24px;border-top:1px solid #1e293b;background:#0b1222;display:flex;gap:10px;align-items:center}
#settings-modal .cfg-ft span{font:600 12px Rajdhani;color:#64748b}
#settings-modal .cfg-ft #btn-close-settings{width:auto!important;margin-left:auto;padding:8px 28px;font:900 13px Orbitron,monospace!important;letter-spacing:.08em}`;
    document.head.appendChild(css);

    let feito = false, panes = {}, aba = 'jogo';
    try { aba = localStorage.getItem(TAB_KEY) || 'jogo'; } catch (e) {}

    // a "linha" de um controle = o ancestral que é filho direto de uma <section> (ou do cartão onde já está)
    function linhaDe(el) {
        let r = el;
        while (r && r.parentElement && !(r.parentElement.tagName === 'SECTION' || r.parentElement.classList.contains('cfg-card'))) r = r.parentElement;
        return r && r.parentElement ? r : null;
    }
    function cartao(tab, nome) {
        const pane = panes[tab];
        let c = [...pane.querySelectorAll(':scope > .cfg-card')].find(x => x.dataset.nome === nome);
        if (!c) { c = document.createElement('div'); c.className = 'cfg-card'; c.dataset.nome = nome; c.innerHTML = `<h5>${nome.toUpperCase()}</h5>`; pane.appendChild(c); }
        return c;
    }
    function secaoDe(h4texto) {
        return [...$('settings-modal').querySelectorAll('section')].find(s => { const h = s.querySelector('h4'); return h && h.textContent.trim().startsWith(h4texto); });
    }

    function opcaoFxFull() {
        if ($('cfg-fx-full') || typeof window.bmGearFxFullSet !== 'function') return null;
        const l = document.createElement('label');
        l.className = 'flex items-start justify-between gap-3 cursor-pointer';
        l.innerHTML = `<div><span class="text-xs font-bold text-slate-200 block">Efeito da gear cobre a gear inteira</span>
            <span class="text-[11px] text-slate-400">A animação das laterais das gears exclusivas desce até o painel de baixo, em vez de parar na linha de julgamento. (Também no Personalizar.)</span></div>
            <input type="checkbox" id="cfg-fx-full" class="accent-cyan-400 w-5 h-5 cursor-pointer shrink-0 mt-0.5">`;
        const cb = l.querySelector('input');
        cb.checked = window.bmGearFxFullSalvo ? window.bmGearFxFullSalvo() : false;
        cb.addEventListener('change', () => window.bmGearFxFullSet(cb.checked));
        return l;
    }

    function organizar() {
        const m = $('settings-modal');
        // linhas mapeadas
        Object.entries(MAPA).forEach(([id, [tab, nome]]) => {
            let el = $(id);
            if (!el && id === 'cfg-fx-full') { const l = opcaoFxFull(); if (!l) return; cartao(tab, nome).appendChild(l); return; }
            if (!el) return;
            const r = linhaDe(el);
            if (!r) return;
            const c = cartao(tab, nome);
            if (r.parentElement !== c) c.appendChild(r);
        });
        REMOVER.forEach(id => { const el = $(id); const r = el && linhaDe(el); if (r) r.remove(); });
        // o que sobrou nas seções antigas de Vídeo vai pra Visual › Outros (nada some)
        const vid = secaoDe('Vídeo');
        if (vid) [...vid.children].forEach(ch => {
            if (ch.querySelector('h4') || ch.tagName === 'H4') return;
            cartao('visual', 'Outros').appendChild(ch);
        });
        if (vid && ![...vid.children].some(ch => !(ch.querySelector('h4') || ch.tagName === 'H4'))) vid.remove();
        const out = panes.visual.querySelector('.cfg-card[data-nome="Outros"]');
        if (out && !out.querySelector('input, select, button')) out.remove(); // só sobrou subtítulo solto
    }

    function montar() {
        if (feito) { organizar(); return; }
        const m = $('settings-modal');
        const box = m && m.firstElementChild;
        const grid = box && box.querySelector(':scope > .overflow-y-auto');
        if (!box || !grid) return;
        feito = true;
        box.classList.add('cfg-box');
        // cabeçalho no estilo do jogo
        const hd = box.firstElementChild;
        hd.className = 'cfg-hd shrink-0';
        // abas
        const tabs = document.createElement('div');
        tabs.className = 'cfg-tabs shrink-0';
        tabs.innerHTML = TABS.map(t => `<button type="button" data-cfg-tab="${t.k}"><i class="fa-solid ${t.i}"></i>${t.t}</button>`).join('') + '<span class="kb"><b>Q</b><b>E</b> troca a aba</span>';
        hd.insertAdjacentElement('afterend', tabs);
        const body = document.createElement('div');
        body.className = 'cfg-body';
        TABS.forEach(t => { const p = document.createElement('div'); p.className = 'cfg-pane'; p.dataset.pane = t.k; body.appendChild(p); panes[t.k] = p; });
        grid.replaceWith(body);
        // seções inteiras
        const put = (txt, tab) => { const s = [...grid.querySelectorAll(':scope > section')].find(x => { const h = x.querySelector('h4'); return h && h.textContent.trim().startsWith(txt); }); if (s) { s.classList.remove('md:col-span-2'); panes[tab].appendChild(s); } return s; };
        put('Jogabilidade', 'jogo');
        put('Sincronia', 'sync');
        put('Áudio', 'audio');
        put('Teclas', 'ctrl');
        put('Controle', 'ctrl');
        const vid = put('Vídeo', 'visual'); // desmontada logo abaixo
        [...grid.querySelectorAll(':scope > section')].forEach(s => panes.visual.appendChild(s)); // alguma seção nova: não some
        panes.sync.classList.add('um'); panes.ctrl.classList.add('um');
        if (vid) vid.style.display = 'none';
        organizar();
        // rodapé
        const ft = box.lastElementChild;
        if (ft && ft.querySelector('#btn-close-settings')) { ft.className = 'cfg-ft shrink-0'; ft.insertAdjacentHTML('afterbegin', '<span>Tudo é salvo na hora, neste computador.</span>'); }
        tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-cfg-tab]'); if (b) mostrar(b.dataset.cfgTab); });
        mostrar(aba);
    }
    function mostrar(k) {
        if (!panes[k]) k = 'jogo';
        aba = k; try { localStorage.setItem(TAB_KEY, k); } catch (e) {}
        document.querySelectorAll('#settings-modal [data-cfg-tab]').forEach(b => b.classList.toggle('on', b.dataset.cfgTab === k));
        Object.entries(panes).forEach(([n, p]) => p.classList.toggle('on', n === k));
        const body = document.querySelector('#settings-modal .cfg-body'); if (body) body.scrollTop = 0;
    }
    function aberto() { const m = $('settings-modal'); return m && !m.classList.contains('hidden'); }

    function iniciar() {
        const m = $('settings-modal');
        if (!m) return;
        new MutationObserver(() => { if (aberto()) { montar(); const cb = $('cfg-fx-full'); if (cb && window.bmGearFxFullSalvo) cb.checked = window.bmGearFxFullSalvo(); } }).observe(m, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('keydown', (e) => {
            if (!aberto() || !feito) return;
            const t = e.target && e.target.tagName;
            if (t === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range' || t === 'TEXTAREA' || t === 'SELECT') return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.code !== 'KeyQ' && e.code !== 'KeyE') return;
            if (typeof listeningKeyIndex !== 'undefined' && listeningKeyIndex !== null) return; // configurando uma tecla
            if (typeof listeningAltIndex !== 'undefined' && listeningAltIndex !== null) return;
            e.preventDefault(); e.stopImmediatePropagation();
            const i = TABS.findIndex(x => x.k === aba);
            mostrar(TABS[(i + (e.code === 'KeyE' ? 1 : TABS.length - 1)) % TABS.length].k);
        }, true);
        if (aberto()) montar();
    }
    // espera os outros arquivos terminarem de pôr as opções deles
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(iniciar, 0)); else setTimeout(iniciar, 0);
    window.cfgAbrirAba = (k) => { montar(); mostrar(k); };
})();
