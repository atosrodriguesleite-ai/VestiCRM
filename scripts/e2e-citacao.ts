/**
 * PROVA DE PONTA A PONTA — a resposta CITANDO uma mensagem chega ligada a ela.
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção), passando pelo
 * webhook de verdade, com o aviso no formato que a Evolution v2 manda:
 * o texto com citação é REESCRITO por ela para `conversation` e o
 * `contextInfo` fica solto na raiz do aviso. Foi esse formato que fez a
 * citação não aparecer em produção (09/10/2026) — os testes de antes usavam
 * o formato do aplicativo, com o contextInfo dentro do extendedTextMessage.
 *
 * Com o app rodando (o webhook usa o after() do Next, que só existe dentro
 * de uma requisição de verdade) e apontando o servidor de mídia para o
 * Evolution de mentira que este roteiro sobe na porta 4598:
 *
 *   EVOLUTION_URL=http://127.0.0.1:4598 EVOLUTION_KEY=x npx next dev -p 3999
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" APP_URL=http://127.0.0.1:3999 npx tsx scripts/e2e-citacao.ts
 *
 * Cria a própria loja de teste e a apaga no fim.
 */
import http from "node:http";
import { db } from "@/lib/db";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));

const servidor = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ base64: "QUJDRA==", mimetype: "image/jpeg" }));
});

async function main() {
  await new Promise<void>((r) => servidor.listen(4598, r));
  const app = process.env.APP_URL ?? "http://127.0.0.1:3999";

  const marca = Date.now();
  const company = await db.company.create({
    data: { name: `Loja Citação ${marca}`, slug: `loja-citacao-${marca}` },
  });
  const token = `tok-cit-${marca}`;
  await db.commSettings.create({
    data: {
      companyId: company.id,
      evolutionInstance: "inst-teste",
      evolutionWebhookToken: token,
      activeProvider: "EVOLUTION",
    },
  });
  const jid = "5511977776666@s.whatsapp.net";
  const enviar = async (data: unknown) => {
    const r = await fetch(`${app}/api/whatsapp/evolution/webhook/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert", data }),
    });
    if (!r.ok) throw new Error(`webhook respondeu ${r.status}: ${await r.text()}`);
    await new Promise((res) => setTimeout(res, 300));
  };

  try {
    console.log("\n1) A cliente manda uma foto");
    const fotoId = `FOTO${marca}`;
    await enviar({
      key: { remoteJid: jid, fromMe: false, id: fotoId },
      pushName: "Livia Teste",
      message: { imageMessage: { mimetype: "image/jpeg", caption: "" } },
      messageType: "imageMessage",
    });
    const foto = await db.message.findFirst({ where: { externalId: fotoId } });
    conferir(!!foto, "a foto foi gravada");

    console.log("\n2) Ela responde EM CIMA da foto — formato real da Evolution v2");
    const respId = `RESP${marca}`;
    await enviar({
      key: { remoteJid: jid, fromMe: false, id: respId },
      pushName: "Livia Teste",
      message: { conversation: "2 m e 2g", messageContextInfo: { deviceListMetadata: {} } },
      contextInfo: { stanzaId: fotoId, participant: jid, quotedMessage: { imageMessage: {} } },
      messageType: "conversation",
    });
    const resp = await db.message.findFirst({
      where: { externalId: respId },
      include: { replyTo: { select: { id: true, mediaType: true } } },
    });
    conferir(resp?.body === "2 m e 2g", "a resposta foi gravada com o texto");
    conferir(
      !!resp && resp.replyToId === foto?.id,
      `a resposta está LIGADA à foto (replyToId=${resp?.replyToId ?? "nulo"})`
    );
    conferir(resp?.replyTo?.mediaType === "IMAGE", "a caixinha sabe que a citada é foto (miniatura)");

    console.log("\n3) A loja responde pelo CELULAR citando a resposta dela (eco)");
    const ecoId = `ECO${marca}`;
    await enviar({
      key: { remoteJid: jid, fromMe: true, id: ecoId },
      message: { conversation: "Separado! 😊" },
      contextInfo: { stanzaId: respId, participant: jid },
      messageType: "conversation",
    });
    const eco = await db.message.findFirst({ where: { externalId: ecoId } });
    conferir(!!eco && eco.direction === "OUT", "o eco virou bolha da loja");
    conferir(!!eco && eco.replyToId === resp?.id, "o eco também nasce ligado à citada");

    console.log("\n4) Mensagem comum continua solta");
    const soltaId = `SOLTA${marca}`;
    await enviar({
      key: { remoteJid: jid, fromMe: false, id: soltaId },
      pushName: "Livia Teste",
      message: { conversation: "obrigada" },
      messageType: "conversation",
    });
    const solta = await db.message.findFirst({ where: { externalId: soltaId } });
    conferir(!!solta && solta.replyToId === null, "sem citação, sem ligação");
  } finally {
    await db.company.delete({ where: { id: company.id } }).catch((e) => console.log("limpeza:", e.message));
    servidor.close();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
