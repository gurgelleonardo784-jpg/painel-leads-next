import { after } from "next/server";
import { getTenant } from "@/lib/tenants";
import { bancoConfigurado } from "@/lib/db";
import { registrarClique, gerarCodigo } from "@/lib/cliques";
import { classificarCanal, ROTULO_CANAL, type SinaisDeOrigem } from "@/lib/canal";
import { registrar } from "@/lib/registro";

/**
 * O botão de WhatsApp do site do cliente passa por aqui.
 *
 * Registra de onde a pessoa veio, gera um código curto e manda ela para o
 * WhatsApp com esse código na mensagem. Quando a mensagem chega no webhook, o
 * código é o que amarra a conversa à busca no Google que a originou.
 *
 * GET /api/ir/<slug>?gclid=...&utm_source=...&ref=...&landing=...
 *  -> 302 para https://wa.me/<numero>?text=<mensagem + #codigo>
 *
 * Regra de ouro daqui: **nunca deixar de redirecionar**. Se o banco estiver
 * fora, se o cliente não existir, se qualquer coisa falhar, a pessoa vai para o
 * WhatsApp de qualquer jeito — sem código, e o lead entra sem origem. Perder a
 * atribuição é ruim; perder o cliente que queria falar com a empresa é pior.
 */

export const dynamic = "force-dynamic";

const MENSAGEM_PADRAO = "Olá! Vim pelo site e gostaria de mais informações.";

function paraWhatsapp(numero: string, texto: string): string {
  const d = numero.replace(/\D/g, "");
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sp = new URL(req.url).searchParams;

  const tenant = getTenant(slug);
  if (!tenant) {
    registrar("webhook_invalido", { origem: "ir", motivo: "cliente inexistente", slug });
    return new Response("Cliente não encontrado.", { status: 404 });
  }

  const numero = tenant.whatsapp?.numero || "";
  if (!numero) {
    // sem número não há para onde mandar. É erro de cadastro, e o texto diz
    // exatamente o que preencher — quem vai ler isto é quem instalou o script.
    registrar("webhook_invalido", { origem: "ir", motivo: "sem numero de whatsapp", slug });
    return new Response(
      "Este cliente não tem o número de WhatsApp cadastrado. Preencha “WhatsApp — número” em /admin.",
      { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  // o texto pode vir do próprio botão (cada página pode ter um assunto)
  const textoBase = (sp.get("msg") || MENSAGEM_PADRAO).slice(0, 300);

  const sinais: SinaisDeOrigem = {
    gclid: sp.get("gclid") || "",
    gbraid: sp.get("gbraid") || "",
    wbraid: sp.get("wbraid") || "",
    fbclid: sp.get("fbclid") || "",
    utmSource: sp.get("utm_source") || "",
    utmMedium: sp.get("utm_medium") || "",
    utmCampaign: sp.get("utm_campaign") || "",
    utmContent: sp.get("utm_content") || "",
    utmTerm: sp.get("utm_term") || "",
    campanhaId: sp.get("campanha_id") || sp.get("campaignid") || "",
    grupoId: sp.get("grupo_id") || sp.get("adgroupid") || "",
    criativoId: sp.get("criativo_id") || sp.get("creative") || "",
    // o referrer da primeira visita, capturado pelo script — não o desta
    // requisição, que seria só a página do próprio cliente
    referrer: sp.get("ref") || "",
    landing: sp.get("landing") || "",
  };

  /**
   * O código é gerado aqui, sem tocar no banco.
   *
   * Antes esta rota esperava a gravação terminar para só então redirecionar — e
   * com o Postgres hibernando (plano gratuito do Neon acorda em 1-3s), isso era
   * uma tela branca antes do WhatsApp abrir. Gente desiste nesse tempo.
   *
   * Como a origem viaja no prefixo do código, a gravação virou opcional: ela
   * acrescenta detalhe (campanha, palavra-chave, página), mas se falhar o lead
   * ainda chega sabendo se veio de mídia paga, de busca ou de indicação.
   */
  const canal = classificarCanal(sinais);
  const codigo = gerarCodigo(canal, sinais);
  const texto = `${textoBase} Ref: ${codigo}`;

  registrar("clique_site", { cliente: slug, canal, rotulo: ROTULO_CANAL[canal] });

  // grava depois da resposta: o visitante não espera por isto
  if (bancoConfigurado()) {
    after(async () => {
      try {
        await registrarClique(slug, sinais, codigo, canal, {
          nomeCliente: tenant.nome,
          visitanteId: sp.get("vid") || "",
          userAgent: req.headers.get("user-agent") || "",
        });
      } catch (e) {
        registrar("banco_indisponivel", {
          cliente: slug,
          detalhe: "clique do site não gravado — o prefixo do código ainda carrega a origem",
          erro: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: paraWhatsapp(numero, texto),
      // nunca guardar em cache: cada clique é um token diferente
      "Cache-Control": "no-store, max-age=0",
      // o script fica em outro domínio (o site do cliente)
      "Access-Control-Allow-Origin": "*",
    },
  });
}
