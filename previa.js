// =====================================================================================
// previa.js — prévia da música ao selecionar uma música (chart com áudio) no menu.
// Toca um trecho de ~15s a partir do ponto de prévia do osu! (ou de ~35% da música), com
// fade de entrada/saída, em loop. Para ao começar a partida, ao escolher um treino, ao
// abrir o editor/outra tela, ou quando a janela perde o foco.
// =====================================================================================
const previa = { el: null, url: null, id: null, timer: 0, fadeRaf: 0, token: 0 };
const PREVIA_LEN_MS = 15000;
let previaOn = true;
try { previaOn = localStorage.getItem('djmaxPreviaMusica') !== '0'; } catch (e) {}

function previaVolume() { return Math.max(0, Math.min(1, (typeof musicVolume === 'number' ? musicVolume : 0.8) * 0.7)); }
function previaFade(to, ms, done) {
    const el = previa.el;
    if (!el) return;
    cancelAnimationFrame(previa.fadeRaf);
    const from = el.volume, t0 = performance.now();
    const step = (now) => {
        if (previa.el !== el) return;
        const k = Math.min(1, (now - t0) / ms);
        el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
        if (k < 1) previa.fadeRaf = requestAnimationFrame(step); else if (done) done();
    };
    previa.fadeRaf = requestAnimationFrame(step);
}
function stopPrevia(fast) {
    previa.token++;
    clearTimeout(previa.timer);
    const el = previa.el, url = previa.url;
    previa.el = null; previa.url = null; previa.id = null;
    if (!el) return;
    const end = () => { try { el.pause(); } catch (e) {} if (url) URL.revokeObjectURL(url); };
    if (fast) { end(); return; }
    // fade curtinho na saída
    const from = el.volume, t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 250); el.volume = from * (1 - k); if (k < 1) requestAnimationFrame(step); else end(); };
    requestAnimationFrame(step);
}
async function playPrevia(chartId) {
    if (!previaOn) return;
    if (previa.id === chartId && previa.el) return;
    stopPrevia(true);
    const token = ++previa.token;
    const chart = findCustomChart(chartId);
    if (!chart) return;
    let row = null;
    try { row = await loadChartAudioBlob(chartId); } catch (e) {}
    if (token !== previa.token || !row || !row.blob) return;
    if (typeof isPlaying !== 'undefined' && isPlaying) return;
    const url = URL.createObjectURL(row.blob);
    const el = new Audio(url);
    el.volume = 0;
    previa.el = el; previa.url = url; previa.id = chartId;
    await new Promise(res => { el.addEventListener('loadedmetadata', res, { once: true }); el.addEventListener('error', res, { once: true }); setTimeout(res, 3000); });
    if (token !== previa.token) return;
    const durMs = isFinite(el.duration) ? el.duration * 1000 : (chart.duration || 60) * 1000;
    const pt = chart.osu && chart.osu.previewTime != null ? chart.osu.previewTime : durMs * 0.35;
    const start = Math.max(0, Math.min(pt, Math.max(0, durMs - PREVIA_LEN_MS)));
    const loop = () => {
        if (token !== previa.token) return;
        try { el.currentTime = start / 1000; } catch (e) {}
        el.volume = 0;
        el.play().then(() => previaFade(previaVolume(), 600)).catch(() => {});
        clearTimeout(previa.timer);
        previa.timer = setTimeout(() => { if (token !== previa.token) return; previaFade(0, 900, () => setTimeout(loop, 300)); }, PREVIA_LEN_MS - 900);
    };
    loop();
}

(function previaHooks() {
    const grid = document.getElementById('pattern-grid');
    if (grid) grid.addEventListener('click', (e) => {
        const card = e.target.closest('.pattern-card');
        if (!card) return;
        const pat = card.dataset.pattern || '';
        if (pat.startsWith('custom:')) playPrevia(pat.slice(7)); else stopPrevia();
    });
    // para quando a partida começa ou o menu some
    const origStart = window.startPractice;
    if (typeof origStart === 'function') window.startPractice = function () { stopPrevia(true); return origStart.apply(this, arguments); };
    const menu = document.getElementById('menu-overlay');
    if (menu && typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (menu.classList.contains('hidden')) stopPrevia(true); }).observe(menu, { attributes: true, attributeFilter: ['class'] });
    ['btn-chart-editor', 'btn-osu', 'btn-skin', 'btn-nuvem'].forEach(id => document.getElementById(id)?.addEventListener('click', () => stopPrevia()));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopPrevia(true); });
    // liga/desliga nas Configurações (junto do volume da música)
    const vol = document.getElementById('audio-music-volume');
    const host = vol && vol.closest('div');
    if (host && !document.getElementById('setting-previa')) {
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 text-[11px] text-slate-300 mt-1 cursor-pointer';
        row.innerHTML = '<input type="checkbox" id="setting-previa" class="accent-cyan-400"> Tocar a prévia da música ao selecionar no menu';
        host.insertAdjacentElement('afterend', row);
        const cb = row.querySelector('input');
        cb.checked = previaOn;
        cb.addEventListener('change', () => { previaOn = cb.checked; try { localStorage.setItem('djmaxPreviaMusica', previaOn ? '1' : '0'); } catch (e) {} if (!previaOn) stopPrevia(); });
    }
})();
