// Corta desperdício de "Build CPU Minutes" na Vercel: só a branch de produção
// merece uma publicação completa. Branches de trabalho (as `claude/...` de
// cada tarefa) geravam um site-espelho que ninguém abria — e cada espelho
// desses custa minutos de montagem na fatura.
//
// A Vercel chama isto de "Ignored Build Step" (vercel.json → ignoreCommand):
//   exit 0  → PULA o build (não publica)
//   exit 1  → SEGUE o build (publica)
//
// REGRA DE OURO DAQUI: na dúvida, PUBLICA. Se a variável da branch vier vazia,
// se o nome não bater, se qualquer coisa der errado — o script sai com 1 e o
// deploy acontece. É melhor gastar um build à toa do que deixar produção sem
// subir por causa de uma trava nossa.

// Branch que está no ar em www.atacadopro.com. Se um dia a produção mudar de
// branch, troque aqui (ou defina BRANCH_PRODUCAO nas envs da Vercel).
const BRANCH_PRODUCAO =
  process.env.BRANCH_PRODUCAO || "claude/modacrm-clothing-crm-cxa9gf";

// Nome da branch que a Vercel está tentando montar agora.
const branch = (process.env.VERCEL_GIT_COMMIT_REF || "").trim();

// Sem saber a branch, não dá pra decidir nada com segurança → publica.
if (!branch) {
  console.log("⚠️  Branch desconhecida (VERCEL_GIT_COMMIT_REF vazia) — publicando por segurança.");
  process.exit(1);
}

if (branch === BRANCH_PRODUCAO) {
  console.log(`✓ Branch de produção ("${branch}") — publicando normalmente.`);
  process.exit(1);
}

console.log(
  `⏭️  Branch de trabalho ("${branch}") — build pulado para não gastar minutos à toa.\n` +
    `   Produção continua sendo a "${BRANCH_PRODUCAO}"; ao mesclar lá, publica normal.`
);
process.exit(0);
