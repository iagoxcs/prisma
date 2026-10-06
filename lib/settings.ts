// Parâmetros do sistema (tabela app_settings). Chaves e validação vivem no banco
// (trigger app_settings_before_update); aqui só os tipos e valores padrão da interface.

// Single-tenant: uma instância, uma organização. O nome é fixo na interface
// (não é parâmetro do banco; ver migração 20261006030000_identidade_visual).
export const ORG_NAME = "Ambiente Consultoria";

export interface AppSettings {
  deadline_warning_days: number;
  notify_due_soon: boolean;
  notify_overdue: boolean;
  default_categories: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  deadline_warning_days: 1,
  notify_due_soon: true,
  notify_overdue: true,
  default_categories: [],
};

export type SettingRow = { key: keyof AppSettings; value: unknown; updated_at: string; updated_by: string | null };

export function parseSettings(rows: SettingRow[]): AppSettings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as unknown as AppSettings;
}
