/**
 * PROVA da migração que encerra em lote as conversas de UMA loja (runbook:
 * "Limpar a Central de UMA loja"). Roda contra o Postgres LOCAL, nunca em
 * produção, e responde às três perguntas que importam antes de subir:
 *
 *   1. a loja alvo fica com zero conversas abertas, mensagens intactas;
 *   2. a loja VIZINHA não muda em nada (RN-013);
 *   3. com nome DUPLICADO a instrução se recusa a agir — e deixa rastro.
 *
 * Uso (na raiz do repo, com o Postgres local de pé):
 *   set -a; source .env; set +a
 *   npx tsx scripts/prova-limpeza-central.ts prisma/migrations/<pasta>/migration.sql "Entre Linhas" entre-linhas
 */
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";

const [arquivo, nome, slug] = process.argv.slice(2);
if (!arquivo || !nome || !slug) {
  console.error("uso: prova-limpeza-central.ts <migration.sql> <nome da loja> <slug>");
  process.exit(2);
}
const sql = readFileSync(arquivo, "utf8");
const ok = (b: boolean) => (b ? "✔" : "✘ FALHOU");
let falhas = 0;
const confere = (rotulo: string, b: boolean) => {
  console.log(`   ${ok(b)} ${rotulo}`);
  if (!b) falhas++;
};

async function loja(name: string, slugDaLoja: string, abertas: number) {
  await db.company.deleteMany({ where: { slug: slugDaLoja } });
  const c = await db.company.create({ data: { name, slug: slugDaLoja } });
  for (let i = 0; i < abertas + 1; i++) {
    const cli = await db.customer.create({
      data: { companyId: c.id, name: `C${i}`, phone: `55${slugDaLoja.length}${i}${Date.now() % 1e7}` },
    });
    const conv = await db.conversation.create({
      data: { companyId: c.id, customerId: cli.id, status: i === abertas ? "CLOSED" : "OPEN", unreadCount: 1 },
    });
    await db.message.create({ data: { conversationId: conv.id, direction: "IN", body: "*Novo pedido*", status: "RECEBIDA" } });
  }
  return c.id;
}
const foto = async (id: string) => ({
  abertas: await db.conversation.count({ where: { companyId: id, status: { not: "CLOSED" } } }),
  naoLidas: await db.conversation.count({ where: { companyId: id, unreadCount: { gt: 0 } } }),
  mensagens: await db.message.count({ where: { conversation: { companyId: id } } }),
  rastro: await db.commEvent.count({ where: { companyId: id, type: "conversas.encerradas-em-lote" } }),
});

(async () => {
  const S = { alvo: `${slug}-prova`, gemea: `${slug}-prova-2`, vizinha: `${slug}-prova-vizinha` };
  const alvo = await loja(nome, S.alvo, 5);
  const vizinha = await loja("Loja Vizinha", S.vizinha, 4);
  const antesVizinha = await foto(vizinha);
  const semLoja = () => db.commEvent.count({ where: { companyId: null, type: "conversas.encerradas-em-lote", status: "ERRO" } });

  console.log("\n1) NOME DUPLICADO — duas lojas com o mesmo nome:");
  await loja(` ${nome.toUpperCase()} `, S.gemea, 2);
  const rastroAntes = await semLoja();
  await db.$executeRawUnsafe(sql);
  confere("a alvo continua com as conversas abertas", (await foto(alvo)).abertas === 5);
  confere("a vizinha não mudou", JSON.stringify(await foto(vizinha)) === JSON.stringify(antesVizinha));
  confere("ficou rastro na Central da PLATAFORMA (evento sem loja, ERRO)", (await semLoja()) === rastroAntes + 1);

  console.log("\n2) UMA loja só — a instrução age:");
  await db.company.deleteMany({ where: { slug: S.gemea } });
  await db.$executeRawUnsafe(sql);
  const fim = await foto(alvo);
  confere("alvo: zero conversas abertas", fim.abertas === 0);
  confere("alvo: nenhuma bolinha de não lida (nem nas já encerradas)", fim.naoLidas === 0);
  confere("alvo: mensagens intactas (nada apagado)", fim.mensagens === 6);
  confere("alvo: rastro na Central de Comunicação da loja", fim.rastro === 1);
  confere("vizinha: NÃO MUDOU NADA (RN-013)", JSON.stringify(await foto(vizinha)) === JSON.stringify(antesVizinha));

  console.log("\n3) Rodar de novo não faz mal (idempotente):");
  await db.$executeRawUnsafe(sql);
  confere("alvo segue igual, rastro repetido mas sem mexer em conversa", (await foto(alvo)).abertas === 0);

  await db.company.deleteMany({ where: { slug: { in: Object.values(S) } } });
  await db.commEvent.deleteMany({ where: { companyId: null, type: "conversas.encerradas-em-lote" } });
  await db.$disconnect();
  console.log(falhas ? `\n${falhas} conferência(s) FALHARAM — não suba.` : "\nTudo certo: pode subir.");
  process.exit(falhas ? 1 : 0);
})();
