"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, Printer } from "lucide-react";
import { Portal } from "@/components/portal";
import { VisorDeDocumento } from "@/components/visor-de-documento";

/** O endereço do DANFE simplificado do pedido (RN-111). */
export function enderecoDoDanfe(
  orderId: string,
  formato: "a4" | "etiqueta",
  chaveDaEtiqueta?: string | null
): string {
  const busca = new URLSearchParams({ formato });
  if (chaveDaEtiqueta) busca.set("chave", chaveDaEtiqueta);
  return `/danfe-simplificado/${orderId}?${busca}`;
}

/**
 * Os botões do DANFE Simplificado – Etiqueta (RN-111): 10 × 15 cm (impressora
 * de etiqueta, a Zebra) e folha A4 (recortar e colar na caixa).
 *
 * São DOIS BOTÕES com o nome do papel, lado a lado (18/11/2026, relato do
 * dono): antes o botão grande abria o A4 e a versão de etiqueta era um
 * linkzinho "em 10 × 15 cm" ao lado — ele mandou o A4 para a Zebra, o bloco
 * saiu cortado, e diminuir a escala para caber estraga o código de barras.
 *
 * No computador é um link comum: abre o PDF numa aba, que é de onde se
 * imprime, e a recusa chega como página em português. No aplicativo
 * INSTALADO o aparelho abriria o PDF por cima do app, sem botão de voltar (a
 * armadilha do PDF da Central) — ali o arquivo é buscado primeiro: deu certo,
 * abre no visor da casa, com X; recusou, a FRASE da recusa aparece aqui
 * mesmo (o visor só saberia dizer "não é PDF").
 */
export function DanfeSimplificado({
  orderId,
  contribuinte,
  chaveDaEtiqueta,
}: {
  orderId: string;
  /** a compradora é empresa com inscrição estadual (RN-054): a tela avisa */
  contribuinte?: boolean;
  /**
   * No painel de Envio: a chave com que a ETIQUETA foi comprada. A porta
   * recusa se a nota do pedido hoje for outra (dois papéis, duas notas).
   */
  chaveDaEtiqueta?: string | null;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  // QUAL dos dois está sendo buscado (o girar fica no botão que foi tocado)
  const [buscando, setBuscando] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  // o PDF buscado vive num endereço temporário do navegador: solta ao fechar
  useEffect(() => {
    if (!aberto) return;
    return () => URL.revokeObjectURL(aberto);
  }, [aberto]);

  async function abrirNoApp(href: string) {
    setErro("");
    setBuscando(href);
    try {
      const res = await fetch(href, { headers: { Accept: "application/pdf, application/json" } });
      const tipo = res.headers.get("content-type") ?? "";
      if (res.ok && tipo.includes("application/pdf")) {
        setAberto(URL.createObjectURL(await res.blob()));
        return;
      }
      const d = tipo.includes("json") ? await res.json().catch(() => null) : null;
      setErro(
        d?.error ??
          (res.redirected || res.status === 401
            ? "Sua sessão venceu. Entre de novo no sistema e abra o DANFE outra vez."
            : "Não consegui abrir o DANFE simplificado agora. Tente de novo em instantes.")
      );
    } catch {
      setErro("Sem conexão. Confira a internet e tente de novo.");
    } finally {
      setBuscando(null);
    }
  }

  const aoClicar = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const instalado =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as { standalone?: boolean }).standalone);
    if (!instalado) return;
    e.preventDefault();
    if (!buscando) void abrirNoApp(href);
  };

  const a4 = enderecoDoDanfe(orderId, "a4", chaveDaEtiqueta);
  const etiqueta = enderecoDoDanfe(orderId, "etiqueta", chaveDaEtiqueta);
  const botao =
    "inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2.5 transition";
  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={etiqueta}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => aoClicar(e, etiqueta)}
          className={botao}
          title="Página de 10 × 15 cm, para impressora de etiqueta (Zebra)"
        >
          {buscando === etiqueta ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Printer className="size-4" />
          )}
          DANFE em etiqueta 10 × 15 cm
        </a>
        <a
          href={a4}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => aoClicar(e, a4)}
          className={botao}
          title="Folha A4 comum, com o DANFE no canto para recortar e colar na caixa"
        >
          {buscando === a4 ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          DANFE em folha A4
        </a>
      </div>
      {erro && (
        <p role="alert" className="text-xs text-rose-600">
          {erro}
        </p>
      )}
      <p className="text-[11px] text-gray-500">
        Sai com a chave de acesso em código de barras, para colar na caixa junto da etiqueta. Na
        impressora de etiqueta (Zebra), use o de 10 × 15 cm e imprima em tamanho real (escala
        100%) — diminuir a escala estraga o código de barras.
        {contribuinte
          ? " Esta venda é para empresa com inscrição estadual: a norma prevê o DANFE simplificado para venda a consumidor final — confirme com o contador se serve aqui, ou use o DANFE completo."
          : ""}
      </p>
      {aberto && (
        <Portal>
          <VisorDeDocumento
            src={aberto}
            nome="DANFE simplificado.pdf"
            onClose={() => setAberto(null)}
          />
        </Portal>
      )}
    </div>
  );
}
