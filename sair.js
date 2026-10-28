// =====================================================================================
// sair.js — botão "Sair" no topo.
//
// Se as músicas/charts mudaram depois do último backup (ou nunca houve backup), pergunta se
// quer fazer o backup antes de sair: o arquivo é gravado onde a pessoa escolher e o jogo só
// fecha DEPOIS que terminou de gravar. Se o backup já está em dia, só se despede e fecha.
// =====================================================================================
(function () {
    const K_BACKUP = 'djmaxTrainerLastBackup';   // gravado pelo backup.js a cada exportação
    const K_CHANGE = 'djmaxTrainerLastChange';   // última vez que a lista de músicas/charts mudou
    const num = (k) => { try { return parseInt(localStorage.getItem(k) || '0', 10) || 0; } catch (e) { return 0; } };

    // qualquer salvamento da lista de charts (criar, editar, importar do osu!, apagar...) conta como mudança
    if (typeof window.saveCustomCharts === 'function') {
        const orig = window.saveCustomCharts;
        window.saveCustomCharts = function () {
            try { localStorage.setItem(K_CHANGE, String(Date.now())); } catch (e) {}
            return orig.apply(this, arguments);
        };
    }

    function backupState() {
        const last = num(K_BACKUP);
        const charts = (typeof customCharts !== 'undefined' && Array.isArray(customCharts)) ? customCharts : [];
        const newer = charts.filter(c => (c.updatedAt || 0) > last).length;
        const lastChange = Math.max(num(K_CHANGE), ...charts.map(c => c.updatedAt || 0), 0);
        const outdated = charts.length > 0 && (!last || lastChange > last);
        return { last, total: charts.length, newer, outdated };
    }

    function fmtAgo(ms) {
        const d = Math.floor((Date.now() - ms) / 86400000);
        if (d <= 0) return 'hoje';
        if (d === 1) return 'ontem';
        return `há ${d} dias`;
    }

    // ---------- tela ----------
    const css = document.createElement('style');
    css.textContent = `
#sair-ov{position:fixed;inset:0;z-index:170;background:rgba(2,6,23,.9);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;color:#e2e8f0}
#sair-ov .bx{width:min(520px,92vw);background:#0f172a;border:1px solid #334155;border-radius:16px;padding:24px 26px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6)}
#sair-ov h2{font-family:Orbitron,monospace;font-weight:900;font-size:22px;letter-spacing:.06em;color:#e0f2fe;margin-bottom:8px}
#sair-ov p{font-size:16px;color:#cbd5e1;line-height:1.4;margin:6px 0}
#sair-ov .warn{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.45);border-radius:10px;padding:10px 12px;color:#fde68a;font-size:15px;margin:12px 0;text-align:left}
#sair-ov .row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px}
#sair-ov button{padding:9px 16px;border-radius:9px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:15px;font-weight:700;cursor:pointer}
#sair-ov button:hover{background:#334155}
#sair-ov button.pri{background:#0891b2;border-color:#22d3ee;color:#020617}
#sair-ov button.pri:hover{background:#06b6d4}
#sair-ov button.red{border-color:#7f1d1d;color:#fca5a5}
#sair-ov .st{min-height:20px;margin-top:10px;font-size:14px;color:#67e8f9}
#sair-ov button:disabled{opacity:.5;cursor:wait}
#btn-sair:hover{border-color:#f87171}`;
    document.head.appendChild(css);

    function overlay(html) {
        let ov = document.getElementById('sair-ov');
        if (!ov) { ov = document.createElement('div'); ov.id = 'sair-ov'; document.body.appendChild(ov); }
        ov.innerHTML = `<div class="bx">${html}</div>`;
        return ov;
    }
    function closeOverlay() { document.getElementById('sair-ov')?.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) {
        if (!document.getElementById('sair-ov')) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (!busy) closeOverlay(); return; }
        if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); document.querySelector('#sair-ov button.pri')?.click(); return; }
        e.stopImmediatePropagation();
    }
    let busy = false;

    // fecha a janela do jogo; se o navegador não deixar, mostra a despedida pedindo Alt+F4
    function encerrar() {
        busy = false;
        try { if (typeof stopPrevia === 'function') stopPrevia(); } catch (e) {}
        overlay(`<h2>ATÉ A PRÓXIMA! 👋</h2><p>Encerrando o BEATMAX Training…</p>`);
        setTimeout(() => {
            try { window.close(); } catch (e) {}
            setTimeout(() => {
                overlay(`<h2>ATÉ A PRÓXIMA! 👋</h2><p>Pode fechar esta janela<br>(<b>Alt+F4</b> ou o <b>X</b> da janela).</p>
                    <div class="row"><button id="sair-voltar">Voltar pro jogo</button></div>`);
                document.getElementById('sair-voltar').onclick = closeOverlay;
            }, 400);
        }, 700);
    }

    async function backupESair() {
        const st = document.querySelector('#sair-ov .st');
        const btns = document.querySelectorAll('#sair-ov button');
        const say = (m) => { if (st) st.textContent = m; };
        let handle = null;
        const d = new Date();
        const suggested = `beatmax-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
        // escolhe ONDE salvar antes de montar (o navegador só deixa abrir essa janela logo após o clique)
        if (window.showSaveFilePicker) {
            try {
                handle = await window.showSaveFilePicker({ suggestedName: suggested, types: [{ description: 'Backup do BEATMAX Training', accept: { 'application/zip': ['.zip'] } }] });
            } catch (e) {
                if (e && e.name === 'AbortError') { say('Backup cancelado — nada foi fechado.'); return; }
                handle = null;
            }
        }
        busy = true;
        btns.forEach(b => b.disabled = true);
        try {
            say('Juntando músicas, charts e configurações…');
            const { blob, name } = await makeBackupBlob(say);
            if (handle) {
                say('Gravando o arquivo…');
                const w = await handle.createWritable();
                await w.write(blob);
                await w.close();
                try { localStorage.setItem(K_BACKUP, String(Date.now())); } catch (e) {}
                say(`✅ Backup salvo (${(blob.size / 1048576).toFixed(1)} MB).`);
                setTimeout(encerrar, 600);
            } else {
                // navegador sem "Salvar como": baixa pra pasta Downloads e espera a pessoa confirmar
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = name;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 60000);
                try { localStorage.setItem(K_BACKUP, String(Date.now())); } catch (e) {}
                busy = false;
                overlay(`<h2>BACKUP BAIXADO</h2><p>O arquivo <b>${name}</b> foi pra sua pasta <b>Downloads</b> (${(blob.size / 1048576).toFixed(1)} MB).</p>
                    <p>Espere o download terminar e depois clique em Sair.</p>
                    <div class="row"><button id="sair-cancel">Voltar pro jogo</button><button id="sair-ok" class="pri">Sair agora</button></div>`);
                document.getElementById('sair-cancel').onclick = closeOverlay;
                document.getElementById('sair-ok').onclick = encerrar;
            }
        } catch (e) {
            busy = false;
            btns.forEach(b => b.disabled = false);
            say(`❌ Não deu pra fazer o backup: ${e.message || e}. O jogo não foi fechado.`);
        }
    }

    function openSair() {
        if (typeof isPlaying !== 'undefined' && isPlaying) return;
        const s = backupState();
        document.addEventListener('keydown', onKey, true);
        if (!s.outdated) {
            // backup em dia (ou nada pra guardar): só se despede
            encerrar();
            return;
        }
        const quando = s.last ? `O último backup foi <b>${fmtAgo(s.last)}</b> (${new Date(s.last).toLocaleDateString('pt-BR')})` : 'Você <b>ainda não fez nenhum backup</b>';
        const quanto = s.last
            ? (s.newer ? `e <b>${s.newer}</b> música(s)/chart(s) foram criadas ou mudaram depois dele.` : 'e a sua lista de músicas mudou depois dele.')
            : `e tem <b>${s.total}</b> música(s)/chart(s) que só existem neste computador.`;
        overlay(`<h2>SAIR DO JOGO?</h2>
            <div class="warn">⚠️ ${quando} ${quanto}<br>Se o navegador for limpo ou o PC formatado, elas se perdem.</div>
            <p>Quer salvar um backup com as suas músicas atuais antes de sair?</p>
            <div class="row">
                <button id="sair-cancel">Cancelar</button>
                <button id="sair-sem" class="red">Sair sem backup</button>
                <button id="sair-bk" class="pri"><i class="fa-solid fa-download"></i> Fazer backup e sair</button>
            </div>
            <div class="st"></div>`);
        document.getElementById('sair-cancel').onclick = closeOverlay;
        document.getElementById('sair-sem').onclick = encerrar;
        document.getElementById('sair-bk').onclick = backupESair;
    }

    // ---------- botão no topo ----------
    const ref = document.getElementById('btn-stats');
    if (ref && !document.getElementById('btn-sair')) {
        const b = document.createElement('button');
        b.id = 'btn-sair';
        b.type = 'button';
        b.title = 'Sair do jogo';
        b.className = ref.className;
        b.innerHTML = '<i class="fa-solid fa-power-off text-red-400"></i> Sair';
        ref.insertAdjacentElement('afterend', b);
        b.addEventListener('click', openSair);
    }
    window.openSairDialog = openSair;
})();
