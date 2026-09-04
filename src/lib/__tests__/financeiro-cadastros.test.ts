// Guarda RN-029
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CATEGORIAS_PADRAO,
  conferirDocumentosFornecedor,
  paiDoCodigo,
  proximoCodigo,
} from "../financeiro/cadastros";
import { financeiroLiberado } from "../financeiro/gate";
import type { SessionUser } from "../auth";
import { MODULOS } from "../modulos";

/**
 * RN-029 · Módulo Financeiro: gated por `financeEnabled`, só gerente/admin;
 * loja com a chave desligada não muda em NADA; cadastro não se apaga, se
 * arquiva; a árvore de categorias nasce pronta e íntegra.
 */

const usuario = (role: string) =>
  ({ role, companyId: "loja-1" }) as unknown as SessionUser;

describe("porteira do módulo (RN-029)", () => {
  it("com a chave ligada, entram gerente, admin e super admin", () => {
    for (const role of ["MANAGER", "ADMIN", "SUPERADMIN"]) {
      expect(financeiroLiberado(usuario(role), true)).toBe(true);
    }
  });

  it("vendedora e suporte ficam fora MESMO com a chave ligada", () => {
    // dinheiro da loja é assunto comercial — mesma régua de Relatórios
    for (const role of ["SELLER", "SUPPORT"]) {
      expect(financeiroLiberado(usuario(role), true)).toBe(false);
    }
  });

  it("chave desligada: ninguém entra (a loja não muda em nada)", () => {
    for (const role of ["MANAGER", "ADMIN", "SUPERADMIN", "SELLER", "SUPPORT"]) {
      expect(financeiroLiberado(usuario(role), false)).toBe(false);
    }
  });

  it("TODA rota do módulo passa pela porteira (rota nova sem ela quebra aqui)", () => {
    // varre src/app/api/financeiro inteira: cada route.ts precisa chamar a
    // porteiraFinanceiro — é o que impede uma rota futura de nascer aberta
    const raiz = join(process.cwd(), "src/app/api/financeiro");
    const rotas: string[] = [];
    const varrer = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) varrer(p);
        else if (f === "route.ts") rotas.push(p);
      }
    };
    varrer(raiz);
    expect(rotas.length).toBeGreaterThanOrEqual(10);
    /**
     * A conferência é por HANDLER EXPORTADO, não por arquivo. Olhando só o
     * arquivo, uma rota com GET protegido e um POST novo sem porteira
     * passava verde — e são seis arquivos com dois handlers cada. É a mesma
     * armadilha da "regex frouxa" do guarda de faturamento (auditoria
     * completa do módulo, 03/09/2026).
     */
    let handlers = 0;
    for (const rota of rotas) {
      const codigo = readFileSync(rota, "utf8");
      const partes = codigo.split(/export async function (?=GET|POST|PATCH|PUT|DELETE)/);
      for (const parte of partes.slice(1)) {
        handlers += 1;
        const nome = parte.slice(0, parte.indexOf("("));
        expect(
          parte.includes("porteiraFinanceiro("),
          `${rota} · ${nome} não passa pela porteira do módulo`
        ).toBe(true);
      }
    }
    expect(handlers).toBeGreaterThanOrEqual(rotas.length);
  });

  it("TODA TELA do módulo passa pela porteira (RN-029)", () => {
    // as páginas repetiam as seis linhas da porteira à mão e NENHUM teste as
    // varria: uma tela nova que esquecesse uma das duas chaves entrava em
    // produção sem guarda, e uma vendedora (ou uma loja sem o módulo) veria
    // a tela de dinheiro (auditoria completa do módulo, 03/09/2026)
    const raiz = join(process.cwd(), "src/app/(app)/financeiro");
    const telas: string[] = [];
    const varrer = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) varrer(p);
        else if (f === "page.tsx") telas.push(p);
      }
    };
    varrer(raiz);
    expect(telas.length).toBeGreaterThanOrEqual(10);
    // a página pode passar a bola para um componente local (Contas a Pagar e
    // Contas a Receber são a MESMA página, mudando só o tipo): a porteira
    // vale se estiver nela ou no componente para onde ela delega
    const guardada = (arquivo: string, seguir = true): boolean => {
      const codigo = readFileSync(arquivo, "utf8");
      if (codigo.includes("porteiraFinanceiroTela(")) return true;
      // a tela raiz decide entre o painel do módulo e a lista antiga de
      // pedidos a receber, então usa a régua pura em vez do redirect
      if (codigo.includes("financeiroLiberado(") && codigo.includes("isManagerUp("))
        return true;
      if (!seguir) return false;
      const vizinhos = [...codigo.matchAll(/from "(\.[^"]+)"/g)].map((m) => m[1]);
      return vizinhos.some((rel) => {
        for (const ext of [".tsx", ".ts"]) {
          const alvo = join(dirname(arquivo), rel + ext);
          if (existsSync(alvo) && guardada(alvo, false)) return true;
        }
        return false;
      });
    };
    for (const tela of telas) {
      expect(guardada(tela), `${tela} não passa pela porteira do módulo`).toBe(true);
    }
  });

  it("nenhuma rota do módulo tem DELETE, exceto o anexo", () => {
    // Cadastro se ARQUIVA e lançamento se CANCELA — apagar quebraria extrato,
    // DRE e conciliação. A ÚNICA exceção declarada é o anexo: anexou o boleto
    // errado, tem que poder tirar (e a remoção fica no histórico). Mesma régua
    // já usada no documento da ficha de funcionário (RN-025).
    const PODEM_APAGAR = ["anexos"];
    const raiz = join(process.cwd(), "src/app/api/financeiro");
    const varrer = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? varrer(p) : f === "route.ts" ? [p] : [];
      });
    for (const rota of varrer(raiz)) {
      const temDelete = /export\s+(async\s+)?function\s+DELETE/.test(
        readFileSync(rota, "utf8")
      );
      const liberada = PODEM_APAGAR.some((p) => rota.includes(`/${p}/`));
      if (temDelete)
        expect(liberada, `${rota} exporta DELETE sem estar na exceção`).toBe(true);
    }
  });

  it("o módulo está no catálogo com a chave e o preço combinados (R$ 160)", () => {
    const fin = MODULOS.find((m) => m.key === "FINANCEIRO");
    expect(fin?.flag).toBe("financeEnabled");
    expect(fin?.precoTabela).toBe(160);
  });
});

describe("árvore de categorias padrão", () => {
  it("códigos únicos, no formato numerado (01, 01.01…)", () => {
    const codigos = CATEGORIAS_PADRAO.map((c) => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of codigos) expect(c).toMatch(/^\d{2}(\.\d{2})*$/);
  });

  it("toda filha tem a mãe NA árvore e herda o tipo dela", () => {
    // categoria de receita debaixo de despesa faria o DRE somar errado
    const porCodigo = new Map(CATEGORIAS_PADRAO.map((c) => [c.codigo, c]));
    for (const c of CATEGORIAS_PADRAO) {
      const paiCodigo = paiDoCodigo(c.codigo);
      if (paiCodigo === null) continue;
      const pai = porCodigo.get(paiCodigo);
      expect(pai, `${c.codigo} sem mãe na árvore`).toBeTruthy();
      expect(pai!.tipo).toBe(c.tipo);
    }
  });

  it("tem o essencial de uma loja de moda: tecido, facção, comissão, frete, taxas", () => {
    const nomes = CATEGORIAS_PADRAO.map((c) => c.nome.toLowerCase()).join(" | ");
    for (const esperado of ["tecido", "facção", "comiss", "frete", "maquininha"]) {
      expect(nomes).toContain(esperado);
    }
  });
});

describe("numeração no servidor (código nunca é digitado)", () => {
  it("acha o próximo número livre debaixo da mãe", () => {
    expect(proximoCodigo(["05.01", "05.02", "05.09"], "05")).toBe("05.10");
    expect(proximoCodigo([], "03")).toBe("03.01");
  });

  it("no topo, continua depois do maior grupo", () => {
    expect(proximoCodigo(["01", "02", "06", "06.03"], null)).toBe("07");
  });

  it("não se confunde com níveis mais fundos nem com outros ramos", () => {
    // "05.01.07" é neta — não pode empurrar o número das filhas de "05"
    expect(proximoCodigo(["05.01", "05.01.07", "04.09"], "05")).toBe("05.02");
  });
});

describe("documentos do fornecedor conferidos antes de gravar", () => {
  it("CPF e CNPJ válidos passam; vazio também (documento é opcional)", () => {
    expect(conferirDocumentosFornecedor({ cpf: "529.982.247-25" })).toBeNull();
    expect(conferirDocumentosFornecedor({ cnpj: "11.222.333/0001-81" })).toBeNull();
    expect(conferirDocumentosFornecedor({})).toBeNull();
  });

  it("dígito errado é barrado com mensagem para a tela", () => {
    expect(conferirDocumentosFornecedor({ cpf: "123.456.789-00" })).toMatch(/CPF/);
    expect(conferirDocumentosFornecedor({ cnpj: "11.222.333/0001-80" })).toMatch(/CNPJ/);
  });
});
