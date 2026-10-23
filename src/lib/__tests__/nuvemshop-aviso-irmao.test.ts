import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { criarVendaDaNuvemshopUmaVez } from "../nuvemshop-aviso-irmao";
import { comNumeroUnico } from "../numero-do-pedido";

/**
 * A venda da Nuvemshop chega em avisos irmãos (paid + updated, no mesmo
 * segundo). O irmão que chega depois NÃO é erro: espera na fila, encontra o
 * pedido pronto e o devolve. Complementa a RN-014 (guardada por
 * `nuvemshop-conferencia.test.ts`): uma venda, uma vez — e qualquer OUTRO
 * erro continua subindo, para a Nuvemshop reenviar.
 *
 * A porta é fingida: o que se cobra é a ORDEM (trava → "já existe?" → criar)
 * e as decisões, não o texto do código.
 */

const p2002 = (target: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "x",
    meta: { target },
  });

type Pedido = { id: string };
type Tx = { nome: "tx" };
const tx: Tx = { nome: "tx" };

function porta(opts: {
  existente?: Pedido | null;
  existenteFora?: Pedido | null;
  criar?: () => Promise<Pedido>;
  relerFalha?: boolean;
}) {
  const passos: string[] = [];
  const p = {
    emTransacao: async <R>(fn: (t: Tx) => Promise<R>) => {
      passos.push("abre");
      try {
        return await fn(tx);
      } finally {
        passos.push("fecha");
      }
    },
    travar: vi.fn(async () => {
      passos.push("trava");
    }),
    relerExistente: vi.fn(async (t: Tx | null) => {
      passos.push(t ? "rele-dentro" : "rele-fora");
      if (opts.relerFalha && !t) throw new Error("conexão caiu");
      return t ? (opts.existente ?? null) : (opts.existenteFora ?? null);
    }),
    criar: vi.fn(async () => {
      passos.push("cria");
      return opts.criar ? opts.criar() : { id: "novo" };
    }),
  };
  return { p, passos };
}

describe("o primeiro aviso cria", () => {
  it("trava, confere que não existe, cria — tudo dentro da transação", async () => {
    const { p, passos } = porta({});
    const r = await criarVendaDaNuvemshopUmaVez(p);
    expect(r).toEqual({ pedido: { id: "novo" }, criadoPeloIrmao: false });
    expect(passos).toEqual(["abre", "trava", "rele-dentro", "cria", "fecha"]);
  });
});

describe("o aviso irmão que chega depois", () => {
  it("espera na fila, encontra o pedido do irmão e NÃO cria nada", async () => {
    const { p, passos } = porta({ existente: { id: "do-irmao" } });
    const r = await criarVendaDaNuvemshopUmaVez(p);
    expect(r).toEqual({ pedido: { id: "do-irmao" }, criadoPeloIrmao: true });
    expect(p.criar).not.toHaveBeenCalled();
    expect(passos).toEqual(["abre", "trava", "rele-dentro", "fecha"]);
  });

  it("a criação barrou em QUALQUER índice (opportunityId do carrinho, por exemplo): o pedido existe, então é do irmão", async () => {
    const { p } = porta({
      existenteFora: { id: "do-irmao" },
      criar: async () => {
        throw p2002(["opportunityId"]);
      },
    });
    const r = await criarVendaDaNuvemshopUmaVez(p);
    expect(r).toEqual({ pedido: { id: "do-irmao" }, criadoPeloIrmao: true });
  });
});

describe("o que continua sendo erro (a Nuvemshop reenvia)", () => {
  it("barrou e o pedido NÃO existe: o erro original sobe", async () => {
    const erro = p2002(["companyId", "nuvemshopId"]);
    const { p } = porta({
      criar: async () => {
        throw erro;
      },
    });
    await expect(criarVendaDaNuvemshopUmaVez(p)).rejects.toBe(erro);
  });

  it("a releitura de fora falhou: sobe o erro ORIGINAL, não o da releitura", async () => {
    const erro = new Error("banco recusou o insert");
    const { p } = porta({
      relerFalha: true,
      criar: async () => {
        throw erro;
      },
    });
    await expect(criarVendaDaNuvemshopUmaVez(p)).rejects.toBe(erro);
  });

  it("a corrida de NÚMERO com o pedido do painel segue na régua dela: comNumeroUnico insiste e a segunda vez cria", async () => {
    let vez = 0;
    const { p } = porta({
      criar: async () => {
        vez += 1;
        if (vez === 1) throw p2002(["companyId", "number"]);
        return { id: "na-segunda" };
      },
    });
    const r = await comNumeroUnico(() => criarVendaDaNuvemshopUmaVez(p));
    expect(r).toEqual({ pedido: { id: "na-segunda" }, criadoPeloIrmao: false });
    expect(p.travar).toHaveBeenCalledTimes(2); // cada tentativa é uma transação nova, com a trava
    // a corrida de número não relê de fora: sob a trava, o pedido deste id não existe
    expect(
      p.relerExistente.mock.calls.filter(([t]) => t === null),
    ).toHaveLength(0);
  });
});

describe("a ingestão da venda da Nuvemshop usa a fila", () => {
  it("ingestPaidOrder cria pela porta e, quando o irmão criou, devolve ANTES de qualquer pós-venda", () => {
    const fonte = readFileSync(
      join(process.cwd(), "src/lib/nuvemshop.ts"),
      "utf8",
    );
    const inicio = fonte.indexOf("export async function ingestPaidOrder(");
    const corpo = fonte.slice(inicio, fonte.indexOf("\nexport ", inicio + 1));
    const porta = corpo.indexOf("criarVendaDaNuvemshopUmaVez(");
    const volta = corpo.indexOf("if (criadoPeloIrmao) return order;");
    const posVenda = corpo.indexOf("db.customerEvent.create(");
    expect(porta).toBeGreaterThan(0);
    expect(volta).toBeGreaterThan(porta);
    expect(posVenda).toBeGreaterThan(volta);
    // a cliente sem telefone nasce DENTRO da fila (tx), nunca antes dela
    expect(corpo).toContain("tx.customer.create(");
    expect(corpo).not.toContain("db.customer.create(");
  });
});
