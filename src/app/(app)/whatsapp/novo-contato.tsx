"use client";

import { useState } from "react";
import { Loader2, MessageCircle, UserPlus, X } from "lucide-react";
import { Portal } from "@/components/portal";
import { mascaraTelefoneBR } from "@/lib/format";
import { avisoDaRecusa } from "@/lib/sessao";
import {
  digitosDoTelefone,
  precisaConfirmarFicha,
  telefoneCompleto,
} from "@/lib/comm/novo-contato-regra";

/**
 * NOVO CONTATO NA CENTRAL — digitar o número, salvar e já chamar.
 *
 * Pedido do dono (23/09/2026): "quando recebo um número novo, não consigo
 * adicionar no sistema — somente se o cliente me chamar primeiro". A cliente
 * chega por indicação, cartão, Instagram… e a vendedora precisava esperar a
 * pessoa mandar mensagem para a conversa existir.
 *
 * Esta janela NÃO cria caminho novo — usa as duas portas de sempre:
 * - `POST /api/customers`: o cadastro manual, que passa pelo portão único de
 *   leads (RN-008: dedup tolerante ao 9º dígito — número já cadastrado NUNCA
 *   vira segunda ficha) e deixa o cliente na carteira de quem cadastrou;
 * - `POST /api/conversations`: a mesma porta do "Conversar no WhatsApp" da
 *   ficha do cliente — devolve a conversa aberta se já existe (a de colega
 *   fora do recorte responde COM QUEM está o atendimento, nunca abre por
 *   cima), reabre a encerrada no nome de quem abriu (histórico é sagrado)
 *   ou cria uma nova JÁ ASSUMIDA (não cai na fila: fila é lugar de cliente
 *   esperando).
 *
 * Quando o número JÁ ESTÁ no cadastro com OUTRO nome, a janela DIZ de quem é
 * antes de abrir (`precisaConfirmarFicha`) — sem isso, a vendedora digitava
 * "Ana" e via a conversa da "Maria" sem entender (o dedup da RN-008 preserva
 * o nome de verdade da ficha).
 *
 * A janela SÓ FECHA quando a conversa abriu de fato (`onAbrir` devolve se
 * conseguiu): fechar antes e engolir a falha deixava a vendedora com o
 * contato salvo e nada na tela — achado da revisão de 23/09/2026.
 */
export function NovoContato({
  onClose,
  onAbrir,
}: {
  onClose: () => void;
  /** abre a conversa na Central; devolve false quando não conseguiu */
  onAbrir: (conversationId: string) => Promise<boolean>;
}) {
  const [nome, setNome] = useState("");
  const [fone, setFone] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  // número já cadastrado com OUTRO nome: diz de quem é e espera o clique
  const [jaExistia, setJaExistia] = useState<{ nome: string; customerId: string } | null>(null);

  async function abrirConversaDe(customerId: string) {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        setSalvando(false);
        // aqui chega também o "já está em atendimento com Fulana" da porta
        setErro(avisoDaRecusa(res.status, data, "Não consegui abrir a conversa. Tente de novo."));
        return;
      }
      const abriu = await onAbrir(data.id as string);
      if (!abriu) {
        setSalvando(false);
        setErro("Não consegui abrir a conversa agora. Tente de novo.");
      }
    } catch {
      setSalvando(false);
      setErro("Sem conexão. Tente de novo.");
    }
  }

  async function salvar() {
    if (salvando) return;
    if (!nome.trim()) {
      setErro("Escreva o nome do contato.");
      return;
    }
    const digitos = digitosDoTelefone(fone);
    if (!telefoneCompleto(digitos)) {
      setErro("Telefone incompleto: escreva o DDD e o número todo.");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome.trim(), phone: digitos, origin: "MANUAL" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        setSalvando(false);
        setErro(avisoDaRecusa(res.status, data, "Não foi possível salvar o contato."));
        return;
      }
      // 200 = o número JÁ ESTAVA no cadastro (dedup da RN-008)
      const nomeDaFicha = typeof data.name === "string" ? data.name : nome.trim();
      if (precisaConfirmarFicha(res.status === 200, nomeDaFicha, nome)) {
        setSalvando(false);
        setJaExistia({ nome: nomeDaFicha, customerId: data.id as string });
        return;
      }
      await abrirConversaDe(data.id as string);
    } catch {
      setSalvando(false);
      setErro("Sem conexão. Tente de novo.");
    }
  }

  return (
    <Portal>
      {/* o par --kb/--kbtop é OBRIGATÓRIO em toda janela (a varredura do
          build confere): sem ele o teclado do celular cobre os campos */}
      <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center pb-[var(--kb,0px)] translate-y-[var(--kbtop,0px)]">
        <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
        <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll p-5 animate-fade-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-base flex items-center gap-2">
              <UserPlus className="size-4 text-emerald-500" />
              Novo contato
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" title="Fechar">
              <X className="size-5" />
            </button>
          </div>

          {jaExistia ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                Esse número <b>já está no cadastro</b> como{" "}
                <b>{jaExistia.nome}</b> — o sistema não cria a mesma pessoa
                duas vezes. Quer abrir a conversa dela?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => void abrirConversaDe(jaExistia.customerId)}
                  disabled={salvando}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-sm font-medium px-4 py-2.5 transition"
                >
                  {salvando ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
                  Abrir a conversa
                </button>
                <button
                  onClick={() => {
                    setJaExistia(null);
                    setErro("");
                  }}
                  className="rounded-xl border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2.5 hover:border-gray-300 transition"
                >
                  Voltar
                </button>
              </div>
              {erro && <p className="text-xs font-medium text-rose-600">{erro}</p>}
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                // Enter (o "ir" do teclado do celular) salva — sem o form, a
                // vendedora digitava e nada acontecia (achado da revisão)
                e.preventDefault();
                void salvar();
              }}
            >
              <div>
                <label className="block text-sm font-medium mb-1.5">Nome</label>
                <input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome da cliente"
                  autoFocus
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Telefone (WhatsApp)</label>
                <input
                  value={fone}
                  onChange={(e) => setFone(mascaraTelefoneBR(e.target.value))}
                  placeholder="(00) 00000-0000"
                  type="tel"
                  inputMode="tel"
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 transition"
                />
              </div>
              <p className="text-[11px] text-gray-400 leading-snug">
                O contato entra no cadastro de clientes na sua carteira e a
                conversa abre em seguida, pronta para a primeira mensagem.
              </p>
              {erro && <p className="text-xs font-medium text-rose-600">{erro}</p>}
              <button
                type="submit"
                disabled={salvando}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-sm font-medium px-4 py-2.5 transition"
              >
                {salvando ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
                Salvar e abrir a conversa
              </button>
            </form>
          )}
        </div>
      </div>
    </Portal>
  );
}
