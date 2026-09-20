# epago MCP Server

MCP-Server (stdio) für [epago](https://epago.de), die Buchhaltungssoftware für deutsche KMU.
Damit kann jeder MCP-fähige Client direkt in deiner epago-Buchhaltung lesen und buchen:
Kontenplan, Buchungen, Rechnungen, Zahlungen, Belege, BWA und Umsatzsteuer-Voranmeldung.

Der Server ist ein reiner Client der [epago Public API v1](https://app.epago.de/api/openapi.json).
Er braucht einen epago-Account und einen API-Schlüssel. Es gibt keinen Direktzugriff auf eine
Datenbank, keine gespeicherten Zugangsdaten und keine Lösch-Werkzeuge.

> *English:* MCP server for the German accounting SaaS epago. Requires an epago account and an
> API key. Tools and messages are in German, because the domain (German tax law, GoBD, DATEV
> charts of accounts) is.

## Voraussetzungen

- Ein epago-Account unter [app.epago.de](https://app.epago.de)
- Node.js 20 oder neuer
- Ein API-Schlüssel aus epago: **Einstellungen → API-Schlüssel**
  (Anleitung: [Mein Konto und API-Schlüssel](https://epago.de/hilfe/mein-konto-und-api-schluessel))

Beim Anlegen des Schlüssels wählst du die Berechtigungen:

| Scope | Wirkung im MCP-Server |
|---|---|
| `read` | Lese-Werkzeuge (Konten, Buchungen, Rechnungen, Berichte) |
| `write` | zusätzlich die Schreib-Werkzeuge (Buchung anlegen, Storno, Zahlung, Beleg) |

Der Klartext-Schlüssel (`epago_…`) wird nur einmal angezeigt. Ein Schlüssel gehört genau
einem Mandanten und lässt sich in epago jederzeit widerrufen.

## Installation

```bash
git clone https://github.com/epago-GmbH/epago-mcp.git
cd epago-mcp
npm install
npm run build        # erzeugt dist/index.js
```

## Einrichtung

Der Server spricht MCP über stdio und wird vom MCP-Client als Prozess gestartet:

```bash
EPAGO_API_KEY=epago_... node /absoluter/pfad/zu/epago-mcp/dist/index.js
```

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `EPAGO_API_KEY` | ja | API-Schlüssel im Format `epago_…` |
| `EPAGO_API_URL` | nein | Basis-URL der epago-Instanz, Standard `https://app.epago.de` |

Die meisten MCP-Clients nehmen eine Konfiguration dieser Form entgegen (Name des Servers,
Befehl, Argumente, Umgebungsvariablen):

```json
{
  "mcpServers": {
    "epago": {
      "command": "node",
      "args": ["/absoluter/pfad/zu/epago-mcp/dist/index.js"],
      "env": {
        "EPAGO_API_KEY": "epago_...",
        "EPAGO_API_URL": "https://app.epago.de"
      }
    }
  }
}
```

Statt der Umgebungsvariablen kann eine `.env`-Datei im Repository-Root liegen (sie ist per
`.gitignore` ausgeschlossen):

```env
EPAGO_API_KEY=epago_...
EPAGO_API_URL=https://app.epago.de
```

Beim Start ruft der Server `/api/v1/me` auf, prüft den Schlüssel und registriert die
Schreib-Werkzeuge nur, wenn der Schlüssel den Scope `write` trägt. Ein Schlüssel ohne
`write` sieht die Schreib-Werkzeuge gar nicht erst. Ein ungültiger Schlüssel beendet den
Start mit einer Fehlermeldung.

## Werkzeuge

### Lesen (Scope `read`)

| Werkzeug | Was es tut |
|---|---|
| `mandant_info` | Verbindungstest, Stammdaten des Mandanten, Scopes des Schlüssels |
| `konten_liste` | Kontenplan, optional mit Salden für einen Zeitraum |
| `konto_auszug` | Kontenblatt eines Kontos mit laufendem Saldo |
| `buchungen_liste` | Buchungen mit allen Zeilen, gefiltert nach Datum und Status |
| `rechnungen_liste` | Ein- und Ausgangsrechnungen mit Status und Zahlungsstatus |
| `rechnung_zahlungen` | Zahlungen eines Belegs mit Betrag, Datum, Buchung und Zahlungsart |
| `bericht_bwa` | Betriebswirtschaftliche Auswertung für einen Zeitraum |
| `bericht_ustva` | Kennzahlen der Umsatzsteuer-Voranmeldung für einen Zeitraum |
| `salden` | Saldenliste aller Konten zu einem Stichtag |

### Schreiben (Scope `write`)

| Werkzeug | Was es tut |
|---|---|
| `buchung_erstellen` | Buchung anlegen, vereinfacht (Betrag, zwei Konten, Steuerschlüssel) oder mit expliziten Zeilen |
| `buchung_stornieren` | GoBD-konformer Storno: Gegenbuchung mit Tagesdatum, das Original bleibt stehen |
| `zahlung_erfassen` | Zahlung an einem Beleg erfassen; Skonto, Teilzahlung und Forderungsausfall werden abgefragt, nicht geraten |
| `beleg_hochladen` | Beleg als Base64 hochladen (PDF, Bilder, Tabellen, max. 10 MB) |

Die Beschreibungen der Werkzeuge sind bewusst ausführlich: sie sind die Schnittstelle zum
Sprachmodell und erklären dort, was GoBD-fest ist, was eine Rückfrage an den Nutzer braucht
(Zahlungsart bei offenem Rest, Begründung bei Forderungsausfall) und was nicht geht.

## Was man wissen muss

- **Gebucht ist gebucht.** Eine Buchung mit `status: "posted"` ist sofort unveränderbar
  (GoBD). Korrektur nur per `buchung_stornieren`. Löschen gibt es nicht, auch nicht über die
  API.
- **Festgeschriebene Perioden** weisen jede Buchung mit `409 period_closed` ab.
- **Offener Rest bei einer Zahlung** ist eine Entscheidung des Nutzers: Teilzahlung, Skonto
  oder Forderungsausfall. Ohne `zahlungsart` antwortet die API mit `400` und liefert Restbetrag,
  Vorschlag und Optionen mit. § 17 UStG kennt keine Bagatellgrenze.
- **Vereinfachte Buchung:** `buchung_erstellen` mit `betrag`, `bruttoKonto`, `sachKonto` und
  optional `steuerschluessel` (1 steuerfrei, 2 USt 7 %, 3 USt 19 %, 8 VSt 7 %, 9 VSt 19 %).
  Den Buchungssatz samt Steuerzeile rechnet der Server mit dem Kontenrahmen des Mandanten
  (SKR03 oder SKR04); Automatikkonten erkennt er selbst. Die Soll-/Haben-Seite leitet er bei
  den Schlüsseln 2, 3, 8 und 9 aus dem Steuerfall ab; bei Schlüssel 1 und bei einer Buchung
  ohne Schlüssel (reine Umbuchung) ist `seite` (`S` oder `H`, bezogen auf das Bruttokonto)
  Pflicht, weil sie sich dort nicht ableiten lässt. Wer die Zeilen selbst vorgeben will,
  nutzt `lines[]`. In beiden Fällen prüft der Server Soll gleich Haben und Steuerkonsistenz.
- **Rate-Limit:** 60 Aufrufe je Minute und Schlüssel. Bei `429` kurz warten.

## Sicherheit

- Der API-Schlüssel kommt ausschließlich aus der Umgebung (`EPAGO_API_KEY` oder `.env`).
  Er wird nur als `Authorization: Bearer` an die konfigurierte `EPAGO_API_URL` gesendet und
  taucht in keiner Ausgabe, keinem Log und keiner Fehlermeldung auf.
- Der Server hält keinen Zustand und speichert nichts auf der Festplatte.
- Schreibende Werkzeuge existieren nur mit `write`-Scope. Für reine Auswertungen einen
  Schlüssel ohne `write` anlegen.
- `EPAGO_API_URL` nur auf epago selbst setzen. Wer die URL auf einen fremden Host zeigt,
  schickt seinen Schlüssel dorthin.
- Alle Buchungen über die API laufen in epago durch dieselbe Prüfschicht wie die
  Oberfläche (Soll gleich Haben, Steuerkonsistenz, Periodensperre, Mandantentrennung).
  Es gibt keinen zweiten, laxeren Pfad.

Sicherheitslücken bitte nicht als öffentliches Issue melden, sondern an
[service@epago.de](mailto:service@epago.de).

## Roadmap

Geplant, ohne Termin:

- `rechnung_erstellen`: Ausgangsrechnung anlegen und buchen
- `mahnung_erstellen`: Mahnung zu einer offenen Rechnung erzeugen
- `rechnungen_ueberfaellig`: prüfen, welche Rechnungen fällig oder überfällig sind
- `kunden_liste`: Kunden lesen, damit eine Rechnung adressiert werden kann

## Entwicklung

```bash
npm run dev      # startet src/index.ts direkt mit tsx
npm run build    # TypeScript nach dist/
```

Dieses Repository ist ein Spiegel des Pakets `packages/epago-mcp` aus dem epago-Monorepo.
Issues und Pull Requests sind willkommen; Änderungen werden ins Monorepo übernommen und von
dort wieder hierher gespiegelt.

## Lizenz

MIT, siehe [LICENSE](LICENSE). epago selbst ist ein kommerzieller Dienst der epago GmbH;
dieses Repository enthält nur den MCP-Client.
