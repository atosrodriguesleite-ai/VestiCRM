import type { Metadata } from "next";
import { mascararDocumento } from "@/lib/dados-envio";
import { lerLinkFicha } from "@/lib/ficha-form-link";
import { FormularioFicha } from "./formulario";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ficha de funcionário",
  robots: { index: false, follow: false }, // página pessoal: fora do Google
};

/**
 * FORMULÁRIO PÚBLICO da ficha de funcionário (RN-025): o funcionário chega
 * pelo link que o admin mandou e preenche os próprios dados pelo celular,
 * sem login. Quem prova quem ele é é o código do link (sorteado, 7 dias,
 * USO ÚNICO — o envio o consome).
 *
 * O que a ficha já tem aparece preenchido para ele SÓ CONFERIR; o CPF
 * aparece MASCARADO — quem pegar o link no meio não descobre o número.
 * O que ele mandar NÃO entra direto: aguarda a conferência do admin.
 */
export default async function PaginaFicha({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  // link cortado no meio pelo WhatsApp pode terminar num "%" solto — o
  // decode explode, e o funcionário veria erro cru em vez do aviso amigável
  let codigoLimpo = "";
  try {
    codigoLimpo = decodeURIComponent(codigo);
  } catch {
    codigoLimpo = "";
  }
  const link = await lerLinkFicha(codigoLimpo);

  if (!link)
    return (
      <main className="min-h-dvh bg-[#faf7f2] flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="text-4xl mb-3">⏳</p>
          <h1 className="text-lg font-bold text-gray-800 mb-2">
            Este link venceu ou já foi usado
          </h1>
          <p className="text-sm text-gray-500">
            Por segurança, o link da ficha vale por 7 dias e só serve uma vez.
            Peça um novo à empresa. 💜
          </p>
        </div>
      </main>
    );

  const f = link.funcionario;
  return (
    <FormularioFicha
      codigo={codigoLimpo}
      empresa={f.company.name}
      nome={f.nome}
      vinculo={f.vinculo}
      cpfMascarado={mascararDocumento(f.cpf)}
      inicial={{
        nascimento: f.nascimento ? f.nascimento.toISOString().slice(0, 10) : "",
        telefone: f.telefone ?? "",
        email: f.email ?? "",
        zip: f.zip ?? "",
        street: f.street ?? "",
        streetNumber: f.streetNumber ?? "",
        complement: f.complement ?? "",
        district: f.district ?? "",
        city: f.city ?? "",
        state: f.state ?? "",
        chavePix: f.chavePix ?? "",
        banco: f.banco ?? "",
        agencia: f.agencia ?? "",
        conta: f.conta ?? "",
        emergenciaNome: f.emergenciaNome ?? "",
        emergenciaParentesco: f.emergenciaParentesco ?? "",
        emergenciaTelefone: f.emergenciaTelefone ?? "",
        restricaoAlimentar: f.restricaoAlimentar ?? "",
        alergias: f.alergias ?? "",
      }}
    />
  );
}
