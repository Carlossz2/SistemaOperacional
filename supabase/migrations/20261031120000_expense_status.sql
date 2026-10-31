-- Situação das despesas: ativa, pausada ou cancelada (+ histórico de pausas, para os meses passados continuarem certos).
alter table public.expenses
  add column if not exists status text not null default 'active',
  add column if not exists paused_from text,
  add column if not exists pauses jsonb not null default '[]'::jsonb;

alter table public.expenses drop constraint if exists expenses_status_check;
alter table public.expenses add constraint expenses_status_check check (status in ('active', 'paused', 'canceled'));
alter table public.expenses drop constraint if exists expenses_paused_from_check;
alter table public.expenses add constraint expenses_paused_from_check
  check ((status = 'paused') = (paused_from is not null) and (paused_from is null or paused_from ~ '^\d{4}-\d{2}$'));
alter table public.expenses drop constraint if exists expenses_pauses_check;
alter table public.expenses add constraint expenses_pauses_check check (jsonb_typeof(pauses) = 'array');

-- recorrentes que já tinham "cobrada até" no passado: canceladas
update public.expenses
  set status = 'canceled'
  where recurrence = 'monthly' and end_month is not null and end_month < to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM') and status = 'active';
