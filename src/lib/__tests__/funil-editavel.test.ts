// Guarda RN-091
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { naEtapaViva } from "../funil/etapa-viva";
import { join } from "node:path";
import {
  MARCOS,
  chaveDoNome,
  posicaoDaNova,
  problemaAoApagar,
  problemaAoCriar,
  problemaNaOrdem,
  problemaNoMarco,
  problemaNoNome,
  TETO_DE_ETAPAS,
  type EtapaRegra,
} from "../funil/etapas-regra";

const raiz = join(__dirname, "..", "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const e = (id: string, name: string, tipo: "aberta" | "ganho" | "perdido" = "aberta"): EtapaRegra => ({
  id,
  name,
  isWon: tipo === "ganho",
  isLost: tipo === "perdido",
});
const PADRAO = [
  e("novo", "Novo lead"),
  e("contato", "Primeiro contato"),
  e("catalogo", "Catálogo enviado"),
  e("ganho", "Pedido fechado", "ganho"),
  e("pos", "Pós-venda"),
  e("perdido", "Perdido", "perdido"),
];

describe("RN-091 · nome da etapa", () => {
  it("nome repetido é recusado sem olhar caixa, acento e espaço sobrando", () => {
    expect(problemaNoNome("catalogo  enviado ", PADRAO)).toMatch(/Já existe a etapa "Catálogo enviado"/);
    expect(chaveDoNome(" Catálogo   Enviado")).toBe("catalogo enviado");
  });
  it("renomear a própria etapa para o mesmo nome (outra caixa) passa", () => {
    expect(problemaNoNome("CATÁLOGO ENVIADO", PADRAO, "catalogo")).toBeNull();
  });
  it("vazio e comprido demais são recusados", () => {
    expect(problemaNoNome("   ", PADRAO)).toMatch(/Dê um nome/);
    expect(problemaNoNome("x".repeat(41), PADRAO)).toMatch(/no máximo 40/);
  });
});

describe("RN-091 · criar e ordenar", () => {
  it("a etapa nova entra logo antes da primeira etapa fechada (meio do funil)", () => {
    expect(posicaoDaNova(PADRAO)).toBe(3);
  });
  it("teto de etapas", () => {
    const cheio = Array.from({ length: TETO_DE_ETAPAS }, (_, i) => e(`s${i}`, `E${i}`));
    expect(problemaAoCriar(cheio)).toMatch(/máximo/);
    expect(problemaAoCriar(PADRAO)).toBeNull();
  });
  it("a primeira etapa tem que ser aberta (é a porta de entrada do lead)", () => {
    const ids = ["ganho", "novo", "contato", "catalogo", "pos", "perdido"];
    expect(problemaNaOrdem(PADRAO, ids)).toMatch(/não pode ser a primeira/);
  });
  it("ordem com etapa a mais, a menos ou repetida = o funil mudou no meio", () => {
    const ids = PADRAO.map((x) => x.id);
    expect(problemaNaOrdem(PADRAO, ids.slice(1))).toMatch(/mudou/);
    expect(problemaNaOrdem(PADRAO, [...ids.slice(0, 5), "novo"])).toMatch(/mudou/);
    expect(problemaNaOrdem(PADRAO, [...ids.slice(0, 5), "outra"])).toMatch(/mudou/);
  });
  it("ganho e perdido podem mudar de lugar, desde que não sejam os primeiros", () => {
    expect(problemaNaOrdem(PADRAO, ["novo", "ganho", "contato", "catalogo", "pos", "perdido"])).toBeNull();
  });
  it("etapa com marco não fica depois do ganho (cartão de quem não pagou pareceria venda feita)", () => {
    const ordem = ["novo", "contato", "ganho", "catalogo", "pos", "perdido"];
    expect(problemaNaOrdem(PADRAO, ordem, ["catalogo"])).toMatch(/não pode ficar depois de "Pedido fechado"/);
    // subir o ganho acima de uma etapa automática também é recusado
    expect(problemaNaOrdem(PADRAO, ["novo", "ganho", "contato", "catalogo", "pos", "perdido"], ["contato"])).toMatch(/depois/);
    // o Pós-venda (sem marco) pode ficar depois do ganho, como no funil padrão
    expect(problemaNaOrdem(PADRAO, PADRAO.map((x) => x.id), ["contato", "catalogo"])).toBeNull();
  });
});

describe("RN-091 · apagar etapa", () => {
  it("ganho e perdido não se apagam (o pedido pago e o cancelado levam o cartão para lá)", () => {
    expect(problemaAoApagar(PADRAO, "ganho", "novo")).toMatch(/venda ganha/);
    expect(problemaAoApagar(PADRAO, "perdido", "novo")).toMatch(/perdida/);
  });
  it("destino é obrigatório, outro e ABERTO — cartão nunca some nem fecha sozinho", () => {
    expect(problemaAoApagar(PADRAO, "contato", null)).toMatch(/Escolha/);
    expect(problemaAoApagar(PADRAO, "contato", "contato")).toMatch(/outra etapa/);
    expect(problemaAoApagar(PADRAO, "contato", "ganho")).toMatch(/etapa aberta/);
    expect(problemaAoApagar(PADRAO, "contato", "sumiu")).toMatch(/não existe mais/);
    expect(problemaAoApagar(PADRAO, "contato", "novo")).toBeNull();
  });
  it("etapa com marco só se apaga para um destino ANTES do ganho (o marco vai junto)", () => {
    expect(problemaAoApagar(PADRAO, "catalogo", "pos", true)).toMatch(/depois da etapa de venda ganha/);
    expect(problemaAoApagar(PADRAO, "catalogo", "pos", false)).toBeNull();
    expect(problemaAoApagar(PADRAO, "catalogo", "contato", true)).toBeNull();
  });
  it("sempre sobra uma etapa aberta", () => {
    const minimo = [e("so", "Única"), e("g", "Ganho", "ganho"), e("p", "Perdido", "perdido")];
    expect(problemaAoApagar(minimo, "so", "g")).toMatch(/pelo menos uma etapa aberta/);
  });
  it("apagar a primeira não pode deixar ganho/perdido como porta de entrada", () => {
    const f = [e("a", "Novo"), e("g", "Ganho", "ganho"), e("b", "Conversa"), e("p", "Perdido", "perdido")];
    expect(problemaAoApagar(f, "a", "b")).toMatch(/Reordene antes/);
  });
});

describe("RN-091 · marcos (para onde o cartão anda sozinho)", () => {
  it("só etapa aberta; null é 'não mover'", () => {
    expect(problemaNoMarco(PADRAO, null)).toBeNull();
    expect(problemaNoMarco(PADRAO, "catalogo")).toBeNull();
    expect(problemaNoMarco(PADRAO, "ganho")).toMatch(/etapa aberta/);
    expect(problemaNoMarco(PADRAO, "sumiu")).toMatch(/não existe mais/);
    // aberta, mas depois do ganho ("Pós-venda") — recusada
    expect(problemaNoMarco(PADRAO, "pos")).toMatch(/depois da etapa de venda ganha/);
  });
  it("são os quatro que o sistema reconhece", () => {
    expect([...MARCOS]).toEqual(["PRIMEIRO_CONTATO", "CATALOGO_ENVIADO", "NEGOCIACAO", "PAGAMENTO"]);
  });
});

/** Todo arquivo .ts/.tsx de src, para as varreduras. */
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : arquivos(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("RN-091 · o cartão anda pela etapa ESCOLHIDA, nunca pelo nome", () => {
  it("ninguém mais procura etapa pelo nome", () => {
    const culpados = arquivos(join(raiz, "src")).filter((p) =>
      // a função que casava pelo nome, ou uma consulta de etapa filtrando por nome
      /nomeCasaComEtapa|semAcento\(e\.name\)|stage\.find\w*\(\{\s*where:\s*\{[^}]*\bname\b/.test(
        readFileSync(p, "utf8")
      )
    );
    expect(culpados).toEqual([]);
  });
  it("os três motores usam a tabela de marcos", () => {
    expect(ler("src/lib/funil-auto.ts")).toContain("etapaDoMarco(");
    expect(ler("src/lib/opportunity-sync.ts")).toContain("etapaDoMarco(");
    expect(ler("src/lib/automations.ts")).toContain("idsDasEtapasDoMarco(");
  });
  it("todo lugar que CRIA funil cria os marcos junto (senão o funil nasce parado)", () => {
    for (const f of ["src/lib/provision.ts", "src/lib/platform.ts", "prisma/bootstrap.ts", "prisma/seed.ts", "scripts/seed-demo.ts"]) {
      const s = ler(f);
      if (s.includes("pipeline.create(")) expect(s, f).toContain("etapaAutomatica.createMany");
    }
  });
  it("a migração preenche os marcos pela MESMA régua do nome que existia (ninguém percebe a troca)", () => {
    const pasta = join(raiz, "prisma", "migrations");
    const m = readdirSync(pasta).find((n) => n.endsWith("_funil_editavel"));
    expect(m).toBeTruthy();
    const sql = readFileSync(join(pasta, m!, "migration.sql"), "utf8");
    for (const nome of ["primeiro contato", "catalogo enviado", "pedido em negociacao", "pagamento pendente", "contato realizado", "negociacao"])
      expect(sql).toContain(`'${nome}'`);
    expect(sql).toContain('WHERE NOT s."isWon" AND NOT s."isLost"');
  });
});

describe("RN-091 · nada quebra por causa do editor", () => {
  it("etapa apagada entre ler e criar: resolve de novo e cria na etapa nova (uma vez só)", async () => {
    const sumiu = new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "x" });
    const etapas = ["apagada", "destino"];
    let tentativas = 0;
    const r = await naEtapaViva(
      async () => etapas.shift() ?? null,
      async (etapa) => {
        tentativas++;
        if (etapa === "apagada") throw sumiu;
        return `cartão em ${etapa}`;
      }
    );
    expect(r).toEqual({ etapa: "destino", criado: "cartão em destino" });
    expect(tentativas).toBe(2);
    // outro erro, ou a segunda falha, sobe (nunca engole erro de verdade)
    await expect(naEtapaViva(async () => "x", async () => { throw sumiu; })).rejects.toBe(sumiu);
    await expect(naEtapaViva(async () => "x", async () => { throw new Error("outro"); })).rejects.toThrow("outro");
  });
  it("quem cria cartão tenta de novo se a etapa for apagada no meio (lead e pedido do catálogo)", () => {
    expect(ler("src/lib/intake.ts")).toContain("naEtapaViva(");
    expect(ler("src/app/api/catalog/order/route.ts").match(/naEtapaViva\(/g)?.length).toBe(2);
    expect(ler("src/lib/funil/etapa-viva.ts")).toContain('"P2003"');
  });
  it("funil sem vínculo em loja sem o editor é reparado de carona ao abrir o Funil", () => {
    expect(ler("src/app/(app)/funil/page.tsx")).toContain("garantirMarcosIniciais(user.companyId)");
    const m = ler("src/lib/funil/marcos.ts");
    expect(m).toContain('NOT c."funilEditavelEnabled"');
    expect(m).toContain('NOT EXISTS (SELECT 1 FROM "EtapaAutomatica"');
  });
  it("renumerar é um comando só e a transação tem folga para o banco longe", () => {
    const p = ler("src/lib/funil/editor.ts");
    expect(p).toContain('UPDATE "Stage" AS s SET "order" = v.ordem');
    expect(p).toContain("timeout: 15_000");
  });
});

describe("RN-091 · porteira", () => {
  it("toda rota do editor passa pela porteira (chave da loja + gerência)", () => {
    for (const f of [
      "src/app/api/funil/etapas/route.ts",
      "src/app/api/funil/etapas/[id]/route.ts",
      "src/app/api/funil/automaticas/route.ts",
    ]) {
      const s = ler(f);
      const handlers = s.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? [];
      const porteiras = s.match(/await porteiraDoEditor\(/g) ?? [];
      expect(handlers.length, f).toBeGreaterThan(0);
      expect(porteiras.length, f).toBe(handlers.length);
    }
    const p = ler("src/lib/funil/editor.ts");
    expect(p).toContain("funilEditavelEnabled");
    expect(p).toContain("isManagerUp(user)");
  });
  it("só o Super Admin liga a chave", () => {
    expect(ler("src/app/api/companies/funil-editavel/route.ts")).toContain('user.role !== "SUPERADMIN"');
  });
  it("apagar leva cartões, regras de origem e marcos ao destino, dentro do funil travado", () => {
    const p = ler("src/lib/funil/editor.ts");
    expect(p).toContain('FOR UPDATE');
    expect(p).toContain("tx.opportunity.updateMany");
    expect(p).toContain("tx.originRule.updateMany");
    expect(p).toContain("tx.etapaAutomatica.updateMany");
    expect(p).toContain('type: "funil.editado"');
  });
});
