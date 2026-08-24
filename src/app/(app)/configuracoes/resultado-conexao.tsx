import { Alert } from "@/components/ui";

/**
 * O RECADO DE QUEM VOLTA DO PROVEDOR (Bling, Mercado Pago, Melhor Envio). O
 * callback já mandava `?me=ok` / `?me=erro` na volta, mas NINGUÉM lia: a
 * lojista clicava em conectar, era jogada de volta nesta tela e ficava sem
 * saber se deu certo — só conferindo o cartão da integração no olho.
 *
 * Agora existem também os casos da trava contra o link de autorização
 * repassado (RN-023): a mensagem tem que dizer O QUE FAZER, senão a trava
 * vira "não funciona e não explica".
 */

// A Nuvemshop fica de FORA: ela já dá o próprio recado (e mais específico,
// falando da importação de produtos) em nuvemshop-connect.tsx — dois avisos
// da mesma coisa é ruído.
const NOMES: Record<string, string> = {
  bling: "Bling",
  mp: "Mercado Pago",
  me: "Melhor Envio",
};

export function ResultadoDaConexao({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const avisos: { chave: string; tom: "success" | "danger" | "warning"; texto: string }[] = [];

  for (const [chave, nome] of Object.entries(NOMES)) {
    const valor = params[chave];
    const resultado = Array.isArray(valor) ? valor[0] : valor;
    if (!resultado) continue;

    if (resultado === "ok")
      avisos.push({ chave, tom: "success", texto: `${nome} conectado com sucesso! 🎉` });
    else if (resultado === "outra_loja")
      avisos.push({
        chave,
        tom: "warning",
        texto:
          `A conexão com o ${nome} não foi concluída: a autorização não pertence ` +
          `a esta loja (ou quem voltou não tem permissão de mexer em integrações). ` +
          `Se você recebeu esse link de outra pessoa, não use — comece clicando em ` +
          `conectar aqui nesta tela.`,
      });
    else if (resultado === "sem_sessao")
      avisos.push({
        chave,
        tom: "warning",
        texto:
          `A conexão com o ${nome} não foi concluída porque a volta caiu fora do ` +
          `seu login. Faça tudo na MESMA janela do navegador (se você usa o app ` +
          `instalado, abra o site no navegador para conectar) e tente de novo.`,
      });
    else
      avisos.push({
        chave,
        tom: "danger",
        texto: `Não foi possível conectar o ${nome}. Tente de novo; se insistir, chame o AtacadoPro.`,
      });
  }

  if (avisos.length === 0) return null;

  return (
    <div className="space-y-2">
      {avisos.map((a) => (
        <Alert key={a.chave} tone={a.tom}>
          {a.texto}
        </Alert>
      ))}
    </div>
  );
}
