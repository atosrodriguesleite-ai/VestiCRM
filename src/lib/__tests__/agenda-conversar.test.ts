import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AGENDA → CONVERSAR DENTRO DO SISTEMA — pedido do dono (04/08/2026).
 *
 * O botão "Chamar no WhatsApp" abria o APLICATIVO: a conversa acontecia fora
 * da Central (sem registro, sem dona, sem histórico). E a sugestão cumprida
 * continuava na tela, cobrando um contato que já tinha sido feito.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("o botão da Agenda abre a conversa DENTRO da Central", () => {
  const board = ler("src/app/(app)/tarefas/task-board.tsx");

  it("sugestão e tarefa usam a porta interna (POST /api/conversations)", () => {
    expect(board).toContain('fetch("/api/conversations"');
    expect(board).toContain("conversarNoSistema(s.customerId, s.mensagem)");
    expect(board).toContain("conversarNoSistema(t.customer!.id, t.customer!.mensagem)");
  });

  it("leva a mensagem sugerida já pronta para o campo de digitação", () => {
    expect(board).toContain("texto=${encodeURIComponent(mensagem)}");
  });

  it("nenhum botão da Agenda abre mais o aplicativo (wa.me sumiu dos cartões)", () => {
    expect(board).not.toContain("waHref(s.phone");
    expect(board).not.toContain("waHref(t.customer.phone");
  });
});

describe("a Central recebe quem chega da Agenda", () => {
  const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");

  it("conversa recém-criada que a lista não conhece é buscada inteira", () => {
    expect(inbox).toContain("fetch(`/api/conversations/${cid}`)");
  });

  it("?texto= entra no campo UMA vez (não sobrescreve o que a vendedora digitar)", () => {
    expect(inbox).toContain('searchParams.get("texto")');
    expect(inbox).toContain("prefillFeito.current = true");
  });
});

describe("sugestão cumprida some sozinha — em TODAS as listas", () => {
  it("o filtro mora no motor (Dashboard, Agenda e Automações herdam igual)", () => {
    const motor = ler("src/lib/automations.ts");
    expect(motor).toContain("lastOutboundAt: { gte: inicioHoje }");
    expect(motor).toContain("!jaChamadas.has(s.customerId)");
    expect(motor).toContain("T03:00:00Z"); // meia-noite de SP, não do servidor
  });

  it("tarefa de CONTATO se conclui sozinha quando a mensagem sai", () => {
    const lib = ler("src/lib/contato-feito.ts");
    // cobrança e entrega ficam DE FORA: mensagem não é pagamento nem entrega
    expect(lib).not.toContain("COBRAR_PAGAMENTO");
    expect(lib).not.toContain("CONFIRMAR_ENTREGA");
    // só o que está para hoje ou atrasado — compromisso futuro fica de pé
    expect(lib).toContain("dueAt: { lt: fimDeHojeSP(agora) }");
    // agora fecha COM o motivo gravado (revisao 09/08: as duas portas de
    // fechamento automatico explicam igual na tela)
    expect(lib).toContain('data: { status: "CONCLUIDA", autoDoneReason: "CLIENTE_JA_CHAMADO" }');
  });

  it("o gancho dispara no envio pela Central E no eco do celular", () => {
    expect(ler("src/app/api/conversations/[id]/messages/route.ts")).toContain(
      "concluirTarefasDeContato(user.companyId, conv.customerId)"
    );
    const hook = ler("src/app/api/whatsapp/evolution/webhook/[token]/route.ts");
    // duas vezes: eco adotado (resgate) e eco gravado como mensagem nova
    expect(hook.split("concluirTarefasDeContato(companyId, customer.id)").length).toBe(3);
  });

  it("nota interna NÃO conta como contato (a cliente nunca a recebeu)", () => {
    expect(ler("src/app/api/conversations/[id]/messages/route.ts")).toContain(
      'if (parsed.data.kind !== "NOTE") {'
    );
  });
});
