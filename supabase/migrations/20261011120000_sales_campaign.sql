-- Campanha de origem (opcional) nas receitas lançadas à mão, para medir lucro e ROI por campanha.
alter table public.sales add column if not exists campaign text;
create index if not exists sales_user_campaign on public.sales (user_id, campaign) where campaign is not null;
