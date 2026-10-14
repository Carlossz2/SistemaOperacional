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

-- documentos: admin (aal2) grava na própria pasta; não grava na pasta de outro; outros não veem nada
begin;
select test.login_aal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aal2');
insert into storage.objects (bucket_id, name) values ('documents', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/nota.pdf');
insert into public.documents (name, category, path, size, mime) values ('Nota fiscal setembro', 'Nota fiscal', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/nota.pdf', 1234, 'application/pdf');
do $$
begin
  assert (select count(*) from public.documents) = 1, 'admin vê o documento';
  assert (select count(*) from storage.objects where bucket_id = 'documents') = 1, 'admin vê o arquivo';
  begin
    insert into storage.objects (bucket_id, name) values ('documents', 'cccccccc-cccc-cccc-cccc-cccccccccccc/x.pdf');
    raise exception 'FALHA: gravou arquivo na pasta de outro usuário';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.documents (name, path) values ('x', 'cccccccc-cccc-cccc-cccc-cccccccccccc/x.pdf');
    raise exception 'FALHA: documento apontando para pasta de outro usuário';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
-- proteção: documento nunca é apagado pelo app (só vai para a lixeira) e o arquivo cadastrado não some
begin;
select test.login_aal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aal2');
do $$
begin
  update public.documents set name = 'NF setembro', deleted_at = now() where path = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/nota.pdf';
  assert (select count(*) from public.documents where deleted_at is not null) = 1, 'vai para a lixeira';
  update public.documents set deleted_at = null;
  assert (select count(*) from public.documents where deleted_at is null) = 1, 'restaura da lixeira';
  begin
    delete from public.documents;
    raise exception 'FALHA: apagou documento';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.documents set path = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/outro.pdf';
    raise exception 'FALHA: trocou o arquivo do documento';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/nota.pdf';
  update storage.objects set name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/x.pdf' where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/nota.pdf';
  assert (select count(*) from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/nota.pdf') = 1, 'arquivo cadastrado não pode ser apagado nem alterado';
  -- arquivo sem documento (envio que falhou no meio) pode ser limpo
  insert into storage.objects (bucket_id, name) values ('documents', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/orfao.pdf');
  delete from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/orfao.pdf';
  assert (select count(*) from storage.objects where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/orfao.pdf') = 0, 'órfão limpo';
end $$;
commit;
-- admin com 2FA ativo mas sessão sem código: não vê documentos nem arquivos
begin;
select test.login_aal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aal1');
do $$
begin
  assert (select count(*) from public.documents) = 0, 'aal1 não vê documentos';
  assert (select count(*) from storage.objects) = 0, 'aal1 não vê arquivos';
end $$;
commit;
-- outro usuário: nada
begin;
select test.login_aal('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aal2');
do $$
begin
  assert (select count(*) from public.documents) = 0;
  assert (select count(*) from storage.objects) = 0;
  begin
    insert into storage.objects (bucket_id, name) values ('documents', 'cccccccc-cccc-cccc-cccc-cccccccccccc/y.pdf');
    raise exception 'FALHA: não-admin gravou arquivo';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
-- anônimo: nada
begin;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.documents;
    raise exception 'FALHA: anônimo leu documentos';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
do $$ begin assert (select public from storage.buckets where id = 'documents') = false, 'bucket privado'; end $$;
-- apagar a conta não leva os documentos junto
do $$
begin
  begin
    delete from auth.users where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    raise exception 'FALHA: apagar a conta apagou os documentos';
  exception when foreign_key_violation then null;
  end;
  assert (select count(*) from public.documents) = 1;
end $$;

\echo 'security.test.sql: OK'
