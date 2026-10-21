/**
 * PROVA CONTRA O POSTGRES (RN-091): o funil editável ponta a ponta —
 * loja nova nasce com os marcos, renomear não para o funil, apagar etapa leva
 * cartões/regra de origem/marcos ao destino, "não mover" para mesmo, a ordem
 * nova vale para o "só avança", e as recusas (ganho, primeira fechada).
 *
 *   DATABASE_URL=... AUTH_SECRET=... NODE_PATH=./node_modules npx tsx --tsconfig tsconfig.json scripts/confere-funil-editavel.ts
 */
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { provisionCompany } from "@/lib/provision";
import { avancarFunil } from "@/lib/funil-auto";
import {
  FunilErro,
  apagarEtapa,
  criarEtapa,
  editarEtapa,
  estadoDoEditor,
  porteiraDoEditor,
  reordenarEtapas,
  salvarMarcos,
} from "@/lib/funil/editor";
import { garantirMarcosIniciais } from "@/lib/funil/marcos";

let falhas = 0;
const check = (n: string, ok: boolean) => {
  if (!ok) falhas++;
  console.log(ok ? "✅" : "❌", n);
};
const tag = `funil-${Date.now()}`;

async function recusa(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof FunilErro ? e.message : `ERRO INESPERADO: ${String(e)}`;
  }
}

async function main() {
  const r = await provisionCompany({
    companyName: `Sutilli teste ${tag}`,
    adminName: "Dona",
    adminEmail: `${tag}@x.x`,
    adminPassword: "senha-de-teste-123",
  });
  const admin: SessionUser = {
    id: r.adminId, companyId: r.companyId, name: "Dona", email: r.adminEmail, role: "ADMIN",
    color: "#000", chatVisaoTotal: false, pedidosVisaoTotal: false, prefersDark: false, avatarUrl: null,
  } as SessionUser;
  const vendedora = { ...admin, id: "v", role: "SELLER" } as SessionUser;
  const funil = await db.pipeline.findFirstOrThrow({ where: { companyId: r.companyId } });
  const etapa = async (nome: string) =>
    db.stage.findFirstOrThrow({ where: { pipelineId: funil.id, name: nome } });

  // 1) loja nova nasce com os 4 marcos ligados
  const e0 = await estadoDoEditor(funil.id);
  check("loja nova nasce com os 4 marcos", Object.values(e0.marcos).every(Boolean));

  // 2) porteira: sem a chave, 404; vendedora, 403
  check("sem a chave a porta não existe", (await recusa(porteiraDoEditor(admin, funil.id))) === "Não encontrado");
  await db.company.update({ where: { id: r.companyId }, data: { funilEditavelEnabled: true } });
  check("vendedora não edita", !!(await recusa(porteiraDoEditor(vendedora, funil.id)))?.includes("Só administrador"));
  check("com a chave a gerência entra", (await recusa(porteiraDoEditor(admin, funil.id))) === null);

  // cliente com cartão em "Novo lead"
  const cli = await db.customer.create({ data: { companyId: r.companyId, name: "Ana", phone: `55119${Date.now() % 1e8}` } });
  const novo = await etapa("Novo lead");
  const opp = await db.opportunity.create({
    data: { companyId: r.companyId, customerId: cli.id, stageId: novo.id, title: "t", value: 0 },
  });

  // 3) RENOMEAR "Catálogo enviado" — antes isso parava o funil em silêncio
  const cat = await etapa("Catálogo enviado");
  await editarEtapa(admin, funil.id, cat.id, { name: "  Enviei as   fotos " });
  check("nome gravado limpo", (await db.stage.findUniqueOrThrow({ where: { id: cat.id } })).name === "Enviei as fotos");
  await avancarFunil(r.companyId, cli.id, "CATALOGO_ENVIADO");
  check(
    "renomeada, o cartão AINDA anda sozinho para ela",
    (await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId === cat.id
  );
  check("nome repetido recusado", !!(await recusa(editarEtapa(admin, funil.id, novo.id, { name: "enviei as fotos" })))?.includes("Já existe"));

  // 4) APAGAR "Enviei as fotos" mandando para "Interesse identificado"
  const interesse = await etapa("Interesse identificado");
  await db.originRule.create({ data: { companyId: r.companyId, origin: "WHATSAPP", stageId: cat.id } });
  const apagou = await apagarEtapa(admin, funil.id, cat.id, interesse.id);
  check("1 cartão movido", apagou.cartoesMovidos === 1);
  check("cartão foi para o destino", (await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId === interesse.id);
  check("etapa sumiu", (await db.stage.findUnique({ where: { id: cat.id } })) === null);
  check(
    "regra de origem acompanhou",
    (await db.originRule.findFirstOrThrow({ where: { companyId: r.companyId, origin: "WHATSAPP" } })).stageId === interesse.id
  );
  check("marco 'abriu o catálogo' acompanhou", apagou.marcos.CATALOGO_ENVIADO === interesse.id);
  check("ordem renumerada 0..n-1", apagou.etapas.every((x, i) => x.order === i));
  check(
    "registro na Central de Comunicação",
    (await db.commEvent.count({ where: { companyId: r.companyId, type: "funil.editado" } })) >= 2
  );

  // 5) recusas
  const ganho = await db.stage.findFirstOrThrow({ where: { pipelineId: funil.id, isWon: true } });
  check("ganho não se apaga", !!(await recusa(apagarEtapa(admin, funil.id, ganho.id, novo.id)))?.includes("venda ganha"));
  check("cartões não vão para o ganho", !!(await recusa(apagarEtapa(admin, funil.id, novo.id, ganho.id)))?.includes("etapa aberta"));
  const ids = apagou.etapas.map((x) => x.id);
  const ganhoPrimeiro = [ganho.id, ...ids.filter((x) => x !== ganho.id)];
  check("ganho não vira primeira etapa", !!(await recusa(reordenarEtapas(admin, funil.id, ganhoPrimeiro)))?.includes("primeira"));
  check("marco não aponta para ganho", !!(await recusa(salvarMarcos(admin, funil.id, { PAGAMENTO: ganho.id })))?.includes("etapa aberta"));

  // 6) "não mover"
  await salvarMarcos(admin, funil.id, { NEGOCIACAO: null });
  await avancarFunil(r.companyId, cli.id, "NEGOCIACAO");
  check(
    "'não mover' não move",
    (await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId === interesse.id
  );

  // 7) criar etapa: entra antes do ganho; ligar o marco a ela; o cartão avança
  const criado = await criarEtapa(admin, funil.id, { name: "Escolhendo peças", color: "#f472b6" });
  const nova = criado.etapas.find((x) => x.name === "Escolhendo peças")!;
  const idxGanho = criado.etapas.findIndex((x) => x.isWon);
  check("etapa nova entra logo antes do ganho", criado.etapas[idxGanho - 1]?.id === nova.id);
  await salvarMarcos(admin, funil.id, { NEGOCIACAO: nova.id });
  await avancarFunil(r.companyId, cli.id, "NEGOCIACAO");
  check("marco ligado à etapa nova move", (await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId === nova.id);

  // 8) só avança: levar "Interesse identificado" para DEPOIS da nova e
  //    pedir o marco ligado a ela — o cartão não volta
  await salvarMarcos(admin, funil.id, { CATALOGO_ENVIADO: interesse.id });
  const atual = (await estadoDoEditor(funil.id)).etapas.map((x) => x.id);
  const semInteresse = atual.filter((x) => x !== interesse.id);
  const posNova = semInteresse.indexOf(nova.id);
  semInteresse.splice(posNova + 1, 0, interesse.id);
  await reordenarEtapas(admin, funil.id, semInteresse);
  await avancarFunil(r.companyId, cli.id, "CATALOGO_ENVIADO");
  check(
    "com a ordem nova, 'Interesse' vem depois e o cartão avança para ela",
    (await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId === interesse.id
  );
  await avancarFunil(r.companyId, cli.id, "NEGOCIACAO");
  check(
    "e não volta para a etapa anterior",
    (await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId === interesse.id
  );

  // 8b) etapa automática não desce para depois do ganho
  const agora = (await estadoDoEditor(funil.id)).etapas.map((x) => x.id);
  const semInt = agora.filter((x) => x !== interesse.id);
  semInt.splice(semInt.indexOf(ganho.id) + 1, 0, interesse.id);
  check(
    "etapa automática não vai para depois do ganho",
    !!(await recusa(reordenarEtapas(admin, funil.id, semInt)))?.includes("não pode ficar depois")
  );
  const pos = await etapa("Pós-venda");
  check("marco não aponta para o Pós-venda", !!(await recusa(salvarMarcos(admin, funil.id, { PAGAMENTO: pos.id })))?.includes("depois da etapa"));

  // 9) desligar a chave: o funil fica como está
  await db.company.update({ where: { id: r.companyId }, data: { funilEditavelEnabled: false } });
  const depois = await db.stage.count({ where: { pipelineId: funil.id } });
  check("desligar a chave não mexe no funil", depois === criado.etapas.length);

  // 10) reparo de carona: funil sem vínculo, loja SEM o editor → religa pelo nome
  const r2 = await provisionCompany({ companyName: `Janela ${tag}`, adminName: "X", adminEmail: `j-${tag}@x.x`, adminPassword: "senha-de-teste-123" });
  const f2 = await db.pipeline.findFirstOrThrow({ where: { companyId: r2.companyId } });
  await db.etapaAutomatica.deleteMany({ where: { pipelineId: f2.id } });
  await garantirMarcosIniciais(r2.companyId);
  check("loja sem vínculo e sem editor é reparada", (await db.etapaAutomatica.count({ where: { pipelineId: f2.id } })) === 4);
  // com o editor ligado, "nenhum vínculo" é escolha: não mexe
  await db.etapaAutomatica.deleteMany({ where: { pipelineId: f2.id } });
  await db.company.update({ where: { id: r2.companyId }, data: { funilEditavelEnabled: true } });
  await garantirMarcosIniciais(r2.companyId);
  check("com o editor ligado, 'não mover' nos quatro é respeitado", (await db.etapaAutomatica.count({ where: { pipelineId: f2.id } })) === 0);
  await db.company.delete({ where: { id: r2.companyId } });

  // limpeza
  await db.company.delete({ where: { id: r.companyId } }).catch(async () => {
    await db.opportunity.deleteMany({ where: { companyId: r.companyId } });
    await db.company.delete({ where: { id: r.companyId } });
  });
  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
