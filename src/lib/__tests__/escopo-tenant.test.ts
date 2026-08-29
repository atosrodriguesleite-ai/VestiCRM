// Guarda RN-027
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O "RLS DO POBRE" — consulta nova sem filtro de loja derruba o build.
 *
 * A RN-013 manda toda consulta filtrar por `companyId`. Isso funciona
 * enquanto ninguém esquece — e um dia alguém esquece. No Postgres existe
 * RLS, que faz o BANCO recusar; com a nossa combinação de ferramentas
 * (Prisma + Neon) ligar RLS de verdade exige amarrar uma sessão de banco a
 * cada requisição e mexeria em tudo (ADR-015). Este guarda entrega quase o
 * mesmo por muito menos risco: o erro não chega a produção porque nem
 * compila.
 *
 * COMO ELE DECIDE que uma consulta está no lugar:
 *  1. o argumento cita `companyId`, OU
 *  2. usa um dos ajudantes de `lib/scope.ts`, OU
 *  3. o `where` vem de uma variável que, no mesmo arquivo, cai em 1 ou 2, OU
 *  4. a linha (ou uma das duas acima) declara `escopo-ok: <motivo>`.
 *
 * O item 4 é a válvula, no mesmo espírito do `frete-ok` da RN-002: existe
 * consulta legítima sem `companyId` — a que filtra pelo PAI já conferido
 * (`where: { orderId: order.id }`, com o pedido buscado dentro da loja) e a
 * que é de plataforma, não de loja. Quem escreve declara o porquê; quem
 * revisa vê o motivo na hora, em vez de ter que reconstruir o raciocínio.
 *
 * LINHA DE BASE: quando o guarda nasceu já havia centenas de consultas assim, quase
 * todas legítimas. Travar o build em todas de uma vez obrigaria a anotar
 * centenas de lugares num empurrão só — o tipo de mexida grande e apressada que gera o
 * bug que ela queria evitar. Então o guarda nasce com a conta de hoje por
 * arquivo e cobra o que vier DEPOIS. A conta só pode DESCER: quem anotar um
 * caso baixa o número, e ele nunca mais sobe. Guarda que aceita crescer não
 * é guarda.
 */

const BASE = join("src", "lib", "__tests__", "escopo-tenant-baseline.json");

/**
 * Operações cobradas.
 *
 * As de CONJUNTO (`findMany`, `count`…) são as óbvias. As de UM REGISTRO
 * (`update`, `delete`, `findUnique`, `upsert`) entraram depois e são o caso
 * mais perigoso de todos: `db.order.update({ where: { id } })` com o id
 * vindo do corpo da requisição é a forma clássica de uma loja escrever no
 * pedido de OUTRA — e o guarda passava batido nelas.
 *
 * O padrão certo aqui é conferir o dono antes (buscar o registro dentro da
 * loja e só então mexer nele) — e é isso que o `escopo-ok` declara.
 */
const OPERACOES = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "updateMany",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "upsert",
]);

const AJUDANTES =
  /\b(tenant|ownedScope|orderScope|conversationScope|taskScope)\s*\(/;

/** Modelos do schema que têm `companyId` — só esses são cobrados. */
function modelosDaLoja(): Set<string> {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const nomes = new Set<string>();
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    if (/^\s*companyId\s/m.test(m[2])) {
      nomes.add(m[1][0].toLowerCase() + m[1].slice(1)); // Order → order
    }
  }
  return nomes;
}

function arquivosDoApp(): string[] {
  const achados: string[] = [];
  const andar = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__") andar(p);
      } else if (/\.tsx?$/.test(e.name)) {
        achados.push(p);
      }
    }
  };
  for (const raiz of ["src/app", "src/lib"]) andar(raiz);
  return achados;
}

/**
 * Tira os blocos `select:` e `include:` do argumento.
 *
 * Sem isso o guarda ficava CEGO: pedir `select: { companyId: true }` — coisa
 * comum e inofensiva — fazia a consulta parecer filtrada. Escolher qual
 * coluna volta não tem nada a ver com de QUEM ela é.
 */
function semSelecao(arg: string): string {
  let saida = "";
  for (let i = 0; i < arg.length; i++) {
    const m = /^(select|include)\s*:\s*\{/.exec(arg.slice(i));
    if (!m) {
      saida += arg[i];
      continue;
    }
    let j = i + m[0].length - 1;
    let nivel = 0;
    for (; j < arg.length; j++) {
      if (arg[j] === "{") nivel++;
      else if (arg[j] === "}" && --nivel === 0) break;
    }
    i = j;
  }
  return saida;
}

/** Fecha os parênteses do argumento da chamada (o objeto do Prisma). */
function argumento(texto: string, aberturaEm: number): string {
  let nivel = 0;
  for (let i = aberturaEm; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")" && --nivel === 0) return texto.slice(aberturaEm, i + 1);
  }
  return texto.slice(aberturaEm);
}

/**
 * `const x = …` do arquivo, para seguir o `where:` que veio de variável.
 *
 * Guarda TODAS as definições com a posição de cada uma — não só a primeira.
 * Com a primeira, um arquivo que declara `const where` filtrado lá em cima e
 * outro `const where` SEM filtro mais abaixo passava verde pelo primeiro: o
 * guarda lia a variável errada e deixava vazar loja.
 */
type Definicao = { pos: number; texto: string };

function definicoes(texto: string): Map<string, Definicao[]> {
  const mapa = new Map<string, Definicao[]>();
  for (const m of texto.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=]{0,120})?=\s*/g)) {
    const fim = m.index! + m[0].length;
    const lista = mapa.get(m[1]) ?? [];
    lista.push({ pos: m.index!, texto: texto.slice(fim, fim + 500) });
    mapa.set(m[1], lista);
  }
  return mapa;
}

/** A definição mais próxima ACIMA do ponto da consulta (a que vale ali). */
function definicaoValida(
  defs: Map<string, Definicao[]>,
  ident: string,
  antesDe: number
): string | null {
  const lista = defs.get(ident);
  if (!lista) return null;
  let melhor: Definicao | null = null;
  for (const d of lista) if (d.pos < antesDe && (!melhor || d.pos > melhor.pos)) melhor = d;
  // nenhuma acima (definida depois, ou vinda de outro arquivo): não dá para
  // afirmar que está filtrada — melhor cobrar do que deixar passar
  return melhor?.texto ?? null;
}

function temEscopo(
  trecho: string,
  defs: Map<string, Definicao[]>,
  antesDe: number,
  prof = 0
): boolean {
  const util = semSelecao(trecho);
  if (util.includes("companyId") || AJUDANTES.test(util)) return true;
  if (prof > 2) return false;

  const identificadores = new Set<string>();
  // `where: filtro` e `...base`
  for (const [, id] of util.matchAll(/(?:\.\.\.|where:\s*)(\w+)\b/g)) identificadores.add(id);
  // ATALHO DE OBJETO — `findMany({ where })`, que é como boa parte do código
  // é escrita aqui. Sem isto o guarda dava alarme falso justamente no jeito
  // mais comum de escrever, e todo mundo aprenderia a calá-lo com `escopo-ok`.
  for (const [, id] of util.matchAll(/\{\s*(where)\s*[,}]/g)) identificadores.add(id);

  for (const ident of identificadores) {
    const def = definicaoValida(defs, ident, antesDe);
    if (def && temEscopo(def, defs, antesDe, prof + 1)) return true;
  }
  return false;
}

/** Declaração explícita, na linha da chamada ou nas duas acima. */
function declarado(linhas: string[], indice: number): boolean {
  return linhas
    .slice(Math.max(0, indice - 2), indice + 1)
    .some((l) => l.includes("escopo-ok"));
}

/** Quantas consultas sem filtro de loja existem NESTE texto. */
function varrer(texto: string, modelos: Set<string>): number {
  const chamada = /\b(?:db|tx|prisma)\.(\w+)\.(\w+)\s*\(/g;
  const linhas = texto.split("\n");
  const defs = definicoes(texto);
  let n = 0;
  for (const m of texto.matchAll(chamada)) {
    if (!modelos.has(m[1]) || !OPERACOES.has(m[2])) continue;
    const arg = argumento(texto, m.index! + m[0].length - 1);
    if (temEscopo(arg, defs, m.index!)) continue;
    if (declarado(linhas, texto.slice(0, m.index).split("\n").length - 1)) continue;
    n++;
  }
  return n;
}

function contarPorArquivo(): Record<string, number> {
  const modelos = modelosDaLoja();
  const conta: Record<string, number> = {};
  for (const caminho of arquivosDoApp()) {
    const n = varrer(readFileSync(caminho, "utf8"), modelos);
    if (n > 0) conta[caminho.split("\\").join("/")] = n;
  }
  return conta;
}

describe("RN-027 · consulta sem filtro de loja não passa", () => {
  const agora = contarPorArquivo();
  // `ATUALIZAR_BASE=1 npx vitest run escopo-tenant` regrava a linha de base.
  // Serve para BAIXAR o número depois de anotar/arrumar um caso — nunca para
  // calar o guarda: quem sobe a conta tem que explicar no pedido de revisão,
  // porque o diff mostra o número subindo.
  if (process.env.ATUALIZAR_BASE === "1") {
    writeFileSync(BASE, JSON.stringify(agora, null, 2) + "\n");
  }
  const base: Record<string, number> = JSON.parse(readFileSync(BASE, "utf8"));

  it("nenhum arquivo ganhou consulta sem filtro de loja", () => {
    const piorou: string[] = [];
    for (const [arquivo, n] of Object.entries(agora)) {
      const teto = base[arquivo] ?? 0;
      if (n > teto) piorou.push(`${arquivo}: ${teto} → ${n}`);
    }
    expect(
      piorou,
      "Consulta nova sem `companyId` (RN-013). Filtre pela loja — ou, se " +
        "o filtro já vem do pai conferido, escreva `// escopo-ok: <motivo>` " +
        "na linha:\n" +
        piorou.join("\n")
    ).toEqual([]);
  });

  it("a linha de base só encolhe — o que foi anotado não volta", () => {
    const desatualizados = Object.entries(base)
      .filter(([arquivo, n]) => (agora[arquivo] ?? 0) < n)
      .map(([arquivo, n]) => `${arquivo}: ${n} → ${agora[arquivo] ?? 0}`);

    expect(
      desatualizados,
      "Consultas foram arrumadas — ótimo. Baixe o número rodando " +
        "`ATUALIZAR_BASE=1 npx vitest run escopo-tenant` para o guarda não " +
        "aceitar que elas voltem:\n" + desatualizados.join("\n")
    ).toEqual([]);
  });

  it("o guarda não se deixa enganar (cada caso já passou batido antes)", () => {
    const modelos = new Set(["order", "customer"]);
    const pega = (codigo: string) => varrer(codigo, modelos);

    // 1. `companyId` no SELECT não é filtro: escolher qual coluna volta não
    //    tem nada a ver com de QUEM ela é.
    expect(
      pega(`db.order.findMany({ where: { status: "PAGO" }, select: { companyId: true } })`)
    ).toBe(1);

    // 2. VARIÁVEL SOMBREADA: vale a definição mais próxima ACIMA, não a
    //    primeira do arquivo. Antes, o `where` filtrado lá em cima cobria o
    //    `where` sem filtro daqui de baixo.
    expect(
      pega(`
        const where = { companyId: user.companyId };
        await db.customer.findMany({ where });
        const where2 = { status: "ATIVO" };
        await db.order.findMany({ where: where2 });
      `)
    ).toBe(1);

    // 3. ATALHO DE OBJETO com filtro é legítimo e NÃO pode dar alarme falso —
    //    é como boa parte do código daqui é escrita.
    expect(
      pega(`
        const where = { companyId: user.companyId, status: "PAGO" };
        await db.order.findMany({ where });
      `)
    ).toBe(0);

    // 4. UM REGISTRO SÓ, por id vindo de fora — o IDOR clássico
    expect(pega(`db.order.update({ where: { id: body.id }, data })`)).toBe(1);
    expect(pega(`db.order.delete({ where: { id } })`)).toBe(1);
    expect(pega(`db.order.findUnique({ where: { id, companyId } })`)).toBe(0);

    // 5. o básico continua valendo
    expect(pega(`db.order.findMany({ where: { companyId: c } })`)).toBe(0);
    expect(pega(`db.order.findMany({ where: orderScope(user) })`)).toBe(0);
    expect(pega(`db.order.findMany({ where: { status: "PAGO" } })`)).toBe(1);
    expect(pega(`// escopo-ok: filtrado pelo pedido já conferido\ndb.order.findMany({ where: { id } })`)).toBe(0);
    // modelo sem companyId não é cobrado
    expect(pega(`db.session.findMany({ where: { id } })`)).toBe(0);
  });

  it("o guarda enxerga de verdade (se parar de enxergar, ele avisa)", () => {
    // Guarda que não pega nada é pior que nenhum: se um dia a varredura
    // parar de casar com o código (mudança de ORM, de estilo de chamada),
    // ela devolveria zero achado e passaria verde para sempre.
    expect(modelosDaLoja().size).toBeGreaterThan(50);
    expect(arquivosDoApp().length).toBeGreaterThan(200);
  });
});
