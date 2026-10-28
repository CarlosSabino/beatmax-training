// =====================================================================================
// gamepad-menu.js — navegar pelos MENUS com o controle (feito pensando no Xbox / sofá).
//
//  Na lista de músicas:  direcional/analógico ↑↓ música · ←→ dificuldade · Ⓐ jogar
//                        LB/RB pula 6 · LT/RT troca o modo (4B/5B/6B/8B)
//                        Ⓧ favoritar · Ⓨ desafios · View (⧉) configurações · Menu (☰) jogar
//  Em janelas (pausa, resultado, configurações, desafios, loja…):
//                        direcional move o destaque · Ⓐ confirma · Ⓑ volta/fecha
//                        no resultado: Ⓧ recomeça · Ⓨ análise detalhada
//
//  Durante a partida o controle continua só tocando as notas (gamepad.js) — aqui não faz nada.
//  Ao terminar a música, os botões que ainda estão apertados são ignorados até soltar
//  (pra não pular o resultado sem querer de tanto apertar Ⓐ).
// =====================================================================================
(function () {
    const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
    const REPEAT_FIRST = 380, REPEAT_NEXT = 110;
    const css = document.createElement('style');
    css.textContent = `.gp-focus{outline:3px solid #22d3ee !important;outline-offset:2px !important;box-shadow:0 0 0 7px rgba(34,211,238,.22) !important;border-radius:8px}
#gp-hint{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:35;display:none;gap:14px;align-items:center;padding:7px 16px;border-radius:999px;background:rgba(2,6,23,.82);border:1px solid #1e293b;color:#cbd5e1;font:700 12.5px Rajdhani,sans-serif;letter-spacing:.3px;white-space:nowrap;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.5)}
#gp-hint b{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;margin-right:4px;border-radius:10px;background:#1e293b;color:#f1f5f9;font:800 11px Orbitron,monospace}
#gp-hint b.a{background:#16a34a}#gp-hint b.b{background:#dc2626}#gp-hint b.x{background:#2563eb}#gp-hint b.y{background:#ca8a04}`;
    document.head.appendChild(css);

    const st = { prev: [], held: {}, nextAt: {}, wasPlaying: false, lockRelease: false, scope: null, focus: null, emul: '' };

    function pad() {
        const ps = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of ps) if (p && p.connected) return p;
        return null;
    }
    const down = (p, i) => !!p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
    // direções: direcional + analógico esquerdo
    function dirs(p) {
        const ax = p.axes || [], x = ax[0] || 0, y = ax[1] || 0;
        return {
            up: down(p, B.UP) || y < -0.55, down: down(p, B.DOWN) || y > 0.55,
            left: down(p, B.LEFT) || x < -0.55, right: down(p, B.RIGHT) || x > 0.55,
        };
    }

    // ---------- teclas "de mentira" pros atalhos que já existem no jogo ----------
    const KEYS = { Enter: 'Enter', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', PageUp: 'PageUp', PageDown: 'PageDown', F5: 'F5', KeyD: 'd' };
    function key(code) {
        const o = { key: KEYS[code] || code, code, bubbles: true, cancelable: true };
        const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
        t.dispatchEvent(new KeyboardEvent('keydown', o));
        t.dispatchEvent(new KeyboardEvent('keyup', o));
    }

    const visible = (el) => {
        if (!el || !el.isConnected) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
    };

    // ---------- qual "janela" está na frente ----------
    // ordem = quem fica por cima
    const SCOPES = ['#bc-cele', '#lv-up', '#col-ov', '#rk-ov', '#lv-ov', '#calt-ov', '#bc-ov', '#perfil-ov', '#sair-ov', '#nov-ov', '#bm-equip.on', '#backup-modal', '#nuvem-modal', '#settings-modal', '#skin-modal.open', '#history-modal', '#osu-modal', '#pause-modal', '#stats-overlay', '#bm-hub.on'];
    function topScope() {
        for (const sel of SCOPES) {
            const el = document.querySelector(sel);
            if (el && !el.classList.contains('hidden') && visible(el)) return el;
        }
        return null;
    }
    const FOCUSABLE = 'button, a[href], select, input:not([type=hidden]), [role=button], label.cursor-pointer, .pattern-card, .diff-pill, [data-act]';
    function focusables(scope) {
        return [...scope.querySelectorAll(FOCUSABLE)].filter(el => !el.disabled && visible(el) && !el.closest('.hidden'));
    }
    function setFocus(el) {
        if (st.focus && st.focus !== el) st.focus.classList.remove('gp-focus');
        st.focus = el;
        if (!el) return;
        el.classList.add('gp-focus');
        try { el.focus({ preventScroll: true }); } catch (e) {}
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function clearFocus() { setFocus(null); }
    // anda pro elemento mais perto na direção pedida
    function moveFocus(scope, dx, dy) {
        const els = focusables(scope);
        if (!els.length) return;
        if (!st.focus || !els.includes(st.focus)) { setFocus(els[0]); return; }
        const a = st.focus.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
        let best = null, bestScore = Infinity;
        for (const el of els) {
            if (el === st.focus) continue;
            const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
            const ddx = x - ax, ddy = y - ay;
            const along = dx ? ddx * dx : ddy * dy;           // distância na direção
            const across = dx ? Math.abs(ddy) : Math.abs(ddx); // desvio pro lado
            if (along <= 2) continue;
            const score = along + across * 2.2;
            if (score < bestScore) { bestScore = score; best = el; }
        }
        if (best) setFocus(best);
    }
    // ←/→ num campo de escolha ou barrinha: muda o valor
    function adjust(el, dir) {
        if (el.tagName === 'SELECT') {
            const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dir));
            if (i !== el.selectedIndex) { el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); }
            return true;
        }
        if (el.tagName === 'INPUT' && el.type === 'range') {
            const step = +el.step || 1;
            el.value = String(Math.max(+el.min || 0, Math.min(+el.max || 100, +el.value + dir * step)));
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }
    function closeScope(scope) {
        key('Escape');
        // se o Esc não fechou, procura um botão de fechar
        setTimeout(() => {
            if (!scope.isConnected || scope.classList.contains('hidden') || !visible(scope)) return;
            const btn = [...scope.querySelectorAll('button')].find(b => visible(b) && (/fechar|voltar|cancelar|depois|^✕$|^×$/i.test(b.textContent.trim()) || /close|fechar|cancel/i.test(b.id) || b.hasAttribute('data-x')));
            if (btn) btn.click();
        }, 60);
    }

    // ---------- lista de músicas ----------
    function menuAtivo() { return typeof menuListaAtiva === 'function' ? menuListaAtiva() : false; }
    function cycleMode(dir) {
        const btns = [...document.querySelectorAll('.mode-btn')].filter(visible);
        const i = btns.findIndex(b => b.classList.contains('active-mode') || b.dataset.mode === (typeof currentMode !== 'undefined' ? currentMode : ''));
        const j = Math.max(0, Math.min(btns.length - 1, (i < 0 ? 0 : i) + dir));
        if (btns[j] && j !== i) btns[j].click();
    }
    function cycleDrillDiff(dir) {
        const pills = [...document.querySelectorAll('#diff-pills .diff-pill')].filter(visible);
        const cur = typeof currentDifficulty !== 'undefined' ? currentDifficulty : '';
        const i = pills.findIndex(p => p.dataset.diff === cur);
        const j = Math.max(0, Math.min(pills.length - 1, (i < 0 ? 0 : i) + dir));
        if (pills[j] && j !== i) pills[j].click();
    }
    function menuPress(b) {
        clearFocus();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        const custom = typeof currentPatternType === 'string' && currentPatternType.startsWith('custom:');
        switch (b) {
            case 'up': key('ArrowUp'); break;
            case 'down': key('ArrowDown'); break;
            case 'left': custom ? key('ArrowLeft') : cycleDrillDiff(-1); break;
            case 'right': custom ? key('ArrowRight') : cycleDrillDiff(1); break;
            case B.A: case B.MENU: key('Enter'); break;
            case B.LB: key('PageUp'); break;
            case B.RB: key('PageDown'); break;
            case B.LT: cycleMode(-1); break;
            case B.RT: cycleMode(1); break;
            case B.Y: if (typeof openDesafioDoDia === 'function') openDesafioDoDia(); break;
            case B.X: if (typeof libToggleFavSelected === 'function') libToggleFavSelected(); break;
            case B.VIEW: document.getElementById('btn-settings')?.click(); break;
        }
    }

    // ---------- janelas ----------
    function scopePress(scope, b) {
        const id = scope.id;
        if (id === 'bc-cele' || id === 'lv-up') { if (b === B.A || b === B.B || b === B.MENU) key('Enter'); return; }
        // tela de calibração: já tem atalhos de teclado próprios (←/→ ajusta, ↑/↓ velocidade, Enter salva)
        if (id === 'calt-ov') {
            if (typeof caltPadActive === 'function' && caltPadActive()) return; // coletando: os botões são toques
            const m = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', [B.A]: 'Enter', [B.MENU]: 'Enter', [B.B]: 'Escape' };
            if (m[b]) key(m[b]);
            return;
        }
        const results = id === 'stats-overlay';
        const pause = id === 'pause-modal';
        if (b === 'up' || b === 'down' || b === 'left' || b === 'right') {
            const dx = b === 'left' ? -1 : b === 'right' ? 1 : 0, dy = b === 'up' ? -1 : b === 'down' ? 1 : 0;
            if (dx && st.focus && scope.contains(st.focus) && adjust(st.focus, dx)) return;
            moveFocus(scope, dx, dy);
            return;
        }
        if (b === B.A) {
            if (st.focus && scope.contains(st.focus) && visible(st.focus)) { st.focus.click(); return; }
            key('Enter');
            return;
        }
        if (b === B.B) { if (pause) document.getElementById('btn-resume')?.click(); else closeScope(scope); return; }
        if (b === B.MENU) { if (pause) document.getElementById('btn-resume')?.click(); else key('Enter'); return; }
        if (results && b === B.X) { key('F5'); return; }
        if (results && b === B.Y) { key('KeyD'); return; }
    }

    // ---------- dica na tela ----------
    let hintEl = null, hintT = 0;
    function hint(show) {
        if (!hintEl) {
            hintEl = document.createElement('div');
            hintEl.id = 'gp-hint';
            hintEl.innerHTML = '<span><b class="a">A</b>Jogar</span><span><b>✚</b>Música · Dificuldade</span><span><b>LB</b><b>RB</b>Pular</span><span><b>LT</b><b>RT</b>Modo</span><span><b class="x">X</b>Favoritar</span><span><b class="y">Y</b>Desafios</span><span><b>⧉</b>Config.</span>';
            document.body.appendChild(hintEl);
        }
        hintEl.style.display = show ? 'flex' : 'none';
    }

    // no Xbox (Edge), o controle também mexe um cursor de mouse. Durante a partida pedimos
    // pro navegador mandar só o controle pro jogo (se ele suportar — senão não faz nada).
    function emulation(mode) {
        if (st.emul === mode) return;
        st.emul = mode;
        try { if ('gamepadInputEmulation' in navigator) navigator.gamepadInputEmulation = mode; } catch (e) {}
    }

    function loop(ts) {
        requestAnimationFrame(loop);
        const p = pad();
        const playing = typeof isPlaying !== 'undefined' && isPlaying;
        const paused = playing && typeof isPaused !== 'undefined' && isPaused;
        const live = playing && !paused;
        emulation(live ? 'gamepad' : 'mouse');
        if (ts - hintT > 400) {
            hintT = ts;
            hint(!!p && !live && !topScope() && menuAtivo());
        }
        if (!p) { st.prev = []; return; }
        // marca quando o B foi apertado (web.js usa pra não tratar o "voltar" do navegador duas vezes)
        const bNow = down(p, B.B);
        if (bNow && !st.bWas) window.__gpLastB = performance.now();
        st.bWas = bNow;
        if (live || (typeof padCapture !== 'undefined' && padCapture)) {
            st.wasPlaying = true; st.prev = []; clearFocus();
            return;
        }
        // acabou de sair da partida: o que está apertado fica "travado" até soltar
        if (st.wasPlaying) { st.wasPlaying = false; st.lockRelease = true; }
        const d = dirs(p);
        const now = performance.now();
        const cur = {
            [B.A]: down(p, B.A), [B.B]: down(p, B.B), [B.X]: down(p, B.X), [B.Y]: down(p, B.Y),
            [B.LB]: down(p, B.LB), [B.RB]: down(p, B.RB), [B.LT]: down(p, B.LT), [B.RT]: down(p, B.RT),
            [B.VIEW]: down(p, B.VIEW), [B.MENU]: down(p, B.MENU),
            up: d.up, down: d.down, left: d.left, right: d.right,
        };
        if (st.lockRelease) {
            if (Object.values(cur).some(Boolean)) { st.prev = cur; return; }
            st.lockRelease = false;
        }
        const scope = topScope();
        if (scope !== st.scope) {
            st.scope = scope; clearFocus();
            // pausa: já destaca o RESUME
            if (scope && scope.id === 'pause-modal') setFocus(document.getElementById('btn-resume'));
        }
        const repeatable = { up: 1, down: 1, left: 1, right: 1, [B.LB]: 1, [B.RB]: 1 };
        for (const k of Object.keys(cur)) {
            const isDown = cur[k], was = !!st.prev[k];
            let fire = false;
            if (isDown && !was) { fire = true; st.nextAt[k] = now + REPEAT_FIRST; }
            else if (isDown && repeatable[k] && now >= (st.nextAt[k] || 0)) { fire = true; st.nextAt[k] = now + REPEAT_NEXT; }
            if (!fire) continue;
            const b = isNaN(+k) ? k : +k;
            try {
                if (scope) scopePress(scope, b);
                else if (menuAtivo()) menuPress(b);
            } catch (e) { console.warn('[gamepad-menu]', e); }
        }
        st.prev = cur;
    }
    requestAnimationFrame(loop);
})();
