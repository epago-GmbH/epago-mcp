/**
 * Tools: buchungen_liste, buchung_erstellen, buchung_stornieren
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { api } from '../lib/api.js'
import { buildSimpleLines, AUTO_ACCOUNTS, TAX_KEYS } from '../lib/steuer.js'

/**
 * Leitet die Brutto-Seite des Geldkontos aus dem BU-Schluessel ab.
 * VSt (8/9): Brutto im Haben (Verbindlichkeit-Seite)
 * USt (2/3), steuerfrei (1), kein BU: Brutto im Soll
 * Bei Automatikkonten den festen Schluessel nutzen.
 */
function inferBruttoSide(
  bruttoKonto: string,
  sachKonto: string,
  buKey?: string
): 'S' | 'H' {
  const effectiveKey = AUTO_ACCOUNTS[sachKonto] ?? AUTO_ACCOUNTS[bruttoKonto] ?? buKey ?? ''
  const def = TAX_KEYS[effectiveKey]
  if (def?.kind === 'vst') return 'H'
  return 'S'
}

export function registerRead(server: McpServer): void {
  // ──────────────────────────────────────────────────────────────────────────
  // buchungen_liste
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'buchungen_liste',
    'Buchungen des Mandanten abrufen, optional gefiltert nach Datum und Status. Jede Buchung enthaelt alle Buchungszeilen (Soll/Haben, Kontonummern, Steuerschluessel).',
    {
      from: z.string().optional().describe('Buchungsdatum von (YYYY-MM-DD)'),
      to: z.string().optional().describe('Buchungsdatum bis (YYYY-MM-DD)'),
      status: z
        .enum(['draft', 'posted', 'reversed'])
        .optional()
        .describe('Nur Buchungen mit diesem Status zurueckgeben'),
    },
    async (params) => {
      const p: Record<string, string> = {}
      if (params.from) p.from = params.from
      if (params.to) p.to = params.to
      if (params.status) p.status = params.status

      const result = await api.get<unknown>('/journal-entries', p)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )
}

export function registerWrite(server: McpServer): void {
  // ──────────────────────────────────────────────────────────────────────────
  // buchung_erstellen
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'buchung_erstellen',
    [
      'Legt eine Buchung in epago an. WICHTIG: Buchungen mit status "posted" sind sofort GoBD-fest —',
      'eine nachtraegliche Korrektur ist nur per Storno moeglich (buchung_stornieren).',
      '',
      'Zwei Modi:',
      '1. Vereinfacht (betrag + bruttoKonto + sachKonto + optional steuerschluessel):',
      '   Der Server baut den korrekten Buchungssatz automatisch inkl. Steuer-Split.',
      '   Steuerschluessel: 1=steuerfrei, 2=USt 7%, 3=USt 19%, 8=VSt 7%, 9=VSt 19%.',
      '   Automatikkonten (8200/8100/8400/4400/4300) erkennen den Schluessel automatisch.',
      '2. Experten-Modus (lines[]): Buchungszeilen explizit angeben (accountNumber, debit, credit, taxCode).',
      '',
      'Validierung auf API-Seite: Soll=Haben (Toleranz 0,01 EUR), Steuerautomatik-Konsistenz,',
      'Periodensperre (festgeschriebene Perioden → 409 period_closed).',
    ].join('\n'),
    {
      datum: z.string().describe('Buchungsdatum (YYYY-MM-DD)'),
      beschreibung: z
        .string()
        .describe('Buchungstext, z.B. "Bueroausstattung Muster GmbH"'),
      referenz: z
        .string()
        .optional()
        .describe('Belegnummer, z.B. "ER-2026-042"'),
      status: z
        .enum(['draft', 'posted'])
        .default('posted')
        .describe(
          'posted = sofort GoBD-fest (empfohlen), draft = Entwurf (kann noch geaendert werden)'
        ),
      // Vereinfachter Modus
      betrag: z
        .number()
        .positive()
        .optional()
        .describe('Bruttobetrag (positiv). Pflicht wenn kein lines[] angegeben.'),
      bruttoKonto: z
        .string()
        .optional()
        .describe(
          'Kontonummer des Geldkontos (traegt den Bruttobetrag). ' +
            'Beispiele: "1000" (Kasse), "1200" (Bank), "1400" (Forderungen), "3300" (Verbindlichkeiten).'
        ),
      bruttoKontoName: z
        .string()
        .optional()
        .describe('Name des Geldkontos (optional)'),
      sachKonto: z
        .string()
        .optional()
        .describe(
          'Kontonummer des Sachkontos (traegt Netto + ggf. Steuerzeile). ' +
            'Beispiele: "8200" (Erloese 19%), "6815" (Burobedarf), "4400" (Wareneingang 19% VSt).'
        ),
      sachKontoName: z
        .string()
        .optional()
        .describe('Name des Sachkontos (optional)'),
      steuerschluessel: z
        .string()
        .optional()
        .describe(
          'BU-Schluessel: 1=steuerfrei, 2=USt 7%, 3=USt 19%, 8=VSt 7%, 9=VSt 19%. ' +
            'Leer lassen bei Automatikkonten (8200/8100/8400/4400/4300) — diese erkennen den Schluessel automatisch. ' +
            'Fuer manuelle Steuerschluessel (z.B. BU 9 auf Konto 6815): hier angeben.'
        ),
      // Experten-Modus
      lines: z
        .array(
          z.object({
            accountNumber: z.string().describe('Kontonummer'),
            accountName: z.string().optional().describe('Kontoname (optional)'),
            debit: z.number().default(0).describe('Soll-Betrag'),
            credit: z.number().default(0).describe('Haben-Betrag'),
            taxCode: z
              .string()
              .nullable()
              .optional()
              .describe('Steuerschluessel 1/2/3/8/9 oder null'),
          })
        )
        .optional()
        .describe(
          'Explizite Buchungszeilen (Experten-Modus). Mindestens 2 Zeilen, Soll=Haben.'
        ),
    },
    async (params) => {
      let lines: Array<{
        accountNumber: string
        accountName?: string
        debit: number
        credit: number
        taxCode?: string | null
      }>

      if (params.lines && params.lines.length >= 2) {
        // Experten-Modus: Zeilen direkt verwenden
        lines = params.lines
      } else if (params.betrag && params.bruttoKonto && params.sachKonto) {
        // Vereinfachter Modus: Buchungssatz aufbauen
        const buKey = params.steuerschluessel
        const bruttoSide = inferBruttoSide(params.bruttoKonto, params.sachKonto, buKey)
        const result = buildSimpleLines(
          params.betrag,
          params.bruttoKonto,
          params.bruttoKontoName || params.bruttoKonto,
          bruttoSide,
          params.sachKonto,
          params.sachKontoName || params.sachKonto,
          buKey
        )
        if (!result.ok) {
          throw new McpError(ErrorCode.InvalidRequest, result.message)
        }
        lines = result.lines
      } else {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Entweder betrag + bruttoKonto + sachKonto (vereinfacht) oder lines[] (Experten-Modus) angeben.'
        )
      }

      const body = {
        date: params.datum,
        description: params.beschreibung,
        reference: params.referenz || null,
        status: params.status,
        lines: lines.map((l) => ({
          accountNumber: l.accountNumber,
          ...(l.accountName ? { accountName: l.accountName } : {}),
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          ...(l.taxCode !== undefined ? { taxCode: l.taxCode } : {}),
        })),
      }

      const result = await api.post<{ entry: unknown }>('/journal-entries', body)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Buchung angelegt (${params.status}). ID fuer etwaigen Storno merken.`,
                entry: result.entry,
                ...(params.betrag && !params.lines
                  ? { generierteZeilen: lines.length, steuersplit: true }
                  : {}),
              },
              null,
              2
            ),
          },
        ],
      }
    }
  )

  // ──────────────────────────────────────────────────────────────────────────
  // buchung_stornieren
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'buchung_stornieren',
    [
      'GoBD-konformer Storno einer Buchung. Erzeugt eine Gegenbuchung mit aktuellem Datum',
      '(nicht dem Datum der Originalbuchung) und markiert das Original als "reversed".',
      'Loeschen ist nicht moeglich (GoBD). Nur posted-Buchungen koennen storniert werden.',
      'Storno der Storno-Buchung ist ebenfalls nicht moeglich.',
    ].join(' '),
    {
      id: z.string().describe('ID der zu stornierenden Buchung (aus buchung_erstellen oder buchungen_liste)'),
      grund: z
        .string()
        .optional()
        .describe('Storno-Grund, z.B. "Falsche Kontonummer" oder "Doppelbuchung". Wird auf der Storno-Buchung persistiert.'),
    },
    async (params) => {
      const body: Record<string, string> = {}
      if (params.grund) body.reason = params.grund

      const result = await api.post<{ original: unknown; reversal: unknown }>(
        `/journal-entries/${encodeURIComponent(params.id)}/reverse`,
        body
      )
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Buchung storniert. Gegenbuchung mit aktuellem Datum angelegt.',
                original: result.original,
                reversal: result.reversal,
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
