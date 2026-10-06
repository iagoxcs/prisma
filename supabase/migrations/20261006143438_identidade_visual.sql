-- Identidade visual "Estratos" (docs/IDENTIDADE-VISUAL.md §2.3) e single-tenant fixo.
-- 1. categories.color só aceita a CATEGORY_PALETTE (lib/theme/status.ts), sempre em minúsculas.
-- 2. Escopos criados sem cor (ex.: escopos padrão de novos projetos) recebem a próxima cor da paleta, em rodízio.
-- 3. O nome da organização deixa de ser parâmetro: é fixo na interface (Ambiente Consultoria).

-- ---------------------------------------------------------------------------
-- Paleta de escopos (manter em sincronia com CATEGORY_PALETTE)
-- ---------------------------------------------------------------------------
create function public.category_palette()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['#2a6aa3', '#1f6f80', '#45549e', '#5e7f99', '#0f4c75', '#6a5fa8', '#3d7f9e', '#4a6a88']
$$;

-- Cores legadas: o azul antigo da interface vira o Azul da paleta; o restante (inclusive o
-- default '#64748b') recebe cores em rodízio dentro de cada projeto, por ordem de criação.
update public.categories set color = '#2a6aa3' where lower(color) = '#2563eb';

with legacy as (
  select id,
         (row_number() over (partition by project_id order by created_at, id) - 1)::integer as n
  from public.categories
  where not (lower(color) = any (public.category_palette()))
)
update public.categories c
set color = (public.category_palette())[(legacy.n % 8) + 1]
from legacy
where c.id = legacy.id;

update public.categories set color = lower(color) where color <> lower(color);

-- Sem default fixo: o trigger abaixo escolhe a cor quando o insert não informa.
alter table public.categories alter column color drop default;

create function public.categories_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.color is null then
    new.color := (public.category_palette())[
      ((select count(*) from public.categories where project_id = new.project_id)::integer % 8) + 1
    ];
  end if;
  new.color := lower(new.color);
  return new;
end;
$$;

create trigger categories_color
  before insert or update of color on public.categories
  for each row execute function public.categories_before_write();

alter table public.categories
  add constraint categories_color_palette check (color = any (public.category_palette()));

-- ---------------------------------------------------------------------------
-- Single-tenant: organization_name sai dos parâmetros (o nome é fixo na interface).
-- ---------------------------------------------------------------------------
delete from public.app_settings where key = 'organization_name';
