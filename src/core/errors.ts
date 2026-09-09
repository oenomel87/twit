export type ErrorCode =
  | 'ACTOR_NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'REQUEST_ID_CONFLICT'
  | 'STORAGE_ERROR'
  | 'INTERNAL'

export const EXIT_CODES: Record<ErrorCode, number> = {
  ACTOR_NOT_CONFIGURED: 8,
  NOT_FOUND: 3,
  FORBIDDEN: 4,
  VALIDATION_ERROR: 2,
  REQUEST_ID_CONFLICT: 5,
  STORAGE_ERROR: 6,
  INTERNAL: 1,
}

export class TwitError extends Error {
  readonly code: ErrorCode
  readonly details: Record<string, unknown> | null

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'TwitError'
    this.code = code
    this.details = details
  }

  get exitCode(): number {
    return EXIT_CODES[this.code]
  }
}
