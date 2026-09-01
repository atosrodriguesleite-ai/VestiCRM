import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  condicoesDoLink,
  descontoValido,
  precoComDesconto,
  precisaDoLinkAtualizado,
  descontoNoTexto,
  campanhaNoTexto,
  descontoDoResgate,
  podeApagarDeVez,
  TETO_DE_DESCONTO,
  type CampanhaDoLink,
  type MinimoDaLoja,
} from "../catalogo/condicoes-da-campanha";
import { numeroBR } from "../format";
import { assinaturaDoPedido } from "../catalogo/envio-pedido";

// Guarda RN-040 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * CONDIÇÕES DO LINK DE CAMPANHA — pedido do dono (01/09/2026):
 *
 *   "Quando eu gero o link eu posso editar as condições dele, e pausar a
 *    campanha ou excluir ela se eu quiser. O link que gerei já não posso
 *    mudar nada nele porque já estou usando na campanha."
 *
 * O endereço é congelado (já foi para o grupo, para o QR e para o story);
 * desconto e pedido mínimo se editam a qualquer hora.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const campanha = (over: Partial<CampanhaDoLink> = {}): CampanhaDoLink => ({
  active: true,
  archivedAt: null,
  discount: 0,
  minOrderMode: null,
  minOrderPieces: 0,
  minOrderValue: 0,
  ...over,
});

const loja: MinimoDaLoja = { minOrderMode: "PECAS", minOrder: 10, minOrderValue: 0 };

describe("desconto do link", () => {
  it("aplica a porcentagem em centavos fechados", () => {
    expect(precoComDesconto(33.9, 10)).toBe(30.51);
    expect(precoComDesconto(100, 25)).toBe(75);
  });

  it("sem desconto, o preço passa intacto", () => {
    expect(precoComDesconto(33.9, 0)).toBe(33.9);
  });

  /**
   * 100% sairia DE GRAÇA e negativo COBRARIA A MAIS: fora de 0–90 não é
   * promoção, é engano de digitação. O teto mora na regra, não só na tela.
   */
  it("desconto fora da faixa não vira preço maluco", () => {
    expect(descontoValido(150)).toBe(TETO_DE_DESCONTO);
    expect(descontoValido(-30)).toBe(0);
    expect(descontoValido("abacaxi")).toBe(0);
    expect(precoComDesconto(100, 999)).toBe(10);
  });
});

describe("condições que valem na visita", () => {
  it("sem campanha, vale o mínimo da loja e nenhum desconto", () => {
    const c = condicoesDoLink(null, loja);
    expect(c).toMatchObject({
      desconto: 0,
      minOrderMode: "PECAS",
      minOrderPieces: 10,
      personalizado: false,
    });
  });

  it("campanha com desconto aplica o desconto e herda o mínimo da loja", () => {
    const c = condicoesDoLink(campanha({ discount: 15 }), loja);
    expect(c.desconto).toBe(15);
    expect(c.minOrderPieces).toBe(10);
    expect(c.personalizado).toBe(true);
  });

  /** O caso do "Grupo Vip": link que libera a cliente do mínimo da loja. */
  it("campanha pode TIRAR o mínimo só dela", () => {
    const c = condicoesDoLink(campanha({ minOrderMode: "NONE" }), loja);
    expect(c.minOrderMode).toBe("NONE");
    expect(c.personalizado).toBe(true);
  });

  it("campanha pode baixar o mínimo de peças", () => {
    const c = condicoesDoLink(
      campanha({ minOrderMode: "PECAS", minOrderPieces: 3 }),
      loja
    );
    expect(c.minOrderPieces).toBe(3);
  });

  /**
   * Mínimo é OPCIONAL: a maioria das campanhas só quer o desconto. Obrigar a
   * redigitar faria a loja zerar sem querer o mínimo que já valia.
   */
  it("campanha sem mínimo próprio NÃO apaga o mínimo da loja", () => {
    const c = condicoesDoLink(campanha({ discount: 20, minOrderMode: null }), loja);
    expect(c.minOrderMode).toBe("PECAS");
    expect(c.minOrderPieces).toBe(10);
  });

  it("campanha PAUSADA volta tudo ao normal da loja", () => {
    const c = condicoesDoLink(campanha({ active: false, discount: 30 }), loja);
    expect(c.desconto).toBe(0);
    expect(c.minOrderPieces).toBe(10);
    expect(c.personalizado).toBe(false);
  });

  it("campanha ENCERRADA (arquivada) também não aplica nada", () => {
    const c = condicoesDoLink(
      campanha({ discount: 30, archivedAt: new Date("2026-09-01") }),
      loja
    );
    expect(c.desconto).toBe(0);
  });

  /**
   * DESCONTOS NÃO SE SOMAM: com tabela de preço (RN-018) ou catálogo de
   * campanha na mesma visita, a cliente pagaria um valor que NENHUMA tela
   * mostrou.
   */
  it("com tabela de preço ou catálogo promocional na visita, o link não desconta", () => {
    const c = condicoesDoLink(campanha({ discount: 40 }), loja, true);
    expect(c.desconto).toBe(0);
    expect(c.minOrderPieces).toBe(10);
  });
});

/**
 * A CONFERÊNCIA DO PREÇO É SIMÉTRICA (achado da revisão, 01/09/2026).
 *
 * A primeira versão só olhava para um lado (`descontoVisto > 0`): campanha
 * que nasceu sem desconto e ganhou 25% enquanto a cliente montava a sacola
 * gravava o pedido 25% mais barato do que a tela e a mensagem do WhatsApp
 * mostraram — dinheiro a menos, calado, e o `netTotal` da RN-002 sem bater
 * com o combinado.
 *
 * Estes testes descrevem o COMPORTAMENTO, não o texto do código: guarda que
 * cita a linha defeituosa protege o erro em vez de impedi-lo (lição de
 * 28/08/2026).
 */
describe("mudou o preço desde a vitrine?", () => {
  it("mesmo desconto dos dois lados: pode gravar", () => {
    expect(precisaDoLinkAtualizado(20, 20)).toBe(false);
  });

  it("ela viu 20 e agora é 30: pede o link atualizado", () => {
    expect(precisaDoLinkAtualizado(20, 30)).toBe(true);
  });

  it("ela viu 20 e a campanha foi pausada (0): pede o link atualizado", () => {
    expect(precisaDoLinkAtualizado(20, 0)).toBe(true);
  });

  /** O lado que faltava: desconto que APARECEU depois também não vale. */
  it("ela viu preço cheio e a loja pôs 25% depois: pede o link atualizado", () => {
    expect(precisaDoLinkAtualizado(0, 25)).toBe(true);
  });

  /** Campanha só de mínimo: 0 × 0, nada de preço a proteger (RN-010). */
  it("campanha sem desconto nenhum passa direto, mesmo pausada", () => {
    expect(precisaDoLinkAtualizado(0, 0)).toBe(false);
  });
});

/**
 * O RESGATE PELO WHATSAPP (RN-012) PRECISA LER O DESCONTO — espelho do
 * `tabelaNoTexto` da RN-018, e pelo mesmo incidente: sem isso, a lojista
 * colava um pedido que a cliente aprovou por R$ 800 e o sistema o criava por
 * R$ 1.000, cobrando a mais sem ninguém perceber.
 */
describe("desconto escrito na mensagem do catálogo", () => {
  it("lê o carimbo que o próprio catálogo escreve", () => {
    expect(descontoNoTexto("*Novo pedido*\n_Campanha: Grupo Vip (20% OFF)_\n")).toBe(20);
  });

  it("mensagem sem campanha nenhuma não inventa desconto", () => {
    expect(descontoNoTexto("*Novo pedido*\n2x Regata\n")).toBe(0);
  });

  it("não confunde com a linha da tabela de preço", () => {
    expect(descontoNoTexto("_Tabela: Atacado_")).toBe(0);
  });

  it("porcentagem absurda no texto não vira preço maluco", () => {
    expect(descontoNoTexto("_Campanha: X (999% OFF)_")).toBe(TETO_DE_DESCONTO);
  });

  /**
   * A loja batiza a campanha como quiser — inclusive "Liquida (50% OFF)".
   * O desconto que vale é o que o CATÁLOGO escreveu no fim da linha; pegar o
   * primeiro remontaria o pedido com a porcentagem do NOME (achado da
   * revisão de 01/09/2026).
   */
  it("porcentagem no NOME da campanha não vence a do catálogo", () => {
    expect(descontoNoTexto("_Campanha: Liquida (50% OFF) (20% OFF)_")).toBe(20);
  });

  it("outra linha com porcentagem não contamina a leitura", () => {
    expect(descontoNoTexto("Promo antiga (70% OFF)\n_Campanha: Vip (15% OFF)_")).toBe(15);
  });

  it("tira o nome da campanha da linha", () => {
    expect(campanhaNoTexto("_Campanha: Grupo Vip (20% OFF)_")).toBe("Grupo Vip");
    expect(campanhaNoTexto("2x Regata")).toBeNull();
  });

  /**
   * O WhatsApp usa _itálico_ e *negrito*, então os marcadores saem — mas só
   * das PONTAS. Limpar a linha inteira estragava "Black_Friday", que então
   * nunca casava e o pedido voltava a preço cheio com aviso falso.
   */
  it("nome com underline no meio sobrevive", () => {
    expect(campanhaNoTexto("_Campanha: Black_Friday (30% OFF)_")).toBe("Black_Friday");
  });
});

/**
 * O TEXTO COLADO É DIGITÁVEL — e por isso NÃO decide dinheiro.
 *
 * A cliente pode editar a mensagem do wa.me antes de mandar: trocar
 * "(20% OFF)" por "(90% OFF)" daria 90% sobre o preço do cadastro, com a tela
 * até confirmando o desconto (achado da revisão de 01/09/2026). O texto só
 * diz QUAL campanha; o desconto sai do cadastro da loja. É a diferença para o
 * `tabelaNoTexto`, que escolhe entre dois preços que já são nossos.
 */
describe("desconto do resgate vem do CADASTRO, não do texto", () => {
  const loja = [
    { slug: "vip", name: "Grupo Vip", discount: 20, active: true, archivedAt: null },
    { slug: "antiga", name: "Antiga", discount: 50, active: false, archivedAt: null },
  ];

  it("usa o desconto da campanha de verdade, e devolve qual é ela", () => {
    const r = descontoDoResgate("Grupo Vip", 20, loja);
    expect(r.desconto).toBe(20);
    expect(r.campanha?.slug).toBe("vip");
    expect(r.naoConfere).toBe(false);
  });

  /**
   * A cliente pode EDITAR a mensagem do wa.me antes de mandar. Trocar
   * "(20% OFF)" por "(90% OFF)" daria 90% sobre o preço do cadastro, com a
   * tela até confirmando o desconto — por isso o número do texto nunca
   * decide dinheiro, só confere.
   */
  it("porcentagem inventada no texto vira preço CHEIO, avisando", () => {
    const r = descontoDoResgate("Grupo Vip", 90, loja);
    expect(r.desconto).toBe(0);
    expect(r.naoConfere).toBe(true);
  });

  /** Xará (um catálogo promocional e uma campanha com o mesmo nome). */
  it("nome que casa mas desconto que não bate não aplica nada", () => {
    const r = descontoDoResgate("Grupo Vip", 50, loja);
    expect(r.desconto).toBe(0);
    expect(r.naoConfere).toBe(true);
  });

  it("campanha que não existe no cadastro: preço cheio, avisando", () => {
    expect(descontoDoResgate("Campanha Fantasma", 20, loja)).toMatchObject({
      desconto: 0,
      campanha: null,
      naoConfere: true,
    });
  });

  /**
   * Duas campanhas ATIVAS com o mesmo nome ("Grupo Vip" no Instagram e no
   * WhatsApp): escolher uma é chute, e o chute carimba o pedido na campanha
   * errada — quem conta os pedidos para a exclusão é esse carimbo. Avisa,
   * nunca adivinha (régua da RN-020).
   */
  it("campanhas xarás não viram chute: preço cheio, avisando", () => {
    const duas = [
      { slug: "vip-ig", name: "Grupo Vip", discount: 20, active: true, archivedAt: null },
      { slug: "vip-wa", name: "Grupo Vip", discount: 20, active: true, archivedAt: null },
    ];
    expect(descontoDoResgate("Grupo Vip", 20, duas)).toMatchObject({
      campanha: null,
      desconto: 0,
      naoConfere: true,
    });
  });

  it("campanha pausada não desconta no resgate", () => {
    expect(descontoDoResgate("Antiga", 50, loja).desconto).toBe(0);
  });

  /** Sem linha de campanha nenhuma não há o que avisar — é pedido normal. */
  it("sem linha de campanha, preço cheio e SEM alarme falso", () => {
    expect(descontoDoResgate(null, 0, loja)).toMatchObject({
      desconto: 0,
      naoConfere: false,
    });
  });

  it("a prévia avisa quando o desconto da mensagem não confere", () => {
    const rota = ler("src/app/api/orders/ler-mensagem/route.ts");
    expect(rota).toContain("naoConfere");
    const tela = ler("src/app/(app)/pedidos/importar-mensagem.tsx");
    expect(tela).toContain("campanhaNaoResolvida");
    expect(tela).toContain("não confere com o cadastro");
  });

  /** O pedido colado também guarda o carimbo — é por ele que a exclusão conta. */
  it("o pedido colado guarda o link da campanha, não só o desconto", () => {
    const tela = ler("src/app/(app)/pedidos/importar-mensagem.tsx");
    expect(tela).toContain("campaignRef: previa.resumo.campanhaSlug");
  });

  /**
   * A PORCENTAGEM NUNCA VEM DA TELA. Aceitá-la deixava qualquer vendedora
   * carimbar 90% no pedido, e o editor de itens passava a sugerir toda peça
   * nova a 10% do preço (achado da revisão de 01/09/2026).
   */
  it("o desconto gravado é lido do cadastro, não do que a tela mandou", () => {
    const rota = ler("src/app/api/orders/route.ts");
    expect(rota).toContain("campaignDiscount: descontoDaCampanha");
    const schema = rota.slice(rota.indexOf("createSchema"), rota.indexOf("export async function POST"));
    expect(schema).not.toContain("campaignDiscount");
    const tela = ler("src/app/(app)/pedidos/importar-mensagem.tsx");
    expect(tela).not.toContain("campaignDiscount:");
  });

  /**
   * DESCONTOS NÃO SE SOMAM — no resgate também: mensagem com `_Tabela:
   * Atacado_` E `_Campanha: X (20% OFF)_` sairia com atacado menos 20%, valor
   * que nenhuma tela mostrou.
   */
  it("no resgate, tabela de preço na mensagem cancela o desconto do link", () => {
    const rota = ler("src/app/api/orders/ler-mensagem/route.ts");
    expect(rota).toContain("tabelaDaMensagem ? 0 : resgate.desconto");
  });

  /**
   * PAUSAR SÓ DESLIGA A CAMPANHA — nunca reaponta o link para outra pessoa.
   * Campanha "Julia" (slug `julia`) da Ana, pausada, caía na regra do
   * primeiro nome e passava a creditar a VENDEDORA Julia, levando a carteira
   * da cliente junto (RN-005).
   */
  it("endereço de campanha não vira link de vendedora homônima", () => {
    const engine = ler("src/lib/tracking/engine.ts");
    const trecho = engine.slice(engine.indexOf("export async function resolveRef"));
    const ate = trecho.indexOf("return { sellerId");
    expect(ate).toBeGreaterThan(-1);
    // a busca da campanha não filtra por ativa: achou o endereço, é dela
    expect(trecho.slice(0, ate)).toContain("where: { companyId, slug: ref },");
  });
});

/**
 * A LOJISTA DIGITA "300", "300,00" E "300.00" PARA A MESMA COISA — e criar e
 * editar campanha precisam usar a MESMA régua (achado da revisão de
 * 01/09/2026: a edição tratava todo ponto como milhar e um mínimo de R$ 300
 * virava R$ 30.000, enquanto a criação lia certo o mesmo texto).
 * A régua já existia em `lib/format.ts` — as duas telas passam por ela.
 */
/**
 * MESMA SACOLA, CONDIÇÃO DIFERENTE = PEDIDOS DIFERENTES.
 *
 * A trava anti-duplicata do catálogo (RN-010) assina a sacola. Sem a condição
 * do link na assinatura, a loja editava o desconto, pedia para a cliente
 * mandar de novo pelo mesmo link, e o segundo envio caía como "já
 * registrado": voltava o pedido VELHO, a preço cheio, com a tela dizendo
 * "Pedido registrado!" — o mesmo incidente já vivido com varejo × atacado
 * (achado da revisão de 01/09/2026).
 */
describe("a assinatura da sacola enxerga a condição do link", () => {
  const sacola = {
    items: [{ productId: "p1", color: "Preto", size: "M", quantity: 2 }],
    customer: { name: "Maria", phone: "11999998888" },
  };

  it("mesma sacola com descontos diferentes assina diferente", () => {
    const a = assinaturaDoPedido({ ...sacola, campanha: "vip", campanhaDesconto: 0 });
    const b = assinaturaDoPedido({ ...sacola, campanha: "vip", campanhaDesconto: 30 });
    expect(a).not.toBe(b);
  });

  /**
   * E A PARTE QUE MAIS IMPORTA: a assinatura vive no APARELHO da cliente.
   * Se o campo novo mudasse TODA assinatura já guardada, a sacola mandada às
   * 12:00 deixaria de casar às 12:05, ganharia protocolo novo e viraria
   * pedido DUPLICADO, com estoque reservado duas vezes — justamente o
   * incidente que esta trava existe para impedir (revisão de 01/09/2026).
   */
  it("sacola SEM campanha assina exatamente como antes", () => {
    const antiga = [
      "p1|Preto|M|2",
      "#Maria",
      "#11999998888",
      "#",
      "#",
      "#",
      "#",
    ].join("~");
    expect(assinaturaDoPedido(sacola)).toBe(antiga);
  });
});

/**
 * TETO DE DESCONTO CORTADO CALADO É PIOR QUE ERRO: quem digitava 100 salvava
 * 90, e o link passava a cobrar 10% do catálogo com a tela dizendo que deu
 * certo (achado da revisão de 01/09/2026).
 */
/**
 * "SEM RESPONSÁVEL" É NULO, NUNCA TEXTO VAZIO. A tela manda "" quando a
 * campanha é da loja; gravado assim, `Order.sellerId` — que tem chave
 * estrangeira de verdade — quebrava com P2003 em TODO pedido daquele link, e
 * a fila da RN-010 tentava para sempre (revisão de 01/09/2026).
 */
describe("responsável da campanha", () => {
  for (const rota of [
    "src/app/api/track-campaigns/route.ts",
    "src/app/api/track-campaigns/[id]/route.ts",
  ]) {
    it(`vazio não passa pela conferência nem vira texto no banco (${rota})`, () => {
      const fonte = ler(rota);
      expect(fonte).toContain('parsed.data.ownerId !== ""');
      // e o que chega vazio é gravado como NULO
      expect(fonte).toMatch(/ownerId: (parsed\.data\.ownerId \|\| null|null)/);
    });
  }
});

/**
 * EDITAR NÃO PODE SER MAIS RÍGIDO QUE CRIAR: um limite só no PATCH tornava a
 * campanha já criada impossível de renomear — ou até de PAUSAR, porque a tela
 * reenvia o formulário inteiro (revisão de 01/09/2026).
 */
describe("criar × editar campanha", () => {
  it("a edição não impõe limite que a criação não impõe", () => {
    const criar = ler("src/app/api/track-campaigns/route.ts");
    const editar = ler("src/app/api/track-campaigns/[id]/route.ts");
    const limites = (fonte: string, campo: string) =>
      (fonte.match(new RegExp(`${campo}: z\\.[^\n]*`))?.[0] ?? "").includes(".max(");
    for (const campo of ["name", "channel", "goal"]) {
      expect(limites(editar, campo), `${campo} limitado só na edição`).toBe(
        limites(criar, campo)
      );
    }
  });
});

/**
 * O aviso de comissão precisa dizer a VERDADE: desde que o endereço de
 * campanha deixou de cair na regra do primeiro nome, o link PAUSADO passa
 * pelo mesmo caminho de "ref não bateu com ninguém" — e mandar a lojista
 * procurar duas vendedoras com o mesmo nome seria conselho errado para a
 * consequência normal de pausar.
 */
describe("aviso do pedido sem vendedora", () => {
  it("campanha pausada tem recado próprio, não o de nome repetido", () => {
    const rota = ler("src/app/api/catalog/order/route.ts");
    expect(rota).toContain("campanhaDoRef");
    expect(rota).toContain("pausada");
    expect(rota).toContain("encerrada");
  });
});

describe("teto do desconto", () => {
  it("a tela avisa antes de salvar o valor cortado", () => {
    const tela = ler("src/app/(app)/inteligencia/links-manager.tsx");
    expect(tela).toContain("O desconto máximo é");
    // e usa a constante da regra, não um 90 solto
    expect(tela).toContain("TETO_DE_DESCONTO");
  });
});

describe("número do jeito que se digita", () => {
  it("criar e editar campanha usam a MESMA leitura de número", () => {
    const tela = ler("src/app/(app)/inteligencia/links-manager.tsx");
    expect(tela).toContain('from "@/lib/format"');
    // nenhuma conversão caseira sobrou por perto
    expect(tela).not.toContain("parseFloat(");
  });

  it("os três jeitos dão o mesmo valor", () => {
    expect(numeroBR("300")).toBe(300);
    expect(numeroBR("300,00")).toBe(300);
    expect(numeroBR("300.00")).toBe(300);
    expect(numeroBR("1.300,50")).toBe(1300.5);
  });
});
