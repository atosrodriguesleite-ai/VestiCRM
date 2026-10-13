"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui";
import {
  HORARIO_SUGERIDO,
  NOMES_DOS_DIAS,
  type HorarioComercial,
  type Intervalo,
} from "@/lib/bi/horario-comercial";

/** segunda a domingo, a ordem em que a loja pensa a semana */
const ORDEM = [1, 2, 3, 4, 5, 6, 0];

/**
 * O campo de hora do navegador não mostra nem produz "24:00"; a loja aberta
 * até meia-noite é gravada como 24:00 (fim do dia) e aparece aqui como
 * 23:59 — na gravação volta a 24:00. Sem isso o campo ficava em branco e a
 * loja não conseguia salvar o horário de novo (achado da revisão).
 */
const paraTela = (i: Intervalo): Intervalo => (i.ate === "24:00" ? { ...i, ate: "23:59" } : { ...i });
const paraGravar = (i: Intervalo): Intervalo => (i.ate === "23:59" ? { ...i, ate: "24:00" } : { ...i });
/** o "+ pausa de almoço" só faz sentido num período que atravessa o almoço */
const atravessaOAlmoco = (i: Intervalo) => i.de < "12:00" && i.ate > "13:00";

type Props = {
  canEdit: boolean;
  /** o que está gravado; nulo = sem horário (conta o dia inteiro) */
  initial: HorarioComercial | null;
  /** prazo de resposta da loja (Entrada de leads), em minutos */
  prazoMin: number;
};

/**
 * HORÁRIO DE ATENDIMENTO (RN-079): quando a loja está aberta, por dia da
 * semana, com até dois períodos (manhã e tarde). É o relógio do tempo de
 * resposta do BI — e sem ele a conta inclui a madrugada.
 */
export function HorarioComercialCard({ canEdit, initial, prazoMin }: Props) {
  const router = useRouter();
  const [cadastrado, setCadastrado] = useState(initial !== null);
  const [dias, setDias] = useState<Intervalo[][]>(
    (initial ?? HORARIO_SUGERIDO).dias.map((d) => d.map(paraTela))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function mudar(dia: number, fn: (lista: Intervalo[]) => Intervalo[]) {
    setDias((atual) => atual.map((lista, i) => (i === dia ? fn(lista) : lista)));
  }

  async function gravar(horario: HorarioComercial | null) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/horario-comercial", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          horario: horario ? { dias: horario.dias.map((d) => d.map(paraGravar)) } : null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Não foi possível salvar.");
        return;
      }
      setCadastrado(horario !== null);
      if (horario === null) setDias(HORARIO_SUGERIDO.dias.map((d) => d.map(paraTela)));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } catch {
      // sem internet o fetch estoura antes de qualquer resposta: o botão não
      // pode ficar preso em "Salvando..." (achado da revisão)
      setError("Sem conexão — confira a internet e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  const input =
    "rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white outline-none focus:border-brand-400 transition disabled:bg-gray-50 disabled:text-gray-400";

  return (
    <Card className="p-5">
      <p className="text-sm text-gray-500 flex items-start gap-2 mb-4">
        <Clock className="size-4 text-brand-600 shrink-0 mt-0.5" />
        <span>
          O tempo de resposta às clientes é contado <b>só enquanto a loja está aberta</b>:
          quem escreve às 22h e recebe resposta às 8h05 esperou 5 minutos, não 10 horas.
          O prazo de resposta é de <b>{prazoMin} min</b> com a loja aberta (campo “Prazo do 1º
          atendimento” em “Entrada de leads”, acima — quem muda é o admin).
        </span>
      </p>

      {!cadastrado && (
        <p className="text-xs rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 mb-4">
          Sem horário cadastrado: hoje o tempo de resposta conta o dia inteiro, madrugada
          inclusa. Confira a sugestão abaixo e salve.
        </p>
      )}

      <div className="space-y-2">
        {ORDEM.map((dia) => {
          const lista = dias[dia];
          const aberta = lista.length > 0;
          return (
            <div
              key={dia}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 px-3 py-2"
            >
              <label className="flex items-center gap-2 w-28 text-sm font-medium">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={aberta}
                  onChange={(e) =>
                    mudar(dia, () => (e.target.checked ? [{ de: "08:00", ate: "18:00" }] : []))
                  }
                />
                {NOMES_DOS_DIAS[dia]}
              </label>
              {!aberta && <span className="text-xs text-gray-400">fechada</span>}
              {lista.map((i, idx) => (
                <span key={idx} className="flex items-center gap-1 text-sm">
                  {idx > 0 && <span className="text-gray-400 text-xs mx-1">e</span>}
                  <input
                    type="time"
                    disabled={!canEdit}
                    value={i.de}
                    onChange={(e) =>
                      mudar(dia, (l) => l.map((x, j) => (j === idx ? { ...x, de: e.target.value } : x)))
                    }
                    className={input}
                  />
                  <span className="text-gray-400 text-xs">às</span>
                  <input
                    type="time"
                    disabled={!canEdit}
                    value={i.ate}
                    onChange={(e) =>
                      mudar(dia, (l) => l.map((x, j) => (j === idx ? { ...x, ate: e.target.value } : x)))
                    }
                    className={input}
                  />
                  {canEdit && idx > 0 && (
                    <button
                      type="button"
                      onClick={() => mudar(dia, (l) => l.filter((_, j) => j !== idx))}
                      className="text-xs text-gray-400 hover:text-red-600 px-1"
                      title="Tirar este período"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {canEdit && lista.length === 1 && atravessaOAlmoco(lista[0]) && (
                <button
                  type="button"
                  onClick={() =>
                    mudar(dia, (l) => [
                      { de: l[0].de, ate: "12:00" },
                      { de: "13:00", ate: l[0].ate },
                    ])
                  }
                  className="text-xs text-brand-700 hover:underline"
                >
                  + pausa de almoço (12h–13h)
                </button>
              )}
              {canEdit && lista.length === 1 && !atravessaOAlmoco(lista[0]) && lista[0].ate < "23:59" && (
                <button
                  type="button"
                  onClick={() =>
                    // um segundo período EM BRANCO para a pessoa preencher — se
                    // salvar sem preencher, a porta diz o dia e o formato
                    mudar(dia, (l) => [l[0], { de: "", ate: "" }])
                  }
                  className="text-xs text-brand-700 hover:underline"
                >
                  + 2º período
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            onClick={() => gravar({ dias })}
            disabled={saving}
            className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-60"
          >
            {saving ? "Salvando..." : saved ? "Salvo ✓" : "Salvar horário"}
          </button>
          {cadastrado && (
            <button
              onClick={() => gravar(null)}
              disabled={saving}
              className="text-sm text-gray-500 hover:text-red-600"
            >
              Remover horário (voltar a contar o dia inteiro)
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
