# ADR-002 — No máximo 2 crons diários; o resto roda de carona no tráfego

- **Situação:** aceita
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

O plano Vercel Hobby permite **2 cron jobs, ambos diários**. O comportamento
quando se viola esse limite é o pior possível: a Vercel **bloqueia todos os
deploys em silêncio**. Não há e-mail, não há erro claro no painel — os deploys
simplesmente param de sair, e a causa não é óbvia.

As duas vagas já estão ocupadas.

## Decisão

1. O limite é protegido por um guard de build: `scripts/check-vercel-crons.mjs`
   roda dentro de `npm run build` e **falha o build** se o `vercel.json` tiver
   mais de 2 crons ou um cron não-diário. Um build vermelho aqui é infinitamente
   melhor que deploys mortos sem explicação.
2. Trabalho periódico novo **não vira cron**. Vira motor "de carona no tráfego":
   uma trava atômica no banco garante no máximo uma execução por período, e o
   motor roda dentro de uma requisição normal que já ia acontecer.

Exemplos de motores de carona já em produção:

- **Automações** — `Company.automationsRunAt` é a trava (máx. 1×/dia por loja);
- **Vigia de saúde** — `lib/health.ts` checa o servidor Evolution e a conexão
  de cada loja sem gastar cron;
- **Fotos de perfil** — revalidação em lote com teto por rodada.

## Consequências

- ✅ Deploys nunca mais foram bloqueados por cron.
- ✅ Funciona igual no Hobby e no Pro — não depende do plano.
- ⚠️ Loja sem tráfego nenhum não roda os motores. Na prática não é problema:
  loja sem tráfego não tem o que processar.
- ⚠️ Cada motor precisa da própria trava atômica, senão duas requisições
  simultâneas o executam duas vezes.

## Alternativas descartadas

- **Subir para o plano Pro só por causa de cron:** resolveria o limite, mas o
  guard e os motores de carona continuam valendo — são mais baratos e mais
  previsíveis. (A conta hoje é Pro; o limite de 2 crons foi mantido de
  propósito. Revisar se algum dia houver necessidade real.)
- **Serviço externo de cron (cron-job.org etc.):** mais uma peça para
  monitorar, mais um segredo para guardar.
