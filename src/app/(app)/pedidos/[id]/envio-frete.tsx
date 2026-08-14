"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Truck,
  Loader2,
  Copy,
  CheckCircle2,
  Printer,
  FileText,
  XCircle,
  RefreshCcw,
  MessageCircle,
} from "lucide-react";
import { Card } from "@/components/ui";
import { brl } from "@/lib/format";
import { copiarTexto } from "@/lib/copiar";

/**
 * Painel de Envio do pedido (módulo Envios / Melhor Envio):
 * cotar → escolher serviço → comprar etiqueta → imprimir + rastrear.
 * Só aparece para loja com o módulo ligado e o Melhor Envio conectado.
 */

type Quote = {
  serviceId: number;
  service: string;
  carrier: string;
  carrierLogo: string | null;
  price: number;
  days: number | null;
};

type Recusa = {
  carrier: string;
  services: string[];
  reason: string;
};

type Ship = {
  meOrderId: string | null;
  meService: string | null;
  meCarrier: string | null;
  mePrice: number | null;
  meStatus: string | null;
  labelUrl: string | null;
  trackingCode: string | null;
  weightKg: number | null;
  nfeKey: string | null;
} | null;

const statusLabel: Record<string, string> = {
  ETIQUETA: "Etiqueta pronta para imprimir",
  POSTADO: "Postado — a caminho 🚚",
  ENTREGUE: "Entregue ✅",
  CANCELADO: "Etiqueta cancelada",
};

export function EnvioFrete({
  orderId,
  customerName,
  hasZip,
  canBuy,
  isCancelled,
  initialShipping,
}: {
  orderId: string;
  customerName: string;
  hasZip: boolean;
  canBuy: boolean;
  isCancelled: boolean;
  initialShipping: Ship;
}) {
  const router = useRouter();
  const [ship, setShip] = useState<Ship>(initialShipping);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [recusadas, setRecusadas] = useState<Recusa[]>([]);
  // situação da nota NA HORA DA COTAÇÃO (a tela pode estar aberta desde antes
  // de a nota ser emitida — prometer o documento errado é pior que não dizer)
  const [temNota, setTemNota] = useState(false);
  // o servidor recusou a compra por causa da nota e ofereceu seguir sem ela
  const [podeSemNota, setPodeSemNota] = useState(false);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [busy, setBusy] = useState<
    "cotar" | "comprar" | "cancelar" | "rastreio" | "etiqueta" | "enviar" | null
  >(null);
  const [erro, setErro] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [linkRastreio, setLinkRastreio] = useState<string | null>(null);

  const comprado = Boolean(ship?.meOrderId && ship.meStatus !== "CANCELADO");

  // busca o link de rastreio assim que há envio: o botão de copiar precisa
  // dele PRONTO (ver copiarLink) e a chamada é barata
  useEffect(() => {
    if (!comprado) return;
    let vivo = true;
    fetch(`/api/orders/${orderId}/rastreio`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.url) setLinkRastreio(d.url);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [comprado, orderId]);

  async function acao(body: Record<string, unknown>) {
    const res = await fetch(`/api/orders/${orderId}/frete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, d };
  }

  async function cotar() {
    setBusy("cotar");
    setErro("");
    const { ok, d } = await acao({ action: "cotar" });
    setBusy(null);
    if (!ok) {
      // Cotação velha na tela = preço velho no botão "Comprar etiqueta" (o
      // servidor recotaria e cobraria outro valor da carteira). Falhou, limpa.
      setQuotes(null);
      setRecusadas([]);
      setEscolhido(null);
      return setErro(d.error ?? "Não foi possível cotar o frete.");
    }
    setQuotes(d.quotes ?? []);
    setRecusadas(Array.isArray(d.recusadas) ? d.recusadas : []);
    setTemNota(Boolean(d.comNota));
    setWeightKg(d.weightKg ?? null);
    setEscolhido(d.quotes?.[0]?.serviceId ?? null);
  }

  async function comprar(semNota = false) {
    const q = quotes?.find((x) => x.serviceId === escolhido);
    if (!q) return;
    const doc = semNota || !temNota ? "declaração de conteúdo" : "NF-e";
    if (
      !window.confirm(
        `Comprar a etiqueta ${q.carrier} ${q.service} por ${brl(q.price)} (com ${doc})? O valor sai do saldo da carteira Melhor Envio da loja.`
      )
    )
      return;
    setBusy("comprar");
    setErro("");
    const { ok, d } = await acao({
      action: "comprar",
      serviceId: q.serviceId,
      service: q.service,
      carrier: q.carrier,
      ...(semNota ? { semNota: true } : {}),
    });
    setBusy(null);
    if (!ok) {
      setPodeSemNota(Boolean(d.podeSemNota));
      return setErro(d.error ?? "Não foi possível comprar a etiqueta.");
    }
    setShip(d.shipping);
    setQuotes(null);
    setRecusadas([]);
    setPodeSemNota(false);
    router.refresh();
  }

  async function cancelar() {
    if (
      !window.confirm(
        "Cancelar esta etiqueta? Só funciona antes de postar a caixa — o valor volta para a carteira Melhor Envio."
      )
    )
      return;
    setBusy("cancelar");
    setErro("");
    const { ok, d } = await acao({ action: "cancelar" });
    setBusy(null);
    if (!ok) return setErro(d.error ?? "Não foi possível cancelar.");
    setShip(d.shipping);
    router.refresh();
  }

  async function abrirEtiqueta() {
    // o link do ME expira; pede um novo na hora de imprimir
    setBusy("etiqueta");
    setErro("");
    const { ok, d } = await acao({ action: "etiqueta" });
    setBusy(null);
    if (!ok) return setErro(d.error ?? "Não foi possível abrir a etiqueta.");
    window.open(d.url, "_blank", "noopener");
  }

  async function atualizarRastreio() {
    setBusy("rastreio");
    const res = await fetch(`/api/orders/${orderId}/frete`);
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok && d.shipping) {
      setShip(d.shipping);
      router.refresh();
    }
  }

  async function copiarCodigo() {
    if (!ship?.trackingCode) return;
    await copiarTexto(ship.trackingCode);
    setCopied("code");
    setTimeout(() => setCopied(null), 2000);
  }

  /**
   * Copia o LINK que a cliente abre (funciona mesmo sem WhatsApp na ficha).
   * O link é buscado ASSIM QUE o painel abre e guardado aqui: no iPhone, um
   * `await fetch` antes de escrever na área de transferência faz o navegador
   * perder o "gesto do usuário" e a cópia é recusada em silêncio.
   */
  async function copiarLink() {
    setErro("");
    if (!linkRastreio) return setErro("Ainda estou gerando o link — tente de novo em 1 segundo.");
    const deu = await copiarTexto(linkRastreio);
    if (!deu) return setErro("Não consegui copiar. Segure o link e copie à mão.");
    setCopied("link");
    setTimeout(() => setCopied(null), 2000);
  }

  /** Manda o link no WhatsApp da cliente pela conexão da loja (um clique). */
  async function enviarNoWhatsapp() {
    setBusy("enviar");
    setErro("");
    const res = await fetch(`/api/orders/${orderId}/rastreio`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setErro(d.error ?? "Não foi possível enviar agora.");
    setEnviado(true);
    setTimeout(() => setEnviado(false), 4000);
    router.refresh();
  }

  return (
    <Card className="p-5 mb-4">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <Truck className="size-4 text-orange-600" />
        Envio (Melhor Envio)
      </h2>

      {comprado ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold">
              {ship?.meCarrier} {ship?.meService}
            </span>
            {ship?.mePrice != null && (
              <span className="text-gray-500">— etiqueta {brl(ship.mePrice)}</span>
            )}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                ship?.meStatus === "ENTREGUE"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : ship?.meStatus === "POSTADO"
                    ? "bg-sky-50 text-sky-700 border-sky-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {statusLabel[ship?.meStatus ?? ""] ?? ship?.meStatus}
            </span>
            <button
              onClick={atualizarRastreio}
              disabled={busy === "rastreio"}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              title="Atualizar situação"
            >
              {busy === "rastreio" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCcw className="size-3" />
              )}
              atualizar
            </button>
          </div>

          {/* RASTREIO PARA A CLIENTE: um clique manda o link no WhatsApp
              dela (pela conexão da loja, fica registrado na conversa) — sem
              copiar, colar e procurar a conversa. */}
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
            <p className="mb-2 text-xs font-medium text-emerald-900">
              📦 Mandar o acompanhamento para {customerName.split(" ")[0]}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={enviarNoWhatsapp}
                disabled={busy === "enviar"}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy === "enviar" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : enviado ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <MessageCircle className="size-4" />
                )}
                {enviado ? "Enviado!" : "Enviar rastreio no WhatsApp"}
              </button>
              <button
                onClick={copiarLink}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-300"
              >
                {copied === "link" ? (
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied === "link" ? "Copiado!" : "Copiar link"}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-emerald-800/70">
              A cliente clica e vê em que pé está a entrega — sem login, sem
              precisar entender código dos Correios.
            </p>
          </div>

          {ship?.trackingCode ? (
            <div className="flex items-center gap-2 flex-wrap">
              <code className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-xs font-semibold tracking-wide">
                {ship.trackingCode}
              </code>
              <button
                onClick={copiarCodigo}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:border-gray-300 text-gray-600 text-xs font-medium px-2.5 py-1.5"
              >
                {copied === "code" ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                {copied === "code" ? "Copiado!" : "Copiar código"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              O código de rastreio aparece minutos depois da compra — clique em
              &quot;atualizar&quot;.
            </p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={abrirEtiqueta}
              disabled={busy === "etiqueta"}
              className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
            >
              {busy === "etiqueta" ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              Imprimir etiqueta
            </button>
            {ship?.nfeKey ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-medium px-4 py-2.5"
                title={`Chave de acesso: ${ship.nfeKey}`}
              >
                <FileText className="size-4" />
                Etiqueta com NF-e
              </span>
            ) : (
              <a
                href={`/declaracao/${orderId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-gray-300 text-gray-600 text-sm font-medium px-4 py-2.5 transition"
              >
                <FileText className="size-4" />
                Declaração de conteúdo
              </a>
            )}
            {canBuy && ship?.meStatus === "ETIQUETA" && (
              <button
                onClick={cancelar}
                disabled={busy === "cancelar"}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
              >
                {busy === "cancelar" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                Cancelar etiqueta
              </button>
            )}
          </div>
        </div>
      ) : isCancelled ? (
        <p className="text-sm text-gray-400">Pedido cancelado — sem envio.</p>
      ) : !hasZip ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          Preencha o <b>endereço com CEP</b> no cadastro do cliente para cotar o
          frete.
        </p>
      ) : quotes ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Cotação para <b>{weightKg} kg</b> (peso das peças + caixa padrão da
            loja).{quotes.length > 0 && " Escolha o serviço:"}
          </p>
          {quotes.map((q) => (
            <label
              key={q.serviceId}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                escolhido === q.serviceId
                  ? "border-orange-400 bg-orange-50/60"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="frete"
                checked={escolhido === q.serviceId}
                onChange={() => setEscolhido(q.serviceId)}
                className="accent-orange-600"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {q.carrierLogo && (
                <img src={q.carrierLogo} alt={q.carrier} className="h-5 w-auto" />
              )}
              <span className="flex-1 min-w-0 text-sm">
                <b>{q.carrier}</b> {q.service}
                {q.days != null && (
                  <span className="text-gray-400"> · até {q.days} dias úteis</span>
                )}
              </span>
              <span className="text-sm font-semibold tabular-nums">{brl(q.price)}</span>
            </label>
          ))}
          <p className="text-xs text-gray-500">
            {temNota ? (
              <>
                📄 A etiqueta vai sair <b>com a NF-e</b> (chave de acesso na
                etiqueta) — sem declaração de conteúdo.
              </>
            ) : (
              <>
                📄 A etiqueta vai sair com <b>declaração de conteúdo</b>. Para
                sair com a NF-e, emita a nota deste pedido antes de comprar.
              </>
            )}
          </p>
          {recusadas.length > 0 && (
            <details className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-gray-600">
                {recusadas.length}{" "}
                {recusadas.length === 1
                  ? "transportadora não cotou"
                  : "transportadoras não cotaram"}{" "}
                — ver o motivo
              </summary>
              <ul className="mt-2 space-y-1.5">
                {recusadas.map((rec) => (
                  <li key={`${rec.carrier}-${rec.reason}`} className="text-xs text-gray-500">
                    <b className="text-gray-700">{rec.carrier}</b>
                    {rec.services.length > 0 && (
                      <span className="text-gray-400"> ({rec.services.join(", ")})</span>
                    )}
                    : {rec.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-400">
                Transportadora “não liberada” se resolve no painel do Melhor
                Envio (Gerenciar → Verificação de conta). Os Correios aceitam
                conta com CPF; as demais costumam exigir a conta verificada.
              </p>
            </details>
          )}
          {quotes.length === 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              Nenhuma transportadora cotou este envio. Veja o motivo de cada uma
              acima.
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            {canBuy && quotes.length > 0 ? (
              <button
                onClick={() => comprar()}
                disabled={busy === "comprar" || !escolhido}
                className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
              >
                {busy === "comprar" ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
                Comprar etiqueta
              </button>
            ) : quotes.length > 0 ? (
              <p className="text-xs text-gray-400">
                Peça a um gerente ou admin para comprar a etiqueta.
              </p>
            ) : null}
            <button
              onClick={cotar}
              disabled={busy === "cotar"}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
            >
              <RefreshCcw className="size-3" /> cotar de novo
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={cotar}
          disabled={busy === "cotar"}
          className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
        >
          {busy === "cotar" ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
          Cotar frete (Correios e transportadoras)
        </button>
      )}

      {erro && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{erro}</p>
          {podeSemNota && canBuy && (
            <button
              onClick={() => comprar(true)}
              disabled={busy === "comprar"}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-gray-300 text-gray-600 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              <FileText className="size-3.5" />
              Comprar mesmo assim, com declaração de conteúdo
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
