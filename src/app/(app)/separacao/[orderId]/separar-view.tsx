"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Loader2, ScanBarcode, User, X } from "lucide-react";
import { Card } from "@/components/ui";
import { timeShort } from "@/lib/format";
import {
  aplicarBipe,
  avaliarBipe,
  declararFalta,
  podeConcluir,
  resumoDaSeparacao,
  type ItemDaSeparacao,
  type ResultadoDoBipe,
} from "@/lib/etiquetas/separacao-regra";

type Estado = {
  orderId: string;
  numero: string;
  cliente: string;
  itens: ItemDaSeparacao[];
  quem: { id: string | null; nome: string; desde: string } | null;
  jaSeparadoEm: string | null;
  semCodigo: { rotulo: string; quantidade: number }[];
};

type Aviso = { tom: "ok" | "erro"; texto: string; em: number };

/**
 * Som curto pelo WebAudio: a pessoa está olhando para a arara, não para a
 * tela — o "bip" agudo confirma, o grave repetido recusa. Sem som (aba
 * sem permissão, navegador antigo) nada quebra: a cor da tela já diz.
 */
function tocar(aceito: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notas = aceito ? [[880, 0, 0.09]] : [[220, 0, 0.14], [220, 0.2, 0.14]];
    for (const [freq, inicio, dur] of notas) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = freq;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + inicio);
      o.stop(ctx.currentTime + inicio + dur);
    }
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* sem som */
  }
}

/**
 * A TELA DO BIPE (RN-060). O leitor de código de barras é um teclado: digita
 * o código e aperta Enter. O campo fica sempre com o foco; cada Enter passa
 * pela MESMA regra do servidor (`avaliarBipe`) na hora — verde e bip agudo
 * aceita, vermelho e bip grave recusa (peça errada ou a mais) — e o bipe
 * aceito vai para o servidor em segundo plano (a segunda tranca — e a
 * contagem DELE é a que vale na conclusão: bipe que não chegou é mandado
 * de novo antes de concluir, nunca contado no escuro). Concluir só libera
 * com toda linha fechada: bipada ou declarada em FALTA.
 */
export function SepararView({ inicial, meuId }: { inicial: Estado; meuId: string }) {
  const [itens, setItensEstado] = useState<ItemDaSeparacao[]>(inicial.itens);
  /** a lista de AGORA, fora do ciclo de render: dois Enter do leitor no mesmo
   *  instante eram avaliados sobre a mesma lista velha e os dois saíam para o
   *  servidor (achado da revisão) */
  const itensRef = useRef<ItemDaSeparacao[]>(inicial.itens);
  const setItens = useCallback((novos: ItemDaSeparacao[]) => {
    itensRef.current = novos;
    setItensEstado(novos);
  }, []);
  /** quem está separando e o carimbo — atualizados ao bipar e ao recarregar (banner nunca fica velho) */
  const [quem, setQuem] = useState(inicial.quem);
  const [jaSeparadoEm, setJaSeparadoEm] = useState(inicial.jaSeparadoEm);
  /** concluída em OUTRA tela enquanto esta estava aberta */
  const [encerradaFora, setEncerradaFora] = useState(false);
  const [entrada, setEntrada] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ultimo, setUltimo] = useState<{ indice: number; aceito: boolean } | null>(null);
  const [faltaDe, setFaltaDe] = useState<{ variantId: string; valor: string } | null>(null);
  const [concluindo, setConcluindo] = useState(false);
  type Proximo = { id: string; numero: string; cliente: string } | null;
  const [concluido, setConcluido] = useState<{ faltas: number; pecas: number; proximo: Proximo } | null>(null);
  const router = useRouter();
  /**
   * MODO BANCADA (pedido do dono, 19/09/2026): ao concluir, o próximo pedido
   * da fila abre sozinho depois de uma contagem curta — quem separa 40
   * pedidos por dia não volta para a lista a cada um. Preferência do
   * aparelho (localStorage): a bancada liga uma vez e fica.
   */
  const [bancada, setBancada] = useState(false);
  const [contagem, setContagem] = useState<number | null>(null);
  useEffect(() => {
    try {
      setBancada(localStorage.getItem("separacao:bancada") === "1");
    } catch {
      /* sem storage */
    }
  }, []);
  function alternarBancada() {
    const novo = !bancada;
    setBancada(novo);
    try {
      localStorage.setItem("separacao:bancada", novo ? "1" : "0");
    } catch {
      /* sem storage */
    }
  }
  // a contagem só CONTA; quem navega é o efeito de baixo, uma vez, quando
  // ela chega a zero (navegar de dentro do updater rodava em dobro no
  // StrictMode — achado da revisão). Cancelar zera para null e para o relógio.
  useEffect(() => {
    if (!concluido?.proximo || !bancada) return;
    setContagem(3);
  }, [concluido, bancada]);
  useEffect(() => {
    if (contagem == null || contagem <= 0) return;
    const t = setTimeout(() => setContagem((c) => (c == null ? c : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [contagem]);
  useEffect(() => {
    if (contagem === 0 && concluido?.proximo) router.push(`/separacao/${concluido.proximo.id}`);
  }, [contagem, concluido, router]);
  const [erroServidor, setErroServidor] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  const fila = useRef<Promise<void>>(Promise.resolve());
  /** bipes aceitos aqui que o servidor ainda NÃO confirmou (sem conexão): concluir tenta de novo antes */
  const naoEnviados = useRef<string[]>([]);
  const [pendentes, setPendentes] = useState(0);

  const resumo = resumoDaSeparacao(itens);
  const semCodigo = inicial.semCodigo.reduce((t, x) => t + x.quantidade, 0);
  const pode = podeConcluir(itens, semCodigo);
  const naMao = itens.length === 0 && semCodigo > 0;
  const deOutro = !!quem && !!quem.id && quem.id !== meuId;

  // o foco volta para o campo do leitor sempre que a pessoa clica fora de
  // outro campo — senão o bipe cai no vazio e ninguém percebe
  useEffect(() => {
    const focar = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, button, a, select")) return;
      campo.current?.focus();
    };
    document.addEventListener("click", focar);
    campo.current?.focus();
    return () => document.removeEventListener("click", focar);
  }, []);

  /**
   * RECARREGA a separação do servidor (a contagem de lá é a que vale): a
   * lista em tela é estado local, então `router.refresh()` sozinho não
   * a atualizaria — a pessoa seguiria vendo 2/2 numa linha que o servidor
   * tem 1/2 (achado da revisão).
   */
  const recarregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/etiquetas/separacao/${inicial.orderId}`);
      const d = (await r.json().catch(() => null)) as (Estado & { error?: string }) | null;
      if (!r.ok || !d) {
        setErroServidor(d?.error ?? "Este pedido não está mais na fila.");
        return;
      }
      // carimbo diferente do que esta tela carregou: outra tela concluiu —
      // esta não pode seguir bipando por cima como se fosse do zero
      if (d.jaSeparadoEm !== inicial.jaSeparadoEm) {
        setEncerradaFora(true);
        return;
      }
      setItens(d.itens);
      setQuem(d.quem);
      setJaSeparadoEm(d.jaSeparadoEm);
      setUltimo(null);
    } catch {
      setErroServidor("Sem conexão para atualizar a tela.");
    }
  }, [inicial.orderId, inicial.jaSeparadoEm, setItens]);

  /** Manda UM bipe ao servidor; devolve false quando não chegou (sem conexão). */
  const postarBipe = useCallback(
    async (codigo: string): Promise<boolean> => {
      let r: Response;
      try {
        r = await fetch(`/api/etiquetas/separacao/${inicial.orderId}/bipe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo, carimbo: inicial.jaSeparadoEm }),
        });
      } catch {
        return false;
      }
      const d = (await r.json().catch(() => null)) as (ResultadoDoBipe & { error?: string; motivo?: string | null }) | null;
      if (!r.ok) {
        // outra tela concluiu este pedido: nada daqui vale mais
        if (d?.motivo === "concluida-fora") {
          setEncerradaFora(true);
          return true;
        }
        // pedido saiu da fila (cancelado no meio)
        setErroServidor(d?.error ?? "O servidor não registrou o bipe.");
        void recarregar();
        return true;
      }
      // o servidor recusou o que a tela aceitou (outra pessoa bipou a mesma
      // linha em outra tela, ou o pedido mudou): a contagem de lá é a que vale
      if (d && !d.aceito) {
        setErroServidor(`${d.frase} A contagem foi atualizada com a do servidor.`);
        void recarregar();
      }
      return true;
    },
    [inicial.orderId, inicial.jaSeparadoEm, recarregar]
  );

  /** Manda o bipe em ordem, em segundo plano; o que não chegou fica guardado para tentar de novo. */
  const enviarBipe = useCallback(
    (codigo: string) => {
      fila.current = fila.current.then(async () => {
        const chegou = await postarBipe(codigo);
        if (!chegou) {
          naoEnviados.current.push(codigo);
          setPendentes(naoEnviados.current.length);
          setErroServidor("Sem conexão: o bipe ficou só nesta tela. Concluir tenta mandar de novo.");
        }
      });
    },
    [postarBipe]
  );

  function bipar(texto: string) {
    const codigo = texto.trim();
    if (!codigo) return;
    // avaliado UMA vez, sobre a lista de agora; só o que foi aplicado aqui vai ao servidor
    const r = avaliarBipe(itensRef.current, codigo);
    tocar(r.aceito);
    setUltimo(r.indice != null ? { indice: r.indice, aceito: r.aceito } : null);
    if (r.aceito) {
      setItens(aplicarBipe(itensRef.current, r));
      // quem bipa assume: o banner "Fulana começou" sai daqui
      setQuem((q) => (q && q.id === meuId ? q : { id: meuId, nome: "você", desde: new Date().toISOString() }));
      setAviso({ tom: "ok", texto: `✓ ${r.item.rotulo} ${r.item.detalhe} (${r.item.bipada}/${r.item.pedida})`, em: Date.now() });
      enviarBipe(codigo);
    } else {
      setAviso({ tom: "erro", texto: r.frase, em: Date.now() });
    }
    setEntrada("");
  }

  async function salvarFalta() {
    if (!faltaDe) return;
    const n = Math.max(0, Math.floor(Number(faltaDe.valor) || 0));
    const novos = declararFalta(itensRef.current, faltaDe.variantId, n);
    setItens(novos);
    setFaltaDe(null);
    campo.current?.focus();
    const linha = novos.find((i) => i.variantId === faltaDe.variantId);
    try {
      const r = await fetch(`/api/etiquetas/separacao/${inicial.orderId}/falta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId: faltaDe.variantId, falta: linha?.falta ?? n, carimbo: inicial.jaSeparadoEm }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        if (d?.motivo === "concluida-fora") {
          setEncerradaFora(true);
          return;
        }
        setErroServidor(d?.error ?? "Não deu para registrar a falta. Recarregue a tela.");
      }
    } catch {
      setErroServidor("Sem conexão: a falta ficou só nesta tela. Concluir vai conferir tudo de novo.");
    }
  }

  async function concluir() {
    if (!pode || concluindo) return;
    setConcluindo(true);
    setErroServidor("");
    try {
      await fila.current; // os bipes em voo chegam antes da conclusão
      // o que ficou sem conexão vai agora — a contagem que vale é a do servidor
      const retentar = naoEnviados.current;
      naoEnviados.current = [];
      for (const codigo of retentar) {
        if (!(await postarBipe(codigo))) naoEnviados.current.push(codigo);
      }
      setPendentes(naoEnviados.current.length);
      if (naoEnviados.current.length > 0) {
        setErroServidor(`${naoEnviados.current.length} bipe(s) ainda não chegaram ao servidor. Confira a conexão e tente concluir de novo.`);
        return;
      }
      const r = await fetch(`/api/etiquetas/separacao/${inicial.orderId}/concluir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faltas: itensRef.current.map((i) => ({ variantId: i.variantId, falta: i.falta })),
          carimbo: inicial.jaSeparadoEm,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (d?.motivo === "concluida-fora") {
          setEncerradaFora(true);
          return;
        }
        setErroServidor(d?.error ?? "Não deu para concluir. Tente de novo.");
        void recarregar();
        return;
      }
      setConcluido({ faltas: d.faltas, pecas: d.pecas, proximo: d.proximo ?? null });
    } catch {
      setErroServidor("Sem conexão. Tente de novo.");
    } finally {
      setConcluindo(false);
    }
  }

  if (encerradaFora) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center">
        <CheckCircle2 className="size-14 mx-auto text-emerald-500" />
        <h1 className="text-xl font-bold mt-3">Pedido {inicial.numero} já foi concluído em outra tela</h1>
        <p className="text-sm text-gray-600 mt-1">Alguém da equipe concluiu esta separação enquanto esta tela estava aberta. Nada daqui foi registrado por cima.</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center mt-6">
          <Link href="/separacao" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5">
            <ScanBarcode className="size-4" /> Voltar para a fila
          </Link>
          <Link href={`/pedidos/${inicial.orderId}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2.5 hover:border-brand-300">
            Ver o pedido
          </Link>
        </div>
      </div>
    );
  }

  if (concluido) {
    return (
      <div className="max-w-xl mx-auto py-10 text-center">
        <CheckCircle2 className={`size-14 mx-auto ${concluido.faltas > 0 ? "text-amber-500" : "text-emerald-500"}`} />
        <h1 className="text-xl font-bold mt-3">Pedido {inicial.numero} separado</h1>
        <p className="text-sm text-gray-600 mt-1">
          {concluido.pecas} peça{concluido.pecas === 1 ? "" : "s"} bipada{concluido.pecas === 1 ? "" : "s"} para {inicial.cliente}.
          {concluido.faltas > 0 && (
            <>
              {" "}
              <b className="text-amber-700">{concluido.faltas} em falta</b> — a vendedora do pedido foi avisada no sino para combinar com a cliente.
            </>
          )}
        </p>
        <p className="text-xs text-gray-500 mt-2">O pedido passou para &ldquo;Separação&rdquo; e o histórico dele registra quem separou.</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center mt-6">
          {concluido.proximo ? (
            <Link
              href={`/separacao/${concluido.proximo.id}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5"
            >
              <ScanBarcode className="size-4" /> Próximo: {concluido.proximo.numero} · {concluido.proximo.cliente}
              {contagem != null && contagem > 0 && <span className="ml-1 text-white/80">({contagem}s)</span>}
            </Link>
          ) : (
            <Link href="/separacao" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5">
              <ScanBarcode className="size-4" /> Voltar para a fila
            </Link>
          )}
          <Link href={`/pedidos/${inicial.orderId}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2.5 hover:border-brand-300">
            Ver o pedido
          </Link>
        </div>
        {concluido.proximo && contagem != null && contagem > 0 && (
          <button type="button" onClick={() => setContagem(null)} className="mt-3 text-xs text-gray-500 hover:underline">
            Não abrir o próximo sozinho desta vez
          </button>
        )}
      </div>
    );
  }

  const fundo = aviso && Date.now() - aviso.em < 60_000 ? (aviso.tom === "ok" ? "bg-emerald-50 border-emerald-200" : "bg-rose-50 border-rose-300") : "bg-white border-gray-200";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/separacao" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-brand-700">
            <ArrowLeft className="size-3.5" /> Fila de separação
          </Link>
          <h1 className="text-xl font-bold mt-1">
            Separar pedido {inicial.numero} <span className="text-gray-500 font-normal">· {inicial.cliente}</span>
          </h1>
        </div>
        <div className="text-right">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer mb-1 select-none" title="Ao concluir, abre o próximo pedido da fila sozinho">
            <input type="checkbox" checked={bancada} onChange={alternarBancada} className="accent-brand-600" />
            modo bancada
          </label>
          <div className="text-2xl font-bold tabular-nums">
            {resumo.bipadas}
            <span className="text-gray-400 text-base font-normal"> / {resumo.pedidas}</span>
          </div>
          <div className="text-xs text-gray-500">peças bipadas{resumo.faltas > 0 ? ` · ${resumo.faltas} em falta` : ""}</div>
        </div>
      </div>

      {jaSeparadoEm && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>Este pedido já foi separado em {timeShort(jaSeparadoEm)}. Separar de novo grava uma nova conferência no histórico.</span>
        </div>
      )}
      {deOutro && quem && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 flex items-start gap-2">
          <User className="size-4 mt-0.5 shrink-0" />
          <span>
            <b>{quem.nome}</b> começou esta separação às {timeShort(quem.desde)}. Ao bipar, você assume — e fica registrado no seu nome.
          </span>
        </div>
      )}
      {inicial.semCodigo.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>
            Sem código de barras (peça sem cadastro ou apagada), confira na mão:{" "}
            {inicial.semCodigo.map((s) => `${s.quantidade}× ${s.rotulo}`).join("; ")}.
            {naMao && " Este pedido não tem peça para bipar — conferiu tudo, conclua."}
          </span>
        </div>
      )}
      {erroServidor && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span className="flex-1">{erroServidor}</span>
          <button type="button" onClick={() => setErroServidor("")} className="text-rose-500 hover:text-rose-700" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </div>
      )}

      <Card className={`p-5 border-2 transition-colors ${fundo}`}>
        <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <ScanBarcode className="size-4 text-brand-600" /> Bipe a peça
        </label>
        <input
          ref={campo}
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              bipar(entrada);
            }
          }}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Aponte o leitor para o código de barras da peça"
          className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-lg tracking-wider outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 bg-white"
        />
        <div className="mt-2 min-h-6 text-sm font-medium" aria-live="polite">
          {aviso ? (
            <span className={aviso.tom === "ok" ? "text-emerald-700" : "text-rose-700"}>{aviso.texto}</span>
          ) : (
            <span className="text-gray-500">Cada bipe confere na hora: verde entra, vermelho é peça errada ou peça a mais.</span>
          )}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <ul className="divide-y divide-gray-100">
          {itens.map((i, k) => {
            const fechada = i.bipada + i.falta >= i.pedida;
            const destaque = ultimo?.indice === k ? (ultimo.aceito ? "bg-emerald-50" : "bg-rose-50") : "";
            return (
              <li key={i.variantId} className={`px-5 py-3 flex items-center gap-3 ${destaque} transition-colors`}>
                <div
                  className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                    fechada ? (i.falta > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700") : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {fechada ? i.falta > 0 ? <AlertTriangle className="size-4" /> : <Check className="size-4" /> : <span className="text-xs font-semibold">{i.pedida - i.bipada - i.falta}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{i.rotulo}</div>
                  <div className="text-xs text-gray-500">
                    {i.detalhe}
                    {i.falta > 0 && <span className="text-amber-700"> · {i.falta} em falta</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums">
                    {i.bipada}
                    <span className="text-gray-400 font-normal"> / {i.pedida}</span>
                  </div>
                  {faltaDe?.variantId === i.variantId ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void salvarFalta();
                      }}
                      className="flex items-center gap-1 mt-1"
                    >
                      <input
                        autoFocus
                        type="number"
                        min={0}
                        max={i.pedida - i.bipada}
                        value={faltaDe.valor}
                        onChange={(e) => setFaltaDe({ variantId: i.variantId, valor: e.target.value })}
                        className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm text-right"
                        aria-label="Quantidade em falta"
                      />
                      <button type="submit" className="rounded-lg bg-amber-600 text-white text-xs px-2 py-1">ok</button>
                      <button type="button" onClick={() => setFaltaDe(null)} className="text-xs text-gray-500 px-1">✕</button>
                    </form>
                  ) : (
                    !fechada || i.falta > 0 ? (
                      <button
                        type="button"
                        onClick={() => setFaltaDe({ variantId: i.variantId, valor: String(i.falta > 0 ? i.falta : i.pedida - i.bipada) })}
                        className="text-[11px] text-amber-700 hover:underline"
                      >
                        {i.falta > 0 ? "mudar falta" : "não tem na arara"}
                      </button>
                    ) : null
                  )}
                </div>
              </li>
            );
          })}
          {itens.length === 0 && (
            <li className="px-5 py-6 text-sm text-gray-500 text-center">
              {naMao ? "Nenhuma peça com código de barras: confira na mão e conclua." : "Este pedido não tem peça para conferir."}
            </li>
          )}
        </ul>
      </Card>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-end">
        {!pode && itens.length > 0 && (
          <span className="text-xs text-gray-500">
            Faltam {resumo.faltamBipar} peça{resumo.faltamBipar === 1 ? "" : "s"}. Bipe o que falta ou marque &ldquo;não tem na arara&rdquo; na linha.
          </span>
        )}
        {pendentes > 0 && <span className="text-xs text-rose-700">{pendentes} bipe(s) sem conexão — vão junto ao concluir.</span>}
        <button
          type="button"
          disabled={!pode || concluindo}
          onClick={() => void concluir()}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 transition"
        >
          {concluindo ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {naMao ? "Concluir (conferido na mão)" : `Concluir separação${resumo.faltas > 0 ? ` (${resumo.faltas} em falta)` : ""}`}
        </button>
      </div>
    </div>
  );
}
