"use client";

import type { Lead } from "@/lib/types";
import { corDoStatus } from "@/lib/apresentacao";
import { moeda } from "@/lib/metricas";
import CardLead from "./CardLead";

/**
 * Pipeline: uma coluna por etapa, na ordem configurada para o cliente.
 * A soma de valor de cada coluna só aparece quando a planilha tem a coluna
 * "Valor" preenchida — senão seria sempre R$ 0 e viraria ruído.
 */
export default function Kanban({
  leads,
  statusList,
  onAbrir,
  onAvancar,
}: {
  leads: Lead[];
  statusList: string[];
  onAbrir: (lead: Lead) => void;
  onAvancar: (lead: Lead) => void;
}) {
  return (
    <div className="kanban rolagem">
      {statusList.map((status) => {
        const itens = leads.filter((l) => l.status === status);
        const soma = itens.reduce((s, l) => s + l.valor, 0);
        const cor = corDoStatus(status, statusList);

        return (
          <section
            className="coluna"
            key={status}
            style={{ "--cor-etapa": cor } as React.CSSProperties}
            aria-label={`${status}: ${itens.length} lead${itens.length === 1 ? "" : "s"}`}
          >
            <header className="coluna-cab">
              <div className="nome">
                <span className="ponto" style={{ background: cor }} />
                <span className="rotulo">{status}</span>
                <span className="contador">{itens.length}</span>
              </div>
              <span className="soma">{soma > 0 ? moeda(soma) : "—"}</span>
            </header>

            <div className="coluna-lista">
              {itens.length === 0 ? (
                <p className="coluna-vazia">Nenhum lead aqui</p>
              ) : (
                itens.map((l) => (
                  <CardLead
                    key={l.id}
                    lead={l}
                    statusList={statusList}
                    onAbrir={onAbrir}
                    onAvancar={onAvancar}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
