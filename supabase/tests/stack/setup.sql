-- Extras só para o ambiente local de testes (login simplificado e usuário do PostgREST)
create schema if not exists test_auth;
create table if not exists test_auth.passwords (user_id uuid primary key references auth.users (id) on delete cascade, password text not null);
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'authenticator' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
