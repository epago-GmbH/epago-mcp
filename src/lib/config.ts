/**
 * Konfiguration aus Umgebungsvariablen laden.
 * Laedt optional eine .env-Datei neben dem Paket-Root.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

function loadEnvFile(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const envPath = resolve(__dirname, '../../.env')

  try {
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // .env ist optional – Variablen koennen auch ueber die Shell gesetzt sein
  }
}

loadEnvFile()

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Umgebungsvariable ${key} ist nicht gesetzt.\n` +
        `Setze sie z.B. mit: export ${key}=<wert>\n` +
        `Oder lege eine .env-Datei in packages/epago-mcp/ an.`
    )
  }
  return value
}

/**
 * Die Basis-URL pruefen, BEVOR ein Schluessel an sie geht (WP-32 Paket F,
 * SEC-API-4; Haertungshinweis aus dem Codex-Review vom 21.09.2026).
 *
 * Jeder Aufruf dieses Servers traegt `Authorization: Bearer <EPAGO_API_KEY>`.
 * Ueber `http://` ginge der Schluessel im Klartext durch das Netz — und
 * `EPAGO_API_URL` ist eine Zeichenkette aus der Umgebung, die in einer
 * MCP-Konfigurationsdatei steht und dort leicht falsch oder veraltet ist
 * (kopiertes Beispiel, Tippfehler, ein alter Tunnel).
 *
 * Erlaubt ist deshalb `https://` — dazu `http://` NUR fuer die eigene
 * Maschine (localhost, 127.0.0.1, ::1), weil dort kein Netz dazwischen liegt
 * und die lokale Entwicklung genau so laeuft (`npm run dev:frontend` auf
 * Port 3000 spricht kein TLS).
 */
function pruefeBasisUrl(roh: string): string {
  let url: URL
  try {
    url = new URL(roh)
  } catch {
    throw new Error(
      `EPAGO_API_URL ist keine gueltige URL: ${roh}\n` +
        `Erwartet wird z.B. https://app.epago.de`
    )
  }

  const lokal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  if (url.protocol === 'https:') return roh
  if (url.protocol === 'http:' && lokal) return roh

  throw new Error(
    `EPAGO_API_URL muss https:// sein (oder http:// auf localhost): ${roh}\n` +
      `Ueber http:// ginge der API-Schluessel im Klartext durch das Netz.`
  )
}

export const config = {
  api: {
    /** Basis-URL der epago-Instanz (ohne /api/v1). Nur https, ausser localhost. */
    url: pruefeBasisUrl((process.env.EPAGO_API_URL || 'https://app.epago.de').replace(/\/$/, '')),
    /** Pflicht: API-Key im Format epago_… */
    key: requireEnv('EPAGO_API_KEY'),
  },
}
