import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "CLIENTE APAGOU" TEM QUE CHEGAR A QUEM ESTÁ COM A TELA ABERTA.
 *
 * Incidente real (26/08/2026): a cliente apagou uma mensagem; o dono, abrindo
 * a tela depois (carga completa), viu "Cliente apagou esta mensagem" — mas a
 * vendedora, que estava com a Central ABERTA, continuou vendo a mensagem como
 * se nada tivesse acontecido.
 *
 * Motivo: o sync de 3s só entrega conversas cujo `updatedAt` mudou, e os DOIS
 * caminhos por onde o aviso de apagamento chega (o `protocolMessage REVOKE`
 * dentro de `messages.upsert` e o evento `messages.delete`) marcavam só a
 * MENSAGEM — a conversa nunca era tocada, então o sync nunca a entregava.
 * É a mesma família do "editou e não atualizou" e da reação.
 */
const webhook = readFileSync(
  join(
    process.cwd(),
    "src/app/api/whatsapp/evolution/webhook/[token]/route.ts"
  ),
  "utf8"
);

describe("apagar mensagem acorda o sync da inbox", () => {
  it("existe um caminho único que marca E toca a conversa", () => {
    const trecho = webhook.slice(
      webhook.indexOf("async function marcarApagadaPelaCliente"),
      webhook.indexOf("async function marcarApagadaPelaCliente") + 900
    );
    expect(trecho).toContain('data: { revoked: true, revokedBy: "CUSTOMER" }');
    expect(trecho).toContain("db.conversation.updateMany");
    expect(trecho).toContain("updatedAt: new Date()");
  });

  it("os DOIS caminhos do aviso passam por ele", () => {
    // protocolMessage REVOKE (dentro de messages.upsert)
    expect(webhook).toContain(
      "await marcarApagadaPelaCliente(companyId, proto.key.id);"
    );
    // evento messages.delete
    expect(webhook).toContain(
      "matched += await marcarApagadaPelaCliente(companyId, msgId);"
    );
    // e NENHUM caminho marca por fora do helper: um updateMany de revoked
    // solto, em qualquer ponto do arquivo, é o bug voltando. O helper tem
    // exatamente DUAS marcações (cliente e loja) — mais que isso é cópia.
    expect(webhook.split('revokedBy: "CUSTOMER"').length - 1).toBe(1);
    expect(webhook.split('revokedBy: "STORE"').length - 1).toBe(1);
  });

  it("QUEM apagou vem do lado da mensagem, não do aviso", () => {
    // só o autor apaga "para todos": IN = cliente, OUT = loja. Marcar tudo
    // como CUSTOMER fazia "Cliente apagou" aparecer em mensagem que a
    // PRÓPRIA loja apagou pelo celular (achado da revisão).
    const helper = webhook.slice(
      webhook.indexOf("async function marcarApagadaPelaCliente"),
      webhook.indexOf("async function marcarApagadaPelaCliente") + 1600
    );
    expect(helper).toContain('direction: "IN", revoked: false');
    expect(helper).toContain('direction: "OUT", revoked: false');
  });
});
