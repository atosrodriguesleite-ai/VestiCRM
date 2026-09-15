import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config mínima, com UM motivo: o `tsconfig.json` do Next usa
 * `jsx: "preserve"` (o compilador do Next faz a transformação depois), e com
 * isso o Vitest não consegue ler um teste `.tsx`. Sem ela não existe teste de
 * componente — e foi exatamente um defeito de componente (o menu que nunca
 * ficava visível) que a revisão de 15/09/2026 pegou e nenhum teste alcançava.
 *
 * `oxc.jsx: "automatic"` liga o JSX; o alias `@/…` vem junto porque ter um
 * arquivo de config desliga o atalho que o Vitest usava sozinho, e sem ele os
 * componentes não achariam os próprios imports. Nada mais é configurado.
 */
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
