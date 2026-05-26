export type JixiErrorCode =
  | 'auth_failed'
  | 'workflow_not_found'
  | 'credits_depleted'
  | 'timeout'
  | 'aborted'
  | 'stream_interrupted'
  | 'parse_error'
  | 'server_error'
  | 'unknown'

export class JixiError extends Error {
  readonly code: JixiErrorCode
  readonly status?: number
  readonly workflowName?: string
  readonly runId?: string
  readonly durationMs?: number

  constructor(
    message: string,
    code: JixiErrorCode,
    opts?: {
      status?: number
      workflowName?: string
      runId?: string
      durationMs?: number
    }
  ) {
    super(message)
    this.name = 'JixiError'
    this.code = code
    this.status = opts?.status
    this.workflowName = opts?.workflowName
    this.runId = opts?.runId
    this.durationMs = opts?.durationMs
  }
}
