import { renderHook } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JixiClient } from '@jixi/js'
import { JixiProvider, useJixiClient } from '../context'

vi.mock('@jixi/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jixi/js')>()
  return {
    ...actual,
    JixiClient: vi.fn().mockImplementation((config) => ({ _config: config })),
  }
})

const MockJixiClient = JixiClient as ReturnType<typeof vi.fn>

function makeWrapper(props: { baseUrl: string; apiKey?: string }) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <JixiProvider baseUrl={props.baseUrl} apiKey={props.apiKey ?? 'test_key'}>
        {children}
      </JixiProvider>
    )
  }
}

describe('JixiProvider / useJixiClient', () => {
  beforeEach(() => {
    MockJixiClient.mockClear()
  })

  it('renders children without error and returns a JixiClient instance', () => {
    const { result } = renderHook(() => useJixiClient(), {
      wrapper: makeWrapper({ baseUrl: 'https://api.jixi.ai' }),
    })
    expect(result.current).toBeDefined()
  })

  it('throws with clear message when used outside a JixiProvider', () => {
    expect(() => renderHook(() => useJixiClient())).toThrow(
      '[jixi] useJixiClient must be used inside a JixiProvider.',
    )
  })

  it('returns a stable client reference across re-renders', () => {
    const { result, rerender } = renderHook(() => useJixiClient(), {
      wrapper: makeWrapper({ baseUrl: 'https://api.jixi.ai' }),
    })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('creates a new client when baseUrl changes', () => {
    let baseUrl = 'https://api.jixi.ai'
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <JixiProvider baseUrl={baseUrl} apiKey="test_key">
        {children}
      </JixiProvider>
    )
    const { result, rerender } = renderHook(() => useJixiClient(), { wrapper })
    const first = result.current

    baseUrl = 'https://other.jixi.ai'
    rerender()

    expect(result.current).not.toBe(first)
    expect(MockJixiClient).toHaveBeenCalledTimes(2)
  })
})
