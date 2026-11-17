import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes das funções puras de lib/. Os *.test.ts não são importados por nenhuma página,
// então não entram no build estático (out/).
export default defineConfig({
  resolve: {
    // Mesmo alias do tsconfig.json ("@/*" → "./*").
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
