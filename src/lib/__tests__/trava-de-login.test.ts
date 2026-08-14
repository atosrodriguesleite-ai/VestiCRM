import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  chavesDoLogin,
  ipDaRequisicao,
  JANELA_MS,
  BLOQUEIO_MS,
  LIMITE_POR_IP,
  LIMITE_POR_LOGIN,
  LIMITE_POR_PAR,
} from "../rate-limit";

/**
 * TRAVA DE FORÇA BRUTA NO LOGIN.
 *
 * Achado da auditoria de arquitetura (09/08/2026): a porta de entrada
 * aceitava tentativas de senha SEM LIMITE nenhum — e 158 das 181 rotas do
 * sistema passam por ela. Era o ponto mais valioso e o mais desprotegido.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const rota = ler("src/app/api/auth/login/route.ts");
const lib = ler("src/lib/rate-limit.ts");

const headers = (h: Record<string, string>) => new Headers(h);

describe("de quem é a tentativa", () => {
  it("prefere o x-real-ip (escrito pela borda da Vercel)", () => {
    expect(
      ipDaRequisicao(headers({ "x-real-ip": "200.1.2.3", "x-forwarded-for": "9.9.9.9" }))
    ).toBe("200.1.2.3");
  });

  it("sem ele, usa o PRIMEIRO da lista do x-forwarded-for (o cliente)", () => {
    expect(ipDaRequisicao(headers({ "x-forwarded-for": "200.1.2.3, 10.0.0.1" }))).toBe(
      "200.1.2.3"
    );
  });

  it("sem endereço nenhum, a trava por IP não se aplica", () => {
    // agrupar todo mundo numa chave "desconhecido" travaria gente inocente
    expect(ipDaRequisicao(headers({}))).toBeNull();
    expect(chavesDoLogin("maria@loja.com", null)).toEqual(["login:maria@loja.com"]);
  });

  it("endereço absurdo é cortado (não vira chave gigante no banco)", () => {
    const enorme = "x".repeat(500);
    expect(ipDaRequisicao(headers({ "x-real-ip": enorme })!)!.length).toBe(45);
  });
});

describe("as duas contagens", () => {
  it("conta o PAR, o login e o IP — cada um barra um ataque diferente", () => {
    expect(chavesDoLogin("Maria@Loja.com", "200.1.2.3")).toEqual([
      "par:maria@loja.com|200.1.2.3",
      "login:maria@loja.com",
      "ip:200.1.2.3",
    ]);
  });

  it("o PAR é o teto BAIXO — travar só pelo login viraria arma", () => {
    // 5 senhas erradas a cada 15 min trancariam a Juliana para sempre, e as
    // contas de demonstração estão impressas na própria tela de login
    expect(LIMITE_POR_PAR).toBeLessThan(LIMITE_POR_LOGIN);
    expect(LIMITE_POR_PAR).toBeLessThanOrEqual(5);
  });

  it("o login é normalizado (MARIA@ e maria@ são a mesma conta)", () => {
    expect(chavesDoLogin("  MARIA@LOJA.COM  ", null)).toEqual(["login:maria@loja.com"]);
  });

  it("o teto por IP é MUITO mais alto que o do par (CGNAT do Brasil)", () => {
    // operadoras de celular põem bairros inteiros atrás de um IP só: teto
    // baixo por IP bloquearia lojista que nunca errou nada
    expect(LIMITE_POR_IP).toBeGreaterThanOrEqual(10 * LIMITE_POR_PAR);
  });

  it("os tempos são humanos: janela e bloqueio de minutos, não de horas", () => {
    expect(JANELA_MS).toBe(15 * 60 * 1000);
    expect(BLOQUEIO_MS).toBe(15 * 60 * 1000);
    // trava eterna vira arma: qualquer um derrubaria a conta da lojista
    expect(BLOQUEIO_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("INVARIANTE: a janela não pode ser menor que o bloqueio", () => {
    // se fosse, ao vencer o bloqueio o contador ainda estaria cheio e a
    // conta seria retrancada a cada senha errada seguinte, para sempre
    expect(JANELA_MS).toBeGreaterThanOrEqual(BLOQUEIO_MS);
  });
});

describe("a porta de entrada está trancada", () => {
  it("a rota consulta a trava ANTES de procurar o usuário", () => {
    const posTrava = rota.indexOf("segundosDeBloqueio");
    const posBusca = rota.indexOf("db.user.findUnique");
    expect(posTrava).toBeGreaterThan(-1);
    expect(posTrava).toBeLessThan(posBusca); // tentativa barrada custa quase nada
  });

  it("responde 429 com Retry-After (o padrão que os navegadores entendem)", () => {
    expect(rota).toContain("status: 429");
    expect(rota).toContain('"Retry-After"');
  });

  it("a tentativa é contada ANTES de conferir a senha", () => {
    // conferir senha leva ~90ms: contando depois, centenas de requisições
    // disparadas juntas passavam todas pela leitura do bloqueio antes de a
    // primeira incrementar — 300 senhas testadas numa janela que cabia 5
    const posConta = rota.indexOf("registrarTentativa(chaves)");
    const posSenha = rota.indexOf("bcrypt.compare");
    expect(posConta).toBeGreaterThan(-1);
    expect(posConta).toBeLessThan(posSenha);
  });

  it("quem entra tem o contador zerado", () => {
    expect(rota).toContain("await limparFalhas(chaves)");
  });

  it("acertar UMA conta não limpa o contador do IP", () => {
    // senão o robô se limparia sozinho no meio do ataque
    expect(lib).toContain('c.startsWith("login:") || c.startsWith("par:")');
    expect(lib).not.toMatch(/limparFalhas[\s\S]{0,400}startsWith\("ip:"\)/);
  });
});

describe("a porta não entrega quais contas existem", () => {
  it("confere a senha SEMPRE, mesmo sem usuário (vazamento por tempo)", () => {
    // responder na hora quando o login não existe transforma a porta num
    // detector de contas: o robô cronometra e descobre os e-mails reais
    expect(rota).toContain("HASH_DE_MENTIRA");
    expect(rota).toContain("user?.passwordHash ?? HASH_DE_MENTIRA");
  });

  it("nunca sai antes da conferência quando o usuário não existe", () => {
    const posBusca = rota.indexOf("db.user.findUnique");
    const posCompare = rota.indexOf("bcrypt.compare");
    const trecho = rota.slice(posBusca, posCompare);
    expect(/return NextResponse/.test(trecho)).toBe(false);
  });

  it("a mensagem de erro é a MESMA para login errado e senha errada", () => {
    expect(rota).toContain("ERRO_GENERICO");
    expect((rota.match(/E-mail ou senha inválidos/g) ?? []).length).toBe(1);
  });
});

describe("a trava não pode virar o problema", () => {
  it("banco fora do ar NÃO impede a loja de entrar", () => {
    // trava que derruba o login é pior que o ataque que ela evita
    const blocos = lib.match(/catch \{/g) ?? [];
    expect(blocos.length).toBeGreaterThanOrEqual(4);
    expect(lib).toContain("return null;");
  });

  it("o contador é atômico (duas tentativas juntas contam duas)", () => {
    expect(lib).toContain("fails: { increment: 1 }");
  });

  it("a janela anda pela PRIMEIRA tentativa, não pela última", () => {
    // pelo updatedAt, tentativas espaçadas ao longo de horas se acumulavam
    // até travar um IP de CGNAT com lojistas que nunca erraram nada
    expect(lib).toContain("firstFailAt: { lt: new Date(agora.getTime() - JANELA_MS) }");
  });

  it("a faxina também roda sob ataque (sem nenhum login bem-sucedido)", () => {
    expect(lib).toMatch(/maiorBloqueio > 0[\s\S]{0,200}faxinaDeTravas\(agora\)/);
  });

  it("a janela anda sozinha, sem cron (o plano Hobby não tem vaga)", () => {
    expect(lib).toContain("deleteMany");
    expect(lib).toContain("faxinaDeTravas");
    expect(rota).toContain("faxinaDeTravas()");
    // nenhum cron novo no vercel.json
    const vercel = ler("vercel.json");
    expect((vercel.match(/"path"/g) ?? []).length).toBeLessThanOrEqual(2);
  });
});
