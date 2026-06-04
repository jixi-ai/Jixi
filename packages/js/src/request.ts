import { JixiError, type JixiErrorCode } from './errors'

interface RequestOpts {
  workflowName: string
  timeoutMs: number
  externalSignal?: AbortSignal
  token: string
}

export async function _request<T>(
  url: string,
  init: RequestInit,
  opts: RequestOpts
): Promise<T> {
  const { workflowName, timeoutMs, externalSignal, token } = opts
  const start = Date.now()

  const ctrl = new AbortController()
  let timedOut = false
  let aborted = false

  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)

  const onExternalAbort = () => {
    aborted = true
    ctrl.abort(externalSignal!.reason)
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      aborted = true
      const ms = Date.now() - start
      console.log(`[jixi] ${workflowName} ERROR ms=${ms} timeoutMs=${timeoutMs} aborted=true timedOut=false`)
      throw new JixiError('Request aborted', 'aborted', { workflowName, durationMs: ms })
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: ctrl.signal,
    })

    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)

    const ms = Date.now() - start

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      const code = statusToCode(response.status, bodyText)
      console.log(`[jixi] ${workflowName} ERROR ms=${ms} timeoutMs=${timeoutMs} aborted=false timedOut=false`)
      throw new JixiError(
        `Request failed: ${response.status} ${response.statusText}`,
        code,
        { status: response.status, workflowName, durationMs: ms }
      )
    }

    let text: string
    try {
      text = await response.text()
    } catch {
      throw new JixiError('Failed to read response body', 'parse_error', { workflowName, durationMs: ms })
    }

    let data: T
    try {
      data = JSON.parse(text) as T
    } catch {
      data = text as unknown as T
    }

    const len = text.length
    const keys = data !== null && typeof data === 'object' ? Object.keys(data as object).join(',') : ''
    console.log(`[jixi] ${workflowName} status=${response.status} ms=${ms} len=${len}`)
    if (keys) console.log(`[jixi] parsedKeys=${keys}`)

    return data
  } catch (err) {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onExternalAbort)

    if (err instanceof JixiError) throw err

    const ms = Date.now() - start

    if (err instanceof Error && err.name === 'AbortError') {
      console.log(`[jixi] ${workflowName} ERROR ms=${ms} timeoutMs=${timeoutMs} aborted=${aborted} timedOut=${timedOut}`)
      if (timedOut) {
        throw new JixiError(`Request timed out after ${timeoutMs}ms`, 'timeout', { workflowName, durationMs: ms })
      }
      throw new JixiError('Request aborted', 'aborted', { workflowName, durationMs: ms })
    }

    console.log(`[jixi] ${workflowName} ERROR ms=${ms} timeoutMs=${timeoutMs} aborted=${aborted} timedOut=${timedOut}`)
    throw new JixiError(
      err instanceof Error ? err.message : 'Unknown error',
      'unknown',
      { workflowName, durationMs: ms }
    )
  }
}

function statusToCode(status: number, body: string): JixiErrorCode {
  if (status === 401) return 'auth_failed'
  if (status === 404) return 'workflow_not_found'
  if (status === 400 && body.toLowerCase().includes('credit')) return 'credits_depleted'
  if (status >= 500) return 'server_error'
  return 'unknown'
}
