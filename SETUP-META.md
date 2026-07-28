# Guia de configuração — Meta (ponta a ponta)

Objetivo: lead do formulário instantâneo do Meta → planilha → painel → e o
status que o cliente marca no painel volta pro Meta pela Conversions API, para
otimizar a campanha.

Fluxo:

```
Formulário instantâneo (Meta) ──integração nativa──▶ 📊 planilha ──▶ 🖥️ painel
                                                                        │
                          cliente marca status ─────────────────────────┤
                                                                        ▼
                                              🎯 Conversions API do Meta (otimiza a campanha)
```

Ordem recomendada: Parte 1 → 3 primeiro (painel no ar lendo leads). Depois 4 → 6
(a volta pro Meta).

---

## Parte 1 — Planilha + Service Account (o banco)

1. **Service Account** em [console.cloud.google.com](https://console.cloud.google.com):
   - Crie um projeto (ou use um existente).
   - Menu **APIs e serviços → Biblioteca** → ative a **Google Sheets API**.
   - **APIs e serviços → Credenciais → Criar credencial → Conta de serviço**.
   - Abra a conta criada → aba **Chaves → Adicionar chave → JSON**. Baixa um `.json`.
2. Do JSON você usa dois campos: `client_email` e `private_key`.
3. **Compartrilhe a planilha do cliente** com o `client_email` (botão Compartilhar,
   como **Editor**). É isso que dá acesso sem o cliente mexer em permissão.

---

## Parte 2 — Ligar o Meta na planilha (integração nativa)

1. No **Meta Business Suite / Gerenciador de Anúncios**, abra o formulário
   instantâneo (Instant Form) da campanha.
2. Em **Configurações de acesso aos leads / CRM**, conecte o **Google Sheets**.
3. Escolha a planilha (ou deixe o Meta criar uma). É **essa** planilha que o
   painel vai ler — anote o ID dela (está na URL:
   `docs.google.com/spreadsheets/d/`**`ESTE_ID`**`/edit`).
4. Faça um lead de teste no formulário e confirme que aparece uma linha na planilha.

> A integração é de mão única: o Meta **escreve** na planilha, mas **não lê** de
> volta. Por isso o status não "volta pelo Sheets" — volta pela API (Parte 4).

---

## Parte 3 — Rodar o painel

1. Copie `.env.example` para `.env.local` e preencha:
   ```
   GOOGLE_SERVICE_ACCOUNT_EMAIL="...client_email do JSON..."
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   SESSION_SECRET="uma-string-aleatoria-longa"
   TZ="America/Sao_Paulo"
   ```
2. Cadastre o cliente em `tenants.json` (copie de `tenants.example.json`):
   ```json
   [
     {
       "slug": "cliente1",
       "nome": "Cliente 1",
       "senha": "uma-senha",
       "spreadsheetId": "ID_DA_PLANILHA_DO_META",
       "aba": "Nome da aba onde o Meta escreve",
       "titulo": "Painel de Leads do Cliente 1",
       "ddiPadrao": "55",
       "status": ["Novo", "Em contato", "Qualificado", "Ganho", "Perdido"]
     }
   ]
   ```
3. Rode:
   ```bash
   npm run dev
   ```
   Acesse `http://localhost:3000/cliente1`, entre com a senha e confira se os
   leads do Meta aparecem, se dá pra mudar status e escrever anotação.

> Os leads que o Meta escreve não têm o "ID" interno do painel — ele preenche
> sozinho na primeira carga. A coluna `id` que o Meta cria é o **Lead ID** usado
> na Parte 4; o painel já a reconhece e a esconde do card.

---

## Parte 4 — Conversions API do Meta (o status volta pra campanha)

1. Abra o **Events Manager** ([business.facebook.com/events_manager](https://business.facebook.com/events_manager)).
2. **Data Sources / Fontes de dados**: use o dataset da sua conta (o mesmo do
   pixel serve). Anote o **ID do dataset** (é o `datasetId`).
3. Ainda no dataset: **Settings / Configurações → Generate Access Token /
   Gerar token de acesso**. Copie o token (é o `accessToken`).
4. **Eventos (nomes)**: escolha um nome de evento para cada status que vira
   conversão. Sugestão:
   | Status no painel | Nome do evento (event_name) |
   |---|---|
   | Em contato | `lead_contacted` |
   | Qualificado | `lead_qualified` |
   | Ganho | `lead_won` |
   | Perdido | `lead_disqualified` |
   Esses nomes aparecem no Events Manager assim que o primeiro evento chega.
5. **Otimização**: para a campanha otimizar por "lead qualificado", crie/edite
   uma campanha de **Conversão de leads (Conversion Leads)** e aponte o objetivo
   para o evento que interessa (ex.: `lead_qualified`).
   > A otimização Conversion Leads exige **200+ leads/mês** para a Meta aprender.
   > Abaixo disso os eventos ainda são enviados e registrados, só não otimizam.

---

## Parte 5 — Preencher o bloco `conversoes.meta` no tenant

No `tenants.json`, adicione ao cliente:

```json
"conversoes": {
  "statusConversao": ["Em contato", "Qualificado", "Ganho", "Perdido"],
  "meta": {
    "datasetId": "SEU_DATASET_ID",
    "accessToken": "SEU_TOKEN_DO_DATASET",
    "testEventCode": "",
    "eventos": {
      "Em contato": "lead_contacted",
      "Qualificado": "lead_qualified",
      "Ganho": "lead_won",
      "Perdido": "lead_disqualified"
    }
  }
}
```

- `statusConversao`: quais status disparam envio (deixe só os que quiser).
- `eventos`: precisa bater com os nomes que você usar no Events Manager.
- `testEventCode`: opcional. Pegue em **Events Manager → Test Events** para ver o
  evento chegando em tempo real durante o teste; depois deixe vazio.

---

## Parte 6 — Testar ponta a ponta

1. No painel, mude o status de um lead real (que veio do Meta, com a coluna `id`
   preenchida) para **Qualificado**.
2. A ferramenta grava o status na planilha e envia o evento ao Meta. O resultado
   fica na coluna **Conversão** da planilha, ex.:
   `Meta: ok — 26/07/2026 14:03`.
3. Confirme no **Events Manager → Test Events** (se usou `testEventCode`) ou em
   **Visão geral do dataset** que o evento `lead_qualified` chegou.
4. Se aparecer `Meta: falha (...)` na coluna Conversão, a mensagem diz o motivo
   (token errado, lead sem `id`, evento não mapeado etc.).

---

## Checklist rápido

- [ ] Service Account criada e planilha compartilhada com ela
- [ ] Meta conectado à planilha (lead de teste apareceu)
- [ ] `.env.local` com credenciais do Google + SESSION_SECRET
- [ ] `tenants.json` com o cliente (spreadsheetId + aba certos)
- [ ] Painel abrindo e salvando status
- [ ] Dataset ID + Access Token do Events Manager
- [ ] `conversoes.meta` preenchido com os eventos
- [ ] Evento chegando no Events Manager ao mudar o status
