"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { getSupabase } from "@/lib/supabase/client";
import { MSG_ERROR, MSG_OK } from "@/lib/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Pede o link de redefinição (e-mail enviado pelo Supabase Auth via SMTP do Resend).
// A resposta é sempre a mesma, exista ou não a conta.
export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha/`,
    });
    setBusy(false);
    // Limite de envios é o único erro que vale mostrar; o resto não revela se a conta existe.
    if (error?.status === 429) setError("Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo.");
    else setSent(true);
  }

  return (
    <AuthCard subtitle="Recuperar acesso">
      {sent ? (
        <div className="space-y-4">
          <p role="status" className={MSG_OK}>
            Se houver uma conta com esse e-mail, enviamos um link para definir uma nova senha. Ele vale por 1 hora.
          </p>
          <p className="text-[0.8125rem] text-muted-foreground">Não chegou? Confira a caixa de spam ou peça de novo em alguns minutos.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Enviando…" : "Enviar link"}
          </Button>
        </form>
      )}
      <Link href="/login/" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground hover:underline">
        Voltar ao login
      </Link>
    </AuthCard>
  );
}
