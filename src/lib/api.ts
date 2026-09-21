/**
 * Duenner HTTP-Client fuer die epago Public API v1.
 *
 * - Bearer-Auth via EPAGO_API_KEY
 * - Fehlerformat { error: { code, message } } → McpError; weitere Felder im
 *   Fehlerobjekt (z.B. Vorschlag/Optionen bei einer Zahlungsdifferenz) haengen
 *   als Datenblock an der Meldung
 * - 429 nennt die Wartezeit aus dem Header `Retry-After` (Sekunden) und das
 *   Limit aus `X-RateLimit-Limit`, sofern die API sie mitschickt
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { config } from './config.js'

const BASE = `${config.api.url}/api/v1`

export interface ApiError {
  error: {
    code: string
    message: string
  }
}

function isApiError(body: unknown): body is ApiError {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ApiError).error === 'object'
  )
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${config.api.key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let json: unknown
  try {
    json = await res.json()
  } catch {
    json = null
  }

  if (res.status === 429) {
    // Die API nennt seit v1.2.0 die Wartezeit im Sekunden-Header `Retry-After`
    // (RFC 9110, 10.2.3) und den Zustand des Fensters in `X-RateLimit-*`.
    // Wenn er da ist, wird er GENANNT statt "bitte kurz warten" — ein Client,
    // der die Sekunden kennt, muss nicht raten.
    const rohRetry = res.headers.get('retry-after')
    const sekunden = rohRetry && /^\d+$/.test(rohRetry.trim()) ? Number(rohRetry.trim()) : null
    const grenze = res.headers.get('x-ratelimit-limit')
    const wartehinweis = sekunden !== null
      ? `Bitte ${sekunden} Sekunde${sekunden === 1 ? '' : 'n'} warten und dann erneut versuchen.`
      : 'Bitte kurz warten und dann erneut versuchen.'
    const limithinweis = grenze ? ` Limit: ${grenze} Anfragen/Minute.` : ''
    throw new McpError(
      ErrorCode.InternalError,
      `Rate-Limit ueberschritten (HTTP 429). ${wartehinweis}${limithinweis}`
    )
  }

  if (res.status === 401) {
    const msg = isApiError(json) ? json.error.message : 'Unbekannter Auth-Fehler'
    const code = isApiError(json) ? json.error.code : 'invalid_api_key'
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Authentifizierung fehlgeschlagen (${code}): ${msg}`
    )
  }

  if (res.status === 403) {
    const msg = isApiError(json) ? json.error.message : 'Zugriff verweigert'
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Scope fehlt (HTTP 403): ${msg}. Dieser API-Key hat keinen Schreibzugriff.`
    )
  }

  if (res.status === 404) {
    const msg = isApiError(json) ? json.error.message : 'Nicht gefunden'
    throw new McpError(ErrorCode.InvalidRequest, `Nicht gefunden (HTTP 404): ${msg}`)
  }

  if (res.status === 409) {
    const msg = isApiError(json) ? json.error.message : 'Regelkonflikt'
    const apiCode = isApiError(json) ? json.error.code : 'conflict'
    if (apiCode === 'period_closed') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Periode ist bereits festgeschrieben (period_closed): ${msg} — Buchungen in dieser Periode sind nicht mehr moeglich.`
      )
    }
    if (apiCode === 'cannot_reverse') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Buchung kann nicht storniert werden (cannot_reverse): ${msg}`
      )
    }
    throw new McpError(ErrorCode.InvalidRequest, `Konflikt (${apiCode}): ${msg}`)
  }

  if (!res.ok) {
    if (isApiError(json)) {
      // Manche Absagen tragen mehr als code und message: bleibt nach einer
      // Zahlung ein Rest offen, liefert die API Vorschlag, Restbetrag und die
      // ausfuehrbaren Optionen im Fehlerobjekt mit. Die gehen hier MIT nach
      // aussen — eine Absage ohne Ausweg waere eine Sackgasse.
      const { code, message, ...rest } = json.error as Record<string, unknown> & {
        code: string
        message: string
      }
      const zusatz = Object.keys(rest).length
        ? `\n\nZusatzangaben der API:\n${JSON.stringify(rest, null, 2)}`
        : ''
      throw new McpError(
        ErrorCode.InternalError,
        `API-Fehler ${res.status} (${code}): ${message}${zusatz}`
      )
    }
    throw new McpError(ErrorCode.InternalError, `API-Fehler HTTP ${res.status}`)
  }

  return json as T
}

export const api = {
  get: <T>(path: string, params?: Record<string, string>) =>
    request<T>('GET', path, undefined, params),

  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
}
