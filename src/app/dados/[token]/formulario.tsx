"use client";

import { useEffect, useRef, useState } from "react";
import { NOME_DO_ESTADO } from "@/lib/envios/estados";

/**
 * O formulário em si (RN-024). Três cuidados de quem preenche no celular:
 *
 *  - CEP → endereço sozinho (ViaCEP), mesma régua da ficha: cidade/UF sempre
 *    acompanham o CEP; rua e bairro só preenchem campo VAZIO.
 *  - Documento já cadastrado aparece MASCARADO com o botão "corrigir" — ela
 *    só redigita se precisar mudar; sem mexer, o de sempre continua valendo.
 *  - PF/PJ: escolher CNPJ abre razão social e inscrição estadual (a IE sai
 *    na etiqueta quando a compra é PJ).
 */

type Inicial = {
  nome: string;
  tipo: "PF" | "PJ";
  cpfMascarado: string | null;
  cnpjMascarado: string | null;
  razaoSocial: string;
  ie: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

const campo =
  "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-[15px] outline-none focus:border-[#c4622d] focus:ring-2 focus:ring-[#c4622d]/20";
const rotulo = "block text-xs font-semibold text-gray-500 mb-1.5";

export function FormularioDados({
  token,
  loja,
  completo,
  inicial,
}: {
  token: string;
  loja: string;
  completo: boolean;
  inicial: Inicial;
}) {
  const [f, setF] = useState({
    nome: inicial.nome,
    tipo: inicial.tipo,
    cpf: "",
    cnpj: "",
    razaoSocial: inicial.razaoSocial,
    ie: inicial.ie,
    cep: inicial.cep,
    rua: inicial.rua,
    numero: inicial.numero,
    complemento: inicial.complemento,
    bairro: inicial.bairro,
    cidade: inicial.cidade,
    uf: inicial.uf,
  });
  // documento mascarado: só pede o número novo se ela clicar em "corrigir"
  const [trocarDoc, setTrocarDoc] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);

  const docMascarado = f.tipo === "PF" ? inicial.cpfMascarado : inicial.cnpjMascarado;
  const precisaDigitarDoc = !docMascarado || trocarDoc;

  const muda = (parte: Partial<typeof f>) => setF((v) => ({ ...v, ...parte }));

  // CEP → endereço sozinho (mesma régua da ficha: cidade/UF acompanham o
  // CEP; rua e bairro nunca pisam no que já foi digitado)
  const cepBuscado = useRef("");
  useEffect(() => {
    const cep = f.cep.replace(/\D/g, "");
    if (cep.length !== 8 || cep === cepBuscado.current) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        // só marca como buscado quando a resposta CHEGA — falha de rede
        // passageira não pode travar a busca deste CEP para sempre
        cepBuscado.current = cep;
        const d = (await r.json()) as {
          erro?: boolean; logradouro?: string; bairro?: string;
          localidade?: string; uf?: string;
        };
        if (!r.ok || d?.erro) return;
        setF((v) =>
          v.cep.replace(/\D/g, "") === cep
            ? {
                ...v,
                rua: v.rua.trim() ? v.rua : d.logradouro ?? "",
                bairro: v.bairro.trim() ? v.bairro : d.bairro ?? "",
                cidade: d.localidade || v.cidade,
                uf: d.uf || v.uf,
              }
            : v
        );
      } catch {
        /* ViaCEP fora do ar: segue digitando na mão */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [f.cep]);

  async function enviar() {
    setErro("");
    const digitos = (v: string) => v.replace(/\D/g, "");
    if (f.tipo === "PF" && precisaDigitarDoc && digitos(f.cpf).length !== 11)
      return setErro("CPF incompleto — confira os 11 números.");
    if (f.tipo === "PJ" && precisaDigitarDoc && digitos(f.cnpj).length !== 14)
      return setErro("CNPJ incompleto — confira os 14 números.");
    if (f.tipo === "PJ" && !f.razaoSocial.trim())
      return setErro("Escreva a razão social (o nome da empresa na nota).");
    for (const [valor, nome] of [
      [f.nome, "seu nome"], [f.cep, "o CEP"], [f.rua, "a rua"],
      [f.numero, "o número"], [f.bairro, "o bairro"], [f.cidade, "a cidade"],
    ] as const)
      if (!valor.trim()) return setErro(`Falta preencher ${nome}.`);
    if (!NOME_DO_ESTADO[f.uf.toUpperCase()]) return setErro("Escolha o estado na lista.");

    setEnviando(true);
    try {
      const r = await fetch("/api/dados-envio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          tipo: f.tipo,
          nome: f.nome,
          // sem corrigir, o documento NÃO viaja — o servidor mantém o que há.
          // (se nunca houve, precisaDigitarDoc é true e ele vai)
          ...(f.tipo === "PF" && precisaDigitarDoc ? { cpf: f.cpf } : {}),
          ...(f.tipo === "PJ" && precisaDigitarDoc ? { cnpj: f.cnpj } : {}),
          ...(f.tipo === "PJ" ? { razaoSocial: f.razaoSocial, ie: f.ie } : {}),
          manterDocumento: !precisaDigitarDoc,
          cep: f.cep,
          rua: f.rua,
          numero: f.numero,
          complemento: f.complemento,
          bairro: f.bairro,
          cidade: f.cidade,
          uf: f.uf.toUpperCase(),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? "Não foi possível enviar. Tente de novo.");
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviado)
    return (
      <main className="min-h-dvh bg-[#faf7f2] flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="text-4xl mb-3">✅</p>
          <h1 className="text-lg font-bold text-gray-800 mb-2">Dados enviados!</h1>
          <p className="text-sm text-gray-500">
            A {loja} já recebeu tudo. Pode voltar para a conversa. 💜
          </p>
        </div>
      </main>
    );

  return (
    <main className="min-h-dvh bg-[#faf7f2] py-8 px-4">
      <div className="mx-auto max-w-md">
        <header className="mb-5 text-center">
          <p className="text-3xl mb-1">📦</p>
          <h1 className="text-xl font-bold text-gray-800">Dados de envio</h1>
          <p className="text-sm text-gray-500 mt-1">
            {completo
              ? `Confira se está tudo certo para a ${loja} enviar seu pedido.`
              : `Preencha rapidinho para a ${loja} enviar seu pedido.`}
          </p>
        </header>

        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 space-y-4">
          <div>
            <label className={rotulo}>Seu nome completo</label>
            <input className={campo} value={f.nome} maxLength={120}
              onChange={(e) => muda({ nome: e.target.value })} />
          </div>

          {/* PF ou PJ */}
          <div>
            <label className={rotulo}>A compra é no CPF ou no CNPJ?</label>
            <div className="grid grid-cols-2 gap-2">
              {(["PF", "PJ"] as const).map((t) => (
                <button key={t} type="button"
                  onClick={() => { muda({ tipo: t }); setTrocarDoc(false); }}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                    f.tipo === t
                      ? "border-[#c4622d] bg-[#faf4ee] text-[#a04e21]"
                      : "border-gray-200 text-gray-500"
                  }`}>
                  {t === "PF" ? "CPF (pessoa física)" : "CNPJ (empresa)"}
                </button>
              ))}
            </div>
          </div>

          {/* documento: mascarado quando já existe */}
          {docMascarado && !trocarDoc ? (
            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-3">
              <p className="text-sm text-gray-600">
                {f.tipo === "PF" ? "CPF" : "CNPJ"} cadastrado:{" "}
                <span className="font-mono">{docMascarado}</span>
              </p>
              <button type="button" onClick={() => setTrocarDoc(true)}
                className="text-xs font-semibold text-[#c4622d]">
                corrigir
              </button>
            </div>
          ) : (
            <div>
              <label className={rotulo}>{f.tipo === "PF" ? "CPF" : "CNPJ"}</label>
              <input className={campo} inputMode="numeric"
                placeholder={f.tipo === "PF" ? "000.000.000-00" : "00.000.000/0000-00"}
                value={f.tipo === "PF" ? f.cpf : f.cnpj} maxLength={20}
                onChange={(e) =>
                  muda(f.tipo === "PF" ? { cpf: e.target.value } : { cnpj: e.target.value })
                } />
            </div>
          )}

          {f.tipo === "PJ" && (
            <>
              <div>
                <label className={rotulo}>Razão social (nome da empresa na nota)</label>
                <input className={campo} value={f.razaoSocial} maxLength={160}
                  onChange={(e) => muda({ razaoSocial: e.target.value })} />
              </div>
              <div>
                <label className={rotulo}>Inscrição estadual (se tiver)</label>
                <input className={campo} value={f.ie} maxLength={30}
                  onChange={(e) => muda({ ie: e.target.value })} />
              </div>
            </>
          )}

          <hr className="border-gray-100" />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>CEP</label>
              <input className={campo} inputMode="numeric" placeholder="00000-000"
                value={f.cep} maxLength={9}
                onChange={(e) => muda({ cep: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Número</label>
              <input className={campo} value={f.numero} maxLength={20}
                onChange={(e) => muda({ numero: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={rotulo}>Rua</label>
            <input className={campo} value={f.rua} maxLength={160}
              onChange={(e) => muda({ rua: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Complemento (opcional)</label>
              <input className={campo} placeholder="apto, bloco…" value={f.complemento}
                maxLength={80} onChange={(e) => muda({ complemento: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Bairro</label>
              <input className={campo} value={f.bairro} maxLength={80}
                onChange={(e) => muda({ bairro: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div>
              <label className={rotulo}>Cidade</label>
              <input className={campo} value={f.cidade} maxLength={80}
                onChange={(e) => muda({ cidade: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Estado</label>
              <select className={campo} value={f.uf}
                onChange={(e) => muda({ uf: e.target.value })}>
                <option value="">UF</option>
                {Object.keys(NOME_DO_ESTADO).sort().map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
            </div>
          </div>

          {erro && (
            <p className="rounded-xl bg-rose-50 border border-rose-100 px-3.5 py-2.5 text-sm text-rose-700">
              {erro}
            </p>
          )}

          <button type="button" onClick={enviar} disabled={enviando}
            className="w-full rounded-xl bg-[#c4622d] hover:bg-[#a04e21] text-white font-semibold py-3.5 transition disabled:opacity-60">
            {enviando ? "Enviando…" : "Enviar meus dados"}
          </button>
          <p className="text-center text-[11px] text-gray-400">
            Seus dados vão direto para a {loja}, só para o envio do seu pedido.
          </p>
        </div>
      </div>
    </main>
  );
}
