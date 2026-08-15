// Corta desperdício de "Build CPU Minutes" na Vercel: só deploy de PRODUÇÃO
// merece uma montagem completa. Cada push em branch de trabalho gerava um
// site-espelho que ninguém abria — e cada espelho desses custa minutos na
// fatura.
//
// A Vercel chama isto de "Ignored Build Step" (vercel.json → ignoreCommand):
//   exit 0  → PULA o build (não publica)
//   exit 1  → SEGUE o build (publica)
//
// A decisão vem da PRÓPRIA Vercel (VERCEL_ENV === "production"), nunca de um
// nome de branch fixado aqui: nome fixo quebraria em silêncio se a branch de
// produção mudasse no painel — a mesma classe de acidente dos crons, que já
// travou deploy 2x (achado da revisão de 15/08/2026).
//
// REGRA DE OURO: na dúvida, PUBLICA. Variável ausente ou valor inesperado
// terminam em exit 1 (publica). É melhor gastar um build à toa do que deixar
// produção sem subir por causa de uma trava nossa.

const env = (process.env.VERCEL_ENV || "").trim();
const branch = (process.env.VERCEL_GIT_COMMIT_REF || "?").trim();

if (env === "preview") {
  console.log(
    `⏭️  Deploy de preview (branch "${branch}") — build pulado para não gastar minutos à toa.\n` +
      `   A branch de produção do painel da Vercel continua publicando normalmente.`
  );
  process.exit(0);
}

if (env === "production") {
  console.log(`✓ Deploy de produção (branch "${branch}") — publicando normalmente.`);
} else {
  console.log(`⚠️  VERCEL_ENV inesperado ("${env}") — publicando por segurança.`);
}
process.exit(1);
