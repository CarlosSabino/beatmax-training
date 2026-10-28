-- =====================================================================================
-- BEATMAX Training — RANKING (Supabase)
-- Rode DEPOIS do supabase-setup.sql, uma vez: Supabase → SQL Editor → New query → colar → Run.
-- Pode rodar de novo sem medo.
--
--   ranking   o MELHOR resultado de cada jogador em cada chart (um por jogador por chart)
--
-- chart_key: "d:<treino>|<modo>|<dificuldade>|<julgamento>" ou "o:<beatmapId osu>|<modo>|<julgamento>"
-- Ninguém grava direto na tabela: o jogo chama a função ranking_enviar(), que confere os
-- números (pontuação x precisão x notas), limita a frequência e só guarda se for recorde.
-- =====================================================================================

create table if not exists public.ranking (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  chart_key   text not null check (char_length(chart_key) between 5 and 160),
  title       text not null check (char_length(title) between 1 and 160),
  mode        text not null check (mode in ('4K','5K','6K','8K')),
  judge       text not null default 'normal' check (judge in ('normal','hard','max')),
  score       int  not null check (score between 0 and 1000000),
  acc         numeric(6,2) not null check (acc between 0 and 100),
  max_combo   int  not null check (max_combo >= 0),
  notes       int  not null check (notes between 30 and 20000),
  m100        int  not null default 0,
  brk         int  not null default 0,
  mods        text not null default '',
  app_ver     text,
  plays       int  not null default 1,
  at          timestamptz not null default now(),
  primary key (user_id, chart_key)
);
create index if not exists ranking_board_idx on public.ranking(chart_key, score desc, at asc);
create index if not exists ranking_user_idx on public.ranking(user_id, at desc);

alter table public.ranking enable row level security;
drop policy if exists "ranking é público pra quem joga" on public.ranking;
create policy "ranking é público pra quem joga" on public.ranking for select to authenticated using (true);
-- sem policy de insert/update/delete: só a função abaixo grava

-- ---------- enviar um resultado ----------
create or replace function public.ranking_enviar(
  p_key text, p_title text, p_mode text, p_judge text,
  p_score int, p_acc numeric, p_combo int, p_notes int, p_m100 int, p_brk int,
  p_mods text default '', p_ver text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  old public.ranking%rowtype;
  last_at timestamptz;
  pos int;
  total int;
  existed boolean;
begin
  if me is null then raise exception 'precisa estar logado'; end if;
  if p_key !~ '^(d|o):' then raise exception 'chart inválido'; end if;
  -- conferências de sanidade (o resultado tem que fazer sentido)
  if p_score < 0 or p_score > 1000000 or p_acc < 0 or p_acc > 100 then raise exception 'resultado inválido'; end if;
  if p_notes < 30 or p_combo > p_notes or p_m100 > p_notes or p_brk > p_notes or p_m100 + p_brk > p_notes then raise exception 'resultado inválido'; end if;
  if abs(p_score - p_acc * 10000) > 150 then raise exception 'resultado inválido'; end if;
  if p_acc = 100 and (p_brk > 0 or p_m100 < p_notes) then raise exception 'resultado inválido'; end if;
  -- no máximo um envio a cada 20 segundos (nenhuma música do ranking tem menos de 30 s)
  select max(at) into last_at from ranking where user_id = me;
  if last_at is not null and now() - last_at < interval '20 seconds' then
    select * into old from ranking where user_id = me and chart_key = p_key;
    if not found or p_score > old.score then raise exception 'envios rápidos demais'; end if;
  end if;

  select * into old from ranking where user_id = me and chart_key = p_key;
  existed := found;
  if not existed then
    insert into ranking (user_id, chart_key, title, mode, judge, score, acc, max_combo, notes, m100, brk, mods, app_ver)
    values (me, p_key, left(p_title, 160), p_mode, p_judge, p_score, round(p_acc, 2), p_combo, p_notes, p_m100, p_brk, left(coalesce(p_mods, ''), 80), left(p_ver, 20));
  elsif p_score > old.score then
    update ranking set title = left(p_title, 160), score = p_score, acc = round(p_acc, 2), max_combo = p_combo, notes = p_notes,
           m100 = p_m100, brk = p_brk, mods = left(coalesce(p_mods, ''), 80), app_ver = left(p_ver, 20), plays = old.plays + 1, at = now()
     where user_id = me and chart_key = p_key;
  else
    update ranking set plays = old.plays + 1 where user_id = me and chart_key = p_key;
  end if;

  select count(*) + 1 into pos from ranking r, ranking mine
   where mine.user_id = me and mine.chart_key = p_key and r.chart_key = p_key
     and (r.score > mine.score or (r.score = mine.score and r.at < mine.at));
  select count(*) into total from ranking where chart_key = p_key;
  return json_build_object('recorde', (not existed) or p_score > old.score, 'antes', case when existed then old.score end, 'posicao', pos, 'total', total);
end $$;

revoke all on function public.ranking_enviar(text,text,text,text,int,numeric,int,int,int,int,text,text) from public, anon;
grant execute on function public.ranking_enviar(text,text,text,text,int,numeric,int,int,int,int,text,text) to authenticated;

-- ---------- permissões da Data API ----------
grant select on public.ranking to authenticated;
grant select, insert, update, delete on public.ranking to service_role;
