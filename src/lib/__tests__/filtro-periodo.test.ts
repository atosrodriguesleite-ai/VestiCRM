import { describe, it, expect } from "vitest";
import { ultimosDiasSP } from "../periodo";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * FILTRO DE PERÍODO — "clico nas datas e trava o sistema" (Nívia, 25/08/2026).
 *
 * Não tinha travado: trocar o período é navegação para a MESMA tela, e nesse
 * caso o Next não mostra o esqueleto de carregamento. A tela ficava idêntica
 * por segundos enquanto o servidor refazia as contas — e, sem resposta
 * nenhuma, a lojista tocava de novo, dobrando o trabalho.
 *
 * Quatro coisas quebram em silêncio se alguém mexer aqui sem saber:
 *
 *  1. sumir com o aviso "Atualizando…" → volta a parecer travado;
 *  2. deixar o atalho aceso preso no que foi TOCADO em vez do que está na
 *     URL → o Voltar do navegador mostra os números de um período com o
 *     atalho de outro aceso;
 *  3. tirar o `href` dos atalhos ou o `action`/`name` do formulário → antes
 *     do JavaScript carregar (justamente nesta tela, que é pesada) o filtro
 *     não faz nada;
 *  4. o motor de "quem chamar hoje" voltar a segurar os números do período.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const chips = ler("src/components/period-chips.tsx");
const dash = ler("src/app/(app)/dashboard/page.tsx");
const chamadas = ler("src/app/(app)/dashboard/chamadas-do-dia.tsx");

describe("tocar numa data responde na hora", () => {
  it("mostra 'Atualizando…' enquanto a resposta não chega", () => {
    expect(chips).toContain("Atualizando…");
    expect(chips).toContain("animate-spin");
  });

  it("tocar no atalho JÁ aceso não deixa o aviso preso na tela", () => {
    // a URL não muda, então nada avisaria que terminou
    expect(chips).toContain("onClick={() => !ativoPelaUrl(c) && setTocado(c.label)}");
  });
});

describe("quem manda é a URL, não o último toque", () => {
  it("o atalho aceso volta a seguir a URL quando ela muda (Voltar do navegador)", () => {
    expect(chips).toContain("if (urlNaTela.de !== de || urlNaTela.ate !== ate)");
    expect(chips).toContain("setTocado(null);");
  });

  it("os campos De/Até também voltam a espelhar o período de verdade", () => {
    expect(chips).toContain('setCampos({ de: de ?? "", ate: ate ?? "" });');
  });
});

describe("funciona antes do JavaScript carregar", () => {
  it("os atalhos são links de verdade", () => {
    expect(chips).toContain("<Link");
    expect(chips).toContain("href={href}");
  });

  it("o formulário tem action, name nos campos e leva os outros filtros junto", () => {
    expect(chips).toContain('method="GET"');
    expect(chips).toContain("action={pathname}");
    expect(chips).toContain('name="de"');
    expect(chips).toContain('name="ate"');
    expect(chips).toContain('<input key={k} type="hidden" name={k} value={v} />');
  });
});

describe("o bloco pesado não segura os números do período", () => {
  it("'quem chamar hoje' carrega à parte, em Suspense", () => {
    expect(dash).toContain("<Suspense fallback={<ChamadasDoDiaEsqueleto />}>");
  });

  it("mas COMEÇA junto com o resto — a promessa nasce na página", () => {
    // um bloco em Suspense só arranca depois que o pai termina de esperar;
    // criando a promessa aqui, o motor trabalha em paralelo
    expect(dash).toContain("const sugestoes = computeAutomations(user);");
    expect(chamadas).toContain("const suggestions = await sugestoes;");
  });

  it("só monta ficha e mensagem das que aparecem na tela", () => {
    // eram mais de mil numa loja de verdade, e a lista sempre mostrou 8
    expect(chamadas).toContain("suggestions.slice(0, LIMITE_CHAMADAS)");
    expect(chamadas).toContain("naTela.map((s) => s.customerId)");
  });
});

describe("o filtro de data aparece UMA vez", () => {
  it("o Dashboard não tem mais o formulário De/Até duplicado no cabeçalho", () => {
    // a tela mostrava dois blocos De/Até + Filtrar, um debaixo do outro
    expect(dash).not.toContain('<input type="date" name="de"');
  });
});

describe("as telas de números abrem no MESMO período (auditoria 27/08/2026)", () => {
  // Os Relatórios abriam em 90 dias e as demais em 30: quem abria duas telas
  // lado a lado sem mexer no filtro via faturamentos diferentes — cada uma
  // certa pelo próprio rótulo, e nenhuma explicando a diferença.
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const relatorios = ler("src/app/(app)/relatorios/page.tsx");
  const csv = ler("src/app/api/export/relatorio/route.ts");
  const marketing = ler("src/app/(app)/marketing/page.tsx");

  it("Relatórios abre em 30 dias de CALENDÁRIO (nada de 90 dias no braço)", () => {
    expect(relatorios).toContain("ultimosDiasSP(30)");
    expect(relatorios).not.toContain("90 * 24 * 60 * 60 * 1000");
    expect(relatorios).toContain("últimos 30 dias");
  });

  it("a planilha abre no MESMO período da tela (senão são duas verdades)", () => {
    expect(csv).toContain("ultimosDiasSP(30)");
    expect(csv).not.toContain("90 * 24 * 60 * 60 * 1000");
  });

  it("o atalho aceso ao abrir é o de 30 dias (sem rótulo 'tudo' próprio)", () => {
    expect(relatorios).toContain('<PeriodChips pathname="/relatorios" de={de} ate={ate} />');
  });

  it("Dashboard e Marketing também abrem em 30 dias (têm a conta própria)", () => {
    // não usam `lerPeriodo`: se alguém mexer no padrão de uma delas, as telas
    // voltam a divergir — e este teste é quem avisa
    expect(dash).toContain("30 * 24 * 60 * 60 * 1000");
    expect(marketing).toContain("30 * 864e5");
    expect(dash).not.toContain("90 * 24 * 60 * 60 * 1000");
    expect(marketing).not.toContain("90 * 24 * 60 * 60 * 1000");
  });
});

describe("o padrão de 30 dias começa à MEIA-NOITE de São Paulo", () => {
  it("ultimosDiasSP(30) cobre 30 dias inteiros, do primeiro ao último", () => {
    const p = ultimosDiasSP(30);
    // começa às 00:00 SP (03:00Z) e termina às 23:59:59.999 SP
    expect(p.from.toISOString()).toMatch(/T03:00:00\.000Z$/);
    expect(p.to.toISOString()).toMatch(/T02:59:59\.999Z$/);
    const dias = (p.to.getTime() - p.from.getTime()) / 86_400_000;
    expect(dias).toBeCloseTo(30, 3);
  });

  it("é o MESMO recorte do atalho '30 dias' (clicar no aceso não muda nada)", () => {
    // o atalho manda de = 29 dias atrás, até = hoje
    const DIA = 86_400_000;
    const hoje = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date());
    const iso = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
    const p = ultimosDiasSP(30);
    expect(iso(p.from)).toBe(iso(new Date(Date.parse(`${hoje}T12:00:00Z`) - 29 * DIA)));
    expect(iso(p.to)).toBe(hoje);
  });
});
