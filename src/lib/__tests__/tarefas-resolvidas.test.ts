import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  motivoResolvido,
  TEXTO_RESOLVIDO,
  type RetratoDaCliente,
} from "../tarefas-resolvidas";

/**
 * A TAREFA QUE A VIDA JÁ RESOLVEU.
 *
 * Pedido do dono (07/08/2026), com os dois exemplos dele:
 *
 *  1. "Aparece 'chamar fulano'. Só que antes de ver a tarefa eu já tinha
 *      chamado o cliente."
 *  2. "'Gabriel pendente de pagamento'. O Gabriel pagou, eu marquei o pedido
 *      como PAGO — e a tarefa continuava lá dizendo que ele deve."
 *
 * REGRA DE OURO: a prova tem que ser MAIS NOVA que a tarefa. Cliente que
 * pagou mês passado não fecha a cobrança de hoje.
 */

const NASCEU = new Date("2026-08-07T09:00:00-03:00");
const DEPOIS = new Date("2026-08-07T14:00:00-03:00");
const ANTES = new Date("2026-07-01T10:00:00-03:00");

const tarefa = (type: string, over: Record<string, unknown> = {}) => ({
  id: "t1",
  type,
  createdAt: NASCEU,
  customerId: "c1",
  ...over,
});

const vazio: RetratoDaCliente = {
  ultimaMensagemNossa: null,
  pagouEm: null,
  entregueEm: null,
  canceladoEm: null,
};
const retrato = (o: Partial<RetratoDaCliente>): RetratoDaCliente => ({ ...vazio, ...o });

describe("cobrança: o Gabriel pagou", () => {
  it("pagamento DEPOIS da tarefa fecha a cobrança", () => {
    expect(motivoResolvido(tarefa("COBRAR_PAGAMENTO"), retrato({ pagouEm: DEPOIS }))).toBe(
      "PAGAMENTO_CONFIRMADO"
    );
  });

  it("pedido cancelado também encerra — não há mais o que cobrar", () => {
    expect(
      motivoResolvido(tarefa("COBRAR_PAGAMENTO"), retrato({ canceladoEm: DEPOIS }))
    ).toBe("PEDIDO_CANCELADO");
  });

  it("MANDAR MENSAGEM NÃO fecha cobrança — dinheiro não entrou por isso", () => {
    // é a regra que impede o sistema de esconder dinheiro pendente
    expect(
      motivoResolvido(tarefa("COBRAR_PAGAMENTO"), retrato({ ultimaMensagemNossa: DEPOIS }))
    ).toBeNull();
  });

  it("pagamento VELHO não fecha cobrança nova", () => {
    // a compra do mês passado não paga o pedido de hoje
    expect(motivoResolvido(tarefa("COBRAR_PAGAMENTO"), retrato({ pagouEm: ANTES }))).toBeNull();
  });

  it("sem prova nenhuma, a cobrança continua de pé", () => {
    expect(motivoResolvido(tarefa("COBRAR_PAGAMENTO"), vazio)).toBeNull();
  });
});

describe("contato: eu já tinha chamado o cliente", () => {
  it("mensagem enviada depois fecha a tarefa de chamar", () => {
    for (const tipo of ["LIGAR", "FOLLOW_UP", "REATIVAR", "ENVIAR_CATALOGO", "POS_VENDA"]) {
      expect(
        motivoResolvido(tarefa(tipo), retrato({ ultimaMensagemNossa: DEPOIS })),
        tipo
      ).toBe("CLIENTE_JA_CHAMADO");
    }
  });

  it("mensagem ANTES da tarefa não fecha (a tarefa nasceu sabendo)", () => {
    expect(
      motivoResolvido(tarefa("LIGAR"), retrato({ ultimaMensagemNossa: ANTES }))
    ).toBeNull();
  });

  it("cliente que COMPROU encerra o 'reativar' — ela voltou sozinha", () => {
    expect(motivoResolvido(tarefa("REATIVAR"), retrato({ pagouEm: DEPOIS }))).toBe(
      "CLIENTE_JA_COMPROU"
    );
  });

  it("negociação fechada encerra o acompanhamento", () => {
    expect(
      motivoResolvido(tarefa("FOLLOW_UP", { oportunidadeFechadaEm: DEPOIS }), vazio)
    ).toBe("OPORTUNIDADE_FECHADA");
  });
});

describe("entrega: só a entrega encerra", () => {
  it("pedido entregue fecha a confirmação", () => {
    expect(
      motivoResolvido(tarefa("CONFIRMAR_ENTREGA"), retrato({ entregueEm: DEPOIS }))
    ).toBe("PEDIDO_ENTREGUE");
  });

  it("mensagem enviada NÃO fecha — falar não faz a encomenda chegar", () => {
    expect(
      motivoResolvido(
        tarefa("CONFIRMAR_ENTREGA"),
        retrato({ ultimaMensagemNossa: DEPOIS })
      )
    ).toBeNull();
  });

  it("pagamento não fecha confirmação de entrega", () => {
    expect(
      motivoResolvido(tarefa("CONFIRMAR_ENTREGA"), retrato({ pagouEm: DEPOIS }))
    ).toBeNull();
  });
});

describe("todo motivo tem texto em português", () => {
  it("nenhum código vaza para a tela", () => {
    for (const [codigo, texto] of Object.entries(TEXTO_RESOLVIDO)) {
      expect(texto.length, codigo).toBeGreaterThan(5);
      expect(texto).not.toMatch(/[A-Z]{3,}_/); // nada de PAGAMENTO_CONFIRMADO
    }
  });
});

describe("as portas estão ligadas", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("a agenda confere a realidade ao abrir", () => {
    // conferir no evento não basta: evento perdido já causou incidente aqui
    expect(ler("src/app/(app)/tarefas/page.tsx")).toContain(
      "await fecharTarefasResolvidas(user.companyId)"
    );
  });

  it("a tela diz POR QUE a tarefa se fechou sozinha", () => {
    expect(ler("src/app/(app)/tarefas/task-board.tsx")).toContain(
      "Concluída pelo sistema —"
    );
  });

  it("a conferência nunca derruba a tela", () => {
    const lib = ler("src/lib/tarefas-resolvidas.ts");
    expect(/catch \{[\s\S]*?return 0;[\s\S]*?\}/.test(lib)).toBe(true);
    expect(/take: 500/.test(lib)).toBe(true); // agenda gigante não trava
  });

  it("a regra volta a valer depois de um tempo (o motor não emudece)", () => {
    // sem a janela, cada conclusão automática apagaria a regra PARA SEMPRE:
    // "recompra:Maria" concluída hoje calaria a Maria para o resto da vida
    const a = ler("src/lib/automations.ts");
    expect(/JANELA_SILENCIO_MS/.test(a)).toBe(true);
    expect(a).toContain('{ status: "PENDENTE" }');
  });
});
