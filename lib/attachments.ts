import { getSupabase } from "@/lib/supabase/client";

// Sempre download (RNF-04): URL assinada de 60s com Content-Disposition: attachment.
// Devolve a mensagem de erro, ou null quando o download começou.
export async function downloadFile(bucket: string, path: string, fileName: string): Promise<string | null> {
  const { data, error } = await getSupabase().storage.from(bucket).createSignedUrl(path, 60, { download: fileName });
  if (error || !data) return error?.message ?? "Falha ao gerar o link.";
  window.location.assign(data.signedUrl);
  return null;
}

// 1536 → "2 KB"; 3_500_000 → "3.3 MB"
export function formatSize(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Baixa um texto gerado no navegador (ex.: planilha de fases do modelo). Sempre download, nunca inline.
export function saveText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
}
