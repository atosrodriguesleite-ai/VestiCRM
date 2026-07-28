import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAMPO_DATA_FATURAMENTO, CAMPO_VALOR_FATURAMENTO } from "../orders";
import { SLUG_LOJA_DEMO, ehLojaDemo } from "../gestao";

/**
 * VIGIA DA LOJA DE DEMONSTRAÇÃO (scripts/seed-demo.ts).
 *
 * A Bella Moda é a loja que a plataforma usa para APRESENTAR o sistema. Ela
 * ficou semanas mostrando "R$ 0,00" em toda tela de dinheiro porque o script
 * criava pedidos sem `paidAt` e sem `netTotal` — os dois campos que o
 * faturamento passou a somar. Ninguém percebeu porque a demo não tem teste.
 *
 * Este arquivo é essa rede de proteção. Ele não roda o script (isso exigiria
 * banco): lê o código e trava as regras que, quebradas, transformam a demo
 * numa vitrine com números errados — ou, pior, sujam o painel do Super Admin
 * com alarme de loja que não existe.
 */

const fonte = readFileSync(join(process.cwd(), "scripts/seed-demo.ts"), "utf8");

/** Cada bloco `db.<algo>.create({ ... })` do script, separado. */
function blocos(chamada: string): string[] {
  const marca = `db.${chamada}.create({`;
  const out: string[] = [];
  let i = fonte.indexOf(marca);
  while (i >= 0) {
    // fecha no balanço de chaves — pega o objeto inteiro, aninhados incluídos
    let nivel = 0;
    let fim = i + marca.length - 1;
    for (let p = i + marca.length - 1; p < fonte.length; p++) {
      if (fonte[p] === "{") nivel++;
      else if (fonte[p] === "}") {
        nivel--;
        if (nivel === 0) {
          fim = p;
          break;
        }
      }
    }
    out.push(fonte.slice(i, fim + 1));
    i = fonte.indexOf(marca, fim);
  }
  return out;
}

/**
 * O campo aparece como CAMPO DO PEDIDO (`netTotal,` ou `netTotal: x`) — e não
 * só citado dentro de um texto. Sem esse cuidado o teste passava com o campo
 * ausente, porque o nome aparecia na descrição do evento de auditoria.
 */
const gravaCampo = (bloco: string, campo: string) =>
  new RegExp(`\\b${campo}\\s*[,:]`).test(bloco);

describe("demo: o dinheiro dos pedidos", () => {
  it("todo pedido criado grava o VALOR VENDIDO (senão o faturamento dá zero)", () => {
    const pedidos = blocos("order");
    expect(pedidos.length).toBeGreaterThan(1);
    for (const p of pedidos) {
      expect(
        gravaCampo(p, CAMPO_VALOR_FATURAMENTO),
        `pedido da demo sem "${CAMPO_VALOR_FATURAMENTO}": as telas de dinheiro somam por esse campo e mostrariam R$ 0,00`
      ).toBe(true);
    }
  });

  it("pedido pago grava a DATA DO PAGAMENTO", () => {
    // é por paidAt que Dashboard, Relatórios, Comissões e Financeiro somam
    expect(fonte).toContain(`const ${CAMPO_DATA_FATURAMENTO} = pago`);
    for (const p of blocos("order")) {
      const temStatusPago = /status: status as "PAGO"/.test(p);
      if (temStatusPago) expect(gravaCampo(p, CAMPO_DATA_FATURAMENTO)).toBe(true);
    }
  });

  it("o frete nunca entra no valor vendido", () => {
    // netTotal = subtotal − desconto + acréscimo; o frete só entra no total
    expect(fonte).toContain("round2(subtotal - discount + surcharge)");
    expect(fonte).toContain("round2(netTotal + shippingFee)");
  });
});

describe("demo: não pode sujar o painel do Super Admin", () => {
  it("é CORTESIA — fica fora do MRR e fora de 'lojas em risco'", () => {
    const cobranca = blocos("companyBilling")[0] ?? "";
    expect(cobranca).toContain('kind: "CORTESIA"');
    expect(cobranca).toContain("monthlyFee: 0");
  });

  it("não cria instância de WhatsApp (senão o vigia acusa queda de loja fictícia)", () => {
    // lib/health.ts e o painel de Saúde só olham lojas com evolutionInstance
    expect(fonte).not.toMatch(/evolutionInstance:\s*["'`]/);
  });

  it("não deixa a loja marcada como caída", () => {
    expect(fonte).not.toMatch(/evolutionDownSince:\s*(?!null)/);
  });

  it("o painel de Gestão ignora EXATAMENTE a loja que o script cria", () => {
    // se alguém renomear o slug só num lado, a demo volta a somar no
    // faturamento da plataforma sem ninguém perceber
    const slugDoScript = /const DEMO_SLUG = "([^"]+)"/.exec(fonte)?.[1];
    expect(slugDoScript).toBe(SLUG_LOJA_DEMO);
    expect(ehLojaDemo(SLUG_LOJA_DEMO)).toBe(true);
    expect(ehLojaDemo("toque-leve")).toBe(false);
  });
});

describe("demo: a Central de Comunicação abre verde", () => {
  it("nenhum evento de comunicação é criado com erro", () => {
    for (const e of blocos("commEvent")) {
      expect(
        e.includes('status: "ERRO"'),
        "a demo não pode nascer com falha de envio: a tela abriria vermelha na apresentação"
      ).toBe(false);
    }
  });

  it("nota interna não vira evento de WhatsApp (ela nunca sai do sistema)", () => {
    expect(fonte).toContain("if (nota) continue;");
  });
});
