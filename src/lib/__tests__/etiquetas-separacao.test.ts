import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aplicarBipe,
  avaliarBipe,
  conciliarContagens,
  declararFalta,
  lerItensDaSeparacao,
  mesclarComGravado,
  pacoteMudou,
  podeConcluir,
  saiuDaFila,
  resumoDaSeparacao,
  STATUS_NA_FILA,
  type ItemDaSeparacao,
} from "../etiquetas/separacao-regra";
import { ean13Interno } from "../etiquetas/ean13";
import { PAID_ORDER_STATUSES } from "../orders";
import { STATUS_QUE_SEGURAM_NA_LOJA } from "../estoque/inventario";

// Guarda RN-060
/**
 * RN-060 — SEPARAÇÃO DE PEDIDO POR LEITOR: O BIPE SÓ ACEITA O QUE ESTÁ NO
 * PEDIDO, NA QUANTIDADE DO PEDIDO, E FICA REGISTRADO QUEM SEPAROU.
 *
 * A regra é pura e a MESMA no navegador (resposta na hora) e no servidor
 * (segunda tranca). Peça errada e peça a mais são recusadas; a conclusão
 * só libera com toda linha fechada — bipada ou declarada em falta.
 */
const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const A = ean13Interno(101);
const B = ean13Interno(102);
const FORA = ean13Interno(999);

function pedido(): ItemDaSeparacao[] {
  return [
    { variantId: "va", rotulo: "Regata Nadador", detalhe: "Preto · G", codigo: A, pedida: 2, bipada: 0, falta: 0 },
    { variantId: "vb", rotulo: "Regata Nadador", detalhe: "Preto · M", codigo: B, pedida: 1, bipada: 0, falta: 0 },
  ];
}

describe("RN-060: o bipe", () => {
  it("aceita a peça do pedido e sobe a contagem daquela linha, uma por bipe", () => {
    const r = avaliarBipe(pedido(), A);
    expect(r.aceito).toBe(true);
    if (!r.aceito) return;
    expect(r.indice).toBe(0);
    expect(r.item.bipada).toBe(1);
    expect(r.completa).toBe(false);
    const depois = aplicarBipe(pedido(), r);
    expect(depois[0].bipada).toBe(1);
    expect(depois[1].bipada).toBe(0);
  });

  it("aceita o que o LEITOR manda: Enter, espaço e lixo em volta caem fora", () => {
    expect(avaliarBipe(pedido(), `${A}\n`).aceito).toBe(true);
    expect(avaliarBipe(pedido(), ` ${B} `).aceito).toBe(true);
  });

  it("RECUSA peça que não está no pedido — a razão de a separação existir", () => {
    const r = avaliarBipe(pedido(), FORA);
    expect(r.aceito).toBe(false);
    if (r.aceito) return;
    expect(r.motivo).toBe("peca-errada");
    expect(r.indice).toBeNull();
  });

  it("RECUSA a peça a mais: linha completa não aceita outro bipe", () => {
    let itens = pedido();
    itens = aplicarBipe(itens, avaliarBipe(itens, B));
    const r = avaliarBipe(itens, B);
    expect(r.aceito).toBe(false);
    if (r.aceito) return;
    expect(r.motivo).toBe("quantidade-a-mais");
    expect(r.indice).toBe(1); // a tela pinta a linha certa
    expect(r.frase).toContain("Preto");
  });

  it("linha com FALTA declarada conta como fechada: não aceita bipe além do que sobrou", () => {
    const itens = declararFalta(pedido(), "va", 1); // pedida 2, falta 1 → cabe só 1 bipe
    const um = aplicarBipe(itens, avaliarBipe(itens, A));
    expect(um[0].bipada).toBe(1);
    const r = avaliarBipe(um, A);
    expect(r.aceito).toBe(false);
  });

  it("código ilegível (dígito verificador errado, leitura truncada) é recusado sem procurar", () => {
    const errado = A.slice(0, 12) + ((Number(A[12]) + 1) % 10);
    expect(avaliarBipe(pedido(), errado)).toMatchObject({ aceito: false, motivo: "codigo-ilegivel" });
    expect(avaliarBipe(pedido(), A.slice(0, 10))).toMatchObject({ aceito: false, motivo: "codigo-ilegivel" });
    expect(avaliarBipe(pedido(), "")).toMatchObject({ aceito: false, motivo: "codigo-ilegivel" });
  });

  it("bipe recusado não muda nada (aplicarBipe devolve a mesma lista)", () => {
    const itens = pedido();
    expect(aplicarBipe(itens, avaliarBipe(itens, FORA))).toBe(itens);
  });
});

describe("RN-060: concluir", () => {
  it("só libera com TODA linha fechada — bipada ou em falta", () => {
    let itens = pedido();
    expect(podeConcluir(itens)).toBe(false);
    itens = aplicarBipe(itens, avaliarBipe(itens, A));
    itens = aplicarBipe(itens, avaliarBipe(itens, A));
    expect(podeConcluir(itens)).toBe(false); // falta a linha B
    itens = aplicarBipe(itens, avaliarBipe(itens, B));
    expect(podeConcluir(itens)).toBe(true);
    expect(resumoDaSeparacao(itens)).toEqual({ pedidas: 3, bipadas: 3, faltas: 0, faltamBipar: 0, completa: true });
  });

  it("a falta declarada fecha a linha e é contada à parte (o pacote sai incompleto, e isso é DITO)", () => {
    let itens = pedido();
    itens = aplicarBipe(itens, avaliarBipe(itens, A));
    itens = declararFalta(itens, "va", 1);
    itens = declararFalta(itens, "vb", 1);
    expect(podeConcluir(itens)).toBe(true);
    expect(resumoDaSeparacao(itens)).toMatchObject({ bipadas: 1, faltas: 2, faltamBipar: 0 });
  });

  it("falta nunca passa do que ainda não foi bipado, nem fica negativa", () => {
    let itens = pedido();
    itens = aplicarBipe(itens, avaliarBipe(itens, A));
    expect(declararFalta(itens, "va", 5)[0].falta).toBe(1);
    expect(declararFalta(itens, "va", -3)[0].falta).toBe(0);
    expect(declararFalta(itens, "va", 1.9)[0].falta).toBe(1);
  });

  it("pedido sem peça com código não conclui (não há o que conferir)", () => {
    expect(podeConcluir([])).toBe(false);
  });
});

describe("RN-060: o que fica gravado e a conciliação na conclusão", () => {
  it("lê a lista gravada e descarta linha torta (nunca derruba a separação)", () => {
    const json = JSON.stringify([
      { variantId: "va", codigo: A, pedida: 2, bipada: 1, falta: 0, rotulo: "R", detalhe: "" },
      { variantId: 7, codigo: A, pedida: 2 },
      "lixo",
      { variantId: "vc", codigo: B, pedida: 1.7, bipada: -2 },
    ]);
    const lidos = lerItensDaSeparacao(json);
    expect(lidos).toHaveLength(2);
    expect(lidos[0]).toMatchObject({ variantId: "va", bipada: 1 });
    expect(lidos[1]).toMatchObject({ variantId: "vc", pedida: 1, bipada: 0, falta: 0 });
    expect(lerItensDaSeparacao("{ torto")).toEqual([]);
    expect(lerItensDaSeparacao(null)).toEqual([]);
  });

  it("concilia: a contagem BIPADA é a do servidor — o navegador não sobe contagem nenhuma", () => {
    const servidor = pedido().map((i) => (i.variantId === "va" ? { ...i, bipada: 1 } : i));
    const r = conciliarContagens(servidor, [{ variantId: "va", falta: 0 }, { variantId: "vb", falta: 0 }]);
    expect(r[0].bipada).toBe(1);
    expect(r[1].bipada).toBe(0);
    // sem bipe confirmado, não conclui — mesmo que o navegador "diga" que bipou
    expect(podeConcluir(r)).toBe(false);
  });

  it("concilia: a falta vem do navegador (decisão de quem está na arara), mas cabe no que sobrou", () => {
    const servidor = pedido().map((i) => (i.variantId === "va" ? { ...i, bipada: 1 } : i));
    const r = conciliarContagens(servidor, [{ variantId: "va", falta: 5 }]);
    expect(r[0]).toMatchObject({ bipada: 1, falta: 1 });
    // linha que o navegador não mandou fica como está
    expect(conciliarContagens(servidor, [])[0]).toMatchObject({ bipada: 1, falta: 0 });
  });

  it("mescla: o pedido de AGORA manda em quantidade e código; o gravado manda na contagem, nunca acima do pedido", () => {
    const gravados = pedido().map((i) => (i.variantId === "va" ? { ...i, bipada: 2, falta: 0 } : { ...i, bipada: 1 }));
    // a lojista tirou uma peça da linha A (2 → 1) e acrescentou a linha C
    const agora: ItemDaSeparacao[] = [
      { ...pedido()[0], pedida: 1 },
      pedido()[1],
      { variantId: "vc", rotulo: "Saia", detalhe: "Rosa · M", codigo: FORA, pedida: 1, bipada: 0, falta: 0 },
    ];
    const m = mesclarComGravado(agora, gravados);
    expect(m.map((i) => [i.variantId, i.bipada])).toEqual([["va", 1], ["vb", 1], ["vc", 0]]);
    // e a peça nova passa a ser aceita no bipe seguinte, sem fechar a separação
    expect(avaliarBipe(m, FORA).aceito).toBe(true);
    // falta gravada além do que sobrou é capada
    const f = mesclarComGravado(agora, [{ ...pedido()[0], bipada: 0, falta: 2 }]);
    expect(f[0].falta).toBe(1);
  });

  it("pedido SEM peça com código conclui como conferido na mão (senão ficava na fila para sempre)", () => {
    expect(podeConcluir([], 0)).toBe(false);
    expect(podeConcluir([], 2)).toBe(true);
    // com peça com código, a falta de código nas outras não afrouxa a régua
    expect(podeConcluir(pedido(), 2)).toBe(false);
  });
});

describe("RN-060: a fila e o registro", () => {
  it("a fila é só de pedido PAGO (RN-001) que ainda está na loja — a interseção com a lista do Estoque, sem terceira lista à mão", () => {
    const esperada = PAID_ORDER_STATUSES.filter((s) => (STATUS_QUE_SEGURAM_NA_LOJA as readonly string[]).includes(s));
    expect([...STATUS_NA_FILA]).toEqual(esperada);
    expect(STATUS_NA_FILA).toEqual(["PAGO", "EM_PRODUCAO", "SEPARACAO"]);
  });

  it("o rascunho é descartado quando o pedido SAI da fila — e só aí", () => {
    expect(saiuDaFila("PAGO", "CANCELADO")).toBe(true);
    expect(saiuDaFila("PAGO", "ORCAMENTO")).toBe(true);
    expect(saiuDaFila("EM_PRODUCAO", "AGUARDANDO_PAGAMENTO")).toBe(true);
    expect(saiuDaFila("SEPARACAO", "ENVIADO")).toBe(true); // saiu da loja: o rascunho (se houver) também não vale
    expect(saiuDaFila("PAGO", "EM_PRODUCAO")).toBe(false);
    expect(saiuDaFila("PAGO", "SEPARACAO")).toBe(false);
    expect(saiuDaFila("ORCAMENTO", "PAGO")).toBe(false);
    expect(saiuDaFila("ORCAMENTO", "CANCELADO")).toBe(false);
  });

  it("pedido editado depois de separado volta para a fila SÓ se o pacote mudou (preço não conta)", () => {
    const antes = [{ variantId: "a", quantity: 2 }, { variantId: "b", quantity: 1 }];
    expect(pacoteMudou(antes, [{ variantId: "b", quantity: 1 }, { variantId: "a", quantity: 2 }])).toBe(false);
    expect(pacoteMudou(antes, [{ variantId: "a", quantity: 3 }, { variantId: "b", quantity: 1 }])).toBe(true);
    expect(pacoteMudou(antes, [{ variantId: "a", quantity: 2 }])).toBe(true);
    expect(pacoteMudou(antes, [...antes, { variantId: "c", quantity: 1 }])).toBe(true);
    // a mesma variação em duas linhas soma
    expect(pacoteMudou(antes, [{ variantId: "a", quantity: 1 }, { variantId: "a", quantity: 1 }, { variantId: "b", quantity: 1 }])).toBe(false);
    // item de texto livre conta pelo nome
    expect(pacoteMudou([{ variantId: null, name: "Brinde", quantity: 1 }], [{ variantId: null, name: "Brinde", quantity: 2 }])).toBe(true);
  });

  it("o servidor é a segunda tranca e o registro é DE VERDADE: o comportamento está no script contra o Postgres", () => {
    // o que não dá para provar sem banco (trava por pedido, status conferido
    // dentro da transação, histórico com quem separou, aviso de falta) vive em
    // scripts/confere-separacao.ts — este teste só garante que ele existe e
    // cobre os casos que a regra promete
    const script = ler("scripts/confere-separacao.ts");
    for (const caso of ["peca-errada", "quantidade-a-mais", "codigo-ilegivel", "RN-007", "CANCELADO", "ENVIADO no meio", "Separado com leitor por", "FALTOU", "gerência"]) {
      expect(script).toContain(caso);
    }
  });

  it("uma separação ativa por pedido no banco (índice parcial) e a tela do bipe usa a regra pura, sem banco", () => {
    // "ativa" = nem concluída nem DESCARTADA: o índice e os filtros do código dizem o mesmo
    const mig = ler("prisma/migrations/20260919100000_separacao_descartada/migration.sql");
    expect(mig).toContain('CREATE UNIQUE INDEX "Separacao_ativa_key" ON "Separacao"("orderId") WHERE "concluidaEm" IS NULL AND "descartadaEm" IS NULL');
    const src = ler("src/lib/etiquetas/separacao.ts");
    expect(src.match(/concluidaEm: null/g)?.length).toBe(src.match(/descartadaEm: null/g)?.length);
    // a área própria tem a porteira do módulo no layout
    expect(ler("src/app/(app)/separacao/layout.tsx")).toContain("porteiraEtiquetasTela()");
    const tela = ler("src/app/(app)/separacao/[orderId]/separar-view.tsx");
    expect(tela).toContain('from "@/lib/etiquetas/separacao-regra"');
    expect(tela).not.toContain('from "@/lib/etiquetas/separacao"');
    // as rotas passam pela porteira do módulo (toda a equipe, com a chave)
    for (const r of ["route.ts", "[orderId]/route.ts", "[orderId]/bipe/route.ts", "[orderId]/falta/route.ts", "[orderId]/concluir/route.ts"]) {
      expect(ler(`src/app/api/etiquetas/separacao/${r}`)).toContain("porteiraEtiquetas()");
    }
  });
});
