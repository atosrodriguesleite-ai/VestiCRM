/* Service Worker do AtacadoPro.
 *
 * Duas tarefas, e só elas:
 *
 * 1. Receber as notificações de venda (Web Push) e mostrar o aviso na tela
 *    do celular, mesmo com o app fechado.
 *
 * 2. RN-095 · Quando a NAVEGAÇÃO não consegue chegar ao servidor (sem
 *    internet, rede que caiu ao abrir), responder a página "Sem conexão" em
 *    vez do branco do sistema — no app instalado do iPhone, uma navegação
 *    que falha vira uma tela branca sem botão nenhum.
 *
 * O que este arquivo NUNCA faz: guardar página do app em cache, nem a
 * própria página de reserva. É "rede primeiro, sempre" — só quando a rede
 * FALHA (a promessa do fetch rejeita) entra a reserva, e ela mora AQUI, no
 * texto deste arquivo, com os botões escritos nela: uma página do app
 * guardada em cache precisaria do código do React para o botão funcionar, e
 * offline esse código não vem (achado da revisão). Resposta do servidor,
 * qualquer que seja (200, 404, 500), passa como veio. Assim não existe
 * "versão velha servida pelo service worker", que é o defeito clássico de
 * app instalado (ADR-022).
 */

var HTML_SEM_CONEXAO =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#16100B"><title>Sem conexão — AtacadoPro</title></head>' +
  '<body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px 16px;text-align:center;background:#f6efe5;color:#1d1710;font-family:system-ui,-apple-system,sans-serif">' +
  '<p style="font-size:18px;font-weight:700;margin:0">Sem conexão com a internet</p>' +
  '<p style="font-size:15px;margin:0;max-width:360px;line-height:1.45">O AtacadoPro precisa de internet para abrir. Assim que a conexão voltar ele tenta de novo sozinho — ou toque no botão.</p>' +
  '<button type="button" onclick="location.reload()" style="margin-top:8px;padding:12px 20px;border-radius:12px;border:none;background:#c4622d;color:#fff;font-size:15px;font-weight:600">Tentar de novo</button>' +
  "<script>window.addEventListener('online',function(){location.reload()},{once:true})</script></body></html>";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // a navegação sai em PARALELO com a partida do service worker: sem
      // isto, cada abertura de página esperaria o worker acordar (100–500 ms
      // no celular) para só então pedir a página ao servidor
      self.registration.navigationPreload
        ? self.registration.navigationPreload.enable().catch(function () {})
        : Promise.resolve(),
    ])
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  // SÓ a navegação (abrir uma página). Chamadas de API, fotos, código e
  // tudo o mais seguem direto para a rede, sem passar por aqui.
  if (req.mode !== "navigate") return;
  var mesmaOrigem = false;
  try {
    mesmaOrigem = new URL(req.url).origin === self.location.origin;
  } catch (e) {
    mesmaOrigem = false;
  }
  if (!mesmaOrigem) return;
  // Um link de DOWNLOAD (`<a download href="/api/img/…?baixar=1">`, o PDF do
  // catálogo, o relatório do BI) também é "navegação" para o navegador — e
  // a reserva ali viraria um .jpg com a página "Sem conexão" dentro. Nada
  // de /api passa por aqui: o navegador avisa que o download falhou.
  var caminho = "";
  try {
    caminho = new URL(req.url).pathname;
  } catch (e) {
    caminho = "";
  }
  if (caminho.indexOf("/api/") === 0) return;
  var daRede = event.preloadResponse
    ? event.preloadResponse.then(function (r) {
        return r || fetch(req);
      })
    : fetch(req);
  event.respondWith(
    daRede.catch(function () {
      // a REDE falhou (não é resposta de erro do servidor): a página de reserva
      return new Response(HTML_SEM_CONEXAO, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    })
  );
});

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  var title = data.title || "AtacadoPro";
  var options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "atacadopro",
    data: { url: data.url || "/dashboard" },
    vibrate: [90, 40, 90],
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if ("focus" in client) {
          client.navigate(url).catch(function () {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
