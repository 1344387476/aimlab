import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrainingAudio } from './TrainingAudio'

const sources: { onended?: () => void; stop: () => void; disconnect: () => void }[] = []
function parameter() { return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }
function source() {
  const node = { frequency: parameter(), connect: (next: unknown) => next, start() {}, stop: vi.fn(), disconnect: vi.fn(), onended: undefined as (() => void) | undefined }
  sources.push(node)
  return node
}
class MockAudioContext {
  sampleRate = 8000
  currentTime = 0
  state = 'running'
  destination = {}
  resume = () => Promise.resolve()
  close = () => Promise.resolve()
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })
  createOscillator = source
  createBufferSource = source
  createGain = () => ({ gain: parameter(), connect: (next: unknown) => next, disconnect() {} })
  createBiquadFilter = () => ({ frequency: parameter(), Q: parameter(), connect: (next: unknown) => next, disconnect() {} })
}
afterEach(() => { vi.unstubAllGlobals(); sources.length = 0 })

describe('TrainingAudio', () => {
  it('bounds voices even when source end callbacks are delayed, and clears them on pause', () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    const audio = new TrainingAudio()
    audio.unlock(true)
    for (let i = 0; i < 100; i++) audio.play('hit', i + 1)
    expect(audio.diagnostics.activeVoices).toBe(32)
    expect(audio.diagnostics.hits).toBe(100)
    audio.stop()
    expect(audio.diagnostics.activeVoices).toBe(0)
    for (const node of sources) node.onended?.()
    expect(audio.diagnostics.activeVoices).toBe(0)
    for (const node of sources) expect(node.disconnect).toHaveBeenCalledTimes(1)
  })

  it('ignores inactive shots and safely supports mute or missing audio', () => {
    const audio = new TrainingAudio()
    expect(() => audio.unlock(true)).not.toThrow()
    audio.play('ignored', 0)
    expect(audio.diagnostics.shots).toBe(0)
    vi.stubGlobal('AudioContext', MockAudioContext)
    audio.unlock(false)
    audio.play('hit', 1)
    expect(sources).toHaveLength(0)
    expect(audio.diagnostics.activeVoices).toBe(0)
  })
})
