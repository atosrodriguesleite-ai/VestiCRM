/**
 * BANCADA DA TELA BRANCA (RN-095) — o que a cliente VÊ quando a rede falha
 * ao abrir o app, reproduzido no Chromium com prints.
 *
 * Nasceu do relato "entra no aplicativo e a tela fica toda branca" (Starlink
 * no carro, 23/10/2026). Ela prova duas coisas:
 *
 *  • em TODO cenário em que a página chega — sem JavaScript, sem CSS, sem os
 *    pedaços de código — há algo na tela; o branco total só aparece quando
 *    a página NÃO chega ou chega CORTADA;
 *  • e que, cortada entre o `<head>` e o esqueleto de carregamento (no
 *    celular, ~2% a ~24% do arquivo), a tela fica em branco para sempre —
 *    é o caso que o vigia da abertura (`lib/vigia-da-abertura.ts`) resolve.
 *
 * Precisa do app rodando em `localhost:3100` com o Postgres local, de um
 * usuário `teste@demo-pdf.local` / `Senha123!` (ver `semear-catalogo-demo.ts`)
 * e do `playwright-core` (não é dependência do projeto):
 *
 *   npm i --no-save playwright-core
 *   node scripts/bancada-tela-branca.mjs
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3100";
const DIR = process.env.SAIDA ?? "/tmp";
// o celular de verdade: `viewport` (solto, width/height são ignorados e a
// página abre em tela de computador, com o menu lateral visível — e aí o
// vigia espera os 40 s, como deve)
const cel = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});

// sessão de verdade pela porta de login
const ctxLogin = await browser.newContext();
const login = await ctxLogin.request.post(`${BASE}/api/auth/login`, {
  data: { email: "teste@demo-pdf.local", password: "Senha123!" },
});
console.log("login →", login.status());
const cookies = await ctxLogin.storageState();
const html = await (await ctxLogin.request.get(`${BASE}/dashboard`)).text();
await ctxLogin.close();

const marcador = html.indexOf('id="atacadopro-fim"');
const vigiaEm = html.indexOf("atacadopro-vigia");
// o próprio vigia cita o seletor do esqueleto: procurar DEPOIS dele
const esqueleto = html.indexOf('aria-label="Carregando"', vigiaEm + 4000);
console.log(
  `HTML do /dashboard: ${html.length} bytes · vigia a ${pct(vigiaEm)} · esqueleto a ${pct(esqueleto)} · marcador de fim a ${pct(marcador)}`
);

let falhas = 0;
function confere(nome, ok, detalhe = "") {
  console.log(`${ok ? "  ok " : "FALHA"}  ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas++;
}
function pct(i) {
  return i < 0 ? "—" : `${Math.round((i / html.length) * 100)}%`;
}

/** abre a página sob uma condição e mede o que ficou na tela */
async function cenario(nome, { js = true, bloquear = null, offline = false, url = "/dashboard", corte = null, esperarMs = 800 }) {
  const ctx = await browser.newContext({ ...cel, javaScriptEnabled: js, storageState: cookies });
  if (bloquear) await ctx.route(bloquear, (rota) => rota.abort("failed"));
  if (corte !== null) {
    // a conexão cai no meio: só os primeiros N% do HTML chegam
    await ctx.route(`${BASE}${url}`, (rota) =>
      rota.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html.slice(0, Math.floor(html.length * corte)) })
    );
  }
  if (offline) await ctx.setOffline(true);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(esperarMs);
  const texto = await page.evaluate(() => document.body?.innerText?.trim().length ?? 0).catch(() => -1);
  const vigia = await page.evaluate(() => !!document.getElementById("atacadopro-vigia")).catch(() => false);
  await page.screenshot({ path: `${DIR}/tela-${nome}.png` }).catch(() => {});
  await ctx.close();
  return { texto, vigia };
}

// ── a página que chega mostra algo, em qualquer condição ─────────────────
const normal = await cenario("normal", {});
confere("1 · página normal tem conteúdo e o vigia fica quieto", normal.texto > 500 && !normal.vigia, `${normal.texto} chars`);
const semJs = await cenario("sem-js", { js: false });
confere("2 · sem JavaScript ainda há tela (cabeçalho e esqueleto vêm do servidor)", semJs.texto > 20, `${semJs.texto} chars`);
const semCss = await cenario("sem-css", { bloquear: /\.css(\?|$)/ });
confere("3 · sem CSS ainda há texto (feio, não branco)", semCss.texto > 100, `${semCss.texto} chars`);
const semChunks = await cenario("sem-chunks", { bloquear: /\/_next\/static\// });
confere("4 · sem nenhum pedaço de código ainda há texto", semChunks.texto > 100, `${semChunks.texto} chars`);

// ── a página CORTADA: o caso da tela branca ───────────────────────────────
const cortada = await cenario("cortada-15", { corte: 0.15, esperarMs: 1500 });
confere(
  "5 · cortada a 15% (antes do esqueleto): o VIGIA aparece com o botão",
  cortada.vigia,
  `texto=${cortada.texto} chars, vigia=${cortada.vigia}`
);
const cortadaTarde = await cenario("cortada-60", { corte: 0.6, esperarMs: 1500 });
confere(
  "6 · cortada a 60% (esqueleto já na tela): sem susto antes do prazo longo",
  !cortadaTarde.vigia && cortadaTarde.texto >= 0,
  `vigia=${cortadaTarde.vigia}`
);

// ── offline total: no Chromium é a página do navegador; no iPhone instalado
//    é o branco — e é aí que o service worker entra (não dá para provar aqui)
const off = await cenario("offline", { offline: true });
confere("7 · offline ao abrir: o Chromium mostra a página dele (no app instalado do iPhone seria branco)", off.texto >= 0);

await browser.close();
console.log(falhas === 0 ? "\n✅ bancada fechou" : `\n❌ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
