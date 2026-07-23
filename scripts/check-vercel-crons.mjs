// Trava de segurança contra o erro que já travou deploy 2x: a Vercel recusa
// configurações de cron acima do limite do plano — e recusa EM SILÊNCIO,
// bloqueando TODOS os deploys sem avisar. Este check roda antes do build e
// falha ALTO e CLARO se o vercel.json passar do limite, pra o problema ser
// pego aqui (na nossa mão) e não lá, quieto.
//
// Regras do plano (Hobby): no máx. 2 cron jobs e cada um roda no máx. 1x/dia.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MAX_CRONS = 2; // limite de cron jobs do plano
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function erro(msg) {
  console.error("\n\x1b[41m\x1b[97m ERRO NO vercel.json \x1b[0m");
  console.error("\x1b[31m" + msg + "\x1b[0m");
  console.error(
    "\nISSO TRAVA TODOS OS DEPLOYS NA VERCEL (em silêncio). Ajuste o vercel.json antes de subir.\n" +
      "Regra: no máximo " +
      MAX_CRONS +
      " cron jobs, cada um rodando 1x por dia (minuto e hora fixos; nunca '*', ',', '-' ou '/').\n"
  );
  process.exit(1);
}

let json;
try {
  json = JSON.parse(readFileSync(join(raiz, "vercel.json"), "utf8"));
} catch {
  // sem vercel.json ou ilegível: nada de cron pra validar
  process.exit(0);
}

const crons = Array.isArray(json.crons) ? json.crons : [];

if (crons.length > MAX_CRONS) {
  erro(
    `Tem ${crons.length} cron jobs, mas o limite é ${MAX_CRONS}. ` +
      `Junte tarefas num mesmo endpoint em vez de criar um cron novo.`
  );
}

// cada schedule precisa ser "1x por dia no máximo": minuto e hora fixos.
for (const c of crons) {
  const sched = String(c?.schedule ?? "").trim();
  const campos = sched.split(/\s+/);
  if (campos.length !== 5) {
    erro(`Schedule inválido em "${c?.path}": "${sched}" (esperado 5 campos cron).`);
  }
  const [minuto, hora] = campos;
  const fixo = (v) => /^\d+$/.test(v); // só um número, sem *, /, ,, -
  if (!fixo(minuto) || !fixo(hora)) {
    erro(
      `O cron "${c?.path}" ("${sched}") roda mais de 1x por dia. ` +
        `O plano só permite 1x/dia: use minuto e hora fixos, ex: "0 6 * * *".`
    );
  }
}

console.log(`✓ vercel.json ok: ${crons.length}/${MAX_CRONS} cron job(s), todos 1x/dia.`);
