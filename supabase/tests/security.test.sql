-- Testes de acesso exclusivo do administrador e verificação em duas etapas (2FA).
\set ON_ERROR_STOP on
create schema if not exists test;
create or replace function test.login_aal(uid uuid, aal text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
end $$;
grant execute on function test.login_aal(uuid, text) to authenticated;

-- banco limpo de administrador para este teste
delete from auth.users;
do $$ begin assert not public.gestor_has_admin(), 'sem administrador'; end $$;

insert into auth.users (id, email) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin@teste.com');
do $$ begin assert public.gestor_has_admin(), 'primeiro usuário vira admin'; end $$;

-- segundo cadastro é recusado pelo banco
do $$
begin
  begin
    insert into auth.users (id, email) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'invasor@teste.com');
    raise exception 'FALHA: aceitou segundo cadastro';
  exception when raise_exception then
    if sqlerrm not like 'Cadastro desativado%' then raise; end if;
  end;
end $$;

-- anônimo pode perguntar se há admin (tela de login), mas não lê dados
begin;
set local role anon;
do $$ begin assert public.gestor_has_admin(); end $$;
commit;

-- admin sem 2FA: acesso liberado
begin;
select test.login_aal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aal1');
insert into public.products (id, name) values ('sec-p1', 'Produto');
do $$ begin assert public.gestor_access_ok() and (select count(*) from public.products) = 1; end $$;
commit;

-- admin ativa 2FA: sessão sem código (aal1) perde acesso; com código (aal2) acessa
insert into auth.mfa_factors (user_id, status) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'verified');
begin;
select test.login_aal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aal1');
do $$
begin
  assert not public.gestor_access_ok(), 'aal1 bloqueado com 2FA ativo';
  assert (select count(*) from public.products) = 0, 'aal1 não lê dados';
  begin
    insert into public.products (name) values ('x');
    raise exception 'FALHA: aal1 gravou';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_integration_secret(gen_random_uuid(), 'x', null);
    raise exception 'FALHA: aal1 chamou função';
  exception when raise_exception then
    if sqlerrm <> 'Acesso negado' then raise; end if;
  end;
end $$;
commit;
begin;
select test.login_aal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aal2');
do $$ begin assert public.gestor_access_ok() and (select count(*) from public.products) = 1, 'aal2 acessa'; end $$;
commit;

-- um usuário que não é o admin (criado por fora) não vê nada, mesmo com aal2
alter table auth.users disable trigger gestor_block_extra_signups;
insert into auth.users (id, email) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'outro@teste.com');
alter table auth.users enable trigger gestor_block_extra_signups;
begin;
select test.login_aal('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aal2');
do $$
begin
  assert not public.gestor_access_ok();
  assert (select count(*) from public.products) = 0;
  assert (select count(*) from public.fx_rates) = 0;
end $$;
commit;

\echo 'security.test.sql: OK'
