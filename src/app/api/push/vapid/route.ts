import { NextResponse } from "next/server";
import { vapidPublicKey } from "@/lib/push";

/** Chave pública VAPID para o navegador se inscrever no push. */
export async function GET() {
  const key = vapidPublicKey();
  if (!key) {
    return NextResponse.json({ error: "push_indisponivel" }, { status: 503 });
  }
  return NextResponse.json({ key });
}
