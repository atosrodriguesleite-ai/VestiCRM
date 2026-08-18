import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

/**
 * O NAVEGADOR NÃO PODE CARREGAR CÓDIGO DE SERVIDOR (guarda de projeto).
 *
 * Incidente real (17/08/2026): a produção caiu com "Module build failed:
 * node:crypto". Uma biblioteca importada pelo catálogo público — que roda no
 * NAVEGADOR — tinha, no mesmo arquivo, a regra pura e o sorteio de código com
 * `node:crypto` + acesso ao banco. O build local (turbopack) engolia; o da
 * Vercel (webpack) derrubou o deploy inteiro.
 *
 * A revisão de 18/08 mostrou que o problema era MAIOR: duas telas da área
 * logada já empacotavam o Prisma dentro do navegador e só não quebravam por
 * sorte (o `@prisma/client` tem um stub que adia o erro), e o painel de Envio
 * estava a UM import de valor de derrubar tudo pela corrente
 * `melhorenvio → nuvemshop → push → web-push → net/tls`.
 *
 * Guardar duas palavras num arquivo não resolve isso. Este teste faz o que
 * importa: parte de TODO componente `"use client"`, segue os imports de VALOR
 * (import de tipo some na compilação) e falha se a corrente chegar em código
 * que só existe no servidor.
 */

const raiz = process.cwd();
const SRC = join(raiz, "src");

/** Coisas que NUNCA podem chegar ao navegador. */
const PROIBIDOS = [
  /^node:/, // node:crypto, node:fs...
  /^(crypto|fs|path|net|tls|http|https|child_process|os)$/, // os mesmos sem prefixo
  /^@prisma\/client$/,
  /^web-push$/,
  /^sharp$/,
  /^nodemailer$/,
];
/** Arquivos nossos que são "porta do servidor" (quem chegar neles, errou). */
const ARQUIVOS_DE_SERVIDOR = [/\/lib\/db$/, /\/lib\/db\.ts$/];

function listar(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) listar(caminho, out);
    else if (/\.(ts|tsx)$/.test(caminho) && !caminho.includes("__tests__")) out.push(caminho);
  }
  return out;
}

/**
 * Imports de VALOR do arquivo (ignora `import type`, que some no build).
 * Proposital e conservador: pega `import x from`, `import {…} from` e
 * `export … from`, e descarta o que estiver marcado como tipo.
 */
function importsDeValor(codigo: string): string[] {
  const achados: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)(\s+type)?\s+([^;]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo))) {
    const ehTipo = Boolean(m[1]);
    if (ehTipo) continue; // `import type ... from` — apagado na compilação
    const clausula = m[2] ?? "";
    // `import { type A, type B } from x` também é só tipo
    const nomes = clausula.replace(/[{}]/g, "").split(",").map((n) => n.trim()).filter(Boolean);
    const soTipos = nomes.length > 0 && nomes.every((n) => n.startsWith("type "));
    if (soTipos) continue;
    achados.push(m[3]);
  }
  return achados;
}

/** Resolve um import relativo/aliased para um arquivo real do projeto. */
function resolverArquivo(deOnde: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(deOnde), spec);
  else return null; // pacote externo — tratado pela lista de proibidos
  for (const tentativa of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(tentativa) && statSync(tentativa).isFile()) return tentativa;
  }
  return null;
}

/** Segue a corrente de imports e devolve o caminho até o proibido, se houver. */
function correnteAteOServidor(entrada: string): string[] | null {
  const visitados = new Set<string>();
  const fila: { arquivo: string; caminho: string[] }[] = [
    { arquivo: entrada, caminho: [entrada] },
  ];
  while (fila.length) {
    const { arquivo, caminho } = fila.shift()!;
    if (visitados.has(arquivo)) continue;
    visitados.add(arquivo);
    let codigo: string;
    try {
      codigo = readFileSync(arquivo, "utf8");
    } catch {
      continue;
    }
    if (ARQUIVOS_DE_SERVIDOR.some((re) => re.test(arquivo.replace(/\\/g, "/")))) {
      return caminho;
    }
    for (const spec of importsDeValor(codigo)) {
      if (PROIBIDOS.some((re) => re.test(spec))) return [...caminho, spec];
      const alvo = resolverArquivo(arquivo, spec);
      if (alvo) fila.push({ arquivo: alvo, caminho: [...caminho, alvo] });
    }
  }
  return null;
}

const curto = (p: string) => p.replace(`${raiz}/`, "");

describe("nenhum componente do navegador arrasta código de servidor", () => {
  const clientes = listar(SRC).filter((f) => {
    const c = readFileSync(f, "utf8");
    return /^\s*["']use client["']/m.test(c.slice(0, 400));
  });

  it("existe uma quantidade sensata de telas para varrer (o guarda está vivo)", () => {
    expect(clientes.length).toBeGreaterThan(20);
  });

  it("NENHUMA tela chega ao banco, ao node: ou a pacote só-de-servidor", () => {
    const culpados: string[] = [];
    for (const tela of clientes) {
      const corrente = correnteAteOServidor(tela);
      if (corrente) culpados.push(corrente.map(curto).join("\n     → "));
    }
    expect(
      culpados,
      `Tela(s) do navegador puxando código de servidor — é o defeito que ` +
        `derrubou o deploy de 17/08/2026. Separe a parte PURA num arquivo ` +
        `próprio (ver lib/nome-provisorio.ts, lib/recompra-textos.ts, ` +
        `lib/melhorenvio-tipos.ts) ou use \`import type\`:\n\n` +
        culpados.join("\n\n")
    ).toEqual([]);
  });
});
