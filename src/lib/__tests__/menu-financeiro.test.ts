import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { grupoDoMenu, rotuloDoMenu } from "../menu-grupos";

/**
 * O MENU DO FINANCEIRO (RN-029). Nove telas de dinheiro soltas dentro de
 * "Análise" misturavam o que a lojista abre TODO DIA (contas a pagar) com o
 * que ela abre uma vez por mês (deu lucro?) — e ainda empurravam Marketing e
 * Relatórios para o fim de uma lista de quinze linhas.
 *
 * Estas guardas defendem as decisões do agrupamento, e a mais importante é a
 * segunda: loja SEM a chave não pode ganhar grupo nenhum.
 */

const shell = readFileSync(
  join(process.cwd(), "src/components/app-shell.tsx"),
  "utf8"
);

/** Os itens do menu na ORDEM em que aparecem no arquivo. */
function itensDoMenu(): { href: string; label: string; grupo: string }[] {
  return [
    ...shell.matchAll(/\{ href: "([^"]+)", label: "([^"]+)"[^}]*?group: "([^"]+)"/g),
  ].map((m) => ({ href: m[1], label: m[2], grupo: m[3] }));
}

const COM_MODULO = { modoPlataforma: false, financeEnabled: true };
const SEM_MODULO = { modoPlataforma: false, financeEnabled: false };

describe("o menu do Financeiro é um grupo só (RN-029)", () => {
  it("com o módulo ligado, TODA tela do dinheiro cai no grupo Financeiro", () => {
    for (const href of [
      "/financeiro",
      "/financeiro/contas-a-receber",
      "/financeiro/contas-a-pagar",
      "/financeiro/dre",
      "/financeiro/cartoes",
      "/financeiro/conciliacao",
    ]) {
      expect(grupoDoMenu(href, "Análise", COM_MODULO)).toBe("Financeiro");
    }
    // e as vizinhas de Análise ficam onde estavam
    expect(grupoDoMenu("/relatorios", "Análise", COM_MODULO)).toBe("Análise");
    expect(grupoDoMenu("/comissoes", "Análise", COM_MODULO)).toBe("Análise");
  });

  it("SEM a chave, a loja não muda em NADA (nem ganha grupo)", () => {
    expect(grupoDoMenu("/financeiro", "Análise", SEM_MODULO)).toBe("Análise");
    expect(grupoDoMenu("/financeiro/dre", "Análise", SEM_MODULO)).toBe("Análise");
    expect(rotuloDoMenu("/financeiro", "Financeiro", SEM_MODULO)).toBe("Financeiro");
    // grupo sem item não desenha, então "Financeiro" nem aparece na lateral
    expect(shell).toContain("if (groupItems.length === 0) return null;");
    // e os itens continuam declarados em Análise: sem a chave é lá que ficam
    const financeiros = itensDoMenu().filter((i) => i.href.startsWith("/financeiro"));
    expect(financeiros.length).toBeGreaterThan(5);
    for (const i of financeiros) expect(i.grupo).toBe("Análise");
  });

  it("no modo plataforma (Super Admin) o remapeamento dele continua mandando", () => {
    const superAdmin = { modoPlataforma: true, financeEnabled: true };
    expect(grupoDoMenu("/financeiro", "Análise", superAdmin, "Ferramentas da loja")).toBe(
      "Ferramentas da loja"
    );
    expect(rotuloDoMenu("/financeiro", "Financeiro", superAdmin)).toBe("Financeiro");
  });

  it("a ordem é a ROTINA da lojista, não o alfabeto", () => {
    // o que ela abre todo dia em cima; o resultado do mês, embaixo
    const ordem = itensDoMenu()
      .filter((i) => i.href.startsWith("/financeiro"))
      .map((i) => i.href);
    expect(ordem).toEqual([
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
    expect(rotuloDoMenu("/financeiro", "Financeiro", COM_MODULO)).toBe("Visão geral");
    // e só ele: as outras telas mantêm o nome delas
    expect(rotuloDoMenu("/financeiro/dre", "Deu lucro?", COM_MODULO)).toBe("Deu lucro?");
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
