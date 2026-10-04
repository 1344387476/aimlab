import type { GameSettings, GameSnapshot, RunResult, TargetState } from '../types'
import { DEFAULT_SETTINGS } from './profiles'
import {
  CAMERA_POSITION,
  CURRENT_RULESET,
  getTargetRadius,
  TARGET_ANGULAR_CLEARANCE,
  TARGET_BOUNDS,
  TARGET_CLEARANCE,
  TARGET_COUNT,
} from './arena'

type EnginePhase = 'idle' | 'playing' | 'paused' | 'finished'

type TargetPosition = TargetState['position']
const SPAWN_ATTEMPTS = 48

/** Both physical and projected silhouettes need a gap at the fixed viewpoint. */
function clearanceRatio(a: TargetPosition, b: TargetPosition, radius: number): number {
  const worldDistance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const ax = a[0] - CAMERA_POSITION[0]
  const ay = a[1] - CAMERA_POSITION[1]
  const az = a[2] - CAMERA_POSITION[2]
  const bx = b[0] - CAMERA_POSITION[0]
  const by = b[1] - CAMERA_POSITION[1]
  const bz = b[2] - CAMERA_POSITION[2]
  const distanceA = Math.hypot(ax, ay, az)
  const distanceB = Math.hypot(bx, by, bz)
  const angle = Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (distanceA * distanceB))))
  const requiredAngle = Math.asin(radius / distanceA) + Math.asin(radius / distanceB) + TARGET_ANGULAR_CLEARANCE
  return Math.min(worldDistance / (radius * 2 + TARGET_CLEARANCE), angle / requiredAngle)
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export class TrainingEngine {
  private readonly random: () => number
  private phase: EnginePhase = 'idle'
  private settings: GameSettings = { ...DEFAULT_SETTINGS }
  private activeBeforeSegmentMs = 0
  private segmentStartedAtMs = 0
  private targets: TargetState[] = []
  private nextTargetId = 1
  private hits = 0
  private misses = 0
  private streak = 0
  private bestStreak = 0
  private ttkTotalMs = 0
  private bestTtkMs: number | null = null
  private result: RunResult | null = null

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  get isFinished(): boolean {
    return this.phase === 'finished'
  }

  get isPaused(): boolean {
    return this.phase === 'paused'
  }

  /** An explicit start begins a new run, including when restarting an active run. */
  start(settings: GameSettings, now: number): void {
    this.settings = { ...settings }
    this.phase = 'playing'
    this.activeBeforeSegmentMs = 0
    this.segmentStartedAtMs = now
    this.targets = []
    this.nextTargetId = 1
    this.hits = 0
    this.misses = 0
    this.streak = 0
    this.bestStreak = 0
    this.ttkTotalMs = 0
    this.bestTtkMs = null
    this.result = null
    for (let index = 0; index < TARGET_COUNT; index++) this.spawnTarget(0)
  }

  pause(now: number): void {
    if (this.phase !== 'playing') return
    if (this.tick(now)) return
    this.activeBeforeSegmentMs = this.elapsed(now)
    this.phase = 'paused'
  }

  resume(now: number): void {
    if (this.phase !== 'paused') return
    this.segmentStartedAtMs = now
    this.phase = 'playing'
  }

  /** Returns true when this call ended the run at its time limit. */
  tick(now: number): boolean {
    if (this.phase !== 'playing') return false
    if (this.elapsed(now) < this.settings.durationSec * 1000) return false
    this.finish(now)
    return true
  }

  /** Shoot the centre-ray target id, or null for empty space; returns hit status. */
  shoot(targetId: number | null, now: number): boolean {
    if (this.phase !== 'playing' || this.tick(now)) return false
    const activeMs = this.elapsed(now)
    const targetIndex = this.targets.findIndex((target) => target.id === targetId)
    if (targetIndex < 0) {
      this.misses++
      this.streak = 0
      return false
    }

    const [target] = this.targets.splice(targetIndex, 1)
    const ttkMs = Math.max(0, activeMs - target.spawnedAtActiveMs)
    this.hits++
    this.streak++
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this.ttkTotalMs += ttkMs
    this.bestTtkMs = this.bestTtkMs === null ? ttkMs : Math.min(this.bestTtkMs, ttkMs)
    this.spawnTarget(activeMs, target.position)
    return true
  }

  snapshot(now: number): GameSnapshot {
    const elapsedMs = this.elapsed(now)
    return {
      targets: this.targets.map((target) => ({ ...target, position: [...target.position] })),
      score: this.hits,
      hits: this.hits,
      misses: this.misses,
      shots: this.hits + this.misses,
      streak: this.streak,
      bestStreak: this.bestStreak,
      elapsedMs,
      remainingMs: Math.max(0, this.settings.durationSec * 1000 - elapsedMs),
      avgTtkMs: this.hits ? this.ttkTotalMs / this.hits : null,
      bestTtkMs: this.bestTtkMs,
    }
  }

  /** Returns the same result on repeat calls, including after automatic expiry. */
  finish(now: number): RunResult {
    if (this.result) return this.result
    if (this.phase === 'idle') throw new Error('Cannot finish before starting a run')
    if (this.phase === 'playing') this.activeBeforeSegmentMs = this.elapsed(now)
    this.phase = 'finished'
    const { targets: _targets, remainingMs: _remainingMs, streak: _streak, ...summary } = this.snapshot(now)
    const durationSec = this.settings.durationSec
    this.result = {
      ...summary,
      rulesetId: CURRENT_RULESET,
      id: makeId(),
      playedAt: new Date().toISOString(),
      durationSec,
      targetScale: this.settings.targetScale,
      profile: 'valorant', // Retained only for compatibility with stored result metadata.
      sensitivity: this.settings.sensitivity,
      dpi: this.settings.dpi,
      fineTune: 1, // Legacy result metadata; gain is now entirely in sensitivity.
      fov: this.settings.fov,
      shotsPerSecond: summary.elapsedMs > 0 ? summary.shots / (summary.elapsedMs / 1000) : 0,
      ranked: this.settings.targetScale === 1,
    }
    return this.result
  }

  private elapsed(now: number): number {
    const runningMs = this.phase === 'playing' ? Math.max(0, now - this.segmentStartedAtMs) : 0
    return Math.min(this.settings.durationSec * 1000, this.activeBeforeSegmentMs + runningMs)
  }

  private randomUnit(): number {
    const value = this.random()
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
  }

  private spawnTarget(activeMs: number, excludedPosition?: TargetPosition): void {
    const radius = getTargetRadius(this.settings.targetScale)
    const obstacles = this.targets.map((target) => target.position)
    if (excludedPosition) obstacles.push(excludedPosition)
    const minimumClearance = (position: TargetPosition): number =>
      obstacles.reduce((minimum, obstacle) => Math.min(minimum, clearanceRatio(position, obstacle, radius)), Infinity)
    let position: TargetPosition | null = null
    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
      const candidate: TargetPosition = [
        TARGET_BOUNDS.minX + this.randomUnit() * (TARGET_BOUNDS.maxX - TARGET_BOUNDS.minX),
        TARGET_BOUNDS.minY + this.randomUnit() * (TARGET_BOUNDS.maxY - TARGET_BOUNDS.minY),
        TARGET_BOUNDS.z,
      ]
      if (minimumClearance(candidate) >= 1) {
        position = candidate
        break
      }
    }

    // A finite, deterministic scan guarantees progress even with constant or NaN RNG.
    // Choose the widest gap; this is only a fallback, never a spawn-slot system.
    if (!position) {
      let bestClearance = -Infinity
      for (let column = 0; column <= 20; column++) {
        for (let row = 0; row <= 8; row++) {
          const candidate: TargetPosition = [
            TARGET_BOUNDS.minX + column / 20 * (TARGET_BOUNDS.maxX - TARGET_BOUNDS.minX),
            TARGET_BOUNDS.minY + row / 8 * (TARGET_BOUNDS.maxY - TARGET_BOUNDS.minY),
            TARGET_BOUNDS.z,
          ]
          const clearance = minimumClearance(candidate)
          if (clearance >= 1 && clearance > bestClearance) {
            bestClearance = clearance
            position = candidate
          }
        }
      }
    }
    if (!position) throw new Error('No clear target position within the supported arena bounds')
    this.targets.push({ id: this.nextTargetId++, position, spawnedAtActiveMs: activeMs })
  }
}
