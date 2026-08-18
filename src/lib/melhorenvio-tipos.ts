/**
 * MELHOR ENVIO — os TIPOS compartilhados com as telas.
 *
 * Ficam fora de `melhorenvio.ts` de propósito. O motor conversa com o banco e
 * arrasta uma corrente inteira de coisas de servidor
 * (`melhorenvio → nuvemshop → push → web-push → net/tls`): no dia em que a
 * tela precisar de UMA função de lá, o deploy da Vercel cai — foi assim,
 * exatamente assim, que a produção caiu em 17/08/2026.
 *
 * Tipo some na compilação, então importar tipo do motor "funciona" — mas
 * deixa a armadilha montada para a próxima pessoa trocar por um import de
 * valor sem perceber. Com os tipos aqui, a tela nunca precisa citar o motor.
 */

/** Um volume do envio, do jeito que a lojista mede: kg e cm. */
export type VolumePacote = {
  pesoKg: number;
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
};

/** Uma opção de frete devolvida pela cotação. */
export type MeQuote = {
  serviceId: number;
  service: string; // PAC, SEDEX, .Package...
  carrier: string; // Correios, Jadlog...
  carrierLogo: string | null;
  price: number;
  days: number | null; // prazo em dias úteis
};

/** Transportadora que o Melhor Envio devolveu SEM preço, e o porquê. */
export type MeRecusa = {
  carrier: string;
  services: string[];
  reason: string;
};
