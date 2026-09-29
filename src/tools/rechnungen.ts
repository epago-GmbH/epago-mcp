/**
 * Tools: rechnungen_liste, rechnung_zahlungen, kunden_liste, rechnungen_ueberfaellig (lesend)
 *        zahlung_erfassen, rechnung_erstellen (schreibend, nur bei write-Scope)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
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

  // ──────────────────────────────────────────────────────────────────────────
  // kunden_liste
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'kunden_liste',
    'Kunden des Mandanten abrufen (Kundennummer, Name, Anschrift, E-Mail, USt-IdNr., ' +
      'Zahlungsziel in Tagen, Erlöskonto). Gedacht, um eine Rechnung an den richtigen Kunden ' +
      'zu adressieren: das Feld "id" ist die customerId für rechnung_erstellen. Die Liste ist ' +
      'seitenweise (limit, offset); "hasMore" zeigt, ob es weitere Seiten gibt. Nur lesend, ' +
      'Kunden anlegen oder ändern kann dieses Werkzeug nicht.',
    {
      limit: z.number().int().min(1).max(200).optional().describe('Anzahl je Seite, 1 bis 200 (Standard der API: 50)'),
      offset: z.number().int().min(0).optional().describe('Überspringt die ersten n Einträge'),
      suche: z.string().max(100).optional().describe('Suchtext (Name, Kundennummer), höchstens 100 Zeichen'),
      kundennummer: z.string().max(50).optional().describe('Exakte Kundennummer'),
      aktiv: z.boolean().optional().describe('true = nur aktive, false = nur inaktive Kunden'),
    },
    async (params) => {
      const p: Record<string, string> = {}
      if (params.limit !== undefined) p.limit = String(params.limit)
      if (params.offset !== undefined) p.offset = String(params.offset)
      if (params.suche) p.search = params.suche
      if (params.kundennummer) p.customerNumber = params.kundennummer
      if (params.aktiv !== undefined) p.active = String(params.aktiv)
      const result = await api.get<unknown>('/customers', p)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
  )

  // ──────────────────────────────────────────────────────────────────────────
  // rechnungen_ueberfaellig
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'rechnungen_ueberfaellig',
    'Offene Ausgangsrechnungen abrufen, standardmäßig nur die überfälligen. Liefert je Beleg ' +
      'Fälligkeit, Tage überfällig, offenen Betrag, erreichte Mahnstufe (reminderLevel) und ' +
      'Datum der letzten Mahnung, dazu Stichtag und Summe der offenen Beträge. Es ist dieselbe ' +
      'Ableitung wie in der Faktura und auf dem Dashboard. Nur lesend: eine Mahnung erzeugt ' +
      'dieses Werkzeug nicht, und ein MCP-Werkzeug dafür gibt es nicht.',
    {
      nurUeberfaellig: z
        .boolean()
        .optional()
        .describe('Standard true. false liefert alle offenen Rechnungen, auch die noch nicht fälligen.'),
      limit: z.number().int().min(1).max(200).optional().describe('Anzahl je Seite, 1 bis 200'),
      offset: z.number().int().min(0).optional().describe('Überspringt die ersten n Einträge'),
    },
    async (params) => {
      const p: Record<string, string> = {
        nurUeberfaellig: String(params.nurUeberfaellig ?? true),
      }
      if (params.limit !== undefined) p.limit = String(params.limit)
      if (params.offset !== undefined) p.offset = String(params.offset)
      const result = await api.get<unknown>('/invoices/open', p)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
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

  // ──────────────────────────────────────────────────────────────────────────
  // rechnung_erstellen
  // ──────────────────────────────────────────────────────────────────────────
  const zeile = z.object({
    description: z.string().min(1).describe('Positionstext'),
    quantity: z.number().gt(0).describe('Menge, größer 0'),
    unitPrice: z.number().describe('Einzelpreis netto in Euro'),
    taxRate: z.number().min(0).max(100).describe('Steuersatz in Prozent (0 bis 100)'),
    discountPercent: z.number().min(0).max(100).optional().describe('Positionsrabatt in Prozent'),
    unit: z.string().optional().describe('Einheit, z. B. "Tag" oder "Stk"'),
    revenueAccount: z
      .string()
      .regex(/^\d{4,8}$/)
      .optional()
      .describe('Erlöskonto (4 bis 8 Ziffern). Ohne Angabe wählt epago es aus dem Steuerfall.'),
    purchasePrice: z.number().optional().describe('Einkaufspreis je Einheit, Pflicht bei Differenzbesteuerung'),
    ossSatzArt: z.string().optional().describe('Satzart bei OSS-Umsätzen'),
  })

  server.tool(
    'rechnung_erstellen',
    [
      'Legt eine Ausgangsrechnung an, standardmäßig als ENTWURF, und bucht sie nur auf',
      'ausdrückliche Aufforderung des Nutzers (buchen: true). Die Rechnung läuft durch dieselbe',
      'Schreibschicht wie die Oberfläche (Steuerfall, Nummernkreis, Prüfungen).',
      '',
      'VOR dem Aufruf beim Nutzer erfragen, nicht raten:',
      '  1. Kunde: customerId aus kunden_liste ODER partnerName.',
      '  2. Rechnungsdatum (documentDate, YYYY-MM-DD).',
      '  3. Leistungszeit (Pflicht): deliveryDate ODER servicePeriodStart + servicePeriodEnd',
      '     ODER leistungszeitModus "keins" (nur wenn der Nutzer das ausdrücklich sagt).',
      '  4. Fälligkeit (Pflicht): dueDate ODER paymentTermDays (0 bis 365), nicht beides.',
      '  5. Steuerfall (taxScenario) und Steuersatz je Position, wenn es nicht der Regelfall ist',
      '     (EU, Drittland, Reverse Charge, Kleinunternehmer, OSS, Differenzbesteuerung).',
      '  6. Ob gebucht werden soll. Ohne ausdrückliche Aufforderung buchen=false lassen.',
      '',
      'ANTWORT LESEN: Die API antwortet mit 201, auch wenn die Buchung scheitert. Der Entwurf',
      'bleibt dann stehen. Ob gebucht wurde, steht ausschließlich in "buchung.gebucht"; bei false',
      'nennt "buchung.fehler" den Grund (code, message, ggf. Handlungsoption). Das dem Nutzer',
      'ehrlich sagen und nicht als Erfolg der Buchung melden. Die Rechnung selbst existiert.',
      '',
      'GoBD: Eine gebuchte Rechnung ist unveränderbar, Korrektur nur per Storno. Ein Entwurf',
      'ist noch keine Buchung und hat keine Wirkung auf die Umsatzsteuer.',
      '',
      'KEIN Idempotenzschluessel: Bei einem Timeout oder Verbindungsabbruch NICHT blind',
      'wiederholen, sonst entsteht eine zweite Rechnung. Erst mit rechnungen_liste prüfen, ob die',
      'Rechnung schon da ist.',
      '',
      'Nicht enthalten: Mahnung, Versand per E-Mail, PDF-Abruf, Angebot, Gutschrift und das Anlegen',
      'von Kunden. Dafür gibt es hier kein Werkzeug.',
    ].join('\n'),
    {
      customerId: z.string().optional().describe('ID des Kunden (Feld "id" aus kunden_liste). Alternativ partnerName.'),
      partnerName: z.string().optional().describe('Name des Empfängers, wenn kein Kunde angelegt ist'),
      partnerAddress: z.string().optional().describe('Anschrift des Empfängers (bei partnerName)'),
      documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Rechnungsdatum (YYYY-MM-DD)'),
      deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Lieferdatum (YYYY-MM-DD)'),
      servicePeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Leistungszeitraum von'),
      servicePeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Leistungszeitraum bis'),
      leistungszeitModus: z
        .enum(['lieferdatum', 'leistungsdatum', 'zeitraum', 'keins'])
        .optional()
        .describe('Art der Leistungszeitangabe. "keins" nur auf ausdrückliche Anweisung des Nutzers.'),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fälligkeitsdatum (YYYY-MM-DD)'),
      paymentTermDays: z.number().int().min(0).max(365).optional().describe('Zahlungsziel in Tagen, alternativ zu dueDate'),
      taxScenario: z.string().optional().describe('Steuerfall, z. B. standard, eu_b2b, third_country, small_business, oss'),
      notes: z.string().optional().describe('Bemerkung auf der Rechnung'),
      ossLand: z.string().optional().describe('Zielland bei OSS'),
      ossUrsprungsland: z.string().optional().describe('Ursprungsland bei OSS'),
      ossLeistungsart: z.string().optional().describe('Leistungsart bei OSS'),
      differenzArt: z.string().optional().describe('Pflichtangabe bei Differenzbesteuerung (§ 25a UStG)'),
      buyerReference: z.string().optional().describe('Leitweg-ID / Käuferreferenz für die E-Rechnung'),
      lines: z.array(zeile).min(1).max(200).describe('Positionen, 1 bis 200'),
      buchen: z.boolean().optional().describe('true nur auf ausdrückliche Aufforderung. Standard false (Entwurf).'),
    },
    async (params) => {
      if (!params.customerId && !params.partnerName) {
        throw new McpError(ErrorCode.InvalidParams, 'customerId oder partnerName ist Pflicht.')
      }
      if (params.dueDate && params.paymentTermDays !== undefined) {
        throw new McpError(ErrorCode.InvalidParams, 'dueDate und paymentTermDays nicht zusammen angeben.')
      }
      if (!params.dueDate && params.paymentTermDays === undefined) {
        throw new McpError(ErrorCode.InvalidParams, 'Fälligkeit fehlt: dueDate oder paymentTermDays angeben.')
      }
      const hatZeitraum = !!params.servicePeriodStart && !!params.servicePeriodEnd
      if (!params.deliveryDate && !hatZeitraum && params.leistungszeitModus !== 'keins') {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Leistungszeit fehlt: deliveryDate, servicePeriodStart plus servicePeriodEnd oder leistungszeitModus "keins".'
        )
      }
      if (!!params.servicePeriodStart !== !!params.servicePeriodEnd) {
        throw new McpError(ErrorCode.InvalidParams, 'servicePeriodStart und servicePeriodEnd nur zusammen angeben.')
      }

      const body: Record<string, unknown> = { ...params }
      body.buchen = params.buchen === true

      const result = await api.post<{
        invoice?: unknown
        buchung?: { gebucht?: boolean; fehler?: unknown } | null
      }>('/invoices', body)

      const gebucht = result.buchung?.gebucht === true
      let hinweis: string
      if (params.buchen !== true) {
        hinweis = 'Entwurf angelegt, nicht gebucht (buchen war nicht gesetzt).'
      } else if (gebucht) {
        hinweis = 'Rechnung angelegt und gebucht.'
      } else {
        hinweis =
          'ACHTUNG: Die Rechnung wurde als Entwurf angelegt, die BUCHUNG ist FEHLGESCHLAGEN. ' +
          'Grund: siehe buchung.fehler. Der Entwurf bleibt stehen und ist nicht gebucht.'
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ hinweis, ...result }, null, 2) }],
      }
    }
  )
}
