-- =====================================================================================
-- BEATMAX Training — nuvem de charts (Supabase)
-- Rode TUDO de uma vez em: Supabase → SQL Editor → New query → colar → Run.
-- Pode rodar de novo sem medo (usa IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--
-- Modelo:
--   profiles      um por conta (apelido único, é o que os outros jogadores veem)
--   charts        a chart publicada (metadados); os arquivos ficam no Storage "charts"
--   chart_shares  "mandei essa chart pro apelido X"
--   friends       amizades (pedido -> aceito)
-- Visibilidade de uma chart:
--   private  só o dono
--   friends  dono + amigos aceitos + quem recebeu direto
--   link     qualquer conta logada que tenha o CÓDIGO (ex.: BMX-7F3K2Q)
--   public   qualquer conta logada (aba Explorar)
-- Arquivos no Storage: charts/<uid do dono>/<id da chart>/pacote.djmaxchart
-- =====================================================================================

-- ---------- perfis ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nick        text not null unique check (nick ~ '^[a-z0-9_]{3,20}$'),
  display     text not null check (char_length(display) between 3 and 24),
  created_at  timestamptz not null default now()
);

-- cria o perfil automaticamente no cadastro (o app manda nick/display nos metadados)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nick, display)
  values (new.id,
          lower(new.raw_user_meta_data->>'nick'),
          coalesce(new.raw_user_meta_data->>'display', new.raw_user_meta_data->>'nick'));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- amizades ----------
create table if not exists public.friends (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  friend_id   uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','accepted')),
  created_at  timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friends f
                 where f.status = 'accepted'
                   and ((f.user_id = a and f.friend_id = b) or (f.user_id = b and f.friend_id = a)));
$$;

-- ---------- charts ----------
create table if not exists public.charts (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references public.profiles(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  artist       text,
  mode         text not null check (mode in ('4K','5K','6K','8K')),
  notes_count  int  not null default 0,
  duration_s   int  not null default 0,
  bpm          numeric,
  visibility   text not null default 'friends' check (visibility in ('private','friends','link','public')),
  share_code   text not null unique default ('BMX-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))),
  version      int  not null default 1,
  local_id     text,                 -- id da chart no jogo de quem publicou (pra atualizar)
  file_path    text,                 -- caminho no Storage
  file_size    int  not null default 0,
  audio_codec  text,                 -- opus / mp3 / flac / none
  downloads    int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (owner, local_id)
);
create index if not exists charts_owner_idx on public.charts(owner);
create index if not exists charts_public_idx on public.charts(visibility, updated_at desc);

-- limite por conta (o plano grátis tem 1 GB no total): 40 charts e 25 MB por arquivo
create or replace function public.charts_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and (select count(*) from charts where owner = new.owner) >= 40 then
    raise exception 'Limite de 40 charts publicadas por conta.';
  end if;
  if new.file_size > 25 * 1024 * 1024 then
    raise exception 'Arquivo grande demais (máx. 25 MB).';
  end if;
  -- o arquivo tem que ser o da própria chart (ninguém aponta pra arquivo dos outros)
  if new.file_path is not null and new.file_path <> new.owner::text || '/' || new.id::text || '/pacote.djmaxchart' then
    raise exception 'Caminho de arquivo inválido.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists charts_quota_trg on public.charts;
create trigger charts_quota_trg before insert or update on public.charts
  for each row execute function public.charts_quota();

-- ---------- compartilhamento direto ----------
create table if not exists public.chart_shares (
  chart_id    uuid not null references public.charts(id) on delete cascade,
  to_user     uuid not null references public.profiles(id) on delete cascade,
  seen        boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (chart_id, to_user)
);

-- quem pode ver uma chart
create or replace function public.can_see_chart(c public.charts, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select c.owner = uid
      or c.visibility = 'public'
      or (c.visibility = 'friends' and public.are_friends(c.owner, uid))
      or exists (select 1 from chart_shares s where s.chart_id = c.id and s.to_user = uid);
$$;

-- buscar pelo código: 'link'/'public' pra qualquer conta; 'friends' só pra quem já pode ver
create or replace function public.chart_by_code(code text) returns setof public.charts
language sql stable security definer set search_path = public as $$
  select * from charts c
  where c.share_code = upper(trim(code))
    and auth.uid() is not null
    and (c.visibility in ('link','public') or public.can_see_chart(c, auth.uid()));
$$;

-- pode baixar o arquivo? (sem RLS aqui dentro: 'link' não aparece nas listas, mas baixa)
create or replace function public.can_download(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from charts c
                 where c.file_path = path
                   and (c.visibility in ('link','public') or public.can_see_chart(c, auth.uid())));
$$;

-- contador de downloads
create or replace function public.chart_downloaded(cid uuid) returns void
language sql security definer set search_path = public as $$
  update charts set downloads = downloads + 1 where id = cid;
$$;

-- ninguém troca de quem/pra quem é um pedido de amizade ou um envio (só o status/visto)
create or replace function public.lock_friends() returns trigger language plpgsql as $$
begin
  if new.user_id <> old.user_id or new.friend_id <> old.friend_id then raise exception 'Não pode mudar isso.'; end if;
  return new;
end $$;
create or replace function public.lock_shares() returns trigger language plpgsql as $$
begin
  if new.chart_id <> old.chart_id or new.to_user <> old.to_user then raise exception 'Não pode mudar isso.'; end if;
  return new;
end $$;
create or replace function public.lock_charts() returns trigger language plpgsql as $$
begin
  if new.owner <> old.owner or new.id <> old.id then raise exception 'Não pode mudar isso.'; end if;
  return new;
end $$;
drop function if exists public.lock_keys() cascade;
drop trigger if exists friends_lock on public.friends;
create trigger friends_lock before update on public.friends for each row execute function public.lock_friends();
drop trigger if exists shares_lock on public.chart_shares;
create trigger shares_lock before update on public.chart_shares for each row execute function public.lock_shares();
drop trigger if exists charts_lock on public.charts;
create trigger charts_lock before update on public.charts for each row execute function public.lock_charts();

-- ---------- RLS (segurança por linha) ----------
alter table public.profiles     enable row level security;
alter table public.friends      enable row level security;
alter table public.charts       enable row level security;
alter table public.chart_shares enable row level security;

drop policy if exists "perfis visiveis" on public.profiles;
create policy "perfis visiveis" on public.profiles for select to authenticated using (true);
drop policy if exists "edito meu perfil" on public.profiles;
create policy "edito meu perfil" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "vejo minhas amizades" on public.friends;
create policy "vejo minhas amizades" on public.friends for select to authenticated using (auth.uid() in (user_id, friend_id));
drop policy if exists "peço amizade" on public.friends;
create policy "peço amizade" on public.friends for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
drop policy if exists "aceito amizade" on public.friends;
create policy "aceito amizade" on public.friends for update to authenticated using (friend_id = auth.uid()) with check (friend_id = auth.uid());
drop policy if exists "desfaço amizade" on public.friends;
create policy "desfaço amizade" on public.friends for delete to authenticated using (auth.uid() in (user_id, friend_id));

drop policy if exists "vejo charts permitidas" on public.charts;
create policy "vejo charts permitidas" on public.charts for select to authenticated using (public.can_see_chart(charts, auth.uid()));
drop policy if exists "publico as minhas" on public.charts;
create policy "publico as minhas" on public.charts for insert to authenticated with check (owner = auth.uid());
drop policy if exists "edito as minhas" on public.charts;
create policy "edito as minhas" on public.charts for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "apago as minhas" on public.charts;
create policy "apago as minhas" on public.charts for delete to authenticated using (owner = auth.uid());

drop policy if exists "vejo envios" on public.chart_shares;
create policy "vejo envios" on public.chart_shares for select to authenticated
  using (to_user = auth.uid() or exists (select 1 from charts c where c.id = chart_id and c.owner = auth.uid()));
drop policy if exists "envio as minhas" on public.chart_shares;
create policy "envio as minhas" on public.chart_shares for insert to authenticated
  with check (exists (select 1 from charts c where c.id = chart_id and c.owner = auth.uid()));
drop policy if exists "marco como vista" on public.chart_shares;
create policy "marco como vista" on public.chart_shares for update to authenticated using (to_user = auth.uid());
drop policy if exists "removo envio" on public.chart_shares;
create policy "removo envio" on public.chart_shares for delete to authenticated
  using (to_user = auth.uid() or exists (select 1 from charts c where c.id = chart_id and c.owner = auth.uid()));

-- ---------- Storage ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('charts', 'charts', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "envio na minha pasta" on storage.objects;
create policy "envio na minha pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "troco na minha pasta" on storage.objects;
create policy "troco na minha pasta" on storage.objects for update to authenticated
  using (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "apago da minha pasta" on storage.objects;
create policy "apago da minha pasta" on storage.objects for delete to authenticated
  using (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "vejo minha pasta" on storage.objects;
create policy "vejo minha pasta" on storage.objects for select to authenticated
  using (bucket_id = 'charts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "baixo o que posso ver" on storage.objects;
create policy "baixo o que posso ver" on storage.objects for select to authenticated
  using (bucket_id = 'charts' and public.can_download(name));

-- ---------- permissões da Data API (exigidas pelo Supabase desde 30/10/2026) ----------
-- Tabelas novas no "public" não ganham mais acesso automático pela API. Estas linhas dão o
-- acesso explícito (quem pode ver/mexer em CADA linha continua sendo decidido pelas policies
-- acima — RLS ligado). O jogo só usa contas logadas, então o "anon" não recebe nada.
grant select, insert, update, delete on public.profiles, public.friends, public.charts, public.chart_shares to authenticated;
grant select, insert, update, delete on public.profiles, public.friends, public.charts, public.chart_shares to service_role;
