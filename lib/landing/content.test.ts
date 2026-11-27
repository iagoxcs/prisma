import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";
import * as content from "@/lib/landing/content";
import {
  discordGuide,
  discordVideos,
  posterSrc,
  prismaVideos,
  toolCategories,
  tools,
  videoSrc,
} from "@/lib/landing/content";

const PUBLIC_DIR = join(process.cwd(), "public");
const VIDEOS_DIR = join(PUBLIC_DIR, "onboarding", "videos");
const MB = 1024 * 1024;

const allVideos = [...prismaVideos, discordGuide, ...discordVideos];

/** Todas as strings do módulo, percorrendo objetos e listas. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

describe("vídeos", () => {
  it("tem 8 vídeos do Prisma, 1 guia e 5 pílulas do Discord", () => {
    expect(prismaVideos).toHaveLength(8);
    expect(discordGuide.file).toBe("discord_video_completo");
    expect(discordVideos).toHaveLength(5);
  });

  it("ids e arquivos são únicos", () => {
    const ids = allVideos.map((v) => v.id);
    const files = allVideos.map((v) => v.file);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(files).size).toBe(files.length);
  });

  it("cada vídeo tem o .mp4 e o pôster .jpg em public/onboarding", () => {
    for (const v of allVideos) {
      expect(existsSync(join(PUBLIC_DIR, videoSrc(v.file))), videoSrc(v.file)).toBe(true);
      expect(existsSync(join(PUBLIC_DIR, posterSrc(v.file))), posterSrc(v.file)).toBe(true);
    }
  });

  it("deriva os caminhos públicos do nome do arquivo", () => {
    expect(videoSrc("x")).toBe("/onboarding/videos/x.mp4");
    expect(posterSrc("x")).toBe("/onboarding/posters/x.jpg");
  });

  it("duração no formato mm:ss", () => {
    for (const v of allVideos) expect(v.duration, v.id).toMatch(/^\d{2}:[0-5]\d$/);
  });

  it("ícones dos vídeos do Prisma existem no lucide-react", () => {
    for (const v of prismaVideos) expect(lucide[v.icon as keyof typeof lucide], v.icon).toBeDefined();
  });

  it("nenhum vídeo acima de 6 MB e a pasta abaixo de 40 MB", () => {
    let total = 0;
    for (const name of readdirSync(VIDEOS_DIR)) {
      const size = statSync(join(VIDEOS_DIR, name)).size;
      expect(size, name).toBeLessThanOrEqual(6 * MB);
      total += size;
    }
    expect(total).toBeLessThan(40 * MB);
  });
});

describe("ferramentas", () => {
  it("tem 8 ferramentas em 5 categorias", () => {
    expect(tools).toHaveLength(8);
    expect(toolCategories).toHaveLength(5);
    expect(new Set(tools.map((t) => t.category)).size).toBe(5);
  });

  it("ids únicos e toda ferramenta pertence a uma categoria declarada", () => {
    const ids = tools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(toolCategories.map((c) => c.id));
    for (const t of tools) expect(categories.has(t.category), t.id).toBe(true);
  });

  it("todo href não nulo começa com https://", () => {
    for (const t of tools) if (t.href !== null) expect(t.href, t.id).toMatch(/^https:\/\//);
  });

  it("o Discord abre https://discord.com/app", () => {
    expect(tools.find((t) => t.id === "discord")?.href).toBe("https://discord.com/app");
  });
});

describe("conteúdo", () => {
  const text = collectStrings(content).join("\n").toLowerCase();

  it('sem credenciais nem itens removidos ("senha:", "password", "redmine", "organograma")', () => {
    for (const term of ["senha:", "password", "redmine", "organograma"]) expect(text).not.toContain(term);
  });
});
