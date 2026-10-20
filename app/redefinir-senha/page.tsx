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

export default function RedefinirSenhaPage() {
  return (
    <AuthCard subtitle="Definir nova senha">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}

// Link do e-mail de recuperação: ?token_hash=…&type=recovery (template supabase/templates/recovery.html).
function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash");
  const [state, setState] = useState<"checking" | "ready" | "invalid">(tokenHash ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tokenHash) return;
    let alive = true;
    getSupabase()
      .auth.verifyOtp({ type: "recovery", token_hash: tokenHash })
      .then(({ error }) => alive && setState(error ? "invalid" : "ready"));
    return () => {
      alive = false;
    };
  }, [tokenHash]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`);
    if (password !== confirm) return setError("As senhas não conferem.");
    setBusy(true);
    setError(null);
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
