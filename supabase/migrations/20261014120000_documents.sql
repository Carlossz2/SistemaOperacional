-- Documentos da empresa (PDF, comprovantes, notas, contratos…).
-- Arquivo: Supabase Storage, bucket PRIVADO "documents", pasta = id do usuário.
-- Dados (nome, categoria, data, valor): tabela public.documents.
-- Acesso: só o dono, e só o administrador com 2FA (mesma regra do resto do sistema).

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 300),
  category text not null default 'Outro' check (length(category) <= 60),
  date date not null default current_date,
  amount numeric(14, 2) check (amount is null or amount >= 0),
  notes text check (notes is null or length(notes) <= 2000),
  path text not null unique check (length(path) <= 500),
  size bigint not null default 0 check (size >= 0),
  mime text not null default '' check (length(mime) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists documents_user_date on public.documents (user_id, date desc);

alter table public.documents enable row level security;
create policy own_all on public.documents for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and split_part(path, '/', 1) = (select auth.uid())::text);
create policy admin_only on public.documents as restrictive for all to authenticated
  using ((select public.gestor_access_ok())) with check ((select public.gestor_access_ok()));
revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;

-- Arquivos: bucket privado (25 MB por arquivo) e regras por pasta do usuário
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'schema storage ausente: bucket não criado';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('documents', 'documents', false, 26214400)
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

  execute $p$create policy gestor_documents_select on storage.objects for select to authenticated
    using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.gestor_access_ok()))$p$;
  execute $p$create policy gestor_documents_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.gestor_access_ok()))$p$;
  execute $p$create policy gestor_documents_update on storage.objects for update to authenticated
    using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.gestor_access_ok()))$p$;
  execute $p$create policy gestor_documents_delete on storage.objects for delete to authenticated
    using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.gestor_access_ok()))$p$;
end $$;
