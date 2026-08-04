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

describe("sugestão cumprida some sozinha", () => {
  it("a Agenda pula quem já recebeu mensagem da loja HOJE (calendário de SP)", () => {
    const page = ler("src/app/(app)/tarefas/page.tsx");
    expect(page).toContain("lastOutboundAt: { gte: inicioHoje }");
    expect(page).toContain("!jaChamadas.has(s.customerId)");
    expect(page).toContain('T03:00:00Z'); // meia-noite de SP, não do servidor
  });
});
