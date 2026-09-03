import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import {
  COOKIE_APARELHO,
  aparelhoConfiavel,
  criarDesafio,
  enviarCodigoWhatsApp,
} from "@/lib/auth-codigo";
import {
  chavesDeCodigoDoUsuario,
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
    include: { company: { select: { loginCodeEnabled: true } } },
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
  // faxina de carona: sem cron novo, o plano Hobby não tem vaga
  faxinaDeTravas().catch(() => {});

  // 5) SEGUNDO FATOR (RN-045): loja com a chavinha ligada + pessoa com
  //    WhatsApp de login + APARELHO DESCONHECIDO → o código vai pelo
  //    WhatsApp e a sessão só nasce depois dele. Se o código não tem como
  //    chegar, o login segue (fail-open) com o motivo REGISTRADO — trancar
  //    a lojista fora do próprio sistema seria pior que o risco coberto.
  const podePedirCodigo =
    user!.company.loginCodeEnabled &&
    !!user!.loginPhone &&
    !aparelhoConfiavel(req.cookies.get(COOKIE_APARELHO)?.value, user!.id);
  if (podePedirCodigo) {
    // teto de ENVIOS por pessoa (3/15min): quem tem a senha não pode usar o
    // login para metralhar códigos pelo WhatsApp da loja (rajada = risco de
    // banimento, RN-017 — e assédio na dona do telefone)
    const chavesCodigo = chavesDeCodigoDoUsuario(user!.id);
    const recusaCodigo = NextResponse.json(
      { error: "Muitos códigos enviados — aguarde alguns minutos e tente de novo." },
      { status: 429 }
    );
    if ((await segundosDeBloqueio(chavesCodigo)) !== null) return recusaCodigo;
    if ((await registrarTentativa(chavesCodigo)) !== null) return recusaCodigo;
    const { desafioId, codigo } = await criarDesafio(user!.id);
    const enviado = await enviarCodigoWhatsApp(user!.companyId, user!.loginPhone!, codigo);
    if (enviado) {
      return NextResponse.json({ ok: true, precisaCodigo: true, desafio: desafioId });
    }
    // desafio sem envio não pode ficar vivo (ninguém tem o código dele)
    await db.loginCode.delete({ where: { id: desafioId } }).catch(() => {});
    await db.commEvent
      .create({
        data: {
          companyId: user!.companyId,
          direction: "OUT",
          type: "login.codigo-falhou",
          status: "ERRO",
          error: `Código de login de ${user!.name} não pôde ser enviado (WhatsApp da loja desconectado ou envio recusado) — a entrada foi liberada sem o código, como manda a RN-045.`,
        },
      })
      .catch(() => {
        // o registro é aviso; falhar aqui não pode impedir a entrada
      });
  }

  await createSession(user!.id);
  return NextResponse.json({ ok: true, role: user!.role });
}
