import type { Signal } from './options'

export class ImportError extends Error {
  readonly code: string

  constructor(message: string, options: { readonly code: string; readonly cause?: unknown }) {
    super(message, { cause: options.cause })
    this.code = options.code
  }
}

export function cancelled(signal?: Signal): void {
  if (signal?.aborted) {
    throw new ImportError('Release operation was cancelled', {
      code: 'ERR_IMPORT_ABORTED',
      cause: signal.reason
    })
  }
}

export function unavailable(error: unknown, signal: Signal): boolean {
  if (signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError') {
    return error === signal.reason || requestAborted(error)
  }
  if (!(error instanceof Error) || !('code' in error)) return false
  return error.code === 'ERR_RELEASE_NOT_CACHED' || error.code === 'ERR_RELEASE_NOT_FOUND'
}

export function importFailure(
  error: unknown,
  options: { readonly signal?: Signal; readonly deadline?: Signal }
): unknown {
  if (requestAborted(error) && options.deadline?.aborted) error = options.deadline.reason
  if (!(error instanceof Error)) return error
  if (
    options.deadline?.aborted &&
    error === options.deadline.reason &&
    error.name === 'TimeoutError'
  ) {
    return new ImportError('Release retrieval timed out', {
      code: 'ERR_IMPORT_TIMEOUT',
      cause: error
    })
  }
  if (options.signal?.aborted && (error === options.signal.reason || requestAborted(error))) {
    return new ImportError('Release operation was cancelled', {
      code: 'ERR_IMPORT_ABORTED',
      cause: error
    })
  }
  return error
}

function requestAborted(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ABORT_ERR'
}
