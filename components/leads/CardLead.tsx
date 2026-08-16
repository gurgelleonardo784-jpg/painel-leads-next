"use client";

import type { Lead } from "@/lib/types";
import { tipoDoLead } from "@/lib/types";
import {
  fmtTelefone,
  iniciais,
  estiloAvatar,
  tempoRelativo,
  corTemperatura,
  proximaEtapa,
  ROTULO_TIPO,
  COR_TIPO,
} from "@/lib/apresentacao";
import { moedaExata } from "@/lib/metricas";
import { Chevron, Linhas, Whatsapp } from "../Icones";

/**
 * O card do lead no pipeline.
 *
 * A prévia muda conforme o que se sabe do lead: quem preencheu formulário
 * mostra uma resposta; quem veio do WhatsApp mostra a primeira mensagem; quem
 * chegou só com telefone recebe um aviso de que precisa ser qualificado à mão.
 */
export default function CardLead({
  lead,
  statusList,
  onAbrir,
  onAvancar,
}: {
  lead: Lead;
  statusList: string[];
  onAbrir: (lead: Lead) => void;
  onAvancar: (lead: Lead) => void;
}) {
  const tipo = tipoDoLead(lead);
  const tel = fmtTelefone(lead.telefone);
  const nome = lead.nome.trim() || tel || "Lead sem nome";
  const temNome = !!lead.nome.trim();
  const tempo = tempoRelativo(lead.data);
  const corTemp = corTemperatura(lead.temperatura);
  const corTipo = COR_TIPO[tipo];

  // a prévia é a informação mais útil que temos sobre este lead
  const previa =
    tipo === "form"
      ? {
          p: lead.respostas[Math.min(3, lead.respostas.length - 1)].pergunta,
          r: lead.respostas[Math.min(3, lead.respostas.length - 1)].resposta,
          cta: `Ver ${lead.respostas.length} resposta${lead.respostas.length === 1 ? "" : "s"} do formulário →`,
          pendente: false,
        }
      : lead.primeiraMensagem
        ? {
            p: "Primeira mensagem",
            r: lead.primeiraMensagem,
            // quando há rastreamento, "qualificar manualmente" descreve mal o
            // que espera lá dentro: a origem e a conversa inteira já estão lá
            cta: lead.atribuicao
              ? `Ver a conversa e a origem →`
              : "Abrir e qualificar manualmente →",
            pendente: !lead.atribuicao,
          }
        : {
            p: "Sem informações",
            r: "Chegou só com o contato — nenhuma pergunta respondida.",
            cta: "Abrir e qualificar manualmente →",
            pendente: true,
          };

  // null quando o lead já chegou ao fim do funil (ou está numa etapa de perda)
  const proximo = proximaEtapa(lead.status, statusList);

  /**
   * A origem publicitária resumida para caber no card.
   *
   * Serve tanto para lead de formulário (a campanha vem da planilha, que a
   * integração do Meta preenche) quanto para lead de conversa (vem do
   * rastreamento). O card não distingue: quem olha quer saber de onde veio.
   */
  const origem = {
    campanha: lead.campanha.trim(),
    anuncio: lead.anuncio.trim(),
    completo: [lead.campanha, lead.conjunto, lead.anuncio].filter((s) => s.trim()).join(" · "),
  };

  return (
    <div
      className="lead"
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(lead)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir(lead);
        }
      }}
    >
      <div className="lead-topo">
        <div className="avatar" style={estiloAvatar(lead.id, 34)} aria-hidden="true">
          {temNome ? iniciais(lead.nome) : "#"}
        </div>
        <div className="lead-ident">
          <span className="lead-nome">{nome}</span>
          {temNome && tel && <span className="lead-tel">{tel}</span>}
        </div>
        {corTemp && (
          <span
            className="badge badge-temp"
            style={{ color: corTemp, background: `color-mix(in srgb, ${corTemp} 13%, transparent)` }}
          >
            {lead.temperatura}
          </span>
        )}
      </div>

      <div className="lead-metas">
        <span
          className="badge"
          style={{
            color: corTipo,
            background: `color-mix(in srgb, ${corTipo} 10%, transparent)`,
            borderColor: `color-mix(in srgb, ${corTipo} 22%, transparent)`,
          }}
        >
          {ROTULO_TIPO[tipo]}
        </span>
        {lead.origem && <span className="chip-origem">{lead.origem}</span>}
        {tempo && <span className="lead-tempo">{tempo}</span>}
      </div>

      {/* De onde este lead veio, direto no card.
          Abrir o lead para descobrir a campanha custa um clique por lead — e a
          pergunta "de onde veio?" é justamente a que se faz olhando a lista
          inteira, não um lead de cada vez. */}
      {(origem.campanha || origem.anuncio) && (
        <div className="lead-origem" title={origem.completo}>
          <span className="rotulo">de</span>
          <span className="truncar">{origem.campanha || origem.anuncio}</span>
          {origem.anuncio && origem.campanha && (
            <span className="anuncio truncar">· {origem.anuncio}</span>
          )}
        </div>
      )}

      {lead.valor > 0 && (
        <div className="lead-valor">
          <span className="rotulo">valor</span>
          <span className="numero">{moedaExata(lead.valor)}</span>
        </div>
      )}

      <div className={`previa${previa.pendente ? " pendente" : ""}`}>
        <span className="p">{previa.p}</span>
        <span className="r">{previa.r}</span>
        <span className="cta">{previa.cta}</span>
      </div>

      <div className="lead-acoes">
        {lead.whatsapp ? (
          <a
            className="btn btn-wa"
            href={lead.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            <Whatsapp />
            WhatsApp
          </a>
        ) : (
          <button className="btn btn-wa" disabled onClick={(e) => e.stopPropagation()}>
            Sem telefone
          </button>
        )}

        {lead.nota.trim() && (
          <span className="badge-nota" title="Tem anotação">
            <Linhas />1
          </span>
        )}

        {/* o destino fica escrito no botão: um chevron sozinho não diz para
            onde leva, e aqui cada clique muda o estado do lead */}
        {proximo && (
          <button
            className="btn btn-avancar"
            title={`Mover para ${proximo}`}
            aria-label={`Mover ${nome} para ${proximo}`}
            onClick={(e) => {
              e.stopPropagation();
              onAvancar(lead);
            }}
          >
            <span className="truncar">{proximo}</span>
            <Chevron />
          </button>
        )}
      </div>
    </div>
  );
}
