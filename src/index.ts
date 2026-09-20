#!/usr/bin/env node

/**
 * epago MCP Server
 *
 * Reiner API-Client: spricht die epago Public API v1 per API-Key an.
 * Kein Supabase-Zugriff, kein Direktzugriff auf die Datenbank.
 *
 * Einrichtung:
 *   export EPAGO_API_KEY=epago_...
 *   export EPAGO_API_URL=https://app.epago.de   # optional, Default
 *   claude mcp add epago -- node packages/epago-mcp/dist/index.js
 *
 * Scope-Verhalten:
 *   - Beim Start wird /v1/me abgefragt → Scope-Pruefung
 *   - Write-Tools (buchung_erstellen, buchung_stornieren, zahlung_erfassen,
 *     beleg_hochladen)
 *     werden nur registriert, wenn der Key den "write"-Scope hat
 *   - Read-only-Keys sehen nur Lese-Tools (kein Laufzeitfehler durch falschen Scope)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// Konfiguration laden (liest .env automatisch)
import './lib/config.js'
import { config } from './lib/config.js'
import { api } from './lib/api.js'

// Tool-Module
import * as konten from './tools/konten.js'
import * as buchungen from './tools/buchungen.js'
import * as rechnungen from './tools/rechnungen.js'
import * as belege from './tools/belege.js'
import * as berichte from './tools/berichte.js'

// ──────────────────────────────────────────────────────────────────────────
// Typ der /v1/me-Antwort
// ──────────────────────────────────────────────────────────────────────────
interface MeResponse {
  tenant: {
    userId: string
    companyName: string | null
    taxNumber: string | null
    vatId: string | null
  }
  apiKey: {
    keyId: string
    permissions: string[]
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Startup
// ──────────────────────────────────────────────────────────────────────────
async function main() {
  // Verbindungstest + Scope-Abfrage
  let me: MeResponse
  try {
    me = await api.get<MeResponse>('/me')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[epago-mcp] Startfehler: Verbindung zur API fehlgeschlagen.\n${msg}`)
    console.error(`[epago-mcp] API-URL: ${config.api.url}/api/v1`)
    console.error(`[epago-mcp] Bitte EPAGO_API_KEY und EPAGO_API_URL pruefen.`)
    process.exit(1)
  }

  const permissions = me.apiKey?.permissions ?? []
  const hasWrite = permissions.includes('write')
  const companyName = me.tenant?.companyName || me.tenant?.userId || '(unbekannt)'

  console.error(`[epago-mcp] Verbunden als: ${companyName}`)
  console.error(`[epago-mcp] Key-Scopes: ${permissions.join(', ') || '(keine)'}`)
  console.error(`[epago-mcp] Write-Tools: ${hasWrite ? 'aktiv' : 'NICHT registriert (read-only Key)'}`)

  // ──────────────────────────────────────────────────────────────────────────
  // Server aufbauen
  // ──────────────────────────────────────────────────────────────────────────
  const server = new McpServer({
    name: 'epago',
    version: '0.1.0',
  })

  // ──────────────────────────────────────────────────────────────────────────
  // mandant_info (Verbindungstest, immer verfuegbar)
  // ──────────────────────────────────────────────────────────────────────────
  server.tool(
    'mandant_info',
    'Verbindungstest und Mandanten-Stammdaten abrufen. Zeigt Firmenname, Steuernummer, USt-ID und die Scopes des verwendeten API-Keys. Gut als erster Aufruf um die Verbindung zu pruefen.',
    {},
    async () => {
      const result = await api.get<MeResponse>('/me')
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                mandant: result.tenant,
                apiKey: {
                  keyId: result.apiKey.keyId,
                  permissions: result.apiKey.permissions,
                  writeZugriff: result.apiKey.permissions.includes('write'),
                },
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
  // Lese-Tools (immer verfuegbar)
  // ──────────────────────────────────────────────────────────────────────────
  konten.register(server)
  buchungen.registerRead(server)
  rechnungen.register(server)
  berichte.register(server)

  // ──────────────────────────────────────────────────────────────────────────
  // Schreib-Tools (nur bei write-Scope)
  // ──────────────────────────────────────────────────────────────────────────
  if (hasWrite) {
    buchungen.registerWrite(server)
    rechnungen.registerWrite(server)
    belege.registerWrite(server)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Transport starten
  // ──────────────────────────────────────────────────────────────────────────
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[epago-mcp] MCP-Server gestartet (stdio)')
}

main().catch((err) => {
  console.error('[epago-mcp] Unerwarteter Fehler:', err)
  process.exit(1)
})
