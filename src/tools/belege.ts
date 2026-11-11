/**
 * Tools: beleg_hochladen
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api } from '../lib/api.js'

export function registerWrite(server: McpServer): void {
  server.tool(
    'beleg_hochladen',
    [
      'Beleg als Base64-kodierten Dateiinhalt hochladen und in epago aufbewahren (PDF, JPEG, PNG, GIF, WEBP, XLSX, XLS, CSV).',
      'SHA256-Hash fuer GoBD-Integritaet wird serverseitig gebildet. Gibt die Beleg-ID zurueck.',
      '',
      'Groesse: hoechstens rund 3 MB Datei. Base64 vergroessert den Inhalt um ein Drittel, und',
      'app.epago.de nimmt hoechstens 4,5 MB je Anfrage an; die 10 MB, die der Server selbst pruefen',
      'wuerde, werden darum nie erreicht. Groessere Belege laedt der Nutzer in der Oberflaeche hoch.',
      '',
      'Der Upload legt den Beleg nur ab. Er wird NICHT gelesen (keine Texterkennung) und laesst sich',
      'ueber diese Schnittstelle NICHT mit einer Buchung verknuepfen: buchung_erstellen hat kein Feld',
      'fuer eine Beleg-ID. Zur Zuordnung die Belegnummer als referenz in buchung_erstellen uebernehmen.',
      'Wird dieselbe Datei ein zweites Mal hochgeladen, antwortet die API mit 409 beleg_dublette und',
      'nennt die vorhandene Beleg-ID (existingDocumentId); nicht erneut senden.',
      '',
      'Was nach dem Upload mit einer EINGANGSRECHNUNG geschieht:',
      '- OHNE Zahlung (noch nicht bezahlt, oder keine passende Geldbewegung bekannt): NICHT buchen.',
      '  Den Beleg ablegen und dem Nutzer als offene Aufgabe melden (Lieferant, Rechnungsnummer,',
      '  Betrag, Faelligkeit). Eine Eingangsrechnung als offener Posten laesst sich ueber diese',
      '  Schnittstelle noch nicht anlegen; eine frei gebuchte Verbindlichkeit wuerde niemand ueberwachen.',
      '- BEZAHLT und einfach (ein Steuersatz 7 % oder 19 %, inlaendischer Lieferant, keine Bewirtung,',
      '  kein Reverse Charge): mit buchung_erstellen buchen, MIT Steuerschluessel, sodass die Buchung',
      '  eine Aufwandszeile UND eine Steuerzeile (Vorsteuer) traegt. Gegenkonto ist das Geldkonto, ueber',
      '  das bezahlt wurde (Bank oder Kasse). Den Buchungssatz vorher dem Nutzer zeigen.',
      '- Alles andere (Reverse Charge, Bewirtung, mehrere Steuersaetze, unlesbarer Beleg): dem Nutzer',
      '  melden und nachfragen, bevor gebucht wird.',
    ].join('\n'),
    {
      dateiinhalt: z
        .string()
        .describe('Base64-kodierter Dateiinhalt des Belegs'),
      dateiname: z
        .string()
        .describe('Dateiname mit Endung, z.B. "rechnung-2026-042.pdf"'),
      originalname: z
        .string()
        .optional()
        .describe('Originaler Dateiname (falls abweichend von dateiname)'),
      mimetype: z
        .enum([
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
        ])
        .describe('MIME-Typ der Datei'),
      kategorie: z
        .string()
        .optional()
        .describe('Belegkategorie, z.B. "eingangsrechnung", "kassenbon", "bankbeleg"'),
      beschreibung: z.string().optional().describe('Freitext-Beschreibung des Belegs'),
      belegdatum: z.string().optional().describe('Belegdatum (YYYY-MM-DD)'),
      referenz: z.string().optional().describe('Referenz-/Belegnummer'),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        fileName: params.dateiname,
        originalName: params.originalname || params.dateiname,
        mimeType: params.mimetype,
        data: params.dateiinhalt,
      }
      if (params.kategorie) body.category = params.kategorie
      if (params.beschreibung) body.description = params.beschreibung
      if (params.belegdatum) body.documentDate = params.belegdatum
      if (params.referenz) body.reference = params.referenz

      const result = await api.post<{ document: unknown }>('/documents', body)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Beleg hochgeladen. SHA256-Hash fuer GoBD-Integritaet gespeichert.',
                document: result.document,
              },
              null,
              2
            ),
          },
        ],
      }
    }
  )
}
