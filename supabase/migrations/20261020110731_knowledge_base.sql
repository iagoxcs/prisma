-- Base de Conhecimento: metodologias (conteúdo em Markdown, usado como contexto) e modelos de projeto
-- vinculados a uma metodologia, cada um com a planilha de importação das fases (CSV no formato da
-- importação de tarefas: Escopo = fase). Arquivos de apoio no bucket privado `knowledge-files`.
-- Leitura: internos veem publicados; admin/gerente veem tudo e escrevem. Externos: nada.

-- ---------------------------------------------------------------------------
-- Helper de autorização
-- ---------------------------------------------------------------------------
create function public.can_manage_knowledge()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.has_role('gerente')
$$;

-- ---------------------------------------------------------------------------
-- knowledge_items
-- ---------------------------------------------------------------------------
create table public.knowledge_items (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 1 and 200),
  kind               text not null check (kind in ('metodologia', 'modelo')),
  -- Modelo pertence a uma metodologia; excluir a metodologia exige remover os modelos antes.
  methodology_id     uuid references public.knowledge_items (id) on delete restrict,
  prisma_stage       text check (prisma_stage in ('processos', 'resultados', 'indicadores', 'sistemas', 'melhoria', 'alinhamento')),
  tags               text[] not null default '{}',
  summary            text check (char_length(summary) <= 500),
  body               text check (char_length(body) <= 200000),
  source_file_name   text,                                                   -- .md de origem do corpo
  template_csv       text check (char_length(template_csv) <= 1048576),      -- planilha de fases (modelo)
  template_file_name text,
  status             text not null default 'rascunho' check (status in ('rascunho', 'publicado')),
  version            integer not null default 1,
  created_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  search             tsvector generated always as (
    setweight(to_tsvector('portuguese'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('portuguese'::regconfig, coalesce(summary, '')), 'B')
    || setweight(to_tsvector('portuguese'::regconfig, coalesce(body, '')), 'C')
  ) stored,
  constraint knowledge_items_kind_shape check (
    (kind = 'metodologia' and methodology_id is null and template_csv is null)
    or (kind = 'modelo' and methodology_id is not null)
  ),
  -- Publicar exige o conteúdo de cada tipo: Markdown na metodologia, planilha de fases no modelo.
  constraint knowledge_items_publish_ready check (
    status = 'rascunho'
    or (kind = 'metodologia' and body is not null)
    or (kind = 'modelo' and template_csv is not null)
  )
);
alter table public.knowledge_items enable row level security;
create index knowledge_items_search_idx on public.knowledge_items using gin (search);
create index knowledge_items_kind_status_idx on public.knowledge_items (kind, status);
create index knowledge_items_tags_idx on public.knowledge_items using gin (tags);
create index knowledge_items_methodology_idx on public.knowledge_items (methodology_id);
create index knowledge_items_created_by_idx on public.knowledge_items (created_by);
create index knowledge_items_updated_by_idx on public.knowledge_items (updated_by);

-- Tipo é fixo após a criação; methodology_id só aponta para uma metodologia.
create function public.knowledge_items_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'O tipo do item não pode ser alterado.' using errcode = '23514';
  end if;
  if new.methodology_id is not null and not exists (
    select 1 from public.knowledge_items m where m.id = new.methodology_id and m.kind = 'metodologia'
  ) then
    raise exception 'O modelo precisa estar vinculado a uma metodologia.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger knowledge_items_before_write
  before insert or update on public.knowledge_items
  for each row execute function public.knowledge_items_before_write();

-- updated_at/updated_by sempre; version só quando o conteúdo muda.
create function public.knowledge_items_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  if new.title is distinct from old.title
     or new.summary is distinct from old.summary
     or new.body is distinct from old.body
     or new.template_csv is distinct from old.template_csv then
    new.version = old.version + 1;
  else
    new.version = old.version;
  end if;
  return new;
end;
$$;

create trigger knowledge_items_before_update
  before update on public.knowledge_items
  for each row execute function public.knowledge_items_before_update();

create trigger knowledge_items_activity after insert or update or delete on public.knowledge_items
  for each row execute function public.log_activity();

-- ---------------------------------------------------------------------------
-- knowledge_files (arquivos de apoio)
-- ---------------------------------------------------------------------------
create table public.knowledge_files (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.knowledge_items (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 20971520), -- 20 MB
  mime_type    text,
  uploaded_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
alter table public.knowledge_files enable row level security;
create index knowledge_files_item_idx on public.knowledge_files (item_id);
create index knowledge_files_uploader_idx on public.knowledge_files (uploaded_by);

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
create policy knowledge_items_select on public.knowledge_items for select to authenticated
  using (public.is_internal() and (status = 'publicado' or public.can_manage_knowledge()));
create policy knowledge_items_insert on public.knowledge_items for insert to authenticated
  with check (public.can_manage_knowledge());
create policy knowledge_items_update on public.knowledge_items for update to authenticated
  using (public.can_manage_knowledge())
  with check (public.can_manage_knowledge());
create policy knowledge_items_delete on public.knowledge_items for delete to authenticated
  using (public.can_manage_knowledge());

-- Arquivos herdam a visibilidade do item.
create policy knowledge_files_select on public.knowledge_files for select to authenticated
  using (
    exists (
      select 1 from public.knowledge_items i
      where i.id = item_id
        and public.is_internal()
        and (i.status = 'publicado' or public.can_manage_knowledge())
    )
  );
create policy knowledge_files_insert on public.knowledge_files for insert to authenticated
  with check (public.can_manage_knowledge() and uploaded_by = (select auth.uid()));
create policy knowledge_files_update on public.knowledge_files for update to authenticated
  using (public.can_manage_knowledge())
  with check (public.can_manage_knowledge());
create policy knowledge_files_delete on public.knowledge_files for delete to authenticated
  using (public.can_manage_knowledge());

-- ---------------------------------------------------------------------------
-- Storage: bucket privado, 20 MB. Caminho: {item_id}/{uuid}-{arquivo}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('knowledge-files', 'knowledge-files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

-- O primeiro segmento do caminho é o id do item; a regra de acesso é a do item.
create function public.knowledge_item_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (string_to_array(object_name, '/'))[1]::uuid;
exception when others then
  return null;
end;
$$;

create policy knowledge_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'knowledge-files'
    and exists (
      select 1 from public.knowledge_items i
      where i.id = public.knowledge_item_id(name)
        and public.is_internal()
        and (i.status = 'publicado' or public.can_manage_knowledge())
    )
  );
create policy knowledge_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'knowledge-files'
    and public.can_manage_knowledge()
    and exists (select 1 from public.knowledge_items i where i.id = public.knowledge_item_id(name))
  );
create policy knowledge_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'knowledge-files' and public.can_manage_knowledge())
  with check (bucket_id = 'knowledge-files' and public.can_manage_knowledge());
create policy knowledge_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge-files' and public.can_manage_knowledge());

-- ---------------------------------------------------------------------------
-- Privilégios de função (padrão de 20261006002014_hardening_rls_perf.sql)
-- ---------------------------------------------------------------------------
revoke execute on function public.can_manage_knowledge() from public, anon;
revoke execute on function public.knowledge_item_id(text) from public, anon;
revoke execute on function public.knowledge_items_before_write() from public, anon, authenticated;
revoke execute on function public.knowledge_items_before_update() from public, anon, authenticated;
grant execute on function public.can_manage_knowledge() to authenticated;
grant execute on function public.knowledge_item_id(text) to authenticated;
