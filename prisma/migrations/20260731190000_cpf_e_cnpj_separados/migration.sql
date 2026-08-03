-- CPF E CNPJ EM CAMPOS SEPARADOS (cliente e remetente da etiqueta).
--
-- Antes existia UM campo "document" com o comentário "CPF ou CNPJ". Na
-- prática a cliente lojista tem os DOIS (CNPJ da loja e CPF da titular), e
-- cada destino exige um deles: o Melhor Envio manda CPF em `document` e CNPJ
-- em `company_document`; a NF-e muda de pessoa física para jurídica. Com um
-- campo só, guardar um documento apagava o outro.
--
-- O que já está gravado NÃO se perde: o que tem 14 dígitos é CNPJ e vai para
-- a coluna nova; o resto (CPF, ou preenchimento incompleto) fica no CPF.

ALTER TABLE "Customer" RENAME COLUMN "document" TO "cpf";
ALTER TABLE "Customer" ADD COLUMN "cnpj" TEXT;

UPDATE "Customer"
   SET "cnpj" = "cpf", "cpf" = NULL
 WHERE "cpf" IS NOT NULL
   AND length(regexp_replace("cpf", '[^0-9]', '', 'g')) = 14;

ALTER TABLE "MelhorEnvioConnection" RENAME COLUMN "fromDocument" TO "fromCpf";
ALTER TABLE "MelhorEnvioConnection" ADD COLUMN "fromCnpj" TEXT;

UPDATE "MelhorEnvioConnection"
   SET "fromCnpj" = "fromCpf", "fromCpf" = NULL
 WHERE "fromCpf" IS NOT NULL
   AND length(regexp_replace("fromCpf", '[^0-9]', '', 'g')) = 14;
