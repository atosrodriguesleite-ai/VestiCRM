import { describe, expect, it } from "vitest";
import {
  conexoesPorServidor,
  diagnosticarVelocidade,
  lerEnderecoDoBanco,
  medirIdaAoBanco,
  nomeDaRegiaoAws,
  nomeDaRegiaoVercel,
  regiaoVercelDoBanco,
} from "../velocidade-do-banco";

describe("lerEnderecoDoBanco — só região e bandeiras, nunca o segredo", () => {
  it("lê a região do Neon, direto e pelo pooler", () => {
    expect(
      lerEnderecoDoBanco("postgresql://u:senha@ep-calm-sun-123456.sa-east-1.aws.neon.tech/db?sslmode=require")
    ).toEqual({ regiao: "sa-east-1", pooler: false, pgbouncer: false, limiteDeConexoes: null });
    expect(
      lerEnderecoDoBanco(
        "postgresql://u:senha@ep-calm-sun-123456-pooler.us-east-1.aws.neon.tech/db?sslmode=require&pgbouncer=true"
      )
    ).toEqual({ regiao: "us-east-1", pooler: true, pgbouncer: true, limiteDeConexoes: null });
  });

  it("endereço sem região (local) ou torto não quebra", () => {
    expect(lerEnderecoDoBanco("postgresql://postgres@127.0.0.1:5433/vesti").regiao).toBeNull();
    expect(lerEnderecoDoBanco("isso não é url")).toEqual({ regiao: null, pooler: false, pgbouncer: false, limiteDeConexoes: null });
    expect(lerEnderecoDoBanco(undefined).regiao).toBeNull();
  });

  it("o que volta não carrega usuário nem senha", () => {
    const lido = JSON.stringify(lerEnderecoDoBanco("postgresql://dono:S3gr3d0@ep-x.sa-east-1.aws.neon.tech/db"));
    expect(lido).not.toContain("S3gr3d0");
    expect(lido).not.toContain("dono");
  });
});

describe("nomes das regiões", () => {
  it("em português, com o código ao lado", () => {
    expect(nomeDaRegiaoAws("sa-east-1")).toBe("São Paulo · sa-east-1");
    expect(nomeDaRegiaoVercel("iad1")).toBe("Virgínia (EUA) · iad1");
    expect(nomeDaRegiaoVercel(undefined)).toContain("fora da Vercel");
    expect(regiaoVercelDoBanco("sa-east-1")).toBe("gru1");
  });
});

describe("diagnosticarVelocidade", () => {
  const banco = (regiao: string, pgbouncer = false) => ({ regiao, pooler: true, pgbouncer, limiteDeConexoes: null });

  it("servidor e banco em países diferentes é CRÍTICO e diz para onde mudar", () => {
    const d = diagnosticarVelocidade({ regiaoServidor: "iad1", banco: banco("sa-east-1"), idaMs: 120 });
    expect(d.nivel).toBe("CRITICO");
    expect(d.frases.join(" ")).toContain("gru1");
    expect(d.frases.join(" ")).toContain("120 ms");
  });

  it("pgbouncer=true é CRÍTICO mesmo no mesmo lugar", () => {
    const d = diagnosticarVelocidade({ regiaoServidor: "gru1", banco: banco("sa-east-1", true), idaMs: 2 });
    expect(d.nivel).toBe("CRITICO");
    expect(d.frases.join(" ")).toContain("pgbouncer=true");
  });

  it("no mesmo lugar e rápido é OK", () => {
    const d = diagnosticarVelocidade({ regiaoServidor: "gru1", banco: banco("sa-east-1"), idaMs: 2 });
    expect(d.nivel).toBe("OK");
  });

  it("sem nada para medir não inventa veredito", () => {
    const d = diagnosticarVelocidade({ regiaoServidor: null, banco: lerEnderecoDoBanco(null), idaMs: null });
    expect(d.nivel).toBe("OK");
    expect(d.frases[0]).toContain("Não deu para medir");
  });
});

describe("medirIdaAoBanco", () => {
  it("devolve a mediana e não derruba a tela quando o banco falha", async () => {
    let n = 0;
    expect(await medirIdaAoBanco(async () => n++, 3)).toBeGreaterThanOrEqual(0);
    expect(n).toBe(4); // uma de aquecimento + 3 medidas
    expect(await medirIdaAoBanco(async () => { throw new Error("fora"); })).toBeNull();
  });
});

describe("conexões por servidor: quantas consultas andam juntas", () => {
  const perto = { regiao: "sa-east-1", pooler: true, pgbouncer: false, limiteDeConexoes: null };

  it("lê o connection_limit do endereço; sem ele vale o padrão do Prisma (2 × núcleos + 1)", () => {
    const comLimite = lerEnderecoDoBanco("postgresql://u:s@ep-x-pooler.sa-east-1.aws.neon.tech/db?connection_limit=10");
    expect(comLimite.limiteDeConexoes).toBe(10);
    expect(conexoesPorServidor(comLimite, 1)).toEqual({ total: 10, doEndereco: true });
    expect(conexoesPorServidor(perto, 1)).toEqual({ total: 3, doEndereco: false });
    expect(conexoesPorServidor(perto, 4)).toEqual({ total: 9, doEndereco: false });
    expect(conexoesPorServidor(perto, null)).toBeNull();
    // número torto no endereço não vira limite
    expect(lerEnderecoDoBanco("postgresql://u:s@h.sa-east-1.aws.neon.tech/db?connection_limit=abc").limiteDeConexoes).toBeNull();
  });

  it("banco LONGE com 3 conexões avisa — e só manda subir quando é o pooler", () => {
    const longe = diagnosticarVelocidade({ regiaoServidor: "gru1", banco: perto, idaMs: 110, nucleos: 1 });
    expect(longe.frases.join(" ")).toContain("só 3 conexões");
    expect(longe.frases.join(" ")).toContain("connection_limit=10");
    const direto = diagnosticarVelocidade({
      regiaoServidor: "gru1",
      banco: { ...perto, pooler: false },
      idaMs: 110,
      nucleos: 1,
    });
    expect(direto.frases.join(" ")).toContain("POOLER");
    expect(direto.frases.join(" ")).not.toContain("connection_limit=10");
  });

  it("banco PERTO, ou conexões que já bastam, não vira aviso", () => {
    const rapido = diagnosticarVelocidade({ regiaoServidor: "gru1", banco: perto, idaMs: 2, nucleos: 1 });
    expect(rapido.nivel).toBe("OK");
    expect(rapido.frases.join(" ")).not.toContain("conexões");
    const jaBasta = diagnosticarVelocidade({
      regiaoServidor: "gru1",
      banco: { ...perto, limiteDeConexoes: 10 },
      idaMs: 110,
      nucleos: 1,
    });
    expect(jaBasta.frases.join(" ")).not.toContain("conexões");
  });
});
