import { google, sheets_v4 } from "googleapis";

/**
 * Cliente do Google Sheets autenticado por Service Account.
 * As credenciais vêm de variáveis de ambiente (ver .env.example):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  - e-mail da service account
 *   GOOGLE_PRIVATE_KEY            - chave privada (com \n escapados)
 *
 * Cada planilha de cliente precisa ser compartilhada (como Editor)
 * com o e-mail da service account uma única vez.
 */
let cache: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (cache) return cache;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error(
      "Credenciais da service account ausentes. Defina GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_PRIVATE_KEY."
    );
  }

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cache = google.sheets({ version: "v4", auth });
  return cache;
}
