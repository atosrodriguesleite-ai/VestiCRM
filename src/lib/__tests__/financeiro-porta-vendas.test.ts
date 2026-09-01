// Guarda RN-031
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTOR_SISTEMA,
  ORIGEM_ETIQUETA,
  ORIGEM_PEDIDO,
  codigoDaCategoriaDeVenda,
  decidirAcaoDaPorta,
  type EstadoDoLancamento,
} from "../financeiro/porta-vendas";
import { CATEGORIAS_PADRAO } from "../financeiro/cadastros";

/**
 * RN-031 · A porta única de entrada das vendas. Os testes percorrem a MÁQUINA
 * DE ESTADOS (regra pura): é o comportamento do dinheiro que é guardado aqui,
 * não o texto do código — guarda que descreve o código protege o erro em vez
 * de impedi-lo (lição do incidente de 28/08/2026).
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Um lançamento zerado; cada teste muda só o que interessa. */
const lanc = (over: Partial<EstadoDoLancamento> = {}): EstadoDoLancamento => ({
  existe: true,
  valor: 530,
  cancelado: false,
  canceladoPelaPorta: false,
  saldo: 530,
  temBaixaManualViva: false,
  temBaixaAutomaticaViva: false,
  ...over,
});

const semLancamento = lanc({ existe: false, valor: 0, saldo: 0 });

describe("qual categoria recebe a venda (RN-031)", () => {
  it("loja online e marketplaces têm categoria própria", () => {
    expect(codigoDaCategoriaDeVenda("NUVEMSHOP", null)).toBe("01.03");
    expect(codigoDaCategoriaDeVenda("NUVEMSHOP", "VAREJO")).toBe("01.03");
  });

  it("pedido do sistema/catálogo cai em atacado ou varejo conforme a tabela", () => {
    expect(codigoDaCategoriaDeVenda("CATALOGO", "ATACADO")).toBe("01.01");
    expect(codigoDaCategoriaDeVenda("CATALOGO", "VAREJO")).toBe("01.02");
    expect(codigoDaCategoriaDeVenda("MANUAL", null)).toBe("01.01");
  });

  it("todo código usado EXISTE na árvore padrão e é do lado certo", () => {
    const usados: [string, "RECEITA" | "DESPESA"][] = [
      [codigoDaCategoriaDeVenda("NUVEMSHOP", null), "RECEITA"],
      [codigoDaCategoriaDeVenda("CATALOGO", "ATACADO"), "RECEITA"],
      [codigoDaCategoriaDeVenda("CATALOGO", "VAREJO"), "RECEITA"],
      ["04.02", "DESPESA"], // frete e envios (a etiqueta comprada)
    ];
    for (const [codigo, tipo] of usados) {
      const cat = CATEGORIAS_PADRAO.find((c) => c.codigo === codigo);
      expect(cat, `categoria ${codigo} não existe na árvore padrão`).toBeTruthy();
      expect(cat!.tipo).toBe(tipo);
    }
  });
});

describe("o pedido nasce (RN-031)", () => {
  it("aguardando pagamento cria a conta a receber", () => {
    const a = decidirAcaoDaPorta({ status: "AGUARDANDO_PAGAMENTO", valor: 530 }, semLancamento);
    expect(a.criar).toBe(true);
    expect(a.darBaixa).toBeNull();
  });

  it("já pago cria e o recebimento entra junto", () => {
    const a = decidirAcaoDaPorta({ status: "PAGO", valor: 530 }, semLancamento);
    expect(a.criar).toBe(true);
  });

  it("orçamento NÃO vira dinheiro", () => {
    const a = decidirAcaoDaPorta({ status: "ORCAMENTO", valor: 530 }, semLancamento);
    expect(a).toMatchObject({ criar: false, darBaixa: null, cancelar: false });
  });

  it("pedido de valor zero não vira lançamento", () => {
    expect(decidirAcaoDaPorta({ status: "PAGO", valor: 0 }, semLancamento).criar).toBe(false);
  });
});

describe("o pedido vira pago (RN-031)", () => {
  it("dá baixa do que falta", () => {
    const a = decidirAcaoDaPorta({ status: "PAGO", valor: 530 }, lanc());
    expect(a.darBaixa).toBe(530);
    expect(a.criar).toBe(false);
  });

  it("com SINAL registrado à mão, baixa só o restante", () => {
    // antes o sinal manual travava a baixa e o pedido pago ficava "atrasado"
    const a = decidirAcaoDaPorta(
      { status: "PAGO", valor: 530 },
      lanc({ saldo: 330, temBaixaManualViva: true })
    );
    expect(a.darBaixa).toBe(330);
    expect(a.estornarAutomaticas).toBe(false);
  });

  it("já quitado não baixa de novo (o gateway reenvia o mesmo aviso)", () => {
    const a = decidirAcaoDaPorta(
      { status: "PAGO", valor: 530 },
      lanc({ saldo: 0, temBaixaAutomaticaViva: true })
    );
    expect(a.darBaixa).toBeNull();
  });

  it("ENTREGUE e os outros status pagos contam como pago", () => {
    for (const status of ["PAGO", "EM_PRODUCAO", "SEPARACAO", "ENVIADO", "ENTREGUE"]) {
      expect(decidirAcaoDaPorta({ status, valor: 530 }, lanc()).darBaixa).toBe(530);
    }
  });
});

describe("o pedido volta atrás (RN-031)", () => {
  it("voltou para aguardando: estorna só a baixa automática", () => {
    const a = decidirAcaoDaPorta(
      { status: "AGUARDANDO_PAGAMENTO", valor: 530 },
      lanc({ saldo: 0, temBaixaAutomaticaViva: true })
    );
    expect(a.estornarAutomaticas).toBe(true);
    expect(a.cancelar).toBe(false);
  });

  it("cancelou: estorna a automática e cancela o lançamento", () => {
    const a = decidirAcaoDaPorta(
      { status: "CANCELADO", valor: 530 },
      lanc({ saldo: 0, temBaixaAutomaticaViva: true })
    );
    expect(a).toMatchObject({ estornarAutomaticas: true, cancelar: true });
  });

  it("VOLTOU A ORÇAMENTO também desfaz — não fica dinheiro que nunca entrou", () => {
    const a = decidirAcaoDaPorta(
      { status: "ORCAMENTO", valor: 530 },
      lanc({ saldo: 0, temBaixaAutomaticaViva: true })
    );
    expect(a).toMatchObject({ estornarAutomaticas: true, cancelar: true });
  });

  it("cancelar já cancelado não faz nada (nem reescreve a data)", () => {
    const a = decidirAcaoDaPorta({ status: "CANCELADO", valor: 530 }, lanc({ cancelado: true }));
    expect(a).toMatchObject({ cancelar: false, aviso: null, estornarAutomaticas: false });
  });
});

describe("o que a lojista fez na mão é dela (RN-031)", () => {
  it("cancelar pedido com baixa MANUAL: avisa e não mexe", () => {
    const a = decidirAcaoDaPorta(
      { status: "CANCELADO", valor: 530 },
      lanc({ saldo: 0, temBaixaManualViva: true })
    );
    expect(a.cancelar).toBe(false);
    expect(a.estornarAutomaticas).toBe(false);
    expect(a.aviso).toMatch(/à mão/);
  });

  it("lançamento cancelado PELA LOJISTA não é ressuscitado", () => {
    const a = decidirAcaoDaPorta(
      { status: "PAGO", valor: 530 },
      lanc({ cancelado: true, canceladoPelaPorta: false })
    );
    expect(a.reativar).toBe(false);
    expect(a.aviso).toMatch(/cancelado à mão/);
  });

  it("cancelado PELA PORTA é reativado quando o pedido volta a valer", () => {
    const a = decidirAcaoDaPorta(
      { status: "PAGO", valor: 530 },
      lanc({ cancelado: true, canceladoPelaPorta: true })
    );
    expect(a.reativar).toBe(true);
    expect(a.darBaixa).toBe(530);
  });
});

describe("o pedido muda de valor (RN-031)", () => {
  it("o lançamento acompanha o novo total", () => {
    const a = decidirAcaoDaPorta({ status: "AGUARDANDO_PAGAMENTO", valor: 450 }, lanc({ valor: 100, saldo: 100 }));
    expect(a.novoValor).toBe(450);
  });

  it("se já estava pago, refaz a baixa no valor novo", () => {
    const a = decidirAcaoDaPorta(
      { status: "PAGO", valor: 450 },
      lanc({ valor: 100, saldo: 0, temBaixaAutomaticaViva: true })
    );
    expect(a.novoValor).toBe(450);
    expect(a.estornarAutomaticas).toBe(true);
    expect(a.darBaixa).toBe(450);
  });

  it("com baixa manual, NÃO reescreve: avisa a lojista", () => {
    const a = decidirAcaoDaPorta(
      { status: "PAGO", valor: 450 },
      lanc({ valor: 100, saldo: 0, temBaixaManualViva: true })
    );
    expect(a.novoValor).toBeNull();
    expect(a.aviso).toMatch(/450/);
  });

  it("valor igual não mexe em nada", () => {
    const a = decidirAcaoDaPorta({ status: "AGUARDANDO_PAGAMENTO", valor: 530 }, lanc());
    expect(a).toMatchObject({ novoValor: null, darBaixa: null, cancelar: false });
  });
});

describe("a porta é a única entrada e nunca atrapalha a venda (RN-031)", () => {
  it("todos os pontos de venda passam por ela, e nenhum escreve por fora", () => {
    const pontos = [
      "src/lib/settle-order.ts",
      "src/lib/nuvemshop.ts",
      "src/app/api/orders/route.ts",
      "src/app/api/orders/[id]/route.ts",
      "src/app/api/catalog/order/route.ts",
    ];
    for (const p of pontos) {
      const t = ler(p);
      expect(t, `${p} não passa pela porta`).toContain("sincronizarPedidoSemQuebrar");
      expect(t, `${p} escreve no financeiro por fora da porta`).not.toContain(
        "db.finLancamento.create"
      );
    }
    const frete = ler("src/app/api/orders/[id]/frete/route.ts");
    expect(frete).toContain("registrarEtiquetaSemQuebrar");
    expect(frete).toContain("cancelarEtiquetaSemQuebrar");
    expect(frete).not.toContain("db.finLancamento.create");
  });

  it("o trabalho vai para o after() do Next — sem ele a Vercel congela e a venda some", () => {
    const motor = ler("src/lib/financeiro/porta-vendas.ts");
    expect(motor).toContain('import { after } from "next/server"');
    // as três funções seguras precisam do after, não de chamada solta
    const seguras = motor.slice(motor.indexOf("o jeito seguro de chamar"));
    expect((seguras.match(/after\(\(\) =>/g) ?? []).length).toBe(3);
  });

  it("as marcas que a porta usa para reconhecer o que é dela", () => {
    expect(AUTOR_SISTEMA).toBe("Sistema");
    expect(ORIGEM_PEDIDO).toBe("PEDIDO");
    expect(ORIGEM_ETIQUETA).toBe("ETIQUETA");
    expect(ler("prisma/schema.prisma")).toContain("@@unique([companyId, origem, origemId])");
  });

  it("a venda entra pelo `total` com o marcador frete-ok (RN-002)", () => {
    expect(ler("src/lib/financeiro/porta-vendas.ts")).toContain("frete-ok");
  });
});

describe("nenhum número some, venha o que vier do pedido (RN-031)", () => {
  const ler = (rel: string) =>
    readFileSync(join(process.cwd(), rel), "utf8");

  it("pedido APAGADO cancela o lançamento — sem dinheiro fantasma no extrato", () => {
    const porta = ler("src/lib/financeiro/porta-vendas.ts");
    expect(porta).toContain("export async function apagarPedidoDoFinanceiro");
    // o after() dispara mesmo quando a exclusão falhou no meio: com o pedido
    // ainda de pé, nada é cancelado
    expect(porta).toContain("pedido-ainda-existe");
    // e loja sem o módulo não muda em NADA, nem no apagar (RN-027)
    expect(porta).toMatch(/apagarPedidoDoFinanceiro[\s\S]*?financeEnabled/);
    // baixa manual é da lojista: o lançamento fica, com aviso
    expect(porta).toContain("O pedido foi APAGADO, mas há baixa registrada à mão");
    // e as DUAS portas de exclusão chamam
    expect(ler("src/app/api/orders/[id]/route.ts")).toContain(
      "apagarPedidoDoFinanceiroSemQuebrar"
    );
    expect(ler("src/app/api/opportunities/[id]/route.ts")).toContain(
      "apagarPedidoDoFinanceiroSemQuebrar"
    );
  });

  it("corrigir a DATA da venda é ato EXPLÍCITO — pagamento atrasado não muda competência", () => {
    const porta = ler("src/lib/financeiro/porta-vendas.ts");
    // a função própria existe e roda em transação (metade movida não se conserta)
    expect(porta).toContain("export async function corrigirDataDaVendaNoFinanceiro");
    expect(porta).toMatch(/corrigirDataDaVendaNoFinanceiro[\s\S]*?db\.\$transaction/);
    // baixa que mudou de dia solta a conciliação (RN-035)
    expect(porta).toMatch(/corrigirDataDaVendaNoFinanceiro[\s\S]*?finOfxVinculo\.deleteMany/);
    // e o sincronizar COMUM não mexe na data de lançamento que JÁ EXISTE
    // (criar novo tem competência, claro): a venda de agosto paga em outubro
    // continua sendo competência de agosto (RN-034)
    const depoisDoCriar = porta.slice(
      porta.indexOf("// ---- só um aviso"),
      porta.indexOf("export async function corrigirDataDaVendaNoFinanceiro")
    );
    expect(depoisDoCriar.length).toBeGreaterThan(100);
    expect(depoisDoCriar).not.toContain("competencia:");
    // só a tela de corrigir data chama
    expect(ler("src/app/api/orders/[id]/data-da-venda/route.ts")).toContain(
      "corrigirDataDaVendaSemQuebrar"
    );
  });

  it("unificar contatos leva o financeiro junto (a conta não fica 'Sem cliente')", () => {
    const merge = ler("src/lib/merge-contacts.ts");
    expect(merge).toContain("tx.finLancamento.updateMany({ where: { customerId: dupeId }");
    expect(merge).toContain("tx.finRecorrencia.updateMany({ where: { customerId: dupeId }");
  });
});
