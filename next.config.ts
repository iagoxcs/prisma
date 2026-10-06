import type { NextConfig } from "next";

// Publicação no Netlify como site 100% estático (sem servidor Node).
// Toda a lógica de dados/segurança vive no Supabase (RLS + Edge Functions).
// Consequência: rotas dinâmicas usam query string (ex.: /projeto/?id=...), não [id].
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
