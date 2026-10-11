-- Conta bancária da empresa (Mercado Pago): tudo que entra e sai da conta, importado do
-- "relatório de liberações" pela Edge Function bank-sync. O app só lê; quem grava é o servidor.

alter table public.integrations drop constraint if exists integrations_platform_check;
alter table public.integrations add constraint integrations_platform_check
  check (platform in ('hotmart', 'cakto', 'lastlink', 'ggcheckout', 'perfectpay', 'generic', 'meta', 'mercadopago'));

create table if not exists public.bank_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete set null,
  bank text not null default 'mercadopago',
  external_id text not null,
  date date not null,
  occurred_at timestamptz,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14, 2) not null check (amount >= 0),
  gross numeric(14, 2),
  fee numeric(14, 2),
  balance numeric(14, 2),
  kind text not null default '',
  description text not null default '',
  source_id text,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);
create index if not exists bank_movements_user_date on public.bank_movements (user_id, date);

alter table public.bank_movements enable row level security;
create policy own_select on public.bank_movements for select to authenticated using (user_id = (select auth.uid()));
create policy admin_only on public.bank_movements as restrictive for all to authenticated
  using ((select public.gestor_access_ok())) with check ((select public.gestor_access_ok()));
revoke all on public.bank_movements from anon, authenticated;
grant select on public.bank_movements to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bank_movements;
  end if;
end $$;
