import { soDigitos } from "./documento";

/**
 * RN-054 · A NATUREZA DE OPERAÇÃO DA NOTA SEGUE O DOCUMENTO DA CLIENTE.
 *
 * Relato do dono (11/09/2026), montando a integração do Bling: a natureza
 * padrão da conta dele é *"Venda de mercadoria a não contribuinte"*, e o
 * sistema NÃO mandava natureza nenhuma — o Bling usava sempre essa. Só que a
 * loja de atacado vende para os DOIS públicos:
 *
 *  • a lojista que compra com **CPF** (a maioria, segundo o dono) é
 *    consumidora final: "não contribuinte" está CERTO para ela;
 *  • a lojista que compra com **CNPJ e inscrição estadual** é CONTRIBUINTE de
 *    ICMS — CFOP e tratamento de imposto são outros.
 *
 * Uma natureza fixa não atende os dois, e nota com a natureza errada não é
 * defeito de tela: é documento fiscal emitido errado, que a loja responde
 * perante o fisco. Por isso quem decide é o DOCUMENTO de quem compra, nota a
 * nota, e não uma configuração única.
 *
 * **QUEM MANDA NOS NÚMEROS É O CONTADOR.** O sistema não inventa natureza: a
 * loja cadastra em Configurações → Bling qual natureza vale para cada caso
 * (as mesmas que existem no Bling dela), e aqui só se escolhe entre elas.
 *
 * **Loja que não configurar nada não muda em NADA**: sem natureza cadastrada
 * o pedido sai como sempre saiu — sem o campo, com o Bling usando a padrão da
 * conta. É o que impede esta regra de quebrar quem já estava emitindo.
 */

/** Como o fisco enxerga quem está comprando. */
export type TipoDeCompradora = "CONTRIBUINTE" | "NAO_CONTRIBUINTE";

export type DocumentosParaNatureza = {
  cpf?: string | null;
  cnpj?: string | null;
  /** inscrição estadual (`Customer.stateRegistration`) */
  stateRegistration?: string | null;
};

/**
 * Contribuinte é quem tem CNPJ **e** inscrição estadual.
 *
 * As duas coisas juntas, e não só o CNPJ: existe CNPJ isento de inscrição
 * estadual (prestador de serviço, MEI de serviço), e esse compra como
 * consumidor final. Decidir só pelo CNPJ marcaria como contribuinte quem não
 * é — e é justamente o erro que esta regra existe para evitar, ao contrário.
 *
 * Na dúvida o sistema cai em NÃO CONTRIBUINTE, que é o caso da maioria da
 * clientela (compra no CPF) e o que já acontecia antes desta regra.
 */
export function tipoDaCompradora(c: DocumentosParaNatureza): TipoDeCompradora {
  const cnpj = soDigitos(c.cnpj);
  const ie = soDigitos(c.stateRegistration);
  if (cnpj.length === 14 && ie.length > 0) return "CONTRIBUINTE";
  return "NAO_CONTRIBUINTE";
}

/**
 * O campo `contribuinte` do contato na nota (1 = contribuinte de ICMS,
 * 9 = não contribuinte) — ou `null` para **não mandar o campo**.
 *
 * O `null` não é detalhe: ele foi o achado mais perigoso da revisão desta
 * entrega. Mandar `9` sempre que a ficha DAQUI não prova o contrário
 * sobrescreveria o cadastro do Bling — a cliente com CNPJ e inscrição
 * estadual registrada LÁ, mas com a IE em branco na ficha daqui, sairia como
 * consumidora final numa venda B2B. Isso é CFOP errado numa nota já emitida.
 *
 * Então o sistema só afirma o que sabe:
 *  • CNPJ **com** IE na ficha → 1, é contribuinte, e a IE vai junto;
 *  • **CPF** na ficha → 9, porque pessoa física não é contribuinte de ICMS;
 *  • CNPJ **sem** IE aqui → nada. Pode ser isento de verdade, pode ser IE que
 *    só existe no Bling. Na dúvida quem decide é o cadastro de lá, que é o
 *    que já acontecia antes desta regra.
 */
export function contribuinteParaNota(c: DocumentosParaNatureza): 1 | 9 | null {
  if (tipoDaCompradora(c) === "CONTRIBUINTE") return 1;
  if (soDigitos(c.cpf).length === 11) return 9;
  return null;
}

export type NaturezasDaLoja = {
  /** natureza para venda a contribuinte (CNPJ + IE) */
  contribuinte?: string | null;
  /** natureza para venda a consumidor final (CPF, ou CNPJ sem IE) */
  naoContribuinte?: string | null;
};

/**
 * A natureza que vai na nota, ou `null` para "não mandar campo nenhum".
 *
 * O `null` é o caminho de quem não configurou — e é DELIBERADO que ele seja
 * indistinguível do comportamento anterior: a nota sai com a natureza padrão
 * da conta do Bling, como saía antes.
 */
export function naturezaDaNota(
  c: DocumentosParaNatureza,
  naturezas: NaturezasDaLoja
): string | null {
  const tipo = tipoDaCompradora(c);
  const escolhida =
    tipo === "CONTRIBUINTE" ? naturezas.contribuinte : naturezas.naoContribuinte;
  const limpa = (escolhida ?? "").trim();
  return limpa || null;
}

/**
 * Frase que a ficha do pedido mostra ANTES de emitir, para a loja conferir.
 *
 * Nota fiscal não se desfaz com um clique (cancelar tem prazo e deixa
 * rastro), então a tela diz de antemão em que natureza a nota vai sair e por
 * quê. Sem isso o erro só apareceria depois de emitida.
 */
export function explicarNatureza(
  c: DocumentosParaNatureza,
  naturezas: NaturezasDaLoja
): string {
  const tipo = tipoDaCompradora(c);
  const natureza = naturezaDaNota(c, naturezas);
  const porque =
    tipo === "CONTRIBUINTE"
      ? "a cliente tem CNPJ e inscrição estadual (contribuinte)"
      : soDigitos(c.cnpj).length === 14
        ? "a cliente tem CNPJ sem inscrição estadual (consumidora final)"
        : "a cliente compra no CPF (consumidora final)";
  if (!natureza) {
    return `A nota vai sair com a natureza de operação PADRÃO da sua conta no Bling — ${porque}. Para o sistema escolher a natureza certa em cada venda, cadastre as duas em Configurações → Bling.`;
  }
  // A loja cadastra o ID da natureza (é o que a API do Bling recebe), não o
  // nome. Mostrar o número entre aspas pareceria defeito de tela, então o
  // texto o apresenta como número — e o nome, quem confere é o Bling.
  const comoSaiu = /^\d+$/.test(natureza)
    ? `na natureza de operação nº ${natureza}, que você cadastrou para este caso`
    : `como "${natureza}"`;
  return `A nota vai sair ${comoSaiu} — ${porque}.`;
}
