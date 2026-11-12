"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageCircle } from "lucide-react";
import type { UserIdentity } from "@supabase/supabase-js";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, MSG_OK } from "@/lib/ui";
import { ROLE_LABEL } from "@/types/domain";

export default function ContaPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
      <Conta />
    </Suspense>
  );
}

// Mensagens do Supabase no retorno do linkIdentity, traduzidas para o usuário.
function linkError(description: string | null): string {
  const d = (description ?? "").toLowerCase();
  if (d.includes("already linked")) return "Esta conta do Discord já está vinculada a outro usuário do Prisma.";
  if (d.includes("manual linking")) return "A vinculação de contas ainda não foi habilitada. Avise um administrador.";
  return "Não foi possível vincular o Discord. Tente de novo.";
}

function discordName(identity: UserIdentity): string {
  const d = identity.identity_data ?? {};
  const claims = (d.custom_claims ?? {}) as Record<string, unknown>;
  return String(claims.global_name ?? d.full_name ?? d.name ?? d.user_name ?? "Conta do Discord");
}

function Conta() {
  const { session, profile } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  // Retorno do linkIdentity: erro vem na query; sucesso traz ?code= (trocado pela sessão no init).
  const [error, setError] = useState<string | null>(() => {
    const err = params.get("error");
    if (!err) return null;
    return err === "access_denied" ? "Vinculação cancelada no Discord." : linkError(params.get("error_description"));
  });
  const [notice, setNotice] = useState<string | null>(() =>
    params.has("code") && !params.has("error") ? "Discord vinculado." : null,
  );
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const load = useCallback(
    () =>
      getSupabase()
        .auth.getUserIdentities()
        .then(({ data, error }) => {
          if (error) setError("Não foi possível carregar as formas de acesso.");
          else setIdentities(data.identities);
        }),
    [],
  );

  // Limpa a URL de retorno e recarrega as identidades quando a troca do ?code= termina.
  useEffect(() => {
    if (params.has("error") || params.has("code")) router.replace("/conta/");
    load();
    const { data: sub } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === "USER_UPDATED" || event === "SIGNED_IN") setTimeout(load, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [params, router, load]);

  const discord = identities?.find((i) => i.provider === "discord") ?? null;
  const onlyIdentity = (identities?.length ?? 0) < 2;

  async function link() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await getSupabase().auth.linkIdentity({
      provider: "discord",
      options: { redirectTo: `${window.location.origin}/conta/` },
    });
    if (error) {
      setBusy(false);
      setError(linkError(error.message));
    }
  }

  async function unlink() {
    if (!discord || onlyIdentity) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error } = await getSupabase().auth.unlinkIdentity(discord);
    setBusy(false);
    setConfirmUnlink(false);
    if (error) setError("Não foi possível desvincular o Discord. Tente de novo.");
    else setNotice("Discord desvinculado. O login pelo Discord deixa de funcionar.");
    load();
  }

  if (!profile) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1>Minha conta</h1>

      <section className="surface-card space-y-1 p-5 text-sm">
        <div className="text-base font-semibold">{profile.name}</div>
        <div className="text-muted-foreground">{session?.user.email}</div>
        <div className="text-muted-foreground">{ROLE_LABEL[profile.role]}</div>
      </section>

      {!profile.is_external && (
        <section className="surface-card space-y-4 p-5">
          <div className="flex items-start gap-3">
            <MessageCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Discord</h2>
              <p className="text-sm text-muted-foreground">
                Vincule sua conta do Discord para entrar no Prisma por ela e usar o assistente do Prisma no servidor.
              </p>
            </div>
          </div>

          {identities === null && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}

          {identities !== null && discord && (
            <div className="space-y-3">
              <p className="text-sm">
                Vinculado a <span className="font-medium">{discordName(discord)}</span>
                {discord.created_at && (
                  <span className="text-muted-foreground">
                    {" "}desde <span className="num">{new Date(discord.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
                  </span>
                )}
              </p>
              <Button variant="outline" disabled={busy || onlyIdentity} onClick={() => setConfirmUnlink(true)}>
                Desvincular
              </Button>
              {onlyIdentity && (
                <p className="text-sm text-muted-foreground">
                  O Discord é sua única forma de acesso. Para desvincular, defina uma senha em &quot;Esqueci a senha&quot; na tela de login.
                </p>
              )}
            </div>
          )}

          {identities !== null && !discord && (
            <Button disabled={busy} onClick={link}>
              {busy ? "Abrindo o Discord…" : "Vincular Discord"}
            </Button>
          )}

          {notice && <p role="status" className={MSG_OK}>{notice}</p>}
          {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
        </section>
      )}

      <ConfirmDialog
        open={confirmUnlink}
        title="Desvincular o Discord?"
        description="Você deixa de entrar no Prisma pelo Discord e o assistente do Prisma deixa de reconhecer sua conta. Dá para vincular de novo depois."
        confirmLabel="Desvincular"
        destructive
        busy={busy}
        onConfirm={unlink}
        onCancel={() => setConfirmUnlink(false)}
      />
    </div>
  );
}
