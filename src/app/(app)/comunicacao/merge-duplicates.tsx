"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, Loader2, CheckCircle2, Merge } from "lucide-react";
import { Card } from "@/components/ui";

type Preview = { gruposDuplicados: number; cadastrosARemover: number };

/**
 * Limpeza de contatos duplicados (mesmo número com/sem o 9º dígito). Mostra a
 * prévia e, com um clique, unifica — sem perder histórico (mensagens, pedidos).
 */
export function MergeDuplicates() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Preview | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/comm/merge-duplicates");
    if (res.ok) setPreview(await res.json());
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function unificar() {
    if (
      !window.confirm(
        "Unificar os contatos duplicados? As conversas e o histórico do mesmo número viram um cadastro só. Não dá para desfazer."
      )
    )
      return;
    setBusy(true);
    const res = await fetch("/api/comm/merge-duplicates", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      setDone(await res.json());
      setPreview({ gruposDuplicados: 0, cadastrosARemover: 0 });
    } else {
      alert("Não foi possível unificar agora. Tente de novo em instantes.");
    }
  }

  // nada a fazer e nada feito ainda: não polui a tela
  if (!preview) return null;
  const temDuplicados = preview.gruposDuplicados > 0;
  if (!temDuplicados && !done) return null;

  return (
    <Card className="p-5 mb-5">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Users className="size-4 text-brand-600" />
        Contatos duplicados
      </h2>

      {done ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
          <CheckCircle2 className="size-4 shrink-0" />
          Pronto! {done.cadastrosARemover} cadastro(s) duplicado(s) foram
          unificados. As conversas do mesmo número agora ficam juntas. 🎉
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-3">
            Encontramos <b>{preview.gruposDuplicados}</b> número(s) com mais de um
            cadastro (normalmente o mesmo cliente com e sem o 9º dígito) —{" "}
            <b>{preview.cadastrosARemover}</b> cadastro(s) a unir. Unificar junta
            as conversas e o histórico num contato só, sem perder nada.
          </p>
          <button
            onClick={unificar}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 transition disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Merge className="size-4" />}
            {busy ? "Unificando…" : "Unificar duplicados"}
          </button>
        </>
      )}
    </Card>
  );
}
