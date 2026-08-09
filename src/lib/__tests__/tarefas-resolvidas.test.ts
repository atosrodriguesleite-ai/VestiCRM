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
 * REGRAS DE OURO (as três vieram de revisão — cada uma barra um jeito de a
 * conferência ESCONDER trabalho de verdade):
 *  - a prova tem que ser MAIS NOVA que a tarefa;
 *  - pagar o pedido B não fecha a cobrança do pedido A (pendência segura);
 *  - compromisso FUTURO não se fecha por mensagem de hoje.
 */

const NASCEU = new Date("2026-08-07T09:00:00-03:00");
const DEPOIS = new Date("2026-08-07T14:00:00-03:00");
const ANTES = new Date("2026-07-01T10:00:00-03:00");
const AGORA = new Date("2026-08-07T15:00:00-03:00");
/** vence hoje (a tarefa comum da agenda) */
const VENCE_HOJE = new Date("2026-08-07T23:59:00-03:00");
/** compromisso marcado para semana que vem */
const VENCE_SEMANA_QUE_VEM = new Date("2026-08-14T23:59:00-03:00");

const tarefa = (type: string, over: Record<string, unknown> = {}) => ({
  id: "t1",
  type,
  createdAt: NASCEU,
  dueAt: VENCE_HOJE,
  customerId: "c1",
  ...over,
});

const vazio: RetratoDaCliente = {
  ultimaMensagemNossa: null,
  pagouEm: null,
  entregueEm: null,
  canceladoEm: null,
  aindaDevendo: false,
  aindaACaminho: false,
};
const retrato = (o: Partial<RetratoDaCliente>): RetratoDaCliente => ({ ...vazio, ...o });

describe("cobrança: o Gabriel pagou", () => {
  it("pagamento DEPOIS da tarefa fecha a cobrança", () => {
    expect(
      motivoResolvido(tarefa("COBRAR_PAGAMENTO"), retrato({ pagouEm: DEPOIS }), AGORA)
    ).toBe("PAGAMENTO_CONFIRMADO");
  });

  it("PAGAR OUTRO PEDIDO NÃO FECHA — se ainda há pedido esperando dinheiro, a cobrança fica", () => {
    // achado de revisão: Gabriel deve o pedido A e paga o pedido B novo.
    // Sem esta trava, a cobrança do A fechava "porque entrou dinheiro" —
    // exatamente o esconder-dívida que esta função jurou não fazer.
    expect(
      motivoResolvido(
        tarefa("COBRAR_PAGAMENTO"),
        retrato({ pagouEm: DEPOIS, aindaDevendo: true }),
        AGORA
      )
    ).toBeNull();
  });

  it("pedido cancelado também encerra — não há mais o que cobrar", () => {
    expect(
      motivoResolvido(tarefa("COBRAR_PAGAMENTO"), retrato({ canceladoEm: DEPOIS }), AGORA)
    ).toBe("PEDIDO_CANCELADO");
  });

  it("MANDAR MENSAGEM NÃO fecha cobrança — dinheiro não entrou por isso", () => {
    expect(
      motivoResolvido(
        tarefa("COBRAR_PAGAMENTO"),
        retrato({ ultimaMensagemNossa: DEPOIS }),
        AGORA
      )
    ).toBeNull();
  });

  it("pagamento VELHO não fecha cobrança nova", () => {
    expect(
      motivoResolvido(tarefa("COBRAR_PAGAMENTO"), retrato({ pagouEm: ANTES }), AGORA)
    ).toBeNull();
  });

  it("sem prova nenhuma, a cobrança continua de pé", () => {
    expect(motivoResolvido(tarefa("COBRAR_PAGAMENTO"), vazio, AGORA)).toBeNull();
  });
});

describe("contato: eu já tinha chamado o cliente", () => {
  it("mensagem enviada depois fecha a tarefa de chamar (vencendo hoje)", () => {
    for (const tipo of ["LIGAR", "FOLLOW_UP", "REATIVAR", "ENVIAR_CATALOGO", "POS_VENDA"]) {
      expect(
        motivoResolvido(tarefa(tipo), retrato({ ultimaMensagemNossa: DEPOIS }), AGORA),
        tipo
      ).toBe("CLIENTE_JA_CHAMADO");
    }
  });

  it("COMPROMISSO FUTURO NÃO SE FECHA POR MENSAGEM — o adiar depende disso", () => {
    // achado de revisão: a lojista adia o follow-up para semana que vem
    // (a cliente pediu). Hoje ela fala com a mesma cliente sobre OUTRA
    // coisa. O compromisso da semana que vem tem que continuar de pé —
    // senão o botão "adiar" desfaz a si mesmo.
    expect(
      motivoResolvido(
        tarefa("FOLLOW_UP", { dueAt: VENCE_SEMANA_QUE_VEM }),
        retrato({ ultimaMensagemNossa: DEPOIS }),
        AGORA
      )
    ).toBeNull();
  });

  it("'OUTRO' NUNCA fecha sozinha — é o balde do trabalho que não é contato", () => {
    // achado de revisão: "separar a troca da Maria" (tipo OUTRO) não pode
    // fechar porque alguém respondeu a Maria no WhatsApp. Mesma régua do
    // contato-feito.ts, que também exclui OUTRO.
    expect(
      motivoResolvido(tarefa("OUTRO"), retrato({ ultimaMensagemNossa: DEPOIS }), AGORA)
    ).toBeNull();
  });

  it("mensagem ANTES da tarefa não fecha (a tarefa nasceu sabendo)", () => {
    expect(
      motivoResolvido(tarefa("LIGAR"), retrato({ ultimaMensagemNossa: ANTES }), AGORA)
    ).toBeNull();
  });

  it("cliente que COMPROU encerra o 'reativar' — ela voltou sozinha", () => {
    expect(motivoResolvido(tarefa("REATIVAR"), retrato({ pagouEm: DEPOIS }), AGORA)).toBe(
      "CLIENTE_JA_COMPROU"
    );
  });

  it("negociação fechada encerra o acompanhamento", () => {
    expect(
      motivoResolvido(tarefa("FOLLOW_UP", { oportunidadeFechadaEm: DEPOIS }), vazio, AGORA)
    ).toBe("OPORTUNIDADE_FECHADA");
  });
});

describe("entrega: só a entrega encerra", () => {
  it("pedido entregue fecha a confirmação", () => {
    expect(
      motivoResolvido(tarefa("CONFIRMAR_ENTREGA"), retrato({ entregueEm: DEPOIS }), AGORA)
    ).toBe("PEDIDO_ENTREGUE");
  });

  it("com OUTRO pedido ainda na rua, a confirmação fica de pé", () => {
    // mesma lógica da cobrança: a entrega do pedido B não confirma o A
    expect(
      motivoResolvido(
        tarefa("CONFIRMAR_ENTREGA"),
        retrato({ entregueEm: DEPOIS, aindaACaminho: true }),
        AGORA
      )
    ).toBeNull();
  });

  it("mensagem enviada NÃO fecha — falar não faz a encomenda chegar", () => {
    expect(
      motivoResolvido(
        tarefa("CONFIRMAR_ENTREGA"),
        retrato({ ultimaMensagemNossa: DEPOIS }),
        AGORA
      )
    ).toBeNull();
  });

  it("pagamento não fecha confirmação de entrega", () => {
    expect(
      motivoResolvido(tarefa("CONFIRMAR_ENTREGA"), retrato({ pagouEm: DEPOIS }), AGORA)
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
    expect(ler("src/app/(app)/tarefas/page.tsx")).toContain(
      "await fecharTarefasResolvidas(user.companyId)"
    );
  });

  it("a tela diz POR QUE a tarefa se fechou sozinha", () => {
    expect(ler("src/app/(app)/tarefas/task-board.tsx")).toContain(
      "Concluída pelo sistema —"
    );
  });

  it("as DUAS portas de fechamento automático gravam o motivo", () => {
    // achado de revisão: o contato-feito.ts (a porta antiga) fechava sem
    // explicar — as tarefas sumiam caladas, o problema que juramos matar
    expect(ler("src/lib/contato-feito.ts")).toContain(
      'autoDoneReason: "CLIENTE_JA_CHAMADO"'
    );
  });

  it("decisão HUMANA apaga o motivo automático (avulso e em massa)", () => {
    // sem isso, tarefa reaberta e concluída à mão continuava dizendo
    // "Concluída pelo sistema", que vira mentira
    expect(ler("src/app/api/tasks/[id]/route.ts")).toContain("data.autoDoneReason = null");
    expect(ler("src/app/api/tasks/bulk/route.ts")).toContain("autoDoneReason: null");
  });

  it("o carimbo de 'último contato' só vale para tarefa DE CONTATO", () => {
    // concluir 162 tarefas velhas não pode marcar 162 clientes como
    // "falei hoje" — isso silenciaria campanhas e automações da loja
    for (const p of ["src/app/api/tasks/[id]/route.ts", "src/app/api/tasks/bulk/route.ts"]) {
      expect(ler(p), p).toContain("TIPOS_DE_CONTATO");
    }
  });

  it("a prova do dinheiro é SÓ o paidAt (updatedAt mexe em qualquer edição)", () => {
    const lib = ler("src/lib/tarefas-resolvidas.ts");
    expect(lib).toContain("maisNovo(r.pagouEm, o.paidAt)");
    expect(lib).not.toContain("o.paidAt ?? o.updatedAt");
  });

  it("a conferência nunca derruba a tela e varre em ordem fixa", () => {
    const lib = ler("src/lib/tarefas-resolvidas.ts");
    expect(/catch \{[\s\S]*?return 0;[\s\S]*?\}/.test(lib)).toBe(true);
    expect(/take: 500/.test(lib)).toBe(true);
    // sem orderBy, o teto de 500 deixaria um resto aleatório NUNCA conferido
    expect(/orderBy: \{ createdAt: "asc" \}/.test(lib)).toBe(true);
  });

  it("a regra volta a valer depois de um tempo (o motor não emudece)", () => {
    const a = ler("src/lib/automations.ts");
    expect(/JANELA_SILENCIO_MS/.test(a)).toBe(true);
    expect(a).toContain('{ status: "PENDENTE" }');
  });
});
