"use client";

import type { Lead } from "@/lib/types";
import { tipoDoLead } from "@/lib/types";
import {
  fmtTelefone,
  iniciais,
  estiloAvatar,
  tempoRelativo,
  corTemperatura,
  ROTULO_TIPO,
  COR_TIPO,
} from "@/lib/apresentacao";
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
            cta: "Abrir e qualificar manualmente →",
            pendente: true,
          }
        : {
            p: "Sem informações",
            r: "Chegou só com o contato — nenhuma pergunta respondida.",
            cta: "Abrir e qualificar manualmente →",
            pendente: true,
          };

  const ultimoStatus = statusList[statusList.length - 1];
  const podeAvancar = lead.status !== ultimoStatus;

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

        {podeAvancar && (
          <button
            className="btn-quad"
            title="Avançar etapa"
            aria-label={`Avançar ${nome} para a próxima etapa`}
            onClick={(e) => {
              e.stopPropagation();
              onAvancar(lead);
            }}
          >
            <Chevron />
          </button>
        )}
      </div>
    </div>
  );
}
