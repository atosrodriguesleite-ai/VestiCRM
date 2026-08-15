-- MESMA MENSAGEM NUNCA ENTRA DUAS VEZES
--
-- Incidente real: a mesma mensagem aparecia duas vezes na conversa.
-- A proteção era feita no código ("olha se já existe, depois grava"), o que
-- não segura duas entregas simultâneas do mesmo aviso do WhatsApp — e o
-- servidor Evolution reenvia o aviso quando a resposta demora a voltar.
-- Agora quem garante é o banco: não existe corrida contra um índice único.
--
-- `externalId` é o id da mensagem no WhatsApp (wamid). Mensagem enviada por
-- nós nasce com esse campo NULO e só recebe o id quando o eco volta — e no
-- Postgres vários NULOS convivem no mesmo índice único, então nada disso
-- atrapalha o envio.

-- 1) Limpa as duplicatas que já entraram, mantendo SEMPRE a mais antiga
--    (a primeira que chegou é a que a equipe já viu e respondeu).
--    Só apaga linha que tem outra IDÊNTICA na mesma conversa e mesmo id de
--    WhatsApp — não é a "mensagem parecida", é a mesma mensagem repetida.
DELETE FROM "Message" a
USING "Message" b
WHERE a."externalId" IS NOT NULL
  AND a."externalId" = b."externalId"
  AND a."conversationId" = b."conversationId"
  AND (
    a."createdAt" > b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" > b."id")
  );

-- 2) Fecha a porta de vez.
CREATE UNIQUE INDEX "Message_conversationId_externalId_key"
  ON "Message"("conversationId", "externalId");
