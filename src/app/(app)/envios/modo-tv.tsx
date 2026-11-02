"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Pause, Play, X } from "lucide-react";
import type { MapaNaEstrada } from "@/lib/envios/mapa";
import { CORES_TV, avisoDaFalhaDaTv, fraseDoPlacar, temPacoteNaTela, type PlacarDaTv } from "@/lib/envios/tv-regra";
import { textoDeAtualizado } from "@/lib/bi/hoje-regra";
import { Mapa3d } from "./mapa-3d";

/**
 * MODO TV DOS ENVIOS (RN-104): a tela cheia que fica ligada na loja — o
 * mapa 3D dos pacotes a caminho, o placar do dia e a lista por estado,
 * atualizados sozinhos a cada minuto pela porta leve `/api/envios/tv`.
 *
 * Réguas de tela: pede de novo só com a aba visível (TV apagada não gasta
 * banco); se um pedido falhar, mantém o último número bom e DIZ o que foi
 * (a régua da faixa "hoje" do BI, RN-088); Esc fecha; "Tela cheia" usa o
 * navegador (é o botão que a pessoa aperta antes de deixar a TV ligada).
 */

type Dados = { loja: string; agora: string; estrada: MapaNaEstrada; placar: PlacarDaTv };

const INTERVALO_MS = 60_000;

export function ModoTv({ aoFechar }: { aoFechar: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [desde, setDesde] = useState(Date.now());
  const [girando, setGirando] = useState(true);
  const [sem3d, setSem3d] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  const pedir = useCallback(async () => {
    try {
      const r = await fetch("/api/envios/tv", { cache: "no-store" });
      if (!r.ok) {
        setErro(avisoDaFalhaDaTv(r.status));
        return;
      }
      const d = (await r.json()) as Dados;
      setDados(d);
      setErro("");
      setDesde(Date.now());
    } catch {
      setErro(avisoDaFalhaDaTv(null));
    }
  }, []);

  useEffect(() => {
    pedir();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") pedir();
    }, INTERVALO_MS);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") pedir();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [pedir]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const telaCheia = () => {
    const el = raiz.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const placar = dados?.placar;
  const estrada = dados?.estrada;

  // Portal para o <body>: dentro do <main> do app (que anima com transform)
  // o `fixed` vira relativo a ele — a TV ficava 20 px curta e por baixo do
  // cabeçalho do celular
  return createPortal(
    <div
      ref={raiz}
      className="tv-raiz fixed inset-0 z-[70] flex flex-col overflow-hidden text-[#f6ead9]"
      role="dialog"
      aria-label="Modo TV dos envios"
    >
      {/* ---- topo: loja, ao vivo, botões ---------------------------- */}
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-wide text-[#ffc58f]">
            📦 {dados?.loja ?? "Envios"} · na estrada
          </p>
          <p className="text-xs text-[#b89a80]">
            {erro ? (
              <span className="text-[#ffb020]">{erro} — mostrando o último número</span>
            ) : (
              <>
                <span className="tv-pulso me-1 inline-block size-2 rounded-full bg-[#4ade80] align-middle" />
                ao vivo · atualizado <Relogio desde={desde} />
              </>
            )}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-1.5">
          {!sem3d && (
            <button onClick={() => setGirando((g) => !g)} className="tv-botao" title={girando ? "Pausar o giro" : "Girar o mapa"}>
              {girando ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
          )}
          <button onClick={telaCheia} className="tv-botao" title="Tela cheia">
            <Maximize2 className="size-4" />
          </button>
          <button onClick={aoFechar} className="tv-botao" title="Fechar (Esc)">
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* ---- placar ------------------------------------------------- */}
      <div className="grid grid-cols-3 gap-2 px-4 sm:grid-cols-6 sm:px-6">
        <Numero rotulo="A caminho" valor={placar?.aCaminho} cor="#ffc58f" />
        <Numero rotulo="Atrasados" valor={placar?.atrasados} cor={CORES_TV.atrasado} apagado={!placar?.atrasados} />
        <Numero rotulo="Parados (sem prazo)" valor={placar?.parados} cor={CORES_TV.parado} apagado={!placar?.parados} />
        <Numero rotulo="Postados hoje" valor={placar?.postadosHoje} />
        <Numero rotulo="Entregues hoje" valor={placar?.entreguesHoje} />
        <Numero rotulo="Aguardando postagem" valor={placar?.aguardandoPostagem} />
      </div>
      {placar && <p className="px-4 pt-2 text-sm text-[#d9c2a8] sm:px-6">{fraseDoPlacar(placar)}</p>}

      {/* ---- mapa + lista ------------------------------------------- */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 sm:px-6 lg:grid-cols-[1fr_280px]">
        <div className="relative min-h-[280px] overflow-hidden rounded-2xl border border-[#3a2a1c] bg-[#120d09]">
          {estrada && !sem3d && <Mapa3d estrada={estrada} girando={girando} aoFalhar={() => setSem3d(true)} />}
          {sem3d && (
            <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm text-[#b89a80]">
              Este aparelho não desenha o mapa 3D. O placar e a lista ao lado continuam ao vivo.
            </p>
          )}
          {/* os avisos do mapa, empilhados: mais de um pode valer ao mesmo tempo */}
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-1.5 px-6 text-center">
            {placar && placar.aCaminho === 0 && (
              <p className="text-sm text-[#b89a80]">Nenhum pacote a caminho agora — o mapa acende quando a transportadora postar o próximo.</p>
            )}
            {estrada && placar && placar.aCaminho > 0 && !temPacoteNaTela(estrada) && (
              <p className="text-sm text-[#ffb020]">
                {placar.aCaminho} a caminho, mas sem estado no cadastro — fora do mapa.
              </p>
            )}
            {estrada && temPacoteNaTela(estrada) && estrada.semEndereco > 0 && (
              <p className="text-xs text-[#ffb020] lg:hidden">{estrada.semEndereco} sem estado no cadastro — fora do mapa.</p>
            )}
            {estrada && !estrada.origem && estrada.total > 0 && (
              <p className="text-xs text-[#ffb020]">Sem o endereço do remetente (Configurações → Melhor Envio) o mapa não desenha o caminho da loja.</p>
            )}
            {estrada?.cortado && <p className="text-xs text-[#b89a80]">mostrando os mais antigos (a lista bateu no teto)</p>}
          </div>
        </div>
        <div className="hidden min-h-0 overflow-y-auto rounded-2xl border border-[#3a2a1c] bg-[#120d09] p-4 lg:block">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#b89a80]">A caminho, por estado</p>
          {estrada && estrada.porUf.length === 0 && <p className="text-sm text-[#b89a80]">Nada na rua agora.</p>}
          <ul className="space-y-2.5">
            {estrada?.porUf.slice(0, 14).map((e) => (
              <li key={e.uf} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">
                    <span className="me-1.5 font-semibold text-[#b89a80]">{e.uf}</span>
                    {e.nome}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {e.quantidade}
                    {e.atrasados > 0 && (
                      <span className="ms-1.5 text-xs" style={{ color: CORES_TV.atrasado }}>
                        {e.atrasados} atrasado{e.atrasados === 1 ? "" : "s"}
                      </span>
                    )}
                    {e.parados > 0 && (
                      <span className="ms-1.5 text-xs" style={{ color: CORES_TV.parado }}>
                        {e.parados} parado{e.parados === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {estrada && estrada.porUf.length > 14 && (
            <p className="mt-3 text-xs text-[#b89a80]">e mais {estrada.porUf.length - 14} estado{estrada.porUf.length - 14 === 1 ? "" : "s"}</p>
          )}
          {estrada && estrada.semEndereco > 0 && (
            <p className="mt-3 text-xs text-[#ffb020]">{estrada.semEndereco} sem estado no cadastro — fora do mapa.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Numero({ rotulo, valor, cor, apagado }: { rotulo: string; valor: number | undefined; cor?: string; apagado?: boolean }) {
  return (
    <div className="rounded-xl border border-[#3a2a1c] bg-[#120d09] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#b89a80]">{rotulo}</p>
      <p className="text-2xl font-bold tabular-nums sm:text-3xl" style={{ color: apagado ? "#6b5a4a" : (cor ?? "#f6ead9") }}>
        {valor ?? "—"}
      </p>
    </div>
  );
}

/** o "há N s" com estado próprio: só ele redesenha a cada segundo */
function Relogio({ desde }: { desde: number }) {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    setSegundos(0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setSegundos((Date.now() - desde) / 1000);
    }, 1000);
    return () => clearInterval(t);
  }, [desde]);
  return <>{textoDeAtualizado(segundos)}</>;
}
