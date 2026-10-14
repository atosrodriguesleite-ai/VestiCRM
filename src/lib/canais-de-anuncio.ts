/**
 * OS CANAIS DE ANÚNCIO (`MarketingCampaign.channel`) — a lista mora aqui,
 * UMA vez, para o formulário da campanha (Marketing) e o BI (RN-085)
 * mostrarem o mesmo rótulo. Canal novo entra aqui e chega aos dois.
 */
export const CANAIS_DE_ANUNCIO: { value: string; label: string }[] = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "GOOGLE", label: "Google" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "OUTRO", label: "Outro" },
];

export const rotuloDoCanal = (v: string) => CANAIS_DE_ANUNCIO.find((c) => c.value === v)?.label ?? v;
