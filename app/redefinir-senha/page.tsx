"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR } from "@/lib/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_PASSWORD = 10; // = minimum_password_length do Auth

// k-anonimato do Have I Been Pwned: só os 5 primeiros caracteres do SHA-1 saem do navegador.
// Add-Padding acrescenta sufixos falsos com contagem 0. Falha ou timeout = não bloqueia (fail-open).
async function isPwned(password: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const suffix = hash.slice(5);
    return (await res.text()).split("\n").some((line) => {
      const [s, count] = line.trim().split(":");
      return s === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

export default function RedefinirSenhaPage() {
  return (
    <AuthCard subtitle="Definir nova senha">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}

// O link do e-mail de recuperação chega em um de dois formatos:
// - ?token_hash=…&type=recovery: template supabase/templates/recovery.html, validado aqui por verifyOtp;
// - ?code=…: template padrão do Supabase ({{ .ConfirmationURL }}, fluxo PKCE). O supabase-js troca o
//   código pela sessão ao iniciar (detectSessionInUrl) e getSession() aguarda essa troca.
//   Só funciona no mesmo navegador em que o link foi pedido (o verificador PKCE fica nele).
function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const code = params.get("code");
  const [state, setState] = useState<"checking" | "ready" | "invalid">(tokenHash || code ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tokenHash && !code) return;
    let alive = true;
    const auth = getSupabase().auth;
    const check = tokenHash
      ? auth.verifyOtp({ type: "recovery", token_hash: tokenHash }).then(({ error }) => !error)
      : auth.getSession().then(({ data }) => !!data.session);
    check.then((ok) => alive && setState(ok ? "ready" : "invalid"));
    return () => {
      alive = false;
    };
  }, [tokenHash, code]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`);
    if (password !== confirm) return setError("As senhas não conferem.");
    setBusy(true);
    setError(null);
    if (await isPwned(password)) {
      setBusy(false);
      return setError("Esta senha aparece em vazamentos conhecidos. Escolha outra.");
    }
    const { error } = await getSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.code === "same_password" ? "Escolha uma senha diferente da atual." : "Não foi possível salvar a senha. Tente de novo.");
    else router.replace("/");
  }

  if (state === "checking") return <p className="text-sm text-muted-foreground">Validando o link…</p>;

  if (state === "invalid")
    return (
      <div className="space-y-4">
        <p role="alert" className={MSG_ERROR}>Este link é inválido ou expirou.</p>
        {code && (
          <p className="text-[0.8125rem] text-muted-foreground">Abra o link no mesmo navegador em que pediu a recuperação.</p>
        )}
        <Link href="/recuperar-senha/" className={buttonVariants({ className: "w-full" })}>Pedir um novo link</Link>
      </div>
    );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">Nova senha</Label>
        <Input id="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD} value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-[0.8125rem] text-muted-foreground">Mínimo de <span className="num">{MIN_PASSWORD}</span> caracteres.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Repita a nova senha</Label>
        <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Salvando…" : "Salvar e entrar"}
      </Button>
    </form>
  );
}
