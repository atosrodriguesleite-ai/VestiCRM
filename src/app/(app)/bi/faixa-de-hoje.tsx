"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageSquareWarning, ShoppingBag, Users, Wallet } from "lucide-react";
import { Card } from "@/components/ui";
import { useContagem } from "@/components/dash";
// SÓ a parte pura: o motor com Prisma não pode chegar ao navegador
import { INTERVALO_DA_FAIXA_MS, avisoDaFalha, textoDaContagem, textoDeAtualizado, type NumerosDeHoje } from "@/lib/bi/hoje-regra";

type Props = {
  inicial: NumerosDeHoje;
  prazoMin: number;
  hrefEsperando: string;
  rodape?: string;
};

/**
 * A FAIXA "HOJE" QUE SE ATUALIZA SOZINHA (RN-088): pede os números a cada
 * 30 s enquanto a aba está visível; escondida, para. A última resposta boa
 * fica na tela se uma falhar (sem piscar zero), e o rodapé diz há quanto
 * tempo foi atualizada.
 */
export function FaixaDeHoje({ inicial, prazoMin, hrefEsperando, rodape }: Props) {
  const [n, setN] = useState<NumerosDeHoje>(inicial);
  /** nulo = o último pedido deu certo; número = o status que falhou (0 = rede) */
  const [falha, setFalha] = useState<number | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState(() => Date.now());

  useEffect(() => {
    let vivo = true;
    const buscar = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/bi/hoje", { cache: "no-store" });
        if (!vivo) return;
        if (!res.ok) {
          setFalha(res.status);
          return;
        }
        const dados = (await res.json()) as NumerosDeHoje;
        if (!vivo) return;
        setN(dados);
        setAtualizadoEm(Date.now());
        setFalha(null);
      } catch {
        if (vivo) setFalha(0);
      }
    };
    const batida = setInterval(buscar, INTERVALO_DA_FAIXA_MS);
    // voltou para a aba: pede na hora, sem esperar a próxima batida
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void buscar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      clearInterval(batida);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  return (
    <Card className="mt-4 p-5 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <p className="text-xs uppercase tracking-wide text-slate-300">Hoje · {n.dia.split("-").reverse().join("/")}</p>
        <p className="text-[11px] text-slate-400 tabular-nums">
          <span className={`inline-block size-1.5 rounded-full mr-1.5 align-middle ${falha === null ? "bg-emerald-400" : "bg-amber-400"}`} />
          {/* o aviso de falha é o que o leitor de tela anuncia; o relógio dos segundos não (anunciaria a cada segundo) */}
          <span aria-live="polite">{falha === null ? "" : avisoDaFalha(falha)}</span>
          {falha === null && (
            <>
              ao vivo · atualizado <Relogio desde={atualizadoEm} />
            </>
          )}
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Vivo rotulo="Novos contatos" valor={n.leads} icone={<Users className="size-4" />} />
        <Vivo
          rotulo="Esperando resposta agora"
          valor={n.esperandoAgora}
          icone={<MessageSquareWarning className="size-4" />}
          tom={n.esperandoAgora > 0 ? "warn" : "ok"}
          href={hrefEsperando}
        />
        <Vivo rotulo="Pedidos pagos" valor={n.pedidosPagos} icone={<ShoppingBag className="size-4" />} />
        <Vivo rotulo="Vendido" valor={n.vendido} formato="brl" icone={<Wallet className="size-4" />} />
      </div>
      <p className="text-[11px] text-slate-400 mt-3">
        Prazo de resposta da loja: {prazoMin} min com a loja aberta. Toque num número para ver quem está por trás dele.
        {rodape ? ` ${rodape}` : ""}
      </p>
    </Card>
  );
}

/**
 * O "há N s" com estado PRÓPRIO: só este pedacinho redesenha a cada
 * segundo (não a faixa inteira), e só com a aba visível.
 */
function Relogio({ desde }: { desde: number }) {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    setSegundos(0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setSegundos((Date.now() - desde) / 1000);
    }, 1000);
    return () => clearInterval(t);
  }, [desde]);
  return <>{textoDeAtualizado(segundos)}</>;
}

/** o número ANIMA quando muda (a contagem do Dashboard, que respeita "reduzir movimento") */
function Vivo({
  rotulo,
  valor,
  formato = "int",
  icone,
  tom = "neutro",
  href,
}: {
  rotulo: string;
  valor: number;
  formato?: "int" | "brl";
  icone: React.ReactNode;
  tom?: "neutro" | "warn" | "ok";
  href?: string;
}) {
  const mostrado = useContagem(valor);
  const texto = textoDaContagem(mostrado, valor, formato);
  const cor = tom === "warn" ? "text-amber-300" : tom === "ok" ? "text-emerald-300" : "text-white";
  const corpo = (
    <>
      <p className="text-xs text-slate-300 flex items-center gap-1.5">
        {icone}
        {rotulo}
      </p>
      {/* tabular-nums: o número anima, e dígito de largura fixa não balança a linha */}
      <p className={`text-3xl font-semibold tabular-nums mt-1 ${cor}`}>{texto}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl -m-2 p-2 hover:bg-white/10 transition" title="Ver quem">
      {corpo}
    </Link>
  ) : (
    <div>{corpo}</div>
  );
}
