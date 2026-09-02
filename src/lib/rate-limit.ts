import { db } from "./db";

/**
 * TRAVA DE FORÇA BRUTA NO LOGIN.
 *
 * Até aqui a porta de entrada do sistema aceitava tentativas SEM LIMITE:
 * um robô podia testar milhões de senhas na velocidade da máquina, sem
 * espera, sem bloqueio e sem ninguém ficar sabendo. Como 158 das 181 rotas
 * passam por essa mesma porta, ela é o ponto mais valioso do sistema inteiro
 * (auditoria de arquitetura, 09/08/2026).
 *
 * TRÊS CONTAGENS, cada uma barrando um ataque diferente — e a primeira
 * existindo para a trava não virar arma contra a própria lojista:
 *
 *  1. PAR (login + IP) — teto BAIXO. É o cavalo de batalha: pega o robô
 *     martelando uma conta de um lugar só, e não atrapalha mais ninguém.
 *  2. LOGIN sozinho — teto ALTO. Só dispara em ataque distribuído (muitos
 *     IPs contra a mesma conta).
 *  3. IP sozinho — teto ALTO. Pega o robô que espalha uma senha comum por
 *     várias contas (sem isso, bastaria trocar de conta a cada tentativa).
 *
 * POR QUE O PAR VEM PRIMEIRO: travar a conta só pelo login deixaria qualquer
 * um derrubar a lojista de propósito — 5 senhas erradas a cada 15 minutos e a
 * Juliana nunca mais entra. E as contas de demonstração estão impressas na
 * própria tela de login. Com o par, o atacante só tranca a si mesmo.
 *
 * ONDE FICA A CONTA: no banco. Guardar em memória não serve na Vercel —
 * cada requisição pode cair numa máquina diferente, e a memória some a cada
 * hibernação. Contador que zera sozinho não é trava.
 *
 * SEM CRON NOVO (regra crítica da casa: o plano Hobby aceita 2 crons e um
 * terceiro bloqueia TODOS os deploys em silêncio). A limpeza pega carona no
 * próprio tráfego de login.
 */

/**
 * Janela de contagem, medida a partir da PRIMEIRA tentativa da chave.
 *
 * Precisa ser >= BLOQUEIO_MS: é o que garante que, quando o bloqueio vence,
 * a janela também venceu e o contador começa do zero. Se a janela fosse
 * menor, a conta seria retrancada a cada senha errada seguinte, para sempre.
 */
export const JANELA_MS = 15 * 60 * 1000;

/** Quanto tempo a porta fica fechada depois de estourar o teto. */
export const BLOQUEIO_MS = 15 * 60 * 1000;

/** Teto do PAR login+IP: cinco erros é folgado para gente, apertado para robô. */
export const LIMITE_POR_PAR = 5;

/**
 * Teto do LOGIN sozinho — alto de propósito. Serve só contra ataque
 * distribuído; baixo demais viraria um jeito fácil de trancar a lojista.
 */
export const LIMITE_POR_LOGIN = 30;

/**
 * Teto do IP sozinho — deliberadamente ALTO por causa do Brasil.
 *
 * As operadoras de celular usam CGNAT: bairros inteiros saem pela internet
 * com o MESMO endereço. Um teto baixo por IP bloquearia lojistas de verdade
 * que nunca erraram nada. Cinquenta tentativas em 15 minutos não é gente
 * digitando — é máquina.
 */
export const LIMITE_POR_IP = 50;

/**
 * O endereço de quem está batendo na porta.
 *
 * Na Vercel o `x-real-ip` é escrito pela borda da própria plataforma — é o
 * mais confiável. O `x-forwarded-for` entra como plano B, sempre pelo
 * PRIMEIRO endereço da lista (o cliente). Sem nenhum dos dois, a trava por
 * IP simplesmente não se aplica (a do login continua valendo) — é melhor do
 * que agrupar o mundo inteiro numa chave "desconhecido" e travar todo mundo.
 */
export function ipDaRequisicao(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 45);
  const encaminhado = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return encaminhado ? encaminhado.slice(0, 45) : null;
}

/**
 * RITMO DAS PORTAS PÚBLICAS DE ESCRITA (RN-043).
 *
 * O pedido do catálogo não tem login — e sem ritmo, um script criava
 * pedidos falsos de graça, cada um RESERVANDO estoque sem prazo (RN-003):
 * o ataque mais barato contra uma loja. A trava reusa a mesma engenharia
 * do login (contador no banco, janela de 15 min, sem cron).
 *
 * Os tetos são FOLGADOS de propósito: 20 pedidos DIFERENTES em 15 minutos
 * na mesma loja não é um cliente — e ainda cabe uma promoção ao vivo com
 * vários clientes atrás do MESMO IP de operadora (CGNAT); baixo demais
 * travaria gente inocente, e o custo de um falso bloqueio é só atraso
 * (o pendente entra sozinho depois), nunca perda. Quem decide o desenho
 * anti-perda é a ROTA: o reenvio do MESMO pedido (protocolo `clientRef`)
 * passa ANTES da trava e nunca é barrado.
 */
export const LIMITE_CATALOGO_POR_PAR = 20; // IP + loja
export const LIMITE_CATALOGO_POR_IP = 60; // IP em todas as lojas
export const LIMITE_DEMO_POR_IP = 5; // formulário de demonstração

/** Chaves do pedido do catálogo. Sem IP identificável, não trava (RN-010). */
export function chavesDoPedidoCatalogo(companyId: string, ip: string | null): string[] {
  if (!ip) return [];
  return [`cat:${companyId}|${ip}`, `catip:${ip}`];
}

/** Chave do formulário de demonstração da landing page. */
export function chavesDoDemo(ip: string | null): string[] {
  return ip ? [`demo:${ip}`] : [];
}

/** As chaves contadas nesta tentativa (ver as três contagens acima). */
export function chavesDoLogin(login: string, ip: string | null): string[] {
  const quem = login.trim().toLowerCase().slice(0, 120);
  if (!ip) return [`login:${quem}`];
  return [`par:${quem}|${ip}`, `login:${quem}`, `ip:${ip}`];
}

/** O teto de cada tipo de chave. */
function limiteDa(chave: string): number {
  if (chave.startsWith("par:")) return LIMITE_POR_PAR;
  if (chave.startsWith("ip:")) return LIMITE_POR_IP;
  if (chave.startsWith("cat:")) return LIMITE_CATALOGO_POR_PAR;
  if (chave.startsWith("catip:")) return LIMITE_CATALOGO_POR_IP;
  if (chave.startsWith("demo:")) return LIMITE_DEMO_POR_IP;
  return LIMITE_POR_LOGIN;
}

/**
 * A porta está fechada para alguma destas chaves? Devolve os SEGUNDOS que
 * faltam para reabrir, ou `null` quando está liberada.
 *
 * Nunca lança: banco indisponível não pode impedir a loja de entrar no
 * sistema (uma trava que derruba o login é pior que o ataque que ela evita).
 */
export async function segundosDeBloqueio(
  chaves: string[],
  agora = new Date()
): Promise<number | null> {
  try {
    const travas = await db.loginThrottle.findMany({
      where: { key: { in: chaves }, blockedUntil: { gt: agora } },
      select: { blockedUntil: true },
    });
    if (travas.length === 0) return null;
    const maisLonge = Math.max(
      ...travas.map((t) => t.blockedUntil!.getTime() - agora.getTime())
    );
    return Math.max(1, Math.ceil(maisLonge / 1000));
  } catch {
    return null;
  }
}

/**
 * Conta ESTA tentativa e fecha a porta quando o teto estoura. Devolve os
 * segundos de bloqueio quando a trava fechou agora.
 *
 * Conta TENTATIVA, não "falha", e é chamada ANTES de conferir a senha — de
 * propósito. Contar só depois deixava uma brecha real: conferir senha leva
 * ~90ms, então 300 requisições disparadas juntas passavam TODAS pela leitura
 * do bloqueio antes de a primeira incrementar o contador, testando 300 senhas
 * numa janela em que só cabiam 5. Quem acerta a senha tem o contador apagado
 * logo em seguida, então quem entra nunca é penalizado.
 */
export async function registrarTentativa(
  chaves: string[],
  agora = new Date()
): Promise<number | null> {
  try {
    // Contador vencido é apagado antes de contar — é assim que a janela anda
    // sem cron. A conta é pelo `firstFailAt` (a PRIMEIRA tentativa), não pela
    // última: senão a janela nunca fechava e tentativas espaçadas ao longo de
    // horas se acumulavam até travar quem nunca errou nada.
    await db.loginThrottle.deleteMany({
      where: {
        key: { in: chaves },
        firstFailAt: { lt: new Date(agora.getTime() - JANELA_MS) },
        OR: [{ blockedUntil: null }, { blockedUntil: { lt: agora } }],
      },
    });

    let maiorBloqueio = 0;
    for (const chave of chaves) {
      // `increment` é atômico: duas tentativas simultâneas contam duas
      const linha = await db.loginThrottle.upsert({
        where: { key: chave },
        create: { key: chave, fails: 1, firstFailAt: agora },
        update: { fails: { increment: 1 } },
      });
      if (linha.fails >= limiteDa(chave)) {
        await db.loginThrottle.update({
          where: { key: chave },
          data: { blockedUntil: new Date(agora.getTime() + BLOQUEIO_MS) },
        });
        maiorBloqueio = Math.max(maiorBloqueio, BLOQUEIO_MS);
      }
    }
    if (maiorBloqueio > 0) {
      // faxina de carona no bloqueio: sob ataque distribuído não existe
      // login bem-sucedido para carregá-la, e as linhas cresceriam sem teto
      faxinaDeTravas(agora).catch(() => {});
      return Math.ceil(maiorBloqueio / 1000);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Entrou: as contas DESTA pessoa ficam limpas (o par e o login).
 *
 * O contador do IP NÃO é zerado, de propósito: senão o robô se limparia
 * sozinho — bastaria acertar uma conta qualquer no meio do ataque para o
 * contador do IP voltar do zero.
 */
export async function limparFalhas(chaves: string[]): Promise<void> {
  try {
    await db.loginThrottle.deleteMany({
      where: {
        key: {
          in: chaves.filter((c) => c.startsWith("login:") || c.startsWith("par:")),
        },
      },
    });
  } catch {
    // limpeza que falha não pode impedir a pessoa de entrar
  }
}

/**
 * Faxina geral: apaga contadores que não servem mais a ninguém.
 *
 * Roda de carona no login bem-sucedido e em cada bloqueio novo — NUNCA em
 * cron, porque o plano Hobby não tem vaga (um 3º cron bloqueia os deploys).
 */
export async function faxinaDeTravas(agora = new Date()): Promise<void> {
  try {
    await db.loginThrottle.deleteMany({
      where: {
        updatedAt: { lt: new Date(agora.getTime() - 24 * 60 * 60 * 1000) },
        OR: [{ blockedUntil: null }, { blockedUntil: { lt: agora } }],
      },
    });
  } catch {
    // faxina é higiene, não pode atrapalhar ninguém
  }
}
