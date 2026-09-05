import { db } from "../db";

/**
 * Carimba "esta loja já teve WhatsApp" (RN-049) — só na PRIMEIRA vez, e
 * nunca desfaz. Chamado onde a conexão vira real: o estado do Evolution
 * passando a CONECTADO (pela sondagem da tela ou pelo webhook) e a escolha
 * da API oficial nas configurações. O Desconectar não passa por aqui de
 * propósito: é o carimbo que mantém o histórico à vista depois dele.
 */
export async function registrarPrimeiraConexao(companyId: string): Promise<void> {
  await db.commSettings
    .updateMany({
      where: { companyId, whatsappConectadoEm: null },
      data: { whatsappConectadoEm: new Date() },
    })
    .catch(() => {});
}
