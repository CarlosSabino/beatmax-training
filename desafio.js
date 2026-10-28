// =====================================================================================
// desafio.js — DESAFIO DO DIA + BEATCOINS + LOJA.
//
//  • Todo dia sorteia um treino (com dificuldade e meta de precisão). O sorteio usa a data,
//    então o desafio é o mesmo o dia todo (e muda à meia-noite).
//  • Ao abrir o jogo, na tela de seleção, aparece o convite (uma vez por dia, até concluir).
//  • Concluiu (música inteira, sem falhar, velocidade 100%, precisão >= meta): +10 beatcoins.
//    Só vale uma vez por dia.
//  • Na LOJA, as beatcoins compram gears exclusivas. Tudo grátis — é só jogar.
//  • Moedas, compras e sequência são de cada perfil (e entram no backup).
// =====================================================================================
(function () {
    const KEY = 'djmaxBeatcoins_v1';
    const REWARD = 10;
    // meta mínima por dificuldade: NORMAL/HARD pedem S, EXPERT/MASTER pedem A
    const GOALS = { NM: 97, HD: 97, MX: 93, SC: 90 };
    const gradeOf = (acc) => acc >= 100 ? 'P' : acc >= 97 ? 'S' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : 'C';
    // bônus pela nota da partida que concluiu o desafio
    const bonusFor = (acc) => acc >= 100 ? 10 : acc >= 97 ? 5 : 0;
    const DIFF_NAME = { NM: 'NORMAL', HD: 'HARD', MX: 'EXPERT', SC: 'MASTER' };
    let st = { coins: 0, owned: [], done: {}, streak: 0, lastDone: '', challenge: null, shownDate: '', anim: true };
    try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
    // Sempre relê antes de mexer: se o jogo estiver aberto em DUAS janelas/abas, uma não
    // sobrescreve as moedas que a outra ganhou (era assim que o saldo "voltava" 10 moedas).
    let lastRaw = null;
    const reload = () => {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw && raw !== lastRaw) { lastRaw = raw; Object.assign(st, JSON.parse(raw)); }
        } catch (e) {}
    };
    let saveWarned = false;
    const save = () => {
        try { const raw = JSON.stringify(st); localStorage.setItem(KEY, raw); lastRaw = raw; }
        catch (e) {
            console.warn('[beatcoins] não deu pra salvar', e);
            if (!saveWarned) { saveWarned = true; setTimeout(() => toast('⚠️ Não consegui salvar suas Beatcoins: o armazenamento do navegador está cheio. Faça um backup e limpe o histórico/replays antigos.', 9000), 500); }
        }
    };
    window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith(KEY)) { reload(); try { chip(); } catch (er) {} } });
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const pad = (n) => String(n).padStart(2, '0');
    const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dateKey(d); };

    // ---------- loja: gears exclusivas ----------
    function mk(h, style, extra) {
        const t = typeof skinThemeFromHue === 'function' ? skinThemeFromHue(h, style) : JSON.parse(JSON.stringify(GEAR_THEMES.respect));
        return Object.assign(t, extra || {});
    }
    const SHOP = [
        { id: 'aurora', name: 'Aurora Boreal', price: 30, desc: 'Cortinas de aurora ondulando nas laterais.', theme: () => mk(165, 'neon'), fx: { burst: 'ring', size: 1.1, column: 1.2, keybeam: true, beam: 0.4 } },
        { id: 'magma', name: 'Magma', price: 50, desc: 'Paredes de lava borbulhando e brasas subindo.', theme: () => mk(12, 'hazard'), fx: { burst: 'spark', size: 1.25, column: 1.3, keybeam: true, beam: 0.5 } },
        { id: 'oceano', name: 'Oceano Profundo', price: 70, desc: 'Bolhas subindo e raios de luz do fundo do mar.', theme: () => mk(205, 'prism'), fx: { burst: 'ring', size: 1.3, column: 1, keybeam: true, beam: 0.45 } },
        { id: 'sakura', name: 'Sakura Noturna', price: 100, desc: 'Pétalas de cerejeira caindo dos dois lados.', theme: () => mk(330, 'filigree'), fx: { burst: 'star', size: 1.2, column: 1.1, keybeam: true, beam: 0.4 } },
        { id: 'ouro', name: 'Ouro Real', price: 150, desc: 'Pilares com brilhos de ouro e pó dourado caindo.', theme: () => mk(44, 'filigree', { accent: '#fde047' }), fx: { burst: 'spark', size: 1.45, column: 1.6, keybeam: true, beam: 0.55 } },
        { id: 'grafite', name: 'Grafite da Jade', price: 120, desc: 'Muros de concreto que a Jade grafita a cada acerto: respingos neon que vão se acumulando.', theme: () => mk(140, 'neon', { accent: '#ff3fb4' }), fx: { burst: 'spark', size: 1.3, column: 1.3, keybeam: true, beam: 0.5 } },
        { id: 'cosmos', name: 'Vazio Cósmico', price: 200, desc: 'Estrelas em órbita, cometas e névoa roxa. A mais rara.', theme: () => mk(272, 'neon', { accent: '#c084fc' }), fx: { burst: 'star', size: 1.7, column: 2, keybeam: true, beam: 0.7 } }
    ];
    const shopKey = (it) => 'shop_' + it.id;
    // torcida 8-bit (torcida.js): personagens em pixel ao lado da gear
    const TORC = () => (window.TORCIDA_API ? window.TORCIDA_API.LIST : []);
    const torcKey = (id) => 'torc_' + id;
    function registerShop(it) {
        const key = shopKey(it);
        if (GEAR_THEMES[key]) return key;
        const th = it.theme();
        GEAR_THEMES[key] = Object.assign(th, { label: `${it.name} ★`, custom: true, shop: true, fx: Object.assign({ burst: 'star', size: 1, column: 1, keybeam: true, beam: 0.35 }, it.fx), laneImg: null, laneImgAlpha: 0.35, noteShape: '' });
        if (typeof SKIN_PALETTES !== 'undefined') SKIN_PALETTES[key] = Object.assign({ side: typeof SIDE_NOTE_COLOR !== 'undefined' ? SIDE_NOTE_COLOR : '#4ade80' }, th.palette);
        return key;
    }
    function fillGearSelect() {
        const sel = document.getElementById('main-gear-skin');
        if (!sel) return;
        let og = document.getElementById('shop-optgroup');
        if (!og) { og = document.createElement('optgroup'); og.id = 'shop-optgroup'; og.label = 'Exclusivas (loja)'; sel.insertBefore(og, sel.firstChild); }
        const owned = SHOP.filter(it => st.owned.includes(it.id));
        og.innerHTML = owned.map(it => `<option value="${shopKey(it)}">${esc(it.name)} ★</option>`).join('');
        og.hidden = !owned.length;
        if (typeof gearSkin !== 'undefined' && [...sel.options].some(o => o.value === gearSkin)) sel.value = gearSkin;
    }
    // registra o que já foi comprado ANTES do jogo carregar as configurações (gear salva = exclusiva)
    SHOP.filter(it => st.owned.includes(it.id)).forEach(registerShop);
    fillGearSelect();

    // ---------- loja: skins de NOTAS exclusivas (notas-loja.js) ----------
    const NOTES = window.NOTAS_LOJA || [];
    const noteKey = (it) => 'nota_' + it.id;
    function fillNoteSelect() {
        const sel = document.getElementById('main-note-shape');
        if (!sel) return;
        let og = document.getElementById('shop-note-optgroup');
        if (!og) { og = document.createElement('optgroup'); og.id = 'shop-note-optgroup'; og.label = 'Exclusivas (loja)'; sel.insertBefore(og, sel.firstChild); }
        const owned = NOTES.filter(it => st.owned.includes(noteKey(it)));
        og.innerHTML = owned.map(it => `<option value="${it.shape}">${esc(it.name)} ★</option>`).join('');
        og.hidden = !owned.length;
        if (typeof noteShape !== 'undefined' && [...sel.options].some(o => o.value === noteShape)) sel.value = noteShape;
    }
    fillNoteSelect();
    function useNote(shape) {
        const sel = document.getElementById('main-note-shape');
        if (sel) { sel.value = shape; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        else { noteShape = shape; if (typeof saveSettings === 'function') saveSettings(); }
    }
    // skin de nota exclusiva que este perfil não comprou (ex.: backup de outro perfil) volta pra Clássica
    function checkNoteOwned() {
        if (typeof noteShape !== 'string' || !noteShape.startsWith('sk_')) return;
        const it = NOTES.find(x => x.shape === noteShape);
        if (it && st.owned.includes(noteKey(it))) return;
        useNote('djmax');
    }

    function useSkin(key) {
        const sel = document.getElementById('main-gear-skin');
        if (sel) { sel.value = key; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        else { gearSkin = key; if (typeof saveSettings === 'function') saveSettings(); }
    }

    // ---------- desafio do dia ----------
    function todayChallenge() {
        const today = dateKey();
        if (st.challenge && st.challenge.date === today && DRILLS[st.challenge.drill]) { st.challenge.goal = GOALS[st.challenge.diff]; return st.challenge; }
        const mode = (typeof currentMode !== 'undefined' && ['4K', '5K', '6K', '8K'].includes(currentMode)) ? currentMode : '4K';
        const ids = Object.keys(DRILLS).filter(id => { const d = DRILLS[id]; return !d.calibration && (!d.modes || d.modes.includes(mode)); }).sort();
        const rnd = (typeof mulberry32 === 'function' && typeof hashString === 'function') ? mulberry32(hashString(`desafio|${today}|${mode}`)) : Math.random;
        const drill = ids[Math.floor(rnd() * ids.length)];
        const r = rnd();
        const diff = r < 0.3 ? 'NM' : r < 0.72 ? 'HD' : r < 0.95 ? 'MX' : 'SC';
        st.challenge = { date: today, drill, diff, mode, goal: GOALS[diff] };
        save();
        return st.challenge;
    }
    const doneToday = () => !!st.done[dateKey()];

    // ---------- estilo ----------
    const css = document.createElement('style');
    css.textContent = `
#bc-chip{margin-left:6px;align-self:center;display:flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid #475569;background:rgba(30,41,59,.8);color:#fde68a;font:800 12px Orbitron,monospace;cursor:pointer;position:relative}
#bc-chip:hover{background:#334155}
#bc-chip .dot{position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:#f43f5e;box-shadow:0 0 8px #f43f5e;display:none}
#bc-chip.todo .dot{display:block}
.bc-coin{display:inline-block;width:18px;height:18px;background:url('assets/beatcoin.png') center/contain no-repeat;vertical-align:-4px;filter:drop-shadow(0 0 4px rgba(250,204,21,.45))}
.bc-coin.md{width:26px;height:26px;vertical-align:-7px}
.bc-coin.big{width:58px;height:58px;vertical-align:middle;background-image:url('assets/beatcoin-hd.png');filter:drop-shadow(0 0 10px rgba(250,204,21,.55))}
#bc-ov .wallet{display:flex;align-items:center;justify-content:center;gap:14px;margin:14px auto 0;padding:10px 22px;border-radius:16px;background:linear-gradient(90deg,rgba(120,53,15,.35),rgba(161,98,7,.35));border:1px solid rgba(253,230,138,.45);width:fit-content}
#bc-ov .wallet .lbl{font:800 11px Orbitron,monospace;letter-spacing:.14em;color:#fcd34d;text-transform:uppercase}
#bc-ov .wallet .n{font:900 34px Orbitron,monospace;color:#fffbeb;line-height:1;text-shadow:0 0 12px rgba(250,204,21,.5)}
#bc-ov .wallet .u{font:700 14px Rajdhani,sans-serif;color:#fde68a}
#bc-ov .reward{display:flex;align-items:center;justify-content:center;gap:8px;font:900 19px Orbitron,monospace;color:#fde68a;margin-top:14px}
#bc-ov{position:fixed;inset:0;z-index:150;background:rgba(2,6,23,.88);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;color:#e2e8f0}
#bc-ov .bx{width:min(1080px,96vw);max-height:90vh;overflow-y:auto;background:linear-gradient(180deg,#111a2e,#0b1222);border:1px solid #334155;border-radius:18px;padding:22px 26px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
#bc-ov .bx.wide{width:min(980px,96vw)}
#bc-ov h2{font-family:Orbitron,monospace;font-weight:900;font-size:22px;letter-spacing:.08em;color:#fde68a;text-align:center}
#bc-ov .sub{text-align:center;color:#94a3b8;font-size:15px;margin-top:4px}
#bc-ov .card{margin-top:16px;border:1px solid #1e293b;border-radius:14px;background:#0f172a;padding:14px 16px}
#bc-ov .drill{display:flex;align-items:center;gap:14px}
#bc-ov .ico{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;font:900 18px Orbitron,monospace;background:linear-gradient(135deg,rgba(34,211,238,.25),#0f172a);border:1px solid rgba(34,211,238,.4);color:#67e8f9;flex-shrink:0}
#bc-ov .dt{font-family:Orbitron,monospace;font-weight:800;font-size:19px;color:#fff}
#bc-ov .dd{font-size:14px;color:#94a3b8;line-height:1.3}
#bc-ov .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
#bc-ov .tag{font:800 11px Orbitron,monospace;padding:3px 10px;border-radius:999px;border:1px solid #334155;color:#cbd5e1}
#bc-ov .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px}
#bc-ov button{padding:9px 16px;border-radius:10px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:15px;font-weight:700;cursor:pointer}
#bc-ov button:hover{background:#334155}
#bc-ov button.pri{background:linear-gradient(90deg,#f59e0b,#facc15);border-color:#fde68a;color:#1c1917}
#bc-ov button:disabled{opacity:.45;cursor:default}
#bc-ov .ok{color:#86efac;font-weight:800;text-align:center;font-size:17px;margin-top:12px}
#bc-ov .bal{display:flex;justify-content:center;align-items:center;gap:8px;font:900 20px Orbitron,monospace;color:#fde68a;margin-top:8px}
#bc-ov .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin-top:16px}
#bc-ov .item{border:1px solid #1e293b;border-radius:14px;background:#0f172a;padding:12px;display:flex;flex-direction:column;gap:8px}
#bc-ov .item.own{border-color:rgba(74,222,128,.5)}
#bc-ov .item.use{border-color:#facc15;box-shadow:0 0 14px rgba(250,204,21,.25)}
#bc-ov .prev{height:120px;border-radius:10px;display:flex;justify-content:center;align-items:stretch;padding:0 10px;position:relative;overflow:hidden}
#bc-ov .prev .pil{width:12px}
#bc-ov .prev .lanes{flex:1;display:flex;position:relative}
#bc-ov .prev .ln{flex:1;border-right:1px solid rgba(255,255,255,.06);position:relative}
#bc-ov .prev .nt{position:absolute;left:12%;right:12%;height:8px;border-radius:2px}
#bc-ov .prev .jl{position:absolute;left:0;right:0;bottom:16px;height:3px}
#bc-ov canvas.nprev{width:100%;height:auto;aspect-ratio:230/150;border-radius:10px;display:block}
#bc-ov .tprev{aspect-ratio:230/150;border-radius:10px;background:radial-gradient(ellipse at 50% 90%,rgba(167,139,250,.25),#0b1022 70%);display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
#bc-ov .tprev{position:relative}#bc-ov .tprev canvas{position:absolute;inset:0;width:100%;height:100%}
#bc-ov .tprev img{height:92%;image-rendering:pixelated;animation:bcTorc 1s ease-in-out infinite}#bc-ov .tprev canvas.on+img{display:none}
@keyframes bcTorc{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
#bc-ov .in{font-family:Orbitron,monospace;font-weight:800;font-size:14px;color:#fff}
#bc-ov .idsc{font-size:13px;color:#94a3b8;line-height:1.25;min-height:32px}
#bc-ov .wkbox{padding:12px 14px}
#bc-ov .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:12px;align-items:start}
@media (max-width:900px){#bc-ov .cols{grid-template-columns:1fr}}
#bc-ov .colh{font:900 14px Orbitron,monospace;letter-spacing:.08em;color:#fde68a;display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}
#bc-ov .colh span{font:600 12px Rajdhani,sans-serif;color:#94a3b8;letter-spacing:0}
#bc-ov .wk-h{display:flex;justify-content:space-between;align-items:baseline;font:900 14px Orbitron,monospace;letter-spacing:.08em;color:#fde68a;margin-bottom:8px}
#bc-ov .wk-end{font:600 12px Rajdhani,sans-serif;color:#94a3b8;letter-spacing:0}
#bc-ov .wk{padding:8px 0;border-top:1px solid #1e293b}
#bc-ov .wk:first-of-type{border-top:0}
#bc-ov .wk-top,#bc-ov .wk-bot{display:flex;justify-content:space-between;gap:10px;align-items:center}
#bc-ov .wk-t{font-weight:800;font-size:15px;color:#f1f5f9}
#bc-ov .wk-r{font:800 13px Orbitron,monospace;color:#fde68a;white-space:nowrap}
#bc-ov .wk-bar{height:9px;border-radius:6px;background:#1e293b;overflow:hidden;margin:6px 0 4px}
#bc-ov .wk-bar div{height:100%;background:linear-gradient(90deg,#f59e0b,#fde047);border-radius:6px}
#bc-ov .wk.wdone .wk-bar div{background:linear-gradient(90deg,#16a34a,#4ade80)}
#bc-ov .wk.wdone .wk-t{color:#86efac}
#bc-ov .wk-d{font-size:12.5px;color:#94a3b8;line-height:1.25}
#bc-ov .wk-n{font:800 12px Orbitron,monospace;color:#cbd5e1;white-space:nowrap}
#bc-toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:200;background:linear-gradient(90deg,#78350f,#a16207);border:1px solid #fde68a;border-radius:14px;padding:12px 20px;color:#fffbeb;font:800 16px Rajdhani,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6);text-align:center;pointer-events:none}
#bc-toast b{font-family:Orbitron,monospace}
#bc-cele{position:fixed;inset:0;z-index:170;background:rgba(2,6,23,.72);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;color:#fffbeb;opacity:0;transition:opacity .35s ease;cursor:pointer;overflow:hidden}
#bc-cele.on{opacity:1}
#bc-cele .stage{position:relative;width:min(980px,92vw,calc(86vh * 16 / 9));aspect-ratio:16/9;border-radius:24px;overflow:hidden;background:#070a12;border:2px solid rgba(253,230,138,.6);box-shadow:0 0 0 6px rgba(250,204,21,.08),0 0 80px rgba(250,204,21,.28),0 30px 80px rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;transform:scale(.85) translateY(20px);transition:transform .45s cubic-bezier(.2,1.4,.4,1)}
#bc-cele.on .stage{transform:none}
#bc-cele video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
#bc-cele .vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(2,6,23,.55) 0%,rgba(2,6,23,.15) 45%,rgba(2,6,23,0) 70%);pointer-events:none}
#bc-cele .cb{position:relative;text-align:center;padding:22px 40px 16px;border-radius:22px;background:rgba(8,12,24,.62);border:1px solid rgba(253,230,138,.55);box-shadow:0 0 60px rgba(250,204,21,.25),0 20px 60px rgba(0,0,0,.6);backdrop-filter:blur(4px);transform:scale(.6);opacity:0;transition:transform .45s cubic-bezier(.2,1.6,.4,1),opacity .3s ease;max-width:min(560px,92vw)}
#bc-cele.pop .cb{transform:scale(1);opacity:1}
#bc-cele.leve .cb{margin-top:-14%}
#bc-cele .cc{width:104px;height:104px;margin:-74px auto 4px;background:url('assets/beatcoin-hd.png') center/contain no-repeat;filter:drop-shadow(0 0 22px rgba(250,204,21,.7));animation:bcSpin 2.4s ease-in-out infinite}
@keyframes bcSpin{0%,100%{transform:rotateY(0deg) translateY(0)}50%{transform:rotateY(180deg) translateY(-6px)}}
#bc-cele .ct{font:900 22px Orbitron,monospace;letter-spacing:1px;color:#fde68a;text-shadow:0 0 18px rgba(250,204,21,.6)}
#bc-cele .cp{font:900 56px Orbitron,monospace;line-height:1.1;margin:6px 0 2px;background:linear-gradient(180deg,#fff7c2,#facc15 55%,#b45309);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 2px 0 rgba(0,0,0,.4))}
#bc-cele .cp small{font-size:22px;letter-spacing:1px}
#bc-cele .cl{font-size:16px;font-weight:700;color:#fef3c7;line-height:1.45}
#bc-cele .cl b{color:#fde68a}
#bc-cele .cs{margin-top:12px;display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:rgba(0,0,0,.45);border:1px solid rgba(253,230,138,.35);font-weight:800;font-size:15px;letter-spacing:1px;color:#e2e8f0}
#bc-cele .cs b{font:900 22px Orbitron,monospace;color:#fde047}
#bc-cele .ch{margin-top:12px;font-size:12.5px;color:#94a3b8;letter-spacing:.5px}`;
    document.head.appendChild(css);

    // ---------- chip no topo (moedas; pontinho = desafio de hoje pendente) ----------
    function chip() {
        let b = document.getElementById('bc-chip');
        const ref = document.getElementById('nov-btn') || document.getElementById('app-version-badge');
        if (!ref) return;
        if (!b) {
            b = document.createElement('button');
            b.id = 'bc-chip'; b.type = 'button';
            b.addEventListener('click', () => openChallenge());
            ref.insertAdjacentElement('afterend', b);
        }
        b.innerHTML = `<span class="bc-coin md"></span><span style="font-size:14px">${st.coins}</span><span style="font-size:11px">🎯</span><span class="dot"></span>`;
        b.title = doneToday() ? `Beatcoins: ${st.coins} · Desafio de hoje concluído ✔` : `Beatcoins: ${st.coins} · Desafio do dia pendente`;
        b.classList.toggle('todo', !doneToday());
    }

    let irisDisse = '';
    const fala = (k, list) => typeof window.beatmaxFala === 'function' ? window.beatmaxFala(k, list) : list[0];
    function overlay(html, wide, ch) {
        const prev = document.getElementById('bc-ov');
        const still = !!(ch && prev && prev.dataset.ch === ch.who);
        prev?.remove();
        const ov = document.createElement('div');
        ov.id = 'bc-ov';
        ov.innerHTML = `<div class="bx${wide ? ' wide' : ''}">${html}</div>`;
        if (ch && typeof window.beatmaxPersonagem === 'function') { ov.dataset.ch = ch.who; window.beatmaxPersonagem(ov, ch.who, ch.say, ch.bxw, still); }
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
        document.body.appendChild(ov);
        document.addEventListener('keydown', onKey, true);
        return ov;
    }
    function close() { document.getElementById('bc-ov')?.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) {
        if (!document.getElementById('bc-ov')) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
        if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); document.querySelector('#bc-ov button.pri:not(:disabled)')?.click(); return; }
        e.stopImmediatePropagation();
    }

    // ---------- DESAFIOS SEMANAIS ----------
    // Renovam toda segunda-feira. Contam partidas CONCLUÍDAS (música inteira, sem zerar o HP,
    // velocidade 100% ou mais, fora replays). Se a partida que completa a missão for 100%: +10.
    const WEEK_BONUS_P = 10;
    const PERFECT_WEIGHT_DRILL = { NM: 1, HD: 1.25, MX: 1.5, SC: 2 };
    const PERFECT_WEIGHT_TIER = { easy: 0.75, normal: 1, hard: 1.25, expert: 1.5, master: 2 };
    const WEEKLY = [
        { id: 'perfeitas', icon: '💎', title: 'Notas perfeitas na semana', goal: 10000, reward: 40,
          desc: 'Cada MAX 100% conta. Dificuldades maiores valem mais: NORMAL ×1 · HARD ×1,25 · EXPERT ×1,5 · MASTER ×2 (EASY ×0,75).' },
        { id: 'diferentes', icon: '🎵', title: 'Músicas diferentes concluídas', goal: 10, reward: 30,
          desc: 'Repetir a mesma música não conta — mas a mesma música em outra dificuldade conta como diferente.' },
        { id: 'modos', icon: '🎹', title: 'Concluir em 4B, 5B, 6B e 8B', goal: 4, reward: 30,
          desc: 'Pelo menos uma música concluída em cada modo de botões. Bom pra se acostumar com mais teclas!' }
    ];
    function weekKey(d = new Date()) {
        const m = new Date(d); m.setHours(0, 0, 0, 0);
        m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); // segunda-feira
        return dateKey(m);
    }
    function weekState() {
        const wk = weekKey();
        if (!st.week || st.week.key !== wk) st.week = { key: wk, perfeitas: 0, songs: [], modes: [], done: {} };
        return st.week;
    }
    function weekProgress(id) {
        const w = weekState();
        if (id === 'perfeitas') return Math.floor(w.perfeitas);
        if (id === 'diferentes') return w.songs.length;
        if (id === 'modos') return w.modes.length;
        return 0;
    }
    function weekEndsText() {
        const now = new Date(), end = new Date(weekKey() + 'T00:00:00'); end.setDate(end.getDate() + 7);
        const h = Math.max(0, Math.round((end - now) / 3600000));
        return h >= 48 ? `renova em ${Math.ceil(h / 24)} dias` : `renova em ${h}h`;
    }
    function perfectWeight(run) {
        const pat = String(run.pattern || '');
        if (pat.startsWith('custom:') && typeof findCustomChart === 'function' && typeof chartDifficulty === 'function') {
            const ch = findCustomChart(pat.slice(7));
            if (ch) return PERFECT_WEIGHT_TIER[chartDifficulty(ch).tier] || 1;
        }
        return PERFECT_WEIGHT_DRILL[run.diff] || 1;
    }
    function checkWeekly(run, failed) {
        reload();
        if (!run || failed || run.failed || run.section || (run.rate || 1) < 0.999) return;
        if (typeof isCalibrationRun === 'function' && isCalibrationRun()) return;
        const w = weekState();
        if (run.id && w.lastRunId === run.id) return; // mesma partida (ex.: resumo antigo) não conta duas vezes
        w.lastRunId = run.id;
        w.perfeitas += (run.m100 || 0) * perfectWeight(run);
        const songKey = String(run.pattern || '').startsWith('custom:') ? run.pattern : `${run.pattern}|${run.diff}|${run.mode}`;
        if (!w.songs.includes(songKey)) w.songs.push(songKey);
        if (run.mode && !w.modes.includes(run.mode)) w.modes.push(run.mode);
        const msgs = [];
        WEEKLY.forEach(m => {
            if (w.done[m.id] || weekProgress(m.id) < m.goal) return;
            const bonus = run.acc >= 100 ? WEEK_BONUS_P : 0;
            w.done[m.id] = { at: Date.now(), bonus };
            st.coins += m.reward + bonus;
            msgs.push(`${m.icon} <b>${m.title}</b> +${m.reward + bonus}${bonus ? ' (bônus 100%)' : ''}`);
            try { window.nivelBonus && window.nivelBonus(500, `🏆 ${m.title}`); } catch (e) {}
            reward('🏆 DESAFIO SEMANAL CONCLUÍDO!', `${m.icon} ${m.title} <b>+${m.reward + bonus}</b>${bonus ? ' (bônus 100%)' : ''}`, m.reward + bonus, true);
        });
        save();
        if (msgs.length) chip();
    }
    function weeklyHtml() {
        const w = weekState();
        return `<div class="wk-h"><span>🏆 DESAFIOS SEMANAIS</span><span class="wk-end">${weekEndsText()}</span></div>
            ${WEEKLY.map(m => {
                const p = Math.min(m.goal, weekProgress(m.id)), done = !!w.done[m.id], pct = Math.round(p / m.goal * 100);
                const fmtN = (n) => n.toLocaleString('pt-BR');
                return `<div class="wk${done ? ' wdone' : ''}">
                    <div class="wk-top"><span class="wk-t">${m.icon} ${m.title}</span><span class="wk-r">${done ? '✔ +' + (m.reward + (w.done[m.id].bonus || 0)) : '+' + m.reward} <span class="bc-coin"></span></span></div>
                    <div class="wk-bar"><div style="width:${pct}%"></div></div>
                    <div class="wk-bot"><span class="wk-d">${m.desc}</span><span class="wk-n">${fmtN(p)}/${fmtN(m.goal)}</span></div>
                </div>`;
            }).join('')}
            <div class="sub" style="margin-top:6px;font-size:13px">Vale partida concluída (música inteira, sem zerar o HP, velocidade 100%+). Completar uma missão com uma partida <b style="color:#fde68a">100%</b> dá <b>+${WEEK_BONUS_P}</b> de bônus.</div>`;
    }

    function openChallenge() {
        reload();
        const c = todayChallenge();
        const d = DRILLS[c.drill];
        const done = doneToday();
        const now = new Date(), mid = new Date(now); mid.setHours(24, 0, 0, 0);
        const hrs = Math.floor((mid - now) / 3600000), mins = Math.floor((mid - now) / 60000) % 60;
        const ov = overlay(`
            <h2>🎯 DESAFIOS</h2>
            <div class="cols"><div class="col">
            <div class="colh">DESAFIO DO DIA <span>${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} · troca em ${hrs}h${pad(mins)}</span></div>
            <div class="card" style="margin-top:8px">
              <div class="drill"><div class="ico">${esc(d.icon || '♪')}</div>
                <div><div class="dt">${esc(d.title)}</div><div class="dd">${esc(d.desc || d.skill || '')}</div></div></div>
              <div class="tags">
                <span class="tag">${esc(typeof getModeDisplayName === 'function' ? getModeDisplayName(c.mode) : c.mode)}</span>
                <span class="tag" style="border-color:#f59e0b;color:#fcd34d">${DIFF_NAME[c.diff]}</span>
                <span class="tag" style="border-color:#22d3ee;color:#a5f3fc">META: ${gradeOf(c.goal)} (${c.goal}%)</span>
                <span class="tag">${d.bpm ? d.bpm + ' BPM' : ''}</span>
              </div>
              <div class="dd" style="margin-top:10px">Regras: música inteira, sem falhar (HP), velocidade da música em 100% e precisão na meta.</div>
            </div>
            ${done ? `<div class="ok">✔ Concluído hoje! Volte amanhã pra um novo desafio.</div>` : `<div class="reward">Recompensa: +${REWARD} <span class="bc-coin md"></span></div><div class="sub" style="margin-top:2px">Bônus: <b style="color:#fde68a">S</b> (97%+) +5 · <b style="color:#fde68a">P</b> (100%) +10</div>`}
            </div><div class="col"><div class="card wkbox" style="margin-top:0">${weeklyHtml()}</div></div></div>
            <div class="wallet"><span class="bc-coin big"></span><div><div class="lbl">Seu saldo</div><div><span class="n">${st.coins}</span> <span class="u">Beatcoin${st.coins === 1 ? '' : 's'}</span></div></div></div>
            ${st.streak > 1 ? `<div class="sub" style="margin-top:6px">Sequência de ${st.streak} dias seguidos 🔥</div>` : ''}
            <div class="row">
              <button data-x>${done ? 'Fechar' : 'Depois'}</button>
              <button data-shop>🛒 Loja</button>
              <button class="pri" data-go>${done ? 'Jogar de novo' : '▶ Jogar agora'}</button>
            </div>`, false, { who: 'arya', bxw: '1080px', say: fala('arya-des', done ? [
                    `Desafio de hoje concluído, mandou bem! Amanhã tem outro${st.streak > 1 ? ` — já são <b>${st.streak} dias seguidos</b>` : ''}.`,
                    `Feito por hoje! ${st.streak > 1 ? `<b>${st.streak} dias seguidos</b> 🔥 Não quebra a sequência!` : 'Volta amanhã pra começar uma sequência!'}`,
                    'Hoje já foi! Que tal adiantar os <b>desafios semanais</b>?'
                ] : [
                    `Oi! O desafio de hoje é <b>${esc(d.title)}</b> no <b>${DIFF_NAME[c.diff]}</b>. Bora tentar?`,
                    `Hoje é <b>${esc(d.title)}</b>! A meta é <b>${gradeOf(c.goal)} (${c.goal}%)</b>. Você consegue!`,
                    `Chegou o desafio do dia: <b>${esc(d.title)}</b>. Vale <b>+${REWARD}</b> Beatcoins e +250 EXP!`,
                    `${st.streak > 1 ? `Sequência de <b>${st.streak} dias</b>! ` : ''}Bora de <b>${esc(d.title)}</b> no <b>${DIFF_NAME[c.diff]}</b>?`
                ]) });
        ov.querySelector('[data-x]').onclick = close;
        ov.querySelector('[data-shop]').onclick = openShop;
        ov.querySelector('[data-go]').onclick = () => { close(); startChallenge(); };
        st.shownDate = dateKey(); save();
    }

    function startChallenge() {
        const c = todayChallenge();
        if (typeof isPlaying !== 'undefined' && isPlaying) return;
        try {
            if (typeof gameRate !== 'undefined' && Math.abs(gameRate - 1) > 0.001) { gameRate = 1; if (typeof syncRateUI === 'function') syncRateUI(); if (typeof saveRatePref === 'function') saveRatePref(); }
            if (typeof currentMode !== 'undefined' && currentMode !== c.mode) document.querySelector(`.mode-btn[data-mode="${c.mode}"]`)?.click();
            if (currentDifficulty !== c.diff) document.querySelector(`.diff-pill[data-diff="${c.diff}"]`)?.click();
            const card = document.querySelector(`#pattern-grid .pattern-card[data-pattern="${CSS.escape(c.drill)}"]`);
            if (card) { if (card.style.display === 'none') { card.style.display = ''; } card.click(); card.scrollIntoView({ block: 'nearest' }); }
            else { currentPatternType = c.drill; }
            setTimeout(() => document.getElementById('btn-start')?.click(), 120);
        } catch (e) { console.warn('[desafio]', e); }
    }

    function toast(html, ms) {
        document.getElementById('bc-toast')?.remove();
        const t = document.createElement('div');
        t.id = 'bc-toast'; t.innerHTML = html;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), ms || 6500);
    }

    // ---------- fim da partida: conferir o desafio ----------
    if (typeof window.afterRunFinished === 'function') {
        const orig = window.afterRunFinished;
        window.afterRunFinished = function (failed) {
            const wasReplay = typeof replayRun !== 'undefined' && !!replayRun;
            const out = orig.apply(this, arguments);
            if (!wasReplay) {
                try { checkRun(failed); } catch (e) { console.warn('[desafio]', e); }
                try { checkWeekly(typeof lastRunSummary !== 'undefined' && lastRunSummary && lastRunSummary.run, failed); } catch (e) { console.warn('[desafio semanal]', e); }
            }
            return out;
        };
    }
    function checkRun(failed) {
        reload();
        const c = st.challenge;
        if (!c || c.date !== dateKey() || doneToday()) return;
        const run = typeof lastRunSummary !== 'undefined' && lastRunSummary && lastRunSummary.run;
        if (!run || run.pattern !== c.drill || run.mode !== c.mode || run.diff !== c.diff) return;
        if (failed || run.failed) { toast(`🎯 Desafio do dia: não valeu — o HP zerou. Tente de novo!`); return; }
        if (run.section) { toast('🎯 Desafio do dia: precisa ser a música inteira (sem loop de trecho).'); return; }
        if (Math.abs((run.rate || 1) - 1) > 0.001) { toast('🎯 Desafio do dia: precisa ser na velocidade 100%.'); return; }
        const goal = GOALS[c.diff] || c.goal;
        if (run.acc < goal) { toast(`🎯 Quase! <b>${run.acc.toFixed(2).replace(".", ",")}%</b> (${gradeOf(run.acc)}) — a meta é <b>${gradeOf(goal)} (${goal}%)</b>. Tente de novo!`); return; }
        // conclusão!
        const bonus = bonusFor(run.acc);
        st.done[dateKey()] = { acc: run.acc, at: Date.now(), bonus };
        st.streak = st.lastDone === yesterdayKey() ? (st.streak || 0) + 1 : 1;
        st.lastDone = dateKey();
        st.coins += REWARD + bonus;
        // guarda só os últimos 60 dias
        Object.keys(st.done).sort().slice(0, -60).forEach(k => delete st.done[k]);
        save();
        chip();
        try { window.nivelBonus && window.nivelBonus(250, '🎯 Desafio do dia'); } catch (e) {}
        reward('🎯 DESAFIO DO DIA CONCLUÍDO!', `Desafio do dia <b>+${REWARD}</b>${bonus ? ` · bônus ${gradeOf(run.acc)} <b>+${bonus}</b>` : ''}${st.streak > 1 ? ` · ${st.streak} dias seguidos 🔥` : ''}`, REWARD + bonus, bonus >= 10);
    }

    // ---------- comemoração: chuva de Beatcoins ----------
    // Junta tudo o que foi ganho na mesma partida (diário + semanais) numa tela só.
    // Chuva LEVE pro desafio do dia; chuva FORTE pra semanal ou nota P (100%).
    let pend = null;
    function reward(title, line, amount, big) {
        if (!pend) { pend = { titles: [], lines: [], amount: 0, big: false, before: st.coins - amount }; setTimeout(flushReward, 700); }
        if (!pend.titles.includes(title)) pend.titles.push(title);
        pend.lines.push(line); pend.amount += amount; pend.big = pend.big || !!big;
    }
    function flushReward() {
        const p = pend; pend = null;
        if (!p) return;
        p.after = st.coins; p.before = Math.max(0, Math.min(p.before, p.after));
        if (st.anim === false) {
            toast(`${p.titles.join('<br>')}<br>${p.lines.join('<br>')}<br><b>+${p.amount}</b> <span class="bc-coin md"></span> · você tem <b>${p.after} Beatcoins</b>`, 8000);
            return;
        }
        celebrate(p);
    }
    function coinSfx(i) {
        try {
            const A = typeof audio !== 'undefined' ? audio : null;
            const ctx = (A && A.ctx) || coinSfx.c || (coinSfx.c = new (window.AudioContext || window.webkitAudioContext)());
            if (ctx.state === 'suspended') ctx.resume();
            const vol = ((A && A.volume != null) ? A.volume : 0.7) * 0.16;
            const t = ctx.currentTime;
            [1318.5, 1975.5].forEach((f, k) => {
                const o = ctx.createOscillator(), g = ctx.createGain(), t0 = t + k * 0.055;
                o.type = 'triangle'; o.frequency.value = f * (1 + (i || 0) * 0.012);
                g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
                o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + 0.3);
            });
        } catch (e) {}
    }
    function celebrate(p) {
        document.getElementById('bc-cele')?.remove();
        const el = document.createElement('div');
        el.id = 'bc-cele'; if (!p.big) el.className = 'leve';
        const src = p.big ? 'assets/beatcoins-chuva' : 'assets/beatcoins-chuva-leve';
        el.innerHTML = `<div class="stage"><video muted playsinline preload="auto"><source src="${src}.mp4" type="video/mp4"><source src="${src}.webm" type="video/webm"></video><div class="vig"></div>
            <div class="cb"><div class="cc"></div>
              <div class="ct">${p.titles.join('<br>')}</div>
              <div class="cp">+<span data-n>0</span> <small>BEATCOINS</small></div>
              <div class="cl">${p.lines.join('<br>')}</div>
              <div class="cs">SEU SALDO <b data-s>${p.before}</b></div>
              <div class="ch">Enter · Esc · clique para continuar</div></div></div>`;
        document.body.appendChild(el);
        const v = el.querySelector('video');
        let closed = false, timers = [];
        const end = () => {
            if (closed) return; closed = true;
            timers.forEach(clearTimeout);
            document.removeEventListener('keydown', key, true);
            el.classList.remove('on');
            setTimeout(() => el.remove(), 380);
            chip();
        };
        const key = (e) => {
            if (['Enter', 'Escape', ' ', 'NumpadEnter'].includes(e.key) || e.code === 'NumpadEnter') { e.preventDefault(); e.stopImmediatePropagation(); end(); }
            else if (!['F11', 'F12'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
        };
        document.addEventListener('keydown', key, true);
        el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); end(); });
        v.addEventListener('ended', () => timers.push(setTimeout(end, 600)));
        v.querySelector('source:last-child').addEventListener('error', () => timers.push(setTimeout(end, 5000)));
        try { const pr = v.play(); if (pr && pr.catch) pr.catch(() => timers.push(setTimeout(end, 5000))); } catch (e) {}
        requestAnimationFrame(() => el.classList.add('on'));
        // contador: +N e saldo subindo, com "plim" de moeda
        timers.push(setTimeout(() => {
            el.classList.add('pop');
            const n = el.querySelector('[data-n]'), s = el.querySelector('[data-s]');
            const dur = Math.min(1800, 500 + p.amount * 35), t0 = performance.now();
            const ticks = Math.min(14, Math.max(3, p.amount)); let lastTick = -1;
            const step = (now) => {
                if (closed) return;
                const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
                n.textContent = Math.round(p.amount * e);
                s.textContent = Math.round(p.before + (p.after - p.before) * e);
                const tk = Math.floor(e * ticks);
                if (tk !== lastTick && tk < ticks) { lastTick = tk; coinSfx(tk); }
                if (k < 1) requestAnimationFrame(step); else coinSfx(ticks + 4);
            };
            requestAnimationFrame(step);
        }, p.big ? 900 : 1500));
        timers.push(setTimeout(end, 14000)); // segurança
    }
    window.beatcoinsComemorar = function (big) {
        celebrate({ titles: [big ? '🏆 DESAFIO SEMANAL CONCLUÍDO!' : '🎯 DESAFIO DO DIA CONCLUÍDO!'], lines: ['(só uma prévia — nenhuma moeda foi adicionada)'], amount: big ? 40 : 15, big: !!big, before: st.coins, after: st.coins + (big ? 40 : 15) });
    };

    // opção nas Configurações
    (function ui() {
        const anchor = document.getElementById('setting-palco');
        const host = anchor && anchor.closest('.flex.flex-col');
        if (!host || document.getElementById('setting-bcanim')) return;
        const row = document.createElement('label');
        row.className = 'flex items-center justify-between gap-3 cursor-pointer';
        row.innerHTML = `<span><span class="text-xs font-bold text-slate-200 block">Comemoração ao ganhar Beatcoins</span>
            <span class="text-[10px] text-slate-400">Chuva de moedas na tela ao concluir um desafio (leve no diário, forte no semanal e no 100%). Desligado, mostra só um aviso.</span></span>
            <span class="flex items-center gap-2 shrink-0"><button type="button" id="setting-bcanim-ver" class="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-[11px] text-slate-100 hover:bg-slate-700">Ver</button>
            <input type="checkbox" id="setting-bcanim" class="accent-cyan-400 w-5 h-5"></span>`;
        host.insertAdjacentElement('afterend', row);
        const cb = row.querySelector('#setting-bcanim');
        cb.checked = st.anim !== false;
        cb.addEventListener('change', () => { st.anim = cb.checked; save(); });
        let alt = false;
        row.querySelector('#setting-bcanim-ver').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); alt = !alt; window.beatcoinsComemorar(!alt); });
    })();

    // ---------- loja ----------
    function previewHtml(th, id) {
        const p = th.palette || {}, b = th.body || {}, pl = th.pillar || {};
        const notes = [p.edge, p.altA, p.altA, p.edge].map(c => c || '#fff');
        const ys = [18, 52, 34, 70];
        return `<div class="prev" data-fx="${id || ''}" style="background:linear-gradient(180deg,${b.top},${b.bottom})">
            <div class="pil" style="background:linear-gradient(90deg,${pl.lo},${pl.hi},${pl.mid});border-right:1px solid ${pl.trim}"></div>
            <div class="lanes">${notes.map((c, i) => `<div class="ln"><div class="nt" style="top:${ys[i]}px;background:${c};box-shadow:0 0 8px ${c}"></div></div>`).join('')}
              <div class="jl" style="background:${th.accent};box-shadow:0 0 12px ${th.accent}"></div></div>
            <div class="pil" style="background:linear-gradient(270deg,${pl.lo},${pl.hi},${pl.mid});border-left:1px solid ${pl.trim}"></div></div>`;
    }
    function openShop() {
        reload();
        const render = () => {
            const ov = overlay(`
                <h2>🛒 LOJA BEATMAX</h2>
                <div class="sub">Ganhe Beatcoins nos desafios do dia e semanais e subindo de nível.</div>
                <div class="wallet"><span class="bc-coin big"></span><div><div class="lbl">Seu saldo</div><div><span class="n">${st.coins}</span> <span class="u">Beatcoin${st.coins === 1 ? '' : 's'}</span></div></div></div>
                <div class="colh" style="margin-top:18px">GEARS EXCLUSIVAS <span>visual da gear com efeitos animados nas laterais</span></div>
                <div class="grid">${SHOP.map(it => {
                    const th = GEAR_THEMES[shopKey(it)] || Object.assign(it.theme(), {});
                    const own = st.owned.includes(it.id), using = typeof gearSkin !== 'undefined' && gearSkin === shopKey(it);
                    return `<div class="item${using ? ' use' : own ? ' own' : ''}">${previewHtml(th, it.id)}
                        <div class="in">${esc(it.name)}</div><div class="idsc">${esc(it.desc)}</div>
                        ${using ? '<button disabled>✔ Em uso</button>' : own ? `<button data-use="${it.id}">Usar</button>` : `<button class="${st.coins >= it.price ? 'pri' : ''}" data-buy="${it.id}" ${st.coins >= it.price ? '' : 'disabled'}><span class="bc-coin"></span> ${it.price} · Comprar</button>`}
                    </div>`;
                }).join('')}</div>
                ${NOTES.length ? `<div class="colh" style="margin-top:22px">SKINS DE NOTAS <span>mudam a nota, o hold e o efeito ao acertar · combinam com qualquer gear</span></div>
                <div class="grid">${NOTES.map(it => {
                    const own = st.owned.includes(noteKey(it)), using = typeof noteShape !== 'undefined' && noteShape === it.shape;
                    let cores = '';
                    try { cores = getKeyColorScheme('4K', gearSkin).slice(0, 4).join(','); } catch (e) {}
                    return `<div class="item${using ? ' use' : own ? ' own' : ''}"><canvas class="nprev" data-nota-prev="${it.id}" data-cores="${cores}" width="230" height="150"></canvas>
                        <div class="in">${esc(it.name)}</div><div class="idsc">${esc(it.desc)}</div>
                        ${using ? '<button disabled>✔ Em uso</button>' : own ? `<button data-nuse="${it.id}">Usar</button>` : `<button class="${st.coins >= it.price ? 'pri' : ''}" data-nbuy="${it.id}" ${st.coins >= it.price ? '' : 'disabled'}><span class="bc-coin"></span> ${it.price} · Comprar</button>`}
                    </div>`;
                }).join('')}</div>` : ''}
                ${TORC().length ? `<div class="colh" style="margin-top:22px">TORCIDA 8-BIT <span>a turma em pixel ao lado da gear, reagindo à partida · escolha os lados no Personalizar</span></div>
                <div class="grid">${TORC().map(it => {
                    const own = st.owned.includes(torcKey(it.id));
                    return `<div class="item${own ? ' own' : ''}"><div class="tprev"><canvas data-torc="${it.id}"></canvas><img src="${it.img}" alt=""></div>
                        <div class="in">${esc(it.name)}</div><div class="idsc">${esc(it.desc)}</div>
                        ${own ? `<button data-tuse="${it.id}">Escolher lado…</button>` : `<button class="${st.coins >= it.price ? 'pri' : ''}" data-tbuy="${it.id}" ${st.coins >= it.price ? '' : 'disabled'}><span class="bc-coin"></span> ${it.price} · Comprar</button>`}
                    </div>`;
                }).join('')}</div>` : ''}
                <div class="row"><button data-ch>🎯 Desafio do dia</button><button data-x>Fechar</button></div>`, true, { who: 'iris', bxw: '980px', say: (() => {
                    const all = SHOP.map(it => ({ own: st.owned.includes(it.id), p: it.price })).concat(NOTES.map(it => ({ own: st.owned.includes(noteKey(it)), p: it.price })));
                    const left = all.filter(x => !x.own);
                    if (irisDisse) { const m = irisDisse; irisDisse = ''; return m; }
                    if (!left.length) return fala('iris-tudo', ['Você já tem <b>tudo</b> da Loja! Fica de olho que sempre chega coisa nova.', 'Coleção completa! Você é meu cliente favorito 💖']);
                    const cheap = Math.min(...left.map(x => x.p));
                    return st.coins >= cheap ? fala('iris-tem', [
                        `Bem-vindo à minha Loja! Com <b>${st.coins} Beatcoins</b> já dá pra levar alguma coisa. Gostou de qual?`,
                        `Olha só quem chegou com <b>${st.coins} Beatcoins</b>! Dá uma olhada nas skins de notas.`,
                        'Tudo aqui foi feito à mão por mim. Escolhe com carinho! 💖',
                        'Dica da Iris: a prévia mostra o efeito de acerto de cada skin. Repara!'
                    ]) : fala('iris-falta', [
                        `Bem-vindo à minha Loja! Faltam <b>${cheap - st.coins} Beatcoins</b> pro item mais barato — os desafios ajudam!`,
                        `Só mais <b>${cheap - st.coins} Beatcoins</b>! O desafio do dia e subir de nível dão moedas.`,
                        'Pode olhar à vontade! Quando juntar as moedas, eu separo pra você. 😉'
                    ]);
                })() });
            ov.querySelector('[data-x]').onclick = close;
            ov.querySelector('[data-ch]').onclick = openChallenge;
            ov.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
                const it = SHOP.find(x => x.id === b.dataset.buy);
                reload();
                if (!it || st.owned.includes(it.id) || st.coins < it.price) return;
                // confirmação em dois cliques (o confirm() do navegador tira o jogo da tela cheia)
                if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.innerHTML = `Confirmar: <span class="bc-coin"></span> ${it.price}?`; setTimeout(() => { if (b.isConnected) { b.dataset.arm = ''; b.innerHTML = `<span class="bc-coin"></span> ${it.price} · Comprar`; } }, 3500); return; }
                st.coins -= it.price; st.owned.push(it.id); save();
                registerShop(it); fillGearSelect(); chip();
                useSkin(shopKey(it));
                toast(`🛒 Gear <b>${esc(it.name)}</b> comprada e já em uso!`, 4000);
                irisDisse = fala('iris-comprou', [`Ótima escolha! A <b>${esc(it.name)}</b> já está na sua gear.`, `<b>${esc(it.name)}</b>? Você tem bom gosto! Já deixei em uso.`, 'Obrigada pela compra! Volte sempre 💖']);
                render();
            });
            ov.querySelectorAll('[data-nbuy]').forEach(b => b.onclick = () => {
                const it = NOTES.find(x => x.id === b.dataset.nbuy);
                reload();
                if (!it || st.owned.includes(noteKey(it)) || st.coins < it.price) return;
                if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.innerHTML = `Confirmar: <span class="bc-coin"></span> ${it.price}?`; setTimeout(() => { if (b.isConnected) { b.dataset.arm = ''; b.innerHTML = `<span class="bc-coin"></span> ${it.price} · Comprar`; } }, 3500); return; }
                st.coins -= it.price; st.owned.push(noteKey(it)); save();
                fillNoteSelect(); chip(); useNote(it.shape);
                toast(`🛒 Skin de nota <b>${esc(it.name)}</b> comprada e já em uso!`, 4000);
                irisDisse = fala('iris-comprou', [`Ótima escolha! As notas <b>${esc(it.name)}</b> já estão valendo.`, `<b>${esc(it.name)}</b>? Espera só pra ver o efeito de acerto!`, 'Obrigada pela compra! Volte sempre 💖']);
                render();
            });
            ov.querySelectorAll('[data-nuse]').forEach(b => b.onclick = () => {
                const it = NOTES.find(x => x.id === b.dataset.nuse);
                fillNoteSelect(); useNote(it.shape); render();
            });
            ov.querySelectorAll('[data-tbuy]').forEach(b => b.onclick = () => {
                const it = TORC().find(x => x.id === b.dataset.tbuy);
                reload();
                if (!it || st.owned.includes(torcKey(it.id)) || st.coins < it.price) return;
                if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.innerHTML = `Confirmar: <span class="bc-coin"></span> ${it.price}?`; setTimeout(() => { if (b.isConnected) { b.dataset.arm = ''; b.innerHTML = `<span class="bc-coin"></span> ${it.price} · Comprar`; } }, 3500); return; }
                st.coins -= it.price; st.owned.push(torcKey(it.id)); save(); chip();
                if (typeof window.bmTorcidaAuto === 'function') window.bmTorcidaAuto(it.id);
                toast(`🛒 <b>${esc(it.name)}</b> entrou pra sua torcida!`, 4000);
                irisDisse = fala('iris-torc', [`<b>${esc(it.name)}</b> vai torcer por você do lado da gear! Troque o lado no Personalizar.`, 'Torcida reforçada! Quanto maior o combo, maior a festa. 🎉']);
                render();
            });
            ov.querySelectorAll('[data-tuse]').forEach(b => b.onclick = () => { close(); if (window.openColecao) window.openColecao('torcida'); });
            ov.querySelectorAll('[data-use]').forEach(b => b.onclick = () => {
                const it = SHOP.find(x => x.id === b.dataset.use);
                registerShop(it); fillGearSelect(); useSkin(shopKey(it)); render();
            });
        };
        render();
    }
    window.openDesafioDoDia = openChallenge;
    // ---------- API da Loja pra tela Personalizar (coleção) ----------
    window.lojaCatalogo = function () {
        reload();
        return {
            coins: st.coins,
            gears: SHOP.map(it => ({ id: it.id, key: shopKey(it), name: it.name, price: it.price, desc: it.desc, owned: st.owned.includes(it.id) })),
            notes: NOTES.map(it => ({ id: it.id, shape: it.shape, name: it.name, price: it.price, desc: it.desc, owned: st.owned.includes(noteKey(it)) })),
            torcida: TORC().map(it => ({ id: it.id, name: it.name, img: it.img, price: it.price, desc: it.desc, owned: st.owned.includes(torcKey(it.id)) }))
        };
    };
    window.lojaComprar = function (kind, id) {
        reload();
        const it = kind === 'gear' ? SHOP.find(x => x.id === id) : kind === 'torcida' ? TORC().find(x => x.id === id) : NOTES.find(x => x.id === id);
        if (!it) return { ok: false, msg: 'Item não encontrado.' };
        const ownKey = kind === 'gear' ? it.id : kind === 'torcida' ? torcKey(it.id) : noteKey(it);
        if (st.owned.includes(ownKey)) return { ok: true };
        if (st.coins < it.price) return { ok: false, msg: `Faltam ${it.price - st.coins} Beatcoins.` };
        st.coins -= it.price; st.owned.push(ownKey); save();
        if (kind === 'gear') { registerShop(it); fillGearSelect(); } else if (kind === 'nota') fillNoteSelect();
        chip();
        return { ok: true };
    };
    // tema da gear exclusiva (pra miniatura), mesmo sem ter comprado
    window.lojaGearTema = function (id) { const it = SHOP.find(x => x.id === id); return it ? (GEAR_THEMES[shopKey(it)] || it.theme()) : null; };
    window.lojaPreviewHtml = previewHtml;
    window.lojaRegistrar = function (id) { const it = SHOP.find(x => x.id === id); if (it) { registerShop(it); fillGearSelect(); return shopKey(it); } return null; };
    // recompensa de outros sistemas (ex.: subir de nível): soma as moedas e comemora
    window.beatcoinsAdd = function (amount, title, line, big) {
        amount = Math.max(0, Math.round(amount || 0)); if (!amount) return;
        reload(); st.coins += amount; save(); chip();
        reward(title || '⭐ RECOMPENSA', line || `+${amount}`, amount, !!big);
    };
    window.beatcoinsSaldo = () => { reload(); return st.coins; };
    window.openLojaBeatmax = openShop;

    // ---------- convite automático ao abrir o jogo (uma vez por dia, até concluir) ----------
    (function autoInvite() {
        let tries = 0;
        const tick = () => {
            chip();
            if (doneToday() || st.shownDate === dateKey()) return;
            // só na tela de seleção de músicas (nunca junto da abertura nem no menu inicial)
            const abertura = (typeof introEl !== 'undefined' && introEl) || document.getElementById('tela-abertura');
            const hubOn = !!document.querySelector('#bm-hub.on');
            const ready = !abertura && !hubOn && !(typeof isPlaying !== 'undefined' && isPlaying) && (typeof window.menuListaAtiva === 'function' ? window.menuListaAtiva() : true);
            const others = document.querySelector('#nov-ov, #perfil-ov, #sair-ov, #calt-ov, #col-ov, #rk-ov, #lv-ov, #lv-up, #bc-ov, #nuvem-modal.open, #settings-modal:not(.hidden)');
            if (!ready || others) { if (++tries < 20000) setTimeout(tick, 1000); return; }
            openChallenge();
        };
        setTimeout(tick, 2500);
    })();
    // a gear exclusiva salva precisa estar no seletor quando as configurações carregam
    window.addEventListener('load', () => setTimeout(() => { fillGearSelect(); fillNoteSelect(); checkNoteOwned(); chip(); }, 0));
})();
