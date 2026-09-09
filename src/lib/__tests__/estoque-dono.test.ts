// Guarda RN-050
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  decidirAjuste,
  donoDoEstoque,
  fraseDaRecusa,
  motivoDoLivro,
  rotuloDaPeca,
  TETO_DO_MOTIVO,
} from "../estoque/dono-do-estoque";
import { casaBusca, passaNoFiltro, STATUS_QUE_SEGURAM_NA_LOJA } from "../estoque/inventario";
import { estoqueLiberado, podeAjustarEstoque } from "../estoque/gate";
import { itemVisivel } from "../menu-grupos";

/**
 * MÓDULO ESTOQUE (RN-050): quem manda no número de cada peça.
 *
 * Pedido do dono (09/09/2026): "caso o cliente tenha Nuvemshop ou outro
 * sistema de e-commerce ou marketplace, esse outro sistema continua mandando
 * no estoque, e deve respeitar as integrações". A tela Produtos deixava
 * digitar por cima do número da Nuvemshop e não mandava para lá — a sync
 * seguinte desfazia o ajuste, e no meio o catálogo vendia peça já vendida.
 */

function listarRotas(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...listarRotas(p));
    else if (nome === "route.ts") out.push(p);
  }
  return out;
}

const local = { nuvemshopId: null, product: { jueriId: null } };
const daNuvemshop = { nuvemshopId: "ns-1", product: { jueriId: null } };
const doJueri = { nuvemshopId: null, product: { jueriId: "j-1" } };

describe("quem manda no estoque de cada peça", () => {
  it("variação com id na Nuvemshop é da Nuvemshop; produto do Jueri é do Jueri; o resto é nosso", () => {
    expect(donoDoEstoque(local)).toBeNull();
    expect(donoDoEstoque(daNuvemshop)).toBe("NUVEMSHOP");
    expect(donoDoEstoque(doJueri)).toBe("JUERI");
  });

  it("produto vindo da Nuvemshop com uma cor/tamanho que NÃO existe lá é nosso (a sync não a toca)", () => {
    // o vínculo da Nuvemshop é por VARIAÇÃO: sem `nuvemshopId` na variação,
    // nem a sync nem o espelho de estoque a enxergam
    expect(donoDoEstoque({ nuvemshopId: null, product: { jueriId: null } })).toBeNull();
  });

  it("Nuvemshop vence quando os dois vínculos existem (é o espelho por variação que está vivo)", () => {
    expect(donoDoEstoque({ nuvemshopId: "ns-1", product: { jueriId: "j-1" } })).toBe("NUVEMSHOP");
  });
});

describe("a decisão do ajuste digitado", () => {
  const base = { dono: null, podeAjustar: true, estoqueAtual: 4, motivo: "Contagem" };

  it("peça nossa, gerência, motivo dado → ajusta, com quantidade positiva e de/para", () => {
    expect(decidirAjuste({ ...base, novoEstoque: 10 })).toEqual({
      tipo: "AJUSTAR",
      quantidade: 6,
      de: 4,
      para: 10,
      motivo: "Contagem",
    });
    expect(decidirAjuste({ ...base, novoEstoque: 1 })).toMatchObject({ tipo: "AJUSTAR", quantidade: 3 });
  });

  it("peça da Nuvemshop/Jueri com número diferente é RECUSADA — o número é deles", () => {
    expect(decidirAjuste({ ...base, dono: "NUVEMSHOP", novoEstoque: 10 })).toEqual({
      tipo: "RECUSADO",
      porque: "DONO_EXTERNO",
      dono: "NUVEMSHOP",
    });
    expect(decidirAjuste({ ...base, dono: "JUERI", novoEstoque: 0 })).toMatchObject({
      tipo: "RECUSADO",
      porque: "DONO_EXTERNO",
      dono: "JUERI",
    });
  });

  it("peça da Nuvemshop com o MESMO número passa em silêncio (a tela Produtos manda a grade inteira)", () => {
    expect(decidirAjuste({ ...base, dono: "NUVEMSHOP", novoEstoque: 4, motivo: "" })).toEqual({ tipo: "NADA" });
  });

  it("sem permissão recusa ANTES de tudo — a vendedora não descobre pelo erro se a peça é da Nuvemshop", () => {
    expect(decidirAjuste({ ...base, podeAjustar: false, dono: "NUVEMSHOP", novoEstoque: 10 })).toEqual({
      tipo: "RECUSADO",
      porque: "SEM_PERMISSAO",
    });
  });

  it("sem motivo recusa — e só depois de saber que o ajuste vai acontecer", () => {
    expect(decidirAjuste({ ...base, motivo: "   ", novoEstoque: 10 })).toEqual({
      tipo: "RECUSADO",
      porque: "SEM_MOTIVO",
    });
    // dono externo vem antes do motivo (não adianta pedir motivo do que não vai acontecer)
    expect(decidirAjuste({ ...base, dono: "JUERI", motivo: "", novoEstoque: 10 })).toMatchObject({
      porque: "DONO_EXTERNO",
    });
  });

  it("número inválido (negativo, quebrado) recusa; mesmo número não é recusa, é NADA", () => {
    expect(decidirAjuste({ ...base, novoEstoque: -1 })).toMatchObject({ porque: "NUMERO_INVALIDO" });
    expect(decidirAjuste({ ...base, novoEstoque: 2.5 })).toMatchObject({ porque: "NUMERO_INVALIDO" });
    expect(decidirAjuste({ ...base, novoEstoque: 4 })).toEqual({ tipo: "NADA" });
  });

  it("o motivo vai aparado e com teto — vai para o livro junto do nome", () => {
    const longo = "x".repeat(TETO_DO_MOTIVO + 50);
    const d = decidirAjuste({ ...base, novoEstoque: 5, motivo: `  ${longo}  ` });
    expect(d.tipo).toBe("AJUSTAR");
    if (d.tipo === "AJUSTAR") {
      expect(d.motivo).toHaveLength(TETO_DO_MOTIVO);
      expect(motivoDoLivro("Ana", d)).toBe(`Ajuste manual por Ana: ${"x".repeat(TETO_DO_MOTIVO)} (4 → 5)`);
    }
  });

  it("as frases da recusa dizem a peça e o caminho", () => {
    const peca = rotuloDaPeca({ color: "Azul", size: "M", product: { name: "Vestido Lia" } });
    expect(peca).toBe("Vestido Lia · Azul · M");
    expect(fraseDaRecusa({ tipo: "RECUSADO", porque: "DONO_EXTERNO", dono: "NUVEMSHOP" }, peca)).toBe(
      "O estoque de Vestido Lia · Azul · M é controlado pela Nuvemshop. Ajuste lá e sincronize aqui."
    );
    expect(fraseDaRecusa({ tipo: "RECUSADO", porque: "SEM_PERMISSAO" }, peca)).toMatch(/gerente ou admin/);
    expect(fraseDaRecusa({ tipo: "RECUSADO", porque: "SEM_MOTIVO" }, peca)).toMatch(/motivo/);
    // peça sem cor/tamanho ("Único" vazio) não deixa " · " sobrando
    expect(rotuloDaPeca({ color: "", size: "", product: { name: "Bolsa" } })).toBe("Bolsa");
  });
});

describe("a porteira e o menu do módulo", () => {
  it("toda a equipe ENTRA com a chave da loja; sem a chave ninguém entra", () => {
    expect(estoqueLiberado(true)).toBe(true);
    expect(estoqueLiberado(false)).toBe(false);
  });

  it("quem AJUSTA no Inventário é gerência e admin — vendedora e suporte só veem", () => {
    expect(podeAjustarEstoque({ role: "ADMIN" })).toBe(true);
    expect(podeAjustarEstoque({ role: "MANAGER" })).toBe(true);
    expect(podeAjustarEstoque({ role: "SUPERADMIN" })).toBe(true);
    expect(podeAjustarEstoque({ role: "SELLER" })).toBe(false);
    expect(podeAjustarEstoque({ role: "SUPPORT" })).toBe(false);
  });

  it("o item Estoque do menu exige a chave do módulo e aparece para toda a equipe da loja que tem", () => {
    const shell = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");
    const m = shell.match(/\{ href: "\/estoque",([^}]*)\}/);
    expect(m, "o menu não tem o item /estoque").toBeTruthy();
    expect(m![1]).toContain("estoqueOnly: true");
    const item = { href: "/estoque", estoqueOnly: true };
    for (const role of ["ADMIN", "MANAGER", "SELLER", "SUPPORT"]) {
      expect(itemVisivel(item, { role, estoqueEnabled: false })).toBe(false);
      expect(itemVisivel(item, { role, estoqueEnabled: true })).toBe(true);
    }
  });

  it("a tela e TODA rota do módulo passam pela porteira — por handler exportado, não por arquivo", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/(app)/estoque/layout.tsx"), "utf8");
    expect(layout).toContain("porteiraEstoqueTela()");
    // varre a pasta inteira: a rota da Fase 5 que esquecer a porteira fica vermelha aqui
    const rotas = listarRotas(join(process.cwd(), "src/app/api/estoque"));
    expect(rotas.length).toBeGreaterThanOrEqual(6);
    for (const rota of rotas) {
      const texto = readFileSync(rota, "utf8");
      const handlers = [...texto.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
      expect(handlers.length, `${rota} sem handler`).toBeGreaterThan(0);
      for (const h of handlers) {
        const corpo = texto.slice(h.index!);
        const fim = corpo.indexOf("\nexport ", 1);
        const trecho = fim > 0 ? corpo.slice(0, fim) : corpo;
        expect(trecho, `${rota} ${h[1]} sem porteiraEstoque()`).toContain("porteiraEstoque()");
        // escrita exige papel (ou passa pela porta única, que confere)
        if (h[1] !== "GET") {
          expect(
            /podeAjustarEstoque\(|ajustarEstoque\(/.test(trecho),
            `${rota} ${h[1]} escreve sem conferir papel`
          ).toBe(true);
        }
      }
    }
  });
});

describe("o inventário: filtros e reserva", () => {
  it("reservado é pedido que ainda está DENTRO da loja — enviado, entregue e cancelado ficam fora", () => {
    expect([...STATUS_QUE_SEGURAM_NA_LOJA]).toEqual([
      "ORCAMENTO",
      "AGUARDANDO_PAGAMENTO",
      "PAGO",
      "EM_PRODUCAO",
      "SEPARACAO",
    ]);
  });

  it("os filtros: zerada, no mínimo (0..mínimo DELA), com reserva, controlada por integração", () => {
    const l = (disponivel: number, reservado = 0, dono: "NUVEMSHOP" | null = null, minimo = 5) => ({
      disponivel,
      reservado,
      dono,
      minimo,
    });
    expect(passaNoFiltro("zerado", l(0))).toBe(true);
    expect(passaNoFiltro("zerado", l(1))).toBe(false);
    expect(passaNoFiltro("baixo", l(0))).toBe(true); // zerada TAMBÉM chegou ao mínimo (mesma conta do sino e do Dashboard)
    expect(passaNoFiltro("baixo", l(5))).toBe(true);
    expect(passaNoFiltro("baixo", l(6))).toBe(false);
    // o mínimo é o da LINHA (peça > categoria > loja, RN-051), não um número da loja
    expect(passaNoFiltro("baixo", l(6, 0, null, 8))).toBe(true);
    expect(passaNoFiltro("reservado", l(3, 2))).toBe(true);
    expect(passaNoFiltro("reservado", l(3, 0))).toBe(false);
    expect(passaNoFiltro("externo", l(3, 0, "NUVEMSHOP"))).toBe(true);
    expect(passaNoFiltro("externo", l(3))).toBe(false);
    expect(passaNoFiltro("todos", l(0))).toBe(true);
  });

  it("a busca acha por nome, código do modelo, SKU da variação e tag — sem diferenciar maiúsculas", () => {
    const p = { name: "Vestido Lia", sku: "VL-01", tags: "verão, festa" };
    expect(casaBusca("lia", p, { sku: null })).toBe(true);
    expect(casaBusca("vl-01", p, { sku: null })).toBe(true);
    expect(casaBusca("VL-01-AZ-M", p, { sku: "vl-01-az-m" })).toBe(true);
    expect(casaBusca("festa", p, { sku: null })).toBe(true);
    expect(casaBusca("saia", p, { sku: null })).toBe(false);
    expect(casaBusca("   ", p, { sku: null })).toBe(true);
  });
});
