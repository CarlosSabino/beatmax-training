-- =====================================================================================
-- BEATMAX Training — PROGRESSO NA NUVEM (rodar UMA vez no SQL Editor do Supabase)
--
-- Uma linha por conta com o progresso do jogador (nível/EXP, Beatcoins, itens, Personalizar,
-- configurações e recordes). O jogo junta o que tem no aparelho com o que está aqui.
-- Só o dono lê/apaga a própria linha; gravar é pela função progresso_salvar (com controle
-- de versão pra dois aparelhos não se atropelarem).
-- Pode rodar de novo sem problema (não apaga nada).
-- =====================================================================================

create table if not exists public.progresso (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  rev        integer not null default 1,
  app_ver    text,
  updated_at timestamptz not null default now(),
  constraint progresso_tamanho check (octet_length(data::text) <= 700000)
);

alter table public.progresso enable row level security;

drop policy if exists "progresso: dono lê" on public.progresso;
create policy "progresso: dono lê" on public.progresso
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "progresso: dono apaga" on public.progresso;
create policy "progresso: dono apaga" on public.progresso
  for delete to authenticated using (auth.uid() = user_id);

-- grava se a versão (rev) que o aparelho leu ainda é a atual; senão devolve conflito
-- e o jogo relê, junta e tenta de novo.
create or replace function public.progresso_salvar(p_data jsonb, p_rev integer, p_ver text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  atual integer;
  existe boolean;
  novo integer;
begin
  if me is null then raise exception 'precisa estar logado'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'progresso inválido'; end if;
  if octet_length(p_data::text) > 700000 then raise exception 'progresso grande demais'; end if;

  select rev into atual from progresso where user_id = me for update;
  existe := atual is not null;

  if existe and coalesce(p_rev, -1) <> atual then
    return json_build_object('ok', false, 'conflito', true, 'rev', atual);
  end if;

  if existe then
    update progresso set data = p_data, rev = atual + 1, app_ver = left(p_ver, 20), updated_at = now()
      where user_id = me;
    novo := atual + 1;
  else
    insert into progresso (user_id, data, rev, app_ver) values (me, p_data, 1, left(p_ver, 20));
    novo := 1;
  end if;
  return json_build_object('ok', true, 'rev', novo);
end;
$$;

revoke all on function public.progresso_salvar(jsonb, integer, text) from public, anon;
grant execute on function public.progresso_salvar(jsonb, integer, text) to authenticated;
grant select, delete on public.progresso to authenticated;
grant all on public.progresso to service_role;
