/**
 * Tools: konten_liste, konto_auszug, salden
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api } from '../lib/api.js'

export function register(server: McpServer): void {
  // ──────────────────────────────────────────────────────────────────────────
  // konten_liste
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'konten_liste',
    'Kontenplan des Mandanten abrufen. Liefert alle Konten mit Nummern, Namen und Typen. Mit withBalances=true zusaetzlich aktuelle Salden (Summe Soll, Summe Haben, Nettosaldo). Nuetzlich fuer: Uebersicht der Buchhaltungsstruktur, Kontonummern fuer Buchungen ermitteln.',
    {
      withBalances: z
        .boolean()
        .optional()
        .default(false)
        .describe('Wenn true: aktuelle Salden mitliefern'),
      from: z
        .string()
        .optional()
        .describe('Saldenzeitraum von (YYYY-MM-DD), nur mit withBalances'),
      to: z
        .string()
        .optional()
        .describe('Saldenzeitraum bis (YYYY-MM-DD), nur mit withBalances'),
    },
    async (params) => {
      const p: Record<string, string> = {}
      if (params.withBalances) p.withBalances = '1'
      if (params.from) p.from = params.from
      if (params.to) p.to = params.to

      const result = await api.get<{ accounts: unknown[] }>('/accounts', p)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  // ──────────────────────────────────────────────────────────────────────────
  // konto_auszug
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'konto_auszug',
    'Kontenblatt eines einzelnen Kontos abrufen: alle Buchungszeilen mit laufendem Saldo. Ideal fuer Kontenabstimmung, Belegpruefung und Saldennachvollziehung.',
    {
      kontonummer: z
        .string()
        .describe('Kontonummer aus konten_liste, z.B. im SKR03 1200 (Bank) oder 8400 (Erloese 19 % USt)'),
      from: z.string().optional().describe('Zeitraum von (YYYY-MM-DD)'),
      to: z.string().optional().describe('Zeitraum bis (YYYY-MM-DD)'),
    },
    async (params) => {
      const p: Record<string, string> = {}
      if (params.from) p.from = params.from
      if (params.to) p.to = params.to

      const result = await api.get<unknown>(`/accounts/${encodeURIComponent(params.kontonummer)}/ledger`, p)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  // ──────────────────────────────────────────────────────────────────────────
  // salden
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'salden',
    'Saldenliste aller Konten zu einem Stichtag abrufen. Zeigt fuer jeden Konto den Soll-/Habensaldo im angegebenen Zeitraum. Nuetzlich fuer Abstimmung und Periodenabschluss.',
    {
      from: z.string().optional().describe('Zeitraum von (YYYY-MM-DD)'),
      to: z.string().optional().describe('Zeitraum bis (YYYY-MM-DD, Stichtag)'),
    },
    async (params) => {
      const p: Record<string, string> = {}
      if (params.from) p.from = params.from
      if (params.to) p.to = params.to

      const result = await api.get<unknown>('/reports/account-balances', p)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )
}
