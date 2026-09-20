/**
 * Tools: beleg_hochladen
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api } from '../lib/api.js'

export function registerWrite(server: McpServer): void {
  server.tool(
    'beleg_hochladen',
    'Beleg als Base64-kodierten Dateiinhalt hochladen (max. 10 MB; PDF, JPEG, PNG, GIF, WEBP, XLSX, XLS, CSV). SHA256-Hash fuer GoBD-Integritaet wird serverseitig gebildet. Gibt die Beleg-ID zurueck, die beim Verknuepfen mit Buchungen benoetigt wird.',
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
