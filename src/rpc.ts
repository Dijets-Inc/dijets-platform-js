/**
 * The HTTP transport for every JSON-RPC call the client makes, including the
 * upstream chain APIs (their `callMethod` is replaced by `adoptRpc`). One
 * transport means one place for headers, authentication, timeouts and errors.
 */
import {
  DijetsError,
  DijetsHttpError,
  DijetsRpcError,
  DijetsTimeoutError
} from "./errors"

export interface TransportOptions {
  /** Node base URL, e.g. "http://127.0.0.1:9650". */
  baseUrl: string
  headers?: Record<string, string>
  /** Sent as `Authorization: Bearer <token>` (node auth API tokens). */
  authToken?: string
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number
  /** Override for tests or non-standard environments. */
  fetch?: typeof fetch
}

export class Transport {
  readonly baseUrl: string
  readonly timeoutMs: number
  private readonly headers: Record<string, string>
  private readonly fetchImpl: typeof fetch
  private nextID = 1

  constructor(options: TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "")
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.headers = { ...(options.headers ?? {}) }
    if (options.authToken) this.headers.Authorization = `Bearer ${options.authToken}`
    const f = options.fetch ?? (typeof fetch === "function" ? fetch : undefined)
    if (!f) {
      throw new DijetsError("CONFIG", "No fetch implementation: use Node 18+ or pass { fetch } in the client options")
    }
    this.fetchImpl = f
  }

  /** A full URL for a node path such as "/ext/bc/V". */
  url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`
  }

  /** Raw HTTP request with the shared headers and timeout. Returns the body text. */
  async request(
    path: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {}
  ): Promise<string> {
    const url = this.url(path)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        body: init.body,
        headers: { ...this.headers, ...(init.headers ?? {}) },
        signal: controller.signal
      })
    } catch (e) {
      if (controller.signal.aborted) throw new DijetsTimeoutError(url, this.timeoutMs)
      throw new DijetsHttpError(0, url, `no response: ${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    if (!res.ok) throw new DijetsHttpError(res.status, url, text.slice(0, 500))
    return text
  }

  /** Calls a JSON-RPC 2.0 method and returns its `result`, or throws `DijetsRpcError`. */
  async call<T = any>(path: string, method: string, params?: unknown): Promise<T> {
    return (await this.callRaw(path, method, params)).result as T
  }

  /** As `call`, but returns the whole response object. */
  async callRaw(path: string, method: string, params?: unknown): Promise<{ result?: unknown; [k: string]: unknown }> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: this.nextID++, method, params: params ?? {} })
    const text = await this.request(path, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json;charset=UTF-8" }
    })
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new DijetsHttpError(200, this.url(path), `not JSON: ${text.slice(0, 200)}`)
    }
    if (parsed === null || typeof parsed !== "object") {
      throw new DijetsRpcError(method, undefined, "empty response")
    }
    if (parsed.error) {
      throw new DijetsRpcError(method, parsed.error.code, parsed.error.message ?? "error", parsed.error.data)
    }
    return parsed
  }
}

/** The subset of an upstream JRPCAPI the adapter touches. */
interface UpstreamRpcApi {
  callMethod: (method: string, params?: object[] | object, baseURL?: string, headers?: object) => Promise<any>
  getBaseURL: () => string
}

/**
 * Routes an upstream API's JSON-RPC calls through the Dijets transport. The
 * upstream code reads `response.data.result`, so the response keeps that shape;
 * failures become typed Dijets errors instead of a bare `Error` (JSON-RPC) or a
 * silently returned non-2xx response (HTTP).
 */
export function adoptRpc<T extends UpstreamRpcApi>(api: T, transport: Transport): T {
  api.callMethod = async (method, params, baseURL, headers) => {
    const path = baseURL || api.getBaseURL()
    if (headers && Object.keys(headers).length) {
      throw new DijetsError("CONFIG", "Per-call headers are not supported; set headers in the client options")
    }
    const data = await transport.callRaw(path, method, params)
    return { data, headers: {}, status: 200, statusText: "OK", request: undefined }
  }
  return api
}
