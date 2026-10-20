"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { NewItem } from "@/components/knowledge/new-item";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { SkeletonList } from "@/components/ui/skeleton";
import { dateTime } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { SELECT_CLASS } from "@/lib/ui";
import { usePageSize } from "@/lib/use-page-size";
import { useQuery } from "@/lib/use-query";
import {
  KNOWLEDGE_KIND_LABEL,
  KNOWLEDGE_STATUS_LABEL,
  type KnowledgeItem,
  type KnowledgeKind,
  type KnowledgeStatus,
} from "@/types/domain";

type Card = Pick<KnowledgeItem, "id" | "title" | "kind" | "tags" | "summary" | "status" | "updated_at"> & {
  methodology: { title: string } | null;
};
const COLS = "id, title, kind, tags, summary, status, updated_at, methodology:methodology_id(title)";

export default function ConhecimentoPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const canManage = profile?.role === "admin" || profile?.role === "gerente";

  const [termInput, setTermInput] = useState("");
  const [term, setTerm] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState<KnowledgeKind | "">("");
  const [status, setStatus] = useState<KnowledgeStatus | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("knowledge");

  // Busca e tag com debounce de 300ms.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(termInput.trim());
      setTag(tagInput.trim().toLowerCase());
    }, 300);
    return () => clearTimeout(t);
  }, [termInput, tagInput]);

  const list = useQuery<{ rows: Card[]; total: number }>(async () => {
    let q = getSupabase().from("knowledge_items").select(COLS, { count: "exact" });
    if (term) q = q.textSearch("search", term, { type: "websearch", config: "portuguese" });
    if (kind) q = q.eq("kind", kind);
    if (tag) q = q.contains("tags", [tag]);
    if (canManage && status) q = q.eq("status", status);
    const start = (page - 1) * pageSize;
    const r = await q.order("updated_at", { ascending: false }).range(start, start + pageSize - 1);
    return { data: { rows: (r.data ?? []) as unknown as Card[], total: r.count ?? 0 }, error: r.error };
  }, [term, kind, tag, status, canManage, page, pageSize]);

  const filtered = !!(term || kind || tag || status);
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Base de conhecimento</h1>
        {canManage && <NewItem onCreated={(id) => router.push(`/conhecimento/item/?id=${id}&edit=1`)} />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Buscar na base de conhecimento"
          placeholder="Buscar por título, resumo ou conteúdo"
          className="min-w-56 flex-1"
          value={termInput}
          onChange={(e) => {
            setTermInput(e.target.value);
            setPage(1);
          }}
        />
        <select aria-label="Filtrar por tipo" className={SELECT_CLASS} value={kind} onChange={(e) => filter(setKind)(e.target.value as KnowledgeKind | "")}>
          <option value="">Todos os tipos</option>
          {(Object.keys(KNOWLEDGE_KIND_LABEL) as KnowledgeKind[]).map((k) => (
            <option key={k} value={k}>{KNOWLEDGE_KIND_LABEL[k]}</option>
          ))}
        </select>
        <Input
          aria-label="Filtrar por tag"
          placeholder="Tag"
          className="w-40"
          value={tagInput}
          onChange={(e) => {
            setTagInput(e.target.value);
            setPage(1);
          }}
        />
        {canManage && (
          <select aria-label="Filtrar por status" className={SELECT_CLASS} value={status} onChange={(e) => filter(setStatus)(e.target.value as KnowledgeStatus | "")}>
            <option value="">Todos os status</option>
            {(Object.keys(KNOWLEDGE_STATUS_LABEL) as KnowledgeStatus[]).map((s) => (
              <option key={s} value={s}>{KNOWLEDGE_STATUS_LABEL[s]}</option>
            ))}
          </select>
        )}
      </div>

      {list.error && <ErrorState what="a base de conhecimento" detail={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonList count={4} label="Carregando a base de conhecimento…" />}
      {!list.error && list.data && total === 0 && (
        <p className="surface-card px-4 py-6 text-sm text-muted-foreground">
          {filtered ? "Nenhum item com esses filtros." : "Nenhum item publicado. Metodologias e modelos aparecem aqui."}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((i) => (
            <li key={i.id}>
              <Link
                href={`/conhecimento/item/?id=${i.id}`}
                className="surface-card flex h-full flex-col gap-2 p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] font-semibold text-brand-mid">
                  {KNOWLEDGE_KIND_LABEL[i.kind]}
                  {i.status === "rascunho" && <Badge variant="outline" className="ml-auto">Rascunho</Badge>}
                </span>
                <span className="text-[0.9375rem] font-medium text-foreground">{i.title}</span>
                {i.methodology && <span className="text-[0.8125rem] text-muted-foreground">Metodologia: {i.methodology.title}</span>}
                {i.summary && <span className="line-clamp-2 text-sm text-muted-foreground">{i.summary}</span>}
                <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  {i.tags.map((t) => (
                    <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground">{t}</span>
                  ))}
                  <span className="num ml-auto text-xs text-muted-foreground">{dateTime(i.updated_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}

