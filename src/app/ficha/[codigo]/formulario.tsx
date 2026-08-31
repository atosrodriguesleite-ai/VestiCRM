"use client";

import { useEffect, useRef, useState } from "react";
import { NOME_DO_ESTADO } from "@/lib/envios/estados";
import { docTipoLabel } from "@/lib/funcionarios";
import type { FuncionarioDocTipo } from "@prisma/client";

/**
 * O formulário da ficha (RN-025), pensado para o celular do funcionário:
 *
 *  - o ACEITE LGPD vem PRIMEIRO e destrava o resto — nenhum dado (nem
 *    documento) sai do aparelho antes de ele concordar;
 *  - CEP → endereço sozinho (ViaCEP), mesma régua das outras fichas;
 *  - CPF já cadastrado aparece MASCARADO com "corrigir" — sem mexer, o que
 *    está na ficha continua valendo;
 *  - documento é ENVIADO NA HORA, um por um (foto da galeria/câmera) — o teto
 *    de ~4 MB por arquivo é o mesmo do anexo do admin;
 *  - campo em branco NÃO apaga nada: só o que ele preencher viaja.
 */

type Inicial = {
  nascimento: string;
  telefone: string;
  email: string;
  zip: string;
  street: string;
  streetNumber: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  chavePix: string;
  banco: string;
  agencia: string;
  conta: string;
  emergenciaNome: string;
  emergenciaParentesco: string;
  emergenciaTelefone: string;
  restricaoAlimentar: string;
  alergias: string;
};

const campo =
  "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-[15px] outline-none focus:border-[#c4622d] focus:ring-2 focus:ring-[#c4622d]/20";
const rotulo = "block text-xs font-semibold text-gray-500 mb-1.5";

export function FormularioFicha({
  codigo,
  empresa,
  nome,
  cpfMascarado,
  inicial,
}: {
  codigo: string;
  empresa: string;
  nome: string;
  cpfMascarado: string | null;
  inicial: Inicial;
}) {
  const [f, setF] = useState({ ...inicial, cpf: "", nome });
  const [aceite, setAceite] = useState(false);
  const [trocarCpf, setTrocarCpf] = useState(false);
  const [dependentes, setDependentes] = useState<{ nome: string; nascimento: string }[]>([]);
  const [docs, setDocs] = useState<{ id: string; tipo: FuncionarioDocTipo; fileName: string }[]>([]);
  const [anexando, setAnexando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);

  const muda = (parte: Partial<typeof f>) => setF((v) => ({ ...v, ...parte }));
  const precisaDigitarCpf = !cpfMascarado || trocarCpf;

  // CEP → endereço sozinho (mesma régua do formulário da cliente, RN-024)
  const cepBuscado = useRef("");
  useEffect(() => {
    const cep = f.zip.replace(/\D/g, "");
    if (cep.length !== 8 || cep === cepBuscado.current) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        cepBuscado.current = cep;
        const d = (await r.json()) as {
          erro?: boolean;
          logradouro?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
        };
        if (!r.ok || d?.erro) return;
        setF((v) =>
          v.zip.replace(/\D/g, "") === cep
            ? {
                ...v,
                street: v.street.trim() ? v.street : d.logradouro ?? "",
                district: v.district.trim() ? v.district : d.bairro ?? "",
                city: d.localidade || v.city,
                state: d.uf || v.state,
              }
            : v
        );
      } catch {
        /* ViaCEP fora do ar: segue digitando na mão */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [f.zip]);

  async function anexar(file: File) {
    setErro("");
    if (!aceite) return setErro("Para anexar, marque o aceite do uso dos dados.");
    if (file.size > 4 * 1024 * 1024) {
      setErro("Arquivo grande demais (máximo ~4 MB). Tire a foto em qualidade normal.");
      return;
    }
    setAnexando(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await fetch(`/api/ficha-form/${encodeURIComponent(codigo)}/documento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // o aceite viaja no anexo também: o documento entra na pasta na
          // hora, então o consentimento é registrado junto (LGPD)
          aceiteLGPD: aceite,
          // o TIPO não vai daqui: quem rotula é o servidor (o formulário
          // pede só o CPF). Duas fontes para o mesmo rótulo é receita de
          // discordarem um dia.
          fileName: file.name,
          arquivo: dataUrl,
        }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(d?.error ?? "Não foi possível anexar. Tente de novo.");
      setDocs((v) => [...v, d]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível anexar. Tente de novo.");
    } finally {
      setAnexando(false);
    }
  }

  async function enviar() {
    setErro("");
    if (!aceite) return setErro("Para enviar, marque o aceite do uso dos dados.");
    const digitos = (v: string) => v.replace(/\D/g, "");
    if (precisaDigitarCpf && f.cpf.trim() && digitos(f.cpf).length !== 11)
      return setErro("CPF incompleto — confira os 11 números.");
    if (f.state.trim() && !NOME_DO_ESTADO[f.state.toUpperCase()])
      return setErro("Escolha o estado na lista.");

    setEnviando(true);
    try {
      // só o que foi PREENCHIDO viaja — em branco não apaga nada da ficha
      const soPreenchido = (v: string) => (v.trim() ? v.trim() : undefined);
      const r = await fetch(`/api/ficha-form/${encodeURIComponent(codigo)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aceiteLGPD: true,
          // só viaja se ele CORRIGIU: sem isso, uma aba aberta há dias
          // devolveria o nome antigo e desfaria a correção do admin
          ...(f.nome.trim() && f.nome.trim() !== nome.trim()
            ? { nome: f.nome.trim() }
            : {}),
          nascimento: soPreenchido(f.nascimento),
          ...(precisaDigitarCpf ? { cpf: soPreenchido(f.cpf) } : {}),
          telefone: soPreenchido(f.telefone),
          email: soPreenchido(f.email),
          zip: soPreenchido(f.zip),
          street: soPreenchido(f.street),
          streetNumber: soPreenchido(f.streetNumber),
          complement: soPreenchido(f.complement),
          district: soPreenchido(f.district),
          city: soPreenchido(f.city),
          state: soPreenchido(f.state.toUpperCase()),
          chavePix: soPreenchido(f.chavePix),
          banco: soPreenchido(f.banco),
          agencia: soPreenchido(f.agencia),
          conta: soPreenchido(f.conta),
          emergenciaNome: soPreenchido(f.emergenciaNome),
          emergenciaParentesco: soPreenchido(f.emergenciaParentesco),
          emergenciaTelefone: soPreenchido(f.emergenciaTelefone),
          restricaoAlimentar: soPreenchido(f.restricaoAlimentar),
          alergias: soPreenchido(f.alergias),
          dependentes: dependentes
            .filter((d) => d.nome.trim())
            .map((d) => ({ nome: d.nome.trim(), nascimento: d.nascimento || null })),
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
          <h1 className="text-lg font-bold text-gray-800 mb-2">Ficha enviada!</h1>
          <p className="text-sm text-gray-500">
            A {empresa} recebeu seus dados e vai conferir tudo. Obrigado! 💜
          </p>
        </div>
      </main>
    );

  return (
    <main className="min-h-dvh bg-[#faf7f2] py-8 px-4">
      <div className="mx-auto max-w-md">
        <header className="mb-5 text-center">
          <p className="text-3xl mb-1">📋</p>
          <h1 className="text-xl font-bold text-gray-800">Ficha de funcionário</h1>
          <p className="text-sm text-gray-500 mt-1">
            {nome}, preencha seus dados para a {empresa}. Leva uns 5 minutos.
          </p>
        </header>

        {/* aceite LGPD PRIMEIRO: nada sai do aparelho antes dele */}
        <label className="mb-4 flex items-start gap-3 rounded-2xl bg-white border border-gray-100 shadow-sm p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={aceite}
            onChange={(e) => setAceite(e.target.checked)}
            className="mt-0.5 size-5 accent-[#c4622d]"
          />
          <span className="text-[13px] leading-snug text-gray-600">
            Autorizo a <b>{empresa}</b> a guardar estes dados e documentos no meu
            registro de funcionário. Eles ficam restritos à administração da
            empresa e servem só para a relação de trabalho (LGPD).
          </span>
        </label>

        <div
          className={`rounded-2xl bg-white border border-gray-100 shadow-sm p-4 space-y-4 ${
            aceite ? "" : "pointer-events-none opacity-40"
          }`}
        >
          <div>
            <label className={rotulo}>Nome completo</label>
            <input className={campo} value={f.nome} maxLength={120}
              onChange={(e) => muda({ nome: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotulo}>Nascimento</label>
              <input type="date" className={campo} value={f.nascimento}
                onChange={(e) => muda({ nascimento: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Telefone</label>
              <input className={campo} inputMode="tel" value={f.telefone} maxLength={25}
                onChange={(e) => muda({ telefone: e.target.value })} />
            </div>
          </div>

          {cpfMascarado && !trocarCpf ? (
            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-3">
              <p className="text-sm text-gray-600">
                CPF cadastrado: <span className="font-mono">{cpfMascarado}</span>
              </p>
              <button type="button" onClick={() => setTrocarCpf(true)}
                className="text-xs font-semibold text-[#c4622d]">
                corrigir
              </button>
            </div>
          ) : (
            <div>
              <label className={rotulo}>CPF</label>
              <input className={campo} inputMode="numeric" placeholder="000.000.000-00"
                value={f.cpf} maxLength={20}
                onChange={(e) => muda({ cpf: e.target.value })} />
            </div>
          )}

          <div>
            <label className={rotulo}>E-mail (opcional)</label>
            <input className={campo} inputMode="email" value={f.email} maxLength={120}
              onChange={(e) => muda({ email: e.target.value })} />
          </div>

          {/* endereço */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotulo}>CEP</label>
              <input className={campo} inputMode="numeric" placeholder="00000-000"
                value={f.zip} maxLength={12}
                onChange={(e) => muda({ zip: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Número</label>
              <input className={campo} value={f.streetNumber} maxLength={20}
                onChange={(e) => muda({ streetNumber: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={rotulo}>Rua</label>
            <input className={campo} value={f.street} maxLength={160}
              onChange={(e) => muda({ street: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotulo}>Bairro</label>
              <input className={campo} value={f.district} maxLength={80}
                onChange={(e) => muda({ district: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Complemento</label>
              <input className={campo} value={f.complement} maxLength={80}
                onChange={(e) => muda({ complement: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <div>
              <label className={rotulo}>Cidade</label>
              <input className={campo} value={f.city} maxLength={80}
                onChange={(e) => muda({ city: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Estado</label>
              <select className={campo} value={f.state.toUpperCase()}
                onChange={(e) => muda({ state: e.target.value })}>
                <option value="">UF</option>
                {Object.keys(NOME_DO_ESTADO).map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
            </div>
          </div>

          {/* pagamento */}
          <div>
            <label className={rotulo}>Chave Pix (para receber)</label>
            <input className={campo} value={f.chavePix} maxLength={120}
              onChange={(e) => muda({ chavePix: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={rotulo}>Banco</label>
              <input className={campo} value={f.banco} maxLength={80}
                onChange={(e) => muda({ banco: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Agência</label>
              <input className={campo} value={f.agencia} maxLength={20}
                onChange={(e) => muda({ agencia: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Conta</label>
              <input className={campo} value={f.conta} maxLength={30}
                onChange={(e) => muda({ conta: e.target.value })} />
            </div>
          </div>

          {/* emergência e saúde */}
          <div>
            <label className={rotulo}>Contato de emergência (nome)</label>
            <input className={campo} value={f.emergenciaNome} maxLength={120}
              onChange={(e) => muda({ emergenciaNome: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotulo}>Parentesco</label>
              <input className={campo} value={f.emergenciaParentesco} maxLength={40}
                onChange={(e) => muda({ emergenciaParentesco: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Telefone dele(a)</label>
              <input className={campo} inputMode="tel" value={f.emergenciaTelefone} maxLength={25}
                onChange={(e) => muda({ emergenciaTelefone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={rotulo}>Restrição alimentar</label>
              <input className={campo} placeholder="ex.: sem lactose" value={f.restricaoAlimentar}
                maxLength={300} onChange={(e) => muda({ restricaoAlimentar: e.target.value })} />
            </div>
            <div>
              <label className={rotulo}>Alergias</label>
              <input className={campo} placeholder="ex.: dipirona" value={f.alergias}
                maxLength={300} onChange={(e) => muda({ alergias: e.target.value })} />
            </div>
          </div>

          {/* dependentes */}
          <div>
            <label className={rotulo}>Dependentes (filhos etc. — opcional)</label>
            {dependentes.map((d, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_130px_32px] items-center gap-2">
                <input className={campo} placeholder="Nome" value={d.nome} maxLength={120}
                  onChange={(e) =>
                    setDependentes((v) => v.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))
                  } />
                <input type="date" className={campo} value={d.nascimento}
                  onChange={(e) =>
                    setDependentes((v) => v.map((x, j) => (j === i ? { ...x, nascimento: e.target.value } : x)))
                  } />
                <button type="button" aria-label="Tirar dependente"
                  onClick={() => setDependentes((v) => v.filter((_, j) => j !== i))}
                  className="text-gray-400 text-lg">
                  ✕
                </button>
              </div>
            ))}
            {dependentes.length < 10 && (
              <button type="button"
                onClick={() => setDependentes((v) => [...v, { nome: "", nascimento: "" }])}
                className="text-xs font-semibold text-[#c4622d]">
                + adicionar dependente
              </button>
            )}
          </div>

          {/* documentos: cada arquivo sobe NA HORA */}
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-600 mb-1">
              📎 Foto do CPF
            </p>
            <p className="text-[11px] text-gray-400 mb-2">
              Envie a foto do seu <b>CPF</b>. Pode fotografar com a câmera —
              cada arquivo até ~4 MB. Outros documentos a empresa pede depois,
              se precisar.
            </p>
            {docs.length > 0 && (
              <ul className="mb-2 space-y-1">
                {docs.map((d) => (
                  <li key={d.id} className="text-xs text-emerald-700">
                    ✓ {docTipoLabel[d.tipo]} · {d.fileName}
                  </li>
                ))}
              </ul>
            )}
            <label
              className={`block w-full rounded-xl border border-dashed border-gray-300 px-3 py-2.5 text-center text-sm font-medium ${
                anexando ? "text-gray-400" : "text-[#c4622d] cursor-pointer"
              }`}
            >
              {anexando ? "Enviando…" : "Escolher foto / arquivo"}
              <input type="file" accept="image/*,.pdf" className="hidden" disabled={anexando}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void anexar(file);
                }} />
            </label>
          </div>

          {erro && (
            <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-600">{erro}</p>
          )}

          <button type="button" onClick={enviar} disabled={enviando}
            className="w-full rounded-xl bg-[#c4622d] px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-60">
            {enviando ? "Enviando…" : "Enviar ficha"}
          </button>
          <p className="text-center text-[11px] text-gray-400">
            A administração confere antes de gravar. Campo em branco não muda
            o que a empresa já tem.
          </p>
        </div>
      </div>
    </main>
  );
}
