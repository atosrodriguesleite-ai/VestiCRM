import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { db } from "./db";
import { AUTH_SECRET } from "./env";
import { evoSendText } from "./comm/evolution";
import { normalizePhone } from "./intake";

/**
 * RN-045 · CÓDIGO DE LOGIN PELO WHATSAPP EM APARELHO NOVO.
 *
 * Senha vazada é o jeito mais provável de alguém entrar na conta de uma
 * vendedora — e com ela vem a carteira de clientes inteira. O segundo fator
 * aqui é desenhado para ESTE público: nada de aplicativo autenticador — o
 * código chega no WhatsApp da própria pessoa, mandado pela conexão da
 * própria loja (o canal onde ela vive o dia todo).
 *
 * As decisões que não podem se perder:
 * - **Opt-in por loja** (`Company.loginCodeEnabled`, chavinha na Equipe) e
 *   **por pessoa** (`User.loginPhone`): sem os dois, o login é o de sempre.
 * - **Aparelho conhecido não pede código** (cookie assinado, 90 dias): o
 *   fator só aparece no PRIMEIRO acesso de um aparelho — segurança que
 *   atrapalha todo dia é segurança que a loja desliga.
 * - **NUNCA TRANCA A LOJISTA FORA**: se o código não tem como chegar
 *   (WhatsApp da loja desconectado, envio falhou), o login entra como hoje
 *   e o ocorrido fica REGISTRADO (`login.codigo-falhou` na Central de
 *   Comunicação) — trancar a dona fora do próprio sistema por causa de uma
 *   conexão caída seria pior que o risco que o código cobre.
 * - O código nunca é guardado (só o HMAC), vale 10 minutos e morre com 5
 *   erros — a contagem sobe ANTES de conferir (mesma lição da trava do
 *   login: conferir primeiro deixava a corrida testar vários de uma vez).
 */

export const COOKIE_APARELHO = "vesticrm_aparelho";
/** Aparelho conhecido fica dispensado do código por 90 dias. */
export const DIAS_APARELHO_CONFIAVEL = 90;
export const MINUTOS_DO_CODIGO = 10;
export const MAX_ERROS_DO_CODIGO = 5;

const hmac = (texto: string) =>
  createHmac("sha256", AUTH_SECRET).update(texto).digest("hex");

/** Seis dígitos, do gerador criptográfico (zero à esquerda vale). */
export function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashDoCodigo(codigo: string): string {
  return hmac(`codigo-login:${codigo}`);
}

/** Valor do cookie de aparelho confiável: `userId.validade.assinatura`. */
export function assinarAparelho(userId: string, agora = Date.now()): string {
  const validade = agora + DIAS_APARELHO_CONFIAVEL * 86_400_000;
  return `${userId}.${validade}.${hmac(`aparelho:${userId}.${validade}`)}`;
}

/**
 * Este cookie dispensa ESTE usuário do código? Conferido por HMAC — cookie
 * editado, vencido ou de OUTRA pessoa não vale (o aparelho é confiável para
 * quem o confirmou, não para qualquer conta usada nele).
 */
export function aparelhoConfiavel(
  valor: string | undefined,
  userId: string,
  agora = Date.now()
): boolean {
  if (!valor) return false;
  const partes = valor.split(".");
  if (partes.length !== 3) return false;
  const [quem, validadeTexto, assinatura] = partes;
  const validade = Number(validadeTexto);
  if (quem !== userId || !Number.isFinite(validade) || validade < agora) return false;
  const esperada = hmac(`aparelho:${quem}.${validadeTexto}`);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Cria o desafio (limpando os vencidos de carona) e devolve o código para o
 * envio. O código NÃO fica no banco — só o HMAC.
 */
export async function criarDesafio(
  userId: string
): Promise<{ desafioId: string; codigo: string }> {
  await db.loginCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const codigo = gerarCodigo();
  const linha = await db.loginCode.create({
    data: {
      userId,
      codeHash: hashDoCodigo(codigo),
      expiresAt: new Date(Date.now() + MINUTOS_DO_CODIGO * 60_000),
    },
  });
  return { desafioId: linha.id, codigo };
}

/**
 * Confere o código de um desafio. Devolve o userId quando bate; null quando
 * não. O contador de erros sobe ANTES da comparação (increment atômico) e o
 * desafio é APAGADO no acerto — código não se usa duas vezes.
 */
export async function conferirCodigo(
  desafioId: string,
  codigo: string
): Promise<string | null> {
  // o increment atômico é a trava: 5 chutes e o desafio morre, mesmo que
  // cheguem todos no mesmo instante
  const linhas = await db.loginCode.updateMany({
    where: {
      id: desafioId,
      expiresAt: { gt: new Date() },
      tries: { lt: MAX_ERROS_DO_CODIGO },
    },
    data: { tries: { increment: 1 } },
  });
  if (linhas.count === 0) return null;
  const desafio = await db.loginCode.findUnique({ where: { id: desafioId } });
  if (!desafio) return null;
  const a = Buffer.from(hashDoCodigo(codigo));
  const b = Buffer.from(desafio.codeHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await db.loginCode.delete({ where: { id: desafioId } }).catch(() => {
    // já apagado por uma corrida: o acerto continua valendo uma vez só,
    // porque o delete de quem chegou primeiro levou o desafio embora
  });
  return desafio.userId;
}

/**
 * Manda o código pelo WhatsApp DA LOJA. Devolve false quando não tem como
 * (sem conexão, envio recusado) — e aí o login segue SEM código (fail-open
 * da RN-045), com o motivo registrado por quem chamou.
 */
export async function enviarCodigoWhatsApp(
  companyId: string,
  loginPhone: string,
  codigo: string
): Promise<boolean> {
  try {
    const settings = await db.commSettings.findUnique({
      where: { companyId },
      select: { evolutionInstance: true, evolutionStatus: true },
    });
    if (!settings?.evolutionInstance || settings.evolutionStatus !== "CONECTADO") {
      return false;
    }
    const numero = normalizePhone(loginPhone);
    if (numero.length < 10) return false;
    const res = await evoSendText(
      settings.evolutionInstance,
      numero,
      `🔐 Seu código de acesso: *${codigo}*\n\nVale por ${MINUTOS_DO_CODIGO} minutos. Se não foi você tentando entrar, troque sua senha.`,
      undefined,
      // teto CURTO: esta chamada segura a tela de login — servidor Evolution
      // travado não pode congelar a entrada por 45s (o fail-open assume)
      8_000
    );
    // o evo() NÃO lança quando o servidor recusa — devolve ok:false. Dizer
    // "enviado" sem conferir deixaria a pessoa numa tela esperando um código
    // que nunca chega (o lockout que a RN-045 proíbe). Timeout (`incerto`)
    // também cai no fail-open: a entrada sai liberada e, se a mensagem
    // chegou atrasada, o código sobrando não abre nada sozinho.
    return res.ok === true;
  } catch {
    return false;
  }
}
