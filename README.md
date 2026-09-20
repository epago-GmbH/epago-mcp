# epago MCP Server

MCP-Server (stdio) fuer [epago](https://epago.de), die Buchhaltungssoftware fuer deutsche KMU.
Damit koennen Claude Code, Claude Desktop und andere MCP-faehige Werkzeuge direkt in deiner
epago-Buchhaltung lesen und buchen: Kontenplan, Buchungen, Rechnungen, Zahlungen, Belege, BWA und
Umsatzsteuer-Voranmeldung.

Der Server ist ein reiner Client der [epago Public API v1](https://app.epago.de/api/openapi.json).
Er braucht einen epago-Account und einen API-Schluessel. Es gibt keinen Direktzugriff auf eine
Datenbank, keine gespeicherten Zugangsdaten und keine Loesch-Werkzeuge.

> *English:* MCP server for the German accounting SaaS epago. Requires an epago account and an
> API key. All tools and messages are in German, because the domain (German tax law, GoBD, DATEV
> charts of accounts) is.

## Voraussetzungen

- Ein epago-Account unter [app.epago.de](https://app.epago.de)
- Node.js 20 oder neuer
- Ein API-Schluessel aus epago: **Einstellungen → API-Schluessel**
  (Anleitung: [Mein Konto und API-Schluessel](https://epago.de/hilfe/mein-konto-und-api-schluessel))

Beim Anlegen des Schluessels waehlst du die Berechtigungen:

| Scope | Wirkung im MCP-Server |
|---|---|
| `read` | Lese-Werkzeuge (Konten, Buchungen, Rechnungen, Berichte) |
| `write` | zusaetzlich die Schreib-Werkzeuge (Buchung anlegen, Storno, Zahlung, Beleg) |

Der Klartext-Schluessel (`epago_…`) wird nur einmal angezeigt. Ein Schluessel gehoert genau
einem Mandanten und laesst sich in epago jederzeit widerrufen.

## Installation

```bash
git clone https://github.com/epago-GmbH/epago-mcp.git
cd epago-mcp
npm install
npm run build        # erzeugt dist/index.js
```

## Einrichtung

### Claude Code

```bash
claude mcp add epago \
  --env EPAGO_API_KEY=epago_... \
  --env EPAGO_API_URL=https://app.epago.de \
  -- node /absoluter/pfad/zu/epago-mcp/dist/index.js
```

### Claude Desktop

In `claude_desktop_config.json`:

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

### Andere MCP-Clients

Der Server spricht MCP ueber stdio. Starten mit `node dist/index.js`, Konfiguration ueber
Umgebungsvariablen. Statt Shell-Variablen kann eine `.env`-Datei im Repository-Root liegen
(sie ist per `.gitignore` ausgeschlossen):

```env
EPAGO_API_KEY=epago_...
EPAGO_API_URL=https://app.epago.de
```

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `EPAGO_API_KEY` | ja | API-Schluessel im Format `epago_…` |
| `EPAGO_API_URL` | nein | Basis-URL der epago-Instanz, Standard `https://app.epago.de` |

Beim Start ruft der Server `/api/v1/me` auf, prueft den Schluessel und registriert die
Schreib-Werkzeuge nur, wenn der Schluessel den Scope `write` traegt. Ein Schluessel ohne
`write` sieht die Schreib-Werkzeuge gar nicht erst.

## Werkzeuge

### Lesen (Scope `read`)

| Werkzeug | Was es tut |
|---|---|
| `mandant_info` | Verbindungstest, Stammdaten des Mandanten, Scopes des Schluessels |
| `konten_liste` | Kontenplan, optional mit Salden fuer einen Zeitraum |
| `konto_auszug` | Kontenblatt eines Kontos mit laufendem Saldo |
| `buchungen_liste` | Buchungen mit allen Zeilen, gefiltert nach Datum und Status |
| `rechnungen_liste` | Ein- und Ausgangsrechnungen mit Status und Zahlungsstatus |
| `rechnung_zahlungen` | Zahlungen eines Belegs mit Betrag, Datum, Buchung und Zahlungsart |
| `bericht_bwa` | Betriebswirtschaftliche Auswertung fuer einen Zeitraum |
| `bericht_ustva` | Kennzahlen der Umsatzsteuer-Voranmeldung fuer einen Zeitraum |
| `salden` | Saldenliste aller Konten zu einem Stichtag |

### Schreiben (Scope `write`)

| Werkzeug | Was es tut |
|---|---|
| `buchung_erstellen` | Buchung anlegen, vereinfacht (Betrag, zwei Konten, Steuerschluessel) oder mit expliziten Zeilen |
| `buchung_stornieren` | GoBD-konformer Storno: Gegenbuchung mit Tagesdatum, das Original bleibt stehen |
| `zahlung_erfassen` | Zahlung an einem Beleg erfassen; Skonto, Teilzahlung und Forderungsausfall werden abgefragt, nicht geraten |
| `beleg_hochladen` | Beleg als Base64 hochladen (PDF, Bilder, Tabellen, max. 10 MB) |

Die Beschreibungen der Werkzeuge sind bewusst ausfuehrlich: sie sind die Schnittstelle zum
Sprachmodell und erklaeren dort, was GoBD-fest ist, was eine Rueckfrage an den Nutzer braucht
(Zahlungsart bei offenem Rest, Begruendung bei Forderungsausfall) und was nicht geht.

## Was man wissen muss

- **Gebucht ist gebucht.** Eine Buchung mit `status: "posted"` ist sofort unveraenderbar
  (GoBD). Korrektur nur per `buchung_stornieren`. Loeschen gibt es nicht, auch nicht ueber die
  API.
- **Festgeschriebene Perioden** weisen jede Buchung mit `409 period_closed` ab.
- **Offener Rest bei einer Zahlung** ist eine Entscheidung des Nutzers: Teilzahlung, Skonto
  oder Forderungsausfall. Ohne `zahlungsart` antwortet die API mit `400` und liefert Restbetrag,
  Vorschlag und Optionen mit. Paragraf 17 UStG kennt keine Bagatellgrenze.
- **Steuerschluessel im vereinfachten Modus** (`buchung_erstellen` mit `betrag`,
  `bruttoKonto`, `sachKonto`): unterstuetzt sind 1, 2, 3, 8 und 9. Die Tabelle der
  Automatikkonten in `src/lib/steuer.ts` stammt aus einem aelteren epago-Kontenstamm und passt
  nicht mehr zu den DATEV-Kontenrahmen 2026, die epago seit September 2026 ausliefert. Gib den
  Steuerschluessel deshalb ausdruecklich an oder nutze `lines[]` (Experten-Modus). Die
  Pruefung auf Steuerkonsistenz laeuft in jedem Fall serverseitig, eine unpassende Buchung
  wird abgewiesen, nicht still gebucht. Die Bereinigung steht auf der Roadmap (siehe unten).
- **Rate-Limit:** 60 Aufrufe je Minute und Schluessel. Bei `429` kurz warten.

## Sicherheit

- Der API-Schluessel kommt ausschliesslich aus der Umgebung (`EPAGO_API_KEY` oder `.env`).
  Er wird nur als `Authorization: Bearer` an die konfigurierte `EPAGO_API_URL` gesendet und
  taucht in keiner Ausgabe, keinem Log und keiner Fehlermeldung auf.
- Der Server haelt keinen Zustand und speichert nichts auf der Festplatte.
- Schreibende Werkzeuge existieren nur mit `write`-Scope. Fuer reine Auswertungen einen
  Schluessel ohne `write` anlegen.
- Achte darauf, `EPAGO_API_URL` nur auf epago selbst zu setzen. Wer die URL auf einen
  fremden Host zeigt, schickt seinen Schluessel dorthin.
- Alle Buchungen ueber die API laufen in epago durch dieselbe Pruefschicht wie die
  Oberflaeche (Soll gleich Haben, Steuerkonsistenz, Periodensperre, Mandantentrennung).
  Es gibt keinen zweiten, laxeren Pfad.

Sicherheitsluecken bitte nicht als oeffentliches Issue melden, sondern an
[service@epago.de](mailto:service@epago.de).

## Roadmap

Geplant, ohne Termin (Stand September 2026):

- `rechnung_erstellen`: Ausgangsrechnung anlegen und buchen, aus der Konsole heraus
- `mahnung_erstellen`: Mahnung zu einer offenen Rechnung erzeugen, mit den zugehoerigen Buchungen
- `rechnungen_ueberfaellig`: pruefen, welche Rechnungen faellig oder ueberfaellig sind
- `kunden_liste`: Kunden lesen, damit eine Rechnung adressiert werden kann
- Automatikkonten-Tabelle im vereinfachten Modus auf die DATEV-Rahmen 2026 ziehen bzw. den
  Steuer-Split serverseitig rechnen lassen

## Entwicklung

```bash
npm run dev      # startet src/index.ts direkt mit tsx
npm run build    # TypeScript nach dist/
```

Dieses Repository ist ein Spiegel des Pakets `packages/epago-mcp` aus dem epago-Monorepo.
Issues und Pull Requests sind willkommen; Aenderungen werden ins Monorepo uebernommen und von
dort wieder hierher gespiegelt.

## Lizenz

MIT, siehe [LICENSE](LICENSE). epago selbst ist ein kommerzieller Dienst der epago GmbH;
dieses Repository enthaelt nur den MCP-Client.
