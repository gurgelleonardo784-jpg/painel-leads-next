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
import { atribuicaoDoReferral } from "../lib/atribuicao";

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

console.log(`\n${passes} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
