/**
 * PROVA DE PONTA A PONTA DA RN-028 — "o arquivo da cliente não se perde".
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção), porque o que se
 * quer provar aqui é a ORDEM das operações e o comportamento da fila — coisas
 * que teste de unidade não enxerga. Foi este roteiro que mostrou que o
 * orçamento de tempo do webhook estava sendo estourado em 11 segundos.
 *
 * Como rodar:
 *
 *   pg_ctl -D /var/lib/postgresql/vesti -o "-p 5433" start
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" npx prisma migrate deploy
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/vesti" npx tsx scripts/e2e-midia-pendente.ts
 *
 * O roteiro cria a própria loja de teste e a apaga no fim.
 *
 * O incidente reproduzido no passo 1: a cliente manda um lote de arquivos e o
 * servidor de conexão TRAVA. Antes, a função morria no meio e as mensagens
 * sumiam. Agora as bolhas têm que estar todas lá.
 */
import http from "node:http";
import { db } from "@/lib/db";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));

/** Servidor Evolution de mentira: o teste decide como ele se comporta. */
let modo: "trava" | "falha" | "entrega" = "trava";
const servidor = http.createServer((req, res) => {
  if (modo === "trava") return; // nunca responde — o incidente
  if (modo === "falha") {
    res.writeHead(500, { "content-type": "application/json" });
    return res.end("{}");
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ base64: "QUJDRA==", mimetype: "image/jpeg" }));
});

async function main() {
  await new Promise<void>((r) => servidor.listen(4599, r));
  process.env.EVOLUTION_URL = "http://127.0.0.1:4599";
  process.env.EVOLUTION_KEY = "chave-de-teste";

  // importa DEPOIS das envs (o módulo lê a configuração ao chamar)
  const { POST } = await import(
    "@/app/api/whatsapp/evolution/webhook/[token]/route"
  );
  const { repescarMidiasPendentes } = await import(
    "@/lib/comm/midia-pendente"
  );

  // ---- cenário ----
  const marca = Date.now();
  const company = await db.company.create({
    data: { name: `Loja Teste ${marca}`, slug: `loja-teste-${marca}` },
  });
  const token = `tok-${marca}`;
  await db.commSettings.create({
    data: {
      companyId: company.id,
      evolutionInstance: "inst-teste",
      evolutionWebhookToken: token,
      activeProvider: "EVOLUTION",
    },
  });

  const fotos = [1, 2, 3, 4].map((i) => ({
    key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: `wamid.FOTO${marca}${i}` },
    pushName: "Cliente Teste",
    message: { imageMessage: { mimetype: "image/jpeg", caption: `foto ${i}` } },
  }));

  console.log("\n1) A cliente manda 4 fotos e o servidor de arquivos TRAVA");
  modo = "trava";
  const t0 = Date.now();
  const req = new Request(`http://localhost/api/whatsapp/evolution/webhook/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "messages.upsert", data: fotos }),
  });
  // @ts-expect-error o handler aceita NextRequest; Request basta para o teste
  await POST(req, { params: Promise.resolve({ token }) });
  const segundos = Math.round((Date.now() - t0) / 1000);
  console.log(`   (o webhook levou ${segundos}s)`);

  const gravadas = await db.message.findMany({
    where: { conversation: { companyId: company.id }, direction: "IN" },
    orderBy: { createdAt: "asc" },
  });
  conferir(
    gravadas.length === 4,
    `as 4 bolhas existem mesmo com o servidor travado (achei ${gravadas.length})`
  );
  conferir(
    gravadas.every((m) => m.mediaPending),
    "todas ficaram marcadas como 'arquivo a caminho'"
  );
  conferir(
    gravadas.every((m) => m.mediaUrl === null),
    "nenhuma inventou arquivo"
  );
  conferir(
    segundos < 60,
    `o webhook respeitou o orçamento e não estourou o tempo da função (${segundos}s < 60s)`
  );

  console.log("\n2) A repesca tenta e o servidor recusa: volta para a fila");
  modo = "falha";
  await db.systemHealth.updateMany({ where: { id: "main" }, data: { midiaRunAt: null } });
  await db.message.updateMany({
    where: { conversation: { companyId: company.id } },
    data: { mediaTries: 0, mediaNextTryAt: null },
  });
  await repescarMidiasPendentes();
  const depoisDaFalha = await db.message.findMany({
    where: { conversation: { companyId: company.id }, mediaTries: { gt: 0 } },
  });
  conferir(depoisDaFalha.length > 0, "a repesca pegou arquivos da fila");
  conferir(
    depoisDaFalha.every((m) => m.mediaPending && m.mediaNextTryAt !== null),
    "quem falhou continua na fila, com hora marcada para tentar de novo"
  );
  conferir(
    depoisDaFalha.every((m) => (m.mediaError ?? "").length > 0),
    "o motivo da falha ficou anotado"
  );

  console.log("\n3) O servidor volta: o arquivo chega e a conversa é tocada");
  modo = "entrega";
  const conv = await db.conversation.findFirstOrThrow({ where: { companyId: company.id } });
  const antes = conv.updatedAt;
  await new Promise((r) => setTimeout(r, 1100)); // relógio do banco anda
  await db.systemHealth.updateMany({ where: { id: "main" }, data: { midiaRunAt: null } });
  await db.message.updateMany({
    where: { conversation: { companyId: company.id } },
    data: { mediaNextTryAt: new Date(Date.now() - 1000) },
  });
  await repescarMidiasPendentes();
  const chegaram = await db.message.findMany({
    where: { conversation: { companyId: company.id }, mediaUrl: { not: null } },
  });
  conferir(chegaram.length > 0, `o arquivo chegou pela repesca (${chegaram.length})`);
  conferir(
    chegaram.every((m) => !m.mediaPending && m.mediaError === null),
    "quem chegou saiu da fila e ficou sem erro"
  );
  conferir(
    chegaram.every((m) => (m.mediaUrl ?? "").startsWith("data:image/jpeg;base64,")),
    "o arquivo veio com o tipo certo"
  );
  const convDepois = await db.conversation.findFirstOrThrow({ where: { id: conv.id } });
  conferir(
    convDepois.updatedAt.getTime() > antes.getTime(),
    "a conversa foi TOCADA (senão o arquivo ficaria invisível na tela até recarregar)"
  );

  console.log("\n4) Esgotadas as tentativas: desiste, avisa e sai da fila");
  modo = "falha";
  const sobrando = await db.message.findFirst({
    where: { conversation: { companyId: company.id }, mediaPending: true },
  });
  if (!sobrando) {
    falha("precisava sobrar uma mensagem pendente para este teste");
  } else {
    await db.message.update({
      where: { id: sobrando.id },
      data: { mediaTries: 99, mediaNextTryAt: new Date(Date.now() - 1000) },
    });
    await db.systemHealth.updateMany({ where: { id: "main" }, data: { midiaRunAt: null } });
    await repescarMidiasPendentes();
    const desistiu = await db.message.findUniqueOrThrow({ where: { id: sobrando.id } });
    conferir(!desistiu.mediaPending, "saiu da fila (não fica batendo para sempre)");
    conferir((desistiu.mediaError ?? "").length > 0, "a bolha sabe dizer por que não chegou");
    const evento = await db.commEvent.findFirst({
      where: { companyId: company.id, type: "midia.nao-chegou" },
    });
    conferir(Boolean(evento), "a desistência ficou registrada na Central de Comunicação");
    // e NÃO no alarme de produção: a trava de 15min do push "erro em
    // produção" é escassa, e um anexo vencido silenciaria uma falha de
    // verdade na mesma janela (achado da revisão)
    const erro = await db.errorLog.findFirst({ where: { source: "wa.midia" } });
    conferir(
      !erro,
      "e NÃO gastou a trava do alarme de produção (que é para falha grave)"
    );
  }

  console.log("\n5) A trava impede duas repescas no mesmo minuto");
  const antesDaTrava = await db.systemHealth.findUnique({ where: { id: "main" } });
  await db.message.updateMany({
    where: { conversation: { companyId: company.id } },
    data: { mediaPending: true, mediaTries: 0, mediaNextTryAt: null },
  });
  await repescarMidiasPendentes(); // deve sair na hora (trava recém-tomada)
  const aindaPendentes = await db.message.count({
    where: { conversation: { companyId: company.id }, mediaPending: true, mediaTries: { gt: 0 } },
  });
  conferir(
    aindaPendentes === 0 && antesDaTrava !== null,
    "a segunda chamada no mesmo minuto não fez nada (trava atômica)"
  );

  console.log("\n6) A loja RECONECTA o WhatsApp: a fila espera, não desiste");
  // achado da revisão: instância zerada (reconexão) fazia a repesca desistir
  // de TODOS os pendentes de uma vez, sem gastar tentativa nenhuma
  modo = "entrega";
  await db.commSettings.update({
    where: { companyId: company.id },
    data: { evolutionInstance: null },
  });
  const naFila = await db.message.findFirstOrThrow({
    where: { conversation: { companyId: company.id } },
  });
  await db.message.update({
    where: { id: naFila.id },
    data: {
      mediaPending: true,
      mediaUrl: null,
      mediaTries: 0,
      mediaError: null,
      mediaNextTryAt: new Date(Date.now() - 1000),
    },
  });
  await db.systemHealth.updateMany({ where: { id: "main" }, data: { midiaRunAt: null } });
  await repescarMidiasPendentes();
  const semConexao = await db.message.findUniqueOrThrow({ where: { id: naFila.id } });
  conferir(
    semConexao.mediaPending,
    "sem conexão, o arquivo CONTINUA na fila (não vira 'não chegou' para sempre)"
  );
  conferir(
    semConexao.mediaTries === 1 && semConexao.mediaNextTryAt !== null,
    "gastou UMA tentativa e marcou hora para tentar de novo"
  );

  console.log("\n7) A conexão volta: o arquivo finalmente chega");
  await db.commSettings.update({
    where: { companyId: company.id },
    data: { evolutionInstance: "inst-teste" },
  });
  await db.message.update({
    where: { id: naFila.id },
    data: { mediaNextTryAt: new Date(Date.now() - 1000) },
  });
  await db.systemHealth.updateMany({ where: { id: "main" }, data: { midiaRunAt: null } });
  await repescarMidiasPendentes();
  const voltou = await db.message.findUniqueOrThrow({ where: { id: naFila.id } });
  conferir(
    !voltou.mediaPending && (voltou.mediaUrl ?? "").startsWith("data:image/"),
    "depois da reconexão o arquivo entrou normalmente"
  );

  // limpeza
  await db.company.delete({ where: { id: company.id } });
  await db.errorLog.deleteMany({ where: { source: "wa.midia" } });
  servidor.close();
  await db.$disconnect();
  console.log(
    process.exitCode ? "\n🔴 ALGO FALHOU\n" : "\n🟢 TODOS OS CENÁRIOS PASSARAM\n"
  );
  process.exit(process.exitCode ?? 0);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
