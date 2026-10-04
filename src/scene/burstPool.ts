import type { Vector3Tuple } from 'three'

export const BURST_DURATION_MS = 280
export const MAX_BURSTS = 8
export const FRAGMENTS_PER_BURST = 10

export interface BurstInput {
  center: Vector3Tuple
  impact: Vector3Tuple
  radius: number
  color: string
}

export interface BurstSlot extends BurstInput {
  active: boolean
  bornAt: number
  serial: number
}

/** Fixed slots keep rapid input from allocating an unbounded particle list. */
export class BurstPool {
  readonly slots: BurstSlot[] = Array.from({ length: MAX_BURSTS }, () => ({
    active: false,
    center: [0, 0, 0],
    impact: [0, 0, 0],
    radius: 0,
    color: '#ffffff',
    bornAt: 0,
    serial: 0,
  }))
  totalBursts = 0
  warmupReady = false
  warmupDurationMs: number | null = null

  get currentActive(): number {
    let count = 0
    for (const slot of this.slots) if (slot.active) count += 1
    return count
  }

  add(input: BurstInput, now: number): void {
    this.expire(now)
    const slot = this.slots.find((candidate) => !candidate.active)
      ?? this.slots.reduce((oldest, candidate) => candidate.bornAt < oldest.bornAt
        || (candidate.bornAt === oldest.bornAt && candidate.serial < oldest.serial) ? candidate : oldest)
    this.totalBursts += 1
    // Event positions must survive the target mesh being removed immediately.
    Object.assign(slot, input, {
      center: [...input.center],
      impact: [...input.impact],
      active: true,
      bornAt: now,
      serial: this.totalBursts,
    })
  }

  expire(now: number): void {
    for (const slot of this.slots) {
      if (slot.active && now - slot.bornAt >= BURST_DURATION_MS) slot.active = false
    }
  }

  clear(): void {
    for (const slot of this.slots) slot.active = false
  }
}
