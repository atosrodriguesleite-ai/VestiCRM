-- NÚMERO DE FORA DO BRASIL GUARDADO COM O 55 COLADO (RN-096, 26/10/2026).
--
-- Antes da regra, todo telefone de onze dígitos ganhava "55" na frente como se
-- fosse brasileiro sem o DDI. O +1 781 408-6755 da cliente dos EUA
-- (17814086755) virou "5517814086755": a Central mostrava "(17) 81408-6755",
-- a resposta da loja saía para um número que não é de ninguém e a cliente
-- ficava sem resposta.
--
-- "55" + onze dígitos cujo TERCEIRO dígito não é 9, ou cujo "DDD" não existe
-- no Brasil, NUNCA é um número brasileiro (celular tem o 9 ali; fixo tem dez
-- dígitos; a lista de DDDs é a mesma de `lib/telefone.ts`): é um DDI e um
-- número de fora com o 55 colado. Aqui o 55 cai — o número passa a ser o que
-- o WhatsApp manda, e a próxima mensagem dela cai no cadastro certo.
--
-- Só onde não há colisão: se a loja já tem o cadastro com o número certo,
-- este fica como está (o único de telefone por loja recusaria) — a cura de
-- carona do intake e a unificação de contatos resolvem esse caso a caso.
UPDATE "Customer" c
   SET phone = substr(c.phone, 3)
 WHERE c.phone ~ '^55[1-9][0-9]{10}$'
   AND (
     substr(c.phone, 5, 1) <> '9'
     OR substr(c.phone, 3, 2) NOT IN (
       '11','12','13','14','15','16','17','18','19',
       '21','22','24','27','28',
       '31','32','33','34','35','37','38',
       '41','42','43','44','45','46','47','48','49',
       '51','53','54','55',
       '61','62','63','64','65','66','67','68','69',
       '71','73','74','75','77','79',
       '81','82','83','84','85','86','87','88','89',
       '91','92','93','94','95','96','97','98','99'
     )
   )
   AND NOT EXISTS (
     SELECT 1 FROM "Customer" o
      WHERE o."companyId" = c."companyId"
        AND o.phone = substr(c.phone, 3)
   );
