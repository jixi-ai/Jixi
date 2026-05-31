import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JixiError } from '@jixi/js'
import { JixiProvider } from '../context'
import { useJixiWorkflow } from '../use-jixi-workflow'

const { mockRunWorkflow } = vi.hoisted(() => ({
  mockRunWorkflow: vi.fn(),
}))

vi.mock('@jixi/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jixi/js')>()
  return {
    ...actual,
    JixiClient: vi.fn().mockImplementation(() => ({
      runWorkflow: mockRunWorkflow,
    })),
  }
})

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <JixiProvider baseUrl="https://api.jixi.ai" apiKey="test_key">
      {children}
    </JixiProvider>
  )
}

describe('useJixiWorkflow', () => {
  beforeEach(() => {
    mockRunWorkflow.mockReset()
  })

  it('starts with null data, isLoading=false, error=null', () => {
    const { result } = renderHook(() => useJixiWorkflow('my_workflow'), { wrapper })
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('sets isLoading=true during execution and false after', async () => {
    let resolve!: (v: unknown) => void
    const promise = new Promise((r) => { resolve = r })
    mockRunWorkflow.mockReturnValueOnce(promise)

    const { result } = renderHook(() => useJixiWorkflow('my_workflow'), { wrapper })

    act(() => { result.current.run({ msg: 'hello' }) })
    expect(result.current.isLoading).toBe(true)

    await act(async () => { resolve({ answer: 42 }) })
    expect(result.current.isLoading).toBe(false)
  })

  it('sets data on success', async () => {
    mockRunWorkflow.mockResolvedValueOnce({ answer: 42 })
    const { result } = renderHook(
      () => useJixiWorkflow<{ msg: string }, { answer: number }>('my_workflow'),
      { wrapper },
    )

    await act(async () => { await result.current.run({ msg: 'hello' }) })

    expect(result.current.data).toEqual({ answer: 42 })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('sets error on JixiError, isLoading becomes false', async () => {
    const err = new JixiError('not found', 'workflow_not_found')
    mockRunWorkflow.mockRejectedValueOnce(err)

    const { result } = renderHook(() => useJixiWorkflow('my_workflow'), { wrapper })
    await act(async () => { await result.current.run({}) })

    expect(result.current.error).toBe(err)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeNull()
  })

  it('calling run() twice cancels the first call (aborted error is swallowed)', async () => {
    let resolve1!: (v: unknown) => void
    const p1 = new Promise((r) => { resolve1 = r })
    const p2 = Promise.resolve({ result: 'second' })

    mockRunWorkflow
      .mockReturnValueOnce(p1)
      .mockReturnValueOnce(p2)

    const { result } = renderHook(() => useJixiWorkflow('my_workflow'), { wrapper })

    act(() => { result.current.run({ call: 1 }) })
    await act(async () => { await result.current.run({ call: 2 }) })

    expect(result.current.data).toEqual({ result: 'second' })
    expect(result.current.error).toBeNull()
  })

  it('unmount during in-flight request does not set state (no warning)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let resolve!: (v: unknown) => void
    const promise = new Promise((r) => { resolve = r })
    mockRunWorkflow.mockReturnValueOnce(promise)

    const { result, unmount } = renderHook(() => useJixiWorkflow('my_workflow'), { wrapper })

    act(() => { result.current.run({}) })
    unmount()
    await act(async () => { resolve({ data: 1 }) })

    // React should not warn about state updates on unmounted components
    const warnings = consoleSpy.mock.calls.filter(([msg]) =>
      typeof msg === 'string' && msg.includes('unmounted'),
    )
    expect(warnings).toHaveLength(0)
    consoleSpy.mockRestore()
  })

  it('reset() clears data, error, and isLoading', async () => {
    mockRunWorkflow.mockResolvedValueOnce({ x: 1 })
    const { result } = renderHook(() => useJixiWorkflow('my_workflow'), { wrapper })

    await act(async () => { await result.current.run({}) })
    expect(result.current.data).toEqual({ x: 1 })

    act(() => { result.current.reset() })
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
