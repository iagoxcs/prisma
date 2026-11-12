"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { AuthCard } from "@/components/auth-card";
import { getSupabase } from "@/lib/supabase/client";
import { ORG_NAME } from "@/lib/settings";
import { MSG_ERROR } from "@/lib/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MSG_NOT_LINKED =
  "Esta conta do Discord não está vinculada ao Prisma. Entre com e-mail e senha e vincule em Minha conta.";

// Erro do OAuth devolvido pelo Supabase na query da URL de retorno (fluxo PKCE).
function oauthError(params: URLSearchParams): string | null {
  const code = params.get("error");
  if (!code) return null;
  if (code === "access_denied") return "Login pelo Discord cancelado.";
  // Cadastro fechado: Discord sem conta correspondente ou com e-mail não verificado (H6).
  return MSG_NOT_LINKED;
}

export default function LoginPage() {
  return (
    <AuthCard subtitle={`Gerenciador de Projetos da ${ORG_NAME}`}>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}

// Login por e-mail e senha ou pelo Discord (vinculação A + B, ver docs/ARQUITETURA.md).
// O retorno do OAuth volta para esta tela: com sessão segue para o painel; com erro mostra o motivo.
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => oauthError(params));
  const [busy, setBusy] = useState(() => params.has("code"));

  useEffect(() => {
    const supabase = getSupabase();
    if (params.has("error")) {
      router.replace("/login/");
      return;
    }
    // getSession() aguarda a troca do ?code= pela sessão (detectSessionInUrl).
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
      else setBusy(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setTimeout(() => router.replace("/"), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [params, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError("E-mail ou senha inválidos.");
    else router.replace("/");
  }

  async function signInWithDiscord() {
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: `${window.location.origin}/login/` },
    });
    if (error) {
      setBusy(false);
      setError("Não foi possível abrir o login do Discord. Tente de novo.");
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="password">Senha</Label>
            <Link href="/recuperar-senha/" className="text-[0.8125rem] text-muted-foreground hover:text-foreground hover:underline">
              Esqueci a senha
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={signInWithDiscord}>
        <MessageCircle strokeWidth={1.75} /> Entrar com Discord
      </Button>
    </div>
  );
}
