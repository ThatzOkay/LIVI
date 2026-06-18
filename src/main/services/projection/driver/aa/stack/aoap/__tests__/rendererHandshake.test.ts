import type { WebContents } from 'electron'
import { runRendererAoapHandshake } from '../rendererHandshake'

type ExecResult = { ok: boolean; protocol?: number; error?: string }

const fakeWebContents = (exec: () => Promise<ExecResult>): WebContents =>
  ({ executeJavaScript: vi.fn(exec) }) as unknown as WebContents

describe('runRendererAoapHandshake', () => {
  test('returns the negotiated protocol on success', async () => {
    const wc = fakeWebContents(async () => ({ ok: true, protocol: 2 }))

    await expect(runRendererAoapHandshake(wc, 0x18d1, 0x4ee2)).resolves.toBe(2)
  })

  test('defaults to protocol 0 when the renderer omits it', async () => {
    const wc = fakeWebContents(async () => ({ ok: true }))

    await expect(runRendererAoapHandshake(wc, 0x18d1, 0x4ee2)).resolves.toBe(0)
  })

  test('passes the vendor/product ids into the injected script', async () => {
    const exec = vi.fn(async () => ({ ok: true, protocol: 1 }))
    const wc = { executeJavaScript: exec } as unknown as WebContents

    await runRendererAoapHandshake(wc, 0x1234, 0x5678)

    const script = exec.mock.calls[0][0] as string
    expect(script).toContain('"vendorId":4660')
    expect(script).toContain('"productId":22136')
  })

  test('throws with the renderer error message on failure', async () => {
    const wc = fakeWebContents(async () => ({ ok: false, error: 'phone not visible via WebUSB' }))

    await expect(runRendererAoapHandshake(wc, 1, 2)).rejects.toThrow(
      'AOAP renderer handshake failed: phone not visible via WebUSB'
    )
  })

  test('throws an unknown-error message when the result has no error field', async () => {
    const wc = fakeWebContents(async () => ({ ok: false }))

    await expect(runRendererAoapHandshake(wc, 1, 2)).rejects.toThrow(
      'AOAP renderer handshake failed: unknown'
    )
  })

  test('the watchdog rejects when the renderer never answers', async () => {
    vi.useFakeTimers()
    try {
      const wc = fakeWebContents(() => new Promise<ExecResult>(() => {}))
      const promise = runRendererAoapHandshake(wc, 1, 2)
      const assertion = expect(promise).rejects.toThrow(
        'AOAP renderer handshake failed: renderer did not answer'
      )
      await vi.advanceTimersByTimeAsync(12_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
