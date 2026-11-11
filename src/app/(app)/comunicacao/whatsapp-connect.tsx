"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Conexão do WhatsApp da loja SEM API oficial (estilo WhatsApp Web):
 * termo de aceite obrigatório → QR Code → conectado. Enquanto o QR está na
 * tela, o estado E O CÓDIGO são consultados a cada poucos segundos: o
 * WhatsApp troca o código a cada ~20 s, e a tela mostrava para sempre o do
 * clique (RN-110).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Power,
  QrCode,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Card } from "@/components/ui";
import { CONFIRMACAO_DO_REINICIO, pedirReinicio, type ResultadoNaTela } from "@/lib/reinicio-da-conexao-tela";
import { FRASE_DO_QR_VENCIDO, MS_ENTRE_CONSULTAS_DO_QR, passoDaTentativa } from "@/lib/qr-da-conexao";

type Estado = {
  serverConfigured: boolean;
  consent: { userName: string; acceptedAt: string } | null;
  termo: { texto: string; versao: string } | null;
  status: "DESCONECTADO" | "AGUARDANDO_QR" | "CONECTADO";
  phone: string | null;
  // o servidor aceitou a lista ATUAL de eventos? (edição/apagar dependem dela)
  eventos?: { emDia: boolean; erro: string | null } | null;
  servidorVersao?: string | null;
  // RN-105: o servidor diz "conectado", mas a conexão com o celular caiu
  sessaoCaida?: boolean;
  // RN-110: o QR Code de agora (só quando a tela pede, esperando a leitura)
  qr?: string | null;
  limites: { janelaHoras: number; ritmoMinSeg: number; ritmoMaxSeg: number; enviadosHoje: number };
};

export function WhatsappConnect({ canEdit }: { canEdit: boolean }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aceito, setAceito] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  // RN-105: o resultado do "Reiniciar conexão", dito na tela
  const [reinicio, setReinicio] = useState<ResultadoNaTela | null>(null);
  // RN-110: a tentativa venceu (o servidor fechou sem a conexão completar)
  const [venceu, setVenceu] = useState(false);
  // quantas vezes o código já foi trocado nesta tentativa (a tela diz que ele se renova)
  const [trocas, setTrocas] = useState(0);
  // a tentativa em curso, fora do estado: a consulta lê o valor de AGORA
  const tentativa = useRef<{ qr: string; fechadas: number } | null>(null);
  // uma consulta por vez: a resposta pode demorar mais que o intervalo
  const emVoo = useRef(false);

  const carregar = useCallback(async () => {
    const esperando = tentativa.current != null;
    const res = await fetch(esperando ? "/api/whatsapp/evolution?qr=1" : "/api/whatsapp/evolution");
    if (res.ok) {
      const d: Estado = await res.json();
      setEstado(d);
      const atual = tentativa.current;
      if (!atual) {
        if (d.status === "CONECTADO") setQr(null);
        return d;
      }
      const passo = passoDaTentativa(atual, d);
      if (passo.fim) {
        tentativa.current = null;
        setQr(null);
        setVenceu(passo.fim === "venceu");
      } else {
        tentativa.current = passo.tentativa;
        if (passo.trocou) {
          setQr(passo.tentativa.qr);
          setTrocas((n) => n + 1);
        }
      }
      return d;
    }
    return null;
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // enquanto o QR está na tela, consulta o estado e o CÓDIGO DE AGORA
  const esperandoLeitura = qr != null;
  useEffect(() => {
    if (!esperandoLeitura) return;
    const id = setInterval(async () => {
      if (emVoo.current) return;
      emVoo.current = true;
      try {
        await carregar();
      } catch {
        // sem internet por um instante: a próxima consulta tenta de novo
      } finally {
        emVoo.current = false;
      }
    }, MS_ENTRE_CONSULTAS_DO_QR);
    return () => clearInterval(id);
  }, [esperandoLeitura, carregar]);

  /** Põe um QR Code na tela e começa a acompanhar a tentativa. */
  function mostrarQr(codigo: string) {
    tentativa.current = { qr: codigo, fechadas: 0 };
    setVenceu(false);
    setTrocas(0);
    setQr(codigo);
  }

  async function aceitarTermo() {
    setBusy(true);
    setErro("");
    const res = await fetch("/api/whatsapp/evolution/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aceito: true }),
    });
    setBusy(false);
    if (res.ok) carregar();
    else setErro((await res.json().catch(() => ({}))).error ?? "Não foi possível registrar o aceite.");
  }

  async function conectar(recriar = false) {
    setBusy(true);
    setErro("");
    const res = await fetch("/api/whatsapp/evolution/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recriar }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && d.qr) mostrarQr(d.qr);
    else if (d.perguntarRecriar && !recriar) {
      // RN-105: sem prova de que a sessão está viva ou morta, quem decide
      // derrubá-la é a pessoa — avisada de que vai pedir o QR Code de novo
      if (window.confirm(`${d.error}\n\nRecriar a conexão agora?`)) await conectar(true);
      else setErro(d.error);
    } else {
      setErro(d.error ?? "Não foi possível gerar o QR Code.");
      // já conectada (RN-105): a tela volta ao ramo "Conectado", com o
      // Reiniciar e o Desconectar — senão o Conectar virava beco
      if (d.jaConectado) await carregar();
    }
  }

  // RN-105: a loja "conectada, mas muda" se reinicia daqui — a sessão salva
  // é reaproveitada (em geral sem QR) e os avisos são reaplicados
  async function reiniciar() {
    if (!window.confirm(`Reiniciar a conexão do WhatsApp? ${CONFIRMACAO_DO_REINICIO}`)) return;
    setBusy(true);
    setReinicio(null);
    setReinicio(await pedirReinicio("/api/whatsapp/evolution/reiniciar"));
    setBusy(false);
    carregar();
  }

  async function desconectar() {
    if (
      !window.confirm(
        "Desconectar o WhatsApp da loja? As mensagens novas deixam de entrar no sistema até conectar de novo."
      )
    )
      return;
    setBusy(true);
    await fetch("/api/whatsapp/evolution/disconnect", { method: "POST" });
    tentativa.current = null;
    setQr(null);
    setBusy(false);
    carregar();
  }

  if (!estado) {
    return (
      <Card className="p-5 mb-5">
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin" />
          Carregando conexão do WhatsApp…
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 mb-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <MessageCircle className="size-4 text-emerald-600" />
          WhatsApp da loja — conexão rápida (sem API oficial)
        </h2>
        {estado.status === "CONECTADO" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1">
            <CheckCircle2 className="size-3.5" />
            Conectado{estado.phone ? ` · ${estado.phone}` : ""}
          </span>
        )}
      </div>
      {/* RN-105: o resultado do reinício fica FORA do ramo de status — o reinício
          que deixa a sessão em "connecting"/"close" troca o ramo no recarregar,
          e a frase que manda ler o QR sumiria junto (achado da revisão) */}
      {reinicio && (
        <p
          className={`mb-3 rounded-xl border p-3 text-sm ${
            reinicio.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          role="status"
        >
          {reinicio.mensagem}
        </p>
      )}
      {estado.sessaoCaida && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
          O servidor diz que está conectado, mas a conexão com o celular da loja caiu: as mensagens não
          entram nem saem. Toque em <b>Conectar WhatsApp (QR Code)</b> e leia o código com o celular da
          loja. As conversas antigas continuam aqui.
        </p>
      )}
      <p className="text-sm text-gray-500 mb-4">
        Conecte o número da loja pelo QR Code (como o WhatsApp Web). As mensagens
        dos clientes viram leads no funil automaticamente, com vendedor
        distribuído e tarefa de atendimento — e as respostas saem daqui do
        sistema.
      </p>

      {!estado.serverConfigured ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm p-3">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          O servidor de conexão ainda não foi ativado pela plataforma. Assim que
          for, o botão de conectar aparece aqui — nada mais muda.
        </p>
      ) : !estado.consent ? (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
            Termo de uso — leia antes de conectar
          </p>
          <pre className="whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-[12px] leading-relaxed text-gray-700 max-h-64 overflow-y-auto thin-scroll mb-3">
            {estado.termo?.texto}
          </pre>
          {canEdit ? (
            <>
              <label className="flex items-start gap-2 text-sm text-gray-700 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceito}
                  onChange={(e) => setAceito(e.target.checked)}
                  className="size-4 accent-emerald-600 mt-0.5"
                />
                Li e aceito o termo. Estou ciente de que a conexão não oficial
                pode resultar em bloqueio do número pela Meta, inclusive sem
                aviso prévio.
              </label>
              <button
                onClick={aceitarTermo}
                disabled={!aceito || busy}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-50"
              >
                {busy ? "Registrando…" : "Aceitar e continuar"}
              </button>
            </>
          ) : (
            <p className="text-xs text-gray-400">
              Somente o administrador da loja pode aceitar o termo e conectar.
            </p>
          )}
        </div>
      ) : estado.status === "CONECTADO" ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">
            Enviadas hoje: <b>{estado.limites.enviadosHoje}</b> · resposta a
            quem te chamou sai na hora; envio proativo sai com ritmo humano de{" "}
            {estado.limites.ritmoMinSeg}–{estado.limites.ritmoMaxSeg}s (protege
            o número, sem travar o atendimento) · termo aceito por{" "}
            {estado.consent.userName}
            {estado.servidorVersao ? ` · servidor v${estado.servidorVersao}` : ""}
          </p>
          {estado.eventos && (
            <p
              className={`w-full text-xs ${estado.eventos.emDia ? "text-emerald-700" : "text-rose-600"}`}
            >
              {estado.eventos.emDia
                ? "✅ Avisos do WhatsApp em dia: mensagem editada e apagada pela cliente chegam na Central."
                : `⚠️ O servidor do WhatsApp recusou a lista atual de avisos (${estado.eventos.erro ?? "sem detalhe"}). Mensagem editada pela cliente pode não atualizar na Central até isso ser resolvido.`}
            </p>
          )}
          {canEdit && (
            <button
              onClick={reiniciar}
              disabled={busy}
              title="Use quando as mensagens das clientes pararam de entrar"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 hover:bg-gray-50 transition disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
              Reiniciar conexão
            </button>
          )}
          {canEdit && (
            <button
              onClick={desconectar}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              <Power className="size-3.5" />
              Desconectar
            </button>
          )}
        </div>
      ) : (
        <div>
          {qr ? (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <img
                src={qr}
                alt="QR Code de conexão do WhatsApp"
                className="size-52 rounded-xl border border-gray-200 bg-white p-2"
              />
              <ol className="text-sm text-gray-600 space-y-1.5">
                <li>1. Abra o <b>WhatsApp</b> no celular da loja</li>
                <li>2. Toque em <b>⋮ → Dispositivos conectados</b></li>
                <li>3. Toque em <b>Conectar dispositivo</b></li>
                <li>4. Aponte a câmera para este código</li>
                <li className="text-xs text-gray-400 pt-1" role="status">
                  <Loader2 className="inline size-3 animate-spin mr-1" />
                  Aguardando leitura… o código se renova sozinho a cada poucos segundos
                  {trocas > 0 ? ` (renovado ${trocas}×)` : ""}. Leia sempre o que está na tela agora.
                </li>
              </ol>
            </div>
          ) : (
            canEdit && (
              <>
              {venceu && (
                <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
                  {FRASE_DO_QR_VENCIDO}
                </p>
              )}
              <button
                onClick={() => conectar()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <QrCode className="size-4" />
                )}
                {busy ? "Gerando QR Code…" : venceu ? "Gerar código novo" : "Conectar WhatsApp (QR Code)"}
              </button>
              </>
            )
          )}
          <p className="text-[11px] text-gray-400 mt-3 leading-snug">
            💡 Recomendação: use um número <b>dedicado à loja</b> (não o
            pessoal). Número novo deve ser usado normalmente no aplicativo por
            1–2 semanas antes de conectar.
          </p>
        </div>
      )}
      {erro && (
        <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-3">{erro}</p>
      )}
    </Card>
  );
}
