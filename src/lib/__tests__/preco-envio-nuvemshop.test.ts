// Guarda RN-057
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * RN-057 · O PREÇO DE VAREJO DA PEÇA NUVEMSHOP TAMBÉM SE MUDA AQUI, E VAI
 * PARA LÁ — a fila pelo COMPORTAMENTO (banco fingido), na mesma régua da
 * fila de estoque (RN-053): nasce antes, sai só confirmada, sucesso com
 * número velho não é sucesso, desistir é explícito e uma vez por rodada.
 */
type Linha = { companyId: string; productId: string; tentativas: number; proximaEm: Date | null; ultimoErro: string | null };
const fila = new Map<string, Linha>();
const precos = new Map<string, number>();
const commEvents: { type: string; error?: string }[] = [];
const errosDeSaude: { message: string }[] = [];

const casa = (l: Linha, where: Record<string, unknown>) => {
  if (where.companyId !== undefined && l.companyId !== where.companyId) return false;
  const pid = where.productId as string | { in: string[] } | undefined;
  if (typeof pid === "string" && l.productId !== pid) return false;
  if (pid && typeof pid === "object" && !pid.in.includes(l.productId)) return false;
  if (where.proximaEm === null && l.proximaEm !== null) return false;
  const p = where.proximaEm as { not?: null; lte?: Date } | undefined;
  if (p && "not" in p && p.not === null && l.proximaEm === null) return false;
  if (p && "lte" in p && !(l.proximaEm && l.proximaEm <= p.lte!)) return false;
  return true;
};

vi.mock("../db", () => ({
  db: {
    nuvemshopPrecoPendente: {
      async findUnique({ where }: { where: { productId: string } }) {
        return fila.get(where.productId) ?? null;
      },
      async upsert({ where, create, update }: { where: { productId: string }; create: Linha; update: Partial<Linha> }) {
        const atual = fila.get(where.productId);
        fila.set(where.productId, atual ? { ...atual, ...update } : { ...create, ultimoErro: create.ultimoErro ?? null });
        return fila.get(where.productId);
      },
      async createMany({ data }: { data: Linha[] }) {
        let n = 0;
        for (const d of data) if (!fila.has(d.productId)) { fila.set(d.productId, { ...d, ultimoErro: d.ultimoErro ?? null }); n++; }
        return { count: n };
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<Linha> }) {
        let n = 0;
        for (const l of fila.values()) if (casa(l, where)) { Object.assign(l, data); n++; }
        return { count: n };
      },
      async deleteMany({ where }: { where: { productId: string } }) {
        fila.delete(where.productId);
        return { count: 1 };
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return [...fila.values()].filter((l) => casa(l, where));
      },
    },
    product: {
      async findUnique({ where }: { where: { id: string } }) {
        return precos.has(where.id) ? { retailPrice: precos.get(where.id) } : null;
      },
    },
    commEvent: { async create({ data }: { data: { type: string; error?: string } }) { commEvents.push(data); } },
  },
}));
vi.mock("../health", () => ({
  logServerError: async (i: { message: string }) => { errosDeSaude.push(i); },
}));

import { MAX_TENTATIVAS_ESTOQUE } from "../nuvemshop-estoque-pendente";
import { decidirVarejoParaNuvemshop } from "../estoque/dono-do-estoque";
import {
  confirmarEnvioDePreco,
  desistirDoEnvioDePreco,
  estadoDoPrecoPorProduto,
  marcarPrecoPendente,
  precoPendentePorProduto,
  produtosParaRepescarPreco,
  registrarFalhaDePreco,
} from "../nuvemshop-preco-pendente";

const LOJA = "loja-1";
const PECA = "prod-1";

beforeEach(() => {
  fila.clear();
  precos.clear();
  commEvents.length = 0;
  errosDeSaude.length = 0;
  precos.set(PECA, 18.9);
});

/** Uma tentativa que falhou, do jeito que o envio faz (a peça JÁ está na fila). */
async function falhar(motivo = "A Nuvemshop recusou o envio (código 401)") {
  const temMais = await registrarFalhaDePreco(LOJA, PECA, motivo);
  if (!temMais) await desistirDoEnvioDePreco(LOJA, PECA, "Blusa Tule", motivo);
}

describe("RN-057: a fila do preço", () => {
  it("nasce ANTES da tentativa, por loja, com zero tentativas — e não empilha", async () => {
    await marcarPrecoPendente(LOJA, [PECA]);
    await marcarPrecoPendente(LOJA, [PECA]);
    expect(fila.size).toBe(1);
    expect(fila.get(PECA)).toMatchObject({ companyId: LOJA, tentativas: 0 });
    expect(fila.get(PECA)!.proximaEm).toBeInstanceOf(Date);
  });

  it("confirmação só tira da fila quando o que chegou lá é o preço de AGORA", async () => {
    await marcarPrecoPendente(LOJA, [PECA]);
    await confirmarEnvioDePreco(PECA, 17.5); // outro reajuste mudou o número no meio do PUT
    expect(fila.has(PECA)).toBe(true);
    await confirmarEnvioDePreco(PECA, 18.9);
    expect(fila.has(PECA)).toBe(false);
  });

  it("falha conta tentativa, afasta a próxima e guarda o motivo", async () => {
    await marcarPrecoPendente(LOJA, [PECA]);
    await falhar();
    expect(fila.get(PECA)).toMatchObject({ tentativas: 1, ultimoErro: expect.stringContaining("401") });
    expect(fila.get(PECA)!.proximaEm!.getTime()).toBeGreaterThan(Date.now());
  });

  it("acabadas as tentativas: para (sem data), avisa UMA vez na Central e na Saúde, e a linha FICA", async () => {
    await marcarPrecoPendente(LOJA, [PECA]);
    for (let i = 0; i < MAX_TENTATIVAS_ESTOQUE + 2; i++) await falhar();
    expect(fila.get(PECA)!.proximaEm).toBeNull();
    expect(commEvents.filter((e) => e.type === "nuvemshop.preco-nao-enviado")).toHaveLength(1);
    expect(errosDeSaude).toHaveLength(1);
    expect(errosDeSaude[0].message).toContain("Blusa Tule");
    // a ficha continua avisando — e diz que FALHOU, com o motivo (não "enviando")
    expect(await precoPendentePorProduto(LOJA, [PECA])).toEqual(new Set([PECA]));
    expect((await estadoDoPrecoPorProduto(LOJA, [PECA])).get(PECA)).toEqual({ estado: "falhou", motivo: expect.stringContaining("401") });
    expect(await produtosParaRepescarPreco(LOJA)).toEqual([]);
  });

  it("mudar o preço de novo REABRE a rodada de quem desistiu", async () => {
    await marcarPrecoPendente(LOJA, [PECA]);
    for (let i = 0; i < MAX_TENTATIVAS_ESTOQUE + 1; i++) await falhar();
    expect(fila.get(PECA)!.proximaEm).toBeNull();
    await marcarPrecoPendente(LOJA, [PECA]);
    expect(fila.get(PECA)).toMatchObject({ tentativas: 0 });
    expect(fila.get(PECA)!.proximaEm).toBeInstanceOf(Date);
  });

  it("enquanto tenta, a ficha diz 'enviando'", async () => {
    await marcarPrecoPendente(LOJA, [PECA]);
    expect((await estadoDoPrecoPorProduto(LOJA, [PECA])).get(PECA)).toEqual({ estado: "enviando", motivo: null });
  });

  it("o pendente é por LOJA: outra loja não vê a fila desta", async () => {
    await marcarPrecoPendente(LOJA, [PECA]);
    expect(await precoPendentePorProduto("outra-loja", [PECA])).toEqual(new Set());
  });
});

describe("RN-057: quem grava o varejo manda para a Nuvemshop, e a sync não passa por cima", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("o reajuste em lote marca a fila DENTRO da transação e espelha DEPOIS do commit", () => {
    const lib = ler("src/lib/reajuste-preco.ts");
    const aplicar = lib.slice(lib.indexOf("export async function aplicarReajuste"));
    const marca = aplicar.indexOf("marcarPrecoPendente(companyId, paraEspelhar, tx)");
    const commit = aplicar.indexOf("{ timeout: 30_000, maxWait: 10_000 }");
    const espelha = aplicar.indexOf("espelharPrecoSemQuebrar(companyId, paraEspelhar)");
    expect(marca).toBeGreaterThan(0);
    expect(commit).toBeGreaterThan(marca);
    expect(espelha).toBeGreaterThan(commit);
  });

  it("a ficha só manda quando o varejo de fato MUDOU, nunca zero, e nada em peça sem Nuvemshop", () => {
    const ns = { espelhaVarejo: "NUVEMSHOP" as const };
    expect(decidirVarejoParaNuvemshop(ns, undefined, 18.9)).toBe("nada"); // a pessoa não mexeu
    expect(decidirVarejoParaNuvemshop(ns, 18.9, 18.9)).toBe("nada"); // mesmo número
    expect(decidirVarejoParaNuvemshop(ns, 18.904, 18.9)).toBe("nada"); // diferença de arredondamento
    expect(decidirVarejoParaNuvemshop(ns, 21.5, 18.9)).toBe("manda");
    expect(decidirVarejoParaNuvemshop(ns, 0, 18.9)).toBe("recusa-zero");
    expect(decidirVarejoParaNuvemshop({ espelhaVarejo: null }, 21.5, 18.9)).toBe("nada");
    expect(decidirVarejoParaNuvemshop({ espelhaVarejo: null }, 0, 18.9)).toBe("nada"); // peça nossa zera se quiser
    // e a rota obedece à decisão nas duas pontas: fila na transação, espelho depois
    const rota = ler("src/app/api/products/[id]/route.ts");
    expect(rota).toContain('if (decisaoVarejo === "recusa-zero")');
    expect(rota).toContain("if (varejoVaiParaNuvemshop) await marcarPrecoPendente(user.companyId, [product.id], tx);");
    expect(rota).toContain("if (varejoVaiParaNuvemshop) espelharPrecoSemQuebrar(user.companyId, [product.id]);");
  });

  it("a ficha só manda o varejo EDITADO em peça Nuvemshop (o carregado empurraria preço velho para lá)", () => {
    const tela = ler("src/app/(app)/produtos/products-view.tsx");
    expect(tela).toContain("product.precoDono.espelhaVarejo && Math.abs(num(form.retailPrice) - product.retailPrice) < 0.005");
  });

  it("a sync da Nuvemshop NÃO escreve o varejo de lá em produto com preço a caminho", () => {
    const ns = ler("src/lib/nuvemshop.ts");
    expect(ns).toContain("!precosPendentes.has(alvo.product.id)");
    // e o envio manda o preço como texto com duas casas, por variação vinculada
    expect(ns).toContain("price: preco.toFixed(2)");
    // a repesca de preço roda na MESMA rodada e trava da de estoque (nunca um 3º cron)
    expect(ns).toContain("await repescarPrecos(companyId, conn, limite)");
    expect(ns).not.toContain("nsPrecoRunAt");
  });

  it("ninguém chama pushPriceToNuvemshop direto (a Vercel congelava junto com a resposta)", () => {
    const culpados: string[] = [];
    const varrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__") varrer(f);
        } else if (/\.tsx?$/.test(e.name) && readFileSync(f, "utf8").includes("pushPriceToNuvemshop(")) {
          culpados.push(f.replace(process.cwd() + "/", ""));
        }
      }
    };
    varrer(join(process.cwd(), "src"));
    expect(culpados).toEqual(["src/lib/nuvemshop.ts"]);
  });

  it("a fila pega carona onde a lojista olha o ⏳: tela Produtos e a porta do reajuste", () => {
    expect(ler("src/app/(app)/produtos/page.tsx")).toContain("after(() => varrerEnviosDeEstoqueSeDevido(user.companyId));");
    expect(ler("src/app/api/products/reajuste/route.ts")).toContain("after(() => varrerEnviosDeEstoqueSeDevido(user.companyId));");
  });
});
