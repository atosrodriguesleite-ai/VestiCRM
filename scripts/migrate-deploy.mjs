#!/usr/bin/env node
/**
 * `prisma migrate deploy` COM DESTRAVADOR (09/08/2026).
 *
 * O problema real: uma migração falhou no meio contra o banco de produção
 * (lock/tempo/linha inesperada). No Postgres ela é DESFEITA inteira, mas o
 * Prisma grava "falhou" na tabela de controle — e a partir daí TODO deploy
 * morre na hora com P3009, sem nem tentar. O site fica preso na versão
 * velha até alguém destravar à mão no banco.
 *
 * Aqui o destravamento é automático e ESTREITO:
 *   • só migrações da LISTA FECHADA abaixo (escritas para rodar duas vezes —
 *     IF NOT EXISTS em tudo);
 *   • só o carimbo "rolled back" (verdadeiro: o Postgres desfez mesmo);
 *   • UMA nova tentativa. Falhou de novo, o deploy falha de verdade e o
 *     erro aparece no log da Vercel.
 *
 * Migração antiga que falhar NUNCA é destravada por aqui: pode não ser
 * reexecutável, e re-rodar SQL não-idempotente em produção é pior que o
 * deploy parado.
 */
import { spawnSync } from "node:child_process";

const REEXECUTAVEIS = new Set([
  "20260809120000_tarefa_confere_a_realidade",
  "20260809150000_telefone_unico_por_loja",
  "20260810120000_cancelamento_sem_devolucao",
  "20260811120000_infinitepay",
  "20260814120000_rastreio_automatico",
  "20260817210000_tabelas_de_preco",
  // o back-fill é convergente (soma as automáticas vivas na mais antiga, com
  // teto no que a parcela deve) e o índice é IF NOT EXISTS: rodar de novo dá
  // no mesmo. Sem estar aqui, um lock timeout na criação do índice travaria
  // TODOS os deploys com P3009 até alguém mexer no banco à mão.
  "20260903090000_financeiro_baixa_automatica_unica",
]);

function rodar(args) {
  const r = spawnSync("npx", args, { encoding: "utf8", shell: false });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  return { status: r.status ?? 1, saida: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

let tentativa = rodar(["prisma", "migrate", "deploy"]);
if (tentativa.status === 0) process.exit(0);

// P3009: "The `<nome>` migration started at <data> failed"
const falhada = tentativa.saida.match(/The `([^`]+)` migration started at .* failed/)?.[1];
if (falhada && REEXECUTAVEIS.has(falhada)) {
  console.log(
    `\n[migrate-deploy] A migração ${falhada} ficou marcada como falhada — ` +
      `ela é reexecutável (IF NOT EXISTS), destravando e tentando de novo...`
  );
  const resolve = rodar(["prisma", "migrate", "resolve", "--rolled-back", falhada]);
  if (resolve.status === 0) {
    tentativa = rodar(["prisma", "migrate", "deploy"]);
    if (tentativa.status === 0) {
      console.log("[migrate-deploy] Destravado: migrações aplicadas na nova tentativa.");
      process.exit(0);
    }
  }
}

process.exit(tentativa.status || 1);
