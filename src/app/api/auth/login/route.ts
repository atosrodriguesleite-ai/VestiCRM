import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import {
  chavesDoLogin,
  faxinaDeTravas,
  ipDaRequisicao,
  limparFalhas,
  registrarTentativa,
  segundosDeBloqueio,
} from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().min(1).max(200), // e-mail OU nome de usuário
  // teto só para não engolir corpo gigante; alto o bastante para nunca
  // trancar ninguém fora (o cadastro de equipe não limita o tamanho)
  password: z.string().min(1).max(1000),
});

/**
 * SENHA FALSA para gastar o mesmo tempo quando o login não existe.
 *
 * Sem isso a porta virava um detector de contas: conferir uma senha leva
 * ~90ms (bcrypt), e o código respondia NA HORA quando o login não existia.
 * Cronometrando a resposta, um robô descobria quais e-mails são de clientes
 * reais — e depois concentrava o ataque só neles. Agora as duas respostas
 * demoram o mesmo, e o texto de erro também é o mesmo.
 */
const HASH_DE_MENTIRA =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/** Mensagem única: nunca diz se o erro foi o login ou a senha. */
const ERRO_GENERICO = "E-mail ou senha inválidos";

const muitasTentativas = (segundos: number) =>
  NextResponse.json(
    {
      error: `Muitas tentativas de senha. Por segurança, tente de novo em ${Math.ceil(segundos / 60)} minuto(s).`,
    },
    { status: 429, headers: { "Retry-After": String(segundos) } }
  );

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const login = parsed.data.email.trim().toLowerCase();
  const chaves = chavesDoLogin(login, ipDaRequisicao(req.headers));

  // 1) PORTA FECHADA? Antes de qualquer consulta — tentativa barrada custa
  //    quase nada para o servidor.
  const espera = await segundosDeBloqueio(chaves);
  if (espera !== null) return muitasTentativas(espera);

  // 2) CONTA A TENTATIVA ANTES de conferir a senha. Contar depois deixava
  //    uma brecha real: conferir senha leva ~90ms, então centenas de
  //    requisições disparadas juntas passavam TODAS pela leitura do passo 1
  //    antes de a primeira incrementar o contador. Quem acerta a senha tem o
  //    contador apagado no passo 4 — ninguém que entra é penalizado.
  const bloqueouAgora = await registrarTentativa(chaves);

  // 3) Confere a senha SEMPRE, mesmo sem usuário (ver HASH_DE_MENTIRA).
  const user = await db.user.findUnique({
    where: login.includes("@") ? { email: login } : { username: login },
  });
  const senhaConfere = await bcrypt.compare(
    parsed.data.password,
    user?.passwordHash ?? HASH_DE_MENTIRA
  );
  const entrou = Boolean(user?.active) && senhaConfere;

  if (!entrou) {
    if (bloqueouAgora !== null) return muitasTentativas(bloqueouAgora);
    return NextResponse.json({ error: ERRO_GENERICO }, { status: 401 });
  }

  // 4) Entrou: o contador desta pessoa zera (o do IP não — ver limparFalhas)
  await limparFalhas(chaves);
  await createSession(user!.id);
  // faxina de carona: sem cron novo, o plano Hobby não tem vaga
  faxinaDeTravas().catch(() => {});
  return NextResponse.json({ ok: true, role: user!.role });
}
