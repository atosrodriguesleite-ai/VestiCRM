/**
 * RN-095 · A ABERTURA QUE NÃO TERMINA NÃO FICA BRANCA.
 *
 * Relato do dono (23/10/2026): a segunda cliente a reclamar que *"entra no
 * aplicativo e a tela fica toda branca"* — desta vez numa conexão de
 * Starlink no carro. Reproduzido na bancada (`scripts/bancada-tela-branca.mjs`):
 * a página do app pesa ~100 KB e, no celular, o PRIMEIRO pedaço visível (o
 * esqueleto de carregamento) só chega por volta de 25% do arquivo — tudo
 * antes dele é o menu lateral, que no celular fica escondido. Se a conexão
 * cai entre 3% e 25% do download (uma troca de satélite, um túnel), o
 * navegador desenha o que recebeu — o fundo, e nada mais — e fica assim
 * PARA SEMPRE: sem erro, sem botão, sem mensagem. A tela de socorro da
 * RN-066 não alcança esse caso: ela é JavaScript, e o JavaScript nunca
 * chegou.
 *
 * Então o remédio tem que viajar nos PRIMEIROS bytes da página e não
 * depender de nada: um script miúdo, escrito à mão em JavaScript antigo,
 * que é o primeiro filho do `<body>` (chega junto com o `<head>`, a ~3% do
 * arquivo) e observa se a página terminou de chegar — o sinal é um marcador
 * que o layout raiz põe no FIM do esqueleto da página (`ID_FIM_DA_PAGINA`).
 *
 * Quatro decisões:
 *
 *  1. **Só age quando há CERTEZA de que a página não veio inteira**: o
 *     documento terminou (`readyState === "complete"`) sem o marcador e sem
 *     nada visível (a página cortada); ou o download PAROU — nenhum nó novo
 *     chegou — por `PRAZO_BRANCO_MS` sem nada visível, ou por
 *     `PRAZO_INCOMPLETO_MS` mesmo com algo na tela; ou a tela ficou presa no
 *     esqueleto de carregamento do app por `PRAZO_INCOMPLETO_MS` depois de
 *     ele aparecer; ou passou `PRAZO_DE_VIGIA_MS` sem a página inteira. A
 *     página lenta que AINDA está chegando não é incomodada: "parou" é
 *     medido pelo progresso (a contagem de nós do documento), não pelo
 *     relógio — num link de 15 kbps a página demora, mas anda.
 *  2. **Nunca recarrega sozinho com internet** (a régua da RN-066): mostra
 *     em português o que houve e o botão "Tentar de novo". Só SEM internet
 *     ele espera o evento `online` e aí recarrega — é o caso do app
 *     instalado do iPhone, em que o sistema mostra branco sem botão nenhum.
 *     Se a página terminar de chegar depois do aviso, o aviso some.
 *  3. **Depois que a página chegou inteira, ele se cala para sempre**: a
 *     navegação seguinte dentro do app (que mostra o mesmo esqueleto) e a
 *     tela de socorro da RN-066 (que troca o corpo inteiro e leva o marcador
 *     junto) não são assunto dele. Um laço só, a cada 2 s, por no máximo
 *     `PRAZO_DE_VIGIA_MS` — ou enquanto o aviso estiver na tela.
 *  4. **Conta ao painel de Saúde** pelo MESMO caminho da RN-066: guarda o
 *     relato no aparelho (`CHAVE_RELATO_PENDENTE`, o mesmo formato) e quem
 *     o manda é o `EnviarRelatoDeErro`, no próximo carregamento que der
 *     certo — a fonte é própria (`FONTE_TELA_ABERTURA`): é rede, não código,
 *     então fica fora da conta de erros, mas na lista, para se SABER quantas
 *     aberturas falham e em que conexão. Um relato de quebra de código já
 *     guardado não é sobrescrito — ele vale mais.
 *
 * O texto do script é montado AQUI a partir das constantes, para o teste e
 * a página lerem a mesma coisa. Ele não pode conter crases, `${` nem a
 * sequência `</script` — vai inteiro dentro de uma tag `<script>`.
 */

import { CHAVE_RELATO_PENDENTE, EVENTO_RELATO_GUARDADO } from "./erro-da-tela";

/** o marcador que o layout raiz põe como ÚLTIMO filho do `<body>` */
export const ID_FIM_DA_PAGINA = "atacadopro-fim";

/** o aviso que o vigia desenha por cima da página */
export const ID_DO_VIGIA = "atacadopro-vigia";

/** o esqueleto de carregamento do app (`app/(app)/loading.tsx`) */
export const SELETOR_DO_ESQUELETO = '[aria-busy="true"][aria-label="Carregando"]';

/** download PARADO (nenhum nó novo) há tanto tempo, e NADA visível: a página não vem */
export const PRAZO_BRANCO_MS = 12_000;

/** download parado há tanto tempo mesmo com algo na tela; ou preso no esqueleto por tanto */
export const PRAZO_INCOMPLETO_MS = 40_000;

/** passou disto sem a página inteira, mesmo andando: não vai dar; e o vigia para de olhar */
export const PRAZO_DE_VIGIA_MS = 60_000;

/** intervalo entre duas conferências */
export const MS_ENTRE_CONFERENCIAS = 2_000;

/**
 * Fonte no painel de Saúde. Fora da conta de erros (é a conexão da cliente,
 * não o código), mas listada em bloco próprio — a régua da `tela.versao`
 * (RN-066) e da `catalogo.recusa` (RN-010).
 */
export const FONTE_TELA_ABERTURA = "tela.abertura";

/**
 * A chave e o evento do relato são os da RN-066 (`erro-da-tela.ts` é puro,
 * sem imports — seguro de puxar para quem monta o script da página).
 */
const CHAVE_RELATO = CHAVE_RELATO_PENDENTE;
const EVENTO_RELATO = EVENTO_RELATO_GUARDADO;

/**
 * O script, em JavaScript antigo (o Safari de iPhone velho precisa abrir
 * esta página tanto quanto o Chrome novo). Sem dependência nenhuma.
 */
export const SCRIPT_DO_VIGIA: string = [
  "(function(){",
  'if(typeof document==="undefined"||!document.documentElement)return;',
  "var INICIO=Date.now();",
  `var PRAZO_BRANCO=${PRAZO_BRANCO_MS},PRAZO_INCOMPLETO=${PRAZO_INCOMPLETO_MS},PRAZO_VIGIA=${PRAZO_DE_VIGIA_MS},ENTRE=${MS_ENTRE_CONFERENCIAS};`,
  `var ID_FIM="${ID_FIM_DA_PAGINA}",ID_VIGIA="${ID_DO_VIGIA}",CHAVE="${CHAVE_RELATO}",EVENTO="${EVENTO_RELATO}";`,
  `var ESQUELETO='${SELETOR_DO_ESQUELETO}';`,
  "var mostrado=false,recarregando=false,encerrado=false,agendado=false,jaChegou=false,esqueletoDesde=0,idDoRelato=null;",
  // o progresso do download: a contagem de nós do documento (barata — é a
  // length de uma coleção viva); muda = ainda está chegando
  "var contagem=document.getElementsByTagName('*').length,paradoDesde=INICIO;",
  "function chegouInteira(){return !!document.getElementById(ID_FIM);}",
  "function presoNoEsqueleto(){try{return !!document.querySelector(ESQUELETO);}catch(e){return false;}}",
  "function online(){return typeof navigator==='undefined'||navigator.onLine!==false;}",
  "function progrediu(agora){var n=document.getElementsByTagName('*').length;if(n!==contagem){contagem=n;paradoDesde=agora;}}",
  // algo que a PESSOA vê na tela, fora do próprio aviso: texto, imagem,
  // botão, ou uma caixa pintada (o esqueleto de carregamento). Um contêiner
  // vazio com altura NÃO conta — é exatamente a tela branca
  "function temAlgoVisivel(){var corpo=document.body;if(!corpo)return false;var tudo=corpo.querySelectorAll('*');",
  "for(var i=0;i<tudo.length;i++){var el=tudo[i];var tag=(el.tagName||'').toUpperCase();",
  "if(tag==='SCRIPT'||tag==='STYLE'||tag==='LINK'||tag==='META'||tag==='TEMPLATE'||tag==='NOSCRIPT')continue;",
  "if(!(el.offsetWidth>0&&el.offsetHeight>0))continue;",
  "var p=el,dentro=false;while(p&&p!==corpo){if(p.id===ID_VIGIA){dentro=true;break;}p=p.parentNode;}",
  "if(dentro)continue;",
  "if(tag==='IMG'||tag==='SVG'||tag==='CANVAS'||tag==='VIDEO'||tag==='INPUT'||tag==='BUTTON'||tag==='SELECT'||tag==='TEXTAREA')return true;",
  "var ns=el.childNodes;for(var j=0;j<ns.length;j++){if(ns[j].nodeType===3&&/\\S/.test(ns[j].nodeValue||''))return true;}",
  "if(el.children.length===0){try{var cs=window.getComputedStyle(el);var bg=cs.backgroundColor||'';",
  "if((bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')||(cs.backgroundImage&&cs.backgroundImage!=='none'))return true;}catch(e){}}",
  "}return false;}",
  // o relato, no formato da RN-066, só se não houver um de quebra de código esperando
  "function guardarRelato(motivo){try{var ls=window.localStorage;if(!ls||ls.getItem(CHAVE))return;",
  "var primeiro=(window.location.pathname||'/').split('/')[1];var caminho=primeiro?'/'+primeiro:'/';",
  "var seg=Math.round((Date.now()-INICIO)/1000);var id='ab-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);",
  "ls.setItem(CHAVE,JSON.stringify({id:id,",
  "mensagem:'Abertura não terminou: '+motivo+' ('+seg+'s, '+(online()?'com internet':'sem internet')+')',",
  "detalhe:'readyState: '+document.readyState+'\\nnavegador: '+((navigator&&navigator.userAgent)||'').slice(0,200),",
  "caminho:caminho,versaoVelha:false,recarregouSozinho:false,abertura:true,quando:new Date().toISOString()}));idDoRelato=id;",
  // quem manda o relato pode já estar na página (o caso "presa no esqueleto"): avisa — em JavaScript antigo
  "try{var ev=document.createEvent('Event');ev.initEvent(EVENTO,false,false);window.dispatchEvent(ev);}catch(e2){}}catch(e){}}",
  // a página que se recuperou NÃO fica no painel como "não terminou": o relato dela sai
  "function apagarRelato(){if(!idDoRelato)return;try{var ls=window.localStorage;var t=ls&&ls.getItem(CHAVE);",
  "if(t&&JSON.parse(t).id===idDoRelato)ls.removeItem(CHAVE);}catch(e){}idDoRelato=null;}",
  "function recarregar(){if(recarregando)return;recarregando=true;try{window.location.reload();}catch(e){}}",
  "function esconder(){var c=document.getElementById(ID_VIGIA);if(c&&c.parentNode)c.parentNode.removeChild(c);}",
  "function encerrar(){encerrado=true;esconder();apagarRelato();}",
  "function el(tag,css,texto){var e=document.createElement(tag);e.style.cssText=css;if(texto)e.textContent=texto;return e;}",
  "function mostrar(motivo){if(mostrado)return;mostrado=true;guardarRelato(motivo);var semRede=!online();",
  "var caixa=el('div','position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px 16px;text-align:center;background:#f6efe5;color:#1d1710;font-family:system-ui,-apple-system,\"Segoe UI\",sans-serif');",
  "caixa.id=ID_VIGIA;caixa.setAttribute('role','alert');",
  "caixa.appendChild(el('p','font-size:18px;font-weight:700;margin:0',semRede?'Sem conexão com a internet':'O AtacadoPro não terminou de carregar'));",
  "caixa.appendChild(el('p','font-size:15px;margin:0;max-width:360px;line-height:1.45',semRede?'O app precisa de internet para abrir. Assim que a conexão voltar ele tenta de novo sozinho — ou toque no botão.':'A página não chegou inteira: a conexão falhou no meio do caminho. Nada se perdeu — toque para tentar de novo.'));",
  "var b=el('button','margin-top:8px;padding:12px 20px;border-radius:12px;border:none;background:#c4622d;color:#fff;font-size:15px;font-weight:600;cursor:pointer','Tentar de novo');",
  "b.type='button';b.onclick=recarregar;caixa.appendChild(b);",
  "(document.body||document.documentElement).appendChild(caixa);",
  "if(semRede)window.addEventListener('online',recarregar,{once:true});}",
  "function conferir(){if(encerrado)return;var agora=Date.now(),passou=agora-INICIO;",
  "if(chegouInteira()){jaChegou=true;",
  // chegou inteira e saiu do esqueleto: acabou (e o aviso, se houve, some)
  "if(!presoNoEsqueleto()){encerrar();return;}",
  "if(!esqueletoDesde)esqueletoDesde=agora;",
  "if(agora-esqueletoDesde>=PRAZO_INCOMPLETO)mostrar('a tela ficou presa no carregando');}",
  // a página chegou inteira e DEPOIS o marcador sumiu (a tela de socorro da
  // RN-066 trocou o corpo): não é assunto do vigia
  "else if(jaChegou){encerrar();return;}",
  // com o aviso na tela só se espera a página chegar
  "else if(mostrado){}",
  // o parser terminou ('interactive' ou 'complete') sem o marcador: a página
  // chegou cortada, com certeza — esperar o `load` (uma foto pendurada) só atrasaria
  "else if(document.readyState!=='loading'){if(passou>=PRAZO_INCOMPLETO||!temAlgoVisivel())mostrar('a página chegou cortada');}",
  "else{progrediu(agora);var parado=agora-paradoDesde;",
  "if(parado>=PRAZO_INCOMPLETO||(parado>=PRAZO_BRANCO&&!temAlgoVisivel()))mostrar('o download parou no meio');",
  "else if(passou>=PRAZO_VIGIA)mostrar('o download não terminou');}",
  "if(passou<PRAZO_VIGIA||(mostrado&&passou<PRAZO_VIGIA*5))agendar();}",
  // UM laço só: o `load` confere na hora, mas não abre um segundo relógio
  "function agendar(){if(agendado||encerrado)return;agendado=true;setTimeout(function(){agendado=false;conferir();},ENTRE);}",
  "agendar();",
  // o parser terminou / a página carregou: confere na hora (a página que
  // chegou inteira e quebrou na hidratação ANTES do 1º tique já fica como
  // "chegou", e a tela de socorro da RN-066 não ganha o aviso errado por cima)
  "document.addEventListener('DOMContentLoaded',conferir);",
  "window.addEventListener('load',conferir);",
  "})();",
].join("");

/** o que a página escreve dentro da tag `<script>` — conferido pelo teste */
export function scriptDoVigiaEhSeguro(script: string): boolean {
  return !/<\/script/i.test(script) && !script.includes("`") && !script.includes("${");
}
