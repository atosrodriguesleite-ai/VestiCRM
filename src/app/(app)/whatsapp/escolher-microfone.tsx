"use client";

import { useState } from "react";
import { Mic, ChevronDown, Check, Loader2 } from "lucide-react";
import { nomeCurtoDoMicrofone } from "@/lib/microfone";

/**
 * ESCOLHER DE QUAL MICROFONE VEM O ÁUDIO.
 *
 * "Estou usando o headset, mas o som sai do microfone do computador"
 * (26/08/2026). O sistema pedia o microfone sem dizer qual, e quem decidia
 * era o "dispositivo padrão" do Windows — plugar o headset não muda esse
 * padrão sozinho. Pior: a barra de gravação nunca disse de onde vinha o som,
 * então a vendedora só descobria depois de a cliente reclamar do áudio.
 *
 * Aqui ela escolhe dentro do sistema, sem passar pelas configurações do
 * computador, e a escolha fica guardada NAQUELE aparelho.
 *
 * O nome dos microfones só existe DEPOIS de a pessoa autorizar o microfone —
 * antes disso o navegador devolve a lista sem nomes, de propósito (é o que
 * impede um site de identificar o computador de quem entra). Por isso, ao
 * abrir a lista, o componente pede a autorização e fecha o microfone em
 * seguida: só para conseguir ler os nomes.
 */
export function EscolherMicrofone({
  escolhidoId,
  onEscolher,
  onGravar,
  gravando,
}: {
  escolhidoId: string | null;
  onEscolher: (id: string | null, rotulo: string) => void;
  /** o toque no microfone: começa a gravar */
  onGravar: () => void;
  gravando: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<MediaDeviceInfo[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function abrir() {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    setErro("");
    setCarregando(true);
    try {
      // pede autorização SÓ para conseguir os nomes, e devolve o microfone
      // logo em seguida (nada é gravado aqui)
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      const todos = await navigator.mediaDevices.enumerateDevices();
      setLista(todos.filter((d) => d.kind === "audioinput"));
    } catch {
      setErro(
        "Não consegui ver os microfones. Autorize o microfone no cadeado da barra de endereço e tente de novo."
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    // UM MICROFONE SÓ na barra (pedido do dono, 26/08/2026): o ícone grava e a
    // setinha colada nele abre a lista. Eram dois botões separados e ficava
    // parecendo dois microfones.
    //
    // `z-40` deixa o controle POR CIMA do fundo que fecha a lista: com a lista
    // aberta, tocar no microfone grava direto em vez de o toque morrer no
    // fundo invisível e exigir um segundo toque (achado da revisão).
    <div className="relative z-40 flex items-center rounded-lg transition hover:bg-gray-50">
      <button
        type="button"
        onClick={() => {
          setAberto(false);
          onGravar();
        }}
        disabled={gravando}
        className="py-2 pl-2 pr-0.5 text-gray-400 transition hover:text-emerald-600 disabled:opacity-40"
        title="Gravar áudio"
      >
        <Mic className="size-4.5" />
      </button>
      {/* A SETINHA PRECISA SER VISÍVEL E DAR PARA ACERTAR COM O DEDO: é a
          única porta para trocar o microfone. Nasceu cinza-clara demais e
          colada no botão de gravar — no celular, errar o toque começava uma
          gravação de verdade (achado da revisão). */}
      <button
        type="button"
        onClick={abrir}
        disabled={gravando}
        className={`py-2.5 pl-1 pr-2 transition disabled:opacity-40 ${
          aberto ? "text-brand-600" : "text-gray-400 hover:text-brand-600"
        }`}
        title="Escolher o microfone"
        aria-label="Escolher o microfone"
      >
        <ChevronDown className="size-3.5" />
      </button>

      {aberto && (
        <>
          {/* fundo que fecha ao tocar fora */}
          <div className="fixed inset-0 z-30" onClick={() => setAberto(false)} />
          <div className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-pop">
            <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Gravar com qual microfone
            </p>

            {carregando && (
              <p className="flex items-center gap-2 px-2 py-3 text-xs text-gray-500">
                <Loader2 className="size-3.5 animate-spin" />
                Procurando…
              </p>
            )}

            {erro && <p className="px-2 py-2 text-[11px] leading-snug text-rose-600">{erro}</p>}

            {!carregando && !erro && lista && (
              <>
                <Opcao
                  rotulo="Padrão do computador"
                  detalhe="o que o Windows estiver usando"
                  ativo={escolhidoId === null}
                  onClick={() => {
                    onEscolher(null, "");
                    setAberto(false);
                  }}
                />
                {lista
                  // o Chrome repete o mesmo microfone como "default"/"communications"
                  .filter((d) => d.deviceId !== "default" && d.deviceId !== "communications")
                  .map((d) => (
                    <Opcao
                      key={d.deviceId}
                      rotulo={nomeCurtoDoMicrofone(d.label)}
                      detalhe={d.label && d.label !== nomeCurtoDoMicrofone(d.label) ? d.label : undefined}
                      ativo={escolhidoId === d.deviceId}
                      onClick={() => {
                        onEscolher(d.deviceId, d.label);
                        setAberto(false);
                      }}
                    />
                  ))}
                {lista.length === 0 && (
                  <p className="px-2 py-3 text-xs text-gray-500">
                    Nenhum microfone encontrado neste computador.
                  </p>
                )}
                <p className="mt-1 border-t border-gray-100 px-2 pb-1 pt-2 text-[11px] leading-snug text-gray-400">
                  Plugou o headset agora? Feche e abra esta lista para ele aparecer.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Opcao({
  rotulo,
  detalhe,
  ativo,
  onClick,
}: {
  rotulo: string;
  detalhe?: string;
  ativo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-gray-50 ${
        ativo ? "bg-brand-50" : ""
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${ativo ? "font-semibold text-brand-800" : "text-gray-700"}`}>
          {rotulo}
        </span>
        {detalhe && <span className="block truncate text-[11px] text-gray-400">{detalhe}</span>}
      </span>
      {ativo && <Check className="size-4 shrink-0 text-brand-600" />}
    </button>
  );
}
