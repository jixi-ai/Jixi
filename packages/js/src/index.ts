export interface JixiConfig {
  apiUrl?: string
  token?: string
}

export interface WorkflowPayload {
  workflowId: string
  input?: Record<string, unknown>
}

export interface WorkflowResult<T = unknown> {
  output: T
  runId: string
}

export class JixiClient {
  private apiUrl: string
  private token: string | undefined

  constructor(config: JixiConfig = {}) {
    this.apiUrl = config.apiUrl ?? 'https://api.jixi.ai'
    this.token = config.token
  }

  async run<T = unknown>(payload: WorkflowPayload): Promise<WorkflowResult<T>> {
    throw new Error('Not implemented')
  }

  stream(payload: WorkflowPayload): AsyncIterable<unknown> {
    throw new Error('Not implemented')
  }
}

export function createClient(config?: JixiConfig): JixiClient {
  return new JixiClient(config)
}
