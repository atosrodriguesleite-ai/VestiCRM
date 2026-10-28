"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { Map as MapIcon } from "lucide-react";
import { NOME_DO_ESTADO } from "@/lib/envios/estados";
// import só de TIPO: some na compilação e NÃO puxa os ~170 KB de municípios
// do mapa.ts para o navegador
import type { MapaEnvios as UmMapa, MapaNaEstrada } from "@/lib/envios/mapa";
import mapaBrasil from "@/lib/envios/mapa-brasil.json";

/**
 * Os dois recortes que a tela oferece:
 *  - `etiquetas`: só o que saiu com etiqueta do Melhor Envio (o gasto de frete
 *    que a loja pagou por aqui);
 *  - `todos`: TODO pedido pago com endereço — inclui motoboy, transportadora
 *    própria e retirada, que nunca teriam etiqueta.
 */
export type MapaDeEnvios = {
  etiquetas: UmMapa;
  todos: UmMapa;
  /** RN-103: o que está POSTADO e ainda não chegou, com atrasados em vermelho */
  estrada: MapaNaEstrada;
};

type Modo = "estrada" | "todos" | "etiquetas";

/** cores de STATUS do pacote na estrada (RN-089: vermelho é status, nunca série) */
const COR_NO_PRAZO = "#c4622d";
const COR_ATRASADO = "#e11d48";
/** sem prazo e há mais de 7 dias na rua: "parado", nunca "atrasado" (RN-102) */
const COR_PARADO = "#d97706";
const COR_ORIGEM = "#1e293b";
/** a cor de STATUS de uma cidade: o pior caso ali decide */
const corDaSituacao = (atrasados: number, parados: number) =>
  atrasados > 0 ? COR_ATRASADO : parados > 0 ? COR_PARADO : COR_NO_PRAZO;

/**
 * O arco da loja até a cidade: uma curva (Bézier quadrática) com o ponto de
 * controle deslocado para o lado, proporcional à distância — reto parecia
 * uma linha de régua, e arcos muito curvos cruzavam o mapa inteiro. Para a
 * cidade colada na loja o arco vira um tracinho, e tudo bem.
 */
function arco(o: { x: number; y: number }, d: { x: number; y: number }): string {
  const mx = (o.x + d.x) / 2;
  const my = (o.y + d.y) / 2;
  const dx = d.x - o.x;
  const dy = d.y - o.y;
  const dist = Math.hypot(dx, dy) || 1;
  const curva = Math.min(60, dist * 0.22);
  // perpendicular (sempre para o mesmo lado, para dois arcos vizinhos não se cruzarem)
  const cx = mx - (dy / dist) * curva;
  const cy = my + (dx / dist) * curva;
  return `M ${o.x} ${o.y} Q ${cx} ${cy} ${d.x} ${d.y}`;
}

/**
 * MAPA DE ENVIOS — o Brasil pintado por onde a loja vende.
 *
 * Estado fica mais forte quanto mais envios recebeu (escala do cobre da
 * marca); cada cidade de destino vira uma bolinha (a bolinha cresce com a
 * quantidade). Cidade que não casou com a base aparece no centro do estado —
 * o envio NUNCA some do mapa. Ao lado, a lista de estados com quantidade:
 * só entra estado com 1+ envio (estado sem envio não vira linha).
 *
 * Os contornos vêm de mapa-brasil.json (gerado por
 * scripts/gerar-mapa-envios.mjs, commitado — nada externo é consultado);
 * os pontos chegam prontos do servidor, já na projeção do viewBox.
 */

const UFS = (mapaBrasil as { viewBox: string; ufs: Record<string, { d: string; centro: number[] }> }).ufs;
const VIEW_BOX = (mapaBrasil as { viewBox: string }).viewBox;
// lado do viewBox ("0 0 620 620" → 620), para posicionar a dica em % —
// regenerar o mapa com outro tamanho não pode desalinhar o tooltip
const LADO = Number(VIEW_BOX.split(" ")[3]);

/**
 * Escala sequencial do cobre — mais envios, mais forte.
 *
 * O tom mais claro é COBRE de verdade e o "sem envio" é CINZA: a versão
 * anterior tinha os dois quase iguais (diferença perceptual 3,6 — o olho não
 * separa em duas áreas grandes), então o Rio com 42 pedidos parecia tão
 * apagado quanto Roraima com zero. Agora a menor diferença da escala é 16.
 */
const TONS = ["#f2d9bc", "#e5b88c", "#d59260", "#c4622d", "#8f4419"];
const SEM_ENVIO = "#e9e6e2";
/** bolinha da cidade: escura o bastante para não sumir no estado mais forte */
const COR_PONTO = "#4a2410";

/**
 * O SUBSTANTIVO SEGUE O RECORTE. No modo "todos" a conta é de PEDIDOS PAGOS —
 * inclui retirada na loja, que nunca virou envio; chamar tudo de "envio" ali
 * seria mentira na cara da lojista.
 */
const plural = (n: number, modo: Modo) =>
  modo === "todos"
    ? `${n} pedido${n === 1 ? "" : "s"}`
    : modo === "estrada"
      ? `${n} pacote${n === 1 ? "" : "s"}`
      : `${n} envio${n === 1 ? "" : "s"}`;

/** "3 pacotes a caminho · 1 atrasado · 1 parado" — o texto da dica e da lista no modo estrada */
const textoNaEstrada = (total: number, atrasados: number, parados: number) => {
  const partes = [`${plural(total, "estrada")} a caminho`];
  if (atrasados > 0) partes.push(`${atrasados} atrasado${atrasados === 1 ? "" : "s"}`);
  if (parados > 0) partes.push(`${parados} parado${parados === 1 ? "" : "s"} (sem prazo)`);
  if (atrasados === 0 && parados === 0) partes[0] += ", no prazo";
  return partes.join(" · ");
};

export function MapaEnvios({ mapa, aoAbrirTv }: { mapa: MapaDeEnvios; aoAbrirTv?: () => void }) {
  const [dica, setDica] = useState<{ x: number; y: number; titulo: string; texto: string } | null>(null);
  // abre em "NA ESTRADA" quando há pacote a caminho (é o que o dono pediu
  // para monitorar: quantos estão na rua e qual atrasou); sem nenhum, no
  // recorte mais completo — para onde a loja vende
  const [modo, setModo] = useState<Modo>(mapa.estrada.total > 0 ? "estrada" : "todos");

  const estrada = mapa.estrada;
  // no modo estrada o mapa de estados e a lista são derivados da camada
  const atual: UmMapa = useMemo(
    () =>
      modo === "estrada"
        ? {
            porUf: estrada.porUf.map((e) => ({ uf: e.uf, nome: e.nome, quantidade: e.quantidade })),
            pontos: estrada.pontos.map((p) => ({ x: p.x, y: p.y, cidade: p.cidade, uf: p.uf, quantidade: p.noPrazo + p.atrasados })),
            total: estrada.total,
            semEndereco: estrada.semEndereco,
          }
        : modo === "todos"
          ? mapa.todos
          : mapa.etiquetas,
    [modo, mapa, estrada]
  );
  const atrasadosPorUf = useMemo(() => new Map(estrada.porUf.map((e) => [e.uf, e.atrasados])), [estrada.porUf]);
  const paradosPorUf = useMemo(() => new Map(estrada.porUf.map((e) => [e.uf, e.parados])), [estrada.porUf]);
  const comProblema = estrada.atrasados + estrada.parados;

  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of atual.porUf) m.set(e.uf, e.quantidade);
    return m;
  }, [atual.porUf]);

  const maiorUf = atual.porUf.reduce((m, e) => Math.max(m, e.quantidade), 0);
  const maiorPonto = atual.pontos.reduce((m, p) => Math.max(m, p.quantidade), 0);
  const textoDoLugar = (uf: string, total: number) =>
    modo === "estrada" ? textoNaEstrada(total, atrasadosPorUf.get(uf) ?? 0, paradosPorUf.get(uf) ?? 0) : plural(total, modo);

  /**
   * ESCALA LOGARÍTMICA, não proporcional ao maior. Numa confecção real São
   * Paulo vale dez vezes o segundo colocado: dividindo pelo maior, 25 dos 27
   * estados caíam no tom mais claro e o mapa dizia "só vendo em SP". O log
   * abre a cauda: quem tem 3, 12 e 40 pedidos ganha tons diferentes, em vez
   * de todo mundo empilhado no mais claro.
   */
  const corDoEstado = (uf: string) => {
    const q = contagem.get(uf) ?? 0;
    if (q <= 0) return SEM_ENVIO;
    // NA ESTRADA o estado é só fundo: tinta clara (rosada onde há atraso)
    // para o arco e a bolinha — que carregam a informação — não sumirem
    // num estado pintado de cobre escuro
    if (modo === "estrada")
      return (atrasadosPorUf.get(uf) ?? 0) > 0 ? "#fbe4e9" : (paradosPorUf.get(uf) ?? 0) > 0 ? "#fdecd2" : TONS[0];
    if (maiorUf <= 1) return TONS[TONS.length - 1]; // todos empatados em 1
    const proporcao = Math.log(q) / Math.log(maiorUf);
    return TONS[Math.max(0, Math.min(TONS.length - 1, Math.round(proporcao * (TONS.length - 1))))];
  };

  /**
   * Bolinha discreta: com todas as cidades empatadas em 1 pedido (loja nova),
   * o raio antigo dava 12px em TODAS e a Grande São Paulo virava uma mancha
   * só — Recife e Olinda ficam a 0,7px uma da outra neste mapa.
   */
  const raioDoPonto = (q: number) =>
    maiorPonto <= 0 ? 3.2 : 3.2 + 4.8 * Math.sqrt(q / maiorPonto);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <MapIcon className="size-4 text-brand-600" />
        <div>
          <p className="text-sm font-semibold text-slate-800">Mapa de envios</p>
          <p className="text-xs text-slate-400">
            {modo === "estrada" ? (
              estrada.total > 0 ? (
                <>
                  <span className="font-medium text-slate-600">{plural(estrada.total, "estrada")} a caminho agora</span>
                  {estrada.atrasados > 0 && (
                    <>
                      {" · "}
                      <span className="font-semibold" style={{ color: COR_ATRASADO }}>
                        {estrada.atrasados} atrasado{estrada.atrasados === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                  {estrada.parados > 0 && (
                    <>
                      {" · "}
                      <span className="font-semibold" style={{ color: COR_PARADO }}>
                        {estrada.parados} parado{estrada.parados === 1 ? "" : "s"} (sem prazo)
                      </span>
                    </>
                  )}
                  {comProblema === 0 && " · tudo no prazo"}
                  {estrada.cortado && " · mostrando os mais antigos (a lista bateu no teto)"}
                </>
              ) : (
                "nenhum pacote a caminho agora"
              )
            ) : modo === "todos" ? (
              "para onde a loja vende — todo pedido pago com endereço"
            ) : (
              "só o que saiu com etiqueta comprada aqui no sistema"
            )}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap gap-1.5">
          {aoAbrirTv && (
            <button
              onClick={aoAbrirTv}
              className="rounded-full border border-slate-900 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 transition hover:bg-slate-50"
              title="Tela cheia com o mapa 3D dos pacotes a caminho, para deixar na TV da loja"
            >
              📺 Modo TV
            </button>
          )}
          {(
            [
              { key: "estrada", rotulo: comProblema > 0 ? `Na estrada · ${comProblema} ⚠️` : "Na estrada" },
              { key: "todos", rotulo: "Todos os pedidos pagos" },
              { key: "etiquetas", rotulo: "Melhor Envio" },
            ] as { key: Modo; rotulo: string }[]
          ).map((op) => (
            <button
              key={op.key}
              onClick={() => setModo(op.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                modo === op.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {op.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_260px]">
        {/* ---- o Brasil ------------------------------------------------ */}
        <div className="mx-auto w-full max-w-xl">
        <div className="relative" onMouseLeave={() => setDica(null)}>
          <svg viewBox={VIEW_BOX} className="w-full" role="img" aria-label={`Mapa do Brasil com a quantidade de ${modo === "todos" ? "pedidos pagos" : "envios"} por estado`}>
            {Object.entries(UFS).map(([uf, forma]) => (
              <path
                key={uf}
                d={forma.d}
                fill={corDoEstado(uf)}
                stroke="#fff"
                strokeWidth={1.2}
                className="transition-opacity hover:opacity-80"
                onMouseEnter={() =>
                  setDica({
                    x: forma.centro[0],
                    y: forma.centro[1],
                    titulo: NOME_DO_ESTADO[uf] ?? uf,
                    texto: textoDoLugar(uf, contagem.get(uf) ?? 0),
                  })
                }
              >
                <title>{`${NOME_DO_ESTADO[uf] ?? uf} — ${textoDoLugar(uf, contagem.get(uf) ?? 0)}`}</title>
              </path>
            ))}
            {/* NA ESTRADA (RN-103): um arco da loja até cada cidade com pacote
                a caminho, vermelho quando algum ali atrasou — os atrasados são
                desenhados por último, para ficarem por cima */}
            {modo === "estrada" && estrada.origem &&
              estrada.pontos.map((p) => (
                <path
                  key={`arco|${p.cidade ?? "~"}|${p.uf}`}
                  d={arco(estrada.origem!, p)}
                  fill="none"
                  stroke={corDaSituacao(p.atrasados, p.parados)}
                  strokeWidth={p.atrasados + p.parados > 0 ? 2 : 1.4}
                  strokeOpacity={0.85}
                  strokeLinecap="round"
                  className="rota-viva pointer-events-none"
                />
              ))}
            {modo === "estrada" && estrada.origem && (
              <g aria-label={`Loja: ${estrada.origem.cidade ?? estrada.origem.uf}`}>
                <circle cx={estrada.origem.x} cy={estrada.origem.y} r={7} fill="#fff" stroke={COR_ORIGEM} strokeWidth={2} />
                <circle cx={estrada.origem.x} cy={estrada.origem.y} r={2.6} fill={COR_ORIGEM} />
                <title>{`Sua loja — ${estrada.origem.cidade ?? estrada.origem.uf}`}</title>
              </g>
            )}
            {/* bolinhas por cidade (as maiores por baixo, para nenhuma sumir).
                A do estado SEM cidade identificada sai VAZADA: ela é desenhada
                sobre a capital, e cheia virava "vendeu para a capital" — que é
                mentira quando o cadastro só não tinha a cidade. */}
            {modo !== "estrada" && atual.pontos.map((p) => (
              <circle
                key={`${p.cidade ?? "~"}|${p.uf}`}
                cx={p.x}
                cy={p.y}
                r={raioDoPonto(p.quantidade)}
                fill={p.cidade ? COR_PONTO : "#fff"}
                fillOpacity={p.cidade ? 0.85 : 0.95}
                stroke={p.cidade ? "#fff" : COR_PONTO}
                strokeWidth={1.5}
                strokeDasharray={p.cidade ? undefined : "3 2"}
                onMouseEnter={() =>
                  setDica({
                    x: p.x,
                    y: p.y,
                    titulo: p.cidade ? `${p.cidade} · ${p.uf}` : `${p.uf} (cidade não identificada)`,
                    texto: plural(p.quantidade, modo),
                  })
                }
              >
                <title>{`${p.cidade ?? p.uf} — ${plural(p.quantidade, modo)}`}</title>
              </circle>
            ))}
            {/* os pacotes a caminho: bolinha na cor do STATUS da cidade (um
                atrasado ali pinta de vermelho), vazada quando a cidade não
                casou, pela mesma régua do mapa de sempre */}
            {modo === "estrada" && estrada.pontos.map((p) => {
              const total = p.noPrazo + p.atrasados + p.parados;
              const cor = corDaSituacao(p.atrasados, p.parados);
              return (
                <circle
                  key={`estrada|${p.cidade ?? "~"}|${p.uf}`}
                  cx={p.x}
                  cy={p.y}
                  r={raioDoPonto(total)}
                  fill={p.cidade ? cor : "#fff"}
                  fillOpacity={0.95}
                  stroke={p.cidade ? "#fff" : cor}
                  strokeWidth={1.5}
                  strokeDasharray={p.cidade ? undefined : "3 2"}
                  onMouseEnter={() =>
                    setDica({
                      x: p.x,
                      y: p.y,
                      titulo: p.cidade ? `${p.cidade} · ${p.uf}` : `${p.uf} (cidade não identificada)`,
                      texto: textoNaEstrada(total, p.atrasados, p.parados),
                    })
                  }
                >
                  <title>{`${p.cidade ?? p.uf} — ${textoNaEstrada(total, p.atrasados, p.parados)}`}</title>
                </circle>
              );
            })}
          </svg>

          {dica && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-white shadow-lg"
              style={{ left: `${(dica.x / LADO) * 100}%`, top: `${(dica.y / LADO) * 100}%` }}
            >
              <p className="whitespace-nowrap text-xs font-medium">{dica.titulo}</p>
              <p className="whitespace-nowrap text-[11px] text-slate-300">{dica.texto}</p>
            </div>
          )}
          </div>
          {/* legenda fora do bloco do MAPA (a altura dela entrava na conta de
              posição da dica e empurrava a dica para baixo do ponto), mas
              ainda dentro da mesma coluna do grid */}
          {modo === "estrada" ? (
            <div className="-mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full border-2 bg-white" style={{ borderColor: COR_ORIGEM }} />
                sua loja
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: COR_NO_PRAZO }} />
                a caminho, no prazo
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: COR_ATRASADO }} />
                com pacote atrasado
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: COR_PARADO }} />
                parado há +7 dias, sem prazo
              </span>
              {!estrada.origem && estrada.total > 0 && (
                <span className="text-amber-600">
                  sem o endereço do remetente (Configurações → Melhor Envio) o mapa não desenha o caminho
                </span>
              )}
            </div>
          ) : (
          <div className="-mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
            <span>menos</span>
            <span className="flex overflow-hidden rounded-sm">
              {TONS.map((t) => (
                <span key={t} className="h-2.5 w-6" style={{ backgroundColor: t }} />
              ))}
            </span>
            <span>mais</span>
            <span className="ms-3 inline-block size-2.5 rounded-full" style={{ backgroundColor: COR_PONTO }} />
            <span>cidade da cliente</span>
            <span
              className="ms-3 inline-block size-2.5 rounded-full border-2 bg-white"
              style={{ borderColor: COR_PONTO }}
            />
            <span>cidade não identificada</span>
          </div>
          )}
        </div>

        {/* ---- envios por estado (só quem tem 1+) ---------------------- */}
        <div>
          {atual.total === 0 ? (
            <p className="p-4 text-center text-sm text-slate-400">
              {modo === "estrada"
                ? "Nenhum pacote a caminho agora. Quando a transportadora postar o próximo, ele aparece aqui. 🚚"
                : modo === "todos"
                  ? "Nenhum pedido pago com endereço cadastrado ainda. 🚚"
                  : "Nenhuma etiqueta comprada ainda — o mapa acende quando a primeira sair. 🚚"}
            </p>
          ) : (
            <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {modo === "estrada" ? "A caminho, por estado" : modo === "todos" ? "Pedidos por estado" : "Envios por estado"}
            </p>
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pe-1 thin-scroll">
              {atual.porUf.map((e) => {
                const atrasados = modo === "estrada" ? (atrasadosPorUf.get(e.uf) ?? 0) : 0;
                const parados = modo === "estrada" ? (paradosPorUf.get(e.uf) ?? 0) : 0;
                return (
                <li key={e.uf}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate text-slate-700">
                      <span className="me-1.5 font-semibold text-slate-500">{e.uf}</span>
                      {e.nome}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-800">
                      {e.quantidade}
                      {atrasados > 0 && (
                        <span className="ms-1.5 text-xs font-semibold" style={{ color: COR_ATRASADO }}>
                          {atrasados} atrasado{atrasados === 1 ? "" : "s"}
                        </span>
                      )}
                      {parados > 0 && (
                        <span className="ms-1.5 text-xs font-semibold" style={{ color: COR_PARADO }}>
                          {parados} parado{parados === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
                    {modo === "estrada" ? (
                      <>
                        <div
                          className="h-1.5"
                          style={{ width: `${Math.max(0, ((e.quantidade - atrasados - parados) / maiorUf) * 100)}%`, backgroundColor: COR_NO_PRAZO }}
                        />
                        <div className="h-1.5" style={{ width: `${(parados / maiorUf) * 100}%`, backgroundColor: COR_PARADO }} />
                        <div className="h-1.5" style={{ width: `${(atrasados / maiorUf) * 100}%`, backgroundColor: COR_ATRASADO }} />
                      </>
                    ) : (
                      <div
                        className="h-1.5 rounded-full bg-brand-600"
                        style={{ width: `${Math.max(6, (e.quantidade / maiorUf) * 100)}%` }}
                      />
                    )}
                  </div>
                </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              {plural(atual.total, modo)} no mapa · {atual.porUf.length} estado
              {atual.porUf.length === 1 ? "" : "s"}
            </p>
            </>
          )}
          {/* FORA do "se tem alguém no mapa": o aviso vale principalmente
              quando o mapa está VAZIO — é ele que explica o vazio. Escondê-lo
              ali deixava a lojista sem entender por que não vê nada. */}
          {atual.semEndereco > 0 && (
            <p className="mt-1 px-1 text-xs text-amber-600">
              {plural(atual.semEndereco, modo)} sem estado no cadastro — não dá para
              pôr no mapa.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
