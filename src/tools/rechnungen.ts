/**
 * Tools: rechnungen_liste, rechnung_zahlungen (lesend)
 *        zahlung_erfassen (schreibend, nur bei write-Scope)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api } from '../lib/api.js'

export function register(server: McpServer): void {
  server.tool(
    'rechnungen_liste',
    'Ein- und Ausgangsrechnungen des Mandanten abrufen. Liefert Rechnungsnummern, Belegnummern, Bruttobetraege, Status und Zahlungsstatus.',
    {
      typ: z
        .enum(['outgoing', 'incoming'])
        .optional()
        .describe(
          'Rechnungstyp: outgoing = Ausgangsrechnungen (an Kunden), incoming = Eingangsrechnungen (von Lieferanten)'
        ),
      status: z.string().optional().describe('Rechnungsstatus, z.B. "draft" oder "sent"'),
      zahlungsstatus: z
        .string()
        .optional()
        .describe('Zahlungsstatus, z.B. "open", "paid", "overdue"'),
      from: z.string().optional().describe('Belegdatum von (YYYY-MM-DD)'),
      to: z.string().optional().describe('Belegdatum bis (YYYY-MM-DD)'),
    },
    async (params) => {
      const p: Record<string, string> = {}
      if (params.typ) p.documentType = params.typ
      if (params.status) p.status = params.status
      if (params.zahlungsstatus) p.paymentStatus = params.zahlungsstatus
      if (params.from) p.from = params.from
      if (params.to) p.to = params.to

      const result = await api.get<unknown>('/invoices', p)
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )

  // ──────────────────────────────────────────────────────────────────────────
  // rechnung_zahlungen
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'rechnung_zahlungen',
    'Alle erfassten Zahlungen eines Belegs abrufen, aelteste zuerst. Zeigt Betrag, ' +
      'Vereinnahmungsdatum, Zahlungsweg, den verknuepften Buchungssatz und - falls eine ' +
      'Zahlung einen Rest offen gelassen hat - die gewaehlte Zahlungsart samt Differenzbetrag.',
    {
      rechnungId: z
        .string()
        .describe('Technische ID des Belegs (Feld "id" aus rechnungen_liste, keine Belegnummer).'),
    },
    async (params) => {
      const result = await api.get<unknown>(
        `/invoices/${encodeURIComponent(params.rechnungId)}/payments`
      )
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )
}

export function registerWrite(server: McpServer): void {
  // ──────────────────────────────────────────────────────────────────────────
  // zahlung_erfassen
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'zahlung_erfassen',
    [
      'Erfasst eine Zahlung an einem Beleg (Rechnung, Eingangsrechnung, Gutschrift) in epago.',
      'Der Server bucht dabei selbst: Zahlungsbuchung (Geldkonto gegen Personenkonto), bei',
      'Ist-Versteuerung zusaetzlich die faellig werdende Umsatzsteuer, und er schreibt den',
      'Zahlungsstand am Beleg fort.',
      '',
      'WICHTIG — offener Rest: Trifft der Betrag nicht genau den offenen Rest, MUSS gesagt werden,',
      'was die Differenz ist. Ohne "zahlungsart" antwortet die API mit 400 zahlungsart_erforderlich',
      'und liefert Restbetrag, Vorschlag und die moeglichen Optionen mit. Diese Optionen dem Nutzer',
      'vorlegen und ihn WAEHLEN lassen — nicht raten:',
      '  teilzahlung        Rest bleibt offen, der Beleg wird weiter gemahnt.',
      '  skonto             Vereinbarter Abzug: Entgeltminderung nach Paragraf 17 Abs. 1 UStG,',
      '                     die Umsatzsteuer bzw. Vorsteuer sinkt mit.',
      '  forderungsausfall  Die Forderung ist uneinbringlich (Paragraf 17 Abs. 2 Nr. 1 UStG).',
      '                     NUR wenn der Nutzer das ausdruecklich sagt, und immer mit Begruendung.',
      '',
      'Eine Begruendung ist Pflicht bei forderungsausfall und bei einem skonto, das von der',
      'Skontovereinbarung am Beleg abweicht (Frist abgelaufen, kein Skonto vereinbart, Betrag hoeher).',
      '',
      'GoBD: Skonto und Forderungsausfall erzeugen eine eigene Buchung mit dem Zahlungsdatum',
      '(Paragraf 17 Abs. 1 Satz 7 UStG). Die Rechnung selbst bleibt unveraendert.',
    ].join('\n'),
    {
      rechnungId: z
        .string()
        .describe(
          'Technische ID des Belegs (Feld "id" aus rechnungen_liste, keine Belegnummer).'
        ),
      betrag: z
        .number()
        .describe(
          'Vereinnahmter Betrag in Euro. Nicht 0,00 und nicht mehr als der offene Rest. ' +
            'Negativ = Rueckzahlung.'
        ),
      zahlungsdatum: z
        .string()
        .describe(
          'Vereinnahmungsdatum (YYYY-MM-DD): Tag der Gutschrift auf dem Konto, ' +
            'nicht die Wertstellung und nicht das Erfassungsdatum.'
        ),
      zahlungsweg: z
        .enum(['bank_transfer', 'cash', 'card', 'paypal', 'direct_debit', 'other'])
        .optional()
        .describe(
          'Bestimmt das Geldkonto der Buchung (Bank, Kasse, PayPal). Vorgabe: bank_transfer.'
        ),
      referenz: z.string().optional().describe('Verwendungszweck oder eigene Referenz'),
      zahlungsart: z
        .enum(['vollzahlung', 'teilzahlung', 'skonto', 'forderungsausfall'])
        .optional()
        .describe(
          'Nur noetig, wenn nach der Zahlung ein Rest offen bleibt. Dann Pflicht — vom Nutzer ' +
            'erfragen, nicht selbst waehlen.'
        ),
      begruendung: z
        .string()
        .optional()
        .describe(
          'Begruendung des Nutzers. Pflicht bei forderungsausfall und bei abweichendem Skonto. ' +
            'Nicht erfinden, sondern erfragen.'
        ),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        amount: params.betrag,
        paymentDate: params.zahlungsdatum,
      }
      if (params.zahlungsweg) body.paymentMethod = params.zahlungsweg
      if (params.referenz) body.reference = params.referenz
      if (params.zahlungsart) body.zahlungsart = params.zahlungsart
      if (params.begruendung) body.zahlungsartBegruendung = params.begruendung

      const result = await api.post<unknown>(
        `/invoices/${encodeURIComponent(params.rechnungId)}/payments`,
        body
      )
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    }
  )
}
