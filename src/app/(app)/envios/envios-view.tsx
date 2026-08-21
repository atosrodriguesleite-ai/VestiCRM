"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Truck,
  Search,
  Copy,
  Check,
  RefreshCw,
  Calculator,
  Package,
  Clock,
  CheckCircle2,
  Wallet,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Input, Spinner } from "@/components/ui";
import { copiarTexto } from "@/lib/copiar";
import { MapaEnvios, type MapaDeEnvios } from "./mapa-envios";
import { AGUARDANDO_POSTAGEM, estaParado, lerValorBR } from "@/lib/envios/painel";
import type { MeQuote, MeRecusa, VolumePacote } from "@/lib/melhorenvio-tipos";

/**
 * Tela Envios — lista viva do que saiu da loja + simulador de frete (RN-019).
 *
 * O simulador NÃO CHUTA: mostra envios reais parecidos ("teve um pedido de
 * 23 peças nessa caixa") e a vendedora escolhe qual usar — regra combinada
 * com o dono em 19/08/2026. Tudo aqui respeita o escopo de pedidos (RN-007):
 * o servidor já manda só o que a pessoa pode ver.
 */

type Envio = {
  id: string;
  orderId: string;
  pedido: number;
  cliente: string;
  transportadora: string | null;
  servico: string | null;
  status: string | null;
  preco: number | null;
  rastreio: string | null;
  linkPublico: string | null;
  etiqueta: string | null;
  pesoKg: number | null;
  pecas: number | null;
  compradoEm: string | null;
  postadoEm: string | null;
  entregueEm: string | null;
  cidade: string | null;
  uf: string | null;
  comNota: boolean;
};

type Painel = {
  gastoMes: number;
  aguardandoPostagem: number;
  emTransito: number;
  entregues: number;
  devolvidos: number;
  parados: number;
  mediaEntregaDias: number | null;
};

type Dados = {
  lista: Envio[];
  painel: Painel;
  /** null quando a resposta é de BUSCA (a lupa não muda o mapa) */
  mapa: MapaDeEnvios | null;
  /** a lista bateu no teto de 300 (a tela avisa em vez de calar) */
  listaCortada: boolean;
  /** quantos a busca achou na loja inteira (null quando não há busca) */
  totalDaBusca: number | null;
  diasParaParado: number;
  simuladorLigado: boolean;
  podeLigarSimulador: boolean;
};

type Embalagem = {
  id: string;
  /** número do pedido — null para vendedora sem visão total (RN-007) */
  pedido: number | null;
  compradoEm: string;
  pecas: number;
  volumes: VolumePacote[];
  pesoKg: number;
};

const ABAS = [
  { key: "todos", rotulo: "Todos" },
  { key: "aguardando", rotulo: "Aguardando postagem" },
  { key: "transito", rotulo: "Em trânsito" },
  { key: "entregues", rotulo: "Entregues" },
  { key: "atencao", rotulo: "Atenção" },
] as const;
type Aba = (typeof ABAS)[number]["key"];

function abaDoEnvio(e: Envio): Aba {
  if (e.status === "DEVOLVIDO" || e.status === "CANCELADO") return "atencao";
  if (e.status === "ENTREGUE") return "entregues";
  if (e.status === "POSTADO")
    return estaParado(e.status, e.postadoEm) ? "atencao" : "transito";
  // fonte única com o painel: os dois números da mesma página não podem divergir
  if (e.status && (AGUARDANDO_POSTAGEM as readonly string[]).includes(e.status))
    return "aguardando";
  return "todos";
}

function chipDoStatus(e: Envio): { texto: string; cor: string } {
  if (e.status === "ENTREGUE") return { texto: "Entregue", cor: "#059669" };
  if (e.status === "DEVOLVIDO") return { texto: "Devolvido", cor: "#e11d48" };
  if (e.status === "CANCELADO") return { texto: "Cancelada", cor: "#64748b" };
  if (e.status === "POSTADO")
    return estaParado(e.status, e.postadoEm)
      ? { texto: "Parado no caminho", cor: "#e11d48" }
      : { texto: "Em trânsito", cor: "#2563eb" };
  return { texto: "Aguardando postagem", cor: "#d97706" };
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataCurta = (v: string | null) =>
  v
    ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : "—";
const medidas = (v: VolumePacote) =>
  `${v.larguraCm}×${v.comprimentoCm}×${v.alturaCm} cm`;

export function EnviosView() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [aba, setAba] = useState<Aba>("todos");
  const [busca, setBusca] = useState("");
  const [copiado, setCopiado] = useState("");

  const carregar = useCallback(async (q = "") => {
    setAtualizando(true);
    try {
      const r = await fetch(`/api/envios${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Não foi possível carregar os envios.");
      // resposta de busca vem SEM mapa (a lupa não o muda) — fica o da carga cheia
      setDados((antes) => (d.mapa ? d : { ...d, mapa: antes?.mapa ?? null }));
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os envios.");
    } finally {
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // A LUPA BUSCA NO SERVIDOR (loja inteira), não só nas 300 linhas
  // carregadas — a lupa que "só via as 200 carregadas" já foi incidente
  // real no chat. Meio segundo de pausa para não buscar a cada tecla.
  const primeiraBusca = useRef(true);
  useEffect(() => {
    if (primeiraBusca.current) {
      // a carga inicial já aconteceu no efeito acima — buscar de novo aqui
      // seria pedir a mesma lista duas vezes na abertura da tela
      primeiraBusca.current = false;
      return;
    }
    const t = setTimeout(() => carregar(busca.trim()), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  async function copiar(texto: string, chave: string) {
    if (await copiarTexto(texto)) {
      setCopiado(chave);
      setTimeout(() => setCopiado(""), 1600);
    }
  }

  // o texto da lupa é filtrado NO SERVIDOR (a lista já vem só com o que
  // casa); aqui só resta separar por aba
  const lista = useMemo(() => {
    if (!dados) return [];
    return dados.lista.filter((e) => aba === "todos" || abaDoEnvio(e) === aba);
  }, [dados, aba]);

  if (!dados && !erro)
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner className="size-6" />
      </div>
    );

  return (
    <div className="space-y-5">
      {erro && <Alert tone="danger">{erro}</Alert>}

      {dados && (
        <>
          {/* ---- Painel ---------------------------------------------- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CardDoPainel
              icone={<Wallet />}
              titulo="Gasto com frete no mês"
              valor={brl(dados.painel.gastoMes)}
              detalhe="etiquetas compradas"
            />
            <CardDoPainel
              icone={<Package />}
              titulo="Aguardando postagem"
              valor={String(dados.painel.aguardandoPostagem)}
              detalhe="etiqueta pronta, caixa na loja"
            />
            <CardDoPainel
              icone={<Clock />}
              titulo="Em trânsito"
              valor={String(dados.painel.emTransito)}
              detalhe={
                dados.painel.parados > 0
                  ? `${dados.painel.parados} deles parado${dados.painel.parados > 1 ? "s" : ""} há +${dados.diasParaParado} dias`
                  : "tudo andando"
              }
              alerta={dados.painel.parados > 0}
            />
            <CardDoPainel
              icone={<CheckCircle2 />}
              titulo="Entregues"
              valor={String(dados.painel.entregues)}
              detalhe={
                dados.painel.mediaEntregaDias != null
                  ? `${dados.painel.mediaEntregaDias.toLocaleString("pt-BR")} dia${dados.painel.mediaEntregaDias === 1 ? "" : "s"} em média (últimos 90 dias)`
                  : "sem entregas recentes"
              }
            />
          </div>

          {/* ---- Mapa de envios --------------------------------------- */}
          {dados.mapa && <MapaEnvios mapa={dados.mapa} />}

          {/* ---- Simulador (RN-019) ----------------------------------- */}
          <Simulador
            ligado={dados.simuladorLigado}
            podeLigar={dados.podeLigarSimulador}
            aoMudar={carregar}
          />

          {/* ---- Lista ------------------------------------------------ */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {ABAS.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => setAba(a.key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      aba === a.key
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {a.rotulo}
                  </button>
                ))}
              </div>
              <div className="ms-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Cliente, pedido ou rastreio"
                    className="!py-1.5 !ps-8 !text-xs w-52"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => carregar(busca.trim())}
                  disabled={atualizando}
                >
                  {atualizando ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
                  Atualizar
                </Button>
              </div>
            </div>

            {lista.length === 0 ? (
              /* BUSCA SEM RESULTADO NÃO É "loja sem envios": olhar só o
                 tamanho da lista fazia uma loja com centenas de envios ler
                 "Nenhum envio ainda" só porque procurou por um nome que não
                 existe (achado da revisão). Quem manda é o termo buscado. */
              <EmptyState
                icon={<Truck />}
                title={
                  dados.lista.length > 0
                    ? "Nada aqui com esse filtro"
                    : busca.trim()
                      ? `Nada encontrado para "${busca.trim()}"`
                      : "Nenhum envio ainda"
                }
                hint={
                  dados.lista.length > 0
                    ? "Troque a aba para ver os outros envios."
                    : busca.trim()
                      ? "Procure pelo nome da cliente, número do pedido ou código de rastreio."
                      : "Quando você comprar uma etiqueta na tela do pedido, o envio aparece aqui com o rastreio andando sozinho."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2.5 font-medium">Pedido</th>
                      <th className="px-4 py-2.5 font-medium">Destinatária</th>
                      <th className="px-4 py-2.5 font-medium">Transportadora</th>
                      <th className="px-4 py-2.5 font-medium">Rastreio</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium text-right">Frete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((e) => {
                      const chip = chipDoStatus(e);
                      return (
                        <tr
                          key={e.id}
                          className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
                        >
                          <td className="px-4 py-3">
                            <Link
                              href={`/pedidos/${e.orderId}`}
                              className="font-medium text-slate-800 hover:text-brand-600 hover:underline"
                            >
                              #{e.pedido}
                            </Link>
                            <p className="text-[11px] text-slate-400">
                              {dataCurta(e.compradoEm)}
                              {e.pecas ? ` · ${e.pecas} pç` : ""}
                              {e.comNota ? " · NF-e" : ""}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-slate-700">{e.cliente}</p>
                            {(e.cidade || e.uf) && (
                              <p className="text-[11px] text-slate-400">
                                {[e.cidade, e.uf].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {[e.transportadora, e.servico].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className="px-4 py-3">
                            {e.rastreio ? (
                              <span className="inline-flex items-center gap-1.5">
                                <code className="text-xs text-slate-600">{e.rastreio}</code>
                                <button
                                  onClick={() => copiar(e.rastreio!, `r-${e.id}`)}
                                  title="Copiar código de rastreio"
                                  className="text-slate-400 hover:text-slate-700"
                                >
                                  {copiado === `r-${e.id}` ? (
                                    <Check className="size-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="size-3.5" />
                                  )}
                                </button>
                                {e.linkPublico && (
                                  <button
                                    onClick={() =>
                                      copiar(
                                        `${window.location.origin}/rastreio/${e.linkPublico}`,
                                        `l-${e.id}`
                                      )
                                    }
                                    title="Copiar o link de rastreio para mandar à cliente"
                                    className="text-slate-400 hover:text-slate-700"
                                  >
                                    {copiado === `l-${e.id}` ? (
                                      <Check className="size-3.5 text-emerald-600" />
                                    ) : (
                                      <ExternalLink className="size-3.5" />
                                    )}
                                  </button>
                                )}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">sem código ainda</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge color={chip.cor}>{chip.texto}</Badge>
                            {e.status === "ENTREGUE" && e.entregueEm && (
                              <p className="mt-0.5 text-[11px] text-slate-400">
                                em {dataCurta(e.entregueEm)}
                              </p>
                            )}
                            {e.status === "POSTADO" && e.postadoEm && (
                              <p className="mt-0.5 text-[11px] text-slate-400">
                                postado em {dataCurta(e.postadoEm)}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {e.preco != null ? brl(e.preco) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* CORTE DECLARADO, nunca em silêncio — e também quando a busca
                devolve mais do que cabe: o aviso vivia dentro do galho da
                tabela, então sumia justamente quando a aba ficava vazia e a
                lojista mais precisava saber que existia coisa além. */}
            {dados.listaCortada && (
              <p className="border-t border-slate-50 px-4 py-2 text-[11px] text-slate-400">
                {dados.totalDaBusca != null
                  ? `A busca achou ${dados.totalDaBusca} — mostrando os 300 mais recentes. Use um termo mais específico.`
                  : "Mostrando os 300 envios mais recentes — use a busca para encontrar qualquer envio antigo."}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function CardDoPainel({
  icone,
  titulo,
  valor,
  detalhe,
  alerta = false,
}: {
  icone: React.ReactNode;
  titulo: string;
  valor: string;
  detalhe: string;
  alerta?: boolean;
}) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-2 text-slate-400 [&>svg]:size-4">
        {icone}
        <span className="text-[11px] font-medium uppercase tracking-wide">{titulo}</span>
      </div>
      <p className="mt-1.5 text-xl font-semibold text-slate-900">{valor}</p>
      <p className={`text-[11px] ${alerta ? "font-medium text-rose-600" : "text-slate-400"}`}>
        {alerta && <AlertTriangle className="me-1 inline size-3" />}
        {detalhe}
      </p>
    </Card>
  );
}

/* ---- Simulador de frete (RN-019) --------------------------------------- */

type CategoriaDaLoja = { nome: string; temMedidas: boolean };
type LinhaDeCategoria = { categoria: string; quantidade: string };

function Simulador({
  ligado,
  podeLigar,
  aoMudar,
}: {
  ligado: boolean;
  podeLigar: boolean;
  aoMudar: () => void;
}) {
  // dois jeitos de dizer o tamanho do pacote: MONTAR pelas medidas de 1 peça
  // por categoria (o principal — ideia do dono, 19/08/2026) ou reaproveitar
  // a embalagem de um envio passado parecido (a memória)
  const [modo, setModo] = useState<"categorias" | "passado">("categorias");
  const [cats, setCats] = useState<CategoriaDaLoja[] | null>(null);
  const [linhas, setLinhas] = useState<LinhaDeCategoria[]>([
    { categoria: "", quantidade: "" },
  ]);
  const [pecas, setPecas] = useState("");
  const [cep, setCep] = useState("");
  const [valor, setValor] = useState("");
  const [embalagens, setEmbalagens] = useState<Embalagem[] | null>(null);
  const [escolhida, setEscolhida] = useState<Embalagem | null>(null);
  const [quotes, setQuotes] = useState<MeQuote[] | null>(null);
  const [recusadas, setRecusadas] = useState<MeRecusa[]>([]);
  const [pacote, setPacote] = useState<VolumePacote[] | null>(null);
  const [busy, setBusy] = useState<"" | "buscar" | "cotar" | "ligar">("");
  const [erro, setErro] = useState("");

  // categorias da loja (com/sem medidas), para o modo principal. Falha de
  // rede NÃO vira lista vazia: vazia significa "sem medidas cadastradas", e
  // esse diagnóstico errado mandaria a vendedora atrás da gerência à toa.
  const [catsFalhou, setCatsFalhou] = useState(false);
  const carregarCategorias = useCallback(() => {
    setCatsFalhou(false);
    fetch("/api/envios/simulador")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setCats(d.categorias ?? []))
      .catch(() => setCatsFalhou(true));
  }, []);
  useEffect(() => {
    if (ligado) carregarCategorias();
  }, [ligado, carregarCategorias]);

  // vendedora sem poder de ligar não vê nem o convite (para ela o recurso
  // simplesmente não existe enquanto a gerência não ligar)
  if (!ligado && !podeLigar) return null;

  async function alternar(ligar: boolean) {
    setBusy("ligar");
    setErro("");
    try {
      const r = await fetch("/api/envios/simulador/ativar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ligar }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Não foi possível mudar o simulador.");
      aoMudar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível mudar o simulador.");
    } finally {
      setBusy("");
    }
  }

  if (!ligado)
    return (
      <Card className="px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Calculator className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Simulador de frete — responda “quanto fica o frete?” antes de fechar o pedido
              </p>
              <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
                Você diz a categoria e a quantidade, e o sistema monta o pacote pelas medidas
                de 1 peça de cada categoria (Configurações → Melhor Envio) e cota só com o
                CEP da cliente. ⚠️ <b>É uma estimativa</b>: o valor final pode mudar quando a
                expedição embalar de verdade.
              </p>
            </div>
          </div>
          <Button onClick={() => alternar(true)} disabled={busy === "ligar"} className="shrink-0">
            {busy === "ligar" ? <Spinner className="size-4" /> : <Calculator className="size-4" />}
            Entendi, ligar o simulador
          </Button>
        </div>
        {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}
      </Card>
    );

  function validarDestino(): { cepLimpo: string; valorNum: number } | null {
    const cepLimpo = cep.replace(/\D/g, "");
    if (cepLimpo.length !== 8) {
      setErro("Informe o CEP da cliente (8 números).");
      return null;
    }
    const valorNum = lerValorBR(valor);
    if (!Number.isFinite(valorNum) || valorNum < 0) {
      setErro("Informe o valor aproximado do pedido (é o seguro da carga).");
      return null;
    }
    return { cepLimpo, valorNum };
  }

  async function cotarCom(body: Record<string, unknown>) {
    setBusy("cotar");
    setErro("");
    try {
      const r = await fetch("/api/envios/simulador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Não foi possível cotar agora.");
      setQuotes(d.quotes);
      setRecusadas(d.recusadas ?? []);
      setPacote(d.pacote ?? null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível cotar agora.");
    } finally {
      setBusy("");
    }
  }

  // ---- modo principal: montar o pacote pelas categorias -------------------
  async function simularPorCategorias() {
    const destino = validarDestino();
    if (!destino) return;
    const categorias: { categoria: string; quantidade: number }[] = [];
    for (const l of linhas) {
      const qtd = Number(l.quantidade);
      if (!l.categoria && !l.quantidade) continue; // linha em branco: ignora
      if (!l.categoria || !Number.isInteger(qtd) || qtd < 1) {
        setErro("Complete cada linha: categoria e quantidade de peças.");
        return;
      }
      categorias.push({ categoria: l.categoria, quantidade: qtd });
    }
    if (categorias.length === 0) {
      setErro("Adicione ao menos uma categoria com quantidade.");
      return;
    }
    setQuotes(null);
    await cotarCom({
      cep: destino.cepLimpo,
      valorSegurado: destino.valorNum,
      categorias,
    });
  }

  // ---- alternativa: a embalagem de um envio passado ------------------------
  async function buscarEmbalagens() {
    const n = Number(pecas);
    if (!Number.isInteger(n) || n < 1) {
      setErro("Informe quantas peças o pedido tem.");
      return;
    }
    setBusy("buscar");
    setErro("");
    setQuotes(null);
    setEscolhida(null);
    try {
      const r = await fetch(`/api/envios/simulador?pecas=${n}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Não foi possível buscar as embalagens.");
      setEmbalagens(d.embalagens);
      // uma opção só não é escolha: já deixa selecionada, falta só o CEP
      if (d.embalagens.length === 1) setEscolhida(d.embalagens[0]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível buscar as embalagens.");
    } finally {
      setBusy("");
    }
  }

  async function cotarPorEmbalagem() {
    if (!escolhida) return;
    const destino = validarDestino();
    if (!destino) return;
    await cotarCom({
      cep: destino.cepLimpo,
      valorSegurado: destino.valorNum,
      volumes: escolhida.volumes,
    });
  }

  const semMedidas = cats !== null && cats.every((c) => !c.temMedidas);

  return (
    <Card className="px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calculator className="size-4 text-brand-600" />
          <p className="text-sm font-semibold text-slate-800">Simulador de frete</p>
          <Badge color="#d97706">estimativa</Badge>
        </div>
        {podeLigar && (
          <button
            onClick={() => alternar(false)}
            disabled={busy === "ligar"}
            className="text-[11px] text-slate-400 hover:text-slate-600"
          >
            desligar
          </button>
        )}
      </div>

      {/* como o tamanho do pacote nasce: montado OU de um envio passado */}
      <div className="mt-2 flex gap-1.5">
        <button
          onClick={() => {
            setModo("categorias");
            setQuotes(null);
            setErro("");
          }}
          className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
            modo === "categorias"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Pelas categorias
        </button>
        <button
          onClick={() => {
            setModo("passado");
            setQuotes(null);
            setErro("");
          }}
          className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
            modo === "passado"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Por um envio passado
        </button>
      </div>

      {modo === "categorias" ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            Diga a categoria e quantas peças: o pacote é montado pelas medidas de <b>1 peça</b>{" "}
            de cada categoria (empilhadas), cadastradas em Configurações → Melhor Envio.
          </p>
          {catsFalhou && (
            <Alert tone="warning">
              Não consegui carregar as categorias agora.{" "}
              <button onClick={carregarCategorias} className="font-semibold underline">
                Tentar de novo
              </button>
            </Alert>
          )}
          {semMedidas && (
            <Alert tone="warning" icon={<Package />}>
              Nenhuma categoria tem medidas cadastradas ainda. Peça para a gerência preencher
              as medidas de 1 peça por categoria em <b>Configurações → Melhor Envio →
              Embalagem e peso por categoria</b> — ou use a aba “Por um envio passado”.
            </Alert>
          )}
          {linhas.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={l.categoria}
                onChange={(e) =>
                  setLinhas(linhas.map((x, j) => (j === i ? { ...x, categoria: e.target.value } : x)))
                }
                className="w-52 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-400"
              >
                <option value="">Categoria…</option>
                {(cats ?? []).map((c) => (
                  <option key={c.nome} value={c.nome} disabled={!c.temMedidas}>
                    {c.nome}
                    {!c.temMedidas ? " (sem medidas)" : ""}
                  </option>
                ))}
              </select>
              <Input
                value={l.quantidade}
                onChange={(e) =>
                  setLinhas(linhas.map((x, j) => (j === i ? { ...x, quantidade: e.target.value } : x)))
                }
                inputMode="numeric"
                placeholder="Peças"
                className="!w-24 !text-sm"
              />
              {linhas.length > 1 && (
                <button
                  onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}
                  className="text-[11px] text-slate-400 hover:text-rose-500"
                >
                  remover
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setLinhas([...linhas, { categoria: "", quantidade: "" }])}
            className="text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            + Adicionar categoria
          </button>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[130px_150px_auto]">
            <Input
              value={cep}
              onChange={(e) => setCep(e.target.value)}
              inputMode="numeric"
              placeholder="CEP da cliente"
              className="!text-sm"
            />
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="Valor aprox. (R$)"
              className="!text-sm"
            />
            <div className="col-span-2 sm:col-span-1">
              <Button
                onClick={simularPorCategorias}
                disabled={busy !== "" || semMedidas}
                size="sm"
                className="w-full sm:w-auto"
              >
                {busy === "cotar" ? <Spinner className="size-3.5" /> : <Truck className="size-3.5" />}
                Simular frete
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            Diga quantas peças e o sistema encontra um envio passado parecido — você escolhe a
            embalagem e cota com o CEP.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[110px_130px_150px_auto]">
            <Input
              value={pecas}
              onChange={(e) => setPecas(e.target.value)}
              inputMode="numeric"
              placeholder="Peças"
              className="!text-sm"
            />
            <Input
              value={cep}
              onChange={(e) => setCep(e.target.value)}
              inputMode="numeric"
              placeholder="CEP da cliente"
              className="!text-sm"
            />
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder="Valor aprox. (R$)"
              className="!text-sm"
            />
            <div className="col-span-2 sm:col-span-1">
              <Button
                onClick={buscarEmbalagens}
                disabled={busy !== ""}
                size="sm"
                className="w-full sm:w-auto"
              >
                {busy === "buscar" ? <Spinner className="size-3.5" /> : <Search className="size-3.5" />}
                Buscar embalagem parecida
              </Button>
            </div>
          </div>

          {embalagens && embalagens.length === 0 && (
            <Alert tone="info" icon={<Package />}>
              Ainda não tem envio parecido na memória. A memória cresce sozinha: cada etiqueta
              comprada com as medidas reais do pacote vira referência para as próximas simulações.
            </Alert>
          )}

          {embalagens && embalagens.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-600">
                Envios parecidos — escolha o que mais lembra este pedido:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {embalagens.map((em) => {
                  const ativa = escolhida?.id === em.id;
                  return (
                    <button
                      key={em.id}
                      onClick={() => {
                        setEscolhida(em);
                        setQuotes(null);
                      }}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                        ativa
                          ? "border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-500/20"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <span className="font-semibold">
                        {/* vendedora sem visão total não vê número de pedido de
                            colega (RN-007) — só a embalagem */}
                        {em.pedido != null ? `Pedido #${em.pedido} · ` : "Envio de "}
                        {em.pecas} peças
                      </span>
                      <span className="mt-0.5 block text-[11px] opacity-80">
                        {em.pesoKg} kg · {em.volumes.map(medidas).join(" + ")}
                        {em.volumes.length > 1 ? ` (${em.volumes.length} volumes)` : ""} ·{" "}
                        {dataCurta(em.compradoEm)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Button onClick={cotarPorEmbalagem} disabled={!escolhida || busy !== ""} size="sm">
                  {busy === "cotar" ? <Spinner className="size-3.5" /> : <Truck className="size-3.5" />}
                  Simular frete com essa embalagem
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {erro && <p className="mt-2 text-xs text-rose-600">{erro}</p>}

      {quotes && (
        <div className="mt-3 space-y-1.5">
          {pacote && pacote.length > 0 && (
            <p className="text-[11px] text-slate-500">
              📦 Pacote estimado:{" "}
              <b>
                {Math.round(pacote.reduce((s, v) => s + v.pesoKg, 0) * 1000) / 1000} kg ·{" "}
                {pacote.map(medidas).join(" + ")}
                {pacote.length > 1 ? ` (${pacote.length} volumes)` : ""}
              </b>
            </p>
          )}
          {quotes.length === 0 ? (
            <Alert tone="warning">Nenhuma transportadora cotou este trecho.</Alert>
          ) : (
            quotes.map((q) => (
              <div
                key={q.serviceId}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2 text-sm"
              >
                <span className="text-slate-700">
                  {q.carrier} <span className="text-slate-400">{q.service}</span>
                  {q.days != null && (
                    <span className="ms-2 text-[11px] text-slate-400">
                      até {q.days} dia{q.days === 1 ? "" : "s"} úteis
                    </span>
                  )}
                </span>
                <b className="text-slate-900">{brl(q.price)}</b>
              </div>
            ))
          )}
          {recusadas.length > 0 && (
            <p className="text-[11px] text-slate-400">
              Não cotaram: {recusadas.map((r) => `${r.carrier} (${r.reason})`).join(" · ")}
            </p>
          )}
          <p className="text-[11px] text-amber-700">
            ⚠️ Estimativa — o valor final sai na compra da etiqueta, com o pacote deste
            pedido pesado e medido pela expedição.
          </p>
        </div>
      )}
    </Card>
  );
}
