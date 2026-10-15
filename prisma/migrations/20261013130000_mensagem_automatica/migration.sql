-- RN-080: mensagem de robô (recuperação automática) nunca conta como resposta
-- à cliente. Coluna com DEFAULT constante: no Postgres 11+ é só metadado,
-- não reescreve a tabela de mensagens (a maior do banco).
ALTER TABLE "Message" ADD COLUMN "automatica" BOOLEAN NOT NULL DEFAULT false;
