// Guarda RN-033
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
 * RN-033 · A porta única de entrada das vendas. Os testes percorrem a MÁQUINA
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

describe("qual categoria recebe a venda (RN-033)", () => {
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

describe("o pedido nasce (RN-033)", () => {
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

describe("o pedido vira pago (RN-033)", () => {
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

describe("o pedido volta atrás (RN-033)", () => {
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

describe("o que a lojista fez na mão é dela (RN-033)", () => {
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

describe("o pedido muda de valor (RN-033)", () => {
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

describe("a porta é a única entrada e nunca atrapalha a venda (RN-033)", () => {
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

describe("nenhum número some, venha o que vier do pedido (RN-033)", () => {
  const ler = (rel: string) =>
    readFileSync(join(process.cwd(), rel), "utf8");

  it("pedido APAGADO cancela o lançamento — sem dinheiro fantasma no extrato", () => {
    const porta = ler("src/lib/financeiro/porta-vendas.ts");
    expect(porta).toContain("export async function apagarPedidoDoFinanceiro");
    // o after() dispara mesmo quando a exclusão falhou no meio: com o pedido
    // ainda de pé, nada é cancelado
    expect(porta).toContain("pedido-ainda-existe");
    // e loja sem o módulo não muda em NADA, nem no apagar (RN-029)
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
    // baixa que mudou de dia solta a conciliação (RN-037)
    expect(porta).toMatch(/corrigirDataDaVendaNoFinanceiro[\s\S]*?finOfxVinculo\.deleteMany/);
    // e o sincronizar COMUM não mexe na data de lançamento que JÁ EXISTE
    // (criar novo tem competência, claro): a venda de agosto paga em outubro
    // continua sendo competência de agosto (RN-036)
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

describe("o cancelamento da lojista não ressuscita (RN-033)", () => {
  const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("o dono do cancelamento se prova pela MARCA, nunca por 'parece cancelamento'", () => {
    // o próprio aviso da porta ("este lançamento foi cancelado à mão") casava
    // num teste de texto e era assinado pelo sistema: na rodada seguinte o
    // cancelamento DA LOJISTA passava por 'da porta' e o lançamento voltava
    // com baixa automática — dinheiro que ela mandou embora ressuscitando
    const porta = ler("src/lib/financeiro/porta-vendas.ts");
    expect(porta).toContain("e.descricao.startsWith(MARCA_CANCELAMENTO)");
    expect(porta).not.toContain("/cancelad/i");
  });

  it("a criação trata a corrida de dois avisos ao mesmo tempo", () => {
    // PATCH do pedido e webhook do gateway decidem "criar" juntos: o único do
    // banco segura o segundo e a sincronização RECOMEÇA — senão o pedido pago
    // ficava com lançamento e sem baixa, calado
    const porta = ler("src/lib/financeiro/porta-vendas.ts");
    expect(porta).toContain("return sincronizarPedidoNoFinanceiro(orderId);");
    expect(porta).toContain('e.code === "P2002"');
  });

  it("cartão fica fora de onde o dinheiro anda — no SERVIDOR, não só na tela", () => {
    expect(ler("src/app/api/financeiro/parcelas/[id]/baixas/route.ts")).toContain(
      'conta.tipo === "CARTAO"'
    );
    expect(ler("src/app/api/financeiro/transferencias/route.ts")).toContain(
      'c.tipo === "CARTAO"'
    );
  });
});

/**
 * SEM CONTA PADRÃO, A VENDA PAGA NÃO VIRA DINHEIRO NA CONTA (RN-033).
 *
 * A porta não inventa uma conta — mas escrevia o motivo só no histórico do
 * lançamento, onde ninguém olha: a lojista marcava o pedido como PAGO em
 * Pedidos e via a MESMA venda no card "Atrasado" (relato de 03/09/2026).
 */
describe("a conta padrão que faltava (RN-033)", () => {
  const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const porta = ler("src/lib/financeiro/porta-vendas.ts");

  it("a falta é DITA em vermelho, no painel e no Contas a Receber", () => {
    const aviso = ler("src/app/(app)/financeiro/_visao/aviso-conta-padrao.tsx");
    expect(aviso).toContain("Falta escolher a conta onde o dinheiro das vendas entra");
    expect(aviso).toContain("/financeiro/cadastros");
    // as duas telas onde a lojista repara na falta
    expect(ler("src/app/(app)/financeiro/_visao/painel.tsx")).toContain(
      "<AvisoContaPadrao aviso={avisoConta} />"
    );
    const lista = ler("src/app/(app)/financeiro/_mov/pagina.tsx");
    expect(lista).toContain("<AvisoContaPadrao aviso={avisoConta} />");
    // Contas a PAGAR não fala de venda parada — o aviso é do lado do recebimento
    expect(lista).toContain('tipo === "RECEITA" && (');
  });

  it("o aviso só aparece quando NÃO há conta padrão, e NUNCA derruba a tela", () => {
    const visao = ler("src/lib/financeiro/visao.ts");
    expect(visao).toContain("if (padrao > 0) return SEM_AVISO;");
    // é um aviso, não a resposta da página: uma falha aqui daria 500 no
    // painel E em Contas a Receber ao mesmo tempo
    expect(visao).toContain('console.error("[financeiro] aviso da conta padrão falhou", e);');
    expect(visao).toContain("return SEM_AVISO;");
  });

  it("escolher a conta padrão REPESCA as vendas pagas que ficaram sem baixa", () => {
    // a porta é chamada DE NOVO (é idempotente e continua a única a escrever)
    expect(porta).toContain("export async function repescarVendasSemBaixa");
    expect(porta).toContain("await sincronizarPedidoNoFinanceiro(id)");
    // e com teto por rodada: loja com anos de pedidos não trava a tela
    expect(porta).toContain("export const TETO_REPESCA");
    const criar = ler("src/app/api/financeiro/contas/route.ts");
    expect(criar).toContain("await repescarVendasSemBaixa(porta.user.companyId)");
    expect(criar).toContain("conta.padrao");
    // a conta JÁ está salva: erro na repescagem não pode virar a resposta,
    // senão a lojista clica de novo e nasce uma segunda conta igual
    for (const rota of [
      "src/app/api/financeiro/contas/route.ts",
      "src/app/api/financeiro/contas/[id]/route.ts",
    ]) {
      expect(ler(rota)).toContain('console.error("[contas] repescagem falhou", e);');
      // e FORA da resposta: até 50 sincronizações dentro do POST/PATCH
      // devolveriam timeout com a conta já criada
      expect(ler(rota)).toContain("after(async () => {");
    }
    // no PATCH a condição é "VIROU padrão agora", não "é a padrão": trocar a
    // COR da conta disparava a repescagem inteira dentro da resposta
    expect(ler("src/app/api/financeiro/contas/[id]/route.ts")).toContain(
      "conta.padrao && !eraPadrao"
    );
  });

  it("pedido EM ABERTO não pode encher a janela e esconder a venda paga", () => {
    // todo pedido do catálogo nasce AGUARDANDO_PAGAMENTO e já cria lançamento
    // sem baixa: buscando "os N sem baixa mais novos" e só depois perguntando
    // quais estão pagos, a loja com muitos pedidos em aberto nunca repescava
    expect(porta).toContain("export async function pedidosPagosSemBaixa");
    expect(porta).toContain('o."status"::text = ANY(');
    // o critério é SALDO EM ABERTO — a venda paga com sinal registrado à mão
    // tem baixa e continua devendo o resto
    expect(porta).toMatch(/p\."valor" - COALESCE\(/);
    // e a porta nunca desfaz o estorno da lojista: baixa automática que ela
    // mandou embora não volta na repescagem de carona
    expect(porta).toContain('COALESCE(b2."estornoAutor"');
    // e só entra o que a porta VAI resolver: pedido que mudou de valor tendo
    // baixa viva à mão só ganha aviso, e ficaria na fila para sempre
    expect(porta).toContain('ABS(l."valor" - o."total") > 0.005');
    expect(porta).toContain('b3."autorNome" <> ${AUTOR_SISTEMA}');
    // o filtro do status vem ANTES do teto, na mesma consulta
    const corpo = porta.slice(porta.indexOf("export async function pedidosPagosSemBaixa"));
    expect(corpo.indexOf('o."status"::text')).toBeLessThan(corpo.indexOf("LIMIT"));
    // e o painel bebe da MESMA fonte
    expect(ler("src/lib/financeiro/visao.ts")).toContain(
      "await pedidosPagosSemBaixa(companyId, TETO_AVISO)"
    );
  });

  it("a repescagem também roda DE CARONA no tráfego, sem cron novo (ADR-002)", () => {
    expect(porta).toContain("export async function repescarSemQuebrar");
    for (const tela of [
      "src/app/(app)/financeiro/page.tsx",
      "src/app/(app)/financeiro/_mov/pagina.tsx",
    ]) {
      // no after(): é trabalho de carona, não pode SEGURAR a tela
      expect(ler(tela)).toContain("after(() => repescarSemQuebrar(user.companyId));");
    }
    // e NUNCA derruba a tela: é trabalho de carona, não a resposta da página
    expect(porta).toContain("[porta-vendas] repescagem falhou");
    // com trava de tempo: a lojista abre as três telas em sequência e a
    // consulta não é grátis
    expect(porta).toContain("const MS_ENTRE_VARREDURAS");
    expect(porta).toContain("if (agora - antes < MS_ENTRE_VARREDURAS) return;");
    // erro não vale como "já varri"
    expect(porta).toContain("ultimaVarredura.delete(companyId);");
  });

  it("a baixa recusada pelo índice só sai calada quando o dinheiro já está lá", () => {
    // sinal manual estornado DEPOIS da baixa automática: ainda falta dinheiro
    // na parcela, mas o índice recusa a segunda baixa automática — em
    // silêncio, a parcela ficaria em aberto para sempre e sem rastro
    // a baixa que já existe é AJUSTADA, nunca duplicada — e o quanto ajustar
    // é lido AGORA do banco: somar um valor que envelheceu numa corrida
    // dobraria o dinheiro
    expect(porta).toContain("const falta = parcela ? saldoDaParcela(parcela) : 0;");
    expect(porta).toContain("const novo = round2(viva.valor + falta);");
    expect(porta).toContain("if (falta <= 0.005) return;");
    // baixa que muda de valor solta a conciliação (RN-037)
    expect(porta).toContain("await soltarConciliacaoDaBaixa(viva.id);");
  });

  it("UMA PARCELA, UMA BAIXA AUTOMÁTICA VIVA — quem garante é o banco", () => {
    // o PATCH do pedido e o aviso do gateway chegam juntos, liam o mesmo
    // saldo e cada um criava a sua baixa: a venda de R$ 100 entrava R$ 200
    const migracoes = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260903090000_financeiro_baixa_automatica_unica/migration.sql"
      ),
      "utf8"
    );
    expect(migracoes).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "FinBaixa_parcelaId_automatica_key"');
    expect(migracoes).toContain('WHERE "estornadaEm" IS NULL AND "autorNome" = \'Sistema\'');
    // o back-fill SOMA as automáticas vivas na mais antiga, com teto no que a
    // parcela ainda deve: duas vivas nem sempre são a duplicata da corrida —
    // podem ser 70 + 30 de uma venda de 100 cujo sinal à mão foi estornado, e
    // estornar a de 30 faria a venda paga virar ATRASADA no deploy
    expect(migracoes).toContain("GREATEST(0, LEAST(");
    // e solta a conciliação das parcelas que vão mudar, ANTES de mudá-las
    expect(migracoes.indexOf('DELETE FROM "FinOfxVinculo"')).toBeLessThan(
      migracoes.indexOf('UPDATE "FinBaixa"')
    );
    // e a porta trata a recusa: o P2002 do índice nunca vira erro na venda —
    // a corrida registrou o MESMO dinheiro, então não se soma nada
    expect(porta).toContain('if ((e as { code?: string })?.code === "P2002") return;');
  });
});
