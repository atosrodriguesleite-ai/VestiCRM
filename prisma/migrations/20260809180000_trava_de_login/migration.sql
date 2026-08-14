-- TRAVA DE FORÇA BRUTA NO LOGIN (auditoria de arquitetura, 09/08/2026).
--
-- A porta de entrada do sistema aceitava tentativas de senha SEM LIMITE
-- nenhum: um robô testava milhões de senhas na velocidade da máquina, sem
-- espera e sem deixar rastro. Como 158 das 181 rotas passam por essa mesma
-- porta, ela era o ponto mais valioso — e o mais desprotegido — do sistema.
--
-- Um contador por chave: "login:maria@loja.com" (ataque mirado numa conta)
-- e "ip:200.1.2.3" (ataque que espalha uma senha por várias contas).
--
-- No BANCO, e não em memória: na Vercel cada requisição pode cair numa
-- máquina diferente e a memória some a cada hibernação — contador que zera
-- sozinho não é trava.
--
-- O índice em updatedAt serve à faxina, que pega carona no tráfego de login
-- (o plano Hobby só aceita 2 crons e um terceiro bloqueia TODOS os deploys).
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "fails" INTEGER NOT NULL DEFAULT 0,
    "firstFailAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "LoginThrottle_updatedAt_idx" ON "LoginThrottle"("updatedAt");
