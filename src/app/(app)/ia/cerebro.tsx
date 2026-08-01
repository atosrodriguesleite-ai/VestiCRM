"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brain, Sparkles, FileText, Shield } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * CÉREBRO DA IA — o que a loja ensina: tom de marca, roteiro comercial e
 * políticas. Grava desde já; quando a IA começar a responder (próxima
 * entrega), ela nasce treinada com o que estiver aqui.
 */

type Config = {
  tomDeMarca: string;
  roteiro: string;
  politicas: string;
  atendente: boolean;
  copilot: boolean;
  relatoriosAoDono: boolean;
};

const CAMPOS = [
  {
    key: "tomDeMarca" as const,
    icone: Sparkles,
    titulo: "Tom da marca",
    dica: "Como a sua marca fala com a cliente?",
    placeholder:
      "Ex.: Informal e carinhosa, chama a cliente de “amiga”, usa emoji com moderação, nunca pressiona. Sempre trata por “você”.",
  },
  {
    key: "roteiro" as const,
    icone: FileText,
    titulo: "Roteiro de venda",
    dica: "O passo a passo comercial que a equipe segue.",
    placeholder:
      "Ex.: 1) Cumprimenta e pergunta se é lojista. 2) Manda o link do catálogo. 3) Pergunta o que ela mais vende na loja dela. 4) Sugere as peças que mais giram. 5) Fecha o pedido e combina o envio.",
  },
  {
    key: "politicas" as const,
    icone: Shield,
    titulo: "Políticas da loja",
    dica: "As regras duras que a IA NUNCA pode passar por cima.",
    placeholder:
      "Ex.: Pedido mínimo de 10 peças. Desconto máximo de 5% e só acima de R$ 1.000. Troca apenas por defeito, em até 7 dias. Não parcelamos no boleto.",
  },
];

export function CerebroDaIa({ inicial }: { inicial: Config }) {
  const router = useRouter();
  const [form, setForm] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const res = await fetch("/api/ia/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tomDeMarca: form.tomDeMarca,
        roteiro: form.roteiro,
        politicas: form.politicas,
      }),
    });
    setSalvando(false);
    if (res.ok) {
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setErro(data.error ?? "Não foi possível salvar. Tente de novo.");
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Brain className="size-4 text-brand-600" />
        Cérebro da IA
      </h2>
      <p className="text-[11px] text-gray-400 mb-4">
        Tudo que você escrever aqui vira o treinamento da IA. Escreva como
        explicaria para uma vendedora nova no primeiro dia.
      </p>

      <div className="grid lg:grid-cols-3 gap-4">
        {CAMPOS.map((c) => (
          <div key={c.key}>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-1">
              <c.icone className="size-3.5 text-brand-500" />
              {c.titulo}
            </label>
            <p className="text-[11px] text-gray-400 mb-1.5">{c.dica}</p>
            <textarea
              value={form[c.key]}
              onChange={(e) => setForm({ ...form, [c.key]: e.target.value })}
              placeholder={c.placeholder}
              rows={7}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm leading-snug outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 placeholder:text-gray-300"
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar treinamento"}
        </button>
        {salvo && <span className="text-sm text-emerald-600">Salvo ✓</span>}
        {erro && <span className="text-sm text-rose-600">{erro}</span>}
      </div>

      {/* as chaves que chegam com as próximas entregas — já visíveis para a
          loja saber o que vem, mas sem promessa falsa de que já funcionam */}
      <div className="mt-5 grid sm:grid-cols-3 gap-3">
        {[
          {
            titulo: "🤖 Atendente automática",
            texto: "A IA responde as clientes sozinha, com botão de assumir a conversa.",
          },
          {
            titulo: "🧑‍✈️ Modo Copilot",
            texto: "A IA acompanha a conversa e sugere a resposta para a vendedora.",
          },
          {
            titulo: "📈 Relatórios de acompanhamento",
            texto: "Leitura mensal da operação, preparada pela plataforma.",
          },
        ].map((b) => (
          <div
            key={b.titulo}
            className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-3 py-2.5"
          >
            <p className="text-xs font-semibold text-gray-500">
              {b.titulo}{" "}
              <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-600">
                em breve
              </span>
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{b.texto}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
