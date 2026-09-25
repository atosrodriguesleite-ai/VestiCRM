"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  CHAVE_RECARGAS,
  CHAVE_RELATO_PENDENTE,
  EVENTO_RELATO_GUARDADO,
  caminhoSemCodigos,
  deveRelatar,
  lerRecargas,
  pareceVersaoVelha,
  podeRecarregarSozinho,
  recargasComEsta,
  relatoDoErro,
} from "@/lib/erro-da-tela";

/**
 * RN-066 · A tela que aparece quando algo quebra no navegador — no lugar da
 * frase crua do Next em inglês ("Application error: a client-side exception
 * has occurred"), que deixava a lojista num beco sem botão.
 *
 * Usada pelo `app/(app)/error.tsx` (quebra numa tela do app: o menu fica, e
 * é ele a saída), pelo `app/error.tsx` (quebra fora do app — catálogo, bio —
 * ou no próprio esqueleto do app) e pelo `app/global-error.tsx` (quebra no
 * layout raiz). A regra mora em `lib/erro-da-tela.ts`; aqui só se aplica.
 *
 * Os estilos são ESCRITOS AQUI, com a cor de reserva ao lado de cada
 * variável: no `global-error` o CSS do app pode não estar de pé, e a tela
 * de socorro não pode depender do que quebrou.
 */
type Modo = "atualizando" | "sem-rede" | "erro";

export function TelaDeErro({
  error,
  inteira = true,
}: {
  error: Error & { digest?: string };
  /** ocupa a tela toda (fora do app) ou só o miolo (dentro do app, com menu) */
  inteira?: boolean;
}) {
  // versão velha começa já dizendo "atualizando": a recarga vem em seguida,
  // e mostrar "algo deu errado" por um instante assustaria à toa
  const [modo, setModo] = useState<Modo>(() =>
    pareceVersaoVelha(error) ? "atualizando" : "erro"
  );
  // quais pedaços do endereço são parâmetro (código de acesso, id): quem diz
  // é o próprio Next; `null` quando o roteador caiu junto
  const parametros = useParams();
  const parametrosRef = useRef(parametros);
  parametrosRef.current = parametros;

  useEffect(() => {
    // o relato sai DEPOIS da decisão, dizendo se a recarga aconteceu: versão
    // velha que a trava barrou é peça faltando de verdade e tem que aparecer
    // como quebra, não como "se curou sozinha" (achado da revisão)
    const relatar = (recarregou: boolean, avisar: boolean) =>
      guardarRelato(error, parametrosRef.current, recarregou, avisar);

    if (!pareceVersaoVelha(error)) {
      relatar(false, true);
      setModo("erro");
      return;
    }
    // sem internet, recarregar é pior que a tela de socorro: no app
    // instalado do iPhone vira a tela branca do sistema, sem botão. Espera
    // a conexão voltar e aí recarrega (com a mesma trava).
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      relatar(false, false);
      setModo("sem-rede");
      const aoVoltar = () => {
        if (reservarRecarga()) {
          relatar(true, false);
          window.location.reload();
        } else {
          relatar(false, true);
          setModo("erro");
        }
      };
      window.addEventListener("online", aoVoltar, { once: true });
      return () => window.removeEventListener("online", aoVoltar);
    }
    if (reservarRecarga()) {
      // sem avisar quem manda o relato: a recarga vem já, e o envio seria
      // cortado no meio — o próximo carregamento manda
      relatar(true, false);
      window.location.reload();
      return;
    }
    relatar(false, true);
    setModo("erro");
  }, [error]);

  if (modo === "atualizando") {
    return (
      <Moldura inteira={inteira}>
        <p style={titulo}>Atualizando para a versão nova…</p>
        <p style={texto}>O sistema recebeu melhorias enquanto esta tela estava aberta.</p>
      </Moldura>
    );
  }

  if (modo === "sem-rede") {
    // o botão fica aqui também: se o aviso de "a conexão voltou" nunca vier
    // (app que acorda sem avisar, rede que o aparelho acha que não tem),
    // a tela não pode virar um beco sem saída (achado da revisão)
    return (
      <Moldura inteira={inteira}>
        <p style={titulo}>Sem conexão com a internet</p>
        <p style={texto}>
          O sistema recebeu melhorias enquanto esta tela estava aberta. Assim que a
          internet voltar, a página atualiza sozinha.
        </p>
        <button type="button" onClick={() => window.location.reload()} style={botao}>
          Recarregar a página
        </button>
      </Moldura>
    );
  }

  const tecnico = `${error?.name || "Erro"}: ${error?.message || "sem mensagem"}`.slice(0, 160);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <Moldura inteira={inteira}>
      <p style={titulo}>Algo deu errado nesta tela</p>
      <p style={texto}>
        O que já estava salvo continua salvo. Recarregue a página para continuar.
      </p>
      {offline && (
        <p style={texto}>Parece que o aparelho está sem internet agora — recarregue quando ela voltar.</p>
      )}
      <button type="button" onClick={() => window.location.reload()} style={botao}>
        Recarregar a página
      </button>
      <p style={miudo}>
        Para o suporte: {tecnico}
        {error?.digest ? ` · código ${error.digest}` : ""}
      </p>
    </Moldura>
  );
}

/**
 * Reserva a recarga automática SÓ se a trava deixar (uma por minuto e
 * poucas por meia hora, por aba) e grava a trava. Quem chama recarrega.
 *
 * Sem conseguir gravar a trava — ou se ela não "pegar" ao ler de volta —,
 * não reserva: sem trava, uma quebra que não se cura com recarga viraria
 * loop e o sistema ficaria inutilizável.
 */
function reservarRecarga(): boolean {
  try {
    const agora = Date.now();
    const recargas = lerRecargas(window.sessionStorage.getItem(CHAVE_RECARGAS));
    if (!podeRecarregarSozinho(recargas, agora)) return false;
    const gravar = JSON.stringify(recargasComEsta(recargas, agora));
    window.sessionStorage.setItem(CHAVE_RECARGAS, gravar);
    return window.sessionStorage.getItem(CHAVE_RECARGAS) === gravar;
  } catch {
    return false;
  }
}

/**
 * Guarda o relato no aparelho e, quando não há recarga a caminho, avisa
 * quem manda (dentro do app ele sai NA HORA — esperar o próximo
 * carregamento completo deixava o app aberto por dias sem mandar nada, e a
 * quebra seguinte apagava a anterior, achado da revisão).
 */
function guardarRelato(
  error: unknown,
  parametros: Record<string, string | string[] | undefined> | null,
  recarregouSozinho: boolean,
  avisar: boolean
) {
  if (!deveRelatar(error)) return;
  try {
    const caminho = caminhoSemCodigos(window.location.pathname, parametros);
    const relato = relatoDoErro(error, caminho, new Date(), {
      id: idDoRelato(),
      recarregouSozinho,
    });
    window.localStorage.setItem(CHAVE_RELATO_PENDENTE, JSON.stringify(relato));
    if (avisar) window.dispatchEvent(new Event(EVENTO_RELATO_GUARDADO));
  } catch {
    // armazenamento bloqueado: a tela de socorro funciona igual, só não conta
  }
}

function idDoRelato(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    // cai no sorteio simples
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function Moldura({ children, inteira }: { children: React.ReactNode; inteira: boolean }) {
  return (
    <div
      role="alert"
      style={{
        minHeight: inteira ? "100dvh" : "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "24px 16px",
        textAlign: "center",
        background: inteira ? "var(--color-canvas, #f6efe5)" : undefined,
        color: "var(--color-ink, #1d1710)",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      {children}
    </div>
  );
}

const titulo: React.CSSProperties = { fontSize: 18, fontWeight: 700, margin: 0 };
const texto: React.CSSProperties = { fontSize: 15, margin: 0, maxWidth: 360, lineHeight: 1.45 };
const botao: React.CSSProperties = {
  marginTop: 8,
  padding: "12px 20px",
  borderRadius: 12,
  border: "none",
  background: "var(--color-brand-600, #c4622d)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
const miudo: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  margin: "16px 0 0",
  maxWidth: 360,
  wordBreak: "break-word",
};
