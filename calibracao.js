// =====================================================================================
// calibracao.js — sincronia que NÃO desanda ao trocar a velocidade.
//
// O ajuste de julgamento é guardado em milissegundos, então em teoria vale pra qualquer
// velocidade. Na prática, quem joga "pelo olho" bate quando a nota ENCOSTA na linha — e o
// ponto exato que o olho usa (a borda de baixo da nota, o brilho da linha, o topo das
// teclas...) fica alguns pixels antes ou depois do centro. Esse desvio é em PIXELS, e
// pixels viram milissegundos diferentes em cada velocidade (na 6.5 a nota anda mais rápido
// que na 6.0). Por isso, calibrando numa velocidade e jogando em outra, a sincronia "mexia".
//
// Solução: cada Calibração guarda (velocidade, ajuste). Com calibrações em 2+ velocidades
// diferentes, o jogo mede esse desvio em pixels (δ) e corrige sozinho:
//     ajuste(velocidade) = ajuste_base + δ × (1/pxPorMs(velocidade) − 1/pxPorMs(referência))
// Com uma calibração só, fica como antes (um valor fixo). É por perfil (ver perfis.js).
// =====================================================================================
const CALIB_KEY = 'djmaxCalibracao_v1';
let calibModel = { points: [], refSf: null, delta: 0, auto: true };
try { const v = JSON.parse(localStorage.getItem(CALIB_KEY) || 'null'); if (v && Array.isArray(v.points)) calibModel = Object.assign(calibModel, v); } catch (e) {}
function calibSave() { try { localStorage.setItem(CALIB_KEY, JSON.stringify(calibModel)); } catch (e) {} }

function calibCurrentSf() { return typeof gameSpeedFactorTarget === 'function' ? gameSpeedFactorTarget() : 2; }

// ajusta δ (px) por mínimos quadrados: judge = a + δ·(1/sf)
function calibFit() {
    const pts = calibModel.points;
    calibModel.delta = 0;
    if (pts.length < 2) return;
    const speeds = pts.map(p => p.speed);
    if (Math.max(...speeds) - Math.min(...speeds) < 0.6) return; // velocidades muito parecidas: não dá pra separar
    const xs = pts.map(p => 1 / p.sf), ys = pts.map(p => p.judge);
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    if (sxx < 1e-9) return;
    calibModel.delta = Math.max(-90, Math.min(90, sxy / sxx)); // px; mais que isso é ruído
}
function calibActive() { return calibModel.auto && calibModel.refSf && Math.abs(calibModel.delta) >= 1; }
function calibSpeedTermMs(sf) {
    if (!calibActive()) return 0;
    return calibModel.delta * (1 / Math.max(0.05, sf || calibCurrentSf()) - 1 / calibModel.refSf);
}

// o ajuste que vale AGORA (base + correção pela velocidade atual)
window.getActiveJudgeOffset = function () {
    return judgeOffset + calibSpeedTermMs(calibCurrentSf());
};

// guarda um ponto (velocidade, ajuste efetivo) — o mais novo de cada velocidade vale
function calibAddPoint(sf, speed, judge) {
    const sp = Math.round(speed * 10) / 10;
    calibModel.points = calibModel.points.filter(p => Math.abs(p.speed - sp) > 0.05);
    calibModel.points.push({ sf, speed: sp, judge, at: Date.now() });
    calibModel.points.sort((a, b) => b.at - a.at);
    calibModel.points = calibModel.points.slice(0, 6);
    calibModel.refSf = sf;
    calibFit();
    calibSave();
    calibUI();
}

// velocidade usada em cada partida (a calibração/sugestão vale pra ela)
let calibRunSf = null, calibRunSpeed = null;
(function calibHooks() {
    const origStart = window.startPractice;
    window.startPractice = function () {
        calibRunSf = calibCurrentSf(); calibRunSpeed = scrollSpeed;
        return origStart.apply(this, arguments);
    };
    // fim da Calibração: o original já calculou e aplicou o ajuste efetivo daquela velocidade
    const origCal = window.renderCalibrationResult;
    window.renderCalibrationResult = function () {
        const out = origCal.apply(this, arguments);
        const txt = (document.getElementById('timing-mean-text') || {}).innerText || '';
        if (txt.startsWith('✅') && calibRunSf) {
            calibAddPoint(calibRunSf, calibRunSpeed, judgeOffset);
            const el = document.getElementById('timing-mean-text');
            if (el) el.innerText += calibActive()
                ? ` · Compensação por velocidade ATIVA (calibrado em ${calibModel.points.map(p => p.speed.toFixed(1)).join(', ')}): trocar a velocidade não desanda mais.`
                : (calibModel.points.length < 2 || calibModel.delta === 0 ? ` · Dica: calibre também numa velocidade bem diferente (ex.: ${(calibRunSpeed >= 5 ? calibRunSpeed - 1.5 : calibRunSpeed + 1.5).toFixed(1)}) pra ativar a compensação automática por velocidade.` : '');
        }
        return out;
    };
    // "aplicar sugestão" depois de uma partida normal: o valor vale pra velocidade daquela partida
    document.getElementById('btn-apply-judge-offset')?.addEventListener('click', () => {
        if (calibRunSf) { calibModel.refSf = calibRunSf; calibSave(); calibUI(); }
    });
    // mexer no slider na mão: vale pra velocidade atual
    document.getElementById('judge-offset-slider')?.addEventListener('input', () => { if (calibActive()) { calibModel.refSf = calibCurrentSf(); calibSave(); calibUI(); } });
})();

// ---------- painel nas Configurações ----------
function calibUI() {
    const slider = document.getElementById('judge-offset-slider');
    if (!slider) return;
    let box = document.getElementById('calib-speed-box');
    if (!box) {
        box = document.createElement('div');
        box.id = 'calib-speed-box';
        box.className = 'mt-2 p-2 rounded border border-slate-700 bg-slate-900/60 text-[10px] text-slate-300 leading-snug';
        const host = slider.parentElement;
        host.appendChild(box);
    }
    const pts = calibModel.points;
    const cur = calibCurrentSf(), term = calibSpeedTermMs(cur);
    const status = calibActive()
        ? `<span class="text-emerald-300 font-bold">ATIVA</span> — desvio do seu olho: ${calibModel.delta > 0 ? '+' : ''}${calibModel.delta.toFixed(0)}px. Na velocidade atual (${Number(scrollSpeed).toFixed(1)}) o ajuste efetivo é <b class="text-cyan-300">${Math.round(judgeOffset + term) > 0 ? '+' : ''}${Math.round(judgeOffset + term)}ms</b>.`
        : (pts.length >= 2 ? '<span class="text-amber-300 font-bold">sem efeito</span> — as calibrações não mostraram diferença entre as velocidades (ótimo: um valor só serve).' : `<span class="text-slate-400 font-bold">aguardando</span> — faça a Calibração em ${pts.length ? 'mais uma velocidade bem diferente' : 'duas velocidades bem diferentes (ex.: 5.0 e 7.0)'}.`);
    box.innerHTML = `<label class="flex items-center gap-1.5 font-bold text-slate-200 cursor-pointer"><input type="checkbox" id="calib-auto" class="accent-cyan-400" ${calibModel.auto ? 'checked' : ''}> Compensação automática por velocidade</label>
        <div class="mt-0.5">${status}</div>
        ${pts.length ? `<div class="mt-0.5 text-slate-500">Calibrações deste perfil: ${pts.map(p => `${p.speed.toFixed(1)} → ${p.judge > 0 ? '+' : ''}${Math.round(p.judge)}ms`).join(' · ')} <button id="calib-clear" class="ml-1 underline text-slate-400">limpar</button></div>` : ''}`;
    box.querySelector('#calib-auto').onchange = (e) => { calibModel.auto = e.target.checked; calibSave(); calibUI(); };
    const clr = box.querySelector('#calib-clear');
    if (clr) clr.onclick = () => { if (!confirm('Apagar as calibrações guardadas deste perfil? (o ajuste atual continua)')) return; calibModel.points = []; calibModel.delta = 0; calibModel.refSf = null; calibSave(); calibUI(); };
}
calibUI();
document.getElementById('btn-settings')?.addEventListener('click', () => setTimeout(calibUI, 30));
