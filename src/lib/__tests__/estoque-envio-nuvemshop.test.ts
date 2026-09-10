// Guarda RN-053
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A FILA DO ENVIO DE ESTOQUE, pelo COMPORTAMENTO (banco fingido).
 *
 * O irmão deste arquivo (`estoque-envio-nuvemshop.test.ts`) varre o TEXTO do
 * código, e o próprio CLAUDE.md registra por que isso não basta (incidente de
 * 28/08/2026): guarda que descreve o CÓDIGO protege o erro em vez de impedi-lo
 * — trocar um `continue` por `break` passaria verde. Aqui a fila roda de
 * verdade sobre um banco de mentira, e o que se cobra é o que ela PROMETE:
 * envio recusado não some, sucesso com número velho não é dado por bom, o
 * alarme toca uma vez por rodada e a peça volta a ter chance.
 */

type Linha = {
  companyId: string;
  variantId: string;
  tentativas: number;
  proximaEm: Date | null;
  ultimoErro: string | null;
};

const fila = new Map<string, Linha>();
const estoque = new Map<string, number>();
const commEvents: { type: string; error?: string }[] = [];
const errosDeSaude: { message: string }[] = [];

const casa = (l: Linha, where: Record<string, unknown>) => {
  if (where.companyId !== undefined && l.companyId !== where.companyId) return false;
  if (where.variantId !== undefined && l.variantId !== where.variantId) return false;
  if (where.proximaEm === null && l.proximaEm !== null) return false;
  const p = where.proximaEm as { not?: null } | undefined;
  if (p && "not" in p && p.not === null && l.proximaEm === null) return false;
  return true;
};

vi.mock("../db", () => ({
  db: {
    nuvemshopEstoquePendente: {
      async findUnique({ where }: { where: { variantId: string } }) {
        return fila.get(where.variantId) ?? null;
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { variantId: string };
        create: Linha;
        update: Partial<Linha>;
      }) {
        const atual = fila.get(where.variantId);
        if (!atual) fila.set(where.variantId, { ...create });
        else fila.set(where.variantId, { ...atual, ...update });
        return fila.get(where.variantId);
      },
      async updateMany({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Linha>;
      }) {
        let count = 0;
        for (const [k, l] of fila) {
          if (!casa(l, where)) continue;
          fila.set(k, { ...l, ...data });
          count++;
        }
        return { count };
      },
      async deleteMany({ where }: { where: Record<string, unknown> }) {
        let count = 0;
        for (const [k, l] of [...fila]) {
          if (!casa(l, where)) continue;
          fila.delete(k);
          count++;
        }
        return { count };
      },
      async findMany({ where }: { where: { companyId: string } }) {
        return [...fila.values()].filter((l) => l.companyId === where.companyId);
      },
    },
    productVariant: {
      async findUnique({ where }: { where: { id: string } }) {
        const s = estoque.get(where.id);
        return s === undefined ? null : { stock: s };
      },
    },
    commEvent: {
      async create({ data }: { data: { type: string; error?: string } }) {
        commEvents.push(data);
        return data;
      },
    },
    errorLog: { async create() {} },
    systemHealth: { async updateMany() { return { count: 0 }; } },
    user: { async findFirst() { return null; } },
  },
}));

vi.mock("../health", () => ({
  logServerError: async (i: { message: string }) => {
    errosDeSaude.push(i);
  },
}));

import {
  INTERVALO_DA_REPESCA_MS,
  MAX_TENTATIVAS_ESTOQUE,
  MS_ORCAMENTO_REPESCA_ESTOQUE,
  PECAS_POR_RODADA,
  proximaTentativa,
  confirmarEnvio,
  desistirDoEnvio,
  envioPendentePorVariacao,
  marcarEnvioPendente,
  registrarFalhaDeEnvio,
} from "../nuvemshop-estoque-pendente";

const LOJA = "loja-1";
const PECA = "var-gg";

beforeEach(() => {
  fila.clear();
  estoque.clear();
  commEvents.length = 0;
  errosDeSaude.length = 0;
  estoque.set(PECA, 0);
});

/** Uma tentativa que falhou, do jeito que a rota faz. */
async function falhar(motivo = "A Nuvemshop recusou o envio (código 401)") {
  await marcarEnvioPendente(LOJA, PECA);
  const temMais = await registrarFalhaDeEnvio(LOJA, PECA, motivo);
  if (!temMais) await desistirDoEnvio(LOJA, PECA, "Regata Quadrada · Terracota GG", motivo);
  return temMais;
}

describe("envio recusado não some", () => {
  it("a peça fica na fila, com o motivo e a próxima tentativa marcada", async () => {
    await falhar();
    const l = fila.get(PECA)!;
    expect(l.tentativas).toBe(1);
    expect(l.proximaEm).not.toBeNull();
    expect(l.ultimoErro).toContain("recusou");
  });

  it("a venda seguinte da mesma peça ATUALIZA a linha, não empilha outra", async () => {
    await falhar();
    await falhar();
    expect(fila.size).toBe(1);
    expect(fila.get(PECA)!.tentativas).toBe(2);
  });
});

describe("sucesso só conta quando o que chegou lá é o que temos AQUI", () => {
  it("envio confirmado com o número atual limpa a fila", async () => {
    await falhar();
    await confirmarEnvio(PECA, 0);
    expect(fila.has(PECA)).toBe(false);
  });

  it("número que mudou no meio do envio NÃO é dado por bom — a peça continua na fila", async () => {
    await falhar();
    // outra venda entrou entre a leitura e o PUT: mandamos 0, hoje é 4
    estoque.set(PECA, 4);
    await confirmarEnvio(PECA, 0);
    expect(fila.has(PECA)).toBe(true);
  });

  it("peça que sumiu do cadastro não engana a conferência", async () => {
    await falhar();
    estoque.delete(PECA);
    await confirmarEnvio(PECA, 0);
    expect(fila.has(PECA)).toBe(true);
  });
});

describe("desistir avisa uma vez, mantém o ⚠️ e devolve a chance", () => {
  async function esgotar() {
    for (let i = 0; i < MAX_TENTATIVAS_ESTOQUE + 1; i++) {
      const temMais = await falhar();
      if (!temMais) break;
      // a espera venceu (é o que a repesca enxerga)
      fila.set(PECA, { ...fila.get(PECA)!, proximaEm: new Date(0) });
    }
  }

  it("acabadas as tentativas, para de tentar mas o aviso CONTINUA na tela", async () => {
    await esgotar();
    const l = fila.get(PECA)!;
    expect(l.proximaEm).toBeNull(); // a repesca nunca mais pega
    const comAviso = await envioPendentePorVariacao(LOJA, [PECA]);
    expect(comAviso.has(PECA)).toBe(true); // …mas a lojista continua vendo
  });

  it("o alarme toca UMA vez, não a cada venda daquela peça", async () => {
    await esgotar();
    const depoisDeEsgotar = commEvents.length;
    await falhar();
    await falhar();
    expect(depoisDeEsgotar).toBe(1);
    expect(commEvents.length).toBe(1);
    expect(errosDeSaude).toHaveLength(1);
    expect(errosDeSaude[0].message).toContain("Regata Quadrada");
  });

  it("movimento novo REABRE a rodada (token renovado tem que voltar a funcionar)", async () => {
    await esgotar();
    expect(fila.get(PECA)!.proximaEm).toBeNull();
    await marcarEnvioPendente(LOJA, PECA);
    const l = fila.get(PECA)!;
    expect(l.tentativas).toBe(0);
    expect(l.proximaEm).not.toBeNull();
  });

  it("e o envio que enfim dá certo limpa o aviso", async () => {
    await esgotar();
    await confirmarEnvio(PECA, 0);
    expect(fila.has(PECA)).toBe(false);
  });
});

describe("isolamento entre lojas (RN-013)", () => {
  it("a fila de uma loja nunca aparece para outra", async () => {
    await falhar();
    expect((await envioPendentePorVariacao(LOJA, [PECA])).has(PECA)).toBe(true);
    expect((await envioPendentePorVariacao("outra-loja", [PECA])).size).toBe(0);
  });

  it("desistir de peça de outra loja não mexe na linha desta", async () => {
    await falhar();
    await desistirDoEnvio("outra-loja", PECA, "Peça", "erro");
    expect(fila.get(PECA)!.proximaEm).not.toBeNull();
    expect(commEvents).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------
   Abaixo, as travas de ARQUIVO: o que não dá para provar rodando (as 8
   chamadas migradas para o `after()`, o cron que não nasceu, o ⚠️ nas
   telas). Elas não substituem os testes de comportamento acima — o
   CLAUDE.md registra o incidente de 28/08/2026, em que um guarda de texto
   protegeu o erro em vez de impedi-lo.
   --------------------------------------------------------------------- */

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

  it("desistir NÃO apaga a linha (o ⚠️ some justo na peça que ficou divergente)", () => {
    const fila = ler("src/lib/nuvemshop-estoque-pendente.ts");
    const trecho = fila.slice(fila.indexOf("export async function desistirDoEnvio"));
    expect(trecho).not.toContain("deleteMany");
    expect(trecho).toContain("proximaEm: null");
    // e o alarme toca uma vez por rodada, não a cada venda daquela peça
    expect(trecho).toContain("proximaEm: { not: null }");
    expect(trecho).toContain("if (parou.count === 0) return;");
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

  it("o estoque é RELIDO na hora do envio, e o sucesso é conferido contra ele", () => {
    // (o efeito disso está provado nos testes de comportamento acima; aqui
    // só se tranca que os DOIS caminhos — push e repesca — passam o número
    // enviado para a confirmação, que é o que a torna condicional)
    expect(ns).toContain("await confirmarEnvio(v.id, agora.stock)");
    expect(ns).toContain("await confirmarEnvio(v.id, v.stock)");
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
