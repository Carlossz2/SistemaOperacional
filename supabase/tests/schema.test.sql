-- Testes do esquema: isolamento entre usuários (RLS), permissões e consolidação de vendas.
-- Cada bloco falha com exceção se algo não estiver como esperado.

create schema if not exists test;
create or replace function test.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create or replace function test.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
grant usage on schema test to authenticated, service_role, anon;
grant execute on all functions in schema test to authenticated, service_role, anon;

-- o primeiro usuário vira administrador; o segundo é criado "por fora" (gatilho desligado)
-- só para provar que, mesmo existindo, ele não enxerga nada
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'dono@teste.com');
alter table auth.users disable trigger gestor_block_extra_signups;
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'outro@teste.com');
alter table auth.users enable trigger gestor_block_extra_signups;

-- ---------------------------------------------------------------- dono cria dados manuais
begin;
select test.login('11111111-1111-1111-1111-111111111111');
insert into public.products (id, name) values ('p1', 'Oferta A'), ('p2', 'Oferta B');
insert into public.sales (date, product_id, platform, country, quantity, gross, fees) values ('2026-10-01', 'p1', 'Manual', 'BR', 1, 100, 10);
insert into public.sales (date, product_id, platform, quantity, gross, campaign) values ('2026-10-01', 'p1', 'Manual', 1, 50, 'KETO 01');
insert into public.ads (date, product_id, source, amount) values ('2026-10-01', 'p1', 'Meta Ads', 50);
insert into public.expenses (date, category, description, amount, recurrence) values ('2026-10-01', 'Ferramentas', 'X', 30, 'monthly');
insert into public.capital (date, kind, description, amount) values ('2026-10-01', 'aporte', 'Inicial', 1000);
insert into public.settings (data) values ('{"businessName":"Teste"}');
insert into public.integrations (id, platform, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'hotmart', 'Hotmart');
commit;

-- ---------------------------------------------------------------- isolamento entre usuários
begin;
select test.login('22222222-2222-2222-2222-222222222222');
do $$
begin
  assert (select count(*) from public.products) = 0, 'outro usuário não deve ver produtos';
  assert (select count(*) from public.sales) = 0, 'outro usuário não deve ver vendas';
  assert (select count(*) from public.integrations) = 0, 'outro usuário não deve ver integrações';
  -- não pode lançar venda usando o produto de outra pessoa
  begin
    insert into public.sales (date, product_id, gross) values ('2026-10-01', 'p1', 1);
    raise exception 'FALHA: aceitou venda com produto de outro usuário';
  exception when foreign_key_violation or insufficient_privilege then null;
  end;
  -- não pode alterar dados de outra pessoa
  update public.products set name = 'hack' where id = 'p1';
  assert not found, 'não deve alterar produto alheio';
end $$;
commit;

-- ---------------------------------------------------------------- regras do dono
begin;
select test.login('11111111-1111-1111-1111-111111111111');
do $$
declare v_token text; v_new text;
begin
  assert (select count(*) from public.products) = 2, 'dono vê os próprios produtos';
  assert (select campaign from public.sales where gross = 50) = 'KETO 01', 'venda manual guarda a campanha';
  update public.sales set campaign = null where gross = 50;
  assert found, 'dono edita a campanha da venda manual';
  -- não pode criar venda "automática" pelo app
  begin
    insert into public.sales (date, product_id, gross, origin, auto_key) values ('2026-10-01', 'p1', 1, 'auto', 'x');
    raise exception 'FALHA: app criou venda automática';
  exception when insufficient_privilege then null;
  end;
  -- não pode criar gasto marcado como Meta
  begin
    insert into public.ads (date, product_id, amount, origin) values ('2026-10-01', 'p1', 1, 'meta');
    raise exception 'FALHA: app criou gasto da Meta';
  exception when insufficient_privilege then null;
  end;
  -- não escolhe o token da URL
  begin
    insert into public.integrations (platform, name, token) values ('cakto', 'X', 'token-fraco');
    raise exception 'FALHA: app definiu token';
  exception when insufficient_privilege then null;
  end;
  -- não lê segredos
  begin
    perform * from public.integration_secrets;
    raise exception 'FALHA: app leu segredos';
  exception when insufficient_privilege then null;
  end;
  -- grava segredo e consulta só o status
  perform public.set_integration_secret('aaaaaaaa-0000-0000-0000-000000000001', 'hottok-123', null);
  assert (select has_secret from public.integration_secret_status() where integration_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'segredo salvo';
  -- rotacionar token
  select token into v_token from public.integrations where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  v_new := public.rotate_integration_token('aaaaaaaa-0000-0000-0000-000000000001');
  assert v_new <> v_token and length(v_new) = 48, 'token rotacionado';
  -- não executa funções internas
  begin
    perform public.ingest_transaction('{}'::jsonb);
    raise exception 'FALHA: app chamou ingest_transaction';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- ---------------------------------------------------------------- anônimo não vê nada
begin;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.products;
    raise exception 'FALHA: anônimo leu produtos';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- ---------------------------------------------------------------- ingestão de transações (Edge Function)
begin;
select test.as_service();
do $$
declare
  u uuid := '11111111-1111-1111-1111-111111111111';
  prod text;
  prod2 text;
  s record;
  base jsonb;
begin
  prod := public.resolve_product(u, 'hotmart', '999', 'Curso Hotmart');
  prod2 := public.resolve_product(u, 'hotmart', '999', 'Curso Hotmart');
  assert prod = prod2, 'mesmo produto externo => mesmo produto';
  assert (select count(*) from public.products where user_id = u and name = 'Curso Hotmart') = 1, 'produto criado uma vez';
  -- produto com nome igual a um existente é reaproveitado
  assert public.resolve_product(u, 'cakto', 'abc', 'Oferta A') = 'p1', 'reaproveita produto pelo nome';

  base := jsonb_build_object('user_id', u, 'platform', 'hotmart', 'platform_label', 'Hotmart', 'product_id', prod,
    'product_external_id', '999', 'sale_date', '2026-10-05', 'country', 'BR', 'currency', 'BRL', 'rate', 1, 'quantity', 1);

  perform public.ingest_transaction(base || '{"external_id":"HP1","status":"approved","gross":100,"fees":10,"net":90}');
  perform public.ingest_transaction(base || '{"external_id":"HP2","status":"approved","gross":200,"fees":20,"net":180}');
  perform public.ingest_transaction(base || '{"external_id":"HP3","status":"pending","gross":50,"fees":0}');
  select * into s from public.sales where user_id = u and origin = 'auto';
  assert s.quantity = 2 and s.gross = 300 and s.fees = 30 and s.refunds = 0, format('consolidação aprovadas: %s', row_to_json(s));

  -- reenvio do mesmo evento não duplica
  perform public.ingest_transaction(base || '{"external_id":"HP1","status":"approved","gross":100,"fees":10,"net":90}');
  select * into s from public.sales where user_id = u and origin = 'auto';
  assert s.quantity = 2, 'evento repetido não duplica';

  -- reembolso de HP1 (evento sem valores) mantém valores da aprovação
  perform public.ingest_transaction(base || '{"external_id":"HP1","status":"refunded","gross":0,"fees":0}');
  select * into s from public.sales where user_id = u and origin = 'auto';
  assert s.gross = 300 and s.refunds = 90, format('reembolso: %s', row_to_json(s));

  -- "aprovada" atrasada depois do reembolso não desfaz o reembolso
  perform public.ingest_transaction(base || '{"external_id":"HP1","status":"approved","gross":100,"fees":10}');
  assert (select status from public.transactions where external_id = 'HP1') = 'refunded', 'não volta para aprovada';

  -- pendente que vira aprovada entra na soma
  perform public.ingest_transaction(base || '{"external_id":"HP3","status":"approved","gross":50,"fees":5}');
  select * into s from public.sales where user_id = u and origin = 'auto';
  assert s.quantity = 3 and s.gross = 350 and s.fees = 35, format('pendente aprovada: %s', row_to_json(s));

  -- venda em dólar vira outro balde, com cotação ponderada
  perform public.ingest_transaction(base || '{"external_id":"HP4","status":"approved","gross":10,"fees":1,"currency":"USD","rate":5,"country":"US"}');
  perform public.ingest_transaction(base || '{"external_id":"HP5","status":"approved","gross":30,"fees":3,"currency":"USD","rate":6,"country":"US"}');
  select * into s from public.sales where user_id = u and origin = 'auto' and currency = 'USD';
  assert s.gross = 40 and s.rate = 5.75, format('USD ponderado: %s', row_to_json(s));
end $$;
commit;

-- ---------------------------------------------------------------- app não altera vendas automáticas
begin;
select test.login('11111111-1111-1111-1111-111111111111');
do $$
begin
  assert (select count(*) from public.sales where origin = 'auto') = 2, 'dono vê vendas automáticas';
  update public.sales set gross = 1 where origin = 'auto';
  assert not found, 'venda automática é somente leitura';
  delete from public.sales where origin = 'auto';
  assert not found, 'venda automática não pode ser apagada pelo app';
  assert (select count(*) from public.transactions) = 5, 'dono vê transações';
  assert (select count(*) from public.product_aliases) = 2, 'dono vê vínculos';
end $$;
commit;

-- ---------------------------------------------------------------- trocar o produto do vínculo move as vendas
begin;
select test.login('11111111-1111-1111-1111-111111111111');
update public.product_aliases set product_id = 'p2' where platform = 'hotmart' and external_id = '999';
do $$
begin
  assert (select count(*) from public.sales where origin = 'auto' and product_id = 'p2') = 2, 'vendas movidas para p2';
  assert (select count(*) from public.sales where origin = 'auto' and product_id <> 'p2') = 0, 'baldes antigos removidos';
  assert (select sum(gross) from public.sales where origin = 'auto' and currency = 'BRL') = 350, 'totais preservados';
end $$;
commit;

-- ---------------------------------------------------------------- configuração interna (cron)
begin;
select test.as_service();
do $$
declare a text; b text;
begin
  a := public.gestor_internal_setup('https://x.supabase.co/functions/v1');
  b := public.gestor_internal_setup('https://x.supabase.co/functions/v1');
  assert a = b and length(a) = 64, 'segredo interno estável';
end $$;
commit;

-- ---------------------------------------------------------------- apagar usuário remove tudo dele
begin;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
do $$
begin
  assert (select count(*) from public.products) = 0 and (select count(*) from public.sales) = 0
     and (select count(*) from public.transactions) = 0 and (select count(*) from public.webhook_events) = 0,
     'exclusão em cascata';
end $$;
rollback;

-- ---------------------------------------------------------------- status das despesas
begin;
select test.login('11111111-1111-1111-1111-111111111111');
do $$
begin
  assert (select status from public.expenses where description = 'X') = 'active', 'despesa nova é ativa';
  update public.expenses set status = 'paused', paused_from = '2026-11' where description = 'X';
  update public.expenses set status = 'active', paused_from = null, pauses = '[{"from":"2026-11","to":"2026-12"}]' where description = 'X';
  begin
    update public.expenses set status = 'pausada' where description = 'X';
    raise exception 'FALHA: status inválido aceito';
  exception when check_violation then null;
  end;
  begin
    update public.expenses set status = 'paused', paused_from = null where description = 'X';
    raise exception 'FALHA: pausada sem mês de início';
  exception when check_violation then null;
  end;
end $$;
rollback;

\echo 'schema.test.sql: OK'
