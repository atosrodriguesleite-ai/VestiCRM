import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grupoDoMenu, itemVisivel, rotuloDoMenu } from "../menu-grupos";

/**
 * O MENU DO FINANCEIRO (RN-029).
 *
 * Duas decisões moram aqui. A primeira, e mais importante: **loja SEM o
 * módulo não tem aba de financeiro NENHUMA** (pedido do dono, 05/09/2026 —
 * antes o painel "Financeiro" ficava no menu de toda loja, como tela simples
 * de pedidos a receber, e a loja sem o módulo via um financeiro pela metade).
 * A segunda: com o módulo, as nove telas do dinheiro formam UM grupo, na
 * ordem da rotina da lojista — soltas dentro de "Análise" misturavam o que
 * ela abre todo dia com o que abre uma vez por mês.
 */

const shell = readFileSync(
  join(process.cwd(), "src/components/app-shell.tsx"),
  "utf8"
);

/** Os itens do menu na ORDEM em que aparecem no arquivo, com as chaves. */
function itensDoMenu(): { href: string; label: string; grupo: string; chaves: string }[] {
  return [
    ...shell.matchAll(/\{ href: "([^"]+)", label: "([^"]+)"([^}]*?)group: "([^"]+)"([^}]*)\}/g),
  ].map((m) => ({ href: m[1], label: m[2], grupo: m[4], chaves: m[3] + m[5] }));
}

const financeiros = () => itensDoMenu().filter((i) => i.href.startsWith("/financeiro"));

/** Reconstrói o item como o shell o declara, para perguntar ao `itemVisivel`. */
function itemDeclarado(href: string) {
  const i = financeiros().find((x) => x.href === href)!;
  return {
    href,
    managerOnly: i.chaves.includes("managerOnly: true"),
    financeOnly: i.chaves.includes("financeOnly: true"),
  };
}

const LOJA = { modoPlataforma: false };

describe("sem o módulo, a loja não tem aba de financeiro (RN-029)", () => {
  it("TODO item do financeiro exige a chave do módulo — inclusive o painel", () => {
    expect(financeiros().length).toBe(9);
    for (const i of financeiros()) {
      expect(i.chaves, `${i.href} aparece para loja sem o módulo`).toContain("financeOnly: true");
      // e dinheiro é assunto de gerência (mesma régua de Relatórios)
      expect(i.chaves).toContain("managerOnly: true");
    }
  });

  it("a admin da loja SEM o módulo não vê nenhum item — nem sendo admin", () => {
    for (const role of ["ADMIN", "MANAGER", "SUPERADMIN"]) {
      for (const i of financeiros()) {
        expect(itemVisivel(itemDeclarado(i.href), { role, financeEnabled: false })).toBe(false);
      }
    }
  });

  it("COM o módulo, gerência vê tudo; vendedora e suporte continuam fora", () => {
    for (const i of financeiros()) {
      const item = itemDeclarado(i.href);
      expect(itemVisivel(item, { role: "ADMIN", financeEnabled: true })).toBe(true);
      expect(itemVisivel(item, { role: "MANAGER", financeEnabled: true })).toBe(true);
      expect(itemVisivel(item, { role: "SELLER", financeEnabled: true })).toBe(false);
      expect(itemVisivel(item, { role: "SUPPORT", financeEnabled: true })).toBe(false);
    }
  });

  it("grupo sem item não desenha — então o grupo Financeiro some junto", () => {
    expect(shell).toContain("if (groupItems.length === 0) return null;");
  });

  it("a página raiz do financeiro também passa pela porteira — sem o módulo cai no Dashboard", () => {
    // a aba sumir do menu não basta: o endereço digitado também tem que
    // recusar, e a porteira das telas devolve ao Dashboard (cair em
    // /financeiro faria a raiz redirecionar para ela mesma, em círculo)
    const raiz = readFileSync(join(process.cwd(), "src/app/(app)/financeiro/page.tsx"), "utf8");
    expect(raiz).toContain("porteiraFinanceiroTela()");
    const gate = readFileSync(join(process.cwd(), "src/lib/financeiro/gate.ts"), "utf8");
    expect(gate).not.toContain('redirect("/financeiro")');
    expect(gate).toContain('redirect("/dashboard")');
  });
});

describe("o menu do Financeiro é um grupo só (RN-029)", () => {
  it("as nove telas do dinheiro declaram o grupo Financeiro", () => {
    for (const i of financeiros()) expect(i.grupo).toBe("Financeiro");
    expect(grupoDoMenu("Financeiro", LOJA)).toBe("Financeiro");
    // e as vizinhas de Análise ficam onde estavam
    expect(grupoDoMenu("Análise", LOJA)).toBe("Análise");
  });

  it("o resto do menu não mexe com o módulo: os outros módulos seguem a própria chave", () => {
    const envios = { href: "/envios", shippingOnly: true };
    expect(itemVisivel(envios, { role: "SELLER", shippingEnabled: true })).toBe(true);
    expect(itemVisivel(envios, { role: "ADMIN", shippingEnabled: false })).toBe(false);
    // Suporte: tela escondida dele não aparece, operacional aparece
    expect(itemVisivel({ href: "/funil", supportHidden: true }, { role: "SUPPORT" })).toBe(false);
    expect(itemVisivel({ href: "/comunicacao", operacional: true }, { role: "SUPPORT" })).toBe(true);
    expect(itemVisivel({ href: "/comunicacao", operacional: true }, { role: "SELLER" })).toBe(false);
    expect(itemVisivel({ href: "/lojas", superOnly: true }, { role: "ADMIN" })).toBe(false);
  });

  it("no modo plataforma (Super Admin) o remapeamento dele continua mandando", () => {
    const superAdmin = { modoPlataforma: true };
    expect(grupoDoMenu("Financeiro", superAdmin, "Ferramentas da loja")).toBe(
      "Ferramentas da loja"
    );
    expect(rotuloDoMenu("/financeiro", "Financeiro", superAdmin)).toBe("Financeiro");
  });

  it("a ordem é a ROTINA da lojista, não o alfabeto", () => {
    // o que ela abre todo dia em cima; o resultado do mês, embaixo
    expect(financeiros().map((i) => i.href)).toEqual([
      "/financeiro",
      "/financeiro/contas-a-receber",
      "/financeiro/inadimplencia",
      "/financeiro/contas-a-pagar",
      "/financeiro/cartoes",
      "/financeiro/extrato",
      "/financeiro/conciliacao",
      "/financeiro/fluxo-de-caixa",
      "/financeiro/dre",
    ]);
  });

  it("dentro do grupo, o painel não repete o nome do grupo", () => {
    expect(rotuloDoMenu("/financeiro", "Financeiro", LOJA)).toBe("Visão geral");
    // e só ele: as outras telas mantêm o nome delas
    expect(rotuloDoMenu("/financeiro/dre", "Deu lucro?", LOJA)).toBe("Deu lucro?");
  });

  it("todo grupo recolhe — menos o da tela aberta, que nem mostra a setinha", () => {
    // botão que não faz nada quando se clica é pior que botão nenhum: a
    // lojista clicava, nada acontecia, e o grupo sumia na navegação seguinte
    expect(shell).toContain("const recolhivel = showLabels && !estouAqui;");
    expect(shell).toContain("const fechado = recolhivel && fechados.includes(group);");
    // e a escolha fica salva
    expect(shell).toContain('localStorage.setItem("vesti_grupos_fechados"');
  });

  it("o grupo Financeiro fica DEPOIS de Análise na lateral", () => {
    const inicio = shell.indexOf("const GROUPS = [");
    const grupos = shell.slice(inicio, shell.indexOf("];", inicio));
    expect(grupos.indexOf('"Análise"')).toBeLessThan(grupos.indexOf('"Financeiro"'));
    expect(grupos.indexOf('"Financeiro"')).toBeLessThan(grupos.indexOf('"Sistema"'));
  });
});
