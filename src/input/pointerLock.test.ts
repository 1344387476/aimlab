import { describe, expect, it, vi } from 'vitest'
import { requestPointerLockPreferRaw } from './pointerLock'

describe('requestPointerLockPreferRaw', () => {
  it('requests raw input first', async () => {
    const requestPointerLock = vi.fn().mockResolvedValue(undefined)
    await requestPointerLockPreferRaw({ requestPointerLock } as unknown as HTMLCanvasElement)
    expect(requestPointerLock).toHaveBeenCalledExactlyOnceWith({ unadjustedMovement: true })
  })

  it('falls back to normal pointer lock when raw input is unsupported', async () => {
    const requestPointerLock = vi.fn()
      .mockRejectedValueOnce({ name: 'NotSupportedError' })
      .mockResolvedValueOnce(undefined)
    await requestPointerLockPreferRaw({ requestPointerLock } as unknown as HTMLCanvasElement)
    expect(requestPointerLock).toHaveBeenNthCalledWith(1, { unadjustedMovement: true })
    expect(requestPointerLock).toHaveBeenNthCalledWith(2)
  })

  it('does not retry a permission denial', async () => {
    const requestPointerLock = vi.fn().mockRejectedValue({ name: 'NotAllowedError' })
    await expect(requestPointerLockPreferRaw({ requestPointerLock } as unknown as HTMLCanvasElement)).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(requestPointerLock).toHaveBeenCalledTimes(1)
  })

  it('accepts older implementations without a promise', async () => {
    const requestPointerLock = vi.fn().mockReturnValue(undefined)
    await expect(requestPointerLockPreferRaw({ requestPointerLock } as unknown as HTMLCanvasElement)).resolves.toBeUndefined()
  })
})
