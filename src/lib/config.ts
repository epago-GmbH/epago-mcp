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

export const config = {
  api: {
    /** Basis-URL der epago-Instanz (ohne /api/v1). */
    url: (process.env.EPAGO_API_URL || 'https://app.epago.de').replace(/\/$/, ''),
    /** Pflicht: API-Key im Format epago_… */
    key: requireEnv('EPAGO_API_KEY'),
  },
}
