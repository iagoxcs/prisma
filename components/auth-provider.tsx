"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { DEFAULT_ROWS, permissionSet, type Permission, type PermissionRow } from "@/lib/permissions";
import { getSupabase } from "@/lib/supabase/client";
import type { Profile } from "@/types/domain";

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Capacidade do perfil (role_permissions). Só UX: o banco valida de novo via role_can(). */
  can: (perm: Permission) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [perms, setPerms] = useState<Set<Permission>>(() => new Set());

  useEffect(() => {
    const supabase = getSupabase();

    async function loadProfile(s: Session | null) {
      setSession(s);
      if (!s) {
        setProfile(null);
        setPerms(new Set());
        setLoading(false);
        return;
      }
      const { data } = await supabase
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
      setPerms(permissionSet(rows, p?.active ? p.role : undefined));
      setProfile(p);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Evita deadlock do supabase-js: nada de chamadas ao client direto no callback.
      setTimeout(() => loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await getSupabase().auth.signOut();
  };

  const can = useCallback((perm: Permission) => perms.has(perm), [perms]);

  return (
    <AuthContext.Provider value={{ loading, session, profile, can, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
