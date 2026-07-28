import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as reservas from "../reservations";

/**
 * A RESERVA NÃO TEM PRAZO.
 *
 * Regra nova da loja: montou o orçamento, a peça está segurada; ela só volta
 * ao estoque quando a vendedora CANCELA o pedido. A soltura automática em 48h
 * foi removida — no atacado a cliente pede na terça e paga na sexta, e a peça
 * não pode voltar para a prateleira no meio do caminho.
 *
 * Este teste é a trava: se alguém reintroduzir qualquer expiração por tempo,
 * quebra aqui.
 */

const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("nada solta reserva por tempo", () => {
  it("o motor de reservas não expõe soltura automática", () => {
    expect("releaseExpiredReservations" in reservas).toBe(false);
    expect(Object.keys(reservas).sort()).toEqual([
      "reservarEstoque",
      "reservarOQueTiver",
      "textoDaFalta",
    ]);
  });

  it("o arquivo não tem mais janela de horas nenhuma", () => {
    const fonte = ler("src/lib/reservations.ts");
    expect(fonte).not.toMatch(/RESERVA_HORAS|48\s*\*\s*60|expirad/i);
    expect(fonte).toContain("NÃO TEM PRAZO");
  });

  it("o cron diário não solta mais reserva", () => {
    const cron = ler("src/app/api/cron/jueri-sync/route.ts");
    expect(cron).not.toMatch(/reserva/i);
  });

  it("o endpoint de soltura foi removido", () => {
    expect(existsSync(join(raiz, "src/app/api/cron/release-reservations"))).toBe(false);
  });

  it("o vercel.json não agenda soltura de reserva", () => {
    const vercel = ler("vercel.json");
    expect(vercel).not.toContain("release-reservations");
  });
});

describe("a peça volta APENAS no cancelamento", () => {
  const rota = ler("src/app/api/orders/[id]/route.ts");

  it("devolver estoque está amarrado a sair dos status que seguram peça", () => {
    expect(rota).toContain("needStockReturn");
    expect(rota).toContain("Cancelamento do pedido");
  });

  it("a tela do pedido avisa que as peças estão seguradas sem prazo", () => {
    const tela = ler("src/app/(app)/pedidos/[id]/page.tsx");
    expect(tela).toContain("reservadas");
    expect(tela).toContain("não têm prazo");
    expect(tela).toContain("cancele o pedido");
  });
});
