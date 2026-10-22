/**
 * ONDE ESTÃO O SERVIDOR E O BANCO — E QUANTO CUSTA CADA IDA (22/10/2026).
 *
 * Relato do dono: trocar de tela pelo celular levava ~3 s. Medido contra o
 * Postgres local com um atraso de rede simulado, o tempo de cada tela é quase
 * só isto: (quantas idas ao banco ela faz em fila) × (quanto leva UMA ida).
 * O primeiro número é do código; o segundo é de ONDE as coisas moram — com o
 * servidor da Vercel num país e o banco em outro, cada ida custa ~100 ms; no
 * mesmo lugar, 1–2 ms. Nada disso se vê de fora, então a tela de Saúde mede e
 * DIZ, em vez de alguém consertar no escuro (a lição do Bling).
 *
 * Do endereço do banco sai SÓ a região e duas bandeiras — nunca usuário,
 * senha ou o endereço inteiro (segredo não aparece em tela, nem para o Super
 * Admin).
 */

/** Região do servidor da Vercel → região da AWS em que ela roda. */
const VERCEL_PARA_AWS: Record<string, string> = {
  gru1: "sa-east-1",
  iad1: "us-east-1",
  cle1: "us-east-2",
  pdx1: "us-west-2",
  sfo1: "us-west-1",
  fra1: "eu-central-1",
  cdg1: "eu-west-3",
  lhr1: "eu-west-2",
  dub1: "eu-west-1",
  arn1: "eu-north-1",
  hnd1: "ap-northeast-1",
  kix1: "ap-northeast-3",
  icn1: "ap-northeast-2",
  sin1: "ap-southeast-1",
  syd1: "ap-southeast-2",
  bom1: "ap-south-1",
  hkg1: "ap-east-1",
  cpt1: "af-south-1",
};

const NOME_DA_REGIAO_AWS: Record<string, string> = {
  "sa-east-1": "São Paulo",
  "us-east-1": "Virgínia (EUA)",
  "us-east-2": "Ohio (EUA)",
  "us-west-1": "Califórnia (EUA)",
  "us-west-2": "Oregon (EUA)",
  "eu-central-1": "Frankfurt (Alemanha)",
  "eu-west-1": "Irlanda",
  "eu-west-2": "Londres",
  "eu-west-3": "Paris",
  "eu-north-1": "Estocolmo",
  "ap-southeast-1": "Singapura",
  "ap-southeast-2": "Sydney",
  "ap-northeast-1": "Tóquio",
  "ap-northeast-2": "Seul",
  "ap-northeast-3": "Osaka",
  "ap-south-1": "Mumbai",
  "ap-east-1": "Hong Kong",
  "af-south-1": "Cidade do Cabo",
};

export type EnderecoDoBanco = {
  /** região AWS lida do endereço (ex.: "sa-east-1"); null se não deu para ler */
  regiao: string | null;
  /** endereço do "pooler" do Neon (várias funções dividindo conexões) */
  pooler: boolean;
  /** `pgbouncer=true`: o Prisma embrulha CADA consulta em BEGIN/DEALLOCATE/COMMIT */
  pgbouncer: boolean;
};

/** Lê do endereço do banco só o que importa para a velocidade. */
export function lerEnderecoDoBanco(url: string | undefined | null): EnderecoDoBanco {
  if (!url) return { regiao: null, pooler: false, pgbouncer: false };
  let host = "";
  let busca = new URLSearchParams();
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    busca = u.searchParams;
  } catch {
    return { regiao: null, pooler: false, pgbouncer: false };
  }
  const regiao =
    host.match(/\.((?:[a-z]{2}-)?[a-z]+-[a-z]+-\d)\.(?:aws|azure|gcp)\./)?.[1] ??
    host.match(/\b([a-z]{2}-[a-z]+-\d)\b/)?.[1] ??
    null;
  return {
    regiao,
    pooler: /-pooler\./.test(host),
    pgbouncer: (busca.get("pgbouncer") ?? "").toLowerCase() === "true",
  };
}

export function nomeDaRegiaoAws(regiao: string | null): string {
  if (!regiao) return "não identificada";
  return NOME_DA_REGIAO_AWS[regiao] ? `${NOME_DA_REGIAO_AWS[regiao]} · ${regiao}` : regiao;
}

export function nomeDaRegiaoVercel(regiao: string | null | undefined): string {
  if (!regiao) return "não identificada (fora da Vercel)";
  const aws = VERCEL_PARA_AWS[regiao];
  return aws && NOME_DA_REGIAO_AWS[aws] ? `${NOME_DA_REGIAO_AWS[aws]} · ${regiao}` : regiao;
}

/** A Vercel com sede na mesma região AWS do banco (para o conselho). */
export function regiaoVercelDoBanco(regiaoAws: string | null): string | null {
  if (!regiaoAws) return null;
  return Object.entries(VERCEL_PARA_AWS).find(([, aws]) => aws === regiaoAws)?.[0] ?? null;
}

export type Diagnostico = {
  nivel: "OK" | "ATENCAO" | "CRITICO";
  frases: string[];
};

/**
 * O veredito, em português. `idaMs` é a mediana de UMA ida ao banco medida
 * agora; uma tela comum faz de 10 a 30 idas em fila.
 */
export function diagnosticarVelocidade(entrada: {
  regiaoServidor: string | null | undefined;
  banco: EnderecoDoBanco;
  idaMs: number | null;
}): Diagnostico {
  const frases: string[] = [];
  let nivel: Diagnostico["nivel"] = "OK";
  const subir = (n: Diagnostico["nivel"]) => {
    const ordem = { OK: 0, ATENCAO: 1, CRITICO: 2 };
    if (ordem[n] > ordem[nivel]) nivel = n;
  };

  const awsDoServidor = entrada.regiaoServidor
    ? VERCEL_PARA_AWS[entrada.regiaoServidor] ?? null
    : null;
  if (awsDoServidor && entrada.banco.regiao && awsDoServidor !== entrada.banco.regiao) {
    subir("CRITICO");
    const alvo = regiaoVercelDoBanco(entrada.banco.regiao);
    frases.push(
      `O servidor está em ${nomeDaRegiaoVercel(entrada.regiaoServidor)} e o banco em ${nomeDaRegiaoAws(entrada.banco.regiao)}: cada consulta atravessa essa distância.` +
        (alvo
          ? ` Colocar o servidor em ${alvo} (vercel.json → "regions") deixa cada ida ao banco perto de 1–2 ms.`
          : "")
    );
  }
  if (entrada.banco.pgbouncer) {
    subir("CRITICO");
    frases.push(
      "O endereço do banco tem `pgbouncer=true`: com ele, o Prisma faz 5 idas ao banco para CADA consulta (abre, limpa, pergunta, responde, fecha). O pooler do Neon aceita o endereço sem essa opção."
    );
  }
  if (entrada.idaMs != null) {
    const tela = Math.round((entrada.idaMs * 20) / 100) / 10;
    if (entrada.idaMs >= 30) subir("CRITICO");
    else if (entrada.idaMs >= 8) subir("ATENCAO");
    frases.push(
      `Uma ida ao banco leva ${entrada.idaMs} ms agora. Uma tela comum faz umas 20 em fila: ~${String(tela).replace(".", ",")} s só esperando o banco.`
    );
  }
  if (frases.length === 0) frases.push("Não deu para medir (rodando fora da Vercel ou sem banco).");
  return { nivel, frases };
}

/** Mediana de algumas idas curtas ao banco, em ms (a primeira aquece e é descartada). */
export async function medirIdaAoBanco(
  consultar: () => Promise<unknown>,
  vezes = 5
): Promise<number | null> {
  try {
    await consultar();
    const tempos: number[] = [];
    for (let i = 0; i < vezes; i++) {
      const t = performance.now();
      await consultar();
      tempos.push(performance.now() - t);
    }
    tempos.sort((a, b) => a - b);
    return Math.round(tempos[Math.floor(tempos.length / 2)]);
  } catch {
    return null;
  }
}
