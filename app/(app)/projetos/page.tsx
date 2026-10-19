"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination, clampPage } from "@/components/ui/pagination";
import { SkeletonList } from "@/components/ui/skeleton";
import { shortDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { OVERDUE_BADGE, PROJECT_STATUS_COLOR } from "@/lib/theme/status";
import { MSG_ERROR, ROW_LIST, SELECT_CLASS } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, todayISO, type Client, type Person, type Project, type ProjectStatus } from "@/types/domain";

type Sort = "criacao" | "nome" | "prazo";
const SORTS: { id: Sort; label: string }[] = [
  { id: "criacao", label: "Mais recentes" },
  { id: "nome", label: "Nome" },
  { id: "prazo", label: "Prazo final" },
];
const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_SIZE = 25;
const SIZE_KEY = "prisma-projects-page-size";

// Busca sem diferenciar acentos nem maiúsculas.
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const validSize = (v: unknown) => (PAGE_SIZES as readonly number[]).find((s) => s === Number(v));

function readStoredSize() {
  try {
    return validSize(localStorage.getItem(SIZE_KEY));
  } catch {
    return undefined;
  }
}

function ProjetosLista() {
  const { profile } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [managers, setManagers] = useState<Map<string, string>>(new Map());
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const canCreate = profile?.role === "admin" || profile?.role === "gerente";

  const [version, setVersion] = useState(0);
  const isExternal = profile?.is_external ?? true;
  const today = todayISO();

  useEffect(() => {
    let active = true;
    const supabase = getSupabase();
    Promise.all([
      supabase
        .from("projects")
        .select("id, client_id, name, status, manager_id, start_date, end_date, clients(name)")
        .order("created_at", { ascending: false }),
      isExternal
        ? Promise.resolve({ data: [], error: null })
        : supabase.from("clients").select("id, name, status").eq("status", "ativo").order("name"),
    ]).then(([p, c]) => {
      if (!active) return;
      if (p.error) setLoadError(p.error.message);
      else setProjects((p.data as unknown as Project[]) ?? []);
      setClients((c.data as Client[]) ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [isExternal, version]);

  // Nomes dos gerentes para o filtro (o select de projetos traz só manager_id).
  const managerIds = useMemo(() => [...new Set(projects.flatMap((p) => (p.manager_id ? [p.manager_id] : [])))].sort().join(","), [projects]);
  useEffect(() => {
    if (!managerIds) return;
    let active = true;
    getSupabase()
      .from("profiles")
      .select("id, name")
      .in("id", managerIds.split(","))
      .then(({ data }) => {
        if (active) setManagers(new Map(((data ?? []) as Person[]).map((m) => [m.id, m.name])));
      });
    return () => {
      active = false;
    };
  }, [managerIds]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: name.trim(), client_id: clientId || null, manager_id: profile.id })
      .select("id")
      .single();
    if (error) return setError(error.message);
    // O gerente também aparece na lista de membros do projeto.
    await supabase.from("project_members").insert({ project_id: data.id, user_id: profile.id, project_role: "gerente" });
    // Escopos padrão definidos em Configurações → Parâmetros.
    const defaults = await supabase.from("app_settings").select("value").eq("key", "default_categories").maybeSingle();
    if (Array.isArray(defaults.data?.value) && defaults.data.value.length > 0) {
      await supabase.from("categories").insert((defaults.data.value as string[]).map((name) => ({ project_id: data.id, name })));
    }
    setName("");
    setClientId("");
    setVersion((v) => v + 1);
  }

  // Estado de filtros, ordenação e paginação na URL (?q=&status=&client=&manager=&sort=&page=&size=).
  // replace: ajustar filtros não enche o histórico. Qualquer mudança que não seja de página volta à página 1.
  const setQuery = useCallback(
    (changes: Record<string, string | null>, resetPage = true) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      if (resetPage) q.delete("page");
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const status = (Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).find((s) => s === params.get("status")) ?? "";
  const client = params.get("client") ?? "";
  const manager = params.get("manager") ?? "";
  const sort = SORTS.find((s) => s.id === params.get("sort"))?.id ?? "criacao";
  const [storedSize] = useState(readStoredSize);
  const size = validSize(params.get("size")) ?? storedSize ?? DEFAULT_SIZE;

  // A busca filtra na hora; a URL é atualizada após uma pausa na digitação.
  const [search, setSearch] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== (params.get("q") ?? "")) setQuery({ q: search.trim() ? search : null });
    }, 250);
    return () => clearTimeout(t);
  }, [search, params, setQuery]);

  const filtering = !!(search.trim() || status || client || manager);
  function clearFilters() {
    setSearch("");
    setQuery({ q: null, status: null, client: null, manager: null });
  }

  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) if (p.client_id && p.clients?.name) m.set(p.client_id, p.clients.name);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [projects]);
  const managerOptions = [...managers].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));

  const filtered = useMemo(() => {
    const term = fold(search.trim());
    const list = projects.filter(
      (p) =>
        (!term || fold(p.name).includes(term) || fold(p.clients?.name ?? "").includes(term)) &&
        (!status || p.status === status) &&
        (!client || p.client_id === client) &&
        (!manager || p.manager_id === manager),
    );
    // "criacao" mantém a ordem da consulta (created_at desc).
    if (sort === "nome") list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    if (sort === "prazo") list.sort((a, b) => (a.end_date ?? "9999").localeCompare(b.end_date ?? "9999") || a.name.localeCompare(b.name, "pt-BR"));
    return list;
  }, [projects, search, status, client, manager, sort]);

  const rawPage = params.get("page");
  const page = clampPage(rawPage, filtered.length, size);
  // Página fora do intervalo (ou inválida) cai na última válida, também na URL.
  useEffect(() => {
    if (loading || rawPage === null || rawPage === String(page)) return;
    setQuery({ page: page > 1 ? String(page) : null }, false);
  }, [loading, rawPage, page, setQuery]);
  const pageItems = filtered.slice((page - 1) * size, page * size);

  function changeSize(next: number) {
    try {
      localStorage.setItem(SIZE_KEY, String(next));
    } catch {
      // Sem armazenamento: a escolha vale só pela URL.
    }
    setQuery({ size: String(next) });
  }

  return (
    <div className="space-y-6">
      <h1>Projetos</h1>
      {canCreate && (
        <form onSubmit={create} className="flex max-w-2xl flex-wrap gap-2">
          <Input className="min-w-48 flex-1" placeholder="Nome do projeto" required value={name} onChange={(e) => setName(e.target.value)} />
          <select
            aria-label="Cliente"
            className={SELECT_CLASS}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Sem cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button type="submit">Criar projeto</Button>
        </form>
      )}
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}

      {loading ? (
        <SkeletonList count={6} label="Carregando projetos…" />
      ) : loadError ? (
        <ErrorState
          what="os projetos"
          detail={loadError}
          onRetry={() => {
            setLoadError(null);
            setLoading(true);
            setVersion((v) => v + 1);
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filtrar projetos">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              <Input type="search" aria-label="Buscar por projeto ou cliente" placeholder="Buscar por projeto ou cliente" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select aria-label="Filtrar por status" className={SELECT_CLASS} value={status} onChange={(e) => setQuery({ status: e.target.value || null })}>
              <option value="">Todos os status</option>
              {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select aria-label="Filtrar por cliente" className={SELECT_CLASS} value={client} onChange={(e) => setQuery({ client: e.target.value || null })}>
              <option value="">Todos os clientes</option>
              {clientOptions.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <select aria-label="Filtrar por gerente" className={SELECT_CLASS} value={manager} onChange={(e) => setQuery({ manager: e.target.value || null })}>
              <option value="">Todos os gerentes</option>
              {managerOptions.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <select aria-label="Ordenar por" className={SELECT_CLASS} value={sort} onChange={(e) => setQuery({ sort: e.target.value === "criacao" ? null : e.target.value })}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>Ordenar: {s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex min-h-11 flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <p aria-live="polite">
              <span className="num text-foreground">{filtered.length}</span> de <span className="num text-foreground">{projects.length}</span> projetos
            </p>
            {filtering && (
              <Button type="button" variant="ghost" onClick={clearFilters}>Limpar filtros</Button>
            )}
          </div>

          <ul className={ROW_LIST}>
            {pageItems.map((p) => {
              const overdue = !!p.end_date && p.end_date < today && p.status !== "concluido" && p.status !== "cancelado";
              return (
                <li key={p.id}>
                  <Link
                    href={`/projeto/?id=${p.id}`}
                    className="surface-card flex min-h-13 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors duration-150 hover:bg-accent"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[0.9375rem] font-medium">{p.name}</span>
                      {p.clients?.name && <span className="truncate text-[0.8125rem] text-muted-foreground">{p.clients.name}</span>}
                    </span>
                    <span className="flex items-center gap-3">
                      {overdue && <span className={cn("num rounded-md px-2.5 py-0.5 text-xs", OVERDUE_BADGE)}>vencido {shortDate(p.end_date!)}</span>}
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ background: PROJECT_STATUS_COLOR[p.status] }} />
                        {PROJECT_STATUS_LABEL[p.status]}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
            {filtered.length === 0 &&
              (projects.length > 0 && filtering ? (
                <li className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  Nenhum projeto corresponde aos filtros. Limpe os filtros para ver todos.
                  <Button type="button" variant="outline" onClick={clearFilters}>Limpar filtros</Button>
                </li>
              ) : (
                <li className="text-sm text-muted-foreground">{canCreate ? "Nenhum projeto ainda. Crie o primeiro acima." : "Nenhum projeto visível para você."}</li>
              ))}
          </ul>

          {filtered.length > 0 && (
            <Pagination
              total={filtered.length}
              page={page}
              size={size}
              sizes={PAGE_SIZES}
              onPage={(n) => setQuery({ page: n > 1 ? String(n) : null }, false)}
              onSize={changeSize}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjetosPage() {
  return (
    <Suspense fallback={<SkeletonList count={6} label="Carregando projetos…" />}>
      <ProjetosLista />
    </Suspense>
  );
}
