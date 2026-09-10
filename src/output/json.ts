export const SCHEMA_VERSION = 2

export interface ErrorPayload {
  code: string
  message: string
  details: Record<string, unknown> | null
}

export function successEnvelope(data: unknown): string {
  return (
    JSON.stringify({ schema_version: SCHEMA_VERSION, ok: true, data, error: null }, null, 2) + '\n'
  )
}

export function errorEnvelope(error: ErrorPayload): string {
  return (
    JSON.stringify({ schema_version: SCHEMA_VERSION, ok: false, data: null, error }, null, 2) +
    '\n'
  )
}

export interface EmitOptions {
  json?: boolean
}

export function emitSuccess(
  io: { stdout(text: string): void },
  opts: EmitOptions,
  data: unknown,
  renderText: () => string,
): void {
  io.stdout(opts.json ? successEnvelope(data) : renderText() + '\n')
}
