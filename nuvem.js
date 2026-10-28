// =====================================================================================
// nuvem.js — compartilhar charts entre jogadores (Supabase).
//
// O jogo continua 100% local: a nuvem só guarda os PACOTES (.djmaxchart = chart.json +
// música + capa) que alguém publicou, e quem recebe baixa pra biblioteca dele (depois toca
// offline). Conta = apelido + senha (e-mail opcional, só pra recuperar a senha).
// A chave abaixo é a "anon/publishable" do projeto: é pública por natureza — quem protege
// os dados são as regras (RLS) de nuvem/supabase-setup.sql. NUNCA coloque a service_role aqui.
// =====================================================================================

const NUVEM_URL = 'https://edqkqxferxczpkqtkcqa.supabase.co';
const NUVEM_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkcWtxeGZlcnhjenBrcXRrY3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MTQzMjMsImV4cCI6MjEwNzE5MDMyM30.cFpXBk0BHSd2Hl9uzOTEeqz5kEB85QegfgWqVKShZyo';
const NUVEM_MAIL_DOMAIN = 'jogador.beatmax-training.app'; // e-mail "de mentira" de quem não informa um
const NUVEM_MAX_BYTES = 25 * 1024 * 1024;
const NUVEM_DL_KEY = 'djmaxNuvemBaixadas_v1'; // { idNaNuvem: { localId, version } }
const NUVEM_VIS = [['friends', 'Amigos'], ['link', 'Quem tiver o código'], ['public', 'Todos (Explorar)'], ['private', 'Só eu']];

let nuvemSb = null;
const nuvem = { user: null, profile: null, tab: 'publicar', mine: [], busy: false, badge: 0, pollT: 0 };

function nuvemClient() {
    if (nuvemSb) return nuvemSb;
    if (typeof supabase === 'undefined' || !supabase.createClient) throw new Error('biblioteca da nuvem não carregou');
    nuvemSb = supabase.createClient(NUVEM_URL, NUVEM_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'beatmaxNuvemAuth', detectSessionInUrl: false }
    });
    return nuvemSb;
}
const nuvemEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nuvemMB = (n) => (n / 1048576).toFixed(1) + ' MB';
const nuvemVisName = (v) => (NUVEM_VIS.find(x => x[0] === v) || [v, v])[1];
function nuvemDl() { try { return JSON.parse(localStorage.getItem(NUVEM_DL_KEY) || '{}') || {}; } catch (e) { return {}; } }
function nuvemDlSet(id, val) { const m = nuvemDl(); if (val) m[id] = val; else delete m[id]; try { localStorage.setItem(NUVEM_DL_KEY, JSON.stringify(m)); } catch (e) {} }

// mensagens de erro do Supabase em português
function nuvemErr(e) {
    const m = String((e && (e.message || e.error_description || e.msg)) || e || '');
    if (/Invalid login credentials/i.test(m)) return 'Apelido/e-mail ou senha incorretos.';
    if (/already registered|already been registered|User already/i.test(m)) return 'Essa conta já existe — use "Entrar".';
    if (/Database error saving new user|duplicate key.*nick|profiles_nick_key/i.test(m)) return 'Esse apelido já está em uso.';
    if (/Password should be at least|weak_password|password/i.test(m) && /least|short|weak/i.test(m)) return 'Senha fraca: use pelo menos 6 caracteres.';
    if (/email.*invalid|invalid.*email/i.test(m)) return 'O servidor recusou o e-mail. Informe um e-mail de verdade no cadastro.';
    if (/Limite de 40/.test(m)) return 'Você chegou no limite de 40 charts publicadas — apague alguma em "Minhas".';
    if (/grande demais|Payload too large|exceeded the maximum/i.test(m)) return 'Arquivo grande demais (máx. 25 MB).';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sem conexão com a nuvem. Confira a internet.';
    if (/rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
    return m || 'Erro desconhecido.';
}
async function nuvemQ(p) { const r = await p; if (r.error) throw r.error; return r.data; }

// ---------- conta ----------
function nuvemNickOk(n) { return /^[a-z0-9_]{3,20}$/.test(n); }
function nuvemEmailFor(login) { login = login.trim().toLowerCase(); return login.includes('@') ? login : `${login}@${NUVEM_MAIL_DOMAIN}`; }

async function nuvemLoadProfile() {
    const sb = nuvemClient();
    const { data } = await sb.auth.getSession();
    nuvem.user = data && data.session ? data.session.user : null;
    nuvem.profile = null;
    if (nuvem.user) {
        nuvem.profile = await nuvemQ(sb.from('profiles').select('id,nick,display').eq('id', nuvem.user.id).maybeSingle());
    }
    return nuvem.user;
}

async function nuvemSignUp(nick, display, pass, email) {
    nick = nick.trim().toLowerCase();
    if (!nuvemNickOk(nick)) throw new Error('Apelido: 3 a 20 letras minúsculas, números ou _ (sem espaço nem acento).');
    if ((pass || '').length < 6) throw new Error('Senha fraca: use pelo menos 6 caracteres.');
    display = (display || '').trim() || nick;
    if (display.length < 3) display = nick;
    const sb = nuvemClient();
    const r = await sb.auth.signUp({ email: email ? email.trim().toLowerCase() : nuvemEmailFor(nick), password: pass, options: { data: { nick, display: display.slice(0, 24) } } });
    if (r.error) throw r.error;
    if (!r.data.session) throw new Error('Conta criada, mas o servidor pediu confirmação por e-mail. No Supabase, desligue "Confirm email" (Authentication → Sign In / Providers → Email).');
    await nuvemLoadProfile();
}

async function nuvemSignIn(login, pass) {
    const sb = nuvemClient();
    const r = await sb.auth.signInWithPassword({ email: nuvemEmailFor(login), password: pass });
    if (r.error) throw r.error;
    await nuvemLoadProfile();
}

async function nuvemSignOut() {
    try { await nuvemClient().auth.signOut(); } catch (e) {}
    nuvem.user = null; nuvem.profile = null; nuvem.badge = 0;
    nuvemBadgeUI();
}

// ---------- pacote pra subir ----------
async function nuvemBuildPackage(chart, opts) {
    opts = opts || {};
    const prog = opts.onProgress || (() => {});
    const out = {
        title: chart.title, mode: chart.mode, bpm: chart.bpm, snap: chart.snap, duration: chart.duration,
        notes: (chart.notes || []).map(n => ({ time: Math.round(n.time), lane: n.lane, holdEnd: n.holdEnd != null ? Math.round(n.holdEnd) : null })).sort((a, b) => a.time - b.time),
        pins: (chart.pins || []).map(p => Math.round(p)),
        sections: (chart.sections || []).map(s => ({ time: Math.round(s.time), name: s.name })),
        bpmChanges: sanitizeBpmChanges(chart.bpmChanges),
        songEndMs: chart.songEndMs != null ? Math.round(chart.songEndMs) : null,
        format: 'djmax-trainer-chart', version: 2
    };
    if (chart.source === 'osu') { out.source = 'osu'; out.osu = chart.osu; }
    const entries = [];
    let codec = 'none';
    if (opts.audio !== false) {
        const row = await loadChartAudioBlob(chart.id).catch(() => null);
        if (row && row.blob) {
            let blob = row.blob, name = row.fileName || 'musica.mp3';
            const already = /\.(opus)$/i.test(name) || /opus/i.test(blob.type);
            if (opts.opus !== false && !already) {
                prog('Convertendo a música para Opus…');
                try {
                    const op = await transcodeToOpus(blob, { onProgress: (f) => prog(`Convertendo a música para Opus… ${Math.round(f * 100)}%`) });
                    if (op && op.size < blob.size) { blob = op; name = name.replace(/\.[^.]+$/, '') + '.opus'; }
                } catch (e) { console.warn('[nuvem] opus', e); }
            }
            const ext = (name.match(/\.[a-z0-9]{2,4}$/i) || ['.mp3'])[0];
            codec = ext.slice(1).toLowerCase();
            out.audioFile = 'audio/' + pkgSafeName(name.replace(/\.[^.]+$/, '') || chart.title) + ext;
            entries.push({ name: out.audioFile, data: new Uint8Array(await blob.arrayBuffer()) });
        }
    }
    // capa (imagem do osu!) sim; vídeo de fundo não (pesado demais pro espaço grátis)
    if (chart.bga && chart.bga.key) {
        try {
            const rec = await mediaGet(chart.bga.key);
            if (rec && rec.image && rec.image.size < 3 * 1048576) {
                const n = 'fundo/imagem' + ({ 'image/png': '.png', 'image/webp': '.webp' }[rec.image.type] || '.jpg');
                entries.push({ name: n, data: new Uint8Array(await rec.image.arrayBuffer()) });
                out.bgImageFile = n;
            }
        } catch (e) {}
    }
    entries.unshift({ name: 'chart.json', data: new TextEncoder().encode(JSON.stringify(out)) });
    const blob = makeZip(entries);
    return { blob, codec, size: blob.size };
}

function nuvemChartArtist(chart) {
    if (chart.source === 'osu') { try { return splitOsuTitle(chart.title).artist || (chart.osu && chart.osu.artist) || null; } catch (e) {} }
    return null;
}
function nuvemChartTitle(chart) {
    if (chart.source === 'osu') { try { const t = splitOsuTitle(chart.title); return t.title + (t.version ? ` [${t.version}]` : ''); } catch (e) {} }
    return chart.title;
}

// publica (ou atualiza) uma chart local
async function nuvemPublish(chart, visibility, opts, onStatus) {
    const sb = nuvemClient();
    const uid = nuvem.user.id;
    onStatus = onStatus || (() => {});
    onStatus('Montando o pacote…');
    const pkg = await nuvemBuildPackage(chart, Object.assign({}, opts, { onProgress: onStatus }));
    if (pkg.size > NUVEM_MAX_BYTES) throw new Error(`O pacote ficou com ${nuvemMB(pkg.size)} (máx. 25 MB).`);
    const meta = {
        title: nuvemChartTitle(chart).slice(0, 120), artist: nuvemChartArtist(chart), mode: chart.mode,
        notes_count: (chart.notes || []).length, duration_s: Math.round(chart.duration || 0), bpm: chart.bpm || null,
        visibility, file_size: pkg.size, audio_codec: pkg.codec
    };
    const existing = nuvem.mine.find(r => r.local_id === chart.id);
    let row;
    onStatus('Registrando na nuvem…');
    if (existing) row = await nuvemQ(sb.from('charts').update(Object.assign(meta, { version: (existing.version || 1) + 1 })).eq('id', existing.id).select().single());
    else row = await nuvemQ(sb.from('charts').insert(Object.assign(meta, { owner: uid, local_id: chart.id })).select().single());
    const path = `${uid}/${row.id}/pacote.djmaxchart`;
    if (row.file_path !== path) row = await nuvemQ(sb.from('charts').update({ file_path: path }).eq('id', row.id).select().single());
    onStatus(`Enviando ${nuvemMB(pkg.size)}…`);
    const up = await sb.storage.from('charts').upload(path, pkg.blob, { upsert: true, contentType: 'application/zip' });
    if (up.error) {
        if (!existing) await sb.from('charts').delete().eq('id', row.id);
        throw up.error;
    }
    await nuvemLoadMine();
    return row;
}

async function nuvemLoadMine() {
    const sb = nuvemClient();
    nuvem.mine = await nuvemQ(sb.from('charts').select('*').eq('owner', nuvem.user.id).order('updated_at', { ascending: false }));
    return nuvem.mine;
}

async function nuvemFindNick(nick) {
    nick = String(nick || '').trim().toLowerCase().replace(/^@/, '');
    if (!nuvemNickOk(nick)) throw new Error('Apelido inválido.');
    const p = await nuvemQ(nuvemClient().from('profiles').select('id,nick,display').eq('nick', nick).maybeSingle());
    if (!p) throw new Error(`Não existe ninguém com o apelido @${nick}.`);
    if (p.id === nuvem.user.id) throw new Error('Esse é você 🙂');
    return p;
}

async function nuvemSendTo(chartRow, nick) {
    const p = await nuvemFindNick(nick);
    await nuvemQ(nuvemClient().from('chart_shares').upsert({ chart_id: chartRow.id, to_user: p.id }, { onConflict: 'chart_id,to_user', ignoreDuplicates: true }));
    if (chartRow.visibility === 'private') {
        // "Só eu" + enviar pra alguém: libera pra essa pessoa (vira "Amigos" — ela já tem o envio)
        await nuvemQ(nuvemClient().from('charts').update({ visibility: 'friends' }).eq('id', chartRow.id));
        chartRow.visibility = 'friends';
    }
    return p;
}

// baixa da nuvem pra biblioteca
async function nuvemDownload(row, ownerNick) {
    const sb = nuvemClient();
    if (!row.file_path) throw new Error('Essa chart ainda não terminou de subir.');
    const r = await sb.storage.from('charts').download(row.file_path);
    if (r.error) throw r.error;
    const prev = nuvemDl()[row.id];
    const replaceId = prev && findCustomChart(prev.localId) ? prev.localId : null;
    const res = await pkgImportBlob(r.data, { replaceId, cloud: { id: row.id, version: row.version, from: ownerNick || '', code: row.share_code } });
    nuvemDlSet(row.id, { localId: res.chart.id, version: row.version });
    sb.rpc('chart_downloaded', { cid: row.id }).then(() => {}, () => {});
    sb.from('chart_shares').update({ seen: true }).eq('chart_id', row.id).eq('to_user', nuvem.user.id).then(() => nuvemRefreshBadge(), () => {});
    return res;
}

// estado de uma chart da nuvem em relação à biblioteca local
function nuvemLocalState(row) {
    const d = nuvemDl()[row.id];
    if (!d || !findCustomChart(d.localId)) return 'new';
    return (row.version || 1) > (d.version || 1) ? 'update' : 'have';
}

// ---------- amigos ----------
async function nuvemLoadFriends() {
    const sb = nuvemClient();
    return nuvemQ(sb.from('friends').select('user_id,friend_id,status,created_at,a:profiles!friends_user_id_fkey(id,nick,display),b:profiles!friends_friend_id_fkey(id,nick,display)'));
}
async function nuvemAddFriend(nick) {
    const p = await nuvemFindNick(nick);
    const sb = nuvemClient(), me = nuvem.user.id;
    const rows = await nuvemLoadFriends();
    const theirs = rows.find(r => r.user_id === p.id && r.friend_id === me);
    if (theirs) { await nuvemQ(sb.from('friends').update({ status: 'accepted' }).eq('user_id', p.id).eq('friend_id', me)); return `Agora você e @${p.nick} são amigos.`; }
    if (rows.find(r => r.user_id === me && r.friend_id === p.id)) return `Pedido pra @${p.nick} já foi enviado.`;
    await nuvemQ(sb.from('friends').insert({ user_id: me, friend_id: p.id }));
    return `Pedido de amizade enviado pra @${p.nick}.`;
}

// ---------- FILA DE PUBLICAÇÃO (várias músicas de uma vez) ----------
// Cada "Publicar" entra numa fila e sobe sozinha, NUVEM_PARALLEL de cada vez, mesmo com a
// janela da Nuvem fechada. Não começa uma nova durante a partida (pra não pesar no jogo).
const NUVEM_PARALLEL = 2;
nuvem.queue = [];
let nuvemQRunning = 0;
function nuvemEnqueue(id, vis, audio) {
    const c = findCustomChart(id);
    if (!c) return;
    if (nuvem.queue.some(q => q.id === id && (q.state === 'wait' || q.state === 'run'))) return;
    nuvem.queue = nuvem.queue.filter(q => q.id !== id);
    nuvem.queue.push({ id, title: nuvemChartTitle(c), vis, audio, state: 'wait', msg: 'na fila' });
    nuvemQueueUI();
    nuvemQueueRun();
}
function nuvemQueueRun() {
    if (typeof isPlaying !== 'undefined' && isPlaying) { clearTimeout(nuvem.qT); nuvem.qT = setTimeout(nuvemQueueRun, 3000); return; }
    while (nuvemQRunning < NUVEM_PARALLEL) {
        const it = nuvem.queue.find(q => q.state === 'wait');
        if (!it) break;
        nuvemQRunning++;
        it.state = 'run'; it.msg = 'começando…';
        nuvemQueueUI();
        (async () => {
            try {
                const c = findCustomChart(it.id);
                if (!c) throw new Error('a chart não existe mais na biblioteca');
                const row = await nuvemPublish(c, it.vis, { audio: it.audio }, (st) => { it.msg = st; nuvemQueueUI(); });
                it.state = 'ok'; it.msg = `✅ publicada v${row.version} · ${row.share_code}`; it.code = row.share_code;
            } catch (e) {
                console.warn('[nuvem fila]', e);
                it.state = 'err'; it.msg = '⚠️ ' + nuvemErr(e);
            } finally {
                nuvemQRunning--;
                nuvemQueueUI();
                nuvemQueueRun();
                if (!nuvem.queue.some(q => q.state === 'wait' || q.state === 'run')) nuvemQueueDone();
            }
        })();
    }
}
function nuvemQueueDone() {
    const ok = nuvem.queue.filter(q => q.state === 'ok').length, err = nuvem.queue.filter(q => q.state === 'err').length;
    if (!ok && !err) return;
    nuvemToast(`☁️ ${ok} música${ok === 1 ? '' : 's'} publicada${ok === 1 ? '' : 's'} na Nuvem${err ? ` · ${err} com erro` : ''}`, err ? 'Ver' : 'Minhas', () => openNuvem(err ? 'publicar' : 'minhas'));
    // limpa as concluídas depois de um tempo (os erros ficam pra pessoa ver)
    setTimeout(() => { nuvem.queue = nuvem.queue.filter(q => q.state !== 'ok'); nuvemQueueUI(); }, 15000);
}
function nuvemQueueUI() {
    // linhas da aba Publicar
    document.querySelectorAll('#nv-plist [data-id]').forEach(r => {
        const it = nuvem.queue.find(q => q.id === r.dataset.id);
        const st = r.querySelector('.nv-pst'), btn = r.querySelector('[data-act="pub"]');
        if (st) st.textContent = it ? (it.state === 'run' ? '⏳ ' : '') + it.msg : '';
        if (btn) { const busy = it && (it.state === 'wait' || it.state === 'run'); btn.disabled = !!busy; btn.textContent = busy ? (it.state === 'run' ? 'Enviando…' : 'Na fila') : btn.dataset.label; }
    });
    // indicador fora da janela
    let chip = document.getElementById('nv-qchip');
    const active = nuvem.queue.filter(q => q.state === 'wait' || q.state === 'run');
    if (!active.length) { if (chip) chip.remove(); return; }
    if (!chip) {
        chip = document.createElement('button');
        chip.id = 'nv-qchip'; chip.type = 'button';
        chip.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:90;padding:7px 13px;border-radius:999px;background:rgba(3,105,161,.92);border:1px solid #38bdf8;color:#fff;font:700 12.5px Rajdhani,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);cursor:pointer';
        chip.onclick = () => openNuvem('publicar');
        document.body.appendChild(chip);
    }
    const total = nuvem.queue.length, done = nuvem.queue.filter(q => q.state === 'ok' || q.state === 'err').length;
    chip.textContent = `☁️ Publicando na Nuvem… ${done}/${total}`;
    chip.style.display = (typeof isPlaying !== 'undefined' && isPlaying) ? 'none' : '';
}

// ---------- aviso na tela (fora da janela da Nuvem) ----------
function nuvemToast(html, actLabel, act) {
    document.getElementById('nv-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'nv-toast';
    t.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:160;max-width:min(420px,92vw);display:flex;gap:10px;align-items:center;padding:11px 14px;border-radius:14px;background:#0b1120;border:1px solid #38bdf8;box-shadow:0 12px 40px rgba(0,0,0,.6);color:#e0f2fe;font:600 14px Rajdhani,sans-serif';
    t.innerHTML = `<div style="flex:1;line-height:1.3">${html}</div>${actLabel ? `<button data-a style="padding:6px 12px;border-radius:8px;background:#0369a1;border:1px solid #38bdf8;color:#fff;font-weight:800">${actLabel}</button>` : ''}<button data-x style="color:#94a3b8;font-size:16px;padding:0 4px">✕</button>`;
    document.body.appendChild(t);
    if (actLabel) t.querySelector('[data-a]').onclick = () => { t.remove(); act && act(); };
    t.querySelector('[data-x]').onclick = () => t.remove();
    setTimeout(() => t.remove(), 14000);
}

// ---------- NOTIFICAÇÃO de música recebida / pedido de amizade ----------
const NUVEM_SEEN_KEY = 'beatmaxNuvemAvisados_v1';
async function nuvemCheckNew() {
    if (!nuvem.user) return;
    if (typeof isPlaying !== 'undefined' && isPlaying) return; // avisa quando voltar pro menu
    let avisados = [];
    try { avisados = JSON.parse(localStorage.getItem(NUVEM_SEEN_KEY) || '[]'); } catch (e) {}
    const first = !localStorage.getItem(NUVEM_SEEN_KEY);
    try {
        const sb = nuvemClient(), me = nuvem.user.id;
        const shares = await nuvemQ(sb.from('chart_shares').select('chart_id,created_at,charts(title,profiles!charts_owner_fkey(nick))').eq('to_user', me).eq('seen', false).order('created_at', { ascending: false }).limit(20));
        const reqs = await nuvemQ(sb.from('friends').select('user_id,created_at,a:profiles!friends_user_id_fkey(nick)').eq('friend_id', me).eq('status', 'pending').limit(20));
        const novos = [];
        shares.forEach(s => { const k = 's:' + s.chart_id; if (!avisados.includes(k)) { avisados.push(k); novos.push({ k: 'song', nick: s.charts && s.charts.profiles && s.charts.profiles.nick, title: s.charts && s.charts.title }); } });
        reqs.forEach(r => { const k = 'f:' + r.user_id; if (!avisados.includes(k)) { avisados.push(k); novos.push({ k: 'friend', nick: r.a && r.a.nick }); } });
        try { localStorage.setItem(NUVEM_SEEN_KEY, JSON.stringify(avisados.slice(-300))); } catch (e) {}
        if (!novos.length) return;
        const songs = novos.filter(n => n.k === 'song'), friends = novos.filter(n => n.k === 'friend');
        let html;
        if (songs.length === 1 && !friends.length) html = `📩 <b>@${nuvemEsc(songs[0].nick || '?')}</b> te mandou <b>"${nuvemEsc(songs[0].title || 'uma música')}"</b>`;
        else if (songs.length) html = `📩 Você recebeu <b>${songs.length}</b> música${songs.length > 1 ? 's' : ''} na Nuvem${friends.length ? ` e ${friends.length} pedido${friends.length > 1 ? 's' : ''} de amizade` : ''}`;
        else html = friends.length === 1 ? `👋 <b>@${nuvemEsc(friends[0].nick || '?')}</b> quer ser seu amigo na Nuvem` : `👋 ${friends.length} pedidos de amizade na Nuvem`;
        if (first && novos.length > 3) html = `📩 Você tem novidades na Nuvem (${novos.length})`;
        nuvemToast(html, songs.length ? 'Ver músicas' : 'Ver', () => openNuvem(songs.length ? 'recebidas' : 'amigos'));
        try { if (typeof audio !== 'undefined' && audio.ctx) { const c = audio.ctx, t0 = c.currentTime; [880, 1320].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + i * 0.12); g.gain.exponentialRampToValueAtTime(0.12 * (audio.volume || 0.7), t0 + i * 0.12 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 0.3); o.connect(g); g.connect(c.destination); o.start(t0 + i * 0.12); o.stop(t0 + i * 0.12 + 0.32); }); } } catch (e) {}
    } catch (e) { console.warn('[nuvem aviso]', e); }
}

// ---------- aviso de novidades (envios não vistos + pedidos de amizade) ----------
async function nuvemRefreshBadge() {
    if (!nuvem.user) { nuvem.badge = 0; nuvemBadgeUI(); return; }
    try {
        const sb = nuvemClient();
        const a = await sb.from('chart_shares').select('chart_id', { count: 'exact', head: true }).eq('to_user', nuvem.user.id).eq('seen', false);
        const b = await sb.from('friends').select('user_id', { count: 'exact', head: true }).eq('friend_id', nuvem.user.id).eq('status', 'pending');
        nuvem.badge = (a.count || 0) + (b.count || 0);
    } catch (e) {}
    nuvemBadgeUI();
}
function nuvemBadgeUI() {
    const el = document.getElementById('nuvem-badge');
    if (!el) return;
    el.textContent = nuvem.badge > 9 ? '9+' : String(nuvem.badge);
    el.style.display = nuvem.badge > 0 ? '' : 'none';
}

// ---------- interface ----------
function nuvemEnsureModal() {
    let m = document.getElementById('nuvem-modal');
    if (m) return m;
    const css = document.createElement('style');
    css.textContent = `
#nuvem-modal{position:fixed;inset:0;z-index:86;display:none;align-items:center;justify-content:center;background:rgba(2,6,23,.92);backdrop-filter:blur(6px);color:#e2e8f0;font-size:13px;padding:16px}
#nuvem-modal.open{display:flex}
#nuvem-box{width:1020px;max-width:100%;height:min(720px,100%);display:flex;flex-direction:column;background:#0b1120;border:1px solid rgba(56,189,248,.35);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
#nuvem-box header{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #1e293b}
#nuvem-box h2{font-family:Orbitron,monospace;font-weight:900;font-size:17px;color:#7dd3fc;letter-spacing:.04em}
#nuvem-tabs{display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid #1e293b;flex-wrap:wrap}
#nuvem-tabs button{padding:7px 12px;border-radius:8px 8px 0 0;color:#94a3b8;font-weight:700;border:1px solid transparent;border-bottom:none}
#nuvem-tabs button.on{color:#e0f2fe;background:#0f172a;border-color:#1e293b}
#nuvem-body{flex:1;overflow:auto;padding:14px 16px}
#nuvem-modal .nv-btn{padding:6px 11px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-weight:600;cursor:pointer;white-space:nowrap}
#nuvem-modal .nv-btn:hover{background:#334155}
#nuvem-modal .nv-btn:disabled{opacity:.5;cursor:default}
#nuvem-modal .nv-pri{background:#0369a1;border-color:#38bdf8;color:#fff}
#nuvem-modal .nv-pri:hover{background:#0284c7}
#nuvem-modal .nv-ok{background:#047857;border-color:#34d399;color:#fff}
#nuvem-modal .nv-red{border-color:#7f1d1d;color:#fca5a5}
#nuvem-modal input,#nuvem-modal select{background:#020617;border:1px solid #334155;border-radius:8px;padding:6px 9px;color:#e2e8f0;font-size:13px}
#nuvem-modal .nv-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid #1e293b;border-radius:10px;background:#0f172a;margin-bottom:7px}
#nuvem-modal .nv-t{font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#nuvem-modal .nv-s{font-size:11px;color:#94a3b8;font-family:ui-monospace,monospace}
#nuvem-modal .nv-code{white-space:nowrap;font-family:ui-monospace,monospace;color:#fde68a;background:#1c1917;border:1px solid #57534e;border-radius:6px;padding:1px 6px}
#nuvem-modal .nv-msg{min-height:18px;color:#fde68a;margin:6px 0}
#nuvem-modal .nv-auth{max-width:380px;margin:20px auto;display:flex;flex-direction:column;gap:9px}
#nuvem-modal .nv-auth label{color:#94a3b8;font-size:12px}
#nuvem-modal .nv-h{color:#7dd3fc;font-weight:800;margin:4px 0 8px}
#nuvem-modal .nv-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
#nuvem-modal .nv-all{display:flex;align-items:center;gap:5px;cursor:pointer}
#nuvem-modal .nv-chips{display:flex;gap:4px}
#nuvem-modal .nv-chips button{padding:5px 10px;border-radius:999px;border:1px solid #334155;color:#94a3b8;font-weight:700;font-size:12px}
#nuvem-modal .nv-chips button.on{background:#0c4a6e;border-color:#38bdf8;color:#e0f2fe}
#nuvem-modal .nv-lote{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-radius:10px;border:1px dashed #334155;margin-bottom:6px;opacity:.6}
#nuvem-modal .nv-lote.on{opacity:1;border-style:solid;border-color:#0369a1;background:rgba(3,105,161,.12)}
#nuvem-modal .nv-sep{width:1px;height:22px;background:#334155}
#nuvem-modal .nv-row.sel{border-color:#0369a1;background:#0c1a2e}
#nuvem-modal .nv-ck{width:17px;height:17px;flex-shrink:0;accent-color:#38bdf8;cursor:pointer}
#nuvem-modal .nv-st{font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px;margin-left:4px;vertical-align:middle;white-space:nowrap}
#nuvem-modal .nv-st.have{background:rgba(16,185,129,.15);color:#6ee7b7;border:1px solid rgba(16,185,129,.4)}
#nuvem-modal .nv-st.upd{background:rgba(245,158,11,.15);color:#fde68a;border:1px solid rgba(245,158,11,.4)}
#nuvem-modal .nv-st.new{background:rgba(56,189,248,.12);color:#7dd3fc;border:1px solid rgba(56,189,248,.35)}
#nuvem-modal .nv-tag{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid #334155;color:#cbd5e1}
`;
    document.head.appendChild(css);
    m = document.createElement('div');
    m.id = 'nuvem-modal';
    m.innerHTML = `<div id="nuvem-box">
  <header><h2><i class="fa-solid fa-cloud"></i> NUVEM DE CHARTS</h2><span id="nuvem-who" class="nv-s" style="flex:1"></span><button id="nuvem-close" class="nv-btn">Fechar</button></header>
  <nav id="nuvem-tabs"></nav>
  <div id="nuvem-body"></div>
</div>`;
    document.body.appendChild(m);
    m.querySelector('#nuvem-close').onclick = nuvemClose;
    m.addEventListener('mousedown', (e) => { if (e.target === m) nuvemClose(); });
    return m;
}

const NUVEM_TABS = [['publicar', 'Publicar'], ['minhas', 'Minhas'], ['recebidas', 'Recebidas'], ['explorar', 'Explorar'], ['amigos', 'Amigos'], ['conta', 'Conta']];

function nuvemRenderShell() {
    const tabs = document.getElementById('nuvem-tabs');
    const who = document.getElementById('nuvem-who');
    if (!nuvem.user) {
        tabs.innerHTML = '';
        who.textContent = '';
        return nuvemRenderAuth();
    }
    who.innerHTML = nuvem.profile ? `logado como <b style="color:#e0f2fe">${nuvemEsc(nuvem.profile.display)}</b> <span style="color:#7dd3fc">@${nuvemEsc(nuvem.profile.nick)}</span>` : '';
    tabs.innerHTML = NUVEM_TABS.map(([k, n]) => `<button data-t="${k}" class="${nuvem.tab === k ? 'on' : ''}">${n}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b => b.onclick = () => { nuvem.tab = b.dataset.t; nuvemRenderShell(); });
    nuvemRenderTab();
}

function nuvemSetMsg(text, el) {
    el = el || document.getElementById('nuvem-msg');
    if (el) el.textContent = text || '';
}
async function nuvemRun(btn, fn) {
    if (nuvem.busy) return;
    nuvem.busy = true;
    if (btn) btn.disabled = true;
    try { await fn(); }
    catch (e) { console.warn('[nuvem]', e); nuvemSetMsg('⚠️ ' + nuvemErr(e)); }
    finally { nuvem.busy = false; if (btn && btn.isConnected) btn.disabled = false; }
}

function nuvemRenderAuth(mode) {
    mode = mode || 'login';
    const body = document.getElementById('nuvem-body');
    body.innerHTML = mode === 'login' ? `
<div class="nv-auth">
  ${nuvem.pendingCode ? `<div class="nv-msg" style="color:#7dd3fc">Entre (ou crie uma conta grátis) pra baixar a música <span class="nv-code">${nuvemEsc(nuvem.pendingCode)}</span>.</div>` : ''}
  <div class="nv-h">Entrar</div>
  <label>Apelido (ou e-mail)</label><input id="nv-login" autocomplete="username">
  <label>Senha</label><input id="nv-pass" type="password" autocomplete="current-password">
  <button id="nv-go" class="nv-btn nv-pri">Entrar</button>
  <div id="nuvem-msg" class="nv-msg"></div>
  <div class="nv-s">Ainda não tem conta? <a href="#" id="nv-sw" style="color:#7dd3fc">Criar conta</a></div>
</div>` : `
<div class="nv-auth">
  <div class="nv-h">Criar conta</div>
  <label>Apelido — é como os outros vão te achar (3 a 20: letras minúsculas, números ou _)</label><input id="nv-nick" maxlength="20" autocomplete="username">
  <label>Nome que aparece (opcional)</label><input id="nv-disp" maxlength="24">
  <label>Senha (mín. 6)</label><input id="nv-pass" type="password" autocomplete="new-password">
  <label>Repita a senha</label><input id="nv-pass2" type="password" autocomplete="new-password">
  <label>E-mail (opcional — só pra recuperar a senha; com e-mail, você entra usando ele)</label><input id="nv-mail" type="email">
  <button id="nv-go" class="nv-btn nv-pri">Criar conta</button>
  <div id="nuvem-msg" class="nv-msg"></div>
  <div class="nv-s">Já tem conta? <a href="#" id="nv-sw" style="color:#7dd3fc">Entrar</a></div>
</div>`;
    const $ = (id) => document.getElementById(id);
    $('nv-sw').onclick = (e) => { e.preventDefault(); nuvemRenderAuth(mode === 'login' ? 'signup' : 'login'); };
    const nick = $('nv-nick');
    if (nick) nick.oninput = () => { nick.value = nick.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); };
    const go = $('nv-go');
    go.onclick = () => nuvemRun(go, async () => {
        nuvemSetMsg('Conectando…');
        if (mode === 'login') await nuvemSignIn($('nv-login').value, $('nv-pass').value);
        else {
            if ($('nv-pass').value !== $('nv-pass2').value) throw new Error('As senhas não batem.');
            await nuvemSignUp($('nv-nick').value, $('nv-disp').value, $('nv-pass').value, $('nv-mail').value);
        }
        nuvem.tab = nuvem.pendingCode ? 'explorar' : mode === 'login' ? 'recebidas' : 'publicar';
        nuvemRenderShell();
        nuvemRefreshBadge();
    });
    body.querySelectorAll('input').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); }));
}

async function nuvemRenderTab() {
    const body = document.getElementById('nuvem-body');
    const t = nuvem.tab;
    body.innerHTML = '<div class="nv-s">Carregando…</div>';
    try {
        if (t === 'publicar') await nuvemTabPublicar(body);
        else if (t === 'minhas') await nuvemTabMinhas(body);
        else if (t === 'recebidas') await nuvemTabRecebidas(body);
        else if (t === 'explorar') await nuvemTabExplorar(body);
        else if (t === 'amigos') await nuvemTabAmigos(body);
        else nuvemTabConta(body);
    } catch (e) {
        console.warn('[nuvem]', e);
        body.innerHTML = `<div class="nv-msg">⚠️ ${nuvemEsc(nuvemErr(e))}</div><button class="nv-btn" id="nv-retry">Tentar de novo</button>`;
        document.getElementById('nv-retry').onclick = () => nuvemRenderTab();
    }
}

async function nuvemTabPublicar(body) {
    await nuvemLoadMine();
    const dl = nuvemDl();
    const fromCloud = new Set(Object.values(dl).map(v => v.localId));
    const list = customCharts.filter(c => !fromCloud.has(c.id)).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    body.innerHTML = `
<div class="nv-s" style="margin-bottom:8px">Escolha quem pode ver, e publique. A música vai junto (convertida para Opus — fica ~10× menor, sem mudar a sincronia). Charts que você baixou de outros não aparecem aqui.</div>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
  <input id="nv-pq" placeholder="Buscar chart…" style="flex:1;min-width:180px">
  <label class="nv-s">Quem pode ver</label><select id="nv-pvis">${NUVEM_VIS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
  <label class="nv-s" title="Sem música: quem baixar precisa carregar o próprio arquivo"><input type="checkbox" id="nv-paudio" checked> com música</label>
</div>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
  <label class="nv-s" style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" id="nv-pall"> selecionar todas da lista</label>
  <button id="nv-pmany" class="nv-btn nv-pri" disabled>Publicar selecionadas</button>
  <span class="nv-s">Vão pra uma fila e sobem sozinhas (pode fechar a Nuvem e jogar enquanto isso).</span>
</div>
<div id="nuvem-msg" class="nv-msg"></div>
<div id="nv-plist"></div>`;
    const sel = new Set();
    const updMany = () => { const b = document.getElementById('nv-pmany'); if (b) { b.disabled = !sel.size; b.textContent = sel.size ? `Publicar selecionadas (${sel.size})` : 'Publicar selecionadas'; } };
    const render = () => {
        const q = document.getElementById('nv-pq').value.trim().toLowerCase();
        const rows = list.filter(c => !q || (c.title || '').toLowerCase().includes(q)).slice(0, 200);
        document.getElementById('nv-plist').innerHTML = rows.length ? rows.map(c => {
            const pub = nuvem.mine.find(r => r.local_id === c.id);
            return `<div class="nv-row" data-id="${nuvemEsc(c.id)}">
  <input type="checkbox" class="nv-pck" ${sel.has(c.id) ? 'checked' : ''} title="Selecionar pra publicar junto">
  <div style="flex:1;min-width:0"><div class="nv-t">${nuvemEsc(nuvemChartTitle(c))}</div>
  <div class="nv-s">${getModeDisplayName(c.mode)} · ${(c.notes || []).length} notas${c.source === 'osu' ? ' · osu!' : ''}${pub ? ` · <span style="color:#6ee7b7">publicada v${pub.version}</span> <span class="nv-code">${pub.share_code}</span>` : ''}</div>
  <div class="nv-s nv-pst" style="color:#fde68a"></div></div>
  <button class="nv-btn ${pub ? '' : 'nv-pri'}" data-act="pub" data-label="${pub ? 'Atualizar' : 'Publicar'}">${pub ? 'Atualizar' : 'Publicar'}</button>
</div>`;
        }).join('') : '<div class="nv-s">Nenhuma chart sua na biblioteca ainda (crie no Chart Editor ou importe do osu!).</div>';
        document.querySelectorAll('#nv-plist [data-act="pub"]').forEach(btn => {
            btn.onclick = () => {
                nuvemEnqueue(btn.closest('[data-id]').dataset.id, document.getElementById('nv-pvis').value, document.getElementById('nv-paudio').checked);
                nuvemSetMsg('Na fila — sobe sozinha. Dá pra escolher outras enquanto isso.');
            };
        });
        document.querySelectorAll('#nv-plist .nv-pck').forEach(cb => {
            cb.onchange = () => { const id = cb.closest('[data-id]').dataset.id; if (cb.checked) sel.add(id); else sel.delete(id); updMany(); };
        });
        nuvemQueueUI();
    };
    document.getElementById('nv-pq').oninput = render;
    document.getElementById('nv-pall').onchange = (e) => {
        const ids = [...document.querySelectorAll('#nv-plist [data-id]')].map(r => r.dataset.id);
        ids.forEach(id => { if (e.target.checked) sel.add(id); else sel.delete(id); });
        render(); updMany();
    };
    document.getElementById('nv-pmany').onclick = () => {
        const vis = document.getElementById('nv-pvis').value, audio = document.getElementById('nv-paudio').checked;
        const n = sel.size;
        [...sel].forEach(id => nuvemEnqueue(id, vis, audio));
        sel.clear(); document.getElementById('nv-pall').checked = false; render(); updMany();
        nuvemSetMsg(`${n} na fila — sobem sozinhas, ${NUVEM_PARALLEL} de cada vez.`);
    };
    render();
}

// ---------- ações em lote ----------
const NUVEM_WEB_URL = 'https://carlossabino.github.io/beatmax/';
function nuvemLinkDe(code) {
    const base = window.BEATMAX_WEB ? (location.origin + location.pathname) : NUVEM_WEB_URL;
    return `${base}?chart=${encodeURIComponent(code)}`;
}
// estado de uma chart MINHA: a original continua na biblioteca deste aparelho (local_id), ou foi baixada da nuvem
function nuvemMinhaState(r) {
    if (r.local_id && typeof findCustomChart === 'function' && findCustomChart(r.local_id)) return 'have';
    return nuvemLocalState(r);
}
// confirmação dentro da janela (o confirm() do navegador tira o jogo da tela cheia)
function nuvemConfirmar(texto, okLabel) {
    return new Promise(res => {
        const box = document.getElementById('nuvem-box');
        const ov = document.createElement('div');
        ov.style.cssText = 'position:absolute;inset:0;background:rgba(2,6,23,.75);display:flex;align-items:center;justify-content:center;z-index:5;border-radius:16px';
        ov.innerHTML = `<div style="max-width:440px;background:#0f172a;border:1px solid #7f1d1d;border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px">
  <div style="font-weight:700;color:#fff;line-height:1.35">${texto}</div>
  <div style="display:flex;gap:8px;justify-content:flex-end"><button class="nv-btn" data-n>Cancelar</button><button class="nv-btn nv-red" data-y style="background:#7f1d1d;color:#fff">${okLabel || 'Confirmar'}</button></div></div>`;
        box.style.position = 'relative'; box.appendChild(ov);
        const fim = (v) => { ov.remove(); document.removeEventListener('keydown', k, true); res(v); };
        const k = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fim(false); } if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); fim(true); } };
        document.addEventListener('keydown', k, true);
        ov.querySelector('[data-n]').onclick = () => fim(false);
        ov.querySelector('[data-y]').onclick = () => fim(true);
        ov.querySelector('[data-y]').focus();
    });
}
// baixa várias, uma de cada vez, mostrando o andamento
async function nuvemBaixarVarias(items, onEach) {
    let ok = 0, falhas = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        nuvemSetMsg(`⏳ Baixando ${i + 1} de ${items.length}: "${it.row.title}"…`);
        try { await nuvemDownload(it.row, it.nick); ok++; if (onEach) onEach(it); }
        catch (e) { falhas.push(`${it.row.title} (${nuvemErr(e)})`); }
    }
    nuvemSetMsg(falhas.length ? `⚠️ ${ok} baixada(s); não deu em ${falhas.length}: ${falhas.join('; ')}` : `✅ ${ok} música(s) na sua biblioteca.`);
    if (ok && typeof libQueue === 'function') libQueue();
    return ok;
}
async function nuvemSendMany(rows, nick) {
    const p = await nuvemFindNick(nick);
    const sb = nuvemClient();
    await nuvemQ(sb.from('chart_shares').upsert(rows.map(r => ({ chart_id: r.id, to_user: p.id })), { onConflict: 'chart_id,to_user', ignoreDuplicates: true }));
    const priv = rows.filter(r => r.visibility === 'private');
    if (priv.length) { await nuvemQ(sb.from('charts').update({ visibility: 'friends' }).in('id', priv.map(r => r.id))); priv.forEach(r => { r.visibility = 'friends'; }); }
    return p;
}
async function nuvemApagarVarias(rows) {
    const sb = nuvemClient();
    const paths = rows.map(r => r.file_path).filter(Boolean);
    if (paths.length) await sb.storage.from('charts').remove(paths);
    await nuvemQ(sb.from('charts').delete().in('id', rows.map(r => r.id)));
}

const NUVEM_ST = {
    have: '<span class="nv-st have">✔ na biblioteca</span>',
    update: '<span class="nv-st upd">⟳ versão nova</span>',
    new: '<span class="nv-st new">⬇ não está aqui</span>'
};

async function nuvemTabMinhas(body) {
    await nuvemLoadMine();
    const sel = new Set();
    let filtro = 'todas';
    body.innerHTML = `<div class="nv-s" style="margin-bottom:8px">Suas músicas na nuvem. Marque várias pra <b>baixar</b> neste aparelho (ex.: jogar no Xbox/navegador), <b>enviar</b> pra um amigo ou <b>apagar</b> de uma vez.</div>
<div class="nv-bar">
  <label class="nv-s nv-all"><input type="checkbox" id="nv-mall"> todas</label>
  <div class="nv-chips">${[['todas', 'Todas'], ['faltam', 'Não estão aqui'], ['tenho', 'Na biblioteca']].map(([k, n]) => `<button data-f="${k}" class="${k === filtro ? 'on' : ''}">${n}</button>`).join('')}</div>
  <input id="nv-mq" placeholder="Buscar…" style="flex:1;min-width:140px">
</div>
<div class="nv-lote" id="nv-mlote">
  <span id="nv-mcount" class="nv-s">Nenhuma selecionada</span>
  <button class="nv-btn nv-pri" data-l="dl">⬇ Baixar</button>
  <span class="nv-sep"></span>
  <input id="nv-mnick" placeholder="@apelido" style="width:120px"><button class="nv-btn" data-l="send">✉ Enviar</button>
  <span class="nv-sep"></span>
  <button class="nv-btn" data-l="link" title="Copia os links (abrem direto no site do jogo)">🔗 Copiar links</button>
  <button class="nv-btn nv-red" data-l="del">🗑 Apagar da nuvem</button>
</div>
<div id="nuvem-msg" class="nv-msg"></div>
<div id="nv-mlist"></div>`;
    const me = nuvem.profile && nuvem.profile.nick;
    const $ = (id) => document.getElementById(id);
    const visiveis = () => {
        const q = $('nv-mq').value.trim().toLowerCase();
        return nuvem.mine.filter(r => {
            const st = nuvemMinhaState(r);
            if (filtro === 'faltam' && st === 'have') return false;
            if (filtro === 'tenho' && st !== 'have') return false;
            return !q || (r.title || '').toLowerCase().includes(q) || (r.artist || '').toLowerCase().includes(q);
        });
    };
    const escolhidas = () => nuvem.mine.filter(r => sel.has(r.id));
    const updLote = () => {
        const n = sel.size;
        $('nv-mcount').textContent = n ? `${n} selecionada${n > 1 ? 's' : ''}` : 'Nenhuma selecionada';
        $('nv-mlote').classList.toggle('on', n > 0);
        $('nv-mlote').querySelectorAll('button').forEach(b => { b.disabled = !n; });
        const vis = visiveis(); $('nv-mall').checked = vis.length > 0 && vis.every(r => sel.has(r.id));
    };
    const render = () => {
        const rows = visiveis();
        $('nv-mlist').innerHTML = !nuvem.mine.length ? '<div class="nv-s">Você ainda não publicou nada — vá em "Publicar".</div>'
            : !rows.length ? '<div class="nv-s">Nenhuma música neste filtro.</div>'
            : rows.map(r => {
                const st = nuvemMinhaState(r);
                return `<div class="nv-row${sel.has(r.id) ? ' sel' : ''}" data-id="${r.id}">
  <input type="checkbox" class="nv-ck" ${sel.has(r.id) ? 'checked' : ''}>
  <div style="flex:1;min-width:0"><div class="nv-t">${nuvemEsc(r.title)} ${NUVEM_ST[st]}</div>
  <div class="nv-s">${r.artist ? nuvemEsc(r.artist) + ' · ' : ''}${getModeDisplayName(r.mode)} · ${r.notes_count} notas · v${r.version} · ${nuvemMB(r.file_size || 0)}${r.audio_codec && r.audio_codec !== 'none' ? '' : ' · sem música'} · ⬇ ${r.downloads} · <span class="nv-code" title="Código pra passar pra alguém">${r.share_code}</span></div></div>
  <select data-act="vis" title="Quem pode ver">${NUVEM_VIS.map(([v, n]) => `<option value="${v}"${v === r.visibility ? ' selected' : ''}>${n}</option>`).join('')}</select>
  ${st === 'have' ? '<button class="nv-btn" data-act="dl" title="Baixar de novo (substitui)">↻</button>' : `<button class="nv-btn ${st === 'update' ? 'nv-ok' : 'nv-pri'}" data-act="dl">${st === 'update' ? 'Atualizar' : '⬇ Baixar'}</button>`}
</div>`;
            }).join('');
        $('nv-mlist').querySelectorAll('.nv-row').forEach(rowEl => {
            const r = nuvem.mine.find(x => x.id === rowEl.dataset.id);
            const q = (s) => rowEl.querySelector(`[data-act="${s}"]`);
            rowEl.querySelector('.nv-ck').onchange = (e) => { if (e.target.checked) sel.add(r.id); else sel.delete(r.id); rowEl.classList.toggle('sel', e.target.checked); updLote(); };
            q('vis').onchange = (e) => nuvemRun(null, async () => {
                await nuvemQ(nuvemClient().from('charts').update({ visibility: e.target.value }).eq('id', r.id));
                r.visibility = e.target.value;
                nuvemSetMsg(`✅ "${r.title}" agora: ${nuvemVisName(r.visibility)}.`);
            });
            const dl = q('dl');
            dl.onclick = () => nuvemRun(dl, async () => { await nuvemBaixarVarias([{ row: r, nick: me }]); render(); });
        });
        updLote();
    };
    $('nv-mq').oninput = render;
    body.querySelectorAll('.nv-chips button').forEach(b => b.onclick = () => { filtro = b.dataset.f; body.querySelectorAll('.nv-chips button').forEach(x => x.classList.toggle('on', x === b)); render(); });
    $('nv-mall').onchange = (e) => { visiveis().forEach(r => { if (e.target.checked) sel.add(r.id); else sel.delete(r.id); }); render(); };
    const L = (k) => $('nv-mlote').querySelector(`[data-l="${k}"]`);
    L('dl').onclick = () => nuvemRun(L('dl'), async () => {
        const rows = escolhidas();
        const falta = rows.filter(r => nuvemMinhaState(r) !== 'have');
        const items = (falta.length ? falta : rows).map(r => ({ row: r, nick: me }));
        await nuvemBaixarVarias(items);
        sel.clear(); render();
    });
    const send = L('send');
    send.onclick = () => nuvemRun(send, async () => {
        const rows = escolhidas();
        const p = await nuvemSendMany(rows, $('nv-mnick').value);
        $('nv-mnick').value = '';
        nuvemSetMsg(`✅ ${rows.length} música(s) enviada(s) pra ${p.display} (@${p.nick}). Aparecem em "Recebidas" na conta de @${p.nick}.`);
        sel.clear(); render();
    });
    $('nv-mnick').addEventListener('keydown', (e) => { if (e.key === 'Enter' && sel.size) send.click(); });
    L('link').onclick = async () => {
        const txt = escolhidas().map(r => `${r.title} — ${nuvemLinkDe(r.share_code)}`).join('\n');
        try { await navigator.clipboard.writeText(txt); nuvemSetMsg(`📋 ${sel.size} link(s) copiado(s). Quem abrir o link vai direto pra música no site do jogo (o código também funciona em Explorar).`); }
        catch (e) { nuvemSetMsg(txt); }
    };
    const del = L('del');
    del.onclick = async () => {
        const rows = escolhidas();
        if (!await nuvemConfirmar(`Tirar <b>${rows.length}</b> música(s) da nuvem?<br><span class="nv-s">Elas continuam na sua biblioteca, e quem já baixou continua com elas.</span>`, 'Apagar')) return;
        nuvemRun(del, async () => { await nuvemApagarVarias(rows); sel.clear(); await nuvemLoadMine(); render(); nuvemSetMsg(`🗑 ${rows.length} música(s) tiradas da nuvem.`); });
    };
    render();
}

function nuvemCloudRowHtml(r, ownerNick, extra) {
    const st = nuvemLocalState(r);
    const btn = st === 'have' ? '<button class="nv-btn" data-act="dl" title="Baixar de novo">✔ Na biblioteca</button>'
        : `<button class="nv-btn ${st === 'update' ? 'nv-ok' : 'nv-pri'}" data-act="dl">${st === 'update' ? `Atualizar (v${r.version})` : 'Baixar'}</button>`;
    return `<div class="nv-row" data-id="${r.id}">
  <div style="flex:1;min-width:0"><div class="nv-t">${nuvemEsc(r.title)} ${NUVEM_ST[st]}${extra || ''}</div>
  <div class="nv-s">${r.artist ? nuvemEsc(r.artist) + ' · ' : ''}${getModeDisplayName(r.mode)} · ${r.notes_count} notas · ${nuvemMB(r.file_size || 0)}${r.audio_codec === 'none' ? ' · sem música' : ''} · por @${nuvemEsc(ownerNick || '?')} · ⬇ ${r.downloads}</div></div>
  ${btn}
</div>`;
}
// barra "baixar todas as que faltam" + "esconder as que já tenho" pra uma lista de { row, nick }
let nuvemEsconderTenho = false;
try { nuvemEsconderTenho = localStorage.getItem('djmaxNuvemEsconder') === '1'; } catch (e) {}
function nuvemListaComBarra(box, items, extraDe, vazio) {
    const desenhar = () => {
        const falta = items.filter(it => nuvemLocalState(it.row) !== 'have');
        const mostrar = nuvemEsconderTenho ? falta : items;
        box.innerHTML = `<div class="nv-bar" style="margin:2px 0 8px">
  <button class="nv-btn nv-pri" data-all ${falta.length ? '' : 'disabled'}>⬇ Baixar todas as que faltam${falta.length ? ` (${falta.length})` : ''}</button>
  <label class="nv-s nv-all"><input type="checkbox" data-hide ${nuvemEsconderTenho ? 'checked' : ''}> esconder as que já tenho</label>
  <span class="nv-s">${items.length - falta.length} de ${items.length} já na biblioteca</span></div>`
            + (mostrar.length ? mostrar.map(it => nuvemCloudRowHtml(it.row, it.nick, extraDe ? extraDe(it) : '')).join('') : `<div class="nv-s">${items.length ? 'Você já tem todas daqui. 🎉' : vazio}</div>`);
        nuvemBindDownloads(box, items, desenhar);
        const all = box.querySelector('[data-all]');
        all.onclick = () => nuvemRun(all, async () => { await nuvemBaixarVarias(falta); desenhar(); nuvemRefreshBadge(); });
        box.querySelector('[data-hide]').onchange = (e) => { nuvemEsconderTenho = e.target.checked; try { localStorage.setItem('djmaxNuvemEsconder', nuvemEsconderTenho ? '1' : '0'); } catch (er) {} desenhar(); };
    };
    desenhar();
}
function nuvemBindDownloads(container, rows, depois) {
    container.querySelectorAll('[data-act="dl"]').forEach(btn => {
        const id = btn.closest('[data-id]').dataset.id;
        const it = rows.find(x => x.row.id === id);
        btn.onclick = () => nuvemRun(btn, async () => {
            nuvemSetMsg(`⏳ Baixando "${it.row.title}"…`);
            const res = await nuvemDownload(it.row, it.nick);
            nuvemSetMsg(`✅ "${res.chart.title}" está na sua biblioteca${res.hadAudio ? ' com a música' : ' (sem música — carregue o arquivo no Chart Editor)'}.`);
            if (depois) depois(); else btn.outerHTML = '<button class="nv-btn" disabled>✔ Na biblioteca</button>';
        });
    });
}

async function nuvemTabRecebidas(body) {
    const sb = nuvemClient(), me = nuvem.user.id;
    const shares = await nuvemQ(sb.from('chart_shares').select('seen,created_at,charts(*,profiles!charts_owner_fkey(nick,display))').eq('to_user', me).order('created_at', { ascending: false }));
    const friendCharts = await nuvemQ(sb.from('charts').select('*,profiles!charts_owner_fkey(nick,display)').eq('visibility', 'friends').neq('owner', me).order('updated_at', { ascending: false }).limit(100));
    const items = [];
    const seen = new Set();
    shares.forEach(s => { if (s.charts && !seen.has(s.charts.id)) { seen.add(s.charts.id); items.push({ row: s.charts, nick: s.charts.profiles && s.charts.profiles.nick, isNew: !s.seen, direct: true }); } });
    friendCharts.forEach(c => { if (!seen.has(c.id)) { seen.add(c.id); items.push({ row: c, nick: c.profiles && c.profiles.nick }); } });
    body.innerHTML = `<div class="nv-s" style="margin-bottom:8px">Músicas que mandaram pra você e as que seus amigos liberaram pra amigos. Recebeu um <b>código</b>? Abra em "Explorar".</div>
<div id="nuvem-msg" class="nv-msg"></div>
<div id="nv-rlist"></div>`;
    nuvemListaComBarra(document.getElementById('nv-rlist'), items,
        it => (it.isNew ? ' <span class="nv-tag" style="border-color:#f59e0b;color:#fde68a">NOVA</span>' : '') + (it.direct ? ' <span class="nv-tag">enviada pra você</span>' : ' <span class="nv-tag">de amigo</span>'),
        'Nada por aqui ainda. Adicione amigos na aba "Amigos" ou peça o código de uma música.');
}

async function nuvemTabExplorar(body) {
    body.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
  <input id="nv-code" placeholder="BMX-XXXXXX" style="width:140px;text-transform:uppercase"><button id="nv-codego" class="nv-btn nv-pri">Abrir código</button>
  <span style="flex:1"></span>
  <input id="nv-eq" placeholder="Buscar nas públicas…" style="min-width:200px"><select id="nv-emode"><option value="">Todos os modos</option><option value="4K">4B</option><option value="5K">5B</option><option value="6K">6B</option><option value="8K">8B</option></select>
</div>
<div id="nuvem-msg" class="nv-msg"></div>
<div id="nv-codebox"></div>
<div class="nv-h" style="margin-top:6px">Públicas</div>
<div id="nv-elist"><div class="nv-s">Carregando…</div></div>`;
    const sb = nuvemClient();
    const load = async () => {
        let q = sb.from('charts').select('*,profiles!charts_owner_fkey(nick,display)').eq('visibility', 'public').order('updated_at', { ascending: false }).limit(60);
        const term = document.getElementById('nv-eq').value.trim();
        if (term) q = q.or(`title.ilike.%${term.replace(/[%,()]/g, ' ')}%,artist.ilike.%${term.replace(/[%,()]/g, ' ')}%`);
        const mode = document.getElementById('nv-emode').value;
        if (mode) q = q.eq('mode', mode);
        const rows = await nuvemQ(q);
        const items = rows.map(r => ({ row: r, nick: r.profiles && r.profiles.nick }));
        nuvemListaComBarra(document.getElementById('nv-elist'), items, null, 'Nenhuma música pública encontrada.');
    };
    let t = 0;
    document.getElementById('nv-eq').oninput = () => { clearTimeout(t); t = setTimeout(() => nuvemRun(null, load), 350); };
    document.getElementById('nv-emode').onchange = () => nuvemRun(null, load);
    const go = document.getElementById('nv-codego');
    go.onclick = () => nuvemRun(go, async () => {
        const code = document.getElementById('nv-code').value.trim().toUpperCase();
        if (!/^BMX-[A-Z0-9]{6}$/.test(code)) throw new Error('Código no formato BMX-XXXXXX.');
        const rows = await nuvemQ(sb.rpc('chart_by_code', { code }));
        const box = document.getElementById('nv-codebox');
        if (!rows || !rows.length) { box.innerHTML = ''; throw new Error('Nenhuma chart liberada pra você com esse código (pode ser só pra amigos ou "Só eu").'); }
        const r = rows[0];
        const p = await nuvemQ(sb.from('profiles').select('nick').eq('id', r.owner).maybeSingle());
        const items = [{ row: r, nick: p && p.nick }];
        box.innerHTML = nuvemCloudRowHtml(r, p && p.nick, ' <span class="nv-tag">pelo código</span>');
        nuvemBindDownloads(box, items);
        nuvemSetMsg('');
    });
    document.getElementById('nv-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    if (nuvem.pendingCode) { document.getElementById('nv-code').value = nuvem.pendingCode; nuvem.pendingCode = null; go.click(); }
    await load();
}

async function nuvemTabAmigos(body) {
    const me = nuvem.user.id;
    const rows = await nuvemLoadFriends();
    const other = (r) => (r.user_id === me ? r.b : r.a) || {};
    const accepted = rows.filter(r => r.status === 'accepted');
    const incoming = rows.filter(r => r.status === 'pending' && r.friend_id === me);
    const outgoing = rows.filter(r => r.status === 'pending' && r.user_id === me);
    const line = (r, btns) => `<div class="nv-row" data-u="${r.user_id}" data-f="${r.friend_id}"><div style="flex:1"><div class="nv-t">${nuvemEsc(other(r).display || '?')}</div><div class="nv-s">@${nuvemEsc(other(r).nick || '?')}</div></div>${btns}</div>`;
    body.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:8px"><input id="nv-fnick" placeholder="@apelido do amigo"><button id="nv-fadd" class="nv-btn nv-pri">Adicionar</button></div>
<div id="nuvem-msg" class="nv-msg"></div>
${incoming.length ? `<div class="nv-h">Pedidos pra você</div>${incoming.map(r => line(r, '<button class="nv-btn nv-ok" data-act="ok">Aceitar</button><button class="nv-btn nv-red" data-act="rm">Recusar</button>')).join('')}` : ''}
<div class="nv-h">Amigos (${accepted.length})</div>
${accepted.length ? accepted.map(r => line(r, '<button class="nv-btn nv-red" data-act="rm">Desfazer</button>')).join('') : '<div class="nv-s">Ninguém ainda. Peça o apelido de quem você quer adicionar.</div>'}
${outgoing.length ? `<div class="nv-h" style="margin-top:10px">Aguardando resposta</div>${outgoing.map(r => line(r, '<button class="nv-btn" data-act="rm">Cancelar</button>')).join('')}` : ''}`;
    const sb = nuvemClient();
    const add = document.getElementById('nv-fadd');
    add.onclick = () => nuvemRun(add, async () => { const msg = await nuvemAddFriend(document.getElementById('nv-fnick').value); await nuvemRenderTab(); nuvemSetMsg('✅ ' + msg); });
    document.getElementById('nv-fnick').addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
    body.querySelectorAll('[data-act]').forEach(b => {
        const el = b.closest('[data-u]');
        if (!el) return;
        const u = el.dataset.u, f = el.dataset.f;
        b.onclick = () => nuvemRun(b, async () => {
            if (b.dataset.act === 'ok') await nuvemQ(sb.from('friends').update({ status: 'accepted' }).eq('user_id', u).eq('friend_id', f));
            else await nuvemQ(sb.from('friends').delete().eq('user_id', u).eq('friend_id', f));
            await nuvemRenderTab();
            nuvemRefreshBadge();
        });
    });
}

function nuvemTabConta(body) {
    const p = nuvem.profile || {};
    const fake = (nuvem.user.email || '').endsWith('@' + NUVEM_MAIL_DOMAIN);
    body.innerHTML = `<div class="nv-auth" style="margin-top:0">
  <div class="nv-h">Sua conta</div>
  <div class="nv-s">Apelido: <b style="color:#e0f2fe">@${nuvemEsc(p.nick)}</b> — é ele que os amigos usam pra te achar.</div>
  <div class="nv-s">Entrar com: <b style="color:#e0f2fe">${fake ? '@' + nuvemEsc(p.nick) + ' (sem e-mail)' : nuvemEsc(nuvem.user.email)}</b></div>
  <label>Nome que aparece</label><div style="display:flex;gap:6px"><input id="nv-cdisp" maxlength="24" value="${nuvemEsc(p.display)}" style="flex:1"><button id="nv-csave" class="nv-btn">Salvar</button></div>
  <label>Trocar senha</label><div style="display:flex;gap:6px"><input id="nv-cpass" type="password" placeholder="nova senha (mín. 6)" style="flex:1"><button id="nv-cpw" class="nv-btn">Trocar</button></div>
  <div id="nuvem-msg" class="nv-msg"></div>
  <button id="nv-out" class="nv-btn nv-red">Sair desta conta</button>
  <div class="nv-s" style="margin-top:8px">Espaço da nuvem (plano grátis): até 40 charts publicadas por conta e 25 MB por chart.</div>
</div>`;
    const sb = nuvemClient();
    const sv = document.getElementById('nv-csave');
    sv.onclick = () => nuvemRun(sv, async () => {
        const d = document.getElementById('nv-cdisp').value.trim();
        if (d.length < 3) throw new Error('Nome com pelo menos 3 letras.');
        await nuvemQ(sb.from('profiles').update({ display: d }).eq('id', nuvem.user.id));
        nuvem.profile.display = d; nuvemRenderShell(); nuvemSetMsg('✅ Nome salvo.');
    });
    const pw = document.getElementById('nv-cpw');
    pw.onclick = () => nuvemRun(pw, async () => {
        const v = document.getElementById('nv-cpass').value;
        if (v.length < 6) throw new Error('Senha fraca: use pelo menos 6 caracteres.');
        const r = await sb.auth.updateUser({ password: v });
        if (r.error) throw r.error;
        document.getElementById('nv-cpass').value = '';
        nuvemSetMsg('✅ Senha trocada.');
    });
    document.getElementById('nv-out').onclick = async () => { await nuvemSignOut(); nuvemRenderShell(); };
}

async function openNuvem(tab) {
    if (typeof isPlaying !== 'undefined' && isPlaying) return;
    const m = nuvemEnsureModal();
    m.classList.add('open');
    if (tab) nuvem.tab = tab;
    document.getElementById('nuvem-body').innerHTML = '<div class="nv-s">Conectando…</div>';
    try { await nuvemLoadProfile(); }
    catch (e) { document.getElementById('nuvem-body').innerHTML = `<div class="nv-msg">⚠️ ${nuvemEsc(nuvemErr(e))}</div>`; return; }
    nuvemRenderShell();
}
function nuvemClose() {
    const m = document.getElementById('nuvem-modal');
    if (m) m.classList.remove('open');
    nuvemRefreshBadge();
}

// link de música (…/?chart=BMX-XXXXXX): abre a Nuvem direto nela
(function nuvemLinkDeEntrada() {
    let code = null;
    try { code = new URLSearchParams(location.search).get('chart'); } catch (e) {}
    if (!code || !/^BMX-[A-Z0-9]{6}$/i.test(code)) return;
    nuvem.pendingCode = code.toUpperCase();
    try { const u = new URL(location.href); u.searchParams.delete('chart'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); } catch (e) {}
    const tentar = (n) => {
        const ocupado = (typeof introEl !== 'undefined' && introEl) || document.getElementById('perfil-ov') || (typeof isPlaying !== 'undefined' && isPlaying);
        if (ocupado && n < 120) return setTimeout(() => tentar(n + 1), 500);
        openNuvem('explorar');
    };
    setTimeout(() => tentar(0), 1500);
})();

// charts baixadas mostram de quem vieram
(function nuvemSongInfo() {
    const orig = window.songInfoFor;
    if (typeof orig !== 'function') return;
    window.songInfoFor = function (pattern) {
        const info = orig.apply(this, arguments);
        pattern = pattern || currentPatternType;
        if (info && info.kind === 'custom' && typeof pattern === 'string' && pattern.startsWith('custom:')) {
            const ch = findCustomChart(pattern.slice(7));
            if (ch && ch.cloud && ch.cloud.from) info.sub = `Da nuvem · @${ch.cloud.from}`;
        }
        return info;
    };
})();

// botão no topo + aviso de novidades
(function addNuvemButton() {
    const ref = document.getElementById('btn-settings');
    if (!ref || document.getElementById('btn-nuvem')) return;
    const b = document.createElement('button');
    b.id = 'btn-nuvem';
    b.className = ref.className + ' relative';
    b.innerHTML = '<i class="fa-solid fa-cloud" style="color:#38bdf8"></i> Nuvem<span id="nuvem-badge" style="display:none;position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#f59e0b;color:#111827;font-size:11px;font-weight:800;line-height:18px;text-align:center"></span>';
    ref.parentElement.insertBefore(b, ref);
    b.addEventListener('click', () => openNuvem());
    document.addEventListener('keydown', (e) => {
        const m = document.getElementById('nuvem-modal');
        if (e.key === 'Escape' && m && m.classList.contains('open')) { e.preventDefault(); e.stopImmediatePropagation(); nuvemClose(); }
    }, true);
    // checa novidades ao abrir o jogo e a cada 1 min (nunca durante a partida): número no
    // botão + aviso na tela quando chega música nova ou pedido de amizade
    let wasPlaying = false;
    const tick = async () => {
        if (typeof isPlaying !== 'undefined' && isPlaying) return;
        try { if (!nuvem.user) await nuvemLoadProfile(); } catch (e) { return; }
        nuvemRefreshBadge();
        nuvemCheckNew();
    };
    setTimeout(tick, 4000);
    nuvem.pollT = setInterval(tick, 60000);
    // terminou a partida: confere logo (o aviso que chegou durante a música aparece agora)
    setInterval(() => {
        const p = typeof isPlaying !== 'undefined' && isPlaying;
        if (wasPlaying && !p) setTimeout(tick, 2500);
        wasPlaying = p;
        const chip = document.getElementById('nv-qchip'); if (chip) chip.style.display = p ? 'none' : '';
    }, 1000);
})();
