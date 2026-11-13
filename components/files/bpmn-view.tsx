"use client";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import { useEffect, useRef, useState } from "react";
import { MSG_ERROR } from "@/lib/ui";

// Visualizador BPMN (bpmn-js NavigatedViewer): só leitura, com zoom e arrasto. Cores tiradas dos tokens do
// tema, porque o bpmn-js desenha em SVG com cores próprias.
export default function BpmnView({ xml }: { xml: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let viewer: { destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const { default: NavigatedViewer } = await import("bpmn-js/lib/NavigatedViewer");
      if (cancelled || !ref.current) return;
      const css = getComputedStyle(document.documentElement);
      const token = (n: string) => css.getPropertyValue(n).trim();
      const v = new NavigatedViewer({
        container: ref.current,
        bpmnRenderer: { defaultFillColor: token("--card") || undefined, defaultStrokeColor: token("--foreground") || undefined },
        textRenderer: { defaultStyle: { fontFamily: "Red Hat Display, system-ui, sans-serif", fontSize: 12 } },
      } as ConstructorParameters<typeof NavigatedViewer>[0]);
      viewer = v;
      try {
        const { warnings } = await v.importXML(xml);
        if (cancelled) return;
        (v.get("canvas") as { zoom: (z: string) => void }).zoom("fit-viewport");
        if (warnings.length) setError(`O diagrama abriu com ${warnings.length} aviso(s) de notação.`);
      } catch {
        if (!cancelled) setError("Não foi possível desenhar o diagrama: o arquivo não tem a parte gráfica (DI) ou não é BPMN 2.0 válido.");
      }
    })();
    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [xml]);

  return (
    <div className="space-y-2">
      <div ref={ref} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-border bg-card" />
      <p className="text-[0.8125rem] text-muted-foreground">Arraste para mover; use a roda do mouse (ou pinça) para aproximar.</p>
      {error && <p role="alert" className={MSG_ERROR}>{error}</p>}
    </div>
  );
}
