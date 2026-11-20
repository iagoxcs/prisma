"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { DEFAULT_ROWS, permissionSet, type Permission, type PermissionRow } from "@/lib/permissions";
import { getSupabase } from "@/lib/supabase/client";
import type { Profile } from "@/types/domain";

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Falha ao ler o perfil (rede, sessão expirada). Não é o mesmo que conta inativa. */
  profileError: string | null;
  /** Capacidade do perfil (role_permissions). Só UX: o banco valida de novo via role_can(). */
  can: (perm: Permission) => boolean;
  retry: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [perms, setPerms] = useState<Set<Permission>>(() => new Set());
  // Usuário cujo perfil está carregado (ou carregando): evita recarregar a cada TOKEN_REFRESHED.
  const loadedFor = useRef<string | null>(null);
  // Só a última chamada aplica o resultado (getSession e INITIAL_SESSION chegam juntos).
  const seq = useRef(0);

  const loadProfile = useCallback(async (s: Session | null, force = false) => {
    const supabase = getSupabase();
    const run = ++seq.current;
    if (!s) {
      loadedFor.current = null;
      setSession(null);
      setProfile(null);
      setProfileError(null);
      setPerms(new Set());
      setLoading(false);
      return;
    }
    if (!force && loadedFor.current === s.user.id) {
      // Mesmo usuário (renovação do token): troca só a sessão, o perfil continua válido.
      setSession(s);
      return;
    }
    loadedFor.current = s.user.id;
    // Sessão e perfil mudam juntos: sem isso o AppShell via "sessão sem perfil" e mostrava
    // "Acesso pendente" logo depois do login, até a consulta do perfil voltar.
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, job_title, role, is_external, active")
      .eq("id", s.user.id)
      .maybeSingle();
    const p = (data as Profile | null) ?? null;
    let rows: PermissionRow[] = [];
    if (p?.active && !p.is_external) {
      const r = await supabase.from("role_permissions").select("role, permission, allowed").eq("role", p.role);
      rows = r.error ? DEFAULT_ROWS : ((r.data ?? []) as PermissionRow[]);
    }
    if (run !== seq.current) return;
    if (error) loadedFor.current = null;
    setSession(s);
    setProfile(p);
    setProfileError(error ? error.message : null);
    setPerms(permissionSet(rows, p?.active ? p.role : undefined));
    setLoading(false);
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Evita deadlock do supabase-js: nada de chamadas ao client direto no callback.
      setTimeout(() => loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const retry = useCallback(() => {
    getSupabase()
      .auth.getSession()
      .then(({ data }) => loadProfile(data.session, true));
  }, [loadProfile]);

  const signOut = async () => {
    await getSupabase().auth.signOut();
  };

  const can = useCallback((perm: Permission) => perms.has(perm), [perms]);

  return (
    <AuthContext.Provider value={{ loading, session, profile, profileError, can, retry, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
