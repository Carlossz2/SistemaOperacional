-- =====================================================================
-- Gestor DR — acesso exclusivo do administrador
--
--  * A PRIMEIRA conta criada vira a conta de administrador. Qualquer cadastro depois disso é
--    recusado pelo próprio banco (mesmo que alguém ache a tela de cadastro ou chame a API).
--  * Somente o administrador acessa os dados (política restritiva em todas as tabelas).
--  * Se a verificação em duas etapas (app autenticador) estiver ativa, o banco só libera os
--    dados para sessões que passaram pelo código (nível aal2).
-- =====================================================================

create table private.admin (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Quem já existir ao aplicar esta migração (a conta mais antiga) é o administrador
insert into private.admin (user_id)
select id from auth.users order by created_at nulls last, id limit 1
on conflict do nothing;

create or replace function private.block_extra_signups() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- serializa cadastros simultâneos: só um pode virar administrador
  perform pg_advisory_xact_lock(hashtext('gestor-dr-admin'));
  if exists (select 1 from private.admin) then
    raise exception 'Cadastro desativado: este sistema já possui um administrador.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function private.register_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.admin (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger gestor_block_extra_signups before insert on auth.users
for each row execute function private.block_extra_signups();

create trigger gestor_register_admin after insert on auth.users
for each row execute function private.register_admin();

-- O sistema já foi configurado? (usado pela tela de login para esconder o cadastro)
create or replace function public.gestor_has_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admin)
$$;

-- A sessão atual pode acessar os dados? (é o administrador e, se tiver 2FA, passou pelo código)
create or replace function public.gestor_access_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admin a where a.user_id = auth.uid())
     and (
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       or not exists (
         select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'
       )
     )
$$;

revoke all on function public.gestor_has_admin() from public;
revoke all on function public.gestor_access_ok() from public;
grant execute on function public.gestor_has_admin() to anon, authenticated;
grant execute on function public.gestor_access_ok() to authenticated, service_role;

-- Política RESTRITIVA: soma-se (E lógico) às políticas de dono já existentes
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'products', 'sales', 'ads', 'expenses', 'capital', 'integrations',
    'product_aliases', 'webhook_events', 'transactions', 'fx_rates'
  ] loop
    execute format(
      'create policy admin_only on public.%I as restrictive for all to authenticated
         using ((select public.gestor_access_ok())) with check ((select public.gestor_access_ok()))',
      t
    );
  end loop;
end $$;

-- Funções chamadas pelo app também exigem acesso de administrador
create or replace function public.set_integration_secret(
  p_integration_id uuid, p_secret text default null, p_access_token text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.gestor_access_ok() then
    raise exception 'Acesso negado';
  end if;
  if not exists (select 1 from public.integrations where id = p_integration_id and user_id = auth.uid()) then
    raise exception 'Integração não encontrada';
  end if;
  insert into public.integration_secrets (integration_id, user_id, secret, access_token)
  values (p_integration_id, auth.uid(), nullif(p_secret, ''), nullif(p_access_token, ''))
  on conflict (integration_id) do update set
    secret = case when p_secret is null then integration_secrets.secret else nullif(p_secret, '') end,
    access_token = case when p_access_token is null then integration_secrets.access_token else nullif(p_access_token, '') end,
    updated_at = now();
end $$;

create or replace function public.integration_secret_status()
returns table (integration_id uuid, has_secret boolean, has_access_token boolean)
language sql security definer set search_path = public, pg_temp as $$
  select s.integration_id, s.secret is not null, s.access_token is not null
    from public.integration_secrets s
    join public.integrations i on i.id = s.integration_id
   where i.user_id = auth.uid() and public.gestor_access_ok()
$$;

create or replace function public.rotate_integration_token(p_integration_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.gestor_access_ok() then
    raise exception 'Acesso negado';
  end if;
  update public.integrations set token = v where id = p_integration_id and user_id = auth.uid();
  if not found then raise exception 'Integração não encontrada'; end if;
  return v;
end $$;
