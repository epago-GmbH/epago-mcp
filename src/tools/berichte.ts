/**
 * Tools: bericht_bwa, bericht_ustva
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api } from '../lib/api.js'

export function register(server: McpServer): void {
  // ──────────────────────────────────────────────────────────────────────────
  // bericht_bwa
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'bericht_bwa',
    'Betriebswirtschaftliche Auswertung (BWA) abrufen. Zeigt Erloese, Aufwendungen und Ergebnis fuer den angegebenen Zeitraum. Nuetzlich fuer monatliche Erfolgskontrolle.',
    {
      from: z.string().optional().describe('Zeitraum von (YYYY-MM-DD), z.B. "2026-01-01"'),
      to: z.string().optional().describe('Zeitraum bis (YYYY-MM-DD), z.B. "2026-06-30"'),
    },
    async (params) => {
      const p: Record<string, string> = {}
      if (params.from) p.from = params.from
      if (params.to) p.to = params.to

      const result = await api.get<unknown>('/reports/bwa', p)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  // ──────────────────────────────────────────────────────────────────────────
  // bericht_ustva
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'bericht_ustva',
    'Umsatzsteuer-Voranmeldung (UStVA) abrufen. Liefert die relevanten Kennzahlen (KZ 81, 86, 66 etc.) fuer den angegebenen Voranmeldezeitraum.',
    {
      from: z
        .string()
        .optional()
        .describe('Voranmeldezeitraum von (YYYY-MM-DD), z.B. "2026-01-01"'),
      to: z
        .string()
        .optional()
        .describe('Voranmeldezeitraum bis (YYYY-MM-DD), z.B. "2026-03-31" fuer Q1'),
    },
    async (params) => {
      const p: Record<string, string> = {}
      if (params.from) p.from = params.from
      if (params.to) p.to = params.to

      const result = await api.get<unknown>('/reports/vat', p)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )
}
