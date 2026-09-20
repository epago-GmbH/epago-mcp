/**
 * Steuer-Split-Logik (BU-Schluessel) — minimale lokale Kopie fuer epago-mcp.
 *
 * Kanonoische Quelle: apps/frontend/shared/utils/steuerschluessel.ts
 * Bei Aenderungen dort IMMER hier nachziehen.
 *
 * Beinhaltete BU-Schluessel (SKR03-Seed):
 *   1 = steuerfrei (keine Steuerzeile)
 *   2 = Umsatzsteuer  7 %  → 1770
 *   3 = Umsatzsteuer 19 %  → 1776
 *   8 = Vorsteuer     7 %  → 1570
 *   9 = Vorsteuer    19 %  → 1576
 */

export type TaxKind = 'ust' | 'vst' | 'free'

export interface TaxKeyDef {
  code: string
  label: string
  /** Steuersatz als Faktor (0.19, 0.07). 0 fuer steuerfrei. */
  rate: number
  kind: TaxKind
  /** Konto der Automatik-Steuerzeile (null bei steuerfrei). */
  taxAccount: string | null
  taxAccountName: string | null
}

/** Gueltige BU-Schluessel (SKR03-Seed). */
export const TAX_KEYS: Record<string, TaxKeyDef> = {
  '1': { code: '1', label: 'steuerfrei (mit VSt-Abzug)', rate: 0, kind: 'free', taxAccount: null, taxAccountName: null },
  '2': { code: '2', label: 'Umsatzsteuer 7 %', rate: 0.07, kind: 'ust', taxAccount: '1770', taxAccountName: 'Umsatzsteuer 7%' },
  '3': { code: '3', label: 'Umsatzsteuer 19 %', rate: 0.19, kind: 'ust', taxAccount: '1776', taxAccountName: 'Umsatzsteuer 19%' },
  '8': { code: '8', label: 'Vorsteuer 7 %', rate: 0.07, kind: 'vst', taxAccount: '1570', taxAccountName: 'Abziehbare Vorsteuer 7%' },
  '9': { code: '9', label: 'Vorsteuer 19 %', rate: 0.19, kind: 'vst', taxAccount: '1576', taxAccountName: 'Abziehbare Vorsteuer 19%' },
}

/** Automatikkonten: fest verdrahteter BU-Schluessel im epago-SKR03-Seed. */
export const AUTO_ACCOUNTS: Record<string, string> = {
  '8200': '3', // Erloese Inland 19 %  → USt 1776
  '8100': '2', // Erloese Inland 7 %   → USt 1770
  '8400': '1', // Erloese Inland steuerfrei
  '4400': '9', // Wareneingang 19 % VSt → VSt 1576
  '4300': '8', // Wareneingang 7 % VSt  → VSt 1570
}

/** Konten-Namen im Seed (fuer lesbare Zeilen-Beschreibungen). */
export const ACCOUNT_NAMES: Record<string, string> = {
  '8200': 'Erloese Inland 19 %',
  '8100': 'Erloese Inland 7 %',
  '8400': 'Erloese Inland steuerfrei',
  '4400': 'Wareneingang 19 % VSt',
  '4300': 'Wareneingang 7 % VSt',
  '1770': 'Umsatzsteuer 7 %',
  '1776': 'Umsatzsteuer 19 %',
  '1570': 'Abziehbare Vorsteuer 7 %',
  '1576': 'Abziehbare Vorsteuer 19 %',
}

/** Reservierte Codes, die in v2 nicht unterstuetzt werden. */
export const RESERVED_TAX_CODES = ['20', '22', '23', '28', '29', '40']

/**
 * Kaufmaennisch runden (round half up) auf 2 Nachkommastellen.
 * Number.EPSILON-Korrektur gegen IEEE-754-Rundungsdrift.
 */
export function roundHalfUp(value: number): number {
  const factor = 100
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export interface TaxSplit {
  brutto: number
  netto: number
  /** steuer = brutto - netto (Differenz-Methode, nie separat gerundet). */
  steuer: number
}

/**
 * Brutto → { netto, steuer } per Differenz-Methode.
 * Garantiert netto + steuer === brutto auf den Cent.
 */
export function splitBrutto(brutto: number, rate: number): TaxSplit {
  const b = roundHalfUp(brutto)
  if (rate === 0) return { brutto: b, netto: b, steuer: 0 }
  const netto = roundHalfUp(b / (1 + rate))
  const steuer = roundHalfUp(b - netto)
  return { brutto: b, netto, steuer }
}

export interface SimpleBuchungsLine {
  accountNumber: string
  accountName?: string
  debit: number
  credit: number
  taxCode: string | null
}

export interface BuildSimpleResult {
  ok: true
  lines: SimpleBuchungsLine[]
  split: TaxSplit | null
  effectiveTaxCode: string | null
}

export interface BuildSimpleError {
  ok: false
  message: string
}

export type BuildSimpleOutput = BuildSimpleResult | BuildSimpleError

/**
 * Erzeugt Buchungszeilen aus der vereinfachten MCP-Tool-Eingabe.
 *
 * Parameter:
 *   betrag        Bruttobetrag
 *   bruttoKonto   Das Konto, das den Bruttobetrag traegt
 *   bruttoSide    'S' = Brutto im Soll, 'H' = Brutto im Haben des bruttoKonto
 *   sachKonto     Das Sachkonto (traegt Netto + ggf. Steuerzeile)
 *   steuerschluessel  optional BU-Schluessel
 *
 * Aufloesungsreihenfolge (entspricht buildStapelLines in der Quelle):
 *   1. sachKonto ist Automatikkonto → fester Schluessel
 *   2. Sonst: steuerschluessel angegeben → Automatik aufs sachKonto
 *   3. Sonst: bruttoKonto ist Automatikkonto → Automatik umgekehrt
 *   4. Beide Automatik → Fehler
 *   5. Kein Schluessel → 2-Zeilen-Buchung ohne Steuer
 *
 * Fuer den MCP-Nutzer-Komfort gibt es auch die sollKonto/habenKonto-Variante
 * (buildSimpleLinesSH), die das bruttoKonto/sachKonto aus der Seite ableitet.
 */
export function buildSimpleLines(
  betrag: number,
  bruttoKonto: string,
  bruttoName: string,
  bruttoSide: 'S' | 'H',
  sachKonto: string,
  sachName: string,
  steuerschluessel?: string
): BuildSimpleOutput {
  const brutto = roundHalfUp(betrag)
  if (!Number.isFinite(brutto) || brutto <= 0) {
    return { ok: false, message: 'Betrag muss groesser als 0 sein.' }
  }
  if (bruttoKonto === sachKonto) {
    return { ok: false, message: 'Brutto- und Sachkonto muessen sich unterscheiden.' }
  }

  const buKey = (steuerschluessel || '').trim()
  if (buKey && RESERVED_TAX_CODES.includes(buKey)) {
    return {
      ok: false,
      message: `Steuerschluessel ${buKey} (Generalumkehr/Aufhebung) wird in v2 nicht unterstuetzt.`,
    }
  }
  if (buKey && !TAX_KEYS[buKey]) {
    return {
      ok: false,
      message: `Unbekannter Steuerschluessel "${buKey}". Gueltig: 1, 2, 3, 8, 9.`,
    }
  }

  const sachAuto = AUTO_ACCOUNTS[sachKonto]
  const bruttoAuto = AUTO_ACCOUNTS[bruttoKonto]

  if (sachAuto && bruttoAuto) {
    return {
      ok: false,
      message: 'Buchung zwischen zwei Automatikkonten wird nicht unterstuetzt.',
    }
  }

  if (sachAuto && buKey) {
    const def = TAX_KEYS[sachAuto]
    return {
      ok: false,
      message: `Konto ${sachKonto} ist ein Automatikkonto (${def?.label ?? ''}) — Steuerschluessel-Eingabe nicht zulaessig.`,
    }
  }

  // Sachkonto-Seite ist die Gegenseite des bruttoKonto
  const sachSide: 'S' | 'H' = bruttoSide === 'S' ? 'H' : 'S'

  let effectiveCode: string | null = null

  if (sachAuto) {
    effectiveCode = sachAuto
  } else if (buKey) {
    effectiveCode = buKey
  } else if (bruttoAuto) {
    // Automatik auf bruttoKonto: invertierte Rollen
    effectiveCode = bruttoAuto
    // In diesem Fall traegt bruttoKonto den Netto-Split, sachKonto den Brutto
    // (Schritt 3 aus buildStapelLines — Erfassung "andersherum")
    const def2 = TAX_KEYS[effectiveCode]!
    const split2 = splitBrutto(brutto, def2.rate)
    if (def2.kind === 'free') {
      return {
        ok: true,
        lines: [
          makeLine(sachKonto, sachName, sachSide, brutto, null),
          makeLine(bruttoKonto, bruttoName, bruttoSide, brutto, def2.code),
        ],
        split: { brutto, netto: brutto, steuer: 0 },
        effectiveTaxCode: def2.code,
      }
    }
    const taxAccountName2 = ACCOUNT_NAMES[def2.taxAccount!] || def2.taxAccountName || def2.taxAccount!
    return {
      ok: true,
      lines: [
        makeLine(sachKonto, sachName, sachSide, brutto, null),
        makeLine(bruttoKonto, bruttoName, bruttoSide, split2.netto, def2.code),
        makeLine(def2.taxAccount!, taxAccountName2, bruttoSide, split2.steuer, def2.code),
      ],
      split: split2,
      effectiveTaxCode: def2.code,
    }
  } else {
    // Schritt 5: keine Steuer, einfache 2-Zeilen-Buchung
    return {
      ok: true,
      lines: [
        makeLine(bruttoKonto, bruttoName, bruttoSide, brutto, null),
        makeLine(sachKonto, sachName, sachSide, brutto, null),
      ],
      split: null,
      effectiveTaxCode: null,
    }
  }

  const def = TAX_KEYS[effectiveCode]!
  const split = splitBrutto(brutto, def.rate)

  // BU 1 (steuerfrei): keine Steuerzeile, nur tax_code Kennzeichnung
  if (def.kind === 'free') {
    const lines: SimpleBuchungsLine[] = [
      makeLine(bruttoKonto, bruttoName, bruttoSide, brutto, null),
      makeLine(sachKonto, sachName, sachSide, brutto, def.code),
    ]
    return { ok: true, lines, split: { brutto, netto: brutto, steuer: 0 }, effectiveTaxCode: def.code }
  }

  // BU 2/3/8/9: 3-Zeilen-Buchung (Brutto + Netto + Steuer)
  const taxAccountName = ACCOUNT_NAMES[def.taxAccount!] || def.taxAccountName || def.taxAccount!
  const lines: SimpleBuchungsLine[] = [
    makeLine(bruttoKonto, bruttoName, bruttoSide, brutto, null),
    makeLine(sachKonto, sachName, sachSide, split.netto, def.code),
    makeLine(def.taxAccount!, taxAccountName, sachSide, split.steuer, def.code),
  ]
  return { ok: true, lines, split, effectiveTaxCode: def.code }
}


function makeLine(
  accountNumber: string,
  accountName: string,
  side: 'S' | 'H',
  amount: number,
  taxCode: string | null
): SimpleBuchungsLine {
  return {
    accountNumber,
    accountName,
    debit: side === 'S' ? amount : 0,
    credit: side === 'H' ? amount : 0,
    taxCode,
  }
}
