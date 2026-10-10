-- =====================================================================
-- Gestor DR — esquema do banco (Supabase / Postgres 15+)
--
-- Princípios:
--  * Cada usuário só enxerga os próprios dados (RLS em todas as tabelas).
--  * Todo webhook é gravado bruto ANTES de ser processado (webhook_events) e nunca é apagado.
--  * Vendas de plataformas viram transações individuais (transactions); um gatilho consolida
--    essas transações em linhas diárias de "sales" (origin = 'auto'), que é o que o painel lê.
--  * Linhas automáticas (vendas por webhook, gastos da Meta) são somente leitura para o app.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Configurações (uma linha por usuário)
-- ---------------------------------------------------------------------
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Produtos / ofertas
-- ---------------------------------------------------------------------
create table public.products (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  market text not null default '',
  kind text not null default 'front' check (kind in ('front', 'upsell', 'downsell', 'orderbump', 'recorrente', 'outro')),
  active boolean not null default true,
  target_cpa numeric(14, 2) check (target_cpa is null or target_cpa >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- permite FKs compostas que garantem que o produto é do mesmo usuário
  unique (id, user_id)
);

-- ---------------------------------------------------------------------
-- Receitas (manuais ou consolidadas automaticamente a partir de transactions)
-- ---------------------------------------------------------------------
create table public.sales (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  product_id text not null,
  platform text not null default '',
  country text not null default '',
  currency text not null default 'BRL',
  rate numeric(18, 8) not null default 1 check (rate > 0),
  quantity numeric(14, 2) not null default 0 check (quantity >= 0),
  gross numeric(14, 2) not null default 0 check (gross >= 0),
  fees numeric(14, 2) not null default 0 check (fees >= 0),
  refunds numeric(14, 2) not null default 0 check (refunds >= 0),
  notes text,
  origin text not null default 'manual' check (origin in ('manual', 'auto')),
  auto_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, user_id) references public.products (id, user_id),
  unique (user_id, auto_key)
);
create index sales_user_date on public.sales (user_id, date);

-- ---------------------------------------------------------------------
-- Tráfego pago (manual ou sincronizado da Meta)
-- ---------------------------------------------------------------------
create table public.ads (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  product_id text,
  source text not null default '',
  campaign text,
  country text not null default '',
  currency text not null default 'BRL',
  rate numeric(18, 8) not null default 1 check (rate > 0),
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  notes text,
  origin text not null default 'manual' check (origin in ('manual', 'meta')),
  external_id text,
  metrics jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, user_id) references public.products (id, user_id),
  unique (user_id, external_id)
);
create index ads_user_date on public.ads (user_id, date);

-- ---------------------------------------------------------------------
-- Despesas e capital
-- ---------------------------------------------------------------------
create table public.expenses (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  category text not null default 'Outros',
  description text not null default '',
  currency text not null default 'BRL',
  rate numeric(18, 8) not null default 1 check (rate > 0),
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  product_id text,
  recurrence text not null default 'none' check (recurrence in ('none', 'monthly')),
  end_month text check (end_month is null or end_month ~ '^\d{4}-\d{2}$'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, user_id) references public.products (id, user_id)
);
create index expenses_user_date on public.expenses (user_id, date);

create table public.capital (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('aporte', 'retirada', 'investimento')),
  description text not null default '',
  currency text not null default 'BRL',
  rate numeric(18, 8) not null default 1 check (rate > 0),
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index capital_user_date on public.capital (user_id, date);

-- ---------------------------------------------------------------------
-- Integrações (webhooks de plataformas e Meta Ads)
-- ---------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform text not null check (platform in ('hotmart', 'cakto', 'lastlink', 'ggcheckout', 'perfectpay', 'generic', 'meta')),
  name text not null check (length(btrim(name)) > 0),
  -- token secreto que compõe a URL do webhook (não pode ser alterado pelo app, só rotacionado)
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  enabled boolean not null default true,
  default_product_id text,
  config jsonb not null default '{}'::jsonb,
  last_event_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (default_product_id, user_id) references public.products (id, user_id) on delete set null (default_product_id)
);

-- Segredos (hottok, token da plataforma, token de acesso da Meta). O app grava, mas nunca lê de volta.
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  secret text,
  access_token text,
  updated_at timestamptz not null default now()
);

-- Produto da plataforma (id externo) -> produto do Gestor
create table public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  external_id text not null,
  external_name text,
  product_id text not null,
  created_at timestamptz not null default now(),
  foreign key (product_id, user_id) references public.products (id, user_id) on delete cascade,
  unique (user_id, platform, external_id)
);

-- ---------------------------------------------------------------------
-- Eventos brutos de webhook (log permanente)
-- ---------------------------------------------------------------------
create table public.webhook_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete set null,
  platform text not null,
  received_at timestamptz not null default now(),
  event_name text,
  external_id text,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'error', 'unauthorized')),
  message text,
  headers jsonb,
  payload jsonb,
  raw_body text,
  processed_at timestamptz,
  attempts integer not null default 0
);
create index webhook_events_user_received on public.webhook_events (user_id, received_at desc);
create index webhook_events_integration on public.webhook_events (integration_id, received_at desc);
create index webhook_events_external on public.webhook_events (user_id, platform, external_id);

-- ---------------------------------------------------------------------
-- Transações individuais vindas das plataformas
-- ---------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete set null,
  platform text not null,          -- chave da origem (hotmart, cakto, generic:<id>…)
  platform_label text not null,    -- nome exibido nos relatórios (Hotmart, Cakto…)
  external_id text not null,
  status text not null check (status in ('approved', 'refunded', 'chargeback', 'pending', 'canceled')),
  raw_status text,
  product_id text,
  product_external_id text,
  product_name text,
  sale_date date,
  country text not null default 'BR',
  currency text not null default 'BRL',
  rate numeric(18, 8) not null default 1 check (rate > 0),
  quantity numeric(14, 2) not null default 1 check (quantity >= 0),
  gross numeric(14, 2) not null default 0 check (gross >= 0),
  fees numeric(14, 2) not null default 0 check (fees >= 0),
  net numeric(14, 2),
  fees_estimated boolean not null default false,
  buyer_email text,
  buyer_name text,
  payment_method text,
  approved_at timestamptz,
  refunded_at timestamptz,
  status_at timestamptz,
  last_event_id bigint references public.webhook_events (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, user_id) references public.products (id, user_id),
  unique (user_id, platform, external_id)
);
create index transactions_user_date on public.transactions (user_id, sale_date desc);
create index transactions_bucket on public.transactions (user_id, sale_date, product_id, platform_label, country, currency);
create index transactions_product_ext on public.transactions (user_id, platform, product_external_id);

-- ---------------------------------------------------------------------
-- Câmbio diário (global): quantos BRL vale 1 unidade da moeda
-- ---------------------------------------------------------------------
create table public.fx_rates (
  day date not null,
  currency text not null,
  rate numeric(18, 8) not null check (rate > 0),
  source text not null default 'open.er-api.com',
  primary key (day, currency)
);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create trigger settings_updated before update on public.settings for each row execute function private.set_updated_at();
create trigger products_updated before update on public.products for each row execute function private.set_updated_at();
create trigger sales_updated before update on public.sales for each row execute function private.set_updated_at();
create trigger ads_updated before update on public.ads for each row execute function private.set_updated_at();
create trigger expenses_updated before update on public.expenses for each row execute function private.set_updated_at();
create trigger capital_updated before update on public.capital for each row execute function private.set_updated_at();
create trigger integrations_updated before update on public.integrations for each row execute function private.set_updated_at();
create trigger transactions_updated before update on public.transactions for each row execute function private.set_updated_at();

-- =====================================================================
-- Consolidação: transactions -> sales (origin = 'auto')
-- =====================================================================
create or replace function private.refresh_sale_bucket(
  p_user uuid, p_date date, p_product text, p_platform text, p_country text, p_currency text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  r record;
begin
  if p_user is null or p_date is null or p_product is null then
    return;
  end if;
  k := concat_ws('|', p_date, p_product, p_platform, p_country, p_currency);
  -- serializa o recálculo do mesmo balde (webhooks simultâneos)
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || '|' || k, 0));

  select
    count(*) as n,
    coalesce(sum(t.quantity), 0) as qty,
    coalesce(sum(t.gross), 0) as gross,
    coalesce(sum(t.fees), 0) as fees,
    -- venda devolvida: o produtor perde o que receberia (bruto − taxas)
    coalesce(sum(case when t.status in ('refunded', 'chargeback') then greatest(t.gross - t.fees, 0) else 0 end), 0) as refunds,
    sum(t.gross * t.rate) / nullif(sum(t.gross), 0) as wrate,
    max(t.rate) as anyrate
  into r
  from public.transactions t
  where t.user_id = p_user
    and t.sale_date = p_date
    and t.product_id = p_product
    and t.platform_label = p_platform
    and t.country = p_country
    and t.currency = p_currency
    and t.status in ('approved', 'refunded', 'chargeback');

  if r.n = 0 then
    delete from public.sales where user_id = p_user and auto_key = k;
    return;
  end if;

  insert into public.sales (user_id, date, product_id, platform, country, currency, rate, quantity, gross, fees, refunds, origin, auto_key)
  values (p_user, p_date, p_product, p_platform, p_country, p_currency, coalesce(r.wrate, r.anyrate, 1), r.qty, r.gross, r.fees, least(r.refunds, r.gross), 'auto', k)
  on conflict (user_id, auto_key) do update set
    rate = excluded.rate,
    quantity = excluded.quantity,
    gross = excluded.gross,
    fees = excluded.fees,
    refunds = excluded.refunds;
end $$;

create or replace function private.transactions_refresh() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.refresh_sale_bucket(old.user_id, old.sale_date, old.product_id, old.platform_label, old.country, old.currency);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.refresh_sale_bucket(new.user_id, new.sale_date, new.product_id, new.platform_label, new.country, new.currency);
  end if;
  return null;
end $$;

create trigger transactions_refresh_sales
after insert or update or delete on public.transactions
for each row execute function private.transactions_refresh();

-- Trocar o produto de um alias move todas as transações daquele produto externo
create or replace function private.aliases_remap() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.product_id is distinct from old.product_id then
    update public.transactions
       set product_id = new.product_id
     where user_id = new.user_id
       and platform = new.platform
       and product_external_id = new.external_id;
  end if;
  return new;
end $$;

create trigger product_aliases_remap
after update of product_id on public.product_aliases
for each row execute function private.aliases_remap();

-- =====================================================================
-- Funções chamadas pelas Edge Functions (somente service_role)
-- =====================================================================

-- Resolve o produto do Gestor para um produto externo; cria produto + vínculo se for novo.
create or replace function public.resolve_product(
  p_user uuid, p_platform text, p_external_id text, p_name text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_product text;
  v_ext text := coalesce(nullif(btrim(p_external_id), ''), 'sem-id');
  v_name text := coalesce(nullif(btrim(p_name), ''), initcap(p_platform) || ' ' || v_ext);
begin
  select product_id into v_product from public.product_aliases
   where user_id = p_user and platform = p_platform and external_id = v_ext;
  if v_product is not null then
    return v_product;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text || '|alias|' || p_platform || '|' || v_ext, 0));
  select product_id into v_product from public.product_aliases
   where user_id = p_user and platform = p_platform and external_id = v_ext;
  if v_product is not null then
    return v_product;
  end if;

  -- reaproveita produto com o mesmo nome, se existir
  select id into v_product from public.products
   where user_id = p_user and lower(name) = lower(v_name)
   order by created_at limit 1;
  if v_product is null then
    insert into public.products (user_id, name, market, kind, active)
    values (p_user, v_name, '', 'front', true)
    returning id into v_product;
  end if;

  insert into public.product_aliases (user_id, platform, external_id, external_name, product_id)
  values (p_user, p_platform, v_ext, p_name, v_product)
  on conflict (user_id, platform, external_id) do nothing;

  return v_product;
end $$;

-- Grava/atualiza uma transação de forma atômica e idempotente.
-- Regra de status: nunca "volta" de devolvida/chargeback para aprovada; valores financeiros
-- da aprovação são preservados quando chegam eventos posteriores (reembolso etc.).
create or replace function private.status_rank(s text) returns int
language sql immutable as $$
  select case s when 'pending' then 0 when 'canceled' then 1 when 'approved' then 2 when 'refunded' then 3 when 'chargeback' then 3 else 0 end
$$;

create or replace function public.ingest_transaction(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  insert into public.transactions as t (
    user_id, integration_id, platform, platform_label, external_id, status, raw_status,
    product_id, product_external_id, product_name, sale_date, country, currency, rate,
    quantity, gross, fees, net, fees_estimated, buyer_email, buyer_name, payment_method,
    approved_at, refunded_at, status_at, last_event_id
  ) values (
    (p->>'user_id')::uuid, nullif(p->>'integration_id', '')::uuid, p->>'platform', p->>'platform_label', p->>'external_id',
    p->>'status', p->>'raw_status',
    p->>'product_id', p->>'product_external_id', p->>'product_name', (p->>'sale_date')::date,
    coalesce(nullif(p->>'country', ''), 'BR'), coalesce(nullif(p->>'currency', ''), 'BRL'), coalesce((p->>'rate')::numeric, 1),
    coalesce((p->>'quantity')::numeric, 1), coalesce((p->>'gross')::numeric, 0), coalesce((p->>'fees')::numeric, 0),
    (p->>'net')::numeric, coalesce((p->>'fees_estimated')::boolean, false),
    p->>'buyer_email', p->>'buyer_name', p->>'payment_method',
    (p->>'approved_at')::timestamptz, (p->>'refunded_at')::timestamptz, coalesce((p->>'status_at')::timestamptz, now()),
    (p->>'last_event_id')::bigint
  )
  on conflict (user_id, platform, external_id) do update set
    status = case
      when private.status_rank(excluded.status) >= private.status_rank(t.status) then excluded.status
      else t.status end,
    raw_status = case
      when private.status_rank(excluded.status) >= private.status_rank(t.status) then excluded.raw_status
      else t.raw_status end,
    -- valores: mantém os da venda já aprovada; senão usa os do evento
    gross = case when t.status in ('approved', 'refunded', 'chargeback') and t.gross > 0 then t.gross else excluded.gross end,
    fees = case when t.status in ('approved', 'refunded', 'chargeback') and t.gross > 0 then t.fees else excluded.fees end,
    net = case when t.status in ('approved', 'refunded', 'chargeback') and t.gross > 0 then t.net else excluded.net end,
    fees_estimated = case when t.status in ('approved', 'refunded', 'chargeback') and t.gross > 0 then t.fees_estimated else excluded.fees_estimated end,
    currency = case when t.status in ('approved', 'refunded', 'chargeback') and t.gross > 0 then t.currency else excluded.currency end,
    rate = case when t.status in ('approved', 'refunded', 'chargeback') and t.gross > 0 then t.rate else excluded.rate end,
    quantity = case when t.status in ('approved', 'refunded', 'chargeback') and t.gross > 0 then t.quantity else excluded.quantity end,
    sale_date = coalesce(t.sale_date, excluded.sale_date),
    product_id = coalesce(t.product_id, excluded.product_id),
    product_external_id = coalesce(t.product_external_id, excluded.product_external_id),
    product_name = coalesce(t.product_name, excluded.product_name),
    country = case when t.country is null or t.country = '' then excluded.country else t.country end,
    buyer_email = coalesce(t.buyer_email, excluded.buyer_email),
    buyer_name = coalesce(t.buyer_name, excluded.buyer_name),
    payment_method = coalesce(t.payment_method, excluded.payment_method),
    approved_at = coalesce(t.approved_at, excluded.approved_at),
    refunded_at = coalesce(t.refunded_at, excluded.refunded_at),
    status_at = greatest(t.status_at, excluded.status_at),
    last_event_id = coalesce(excluded.last_event_id, t.last_event_id),
    integration_id = coalesce(t.integration_id, excluded.integration_id)
  returning id into v_id;
  return v_id;
end $$;

-- =====================================================================
-- Funções chamadas pelo app (usuário logado)
-- =====================================================================

-- Grava segredos da integração. NULL = manter; '' = apagar.
create or replace function public.set_integration_secret(
  p_integration_id uuid, p_secret text default null, p_access_token text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
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

-- Diz se cada integração tem segredo/token salvo (sem revelar o valor)
create or replace function public.integration_secret_status()
returns table (integration_id uuid, has_secret boolean, has_access_token boolean)
language sql security definer set search_path = public, pg_temp as $$
  select s.integration_id, s.secret is not null, s.access_token is not null
    from public.integration_secrets s
    join public.integrations i on i.id = s.integration_id
   where i.user_id = auth.uid()
$$;

-- Gera um novo token de URL (invalida a URL antiga)
create or replace function public.rotate_integration_token(p_integration_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  update public.integrations set token = v where id = p_integration_id and user_id = auth.uid();
  if not found then raise exception 'Integração não encontrada'; end if;
  return v;
end $$;

-- =====================================================================
-- Agendamento da sincronização da Meta (pg_cron + pg_net), auto-configurável
-- =====================================================================
create table private.app_config (
  key text primary key,
  value text not null
);

do $$
begin
  begin
    execute 'create extension if not exists pg_net with schema extensions';
  exception when others then
    raise notice 'pg_net indisponível: %', sqlerrm;
  end;
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'pg_cron indisponível: %', sqlerrm;
  end;
end $$;

create or replace function private.call_meta_sync() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_url text := (select value from private.app_config where key = 'functions_url');
  v_secret text := (select value from private.app_config where key = 'cron_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 120000)'
    using v_url || '/meta-sync', '{"mode":"cron"}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
end $$;

-- Chamada pela Edge Function (service_role): registra a URL das funções, garante o segredo
-- interno e agenda a sincronização de hora em hora. Retorna o segredo para a função comparar.
create or replace function public.gestor_internal_setup(p_functions_url text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_secret text;
begin
  insert into private.app_config (key, value) values ('functions_url', p_functions_url)
  on conflict (key) do update set value = excluded.value;

  select value into v_secret from private.app_config where key = 'cron_secret';
  if v_secret is null then
    v_secret := encode(extensions.gen_random_bytes(32), 'hex');
    insert into private.app_config (key, value) values ('cron_secret', v_secret);
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      execute $q$select cron.schedule('gestor-meta-sync', '7 * * * *', 'select private.call_meta_sync()')$q$;
    exception when others then
      raise notice 'não foi possível agendar: %', sqlerrm;
    end;
  end if;
  return v_secret;
end $$;

-- =====================================================================
-- Segurança: RLS e permissões
-- =====================================================================
alter table public.settings enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.ads enable row level security;
alter table public.expenses enable row level security;
alter table public.capital enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.product_aliases enable row level security;
alter table public.webhook_events enable row level security;
alter table public.transactions enable row level security;
alter table public.fx_rates enable row level security;

-- Tabelas editáveis livremente pelo dono
create policy own_all on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_all on public.products for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_all on public.expenses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_all on public.capital for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_all on public.integrations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Receitas e tráfego: lê tudo; só altera o que é manual
create policy own_select on public.sales for select to authenticated using (user_id = (select auth.uid()));
create policy own_manual_insert on public.sales for insert to authenticated
  with check (user_id = (select auth.uid()) and origin = 'manual' and auto_key is null);
create policy own_manual_update on public.sales for update to authenticated
  using (user_id = (select auth.uid()) and origin = 'manual')
  with check (user_id = (select auth.uid()) and origin = 'manual' and auto_key is null);
create policy own_manual_delete on public.sales for delete to authenticated
  using (user_id = (select auth.uid()) and origin = 'manual');

create policy own_select on public.ads for select to authenticated using (user_id = (select auth.uid()));
create policy own_manual_insert on public.ads for insert to authenticated
  with check (user_id = (select auth.uid()) and origin = 'manual');
create policy own_manual_update on public.ads for update to authenticated
  using (user_id = (select auth.uid()) and origin = 'manual')
  with check (user_id = (select auth.uid()) and origin = 'manual');
create policy own_manual_delete on public.ads for delete to authenticated
  using (user_id = (select auth.uid()) and origin = 'manual');

-- Vínculos de produto: lê, troca o produto ou remove
create policy own_select on public.product_aliases for select to authenticated using (user_id = (select auth.uid()));
create policy own_update on public.product_aliases for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_delete on public.product_aliases for delete to authenticated using (user_id = (select auth.uid()));

-- Somente leitura para o app
create policy own_select on public.webhook_events for select to authenticated using (user_id = (select auth.uid()));
create policy own_select on public.transactions for select to authenticated using (user_id = (select auth.uid()));
create policy read_all on public.fx_rates for select to authenticated using (true);
-- integration_secrets: sem políticas => app não lê nem escreve diretamente.

-- Permissões finas (além do RLS)
revoke all on public.integration_secrets from anon, authenticated;
revoke all on public.webhook_events, public.transactions, public.fx_rates from anon, authenticated;
grant select on public.webhook_events, public.transactions, public.fx_rates to authenticated;
revoke all on public.settings, public.products, public.sales, public.ads, public.expenses, public.capital,
  public.integrations, public.product_aliases from anon;

-- token da integração: o app não grava (só via rotate_integration_token)
revoke insert, update on public.integrations from authenticated;
grant insert (id, platform, name, enabled, default_product_id, config) on public.integrations to authenticated;
grant update (name, enabled, default_product_id, config) on public.integrations to authenticated;

-- vínculo de produto: o app só troca o produto
revoke insert, update on public.product_aliases from authenticated;
grant update (product_id) on public.product_aliases to authenticated;

-- funções internas
revoke all on function public.resolve_product(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.ingest_transaction(jsonb) from public, anon, authenticated;
revoke all on function public.gestor_internal_setup(text) from public, anon, authenticated;
grant execute on function public.resolve_product(uuid, text, text, text) to service_role;
grant execute on function public.ingest_transaction(jsonb) to service_role;
grant execute on function public.gestor_internal_setup(text) to service_role;

revoke all on function public.set_integration_secret(uuid, text, text) from public, anon;
revoke all on function public.integration_secret_status() from public, anon;
revoke all on function public.rotate_integration_token(uuid) from public, anon;
grant execute on function public.set_integration_secret(uuid, text, text) to authenticated;
grant execute on function public.integration_secret_status() to authenticated;
grant execute on function public.rotate_integration_token(uuid) to authenticated;

-- =====================================================================
-- Tempo real: o painel atualiza sozinho quando chega venda/gasto novo
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.products, public.sales, public.ads, public.expenses, public.capital,
      public.settings, public.integrations, public.webhook_events;
  end if;
end $$;
