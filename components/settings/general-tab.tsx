"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateTime } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";
import { parseSettings, type AppSettings, type SettingRow } from "@/lib/settings";
import { ORG_NAME } from "@/lib/settings";
import { MSG_ERROR, MSG_OK, TEXTAREA_CLASS } from "@/lib/ui";
import { useQuery } from "@/lib/use-query";

export function GeneralTab() {
  const rows = useQuery<SettingRow[]>(
    () => getSupabase().from("app_settings").select("key, value, updated_at, updated_by"),
    [],
  );
  if (rows.loading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (rows.error) return <p role="alert" className={MSG_ERROR}>{rows.error}</p>;
  const settings = parseSettings(rows.data ?? []);
  const last = (rows.data ?? []).map((r) => r.updated_at).sort().at(-1);
  // key reinicia o formulário após salvar (valores vindos do servidor).
  return <GeneralForm key={JSON.stringify(settings)} settings={settings} lastUpdate={last} onSaved={rows.reload} />;
}

function GeneralForm({ settings, lastUpdate, onSaved }: { settings: AppSettings; lastUpdate?: string; onSaved: () => void }) {
  const [days, setDays] = useState(String(settings.deadline_warning_days));
  const [soon, setSoon] = useState(settings.notify_due_soon);
  const [overdue, setOverdue] = useState(settings.notify_overdue);
  const [cats, setCats] = useState(settings.default_categories.join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const next: AppSettings = {
      organization_name: settings.organization_name, // single-tenant: não editável por tela
      deadline_warning_days: Number(days),
      notify_due_soon: soon,
      notify_overdue: overdue,
      default_categories: [...new Set(cats.split("\n").map((c) => c.trim()).filter(Boolean))],
    };
    const supabase = getSupabase();
    const changed = (Object.keys(next) as (keyof AppSettings)[]).filter(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(settings[k]),
    );
    for (const key of changed) {
      const { error } = await supabase.from("app_settings").update({ value: next[key] }).eq("key", key);
      if (error) {
        setBusy(false);
        return setMsg({ ok: false, text: error.message });
      }
    }
    setBusy(false);
    setMsg({ ok: true, text: changed.length ? "Parâmetros salvos." : "Nada a salvar." });
    onSaved();
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-5">
      <section className="glass-coluna space-y-4 p-5">
        <h2>Geral</h2>
        <div className="space-y-1.5">
          <Label htmlFor="s-cats">Escopos padrão de novos projetos</Label>
          <textarea
            id="s-cats"
            rows={5}
            placeholder={"Um por linha. Ex.:\nDiagnóstico\nImplantação"}
            className={TEXTAREA_CLASS}
            value={cats}
            onChange={(e) => setCats(e.target.value)}
          />
          <p className="text-[0.8125rem] text-muted-foreground">Criados automaticamente ao cadastrar um projeto (até 20, 40 caracteres cada).</p>
        </div>
      </section>

      <section className="glass-coluna space-y-4 p-5">
        <div className="space-y-1">
          <h2>Alertas de prazo</h2>
          <p className="text-[0.8125rem] text-muted-foreground">Verificados todos os dias às <span className="num">08:00</span> (Brasília).</p>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={soon} onChange={(e) => setSoon(e.target.checked)} /> Avisar o responsável quando o prazo estiver próximo
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="s-days">Antecedência do alerta (dias)</Label>
          <Input id="s-days" type="number" min={0} max={14} step={1} required className="num w-28" disabled={!soon} value={days} onChange={(e) => setDays(e.target.value)} />
          <p className="text-[0.8125rem] text-muted-foreground">0 = apenas no dia do vencimento. Máximo 14.</p>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Avisar o responsável quando o prazo vencer
        </label>
      </section>

      <section className="glass-coluna space-y-3 p-5">
        <h2>Fixos (definidos por requisito)</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Organização</dt>
          <dd>{ORG_NAME}</dd>
          <dt className="text-muted-foreground">Tamanho máximo de anexo</dt>
          <dd className="num">20 MB</dd>
          <dt className="text-muted-foreground">Fuso horário</dt>
          <dd>America/Sao_Paulo</dd>
          <dt className="text-muted-foreground">Senha mínima</dt>
          <dd><span className="num">10</span> caracteres</dd>
        </dl>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar parâmetros"}</Button>
        {lastUpdate && <span className="text-[0.8125rem] text-muted-foreground">Última alteração: <span className="num">{dateTime(lastUpdate)}</span></span>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? MSG_OK : MSG_ERROR}>{msg.text}</p>}
    </form>
  );
}
