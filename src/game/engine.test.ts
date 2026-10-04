import { describe, expect, it } from 'vitest'
import { TrainingEngine } from './engine'
import { DEFAULT_SETTINGS, getCm360, getDegreesPerMouseUnit } from './profiles'
import { CAMERA_POSITION, getTargetRadius, TARGET_ANGULAR_CLEARANCE, TARGET_BOUNDS, TARGET_CLEARANCE } from './arena'
import type { TargetState } from '../types'

function assertClearTargets(targets: TargetState[], scale: number): void {
  const radius = getTargetRadius(scale)
  expect(targets).toHaveLength(3)
  for (const { position } of targets) {
    expect(position[0]).toBeGreaterThanOrEqual(TARGET_BOUNDS.minX)
    expect(position[0]).toBeLessThanOrEqual(TARGET_BOUNDS.maxX)
    expect(position[1]).toBeGreaterThanOrEqual(TARGET_BOUNDS.minY)
    expect(position[1]).toBeLessThanOrEqual(TARGET_BOUNDS.maxY)
    expect(position[2]).toBe(TARGET_BOUNDS.z)
  }
  for (let left = 0; left < targets.length; left++) {
    for (let right = left + 1; right < targets.length; right++) {
      const a = targets[left].position
      const b = targets[right].position
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThanOrEqual(2 * radius + TARGET_CLEARANCE - 1e-10)
      const directionA = a.map((value, axis) => value - CAMERA_POSITION[axis])
      const directionB = b.map((value, axis) => value - CAMERA_POSITION[axis])
      const distanceA = Math.hypot(...directionA)
      const distanceB = Math.hypot(...directionB)
      const dot = directionA.reduce((total, value, axis) => total + value * directionB[axis], 0)
      const angle = Math.acos(Math.max(-1, Math.min(1, dot / distanceA / distanceB)))
      const silhouettes = Math.asin(radius / distanceA) + Math.asin(radius / distanceB)
      expect(angle).toBeGreaterThanOrEqual(silhouettes + TARGET_ANGULAR_CLEARANCE - 1e-10)
    }
  }
}

function seededRandom(seed = 42): () => number {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('TrainingEngine', () => {
  it('uses continuous positions, retains three clear spheres and replenishes only a hit target', () => {
    const engine = new TrainingEngine(seededRandom())
    engine.start(DEFAULT_SETTINGS, 0)
    const generatedX = new Set<number>()
    for (let shot = 0; shot < 200; shot++) {
      const before = engine.snapshot(shot * 100)
      assertClearTargets(before.targets, 1)
      generatedX.add(before.targets[0].position[0])
      expect(engine.shoot(before.targets[0].id, shot * 100 + 1)).toBe(true)
      const after = engine.snapshot(shot * 100 + 1)
      assertClearTargets(after.targets, 1)
      expect(after.targets.some((target) => target.id === before.targets[0].id)).toBe(false)
      expect(after.targets.slice(0, 2)).toEqual(before.targets.slice(1))
      const replacement = after.targets.find((target) => !before.targets.some((previous) => previous.id === target.id))
      expect(replacement).toBeDefined()
      expect(Math.hypot(...replacement!.position.map((value, axis) => value - before.targets[0].position[axis])))
        .toBeGreaterThanOrEqual(getTargetRadius(1) * 2 + TARGET_CLEARANCE)
    }
    expect(generatedX.size).toBeGreaterThan(180)
    expect([...generatedX].some((value) => Math.abs(value / 0.64 - Math.round(value / 0.64)) > 0.001)).toBe(true)
  })

  it.each([0, 0.5, 1, NaN, Infinity, -5, 9])('keeps max-size targets clear across long runs with adversarial RNG %s', (randomValue) => {
    const engine = new TrainingEngine(() => randomValue)
    engine.start({ ...DEFAULT_SETTINGS, targetScale: 1.5 }, 0)
    for (let shot = 0; shot < 400; shot++) {
      const before = engine.snapshot(shot)
      assertClearTargets(before.targets, 1.5)
      const hitTarget = before.targets[shot % 3]
      expect(engine.shoot(hitTarget.id, shot + 0.1)).toBe(true)
      const after = engine.snapshot(shot + 0.1)
      assertClearTargets(after.targets, 1.5)
      const replacement = after.targets.find((target) => target.id > before.targets[2].id)!
      expect(Math.hypot(...replacement.position.map((value, axis) => value - hitTarget.position[axis])))
        .toBeGreaterThanOrEqual(getTargetRadius(1.5) * 2 + TARGET_CLEARANCE)
    }
  })

  it('deep-copies target positions so UI snapshots cannot mutate the engine', () => {
    const engine = new TrainingEngine(seededRandom())
    engine.start(DEFAULT_SETTINGS, 0)
    const snapshot = engine.snapshot(0)
    const initialPosition = [...snapshot.targets[0].position]
    snapshot.targets[0].position[0] = 999
    snapshot.targets[0].spawnedAtActiveMs = 1000
    expect(engine.snapshot(0).targets[0].position).toEqual(initialPosition)
    expect(engine.snapshot(0).targets[0].spawnedAtActiveMs).toBe(0)
  })

  it('scores hits and misses, freezes time during pause, and measures TTK in active time', () => {
    const engine = new TrainingEngine(() => 0)
    engine.start(DEFAULT_SETTINGS, 1000)
    const [first, second] = engine.snapshot(1000).targets
    expect(engine.shoot(first.id, 1500)).toBe(true)
    engine.pause(1700)
    expect(engine.snapshot(9000).elapsedMs).toBe(700)
    expect(engine.shoot(second.id, 9000)).toBe(false)
    engine.resume(11700)
    expect(engine.shoot(second.id, 12000)).toBe(true)
    expect(engine.shoot(null, 12050)).toBe(false)

    const snapshot = engine.snapshot(12050)
    expect(snapshot.elapsedMs).toBe(1050)
    expect(snapshot).toMatchObject({ hits: 2, misses: 1, shots: 3, score: 2, streak: 0, bestStreak: 2 })
    expect(snapshot.avgTtkMs).toBe(750)
    expect(snapshot.bestTtkMs).toBe(500)
  })

  it('clamps the score at zero and finishes at the configured duration once', () => {
    const engine = new TrainingEngine()
    engine.start(DEFAULT_SETTINGS, 0)
    engine.shoot(null, 100)
    expect(engine.snapshot(100).score).toBe(0)
    expect(engine.tick(60000)).toBe(true)
    expect(engine.tick(60001)).toBe(false)
    expect(engine.shoot(null, 60001)).toBe(false)
    const result = engine.finish(60001)
    expect(engine.finish(99999)).toBe(result)
    expect(result).toMatchObject({ rulesetId: 'free-v2', elapsedMs: 60000, score: 0, shots: 1, misses: 1, ranked: true })
  })
})

describe('sensitivity references', () => {
  it('scales rotation proportionally with the single sensitivity setting', () => {
    const settings = { ...DEFAULT_SETTINGS, sensitivity: 0.35 }
    const base = getDegreesPerMouseUnit(settings)
    expect(getDegreesPerMouseUnit({ ...settings, sensitivity: 0.7 })).toBeCloseTo(base * 2)
    expect(getDegreesPerMouseUnit({ ...settings, sensitivity: 1.4 })).toBeCloseTo(base * 4)
  })
  it('uses DPI for theoretical cm/360 without multiplying browser rotation gain by DPI', () => {
    const settings = { ...DEFAULT_SETTINGS, sensitivity: 1, dpi: 800, fineTune: 1 }
    expect(getDegreesPerMouseUnit(settings)).toBeCloseTo(0.07)
    expect(getCm360(settings)).toBeCloseTo(360 * 2.54 / (800 * 0.07))
    expect(getDegreesPerMouseUnit({ ...settings, dpi: 1600 })).toBeCloseTo(0.07)
    expect(getCm360({ ...settings, dpi: 1600 })).toBeCloseTo(getCm360(settings) / 2)
  })
})
