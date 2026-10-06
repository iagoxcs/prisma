import type { Metadata, Viewport } from "next";
import { Red_Hat_Display, Red_Hat_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { StrataBackdrop } from "@/components/brand/strata-backdrop";
import { THEME_INIT_SCRIPT } from "@/lib/theme/theme";
import "./globals.css";

const redHat = Red_Hat_Display({
  variable: "--font-red-hat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const redHatMono = Red_Hat_Mono({
  variable: "--font-red-hat-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prisma · Gerenciador de Projetos",
  description: "Gerenciador de Projetos Ambtech",
  robots: { index: false, follow: false }, // ferramenta interna
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#dce8f2" },
    { media: "(prefers-color-scheme: dark)", color: "#081a2e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: a classe .dark é aplicada pelo script abaixo antes da hidratação
    <html lang="pt-BR" className={`${redHat.variable} ${redHatMono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Aplica o tema antes do primeiro paint (export estático, sem SSR de tema) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <StrataBackdrop />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
