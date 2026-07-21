/** URL absoluta da plataforma (landing/login), configurável por ambiente. */
export function platformUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.MAIN_SITE_URL?.trim() ||
    "https://www.atacadopro.com"
  ).replace(/\/$/, "");
}
