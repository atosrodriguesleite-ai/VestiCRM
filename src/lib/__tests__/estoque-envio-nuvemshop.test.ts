// Guarda RN-053
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_TENTATIVAS_ESTOQUE,
  PECAS_POR_RODADA,
  INTERVALO_DA_REPESCA_MS,
  MS_ORCAMENTO_REPESCA_ESTOQUE,
  proximaTentativa,
} from "../nuvemshop-estoque-pendente";

/**
 * RN-053 · O envio de estoque para a Nuvemshop não se perde calado.
 *
 * O incidente que criou a regra (10/09/2026): Regata Quadrada Terracota GG com
 * 0 aqui e 41 na Nuvemshop, com o vínculo CERTO. Duas causas, as duas
 * silenciosas: a resposta do PUT era ignorada, e a chamada era solta (a Vercel
 * congela a função junto com a resposta, então o envio nem acontecia).
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("espera crescente entre as tentativas", () => {
  it("a primeira tentativa é perto (a causa comum é oscilação de segundos)", () => {
    const agora = new Date("2026-09-10T12:00:00Z");
    const q = proximaTentativa(0, agora)!;
    expect(q.getTime() - agora.getTime()).toBe(30_000);
  });

  it("cada tentativa espera MAIS que a anterior", () => {
    const agora = new Date("2026-09-10T12:00:00Z");
    const esperas = Array.from({ length: MAX_TENTATIVAS_ESTOQUE }, (_, i) => {
      const q = proximaTentativa(i, agora)!;
      return q.getTime() - agora.getTime();
    });
    for (let i = 1; i < esperas.length; i++) {
      expect(esperas[i]).toBeGreaterThan(esperas[i - 1]);
    }
  });

  it("acabadas as tentativas devolve null — quem chama DESISTE, e a desistência aparece", () => {
    expect(proximaTentativa(MAX_TENTATIVAS_ESTOQUE)).toBeNull();
    expect(proximaTentativa(MAX_TENTATIVAS_ESTOQUE + 5)).toBeNull();
    // desistir é explícito: sai da fila, vira linha na Central e caso na Saúde
    const fila = ler("src/lib/nuvemshop-estoque-pendente.ts");
    expect(fila).toContain("nuvemshop.estoque-nao-enviado");
    expect(fila).toContain("logServerError");
  });

  it("a rodada cabe na vida da função (o PUT pode levar 15s)", () => {
    // orçamento menor que o teto da função, e teto de peças por rodada
    expect(MS_ORCAMENTO_REPESCA_ESTOQUE).toBeLessThanOrEqual(30_000);
    expect(PECAS_POR_RODADA).toBeGreaterThan(0);
    expect(INTERVALO_DA_REPESCA_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("o envio só sai da fila quando a Nuvemshop CONFIRMA", () => {
  const ns = ler("src/lib/nuvemshop.ts");

  it("a peça entra na fila ANTES da tentativa (função congelada deixa rastro)", () => {
    const trecho = ns.slice(ns.indexOf("export async function pushStockToNuvemshop"));
    const marca = trecho.indexOf("marcarEnvioPendente");
    const envio = trecho.indexOf("enviarEstoqueDaPeca(conn");
    expect(marca).toBeGreaterThan(-1);
    expect(envio).toBeGreaterThan(marca);
  });

  it("a resposta do PUT é OLHADA — recusa não passa como sucesso", () => {
    expect(ns).toContain("if (r.ok) return { ok: true }");
    expect(ns).toContain("A Nuvemshop recusou o envio");
    expect(ns).toContain("A Nuvemshop não respondeu");
  });

  it("sucesso limpa a fila; falha conta tentativa e agenda a próxima", () => {
    expect(ns).toContain("await confirmarEnvio(v.id)");
    expect(ns).toContain("registrarFalhaDeEnvio(companyId, v.id, r.motivo)");
    expect(ns).toContain("desistirDoEnvio(companyId, v.id, nomeDaPeca(v), r.motivo)");
  });

  it("loja desconectada NÃO perde a baixa: a peça fica na fila esperando a reconexão", () => {
    expect(ns).toContain("if (!conn) continue;");
  });
});

describe("a repesca pega carona no tráfego — nunca um 3º cron (ADR-002)", () => {
  const ns = ler("src/lib/nuvemshop.ts");
  const fila = ler("src/lib/nuvemshop-estoque-pendente.ts");

  it("a trava é ATÔMICA por loja (duas regiões no mesmo instante, só uma leva)", () => {
    expect(fila).toContain("db.company.updateMany");
    expect(fila).toContain("nsEstoqueRunAt");
    expect(fila).toContain("claimed.count > 0");
  });

  it("rodada quebrada DEVOLVE a trava (senão a loja ficava um minuto calada)", () => {
    expect(ns).toContain("devolverTravaDaRepesca(companyId, travaTomadaEm)");
  });

  it("o cron continua sendo só os dois diários", () => {
    const vercel = JSON.parse(ler("vercel.json"));
    expect((vercel.crons ?? []).length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(vercel.crons ?? [])).not.toContain("estoque");
  });

  it("a rodada só começa envio que cabe no que sobrou do relógio", () => {
    expect(ns).toContain("MS_ORCAMENTO_REPESCA_ESTOQUE");
    expect(ns).toContain("if (Date.now() + 15_000 > limite) break;");
  });
});

describe("nenhuma chamada solta sobrou: o espelho vai pelo after() do Next", () => {
  const arquivos = [
    "src/app/api/catalog/order/route.ts",
    "src/app/api/orders/route.ts",
    "src/app/api/orders/[id]/route.ts",
    "src/app/api/producao/costura/lancar/route.ts",
    "src/app/api/producao/costura/[id]/route.ts",
    "src/lib/order-actions.ts",
    "src/lib/producao-estoque.ts",
    "src/lib/settle-order.ts",
  ];

  it("ninguém mais chama pushStockToNuvemshop direto (a Vercel congelava junto com a resposta)", () => {
    for (const f of arquivos) {
      const texto = ler(f);
      expect(texto, f).not.toContain("pushStockToNuvemshop(");
      expect(texto, f).toContain("espelharEstoqueSemQuebrar(");
    }
  });

  it("o caminho único usa after() e tem plano B fora de requisição (script/teste)", () => {
    const ns = ler("src/lib/nuvemshop.ts");
    const trecho = ns.slice(ns.indexOf("export function espelharEstoqueSemQuebrar"));
    expect(trecho).toContain("after(trabalho)");
    expect(trecho).toContain("void trabalho()");
  });
});

describe("a divergência APARECE na tela, não só na conferência da integração", () => {
  it("o Inventário e a tela Produtos pintam o ⚠️ na própria linha", () => {
    expect(ler("src/app/(app)/estoque/inventario-view.tsx")).toContain("⚠️ enviando");
    expect(ler("src/app/(app)/produtos/products-view.tsx")).toContain("⚠️ enviando");
  });

  it("a linha diz o que fazer (o número é da Nuvemshop, mexer aqui não resolveria)", () => {
    expect(ler("src/app/(app)/estoque/inventario-view.tsx")).toContain(
      "ainda não foi confirmada pela Nuvemshop"
    );
  });
});
