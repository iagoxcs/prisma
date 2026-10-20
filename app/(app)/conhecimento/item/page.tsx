"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Markdown, { type Components } from "react-markdown";
import { ArrowLeft, Download, Pencil } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { KnowledgeEditor } from "@/components/knowledge/knowledge-editor";
import { KnowledgeFiles } from "@/components/knowledge/knowledge-files";
import { NewItem } from "@/components/knowledge/new-item";
import { PhaseList } from "@/components/knowledge/phase-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { saveText } from "@/lib/attachments";
import { dateTime } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { templatePhases } from "@/lib/task-csv";
import { useQuery } from "@/lib/use-query";
import { KNOWLEDGE_KIND_LABEL, PRISMA_STAGE_LABEL, type KnowledgeItem } from "@/types/domain";

const COLS =
  "id, title, kind, methodology_id, prisma_stage, tags, summary, body, source_file_name, template_csv, template_file_name, status, version, created_by, updated_by, created_at, updated_at, methodology:methodology_id(id, title)";
type Item = KnowledgeItem & { methodology: { id: string; title: string } | null };
type ModelRow = Pick<KnowledgeItem, "id" | "title" | "status" | "summary">;

// Markdown sem HTML cru (sem rehype-raw): react-markdown já ignora HTML e saneia URLs.
// Imagens viram link, para nada externo ser carregado inline.
const MD: Components = {
  h1: ({ children }) => <h2 className="mt-6 text-xl font-semibold">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-5 text-lg font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 font-semibold">{children}</h4>,
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>,
  code: ({ children }) => <code className="num rounded bg-muted px-1 py-0.5 text-[0.8125rem]">{children}</code>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-md bg-muted p-3 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  hr: () => <hr className="border-border" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
        {alt || "imagem"}
      </a>
    ) : null,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-3 py-2 font-medium text-muted-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2">{children}</td>,
};

function BackLink() {
  return (
    <Link href="/conhecimento/" className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden /> Base de conhecimento
    </Link>
  );
}

// Rota por query string (?id=&edit=1) porque o site é exportado estaticamente.
function ItemDetalhe() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = params.get("id") ?? "";
  const { profile } = useAuth();
  const canManage = profile?.role === "admin" || profile?.role === "gerente";
  const editing = canManage && params.get("edit") === "1";

  const item = useQuery<Item>(
    () =>
      getSupabase()
        .from("knowledge_items")
        .select(COLS)
        .eq("id", id)
        .maybeSingle()
        .then((r) => ({ data: r.data as unknown as Item | null, error: r.error })),
    [id],
  );

  const setEditing = (on: boolean) => {
    const q = new URLSearchParams(params.toString());
    if (on) q.set("edit", "1");
    else q.delete("edit");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  if (item.loading) return <SkeletonList count={4} label="Carregando o item…" />;
  if (item.error) return <ErrorState what="o item" detail={item.error} onRetry={item.reload} />;
  const i = item.data;
  if (!id || !i)
    return (
      <div className="space-y-3">
        <p className="text-sm">Item não encontrado ou sem acesso.</p>
        <BackLink />
      </div>
    );

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink />
      {editing ? (
        <>
          <h1>Editar item</h1>
          <KnowledgeEditor
            key={i.updated_at}
            item={i}
            onSaved={item.reload}
            onDeleted={() => router.push("/conhecimento/")}
            onCancel={() => setEditing(false)}
          />
        </>
      ) : (
        <article className="space-y-5">
          <header className="space-y-2">
            <p className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] font-semibold text-brand-mid">
              {KNOWLEDGE_KIND_LABEL[i.kind]}
              {i.prisma_stage && <span>· {PRISMA_STAGE_LABEL[i.prisma_stage]}</span>}
              {i.status === "rascunho" && <Badge variant="outline">Rascunho</Badge>}
            </p>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1>{i.title}</h1>
              {canManage && (
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil strokeWidth={1.75} aria-hidden /> Editar
                </Button>
              )}
            </div>
            {i.methodology && (
              <p className="text-sm text-muted-foreground">
                Metodologia:{" "}
                <Link href={`/conhecimento/item/?id=${i.methodology.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                  {i.methodology.title}
                </Link>
              </p>
            )}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>Versão <span className="num text-foreground">{i.version}</span></span>
              <span>Atualizado em <span className="num text-foreground">{dateTime(i.updated_at)}</span></span>
            </p>
            {i.tags.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
                {i.tags.map((t) => (
                  <li key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground">{t}</li>
                ))}
              </ul>
            )}
            {i.summary && <p className="text-[0.9375rem] text-muted-foreground">{i.summary}</p>}
          </header>
          {i.kind === "modelo" && <ModelTemplate item={i} />}
          {i.body ? (
            <section className="space-y-2" aria-label={i.kind === "modelo" ? "Orientações" : "Conteúdo da metodologia"}>
              {i.kind === "modelo" && <h2 className="text-lg font-semibold">Orientações</h2>}
              <div className="surface-card space-y-3 p-5 text-[0.9375rem]">
                <Markdown components={MD}>{i.body}</Markdown>
              </div>
              {i.source_file_name && (
                <p className="text-[0.8125rem] text-muted-foreground">Importado de <span className="num">{i.source_file_name}</span></p>
              )}
            </section>
          ) : (
            i.kind === "metodologia" && <p className="text-sm text-muted-foreground">Sem conteúdo. Importe o arquivo Markdown da metodologia.</p>
          )}
        </article>
      )}
      {i.kind === "metodologia" && (
        <MethodologyModels methodologyId={i.id} canManage={canManage} onCreated={(id) => router.push(`/conhecimento/item/?id=${id}&edit=1`)} />
      )}
      <KnowledgeFiles itemId={i.id} canManage={canManage} />
    </div>
  );
}

// Planilha de fases do modelo: resumo das fases e download do CSV (aplicado no projeto por "Importar CSV").
function ModelTemplate({ item }: { item: Item }) {
  if (!item.template_csv)
    return <p className="surface-card px-4 py-6 text-sm text-muted-foreground">Sem planilha de fases. Envie a planilha na edição do modelo.</p>;
  const { phases, tasks } = templatePhases(item.template_csv);
  const csv = item.template_csv;
  return (
    <section className="surface-card space-y-3 p-5" aria-labelledby="phases-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="phases-title" className="text-lg font-semibold">Fases do modelo</h2>
        <Button type="button" variant="outline" onClick={() => saveText(csv, item.template_file_name ?? `${item.title}.csv`, "text/csv;charset=utf-8")}>
          <Download strokeWidth={1.75} aria-hidden /> Baixar planilha
        </Button>
      </div>
      <PhaseList phases={phases} total={tasks} />
      <p className="text-[0.8125rem] text-muted-foreground">
        Para aplicar em um projeto: no Quadro, use Importar CSV e escolha este modelo.
      </p>
    </section>
  );
}

function MethodologyModels({ methodologyId, canManage, onCreated }: { methodologyId: string; canManage: boolean; onCreated: (id: string) => void }) {
  const models = useQuery<ModelRow[]>(
    () => getSupabase().from("knowledge_items").select("id, title, status, summary").eq("methodology_id", methodologyId).order("title"),
    [methodologyId],
  );
  const rows = models.data ?? [];
  return (
    <section className="space-y-3" aria-labelledby="models-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="models-title" className="text-lg font-semibold">Modelos desta metodologia</h2>
        {canManage && <NewItem methodologyId={methodologyId} label="Novo modelo" onCreated={onCreated} />}
      </div>
      {models.error && <ErrorState what="os modelos" detail={models.error} onRetry={models.reload} />}
      {!models.loading && !models.error && rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum modelo vinculado.</p>}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((m) => (
            <li key={m.id}>
              <Link href={`/conhecimento/item/?id=${m.id}`} className="surface-card flex min-h-13 flex-col justify-center gap-1 px-4 py-3 text-sm hover:bg-accent">
                <span className="flex items-center gap-2 font-medium">
                  {m.title}
                  {m.status === "rascunho" && <Badge variant="outline">Rascunho</Badge>}
                </span>
                {m.summary && <span className="line-clamp-1 text-muted-foreground">{m.summary}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ConhecimentoItemPage() {
  return (
    <Suspense fallback={null}>
      <ItemDetalhe />
    </Suspense>
  );
}
