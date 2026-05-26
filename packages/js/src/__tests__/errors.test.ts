import { describe, it, expect } from 'vitest'
import { JixiError } from '../errors'

describe('JixiError', () => {
  it('sets code and message', () => {
    const err = new JixiError('test message', 'auth_failed')
    expect(err.message).toBe('test message')
    expect(err.code).toBe('auth_failed')
    expect(err.name).toBe('JixiError')
  })

  it('is instanceof Error and JixiError', () => {
    const err = new JixiError('test', 'unknown')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(JixiError)
  })

  it('sets all optional fields from opts', () => {
    const err = new JixiError('fail', 'server_error', {
      status: 500,
      workflowName: 'my_workflow',
      runId: 'run-123',
      durationMs: 1234,
    })
    expect(err.status).toBe(500)
    expect(err.workflowName).toBe('my_workflow')
    expect(err.runId).toBe('run-123')
    expect(err.durationMs).toBe(1234)
  })

  it('leaves optional fields undefined when opts not provided', () => {
    const err = new JixiError('test', 'unknown')
    expect(err.status).toBeUndefined()
    expect(err.workflowName).toBeUndefined()
    expect(err.runId).toBeUndefined()
    expect(err.durationMs).toBeUndefined()
  })

  it('each error code can be constructed', () => {
    const codes = [
      'auth_failed', 'workflow_not_found', 'credits_depleted',
      'timeout', 'aborted', 'stream_interrupted', 'parse_error',
      'server_error', 'unknown',
    ] as const
    for (const code of codes) {
      expect(new JixiError('test', code).code).toBe(code)
    }
  })
})
