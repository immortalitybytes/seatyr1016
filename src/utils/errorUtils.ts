/**
 * Determines if an error represents an aborted operation (expected cancellation).
 * Aborted operations should never be shown as user-facing errors.
 * 
 * This handles various error structures from:
 * - Supabase client (different versions may structure AbortError differently)
 * - DOMException (browser abort signals)
 * - Custom abort strings from persistence layer
 */
export function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;

  const anyErr = error as any;
  const name = anyErr.name as string | undefined;
  const message = (anyErr.message as string | undefined)?.toLowerCase();
  const code = anyErr.code as string | undefined;

  // Standard AbortError
  if (name === 'AbortError') return true;
  
  // DOMException abort code
  if (code === 'ABORT_ERR') return true;
  
  // Message-based detection (handles wrapped errors)
  if (message?.includes('operation was aborted')) return true;
  if (message?.includes('request was aborted')) return true;
  if (message?.includes('aborted')) return true;

  // Custom abort markers (if you wrap AbortErrors yourself)
  if (anyErr.isAbortError === true) return true;

  return false;
}



