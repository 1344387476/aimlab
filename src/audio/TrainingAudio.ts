import type { ShotOutcome } from '../types'

/** Small, local one-shot sounds. No downloads and no continuously running voices. */
export class TrainingAudio {
  private context: AudioContext | null = null
  private noise: AudioBuffer | null = null
  private readonly voices = new Map<AudioScheduledSourceNode, () => void>()
  private enabled = true
  private shots = 0
  private hits = 0
  private misses = 0

  unlock(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) return
    try {
      if (!this.context) {
        this.context = new AudioContext()
        const buffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.16), this.context.sampleRate)
        const samples = buffer.getChannelData(0)
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
        this.noise = buffer
      }
      void this.context.resume().catch(() => {})
    } catch {
      // Audio is optional; an unavailable device never prevents training.
    }
  }

  play(outcome: ShotOutcome, streak: number): void {
    if (outcome === 'ignored') return
    this.shots++
    if (outcome === 'hit') this.hits++
    else this.misses++
    const context = this.context
    if (!this.enabled || !context || context.state !== 'running') return
    const now = context.currentTime
    this.tone(160, 65, 0.032, 0.035, 'triangle', now)
    if (outcome === 'hit') {
      const pitch = 1 + Math.min(20, Math.max(0, streak - 1)) * 0.012
      this.tone(950 * pitch, 370 * pitch, 0.085, 0.055, 'sine', now)
      this.burst(0.09, 0.11, 1450, now)
    } else {
      this.burst(0.025, 0.028, 420, now)
    }
  }

  stop(): void {
    for (const [voice, release] of this.voices) {
      try { voice.stop() } catch { /* Already stopped. */ }
      release()
    }
    this.voices.clear()
  }

  dispose(): void {
    this.stop()
    if (this.context) void this.context.close().catch(() => {})
    this.context = null
    this.noise = null
  }

  get diagnostics() {
    return { enabled: this.enabled, state: this.context?.state ?? 'unavailable', activeVoices: this.voices.size, shots: this.shots, hits: this.hits, misses: this.misses }
  }

  private track(source: AudioScheduledSourceNode, cleanup: () => void): void {
    // Every voice lasts <= 100 ms; also cap bursts under extreme click rates.
    if (this.voices.size >= 32) {
      const oldest = this.voices.entries().next().value
      if (oldest) {
        try { oldest[0].stop() } catch { /* Already stopped. */ }
        oldest[1]()
      }
    }
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.voices.delete(source)
      source.disconnect()
      cleanup()
    }
    this.voices.set(source, release)
    source.onended = release
  }

  private tone(startHz: number, endHz: number, duration: number, volume: number, type: OscillatorType, now: number): void {
    const context = this.context!
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(startHz, now)
    oscillator.frequency.exponentialRampToValueAtTime(endHz, now + duration)
    gain.gain.setValueAtTime(volume, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(gain).connect(context.destination)
    this.track(oscillator, () => gain.disconnect())
    oscillator.start(now)
    oscillator.stop(now + duration)
  }

  private burst(duration: number, volume: number, frequency: number, now: number): void {
    if (!this.noise) return
    const context = this.context!
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = this.noise
    filter.type = 'bandpass'
    filter.frequency.value = frequency
    filter.Q.value = 0.7
    gain.gain.setValueAtTime(volume, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    source.connect(filter).connect(gain).connect(context.destination)
    this.track(source, () => { filter.disconnect(); gain.disconnect() })
    source.start(now)
    source.stop(now + duration)
  }
}
