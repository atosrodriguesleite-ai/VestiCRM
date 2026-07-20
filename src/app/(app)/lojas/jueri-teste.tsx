"use client";

/**
 * Teste de leitura da integração Jueri (Super Admin) — cola o token e o ID
 * do cliente, roda só GETs e mostra o relatório: conexão, preços
 * Varejo/Atacado, categorias, amostra de produtos e se a FOTO vem na API.
 */

import { useState } from "react";
import { Plug } from "lucide-react";
import { Card } from "@/components/ui";

type Resultado = {
  conexao?: { httpStatus: number; autenticou: boolean };
  tiposPreco?: unknown;
  categorias?: unknown;
  amostraProdutos?: {
    id: unknown; descricao: unknown; referencia: unknown;
    codigo_barras: unknown; cor: unknown; quantidade: unknown; tipo_preco: unknown;
  }[];
  camposDoProdutoDetalhado?: string[];
  fotoEncontrada?: string | null;
  error?: string;
};

export function JueriTeste() {
  const [aberto, setAberto] = useState(false);
  const [token, setToken] = useState("");
  const [clienteSistema, setClienteSistema] = useState("");
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Resultado | null>(null);

  async function testar() {
    setBusy(true);
    setR(null);
    try {
      const res = await fetch("/api/jueri/testar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), clienteSistema: clienteSistema.trim() }),
      });
      setR(await res.json());
    } catch {
      setR({ error: "Falha na chamada — tente de novo." });
    }
    setBusy(false);
  }

  const precos = Array.isArray(r?.tiposPreco)
    ? (r!.tiposPreco as { id: number; nome: string }[]).map((t) => t.nome).join(" + ")
    : null;
  const cats = Array.isArray(r?.categorias)
    ? (r!.categorias as { nome: string }[]).map((c) => c.nome)
    : null;

  return (
    <Card className="p-5 mb-6">
      <button
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-2 font-semibold text-sm w-full text-left"
      >
        <Plug className="size-4 text-brand-600" />
        Integração Jueri — teste de leitura
        <span className="text-xs text-gray-400 font-normal ml-auto">
          {aberto ? "fechar" : "abrir"}
        </span>
      </button>
      {aberto && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-500">
            Só LEITURA: nada é criado ou alterado no sistema da cliente, e o
            token não fica salvo em lugar nenhum.
          </p>
          <div className="flex gap-2 flex-wrap">
            <input
              value={clienteSistema}
              onChange={(e) => setClienteSistema(e.target.value)}
              placeholder="ID do cliente (ex.: 35080)"
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm w-44 bg-white"
            />
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Token de integração"
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm flex-1 min-w-[220px] bg-white"
            />
            <button
              onClick={testar}
              disabled={busy || !token.trim() || !clienteSistema.trim()}
              className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-50"
            >
              {busy ? "Testando…" : "Testar"}
            </button>
          </div>

          {r?.error && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {r.error}
            </p>
          )}

          {r && !r.error && (
            <div className="space-y-2 text-sm">
              <p>
                {r.conexao?.autenticou ? "🟢 Conectou e autenticou!" : `🔴 Não autenticou (HTTP ${r.conexao?.httpStatus}) — confira token e ID.`}
              </p>
              {precos && <p>💰 Tipos de preço: <b>{precos}</b></p>}
              {cats && (
                <p>🗂️ Categorias ({cats.length}): {cats.slice(0, 10).join(", ")}{cats.length > 10 ? "…" : ""}</p>
              )}
              <p>
                📸 Foto na API:{" "}
                {r.fotoEncontrada ? (
                  <b className="text-emerald-600">SIM — {r.fotoEncontrada}</b>
                ) : (
                  <b className="text-amber-600">não apareceu na consulta</b>
                )}
              </p>
              {(r.amostraProdutos?.length ?? 0) > 0 && (
                <div className="overflow-x-auto thin-scroll">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                        <th className="py-1 pr-2">Descrição</th>
                        <th className="py-1 pr-2">Ref.</th>
                        <th className="py-1 pr-2">Cód. barras</th>
                        <th className="py-1 pr-2">Cor</th>
                        <th className="py-1 pr-2">Estoque</th>
                        <th className="py-1">Preços</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.amostraProdutos!.map((prod, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          <td className="py-1.5 pr-2">{String(prod.descricao ?? "—")}</td>
                          <td className="py-1.5 pr-2 font-mono">{String(prod.referencia ?? "—")}</td>
                          <td className="py-1.5 pr-2 font-mono">{String(prod.codigo_barras ?? "—")}</td>
                          <td className="py-1.5 pr-2">{String(prod.cor ?? "—")}</td>
                          <td className="py-1.5 pr-2 tabular-nums">{String(prod.quantidade ?? "—")}</td>
                          <td className="py-1.5">
                            {Array.isArray(prod.tipo_preco)
                              ? (prod.tipo_preco as { nome: string; pivot?: { preco?: number } }[])
                                  .map((t) => `${t.nome}: R$ ${t.pivot?.preco ?? "?"}`)
                                  .join(" · ")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(r.camposDoProdutoDetalhado?.length ?? 0) > 0 && (
                <p className="text-[11px] text-gray-400">
                  Campos do produto: {r.camposDoProdutoDetalhado!.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
