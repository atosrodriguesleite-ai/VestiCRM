import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O AVISO DE VENDA NO CELULAR (relato do dono, 11/09/2026: "marquei como
 * pago e não recebi a notificação"). Duas promessas:
 *  1. o envio vai no `after()` — chamada solta era congelada pela Vercel
 *     junto com a resposta, e o aviso se perdia de vez em quando;
 *  2. QUALQUER status pago conta como pago (RN-001), vindo de um não pago.
 */
const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("o aviso de venda paga não se perde", () => {
  it("o envio roda dentro do after() do Next", () => {
    const push = ler("src/lib/push.ts");
    const f = push.slice(push.indexOf("export function avisarVendaPagaSemQuebrar"));
    expect(f).toMatch(/after\(\(\) =>\s*notifySalePaid\(companyId, order\)/);
  });

  it("nenhuma porta chama o envio solto: todas passam pelo after()", () => {
    for (const p of [
      "src/app/api/orders/[id]/route.ts",
      "src/lib/settle-order.ts",
      "src/lib/nuvemshop.ts",
    ]) {
      const s = ler(p);
      expect(s, p).toContain("avisarVendaPagaSemQuebrar(");
      expect(s, p).not.toContain("notifySalePaid(");
    }
  });

  it("marcar pago em QUALQUER status pago avisa — e só ao ENTRAR no pago", () => {
    const rota = ler("src/app/api/orders/[id]/route.ts");
    expect(rota).toContain("const PAID_STATUSES = new Set<string>(PAID_ORDER_STATUSES);");
    expect(rota).toMatch(
      /const enteringPaid =\s*willChangeStatus && PAID_STATUSES\.has\(newStatus!\) && !PAID_STATUSES\.has\(order\.status\);/
    );
    expect(rota).toMatch(/if \(enteringPaid\) \{[\s\S]{0,400}avisarVendaPagaSemQuebrar\(/);
  });
});
