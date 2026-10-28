// =====================================================================================
// colecao.js — PERSONALIZAR (coleção): cada parte do visual escolhida separada, como no DJMAX.
//
//   GEAR             moldura/laterais (inclui as suas skins e as exclusivas da Loja)
//   NOTA             formato das notas (inclui as skins de nota da Loja)
//   EFEITO DE ACERTO o que acontece ao acertar (dá pra usar o efeito de uma skin com outra nota)
//   CORES DAS NOTAS  as cores de qualquer gear/skin sua, sem trocar a gear
//   EFEITO DA GEAR   as animações das gears exclusivas em QUALQUER gear (+ cobrir a gear inteira)
//
// Itens que você não tem aparecem com cadeado e preço: dá pra ver na prévia, TESTAR NA PISTA
// (45 s, sem EXP nem ranking) e comprar ali mesmo.
// =====================================================================================
(function () {
    const KEY = 'djmaxTrainerColecao_v1';
    const cfg = { hitFx: 'auto', gearFx: 'auto', palette: '', fxFull: false, torcida: { L: '', R: '' } };
    try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
    // progresso da nuvem chegou: relê
    window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith(KEY)) { try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (er) {} } });
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.BM_COLECAO = true;
    let teste = null; // { cfg } durante o "Testar na pista"

    const cat = () => (typeof window.lojaCatalogo === 'function' ? window.lojaCatalogo() : { coins: 0, gears: [], notes: [] });
    const isSk = (s) => typeof s === 'string' && s.startsWith('sk_');
    function hitOwned(id) { if (teste) return true; const n = cat().notes.find(x => x.id === id); return !!(n && n.owned); }
    function gearOwned(id) { if (teste) return true; const g = cat().gears.find(x => x.id === id); return !!(g && g.owned); }
    let pvCfg = null; // durante o desenho da prévia
    const C = () => (pvCfg || (teste ? teste.cfg : cfg));

    // ---------- o que vale no jogo ----------
    window.bmHitFxId = function () {
        const c = C(), autoId = typeof noteShape === 'string' && isSk(noteShape) ? noteShape.slice(3) : null;
        if (c.hitFx === 'auto') return autoId;
        if (c.hitFx === 'padrao') return 'padrao';
        return hitOwned(c.hitFx) ? c.hitFx : autoId;
    };
    window.bmGearFxId = function () {
        const c = C(), autoId = typeof gearSkin === 'string' && gearSkin.startsWith('shop_') ? gearSkin.slice(5) : null;
        if (c.gearFx === 'auto') return autoId;
        if (c.gearFx === 'off') return null;
        return gearOwned(c.gearFx) ? c.gearFx : autoId;
    };
    window.bmGearFxFull = () => !!C().fxFull;
    // torcida 8-bit (torcida.js): quem fica de cada lado da gear
    const torcOk = (t) => ({ L: (t && t.L) || '', R: (t && t.R) || '' });
    window.bmTorcida = () => torcOk(C().torcida || cfg.torcida);
    // comprou na Loja: já põe num lado vazio
    window.bmTorcidaAuto = (id) => { cfg.torcida = torcOk(cfg.torcida); if (cfg.torcida.L === id || cfg.torcida.R === id) return; if (!cfg.torcida.L) cfg.torcida.L = id; else if (!cfg.torcida.R) cfg.torcida.R = id; save(); };
    // usado também nas Configurações › Visual
    window.bmGearFxFullSet = (v) => { cfg.fxFull = !!v; save(); };
    window.bmGearFxFullSalvo = () => !!cfg.fxFull;
    // cores das notas independentes da gear
    if (typeof window.getKeyColorScheme === 'function') {
        const orig = window.getKeyColorScheme;
        window.getKeyColorScheme = function (mode, skin) {
            const p = C().palette;
            if (p && typeof SKIN_PALETTES !== 'undefined' && SKIN_PALETTES[p]) return orig.call(this, mode, p);
            return orig.apply(this, arguments);
        };
    }

    // ---------- listas ----------
    function optList(selId) {
        const sel = $(selId); if (!sel) return [];
        return [...sel.options].map(o => ({ value: o.value, text: o.text.replace(' ★', '').trim(), group: o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '' }));
    }
    function itens(slot) {
        const k = cat();
        if (slot === 'gear') {
            const own = optList('main-gear-skin').map(o => ({ id: o.value, name: o.text, sub: o.group.replace(/\s*\(.*\)/, ''), owned: true, excl: o.value.startsWith('shop_') }));
            k.gears.filter(g => !g.owned).forEach(g => own.push({ id: g.key, shopId: g.id, name: g.name, sub: 'Exclusiva (loja)', owned: false, price: g.price, kind: 'gear', excl: true }));
            return own;
        }
        if (slot === 'nota') {
            const own = optList('main-note-shape').map(o => ({ id: o.value, name: o.text.replace(/\s*\(.*\)/, ''), sub: isSk(o.value) ? 'Exclusiva' : '', owned: true, excl: isSk(o.value) }));
            k.notes.filter(n => !n.owned).forEach(n => own.push({ id: n.shape, shopId: n.id, name: n.name, sub: 'Exclusiva (loja)', owned: false, price: n.price, kind: 'nota', excl: true }));
            return own;
        }
        if (slot === 'hit') {
            const l = [{ id: 'auto', name: 'Igual à nota', sub: 'usa o efeito da skin de nota', owned: true }, { id: 'padrao', name: 'Padrão', sub: 'brilho simples', owned: true }];
            k.notes.forEach(n => l.push({ id: n.id, name: n.id === 'moeda' ? 'Chuva de Beatcoins' : n.name, sub: n.owned ? 'efeito exclusivo' : 'vem com a nota ' + n.name, owned: n.owned, price: n.price, kind: 'nota', shopId: n.id, excl: true }));
            return l;
        }
        if (slot === 'cores') {
            const l = [{ id: '', name: 'Igual à gear', sub: 'cores da gear escolhida', owned: true }];
            optList('main-gear-skin').forEach(o => l.push({ id: o.value, name: o.text, sub: o.group.replace(/\s*\(.*\)/, ''), owned: true }));
            return l;
        }
        if (slot === 'torcida') {
            const l = [{ id: '', name: 'Ninguém', sub: 'lado vazio', owned: true }];
            (k.torcida || []).forEach(t => l.push({ id: t.id, name: t.name, sub: t.owned ? 'torcida 8-bit' : 'Loja · torcida 8-bit', owned: t.owned, price: t.price, kind: 'torcida', shopId: t.id, excl: true, img: t.img }));
            return l;
        }
        if (slot === 'gfx') {
            const l = [{ id: 'auto', name: 'Igual à gear', sub: 'só nas gears exclusivas', owned: true }, { id: 'off', name: 'Desligado', sub: 'sem animação nas laterais', owned: true }];
            k.gears.forEach(g => l.push({ id: g.id, name: g.name, sub: g.owned ? 'animação exclusiva' : 'vem com a gear ' + g.name, owned: g.owned, price: g.price, kind: 'gear', shopId: g.id, excl: true }));
            return l;
        }
        return [];
    }
    const SLOTS = [
        ['gear', 'GEAR', 'moldura e laterais'],
        ['nota', 'NOTA', 'formato das notas'],
        ['hit', 'EFEITO DE ACERTO', 'o que acontece ao acertar'],
        ['cores', 'CORES DAS NOTAS', 'não troca a gear'],
        ['gfx', 'EFEITO DA GEAR', 'animação das laterais'],
        ['torcida', 'TORCIDA 8-BIT', 'quem fica do lado da gear']
    ];
    function atual(slot) {
        if (slot === 'gear') return typeof gearSkin !== 'undefined' ? gearSkin : '';
        if (slot === 'nota') return typeof noteShape !== 'undefined' ? noteShape : '';
        if (slot === 'hit') return cfg.hitFx;
        if (slot === 'cores') return cfg.palette;
        if (slot === 'gfx') return cfg.gearFx;
        if (slot === 'torcida') return torcOk(cfg.torcida)[ui.lado];
    }
    function torcDraft() { return torcOk(ui.draft.torcida || cfg.torcida); }

    // ---------- estado da tela ----------
    let ui = { slot: 'gear', draft: {}, lado: 'L' };
    function draftVal(slot) { if (slot === 'torcida') return torcDraft()[ui.lado]; return slot in ui.draft ? ui.draft[slot] : atual(slot); }
    function resolve() {
        const gear = draftVal('gear'), shape = draftVal('nota'), hit = draftVal('hit'), pal = draftVal('cores'), gfx = draftVal('gfx');
        let theme = (typeof GEAR_THEMES !== 'undefined' && GEAR_THEMES[gear]) || null;
        if (!theme && gear.startsWith('shop_') && window.lojaGearTema) theme = window.lojaGearTema(gear.slice(5));
        theme = theme || (typeof GEAR_THEMES !== 'undefined' && GEAR_THEMES.respect) || {};
        let palObj = null;
        if (pal && typeof SKIN_PALETTES !== 'undefined' && SKIN_PALETTES[pal]) palObj = SKIN_PALETTES[pal];
        else if (typeof SKIN_PALETTES !== 'undefined' && SKIN_PALETTES[gear]) palObj = SKIN_PALETTES[gear];
        else palObj = theme.palette || {};
        const SKP = { sk_seatus: ['#22d3ee', '#f472b6'], sk_chama: ['#fb923c', '#facc15'], sk_moeda: ['#e2e8f0', '#facc15'] };
        const cores = (!pal && SKP[shape]) ? [SKP[shape][0], SKP[shape][1], SKP[shape][1], SKP[shape][0]] : [palObj.edge, palObj.altA, palObj.altA, palObj.edge].map(c => c || '#e2e8f0');
        const hitId = hit === 'auto' ? (isSk(shape) ? shape.slice(3) : 'padrao') : hit;
        const gfxId = gfx === 'auto' ? (gear.startsWith('shop_') ? gear.slice(5) : '') : gfx === 'off' ? '' : gfx;
        return { gear, shape, hitId, gfxId, theme, cores, pal, full: 'fxFull' in ui.draft ? ui.draft.fxFull : cfg.fxFull };
    }

    // ---------- estilo ----------
    const css = document.createElement('style');
    css.textContent = `
#col-ov{position:fixed;inset:0;z-index:145;background:rgba(2,6,23,.92);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;color:#e2e8f0}
#col-ov .bx{width:min(1500px,97vw);height:min(900px,94vh);display:grid;grid-template-columns:minmax(260px,30%) 1fr;grid-template-rows:auto 1fr auto;gap:0;background:linear-gradient(180deg,#0f1729,#0a1020);border:1px solid #334155;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6)}
#col-ov .hd{grid-column:1/3;display:flex;align-items:center;gap:16px;padding:14px 22px;border-bottom:1px solid #1e293b}
#col-ov .hd h2{font:900 26px Orbitron,monospace;letter-spacing:.08em;color:#fff}
#col-ov .hd .coins{margin-left:auto;display:flex;align-items:center;gap:8px;font:900 20px Orbitron;color:#fde68a;padding:6px 14px;border-radius:12px;background:rgba(15,23,42,.8);border:1px solid #334155}
#col-ov .hd .coin{width:24px;height:24px;background:url('assets/beatcoin.png') center/contain no-repeat}
#col-ov .hd button{padding:8px 14px;border-radius:10px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font:700 14px Rajdhani;cursor:pointer}
#col-ov .hd button:hover{border-color:#22d3ee}
#col-ov .pv{display:flex;flex-direction:column;border-right:1px solid #1e293b;min-height:0;padding:14px}
#col-ov .pv .h{font:800 12px Orbitron;letter-spacing:.12em;color:#a5b4fc;margin-bottom:8px;display:flex;justify-content:space-between}
#col-ov .pv .h span{font:600 12px Rajdhani;color:#64748b;letter-spacing:0}
#col-ov .stage{flex:1;min-height:0;display:flex;justify-content:center;align-items:center;overflow:hidden}
#col-ov .prev{position:relative;height:100%;aspect-ratio:300/560;max-width:100%;border-radius:10px;display:flex;justify-content:center;align-items:stretch;padding:0 10px;overflow:hidden}
#col-ov .prev .pil{width:12px;flex-shrink:0}
#col-ov .prev .lanes{flex:1;position:relative}
#col-ov .prev canvas.nc{position:absolute;top:0;bottom:0;left:10px;right:10px;width:calc(100% - 20px);height:100%;z-index:2}
#col-ov .prev .pn{position:absolute;left:0;right:0;bottom:0;height:14%;z-index:1}
#col-ov .pv .bt{display:flex;gap:8px;margin-top:10px}
#col-ov .pv .bt button{flex:1;padding:11px 0;border-radius:10px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font:900 13px Orbitron;letter-spacing:.04em;cursor:pointer}
#col-ov .pv .bt button.pri{background:linear-gradient(90deg,#22d3ee,#6366f1);border:0;color:#020617}
#col-ov .pv .bt button.buy{background:linear-gradient(90deg,#f59e0b,#facc15);border:0;color:#1c1917}
#col-ov .pv .bt button:disabled{opacity:.4;cursor:default}
#col-ov .pv .msg{min-height:20px;margin-top:6px;font:700 14px Rajdhani;color:#fca5a5;text-align:center}
#col-ov .rt{display:flex;flex-direction:column;min-height:0;padding:14px 18px;gap:10px}
#col-ov .slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px}
#col-ov .opt .lado{padding:6px 12px;border-radius:9px;border:1px solid #475569;background:#1e293b;color:#cbd5e1;font:800 12px Orbitron;cursor:pointer}
#col-ov .opt .lado.on{border:2px solid #fbbf24;color:#fff}
#col-ov .opt .lado b{color:#fde68a}
#col-ov .it img.tp{position:absolute;right:8px;bottom:6px;height:56px;image-rendering:pixelated}
#col-ov .it:has(img.tp){min-height:84px;padding-right:64px}
#col-ov .sl{border-radius:12px;border:1px solid #334155;background:rgba(15,23,42,.85);padding:9px 12px;cursor:pointer;min-width:0}
#col-ov .sl b{display:block;font:900 13px Orbitron;letter-spacing:.06em;color:#cbd5e1}
#col-ov .sl small{display:block;font:600 12px Rajdhani;color:#64748b}
#col-ov .sl i{display:block;font-style:normal;font:800 15px Rajdhani;color:#fde68a;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#col-ov .sl.on{border:2px solid #fbbf24;box-shadow:0 0 14px rgba(251,191,36,.25)}
#col-ov .sl.mod i{color:#f472b6}
#col-ov .opt{display:flex;align-items:center;gap:10px;font:700 14px Rajdhani;color:#cbd5e1}
#col-ov .grid{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;align-content:start;padding-right:4px}
#col-ov .it{position:relative;border-radius:12px;border:1px solid #334155;background:#0f172a;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:3px;min-height:74px}
#col-ov .it:hover{border-color:#64748b}
#col-ov .it b{font:800 16px Rajdhani;color:#fff;line-height:1.1}
#col-ov .it small{font:600 12px Rajdhani;color:#64748b}
#col-ov .it .st{font:800 11px Orbitron;color:#86efac;margin-top:auto}
#col-ov .it .pr{display:flex;align-items:center;gap:5px;font:900 12px Orbitron;color:#fde68a;margin-top:auto}
#col-ov .it .pr i{width:16px;height:16px;background:url('assets/beatcoin.png') center/contain no-repeat}
#col-ov .it .lk{position:absolute;top:8px;right:10px;font-size:14px}
#col-ov .it.use{border-color:#22d3ee;box-shadow:0 0 12px rgba(34,211,238,.3)}
#col-ov .it.sel{border:2px solid #fbbf24}
#col-ov .it.excl b:after{content:' ★';color:#fbbf24}
#col-ov .it .sw{display:flex;gap:4px;margin-top:2px}
#col-ov .it .sw span{width:14px;height:14px;border-radius:50%}
#col-ov .ft{grid-column:1/3;display:flex;gap:26px;padding:10px 22px;border-top:1px solid #1e293b;background:#0b1222;font:700 14px Rajdhani;color:#94a3b8;flex-wrap:wrap}
#col-ov .ft kbd{font:800 11px Orbitron;padding:2px 7px;border-radius:5px;background:#e2e8f0;color:#0f172a;margin-right:6px}
#col-teste{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:200;padding:8px 18px;border-radius:999px;background:linear-gradient(90deg,#4c1d95,#0e7490);border:1px solid #c4b5fd;color:#fff;font:800 15px Rajdhani;pointer-events:none;transition:all .3s}
#col-teste.fim{background:linear-gradient(90deg,#b45309,#dc2626);border-color:#fde68a;font-size:20px;padding:10px 24px;box-shadow:0 0 30px rgba(251,191,36,.5)}
#col-teste.fim b{font:900 24px Orbitron}
#col-fade{position:fixed;inset:0;z-index:210;background:#020617;opacity:0;transition:opacity .9s ease;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;pointer-events:none;color:#e2e8f0}
#col-fade.on{opacity:1}
#col-fade div{font:900 42px Orbitron;letter-spacing:.12em;color:#c4b5fd}
#col-fade small{font:600 16px Rajdhani;color:#94a3b8}`;
    document.head.appendChild(css);

    // ---------- tela ----------
    function abrir(slot) {
        if (typeof isPlaying !== 'undefined' && isPlaying) return;
        if (slot) ui.slot = slot;
        ui.draft = {};
        $('col-ov')?.remove();
        const ov = document.createElement('div'); ov.id = 'col-ov';
        ov.innerHTML = `<div class="bx">
            <div class="hd"><h2>🎨 PERSONALIZAR</h2><button data-ed>✏️ Editor de skins (cores e imagens)…</button><button data-loja>🛒 Loja</button>
              <span class="coins"><span class="coin"></span><span id="col-coins">0</span></span><button data-x>ESC · Fechar</button></div>
            <div class="pv"><div class="h">PRÉVIA AO VIVO<span id="col-pvname"></span></div>
              <div class="stage" id="col-stage"></div>
              <div class="bt"><button class="pri" data-test>▶ TESTAR (45 s)</button><button data-eq>EQUIPAR</button></div>
              <div class="msg" id="col-msg"></div></div>
            <div class="rt"><div class="slots" id="col-slots"></div><div class="opt" id="col-opt"></div><div class="grid" id="col-grid"></div></div>
            <div class="ft"><span><kbd>←→</kbd>PARTE</span><span><kbd>↑↓</kbd>ITEM</span><span><kbd>T</kbd>TESTAR</span><span><kbd>ENTER</kbd>EQUIPAR / COMPRAR</span><span style="margin-left:auto">Itens com 🔒 dá pra ver e testar antes de comprar · o teste (45 s) não conta pontos, EXP nem ranking</span></div></div>`;
        document.body.appendChild(ov);
        ov.querySelector('[data-x]').onclick = fechar;
        ov.querySelector('[data-ed]').onclick = () => { fechar(); $('btn-skin')?.click(); };
        ov.querySelector('[data-loja]').onclick = () => { fechar(); window.openLojaBeatmax && window.openLojaBeatmax(); };
        ov.querySelector('[data-test]').onclick = testar;
        ov.querySelector('[data-eq]').onclick = equiparOuComprar;
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) fechar(); });
        document.addEventListener('keydown', onKey, true);
        if (typeof window.beatmaxPersonagem === 'function') {
            const l = ['E aí! Eu sou a <b>Jade</b>. Bora deixar esse visual com a sua cara?', 'Mistura sem medo: nota de um jeito, efeito de outro. Arte é isso! 🎨', 'Itens com cadeado dá pra <b>testar</b> antes de comprar. Aperta T!', 'Já viu a <b>Torcida 8-bit</b>? A galera fica do lado da gear torcendo por você.'];
            window.beatmaxPersonagem(ov, 'jade', window.beatmaxFala ? window.beatmaxFala('jade-oi', l) : l[0], '1180px');
        }
        render();
    }
    // a Jade comenta as escolhas
    function jadeDiz(html) { const b = document.querySelector('#col-ov .bm-ch-say'); if (b) b.innerHTML = `<span class="nm">JADE</span>${html}`; }
    function jadeReage(it) {
        const f = (k, l) => (window.beatmaxFala ? window.beatmaxFala(k, l) : l[0]);
        if (!it.owned) return jadeDiz(f('jade-lk', [`<b>${esc(it.name)}</b> é da Loja. Testa na pista antes (T) — custa ${it.price} Beatcoins.`, `Curtiu <b>${esc(it.name)}</b>? Dá pra ver aqui e comprar sem sair da tela.`]));
        if (ui.slot === 'torcida') return jadeDiz(it.id ? f('jade-tc', [`<b>${esc(it.name.replace(' 8-bit', ''))}</b> na torcida? Vai ser festa a cada combo!`, it.id === 'jade' ? 'Eu mesma? Tô dentro! Vou grafitar o ar a cada sequência. 😎' : 'Boa! Quanto maior o combo, maior a comemoração.']) : 'Lado vazio. Às vezes menos é mais!');
        if (ui.slot === 'gfx' && it.id === 'grafite') return jadeDiz('Esse é MEU! Cada acerto vira um grafite neon nos muros. 🎨');
        if (ui.slot === 'hit' || ui.slot === 'nota') return jadeDiz(f('jade-mx', [`<b>${esc(nomeDe('nota', draftVal('nota')))}</b> com efeito <b>${esc(nomeDe('hit', ui.slot === 'hit' ? it.id : draftVal('hit')))}</b>? Ousado. Gostei!`, 'Combinação diferente é assinatura. Ninguém vai ter igual!', 'Fica de olho na prévia: é igualzinho na pista.']));
        if (ui.slot === 'cores') return jadeDiz(f('jade-cr', ['Cor muda tudo! Testa umas três antes de decidir.', 'Essa paleta ficou com pegada de grafite. Aprovado!']));
        jadeDiz(f('jade-gr', ['Gear nova, vibe nova!', 'Essa moldura combina com um efeito animado. Olha a aba Efeito da gear!']));
    }
    function fechar() { $('col-ov')?.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) {
        if (!$('col-ov')) return;
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(); return; }
        if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); const i = SLOTS.findIndex(s => s[0] === ui.slot); ui.slot = SLOTS[(i + (k === 'ArrowRight' ? 1 : -1) + SLOTS.length) % SLOTS.length][0]; render(); return; }
        if (k === 'ArrowUp' || k === 'ArrowDown') {
            e.preventDefault(); e.stopImmediatePropagation();
            const l = itens(ui.slot), cur = draftVal(ui.slot), i = Math.max(0, l.findIndex(x => x.id === cur));
            const cols = Math.max(1, Math.floor(($('col-grid').clientWidth + 10) / 180));
            const j = Math.max(0, Math.min(l.length - 1, i + (k === 'ArrowDown' ? cols : -cols)));
            escolher(l[j]); return;
        }
        if (k === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); equiparOuComprar(); return; }
        if (k === 't' || k === 'T') { e.preventDefault(); e.stopImmediatePropagation(); testar(); return; }
        if (k === 'Tab' && ui.slot === 'torcida') { e.preventDefault(); e.stopImmediatePropagation(); ui.lado = ui.lado === 'L' ? 'R' : 'L'; render(); return; }
        if (k === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); const l = itens(ui.slot), cur = draftVal(ui.slot), i = l.findIndex(x => x.id === cur); escolher(l[(i + (e.shiftKey ? -1 : 1) + l.length) % l.length]); return; }
        e.stopImmediatePropagation();
    }
    function nomeDe(slot, id) { const it = itens(slot).find(x => x.id === id); return it ? it.name : '—'; }
    function escolher(it) {
        if (!it) return;
        jadeReage(it);
        if (ui.slot === 'torcida') {
            const t = torcDraft(); t[ui.lado] = it.id;
            ui.draft.torcida = t;
            $('col-msg').textContent = '';
            if (it.owned) aplicar('torcida', it.id);
            render(); return;
        }
        ui.draft[ui.slot] = it.id;
        $('col-msg').textContent = '';
        if (it.owned) aplicar(ui.slot, it.id);
        render();
    }
    // item que você tem: já vale na hora
    function aplicar(slot, id) {
        if (slot === 'gear') { const s = $('main-gear-skin'); if (s && [...s.options].some(o => o.value === id)) { s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); } }
        else if (slot === 'nota') { const s = $('main-note-shape'); if (s && [...s.options].some(o => o.value === id)) { s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); } }
        else if (slot === 'hit') cfg.hitFx = id;
        else if (slot === 'cores') cfg.palette = id;
        else if (slot === 'gfx') cfg.gearFx = id;
        else if (slot === 'torcida') {
            cfg.torcida = torcOk(cfg.torcida); cfg.torcida[ui.lado] = id; save();
            if (ui.draft.torcida) { ui.draft.torcida[ui.lado] = id; if (ui.draft.torcida.L === cfg.torcida.L && ui.draft.torcida.R === cfg.torcida.R) delete ui.draft.torcida; }
            return;
        }
        save();
        try { if (typeof glResetGearCache === 'function') glResetGearCache(); } catch (e) {}
        delete ui.draft[slot];
    }
    function selItem() { const l = itens(ui.slot); return l.find(x => x.id === draftVal(ui.slot)); }
    function equiparOuComprar() {
        const it = selItem(); if (!it) return;
        if (it.owned) { aplicar(ui.slot, it.id); render(); return; }
        const b = $('col-ov').querySelector('[data-eq]');
        if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = `CONFIRMAR: ${it.price} BEATCOINS?`; setTimeout(() => { if (b.isConnected) { b.dataset.arm = ''; render(); } }, 3500); return; }
        const r = window.lojaComprar ? window.lojaComprar(it.kind, it.shopId) : { ok: false, msg: 'Loja indisponível.' };
        if (!r.ok) { $('col-msg').textContent = r.msg || 'Não deu pra comprar.'; render(); return; }
        // comprou: já equipa nesta parte
        const novo = itens(ui.slot).find(x => x.id === it.id);
        if (novo) aplicar(ui.slot, novo.id);
        $('col-msg').innerHTML = `<span style="color:#86efac">🛒 ${esc(it.name)} comprado e equipado!</span>`;
        render();
    }

    function render() {
        const ov = $('col-ov'); if (!ov) return;
        $('col-coins').textContent = cat().coins;
        const torcNome = () => { const t = torcDraft(), n = (id) => id ? nomeDe('torcida', id).replace(' 8-bit', '') : '—'; return t.L || t.R ? `${n(t.L)} · ${n(t.R)}` : 'Ninguém'; };
        $('col-slots').innerHTML = SLOTS.map(([k, t, d]) => `<div class="sl${k === ui.slot ? ' on' : ''}${k in ui.draft ? ' mod' : ''}" data-s="${k}"><b>${t}</b><small>${d}</small><i>${esc(k === 'torcida' ? torcNome() : nomeDe(k, draftVal(k)))}${k in ui.draft ? ' (prévia)' : ''}</i></div>`).join('');
        $('col-slots').querySelectorAll('[data-s]').forEach(el => el.onclick = () => { ui.slot = el.dataset.s; render(); });
        $('col-opt').innerHTML = (ui.slot === 'gfx' || ui.slot === 'gear') ? `<label class="opt"><input type="checkbox" id="col-full" ${cfg.fxFull ? 'checked' : ''} class="accent-cyan-400 w-5 h-5"> Efeito cobre a gear inteira (até o painel de baixo)</label>` : '';
        const full = $('col-full'); if (full) full.onchange = () => { cfg.fxFull = full.checked; save(); render(); };
        if (ui.slot === 'torcida') {
            const t = torcDraft(), n = (id) => id ? nomeDe('torcida', id).replace(' 8-bit', '') : 'Ninguém';
            $('col-opt').innerHTML = `<span style="color:#94a3b8">Escolha o lado e depois a personagem:</span>${['L', 'R'].map(l => `<button class="lado${ui.lado === l ? ' on' : ''}" data-lado="${l}">${l === 'L' ? '◀ ESQUERDA' : 'DIREITA ▶'}: <b>${esc(n(t[l]))}</b></button>`).join('')}<span style="color:#64748b;font-size:12px">Tab troca o lado</span>`;
            $('col-opt').querySelectorAll('[data-lado]').forEach(b => b.onclick = () => { ui.lado = b.dataset.lado; render(); });
        }
        const cur = atual(ui.slot), dv = draftVal(ui.slot);
        $('col-grid').innerHTML = itens(ui.slot).map(it => {
            let sw = '';
            if (ui.slot === 'cores' && it.id && typeof SKIN_PALETTES !== 'undefined' && SKIN_PALETTES[it.id]) { const p = SKIN_PALETTES[it.id]; sw = `<div class="sw">${[p.edge, p.altA, p.altB || p.altA, p.center || p.altA].map(c => `<span style="background:${c}"></span>`).join('')}</div>`; }
            if (it.img) sw = `<img class="tp" src="${it.img}" alt="">`;
            return `<div class="it${it.id === cur ? ' use' : ''}${it.id === dv ? ' sel' : ''}${it.excl ? ' excl' : ''}" data-i="${esc(it.id)}"><b>${esc(it.name)}</b><small>${esc(it.sub || '')}</small>${sw}
                ${it.owned ? (it.id === cur ? '<span class="st">✔ EM USO</span>' : '<span class="st" style="color:#64748b">SEU</span>') : `<span class="pr"><i></i>${it.price} · COMPRAR</span><span class="lk">🔒</span>`}</div>`;
        }).join('');
        $('col-grid').querySelectorAll('[data-i]').forEach(el => el.onclick = () => escolher(itens(ui.slot).find(x => x.id === el.dataset.i)));
        const it = selItem(), b = ov.querySelector('[data-eq]');
        if (b.dataset.arm !== '1') {
            if (it && !it.owned) { b.className = 'buy'; b.textContent = `COMPRAR · ${it.price}`; b.disabled = cat().coins < it.price; }
            else { b.className = ''; b.textContent = it && it.id === cur ? '✔ EQUIPADO' : 'EQUIPAR'; b.disabled = !!(it && it.id === cur); }
        }
        prevRender();
    }
    // ---------- prévia FIEL: desenha a gear de verdade (mesmas funções do jogo) ----------
    const PV = { notes: [], flashes: [], fx: [], keyUntil: [], t0: 0, last: 0, raf: 0, S: null, gfxId: null };
    function prevRender() {
        const st = $('col-stage'); if (!st) return;
        if (!st.querySelector('canvas')) { st.innerHTML = '<canvas id="col-cv"></canvas>'; PV.t0 = performance.now(); PV.notes = []; PV.flashes = []; PV.fx = []; }
        const r = resolve();
        $('col-pvname').textContent = [nomeDe('gear', r.gear), nomeDe('nota', r.shape)].join(' · ');
        if (!PV.raf) PV.raf = requestAnimationFrame(pvFrame);
    }
    function pvFrame(now) {
        PV.raf = 0;
        const cv = $('col-cv'); if (!cv || !$('col-ov')) return;
        PV.raf = requestAnimationFrame(pvFrame);
        const r = resolve();
        if (r.gear.startsWith('shop_') && typeof GEAR_THEMES !== 'undefined' && !GEAR_THEMES[r.gear] && window.lojaRegistrar) window.lojaRegistrar(r.gear.slice(5));
        const th = (typeof GEAR_THEMES !== 'undefined' && GEAR_THEMES[r.gear]) || GEAR_THEMES.respect;
        const GP = typeof gearProp === 'function' ? gearProp() : { H: 1080, P: GEAR_FRAME_BOTTOM };
        const F = GEAR_FRAME_SIDE, PB = GP.P, W = 520, H = GP.H, TW = W + F * 2, TH = H + PB;
        const SIDE = 120; // espaço dos lados pra animação da gear exclusiva
        const stage = cv.parentElement;
        const availH = Math.max(200, stage.clientHeight - 4), availW = Math.max(150, stage.clientWidth - 4);
        const cssH = Math.min(availH, availW * TH / (TW + SIDE * 2)), cssW = cssH * (TW + SIDE * 2) / TH;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
        if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; }
        const c = cv.getContext('2d');
        const k = ph / TH, ox = SIDE * k;
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, pw, ph);
        const dt = Math.min(3, PV.last ? (now - PV.last) / (1000 / 60) : 1); PV.last = now;
        const t = now - PV.t0;
        const mode = typeof currentMode !== 'undefined' ? currentMode : '4K';
        const strikeY = H - 80;
        const spd = typeof scrollSpeed !== 'undefined' ? scrollSpeed : 3;
        const speed = speedFactorForTravel(spd, H);
        const save = { gearSkin, currentMode, noteShape, ctx, keyState, lw: canvas.logicalWidth, lh: canvas.logicalHeight, hp: hpDisplayed };
        let hits = [];
        try {
            pvCfg = { hitFx: draftVal('hit'), gearFx: draftVal('gfx'), palette: draftVal('cores'), fxFull: r.full, torcida: torcDraft() };
            gearSkin = r.gear; currentMode = mode; noteShape = r.shape; ctx = c;
            canvas.logicalWidth = W; canvas.logicalHeight = H; hpDisplayed = 100;
            c.setTransform(k, 0, 0, k, ox, 0);
            const cols = getGameplayColumnLayout(mode, W);
            const colors = getKeyColorScheme(mode, r.gear);
            const lastT = PV.notes.length ? PV.notes[PV.notes.length - 1].time : t;
            for (let nt = lastT + 180; nt < t + noteTravelMsForSpeed(spd) + 200; nt += 180 + ((Math.round(nt / 180)) % 3 === 0 ? 180 : 0)) {
                const lane = Math.floor((Math.sin(nt * 0.0137) * 0.5 + 0.5) * cols.length) % cols.length;
                PV.notes.push({ time: nt, lane, hold: Math.round(nt / 180) % 7 === 0 ? 420 : 0 });
            }
            keyState = cols.map((_, i) => (PV.keyUntil[i] || 0) > t);
            const L = { frame: true, F, P: PB, W, H, totalW: TW, totalH: TH, theme: th };
            const P = make2DPainter(c);
            P.sprite(gearFrameSpec(L), 0, 0);
            P.offset(F, 0, () => {
                drawGearLaneBase(P, L, true);
                const nh = NOTE_HEIGHT_BASE * (typeof noteSizeScale !== 'undefined' ? noteSizeScale : 1);
                PV.notes = PV.notes.filter(n => {
                    const end = n.time + n.hold;
                    if (end <= t) {
                        const col = cols[n.lane];
                        const f = { x: col.x + col.width / 2, y: strikeY, life: 1, color: colors[n.lane], big: Math.round(n.time / 180) % 4 === 0 };
                        PV.flashes.push(f); hits.push({ f, w: col.width });
                        PV.keyUntil[n.lane] = t + 90;
                        return false;
                    }
                    const y = strikeY - (n.time - t) * speed;
                    if (n.hold) {
                        const ty = strikeY - (end - t) * speed;
                        if (ty < strikeY + 40) drawHoldNote(n.lane, Math.min(y, strikeY), ty, cols[n.lane], n.time <= t);
                        if (n.time <= t) PV.keyUntil[n.lane] = t + 60;
                    }
                    if (n.time > t && y > -60) drawNote(n.lane, y, cols[n.lane], nh);
                    return true;
                });
                drawGearStrikeLine(P, L, th.accent);
                drawGearKeyPanel(P, L, 0);
                PV.flashes = PV.flashes.filter(f => { drawGearHitFlash(P, f); f.life -= 0.07 * dt; return f.life > 0; });
            });
            drawGearFrameDynamic(P, L, 0);
            // efeito de acerto (mesmas partículas do jogo)
            const fxApi = window.NOTAS_FX_API;
            if (fxApi) {
                if (r.hitId && r.hitId !== 'padrao' && fxApi.has(r.hitId)) hits.forEach(h => fxApi.spawn(PV.fx, r.hitId, F + h.f.x, h.f.y, h.w, h.f.color, h.f.big));
                c.setTransform(k, 0, 0, k, ox, 0);
                fxApi.step(c, PV.fx, dt / 60, now);
            }
        } catch (e) { console.warn('[coleção] prévia', e); }
        finally {
            gearSkin = save.gearSkin; currentMode = save.currentMode; noteShape = save.noteShape; ctx = save.ctx; keyState = save.keyState;
            canvas.logicalWidth = save.lw; canvas.logicalHeight = save.lh; hpDisplayed = save.hp; pvCfg = null;
        }
        // animação da gear exclusiva nas laterais
        const api = window.SKINFX_API;
        if (api && r.gfxId && api.FX[r.gfxId]) {
            if (PV.gfxId !== r.gfxId) { PV.S = api.newState(); PV.gfxId = r.gfxId; }
            const R = { x: ox, y: 0, w: TW * k, h: (r.full ? TH : H) * k, pw: F * k, side: SIDE * k * 0.9, scale: ph / 900 };
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.save(); c.beginPath(); c.rect(0, 0, pw, ph); c.rect(ox + F * k, 0, W * k, ph); c.clip('evenodd');
            api.warmUp(PV.S, api.FX[r.gfxId], R);
            const beats = now / 500, pulse = Math.exp(-(beats - Math.floor(beats)) * 6);
            api.step(c, PV.S, api.FX[r.gfxId], R, now, pulse, hits.map(h => ({ x: ox + (F + h.f.x) * k, y: h.f.y * k })));
            c.restore();
        } else PV.gfxId = null;
        // torcida 8-bit nos cantos
        const TA = window.TORCIDA_API, tc = torcDraft();
        if (TA && (tc.L || tc.R)) {
            if (!PV.T) PV.T = TA.novoEstado();
            PV.hitsN = (PV.hitsN || 0) + hits.length;
            if (hits.length) { const marco = PV.hitsN >= 40 ? (PV.hitsN = 0, 50) : 0; TA.reagir(PV.T, { hit: hits.length, brk: false, marco }, tc); }
            const bw = SIDE * k * 0.86, bh = bw / 0.62;
            c.setTransform(1, 0, 0, 1, 0, 0);
            const beats = now / 500, pulse = Math.exp(-(beats - Math.floor(beats)) * 6);
            TA.desenhar(c, PV.T, tc, { L: { x: (ox - bw) / 2, y: ph * 0.97 - bh, w: bw, h: bh }, R: { x: ox + TW * k + (ox - bw) / 2, y: ph * 0.97 - bh, w: bw, h: bh } }, now, pulse);
        }
    }

    // ---------- testar na pista (45 s, com aviso e saída suave) ----------
    const TESTE_MS = 45000, AVISO_MS = 10000;
    // durante o teste a partida não conta pra nada (recorde, histórico, EXP, desafios, ranking)
    if (typeof window.afterRunFinished === 'function') {
        const orig = window.afterRunFinished;
        window.afterRunFinished = function () { if (teste || window.__bmTeste) return; return orig.apply(this, arguments); };
    }
    function testar() {
        if (teste) return;
        const r = resolve();
        const salvo = { gearSkin, noteShape };
        const gear = r.gear;
        if (gear.startsWith('shop_') && !(typeof GEAR_THEMES !== 'undefined' && GEAR_THEMES[gear]) && window.lojaRegistrar) window.lojaRegistrar(gear.slice(5));
        teste = { cfg: { hitFx: draftVal('hit'), gearFx: draftVal('gfx'), palette: draftVal('cores'), fxFull: r.full, torcida: torcDraft() }, salvo, t0: 0, started: false, saindo: false };
        try { salvo.noFail = noFailMode; noFailMode = true; } catch (e) {} // no teste ninguém "morre" no meio
        window.__bmTeste = true;
        fechar();
        gearSkin = gear; noteShape = r.shape;
        try { resizeCanvas(); if (typeof glResetGearCache === 'function') glResetGearCache(); } catch (e) {}
        try {
            const pat = typeof currentPatternType !== 'undefined' ? currentPatternType : '';
            if (!pat || (typeof DRILLS !== 'undefined' && DRILLS[pat] && DRILLS[pat].calibration)) currentPatternType = 'staircase';
            if (window.bmAbrirSelecao) window.bmAbrirSelecao();
            $('btn-start').click();
        } catch (e) { console.warn(e); }
        const tag = document.createElement('div'); tag.id = 'col-teste'; document.body.appendChild(tag);
        const t0 = performance.now();
        const tick = () => {
            if (!teste) return;
            const playing = typeof isPlaying !== 'undefined' && isPlaying;
            const paused = typeof isPaused !== 'undefined' && isPaused;
            if (playing && !teste.started) { teste.started = true; teste.t0 = performance.now(); }
            if (!teste.started) { if (performance.now() - t0 > 20000) { fimTeste(); return; } setTimeout(tick, 250); return; } // ainda abrindo (abertura/contagem)
            if (!playing) { fimTeste(); return; } // saiu pelo menu de pausa ou a música acabou
            if (!paused) teste.t0 += 0; // (o tempo de pausa não é descontado de propósito: simples e previsível)
            const left = TESTE_MS - (performance.now() - teste.t0);
            const sec = Math.max(0, Math.ceil(left / 1000));
            tag.className = left < AVISO_MS ? 'fim' : '';
            tag.innerHTML = left < AVISO_MS ? `⏳ O teste termina em <b>${sec}</b>…` : `🎨 Testando o visual · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · sem EXP e sem ranking · Esc sai`;
            if (left <= 0 && !teste.saindo) { saidaSuave(); return; }
            setTimeout(tick, 200);
        };
        setTimeout(tick, 300);
    }
    // fim do tempo: escurece a tela, aí volta pro Personalizar
    function saidaSuave() {
        teste.saindo = true;
        const v = document.createElement('div'); v.id = 'col-fade';
        v.innerHTML = '<div>FIM DO TESTE</div><small>voltando pro Personalizar…</small>';
        document.body.appendChild(v);
        requestAnimationFrame(() => v.classList.add('on'));
        try { if (typeof audio !== 'undefined' && audio.music && audio.music.volume != null) { const m = audio.music, v0 = m.volume; let i = 0; const f = setInterval(() => { i++; try { m.volume = Math.max(0, v0 * (1 - i / 10)); } catch (e) {} if (i >= 10) clearInterval(f); }, 90); } } catch (e) {}
        setTimeout(() => { fimTeste(); setTimeout(() => { v.classList.remove('on'); setTimeout(() => v.remove(), 600); }, 300); }, 1100);
    }
    function fimTeste() {
        if (!teste) return;
        const s = teste.salvo;
        try { if (typeof isPlaying !== 'undefined' && isPlaying) $('btn-pause-menu')?.click(); } catch (e) {}
        try { document.getElementById('stats-overlay')?.classList.add('hidden'); document.getElementById('pause-modal')?.classList.add('hidden'); document.getElementById('menu-overlay')?.classList.remove('hidden'); } catch (e) {}
        gearSkin = s.gearSkin; noteShape = s.noteShape;
        try { if (typeof s.noFail === 'boolean') noFailMode = s.noFail; } catch (e) {}
        try { resizeCanvas(); if (typeof glResetGearCache === 'function') glResetGearCache(); if (typeof saveSettings === 'function') saveSettings(); } catch (e) {}
        teste = null;
        setTimeout(() => { window.__bmTeste = false; }, 1500);
        $('col-teste')?.remove();
        const keep = ui.draft, slot = ui.slot;
        abrir(slot); ui.draft = keep; render();
    }
    window.openColecao = abrir;
    window.bmTestandoVisual = () => !!teste || !!window.__bmTeste;
})();
