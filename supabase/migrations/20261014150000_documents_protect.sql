-- Documentos nunca se perdem pelo sistema:
-- * "Excluir" vira lixeira (deleted_at), sempre restaurável; a linha não pode ser apagada pelo app.
-- * O arquivo de um documento cadastrado não pode ser apagado nem sobrescrito pelo app.
-- * Só dá para mudar nome/categoria/data/valor/observações/lixeira, nunca o caminho do arquivo.
-- * Apagar a conta do usuário não leva os documentos junto (bloqueia em vez de apagar em cascata).

alter table public.documents add column if not exists deleted_at timestamptz;

drop policy if exists own_all on public.documents;
create policy own_select on public.documents for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_insert on public.documents for insert to authenticated
  with check (user_id = (select auth.uid()) and split_part(path, '/', 1) = (select auth.uid())::text);
create policy own_update on public.documents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke delete, update, truncate on public.documents from authenticated;
grant update (name, category, date, amount, notes, deleted_at) on public.documents to authenticated;

alter table public.documents drop constraint if exists documents_user_id_fkey;
alter table public.documents add constraint documents_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  drop policy if exists gestor_documents_update on storage.objects;
  drop policy if exists gestor_documents_delete on storage.objects;
  -- só apaga arquivo que não pertence a nenhum documento (limpeza de envio que falhou no meio)
  execute $p$create policy gestor_documents_delete on storage.objects for delete to authenticated
    using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.gestor_access_ok())
      and not exists (select 1 from public.documents d where d.path = storage.objects.name))$p$;
end $$;
