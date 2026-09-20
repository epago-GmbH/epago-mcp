/**
 * Tools: buchungen_liste, buchung_erstellen, buchung_stornieren
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { api } from '../lib/api.js'

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
      '1. Vereinfacht (betrag + bruttoKonto + sachKonto, optional steuerschluessel und seite):',
      '   Der SERVER baut den Buchungssatz inklusive Steuer-Split — mit dem Kontenrahmen des',
      '   Mandanten (SKR03 oder SKR04). Welche Kontonummer ein Automatikkonto ist, weiss deshalb',
      '   nur der Server; dieses Werkzeug fuehrt bewusst KEINE eigene Kontentabelle.',
      '   Welche Konten es gibt und was sie bedeuten, zeigt konten_liste.',
      '   Steuerschluessel: 1=steuerfrei, 2=USt 7%, 3=USt 19%, 8=VSt 7%, 9=VSt 19%.',
      '   Auf einem Automatikkonto darf KEIN steuerschluessel mitgegeben werden — der Server',
      '   weist das ab, weil das Konto den Schluessel schon traegt.',
      '   Die Antwort nennt die erzeugten Zeilen, den effektiven Steuerschluessel, den',
      '   Netto-/Steuer-Split und den Kontenrahmen. Dem Nutzer den Buchungssatz zeigen.',
      '2. Experten-Modus (lines[]): Buchungszeilen explizit angeben (accountNumber, debit, credit, taxCode).',
      '',
      'Genau EINEN Modus benutzen. Beide zusammen weist die API mit 400 ab.',
      '',
      'Validierung auf API-Seite: Soll=Haben, Steuerautomatik-Konsistenz, Kontoexistenz,',
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
          'Kontonummer, die den Bruttobetrag traegt — das Geld- oder Personenkonto. '
            + 'Im SKR03 z.B. 1000 (Kasse), 1200 (Bank), 1400 (Forderungen aus Lieferungen und '
            + 'Leistungen), 1600 (Verbindlichkeiten aus Lieferungen und Leistungen); '
            + 'im SKR04 1600 (Kasse), 1800 (Bank), 1200 (Forderungen), 3300 (Verbindlichkeiten). '
            + 'Welcher Rahmen gilt, zeigt konten_liste.'
        ),
      bruttoKontoName: z
        .string()
        .optional()
        .describe('Name des Kontos (optional, nur fuer die Lesbarkeit der Buchungszeile)'),
      sachKonto: z
        .string()
        .optional()
        .describe(
          'Kontonummer des Sachkontos — Erloes oder Aufwand. Traegt den Nettobetrag; '
            + 'die Steuerzeile setzt der Server daneben. Nummern aus konten_liste nehmen, '
            + 'nicht raten: dieselbe Nummer bedeutet im SKR03 und im SKR04 oft Verschiedenes '
            + '(3400 ist im SKR03 Wareneingang 19 % Vorsteuer, im SKR04 eine Verbindlichkeit).'
        ),
      sachKontoName: z
        .string()
        .optional()
        .describe('Name des Sachkontos (optional, nur fuer die Lesbarkeit der Buchungszeile)'),
      steuerschluessel: z
        .string()
        .optional()
        .describe(
          'BU-Schluessel: 1=steuerfrei, 2=USt 7%, 3=USt 19%, 8=VSt 7%, 9=VSt 19%. '
            + 'Weglassen, wenn eines der beiden Konten ein Automatikkonto ist — der Server '
            + 'erkennt den Schluessel dann am Konto und weist eine zusaetzliche Angabe ab.'
        ),
      seite: z
        .enum(['S', 'H'])
        .optional()
        .describe(
          'Soll (S) oder Haben (H) des Kontos aus bruttoKonto. Normalerweise weglassen: '
            + 'bei 2/3/8/9 leitet der Server die Richtung aus dem Steuerfall ab. '
            + 'Anzugeben ist sie bei Steuerschluessel 1 (steuerfrei), bei einer Buchung ganz '
            + 'ohne Steuer (reine Umbuchung, z.B. Bank an Kasse) und wenn die Buchung '
            + 'andersherum laufen soll als der Regelfall (Gutschrift, Warenruecksendung). '
            + 'Verlangt der Server sie, sagt er das in der Fehlermeldung — dann beim Nutzer '
            + 'nachfragen statt zu raten.'
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
      const hatZeilen = Array.isArray(params.lines) && params.lines.length > 0
      const hatVereinfacht =
        params.betrag !== undefined
        || params.bruttoKonto !== undefined
        || params.sachKonto !== undefined
        || params.steuerschluessel !== undefined
        || params.seite !== undefined

      if (hatZeilen && hatVereinfacht) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Entweder lines[] (Experten-Modus) ODER betrag + bruttoKonto + sachKonto '
            + '(vereinfacht) angeben, nicht beides.'
        )
      }
      if (!hatZeilen && !hatVereinfacht) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Entweder betrag + bruttoKonto + sachKonto (vereinfacht) oder lines[] (Experten-Modus) angeben.'
        )
      }

      const kopf = {
        date: params.datum,
        description: params.beschreibung,
        reference: params.referenz || null,
        status: params.status,
      }

      // Vereinfachte Form: die Felder gehen UNVERAENDERT an die API. Die Zeilen
      // baut der Server ueber denselben Weg wie die Stapelerfassung der
      // Oberflaeche (buildStapelLines), mit dem Kontenrahmen des Mandanten.
      // Frueher stand hier eine eigene Kontentabelle; sie fuehrte noch die
      // Automatikkonten des alten Kontenstamms und baute damit fuer jeden
      // Bestandsmandanten falsche Zeilen.
      const body = hatZeilen
        ? {
            ...kopf,
            lines: params.lines!.map((l) => ({
              accountNumber: l.accountNumber,
              ...(l.accountName ? { accountName: l.accountName } : {}),
              debit: l.debit ?? 0,
              credit: l.credit ?? 0,
              ...(l.taxCode !== undefined ? { taxCode: l.taxCode } : {}),
            })),
          }
        : {
            ...kopf,
            betrag: params.betrag,
            bruttoKonto: params.bruttoKonto,
            ...(params.bruttoKontoName ? { bruttoKontoName: params.bruttoKontoName } : {}),
            sachKonto: params.sachKonto,
            ...(params.sachKontoName ? { sachKontoName: params.sachKontoName } : {}),
            ...(params.steuerschluessel ? { steuerschluessel: params.steuerschluessel } : {}),
            ...(params.seite ? { seite: params.seite } : {}),
          }

      const result = await api.post<{
        entry: unknown
        zeilen?: unknown
        steuerschluessel?: string | null
        split?: unknown
        kontenrahmen?: string
      }>('/journal-entries', body)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Buchung angelegt (${params.status}). ID fuer etwaigen Storno merken.`,
                entry: result.entry,
                // Nur bei der vereinfachten Form gesetzt: was der Server aus den
                // drei Angaben gemacht hat. Dem Nutzer zeigen.
                ...(result.zeilen ? { zeilen: result.zeilen } : {}),
                ...(result.steuerschluessel !== undefined
                  ? { steuerschluessel: result.steuerschluessel }
                  : {}),
                ...(result.split ? { split: result.split } : {}),
                ...(result.kontenrahmen ? { kontenrahmen: result.kontenrahmen } : {}),
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
