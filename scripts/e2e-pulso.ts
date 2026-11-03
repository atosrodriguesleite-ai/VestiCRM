/**
 * PROVA DE PONTA A PONTA — O PULSO DO WHATSAPP (RN-106).
 *
 * Roda contra um Postgres DE VERDADE (nunca o de produção), com um Evolution
 * de mentira na porta 4599 e o app de verdade (o webhook usa o `after()` do
 * Next, que só existe dentro de uma requisição):
 *
 *   EVOLUTION_URL=http://127.0.0.1:4599 EVOLUTION_KEY=x npx next dev -p 3999
 *   EVOLUTION_URL=http://127.0.0.1:4599 EVOLUTION_KEY=x APP_URL=http://127.0.0.1:3999 npx tsx scripts/e2e-pulso.ts
 *
 * Prova: o teste do eco nas DUAS ordens da corrida (eco antes e depois da
 * resposta do envio), pelo webhook de verdade; a cura automática do webhook
 * calado; o alarme quando a cura não resolve; a queda com o motivo do
 * WhatsApp e a cura pelo webhook; a rede de segurança; o despertador
 * externo. Cria a própria loja de teste e a apaga no fim.
 */
import http from "node:http";
import { db } from "@/lib/db";
import { marcarEnvioSemEco } from "@/lib/comm/pulso-do-webhook";
import { runWatchdogIfDue } from "@/lib/health";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// o Evolution de mentira: tudo responde, e o que importa fica anotado
const chamadas: string[] = [];
let estadoDaInstancia = "open";
// a sessão que só volta com o reinício: "close" até alguém reiniciar
let fechadaAteReiniciar = false;
const servidor = http.createServer((req, res) => {
  chamadas.push(`${req.method} ${req.url}`);
  res.writeHead(200, { "content-type": "application/json" });
  if (req.url?.startsWith("/instance/restart/")) fechadaAteReiniciar = false;
  if (req.url?.startsWith("/instance/connectionState/")) {
    const state = fechadaAteReiniciar ? "close" : estadoDaInstancia;
    res.end(JSON.stringify({ instance: { state, ownerJid: "5511900001111@s.whatsapp.net" } }));
    return;
  }
  res.end(JSON.stringify({ ok: true, version: "2.3.6" }));
});

async function main() {
  await new Promise<void>((r) => servidor.listen(4599, r));
  const app = process.env.APP_URL ?? "http://127.0.0.1:3999";
  const marca = Date.now();
  const company = await db.company.create({ data: { name: `Loja Pulso ${marca}`, slug: `loja-pulso-${marca}` } });
  const companyId = company.id;
  const admin = await db.user.create({
    data: { companyId, name: "Admin Pulso", email: `admin-pulso-${marca}@teste.local`, passwordHash: "x", role: "ADMIN" },
  });
  const token = `tok-pulso-${marca}`;
  await db.commSettings.create({
    data: {
      companyId,
      evolutionInstance: `inst-pulso-${marca}`,
      evolutionWebhookToken: token,
      evolutionStatus: "CONECTADO",
      evolutionPhone: "5511900001111",
      activeProvider: "EVOLUTION",
    },
  });
  const cs = () => db.commSettings.findUniqueOrThrow({ where: { companyId } });
  const webhook = async (event: string, data: unknown) => {
    const r = await fetch(`${app}/api/whatsapp/evolution/webhook/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, data }),
    });
    if (!r.ok) throw new Error(`webhook respondeu ${r.status}`);
  };
  let n = 0;
  const eco = () =>
    webhook("messages.upsert", {
      key: { remoteJid: "5511977776666@s.whatsapp.net", fromMe: true, id: `ECO${marca}${n++}` },
      message: { conversation: `eco ${n}` },
      messageType: "conversation",
    });
  const vigiaAgora = async () => {
    await db.systemHealth.upsert({ where: { id: "main" }, create: { id: "main" }, update: { watchdogRunAt: null } });
    await runWatchdogIfDue();
  };

  try {
    console.log("\n1) Envio e depois o eco (a ordem comum)");
    await marcarEnvioSemEco(companyId, new Date());
    conferir(!!(await cs()).envioSemEcoDesde, "o envio fica esperando o eco");
    await eco();
    await esperar(800);
    conferir((await cs()).envioSemEcoDesde === null, "o eco pelo webhook de verdade apaga a espera");

    console.log("\n2) O eco chega ANTES da resposta do envio (a corrida)");
    const inicio = new Date(Date.now() - 2_000); // o pedido saiu há 2 s
    await db.commSettings.update({ where: { companyId }, data: { webhookUltimoSinalEm: null } });
    await eco(); // o eco chega e carimba o sinal
    await esperar(800);
    await marcarEnvioSemEco(companyId, inicio); // a resposta do envio chega depois
    conferir((await cs()).envioSemEcoDesde === null, "o envio já coberto pelo eco não fica 'sem eco'");

    console.log("\n3) Sinal fresco (não regravado), envio novo, e o eco: a espera some do mesmo jeito");
    // sinal de 10 s atrás (dentro do minuto: sem envio esperando, não seria regravado)
    await db.commSettings.update({ where: { companyId }, data: { webhookUltimoSinalEm: new Date(Date.now() - 10_000) } });
    await marcarEnvioSemEco(companyId, new Date());
    conferir(!!(await cs()).envioSemEcoDesde, "o envio depois do último sinal espera o eco");
    await eco();
    await esperar(800);
    conferir((await cs()).envioSemEcoDesde === null, "o eco apaga a espera mesmo com o sinal regravado há segundos");

    console.log("\n3b) A corrida da revisão: sinal de 30 s atrás, eco antes da resposta do envio");
    await db.commSettings.update({
      where: { companyId },
      data: { webhookUltimoSinalEm: new Date(Date.now() - 30_000), envioSemEcoDesde: null },
    });
    const inicio2 = new Date(Date.now() - 1_000);
    await eco(); // o eco do envio chega primeiro…
    await esperar(800); // …gravado depois da resposta do webhook (after)
    await marcarEnvioSemEco(companyId, inicio2); // …e a resposta do envio depois
    conferir((await cs()).envioSemEcoDesde === null, "o eco engolido não vira 'envio sem eco' (sem alarme falso)");

    console.log("\n3c) O envio que começou DEPOIS do aviso não é coberto por ele");
    await db.commSettings.update({
      where: { companyId },
      data: { envioSemEcoDesde: new Date(Date.now() + 60_000), webhookUltimoSinalEm: null },
    });
    await eco();
    await esperar(800);
    conferir(!!(await cs()).envioSemEcoDesde, "o envio mais novo que o aviso continua esperando o SEU eco");
    await db.commSettings.update({ where: { companyId }, data: { envioSemEcoDesde: new Date(Date.now() - 60 * 60_000) } });
    await webhook("connection.update", { state: "open", wuid: "5511900001111@s.whatsapp.net" });
    conferir((await cs()).envioSemEcoDesde === null, "a conexão que (re)abre não herda o envio sem eco de antes");

    console.log("\n4) Webhook calado há 15 min: a cura automática roda sozinha");
    chamadas.length = 0;
    await db.commSettings.update({
      where: { companyId },
      data: { envioSemEcoDesde: new Date(Date.now() - 15 * 60_000), autoCuraEm: null },
    });
    await vigiaAgora();
    const depoisDaCura = await cs();
    conferir(chamadas.some((c) => c.includes("/instance/restart/")), "a conexão foi reiniciada no servidor");
    conferir(chamadas.some((c) => c.includes("/webhook/set/")), "os avisos do webhook foram reaplicados");
    conferir(!!depoisDaCura.autoCuraEm, "a vez da cura ficou carimbada");
    conferir(
      !!depoisDaCura.envioSemEcoDesde &&
        !!depoisDaCura.ultimoReinicioEm &&
        depoisDaCura.ultimoReinicioEm.getTime() >= depoisDaCura.envioSemEcoDesde.getTime(),
      "a prova FICA, marcada como de antes do reinício aceito (o painel diz 'esperando a próxima mensagem')"
    );
    await vigiaAgora();
    conferir(
      (await db.notification.count({ where: { companyId, userId: admin.id } })) === 0,
      "com a prova de antes do reinício, a rodada seguinte não alarma nem reinicia"
    );
    await db.commSettings.update({ where: { companyId }, data: { webhookUltimoSinalEm: new Date(Date.now() - 60_000) } });
    const inicioNovo = new Date();
    await marcarEnvioSemEco(companyId, inicioNovo);
    conferir(
      (await cs()).envioSemEcoDesde?.getTime() === inicioNovo.getTime(),
      "o primeiro envio depois do reinício se carimba por cima — é a prova nova"
    );
    const cura = await db.commEvent.findFirst({ where: { companyId, type: "wa.conexao.cura-automatica" } });
    conferir(cura?.status === "OK", "a cura ficou registrada como 'voltou'");
    conferir(
      (await db.notification.count({ where: { companyId, userId: admin.id } })) === 0,
      "a loja NÃO é incomodada quando a cura resolve"
    );

    console.log("\n5) Calado de novo depois da cura: o alarme sai, uma vez");
    await db.commSettings.update({
      where: { companyId },
      // a cura foi há 20 min e o envio de 14 min atrás (DEPOIS dela) não teve eco
      data: {
        autoCuraEm: new Date(Date.now() - 20 * 60_000),
        ultimoReinicioEm: new Date(Date.now() - 20 * 60_000),
        envioSemEcoDesde: new Date(Date.now() - 14 * 60_000),
        reinicioPedidoEm: null,
      },
    });
    chamadas.length = 0;
    await vigiaAgora();
    conferir(!chamadas.some((c) => c.includes("/instance/restart/")), "não reinicia de novo dentro de 6 h");
    const sinos = await db.notification.findMany({ where: { companyId, userId: admin.id } });
    conferir(sinos.some((s) => s.title.includes("parou de entregar")), "o admin recebeu o alarme no sino");
    conferir(!!(await cs()).webhookCaladoAvisadoEm, "o alarme ficou carimbado");
    await vigiaAgora();
    conferir(
      (await db.notification.count({ where: { companyId, userId: admin.id } })) === sinos.length,
      "a rodada seguinte não repete o alarme"
    );

    console.log("\n6) A conexão cai por rede (código 428): o motivo fica; espera o WhatsApp religar; depois de 3 min, cura");
    await db.commSettings.update({
      where: { companyId },
      data: { autoCuraEm: null, envioSemEcoDesde: null, reinicioPedidoEm: null, evolutionStatus: "CONECTADO", evolutionAlertAt: null },
    });
    chamadas.length = 0;
    fechadaAteReiniciar = true; // a sessão não volta sozinha: só com o reinício
    await webhook("connection.update", { state: "close", statusReason: 428 });
    const queda = await db.commEvent.findFirst({
      where: { companyId, type: "wa.conexao.queda" },
      orderBy: { createdAt: "desc" },
    });
    conferir(!!queda?.error?.includes("conexão foi fechada"), `o motivo da queda foi traduzido ("${queda?.error}")`);
    await esperar(1_500);
    conferir(!chamadas.some((c) => c.includes("/instance/restart/")), "o webhook NÃO reinicia por cima (o WhatsApp costuma religar)");
    conferir((await cs()).evolutionAlertAt === null, "nem alarma na hora");
    await vigiaAgora();
    conferir(!chamadas.some((c) => c.includes("/instance/restart/")), "com menos de 3 min, o vigia também espera");
    await db.commSettings.update({ where: { companyId }, data: { evolutionDownSince: new Date(Date.now() - 4 * 60_000) } });
    await vigiaAgora();
    conferir(chamadas.some((c) => c.includes("/instance/restart/")), "fora há 3 min: o vigia reiniciou a conexão");
    conferir((await cs()).evolutionStatus === "CONECTADO", "a loja voltou a CONECTADO sozinha");
    conferir((await cs()).evolutionAlertAt === null, "e ninguém foi alarmado");

    console.log("\n6a) A queda de rede de MADRUGADA (sem vigia rodando): o próprio aviso espera 1 min e cura");
    await db.commSettings.update({
      where: { companyId },
      data: { autoCuraEm: null, reinicioPedidoEm: null, evolutionStatus: "CONECTADO", evolutionAlertAt: null },
    });
    chamadas.length = 0;
    fechadaAteReiniciar = true;
    await webhook("connection.update", { state: "close", statusReason: 408 });
    await esperar(20_000);
    conferir(!chamadas.some((c) => c.includes("/instance/restart/")), "nos primeiros segundos, espera o WhatsApp religar sozinho");
    await esperar(70_000);
    conferir(chamadas.some((c) => c.includes("/instance/restart/")), "passado 1 min fora, reiniciou sozinho");
    conferir((await cs()).evolutionStatus === "CONECTADO", "voltou a CONECTADO sem ninguém usar o sistema");
    conferir((await cs()).evolutionAlertAt === null, "e sem alarme para a loja");

    console.log("\n6b) Desconectada pelo celular (401): sem cura (só o QR resolve), alarme na hora");
    await db.commSettings.update({
      where: { companyId },
      data: { autoCuraEm: null, reinicioPedidoEm: null, evolutionStatus: "CONECTADO", evolutionAlertAt: null },
    });
    chamadas.length = 0;
    await webhook("connection.update", { state: "close", statusReason: 401 });
    await esperar(2_000);
    conferir(!chamadas.some((c) => c.includes("/instance/restart/")), "não reiniciou (a vez da cura fica guardada)");
    conferir(!!(await cs()).evolutionAlertAt, "o alarme de desconexão saiu na hora");
    conferir(!!(await cs()).autoCuraEm, "a vez da cura fica carimbada: o vigia não reinicia uma sessão que só volta com QR");
    const queda401 = await db.commEvent.findFirst({ where: { companyId, type: "wa.conexao.queda" }, orderBy: { createdAt: "desc" } });
    conferir(!!queda401?.error?.includes("desconectada pelo celular"), "o motivo 401 ficou no histórico");

    console.log("\n6c) O 401 que chega DEPOIS de uma queda de rede também alarma e fica no histórico");
    await db.commSettings.update({
      where: { companyId },
      data: {
        autoCuraEm: null,
        evolutionStatus: "DESCONECTADO",
        evolutionDownSince: new Date(Date.now() - 60_000),
        evolutionAlertAt: null,
        reinicioPedidoEm: null,
      },
    });
    const antesDo401 = await db.commEvent.count({ where: { companyId, type: "wa.conexao.queda" } });
    await webhook("connection.update", { state: "close", statusReason: 401 });
    conferir(
      (await db.commEvent.count({ where: { companyId, type: "wa.conexao.queda" } })) === antesDo401 + 1,
      "o motivo novo foi registrado"
    );
    conferir(!!(await cs()).evolutionAlertAt, "e o alarme saiu");

    console.log("\n7) Rede de segurança: desconectada há 20 min sem alarme ganha o alarme");
    estadoDaInstancia = "close";
    await db.commSettings.update({
      where: { companyId },
      data: {
        evolutionStatus: "DESCONECTADO",
        evolutionDownSince: new Date(Date.now() - 20 * 60_000),
        evolutionAlertAt: null,
        reinicioPedidoEm: null,
      },
    });
    await vigiaAgora();
    conferir(!!(await cs()).evolutionAlertAt, "o alarme de desconexão saiu");
    // o carimbo de uma queda ANTERIOR não cobre a de agora
    await db.commSettings.update({
      where: { companyId },
      data: {
        evolutionDownSince: new Date(Date.now() - 20 * 60_000),
        evolutionAlertAt: new Date(Date.now() - 8 * 60 * 60_000),
      },
    });
    await vigiaAgora();
    conferir(
      ((await cs()).evolutionAlertAt?.getTime() ?? 0) > Date.now() - 60_000,
      "o alarme velho de uma queda anterior não cala a rede de segurança"
    );

    // a sessão presa religando ("aguardando QR" pelo connecting) também alarma
    await db.commSettings.update({
      where: { companyId },
      data: {
        evolutionStatus: "AGUARDANDO_QR",
        evolutionDownSince: new Date(Date.now() - 15 * 60_000),
        evolutionAlertAt: null,
      },
    });
    await vigiaAgora();
    conferir(!!(await cs()).evolutionAlertAt, "a sessão presa em 'reconectando' depois da queda também alarma");

    console.log("\n7b) O vigia do cron da madrugada (sem cura) vê a queda: alarma na MESMA rodada");
    estadoDaInstancia = "close";
    await db.commSettings.update({
      where: { companyId },
      data: { evolutionStatus: "CONECTADO", evolutionAlertAt: null, evolutionDownSince: null, reinicioPedidoEm: null },
    });
    await db.systemHealth.update({ where: { id: "main" }, data: { watchdogRunAt: null } });
    await runWatchdogIfDue({ curar: false });
    const madrugada = await cs();
    conferir(madrugada.evolutionStatus === "DESCONECTADO" && !!madrugada.evolutionAlertAt, "marcou a queda e alarmou na hora");

    console.log("\n8) O despertador externo responde na hora");
    const r = await fetch(`${app}/api/vigia`);
    conferir(r.status === 200, `GET /api/vigia respondeu ${r.status} sem login`);
  } finally {
    await db.notification.deleteMany({ where: { companyId } });
    await db.commEvent.deleteMany({ where: { companyId } });
    await db.commSettings.deleteMany({ where: { companyId } });
    await db.user.deleteMany({ where: { companyId } });
    await db.company.delete({ where: { id: companyId } }).catch(() => {});
    servidor.close();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  servidor.close();
});
