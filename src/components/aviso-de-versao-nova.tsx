"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";
import {
  CHAVE_VERSAO_TENTADA,
  MS_DO_DEPOIS,
  VERSAO_DO_APP,
  horaDeConferir,
  lerVersaoDaResposta,
  valeAvisar,
} from "@/lib/versao-do-app";

/**
 * RN-113 · "TEM VERSÃO NOVA" PARA QUEM FICOU COM A TELA ABERTA.
 *
 * A Central fica aberta o dia inteiro (o app instalado, por dias) e nunca
 * troca de página — então a melhoria que subiu de manhã não chega em quem
 * abriu a tela ontem. Este aviso pergunta ao servidor, de 5 em 5 minutos e
 * só com a aba à vista, qual versão está no ar; diferente da que esta tela
 * carregou, aparece a pílula com o botão de atualizar.
 *
 * NUNCA RECARREGA SOZINHO. A pessoa pode estar com um pedido montado, uma
 * ficha preenchida ou uma mensagem digitada — recarregar às escondidas é
 * apagar o trabalho dela (a régua da RN-066). Quem decide a hora é ela, e o
 * aviso diz o que se perde antes do clique.
 */
export function AvisoDeVersaoNova({
  versao = VERSAO_DO_APP,
  recarregar = () => window.location.reload(),
  recolhido = false,
  comFaixa = false,
}: {
  /** a versão que ESTA tela carregou (o teste passa a dele) */
  versao?: string;
  recarregar?: () => void;
  /** o menu lateral do computador está recolhido: o aviso vira só um botão */
  recolhido?: boolean;
  /** há a faixa amarela de "acessando como loja" no topo (celular): desce */
  comFaixa?: boolean;
}) {
  const [nova, setNova] = useState("");
  const [aberto, setAberto] = useState(false);
  const [caladoAte, setCaladoAte] = useState(0);
  const [semInternet, setSemInternet] = useState(false);
  // o relógio do "Depois": quando ele vence, a pílula volta sem ninguém tocar
  const [agora, setAgora] = useState(() => Date.now());
  const achou = useRef(false);

  useEffect(() => {
    // sem versão conhecida (fora da Vercel) não há o que comparar
    if (!versao) return;
    let vivo = true;
    let perguntando = false;
    // a tela acabou de carregar: ela É a versão do ar, não pergunta agora
    let ultima = Date.now();

    const conferir = async () => {
      if (achou.current || perguntando) return;
      if (document.visibilityState !== "visible") return;
      if (!horaDeConferir(Date.now(), ultima)) return;
      perguntando = true;
      ultima = Date.now();
      try {
        const res = await fetch("/api/versao", { cache: "no-store" });
        // sessão vencida, servidor fora, rota que ainda não existe: não sei
        if (!res.ok) return;
        const doServidor = lerVersaoDaResposta(await res.json());
        let tentada: string | null = null;
        try {
          tentada = window.sessionStorage.getItem(CHAVE_VERSAO_TENTADA);
        } catch {
          tentada = null;
        }
        if (vivo && valeAvisar(versao, doServidor, tentada)) {
          achou.current = true;
          setNova(doServidor);
        }
      } catch {
        // sem rede: pergunta de novo na próxima batida
      } finally {
        perguntando = false;
      }
    };

    // uma batida por minuto só confere o relógio; o pedido sai de 5 em 5 min
    const batida = window.setInterval(() => {
      setAgora(Date.now());
      void conferir();
    }, 60_000);
    const aoVoltar = () => void conferir();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", aoVoltar);
    return () => {
      vivo = false;
      window.clearInterval(batida);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", aoVoltar);
    };
  }, [versao]);

  if (!nova || agora < caladoAte) return null;

  const atualizar = () => {
    // no app instalado do iPhone, recarregar sem internet dá a tela branca
    // do sistema, sem botão (RN-066): espera a conexão
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSemInternet(true);
      return;
    }
    try {
      // anota para QUAL versão esta aba recarregou: se depois da recarga ela
      // continuar diferente, o aviso não insiste
      window.sessionStorage.setItem(CHAVE_VERSAO_TENTADA, nova);
    } catch {
      // sem conseguir anotar, recarrega do mesmo jeito — foi a pessoa que pediu
    }
    recarregar();
  };

  const depois = () => {
    setAberto(false);
    setSemInternet(false);
    const t = Date.now();
    setAgora(t);
    setCaladoAte(t + MS_DO_DEPOIS);
  };

  // menu recolhido no computador: só o botão redondo, que cabe em cima da
  // marca; aberto, o aviso mostra tudo de novo
  const mini = recolhido && !aberto;
  const soNoCelular = mini ? " md:hidden" : "";

  return (
    // ONDE FICA: em cima do que é ENFEITE, nunca de um botão — no celular, a
    // logo do cabeçalho (entre o menu e o sino); no computador, a marca no
    // topo do menu lateral. Aviso flutuante que tampa botão é pior que aviso
    // nenhum (a lição do convite de instalar). Fica POR BAIXO do menu aberto
    // e das janelas (z-50) e some enquanto a pessoa digita.
    <div
      role="status"
      className={`pointer-events-none fixed inset-x-0 z-[45] flex justify-center px-2 md:inset-x-auto md:left-3 md:top-3 md:px-0 ${
        comFaixa ? "top-14" : "top-2"
      } [body.teclado-aberto_&]:hidden print:hidden`}
    >
      <div
        className={`pointer-events-auto rounded-2xl border border-brand-900/15 bg-surface text-slate-700 shadow-pop ${
          aberto
            ? "w-[min(22rem,calc(100vw-1rem))]"
            : // fechado, cabe entre o botão do menu e o sino (76px de cada lado)
              "max-w-[calc(100vw-9.5rem)] md:max-w-[15.25rem]"
        }`}
      >
        <div className={`flex items-center gap-1 py-1 pl-3 pr-1${mini ? " md:pl-1" : ""}`}>
          <Sparkles className={`hidden size-4 shrink-0 text-brand-600 sm:block${soNoCelular}`} aria-hidden />
          <span className={`min-w-0 truncate text-[13px] font-semibold${soNoCelular}`}>Versão nova</span>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            title="Saiu versão nova do sistema — atualizar"
            className={`ml-1 shrink-0 rounded-xl bg-brand-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-brand-700${
              mini ? " md:ml-0 md:px-2 md:py-2" : ""
            }`}
          >
            <span className={mini ? "md:hidden" : undefined}>Atualizar</span>
            {mini && <RefreshCw className="hidden size-4 md:block" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={depois}
            aria-label="Agora não, avisar depois"
            title="Agora não (avisa de novo daqui a 1 hora)"
            className={`shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:text-slate-600${soNoCelular}`}
          >
            <X className="size-4" />
          </button>
        </div>
        {aberto && (
          <div className="border-t border-brand-900/10 px-3 pb-3 pt-2">
            <p className="text-[12.5px] leading-snug text-slate-600">
              Saíram melhorias no sistema. Atualizar recarrega esta tela: o que já foi enviado
              ou salvo continua. <b>Texto digitado e ainda não enviado se perde</b> — se estiver
              no meio de algo, termine antes.
            </p>
            {semInternet && (
              <p className="mt-2 text-[12.5px] font-medium leading-snug text-rose-600">
                Sem internet agora. Tente de novo quando a conexão voltar.
              </p>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={atualizar}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-700"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Atualizar agora
              </button>
              <button
                type="button"
                onClick={depois}
                className="rounded-xl px-3 py-2 text-[13px] font-medium text-slate-500 transition hover:text-slate-700"
              >
                Depois
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
