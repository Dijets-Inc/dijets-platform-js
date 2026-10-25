/**
 * Errors thrown by the Dijets client. Every error has a stable `code` so that
 * callers can branch without parsing messages.
 */

export type DijetsErrorCode =
  | "CONFIG"
  | "NETWORK_MISMATCH"
  | "HTTP"
  | "RPC"
  | "TIMEOUT"
  | "ADDRESS"
  | "NAME"
  | "UNSUPPORTED"
  | "TX"

export class DijetsError extends Error {
  constructor(
    readonly code: DijetsErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message)
    this.name = new.target.name
    if (options && "cause" in options) (this as { cause?: unknown }).cause = options.cause
  }
}

/** A required value is missing or is still a placeholder. */
export class DijetsConfigError extends DijetsError {
  constructor(message: string) {
    super("CONFIG", message)
  }
}

/** The node reports a different network, chain or asset than the configuration expects. */
export class DijetsNetworkMismatchError extends DijetsError {
  constructor(
    readonly field: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(
      "NETWORK_MISMATCH",
      `The node reports ${field} ${actual}, but the configuration expects ${expected}. ` +
        "Check that the URL points at the network you meant."
    )
  }
}

/** The node answered with a non-2xx HTTP status. */
export class DijetsHttpError extends DijetsError {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body?: string
  ) {
    super("HTTP", `HTTP ${status} from ${url}`)
  }
}

/** The node answered with a JSON-RPC error. */
export class DijetsRpcError extends DijetsError {
  constructor(
    readonly method: string,
    readonly rpcCode: number | undefined,
    message: string,
    readonly data?: unknown
  ) {
    super("RPC", `${method}: ${message}`)
  }
}

export class DijetsTimeoutError extends DijetsError {
  constructor(readonly url: string, readonly timeoutMs: number) {
    super("TIMEOUT", `No answer from ${url} within ${timeoutMs} ms`)
  }
}

/** An address is malformed, or is for a different chain or network than required. */
export class DijetsAddressError extends DijetsError {
  constructor(message: string) {
    super("ADDRESS", message)
  }
}

/** A name breaks the registry's rules. `rule` is the node's rule identifier. */
export class DijetsNameError extends DijetsError {
  constructor(readonly rule: string, message: string) {
    super("NAME", message)
  }
}

/** The operation is not available on this network, chain or wallet. */
export class DijetsUnsupportedError extends DijetsError {
  constructor(message: string) {
    super("UNSUPPORTED", message)
  }
}

/** A transaction could not be built or was rejected. */
export class DijetsTxError extends DijetsError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("TX", message, options)
  }
}
