/**
 * Testes da leitura do referral e do motor de atribuição. Rode: npm run testar
 *
 * Cobre a parte que decide de qual anúncio o lead veio — a única coisa do fluxo
 * que dá para verificar sem banco, sem rede e sem credencial da Meta. Se algum
 * destes casos parar de passar, leads vão ser atribuídos errado (ou atribuídos a
 * uma campanha que não existe), e isso não aparece em tela: aparece num relatório
 * de CPL que parece plausível e está errado.
 *
 * O que NÃO está coberto aqui, e por quê: idempotência (§22), gravação e
 * multi-tenancy dependem de um Postgres de verdade; a consulta da estrutura do
 * anúncio depende de um token com ads_read.
 */

import { extrairEventoWhatsApp } from "../lib/whatsapp";
import { atribuicaoDoReferral, atribuicaoDoClique } from "../lib/atribuicao";
import { classificarCanal, campanhaDosSinais, resumoUtm } from "../lib/canal";
import { proximaEtapa } from "../lib/apresentacao";
import { codigoNoTexto, gerarCodigo, canalDoPrefixo } from "../lib/cliques";

let falhas = 0;
let passes = 0;

function conferir(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passes++;
    console.log(`  \x1b[32mok\x1b[0m   ${nome}`);
  } else {
    falhas++;
    console.log(`  \x1b[31mFALHOU\x1b[0m ${nome}\n         esperado: ${b}\n         obtido:   ${a}`);
  }
}

function valor(mensagens: unknown[], contacts: unknown[] = []) {
  return {
    metadata: { phone_number_id: "1112223334445", display_phone_number: "+55 85 3333-4444" },
    contacts,
    messages: mensagens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/* ---------- §18: o exemplo literal da especificação ---------- */

console.log("\n§18 — anúncio Click-to-WhatsApp (o exemplo da spec)");
{
  const ev = extrairEventoWhatsApp("102290129340398", valor(
    [
      {
        id: "wamid.AAA1",
        from: "5585999999999",
        timestamp: "1754650260",
        type: "text",
        text: { body: "Olá, gostaria de saber o preço." },
        referral: {
          source_id: "120000000000000",
          source_type: "ad",
          source_url: "https://fb.me/abc",
          headline: "Conheça nossa oferta",
          ctwa_clid: "ARBxc123",
        },
      },
    ],
    [{ wa_id: "5585999999999", profile: { name: "João" } }]
  ));

  conferir("waba_id vem do entry.id", ev.wabaId, "102290129340398");
  conferir("phone_number_id", ev.phoneNumberId, "1112223334445");
  conferir("telefone comercial", ev.displayPhoneNumber, "+55 85 3333-4444");
  conferir("1 mensagem extraída", ev.mensagens.length, 1);

  const m = ev.mensagens[0];
  conferir("telefone do lead", m.telefone, "5585999999999");
  conferir("nome do perfil", m.nomePerfil, "João");
  conferir("texto da 1ª mensagem", m.texto, "Olá, gostaria de saber o preço.");
  conferir("message.id preservado (chave do §22)", m.id, "wamid.AAA1");
  conferir("timestamp virou data", m.em?.toISOString(), new Date(1754650260 * 1000).toISOString());
  conferir("ctwa_clid capturado (§14)", m.ctwaClid, "ARBxc123");
  conferir("referral inteiro guardado (§13)", m.referral?.headline, "Conheça nossa oferta");

  const a = atribuicaoDoReferral(m.referral, m.ctwaClid);
  conferir("ad_id = referral.source_id (§16)", a.adId, "120000000000000");
  conferir("fonte", a.fonte, "meta_ads");
  conferir("status (§35)", a.status, "attributed");
  conferir("método", a.metodo, "whatsapp_referral");
  conferir("confiança", a.confianca, "high");
  conferir("source_type", a.sourceType, "ad");
  conferir("source_url", a.sourceUrl, "https://fb.me/abc");
  conferir("headline NÃO virou campanha", (a as Record<string, unknown>).campanha, undefined);
}

/* ---------- §17 nível 4 / §44 Teste 2: orgânico ---------- */

console.log("\n§17 nível 4 — mensagem orgânica");
{
  const ev = extrairEventoWhatsApp("W1", valor([
    { id: "wamid.ORG", from: "5511988887777", timestamp: "1754650300", type: "text", text: { body: "bom dia" } },
  ]));
  const a = atribuicaoDoReferral(ev.mensagens[0].referral, ev.mensagens[0].ctwaClid);
  conferir("fonte = organic", a.fonte, "organic");
  conferir("status = organic", a.status, "organic");
  conferir("método = none", a.metodo, "none");
  conferir("sem confiança", a.confianca, null);
  conferir("sem ad_id inventado (§17: NÃO inventar campanha)", a.adId, "");
}

/* ---------- source_type = post: não é anúncio ---------- */

console.log("\nsource_type = post — publicação orgânica, não anúncio");
{
  const a = atribuicaoDoReferral(
    { source_id: "998877", source_type: "post", headline: "post do feed" },
    ""
  );
  conferir("não trata id de post como ad_id", a.adId, "");
  conferir("status = pending", a.status, "pending");
  conferir("confiança media", a.confianca, "medium");
}

/* ---------- referral só com ctwa_clid ---------- */

console.log("referral só com ctwa_clid — veio de anúncio, mas não se sabe qual");
{
  const a = atribuicaoDoReferral({ ctwa_clid: "ARBzzz" }, "ARBzzz");
  conferir("fonte = meta_ads", a.fonte, "meta_ads");
  conferir("status = pending", a.status, "pending");
  conferir("clid guardado para a CAPI (§31)", a.ctwaClid, "ARBzzz");
  conferir("sem ad_id", a.adId, "");
}

/* ---------- clid fora do referral (variação do payload) ---------- */

console.log("ctwa_clid fora do bloco referral");
{
  const ev = extrairEventoWhatsApp("W1", valor([
    { id: "wamid.C", from: "5511900000000", timestamp: "1754650400", type: "text", text: { body: "oi" }, ctwa_clid: "ARBfora" },
  ]));
  conferir("clid capturado mesmo assim", ev.mensagens[0].ctwaClid, "ARBfora");
}

/* ---------- tipos de mensagem sem `text` ---------- */

console.log("\nmensagem que não é texto");
{
  const ev = extrairEventoWhatsApp("W1", valor([
    { id: "wamid.B1", from: "5511911112222", timestamp: "1754650500", type: "button", button: { text: "Quero saber mais" } },
    {
      id: "wamid.B2",
      from: "5511911113333",
      timestamp: "1754650501",
      type: "interactive",
      interactive: { button_reply: { title: "Ver preços" } },
    },
    { id: "wamid.B3", from: "5511911114444", timestamp: "1754650502", type: "image" },
  ]));
  conferir("botão do anúncio virou primeira mensagem", ev.mensagens[0].texto, "Quero saber mais");
  conferir("resposta interativa também", ev.mensagens[1].texto, "Ver preços");
  conferir("imagem entra sem texto, mas entra", ev.mensagens[2].texto, "");
  conferir("nenhuma mensagem perdida", ev.mensagens.length, 3);
}

/* ---------- payloads que devem ser ignorados ---------- */

console.log("\npayloads a descartar");
{
  const ev = extrairEventoWhatsApp("W1", valor([
    { from: "5511900000000", timestamp: "1", type: "text", text: { body: "sem id" } },
    { id: "wamid.X", timestamp: "1", type: "text", text: { body: "sem telefone" } },
  ]));
  conferir("mensagem sem id ou sem telefone é descartada", ev.mensagens.length, 0);
}
{
  const ev = extrairEventoWhatsApp("W1", valor([]));
  conferir("evento de status (sem messages) não gera nada", ev.mensagens.length, 0);
}
{
  const ev = extrairEventoWhatsApp("W1", valor([
    { id: "wamid.T", from: "+55 (85) 99999-8888", timestamp: "1754650600", type: "text", text: { body: "oi" } },
  ]));
  conferir("telefone normalizado para dígitos", ev.mensagens[0].telefone, "5585999998888");
}

/* ================= tráfego do site: Google Ads e orgânico ================= */

console.log("\nCanal — identificador de clique manda em tudo");
{
  conferir("gclid = Google Ads", classificarCanal({ gclid: "Cj0KCQ" }), "google_ads");
  conferir("gbraid (iOS) também", classificarCanal({ gbraid: "abc" }), "google_ads");
  conferir("wbraid também", classificarCanal({ wbraid: "abc" }), "google_ads");
  conferir("fbclid = Meta Ads", classificarCanal({ fbclid: "IwAR" }), "meta_ads");
  conferir(
    "gclid vence referrer de busca orgânica",
    classificarCanal({ gclid: "Cj0", referrer: "https://www.google.com/" }),
    "google_ads"
  );
}

console.log("\nCanal — UTM quando não há identificador de clique");
{
  conferir(
    "google + cpc = Ads",
    classificarCanal({ utmSource: "google", utmMedium: "cpc" }),
    "google_ads"
  );
  conferir(
    "google + organic = orgânico",
    classificarCanal({ utmSource: "google", utmMedium: "organic" }),
    "google_organico"
  );
  conferir(
    "facebook + paid = Meta Ads",
    classificarCanal({ utmSource: "facebook", utmMedium: "paid" }),
    "meta_ads"
  );
  conferir(
    "instagram sem meio pago = social",
    classificarCanal({ utmSource: "instagram", utmMedium: "bio" }),
    "social"
  );
  conferir(
    "e-mail = indicação",
    classificarCanal({ utmSource: "rd", utmMedium: "email" }),
    "referencia"
  );
}

console.log("\nCanal — referrer, o sinal mais fraco");
{
  conferir(
    "google.com sem gclid = orgânico",
    classificarCanal({ referrer: "https://www.google.com/" }),
    "google_organico"
  );
  conferir(
    "google.com.br também",
    classificarCanal({ referrer: "https://www.google.com.br/search?q=advogado" }),
    "google_organico"
  );
  conferir("bing = busca orgânica", classificarCanal({ referrer: "https://www.bing.com/" }), "busca_organica");
  conferir(
    "instagram = social",
    classificarCanal({ referrer: "https://l.instagram.com/" }),
    "social"
  );
  conferir(
    "outro site = indicação",
    classificarCanal({ referrer: "https://blogdoparceiro.com.br/post" }),
    "referencia"
  );
  conferir(
    "navegação interna não é origem",
    classificarCanal({
      referrer: "https://cliente.com.br/servicos",
      landing: "https://cliente.com.br/contato",
    }),
    "desconhecido"
  );
}

console.log("\nCanal — o que NÃO se deve concluir");
{
  // é o ponto mais importante do arquivo: sem sinal, não se inventa origem
  conferir("sem nada = desconhecido, não direto", classificarCanal({}), "desconhecido");
  conferir(
    "referrer ilegível = desconhecido",
    classificarCanal({ referrer: "nao-e-uma-url" }),
    "desconhecido"
  );
}

console.log("\nNome da campanha sem chamar API nenhuma");
{
  conferir(
    "utm_campaign é o nome",
    campanhaDosSinais({ utmCampaign: "Advogados - Search" }),
    "Advogados - Search"
  );
  conferir(
    "sem utm, o id do ValueTrack marcado com #",
    campanhaDosSinais({ campanhaId: "21458920134" }),
    "#21458920134"
  );
  // o erro de configuração mais comum: utm_campaign={campaignid} manda o ID
  // onde deveria vir o nome. Se passasse cru, a coluna "Campanha" do cliente
  // mostraria um número como se fosse nome de campanha.
  conferir(
    "utm_campaign que é só número é tratado como ID",
    campanhaDosSinais({ utmCampaign: "21458920134" }),
    "#21458920134"
  );
  conferir(
    "nome com número dentro continua nome",
    campanhaDosSinais({ utmCampaign: "Advogados 2026" }),
    "Advogados 2026"
  );
  conferir(
    "número curto não é ID (pode ser nome de campanha)",
    campanhaDosSinais({ utmCampaign: "2026" }),
    "2026"
  );
  conferir("sem nada, vazio", campanhaDosSinais({}), "");
  conferir(
    "palavra-chave entra no resumo de UTM",
    resumoUtm({ utmSource: "google", utmMedium: "cpc", utmTerm: "advogado trabalhista" }),
    "source=google · medium=cpc · term=advogado trabalhista"
  );
}

console.log("\nAtribuição a partir do clique no site");
{
  const ads = atribuicaoDoClique({
    id: "1",
    canal: "google_ads",
    gclid: "Cj0KCQ",
    campanha: "Advogados - Search",
    grupo: "Trabalhista",
    criativo: "#5566",
    landing: "https://cliente.com.br/",
  });
  conferir("fonte", ads.fonte, "google_ads");
  conferir("status attributed (tem nome de campanha)", ads.status, "attributed");
  conferir("método", ads.metodo, "site_click");
  conferir("confiança alta com gclid", ads.confianca, "high");
  conferir("gclid guardado para a conversão", ads.gclid, "Cj0KCQ");
  conferir("campanha", ads.campanha, "Advogados - Search");

  const semNome = atribuicaoDoClique({
    id: "2",
    canal: "google_ads",
    gclid: "Cj0",
    campanha: "#2145",
    grupo: "",
    criativo: "",
    landing: "",
  });
  conferir("só o id da campanha = pending", semNome.status, "pending");

  const organico = atribuicaoDoClique({
    id: "3",
    canal: "google_organico",
    gclid: "",
    campanha: "",
    grupo: "",
    criativo: "",
    landing: "https://cliente.com.br/",
  });
  conferir("orgânico não é attributed", organico.status, "organic");
  conferir("orgânico do Google guarda a fonte", organico.fonte, "google_organico");
  conferir("confiança média sem gclid", organico.confianca, "medium");

  const nada = atribuicaoDoClique({
    id: "4",
    canal: "desconhecido",
    gclid: "",
    campanha: "",
    grupo: "",
    criativo: "",
    landing: "",
  });
  conferir("desconhecido = unknown", nada.status, "unknown");
  conferir("confiança baixa", nada.confianca, "low");
}

console.log("\nO código na mensagem — origem no prefixo");
{
  // cada tipo de origem tem que produzir o prefixo certo, porque é ele que
  // sobrevive quando a gravação do clique falha
  const casos: { nome: string; sinais: Parameters<typeof classificarCanal>[0]; prefixo: string }[] = [
    { nome: "gclid", sinais: { gclid: "Cj0KCQ" }, prefixo: "PAG" },
    { nome: "fbclid", sinais: { fbclid: "IwAR1" }, prefixo: "PAG" },
    { nome: "utm_medium=cpc", sinais: { utmSource: "google", utmMedium: "cpc" }, prefixo: "PAG" },
    { nome: "utm_medium=paid", sinais: { utmSource: "bing", utmMedium: "paid" }, prefixo: "PAG" },
    { nome: "referrer instagram", sinais: { referrer: "https://www.instagram.com/" }, prefixo: "IG" },
    { nome: "utm_source instagram", sinais: { utmSource: "instagram", utmMedium: "social" }, prefixo: "IG" },
    { nome: "referrer facebook", sinais: { referrer: "https://www.facebook.com/" }, prefixo: "FB" },
    { nome: "referrer google", sinais: { referrer: "https://www.google.com/search?q=x" }, prefixo: "ORG" },
    { nome: "referrer bing", sinais: { referrer: "https://www.bing.com/search?q=x" }, prefixo: "ORG" },
    { nome: "outro site", sinais: { referrer: "https://portaldedireito.com.br/artigo" }, prefixo: "REF" },
    { nome: "sem referrer e sem utm", sinais: {}, prefixo: "DIR" },
  ];

  for (const c of casos) {
    const codigo = gerarCodigo(classificarCanal(c.sinais), c.sinais);
    conferir(`${c.nome} -> ${c.prefixo}`, codigo.split("-")[0], c.prefixo);
  }

  const exemplo = gerarCodigo(classificarCanal({ gclid: "x" }), { gclid: "x" });
  conferir("formato PREFIXO-XXXX", /^[A-Z]{2,3}-[A-Z0-9]{4}$/.test(exemplo), true);
  conferir("sufixo tem 4 caracteres", exemplo.split("-")[1].length, 4);
  conferir("sem O, 0, I nem 1 no sufixo", /[O0I1]/.test(exemplo.split("-")[1]), false);

  // o mesmo código nunca deve sair duas vezes seguidas
  const muitos = new Set(Array.from({ length: 500 }, () => gerarCodigo("google_ads")));
  conferir("500 códigos, nenhum repetido", muitos.size, 500);
}

console.log("\nAchar o código na mensagem recebida");
{
  conferir(
    "acha no fim da frase",
    codigoNoTexto("Olá! Vim pelo site e quero informações. Ref: PAG-7K3M"),
    "PAG-7K3M"
  );
  conferir("acha no meio", codigoNoTexto("oi ORG-4B9Z tudo bem"), "ORG-4B9Z");
  conferir("minúscula também vale", codigoNoTexto("oi ig-4b9z"), "IG-4B9Z");
  conferir("sem código, vazio", codigoNoTexto("Olá, quero informações"), "");
  conferir("prefixo inexistente é ignorado", codigoNoTexto("veja XYZ-1234"), "");
  conferir("sufixo curto demais é ignorado", codigoNoTexto("veja PAG-7K"), "");
  conferir("o próprio gerador é reconhecido", (() => {
    const c = gerarCodigo("google_organico");
    return codigoNoTexto(`Olá! Vim pelo site. Ref: ${c}`) === c;
  })(), true);

  // a rede de segurança: código válido cujo clique não foi gravado
  conferir("PAG sem linha no banco vira mídia paga", canalDoPrefixo("PAG-7K3M"), "pago");
  conferir("ORG vira busca orgânica", canalDoPrefixo("ORG-4B9Z"), "busca_organica");
  conferir("IG vira redes sociais", canalDoPrefixo("IG-4B9Z"), "social");
  conferir("REF vira indicação", canalDoPrefixo("REF-4B9Z"), "referencia");
  conferir("DIR vira desconhecido, não 'direto'", canalDoPrefixo("DIR-4B9Z"), "desconhecido");
  conferir("prefixo inválido não vira canal", canalDoPrefixo("XXX-4B9Z"), null);
}


/* ---------- avançar etapa: ganho não pode virar perdido ---------- */

console.log("\nAvançar etapa no funil");
{
  const funil = ["Novo", "Em contato", "Qualificado", "Ganho", "Perdido"];
  conferir("Novo avança para Em contato", proximaEtapa("Novo", funil), "Em contato");
  conferir("Qualificado avança para Ganho", proximaEtapa("Qualificado", funil), "Ganho");
  // o bug que isto tranca: por índice, o próximo de "Ganho" era "Perdido", e um
  // clique no card transformava venda fechada em negócio perdido
  conferir("Ganho não avança para lugar nenhum", proximaEtapa("Ganho", funil), null);
  conferir("Perdido não avança", proximaEtapa("Perdido", funil), null);

  const renomeado = ["Recebido", "Em atendimento", "Fechado", "Descartado"];
  conferir("reconhece perda renomeada", proximaEtapa("Fechado", renomeado), null);
  conferir("etapa desconhecida cai na primeira", proximaEtapa("Sei lá", funil), "Novo");

  const semPerda = ["Novo", "Contato", "Fechado"];
  conferir("funil sem etapa de perda funciona", proximaEtapa("Contato", semPerda), "Fechado");
}

console.log(`\n${passes} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
