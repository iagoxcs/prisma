"use client";

import Markdown, { type Components } from "react-markdown";

// Markdown sem HTML cru (sem rehype-raw): react-markdown já ignora HTML e saneia URLs.
// Imagens viram link, para nada externo ser carregado inline.
export const MD_COMPONENTS: Components = {
  h1: ({ children }) => <h2 className="mt-6 text-xl font-semibold">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-5 text-lg font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 font-semibold">{children}</h4>,
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>,
  code: ({ children }) => <code className="num rounded bg-muted px-1 py-0.5 text-[0.8125rem]">{children}</code>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-md bg-muted p-3 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  hr: () => <hr className="border-border" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" ? (
      <a href={src} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
        {alt || "imagem"}
      </a>
    ) : null,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-3 py-2 font-medium text-muted-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2">{children}</td>,
};

export function MarkdownView({ children }: { children: string }) {
  return <Markdown components={MD_COMPONENTS}>{children}</Markdown>;
}
