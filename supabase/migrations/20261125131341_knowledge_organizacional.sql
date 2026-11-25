-- P14: terceiro tipo na Base de Conhecimento, "Conhecimento organizacional" (kind = 'organizacional').
-- Mesmo formato da metodologia: corpo em Markdown, sem metodologia de origem nem planilha de fases;
-- publicar exige o corpo. RLS, arquivos de apoio, busca e versão já valem para qualquer tipo.

alter table public.knowledge_items
  drop constraint knowledge_items_kind_check,
  drop constraint knowledge_items_kind_shape,
  drop constraint knowledge_items_publish_ready;

alter table public.knowledge_items
  add constraint knowledge_items_kind_check check (kind in ('metodologia', 'modelo', 'organizacional')),
  add constraint knowledge_items_kind_shape check (
    (kind in ('metodologia', 'organizacional') and methodology_id is null and template_csv is null)
    or (kind = 'modelo' and methodology_id is not null)
  ),
  add constraint knowledge_items_publish_ready check (
    status = 'rascunho'
    or (kind in ('metodologia', 'organizacional') and body is not null)
    or (kind = 'modelo' and template_csv is not null)
  );
