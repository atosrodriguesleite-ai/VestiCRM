-- RN-049: a loja já teve WhatsApp? Carimbo da primeira conexão real, que o
-- Desconectar nunca apaga (ele zera instância, telefone e provedor).
ALTER TABLE "CommSettings" ADD COLUMN "whatsappConectadoEm" TIMESTAMP(3);

-- BACKFILL das lojas que já conectaram antes do carimbo existir:
--  (1) conectadas agora, com telefone gravado, ou com a API oficial;
--  (2) com alguma mensagem de id REAL do WhatsApp — fora os ids falsos do
--      provedor simulado ("mock.…"), da tela de simulação ("wamid.sim.…") e
--      do seed da loja demo ("wamid.seed.…"). O id da API oficial começa por
--      "wamid." seguido de base64, por isso só os dois sufixos falsos saem.
UPDATE "CommSettings" cs
   SET "whatsappConectadoEm" = NOW()
 WHERE cs."whatsappConectadoEm" IS NULL
   AND (
         cs."evolutionStatus" = 'CONECTADO'
      OR cs."evolutionPhone" IS NOT NULL
      OR cs."activeProvider" = 'CLOUD_API'
      OR EXISTS (
           SELECT 1
             FROM "Message" m
             JOIN "Conversation" c ON c."id" = m."conversationId"
            WHERE c."companyId" = cs."companyId"
              AND m."externalId" IS NOT NULL
              AND m."externalId" NOT LIKE 'mock.%'
              AND m."externalId" NOT LIKE 'wamid.sim.%'
              AND m."externalId" NOT LIKE 'wamid.seed.%'
         )
       );
