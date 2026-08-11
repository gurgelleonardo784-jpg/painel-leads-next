/**
 * Rastreio de origem para o site do cliente.
 *
 * Como usar — uma linha antes de </body>:
 *
 *   <script src="https://SEU-DOMINIO/rastreio.js" data-cliente="slug-do-cliente" defer></script>
 *
 * O que ele faz:
 *  1. na primeira visita, guarda de onde a pessoa veio (gclid, utm_*, referrer)
 *  2. reescreve todo link de WhatsApp da página para passar pelo painel
 *  3. o painel registra o clique, gera um código e manda a pessoa pro WhatsApp
 *
 * Sem isso, uma pessoa que buscou no Google e clicou no botão chega no WhatsApp
 * indistinguível de quem já tinha o número — o WhatsApp só informa a origem
 * quando o clique vem de anúncio da Meta.
 *
 * Não usa cookie de terceiros, não carrega nada de fora, não identifica pessoa:
 * guarda só os parâmetros da campanha, no localStorage do próprio site.
 */
(function () {
  "use strict";

  var script = document.currentScript || (function () {
    var todos = document.getElementsByTagName("script");
    for (var i = todos.length - 1; i >= 0; i--) {
      if (todos[i].src && todos[i].src.indexOf("rastreio.js") !== -1) return todos[i];
    }
    return null;
  })();

  if (!script) return;

  var cliente = script.getAttribute("data-cliente") || "";
  if (!cliente) {
    console.warn("[rastreio] falta data-cliente no <script>; o rastreio não vai funcionar.");
    return;
  }

  // a origem do próprio script é o painel — evita configurar domínio duas vezes
  var base = script.src.replace(/\/rastreio\.js.*$/, "");
  var CHAVE = "rastreio_origem_" + cliente;
  var CHAVE_VISITANTE = "rastreio_visitante_" + cliente;

  /**
   * Identificador do visitante, em primeira parte.
   *
   * Não identifica pessoa: é um número aleatório no localStorage deste site, e
   * serve só para amarrar as visitas do mesmo navegador. É o que permite mostrar
   * ao cliente "veio do anúncio, voltou pela busca, e só então mandou mensagem"
   * em vez de um clique solto.
   */
  function visitante() {
    try {
      var v = window.localStorage.getItem(CHAVE_VISITANTE);
      if (v) return v;
      var novo =
        (window.crypto && window.crypto.randomUUID && window.crypto.randomUUID()) ||
        String(Date.now()) + Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem(CHAVE_VISITANTE, novo);
      return novo;
    } catch (e) {
      // modo privado: sem persistência não há jornada, e o clique vale sozinho
      return "";
    }
  }

  var VISITANTE = visitante();

  var PARAMS = [
    "gclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "campaignid",
    "adgroupid",
    "creative",
  ];

  function guardado() {
    try {
      var cru = window.localStorage.getItem(CHAVE);
      return cru ? JSON.parse(cru) : null;
    } catch (e) {
      return null;
    }
  }

  function guardar(dados) {
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify(dados));
    } catch (e) {
      /* modo privado ou storage cheio: seguimos só com o que está na memória */
    }
  }

  /**
   * A origem desta visita, se a URL trouxer alguma marca.
   * Devolve null quando a página não tem nem parâmetro nem referrer externo —
   * navegação interna não é origem nova e não pode sobrescrever a que valia.
   */
  function origemDaUrl() {
    var busca = new URLSearchParams(window.location.search);
    var achou = false;
    var dados = {};

    for (var i = 0; i < PARAMS.length; i++) {
      var v = busca.get(PARAMS[i]);
      if (v) {
        dados[PARAMS[i]] = v;
        achou = true;
      }
    }

    var ref = document.referrer || "";
    var externo = false;
    if (ref) {
      try {
        externo = new URL(ref).hostname !== window.location.hostname;
      } catch (e) {
        externo = false;
      }
    }

    if (!achou && !externo) return null;

    if (externo) dados.ref = ref;
    dados.landing = window.location.origin + window.location.pathname;
    dados.em = Date.now();
    return dados;
  }

  /**
   * Primeiro toque ganha.
   *
   * Se a pessoa veio do Google Ads, navegou, saiu, voltou pelo Google orgânico
   * e só então clicou no WhatsApp, o crédito é do anúncio — foi ele que trouxe.
   * Sobrescrever com o último toque faria mídia paga parecer pior do que é.
   * Só troca quando a origem antiga passou de 30 dias.
   */
  var MAX_DIAS = 30;
  var atual = guardado();
  var nova = origemDaUrl();

  if (nova) {
    var velha = !atual || !atual.em || Date.now() - atual.em > MAX_DIAS * 864e5;
    if (velha) {
      atual = nova;
      guardar(atual);
    }
  }

  function urlDoPainel(mensagem) {
    var q = new URLSearchParams();
    if (atual) {
      for (var k in atual) {
        if (Object.prototype.hasOwnProperty.call(atual, k) && k !== "em" && atual[k]) {
          q.set(k, String(atual[k]));
        }
      }
    }
    if (mensagem) q.set("msg", mensagem);
    if (VISITANTE) q.set("vid", VISITANTE);
    return base + "/api/ir/" + encodeURIComponent(cliente) + "?" + q.toString();
  }

  /** O texto que já estava no link, para não perder o assunto daquele botão. */
  function mensagemDoLink(href) {
    try {
      var u = new URL(href, window.location.href);
      return u.searchParams.get("text") || "";
    } catch (e) {
      return "";
    }
  }

  var ALVOS = 'a[href*="wa.me"],a[href*="api.whatsapp.com"],a[href*="web.whatsapp.com"],a[data-whatsapp]';

  function reescrever(raiz) {
    var links = (raiz || document).querySelectorAll(ALVOS);
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.getAttribute("data-rastreio") === "1") continue;
      var href = a.getAttribute("href") || "";
      a.setAttribute("data-rastreio", "1");
      a.setAttribute("data-rastreio-original", href);
      a.setAttribute("href", urlDoPainel(mensagemDoLink(href)));
    }
  }

  reescrever(document);

  // sites feitos em construtor de página trocam o conteúdo depois de carregar;
  // sem isto o botão que aparece depois ficaria sem rastreio
  if (window.MutationObserver) {
    new MutationObserver(function (mudancas) {
      for (var i = 0; i < mudancas.length; i++) {
        var adicionados = mudancas[i].addedNodes;
        for (var j = 0; j < adicionados.length; j++) {
          if (adicionados[j].nodeType === 1) reescrever(adicionados[j]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /**
   * Para formulário próprio: preenche campos ocultos, se existirem.
   * Basta o formulário ter <input type="hidden" name="gclid"> etc. — aí o lead
   * de formulário também chega com a origem, e sem código nenhum visível.
   */
  function preencherFormularios() {
    if (!atual) return;
    var campos = document.querySelectorAll("input[type=hidden]");
    for (var i = 0; i < campos.length; i++) {
      var nome = campos[i].getAttribute("name") || "";
      if (!nome) continue;
      var chave = nome === "referrer" ? "ref" : nome;
      if (atual[chave] && !campos[i].value) campos[i].value = String(atual[chave]);
    }
  }
  preencherFormularios();

  // exposto para quem quiser montar o link à mão num onclick
  window.rastreioLeads = {
    origem: function () {
      return atual;
    },
    linkWhatsapp: urlDoPainel,
    reescrever: reescrever,
  };
})();
