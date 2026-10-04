import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RulesetId, RunResult } from '../types'
import { DEFAULT_SETTINGS } from './profiles'

class FakeStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
  clear(): void { this.values.clear() }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  get length(): number { return this.values.size }
}

function makeRun(id: string, hits: number, durationSec: 30 | 60 = 30, targetScale = 1, rulesetId: RulesetId = 'free-v2'): RunResult {
  return {
    rulesetId,
    id,
    playedAt: new Date(2026, 0, 1, 0, 0, Number(id.replace(/\D/g, '')) || 0).toISOString(),
    durationSec,
    targetScale,
    profile: 'valorant',
    sensitivity: 0.35,
    dpi: 800,
    fineTune: 1,
    fov: 103,
    hits,
    misses: 0,
    shots: hits,
    score: hits,
    bestStreak: hits,
    elapsedMs: durationSec * 1000,
    avgTtkMs: hits ? 500 : null,
    bestTtkMs: hits ? 250 : null,
    shotsPerSecond: hits / durationSec,
    ranked: targetScale === 1,
  }
}

function legacyRun(run: RunResult): Omit<RunResult, 'rulesetId'> {
  const { rulesetId: _rulesetId, ...legacy } = run
  return legacy
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('localStorage', new FakeStorage())
})

describe('local storage', () => {
  it.each([[0.35, 1.5], [0.01, 0.1], [10, 3]])('merges saved sensitivity %s and fine tune %s exactly once', async (sensitivity, fineTune) => {
    localStorage.setItem('dsbyte-aim:v2', JSON.stringify({ version: 2, settings: { ...DEFAULT_SETTINGS, sensitivity, fineTune }, runs: [makeRun('past', 5)] }))
    const storage = await import('./storage')
    const merged = storage.loadStoredData().settings
    expect(merged.sensitivity).toBeCloseTo(sensitivity * fineTune)
    expect(merged).not.toHaveProperty('fineTune')
    expect(storage.getRecentRuns()[0]).toMatchObject({ sensitivity: 0.35, fineTune: 1 })
    storage.saveSettings(merged)
    vi.resetModules()
    const reloaded = await import('./storage')
    expect(reloaded.loadStoredData().settings.sensitivity).toBeCloseTo(sensitivity * fineTune)
  })
  it('fixes settings FOV to 100 while preserving historical result FOV', async () => {
    localStorage.setItem('dsbyte-aim:v2', JSON.stringify({ version: 2, settings: { ...DEFAULT_SETTINGS, fov: 112 }, runs: [makeRun('past', 5)] }))
    const storage = await import('./storage')
    expect(storage.loadStoredData().settings.fov).toBe(100)
    expect(storage.getRecentRuns()[0].fov).toBe(103)
    storage.saveSettings({ ...DEFAULT_SETTINGS, fov: 80 })
    expect(storage.loadStoredData().settings.fov).toBe(100)
  })
  it('normalizes old scores to hit count and imports former CS2 gain without a switchable profile', async () => {
    const fake = new FakeStorage()
    const old = { ...makeRun('old-score', 8), score: 775, misses: 1, shots: 9 }
    fake.setItem('dsbyte-aim:v2', JSON.stringify({ version: 2, settings: { ...DEFAULT_SETTINGS, profile: 'cs2', sensitivity: 1 }, runs: [old] }))
    vi.stubGlobal('localStorage', fake)
    const storage = await import('./storage')
    expect(storage.getRecentRuns()[0]).toMatchObject({ hits: 8, misses: 1, score: 8 })
    expect(storage.getLeaderboard(30)[0].score).toBe(8)
    const settings = storage.loadStoredData().settings
    expect(settings.sensitivity * 0.07).toBeCloseTo(0.022)
    expect(settings).not.toHaveProperty('profile')
    storage.saveSettings(settings)
    vi.resetModules()
    const reloaded = await import('./storage')
    expect(reloaded.loadStoredData().settings.sensitivity).toBe(settings.sensitivity)
    expect(reloaded.getRecentRuns()[0].score).toBe(8)
  })

  it('persists settings, keeps recent 50 separately from each duration top ten, and excludes practice runs', async () => {
    const storage = await import('./storage')
    expect(storage.saveSettings({ ...DEFAULT_SETTINGS, durationSec: 60, soundEnabled: false })).toBe(true)
    expect(storage.recordRun(makeRun('best-1', 100))).toBe(true)
    for (let index = 0; index < 51; index++) storage.recordRun(makeRun(`recent-${index}`, 1))
    storage.recordRun(makeRun('sixty', 20, 60))
    storage.recordRun(makeRun('practice', 500, 30, 1.25))
    storage.recordRun(makeRun('legacy', 400, 30, 1, 'grid-v1'))

    expect(storage.getRecentRuns()).toHaveLength(50)
    expect(storage.getRecentRuns()[0].id).toBe('legacy')
    expect(storage.getLeaderboard(30)[0].id).toBe('best-1')
    expect(storage.getLeaderboard(30)).toHaveLength(10)
    expect(storage.getLeaderboard(30).some((run) => run.id === 'practice')).toBe(false)
    expect(storage.getLeaderboard(60).map((run) => run.id)).toEqual(['sixty'])
    expect(storage.getLeaderboard(30, 'grid-v1').map((run) => run.id)).toEqual(['legacy'])
    expect(storage.loadStoredData()).toMatchObject({ settings: { durationSec: 60, soundEnabled: false }, storageAvailable: true })

    vi.resetModules()
    const reloaded = await import('./storage')
    expect(reloaded.getLeaderboard(30)[0].id).toBe('best-1')
    expect(reloaded.getLeaderboard(30, 'grid-v1')[0].id).toBe('legacy')
    expect(reloaded.loadStoredData().settings.soundEnabled).toBe(false)
    expect(reloaded.getRecentRuns()).toHaveLength(50)
  })

  it('recovers corrupt data and still runs if writes are unavailable', async () => {
    const fake = new FakeStorage()
    fake.setItem('dsbyte-aim:v1', '{bad json')
    vi.stubGlobal('localStorage', fake)
    const storage = await import('./storage')
    expect(storage.loadStoredData().settings).toEqual(DEFAULT_SETTINGS)
    expect(storage.getRecentRuns()).toEqual([])

    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('blocked') } })
    expect(storage.recordRun(makeRun('offline', 3))).toBe(false)
    expect(storage.getRecentRuns()[0].id).toBe('offline')
    expect(storage.loadStoredData().storageAvailable).toBe(false)
  })

  it('falls back to the default duration when saved settings omit it', async () => {
    const fake = new FakeStorage()
    fake.setItem('dsbyte-aim:v1', JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, durationSec: null }, runs: [] }))
    vi.stubGlobal('localStorage', fake)
    const storage = await import('./storage')
    expect(storage.loadStoredData().settings.durationSec).toBe(60)
  })

  it('migrates v1 settings, all recent records and both old top tens without changing the v1 key', async () => {
    const fake = new FakeStorage()
    const oldSettings = { ...DEFAULT_SETTINGS, sensitivity: 0.62, targetColor: '#00ccff' } as Partial<typeof DEFAULT_SETTINGS>
    delete oldSettings.soundEnabled
    const oldRecords = Array.from({ length: 50 }, (_, index) => legacyRun(makeRun(`old-recent-${index}`, index + 1)))
    const top30 = Array.from({ length: 10 }, (_, index) => legacyRun(makeRun(`old-top30-${index}`, 1000 - index)))
    const top60 = Array.from({ length: 10 }, (_, index) => legacyRun(makeRun(`old-top60-${index}`, 1500 - index, 60)))
    const original = JSON.stringify({ version: 1, settings: oldSettings, runs: oldRecords, leaderboards: { 30: top30, 60: top60 } })
    fake.setItem('dsbyte-aim:v1', original)
    vi.stubGlobal('localStorage', fake)

    const storage = await import('./storage')
    expect(storage.loadStoredData().settings).toMatchObject({ sensitivity: 0.62, targetColor: '#00ccff', soundEnabled: true })
    expect(storage.getRecentRuns()).toHaveLength(50)
    expect(storage.getRecentRuns().every((run) => run.rulesetId === 'grid-v1')).toBe(true)
    expect(storage.getLeaderboard(30)).toEqual([])
    expect(storage.getLeaderboard(60)).toEqual([])
    expect(storage.getLeaderboard(30, 'grid-v1').map((run) => run.id)).toEqual(top30.map((run) => run.id))
    expect(storage.getLeaderboard(60, 'grid-v1').map((run) => run.id)).toEqual(top60.map((run) => run.id))
    expect(fake.getItem('dsbyte-aim:v1')).toBe(original)
    expect(JSON.parse(fake.getItem('dsbyte-aim:v2')!).version).toBe(2)

    storage.recordRun(makeRun('new-ranked', 100))
    storage.recordRun(makeRun('new-practice', 5000, 30, 0.8))
    expect(storage.getLeaderboard(30).map((run) => run.id)).toEqual(['new-ranked'])
    expect(storage.getLeaderboard(30, 'grid-v1')).toHaveLength(10)
    expect(fake.getItem('dsbyte-aim:v1')).toBe(original)
    vi.resetModules()
    const reloaded = await import('./storage')
    expect(reloaded.getLeaderboard(30).map((run) => run.id)).toEqual(['new-ranked'])
    expect(reloaded.getLeaderboard(60, 'grid-v1')).toHaveLength(10)
    expect(reloaded.getRecentRuns()[0]).toMatchObject({ id: 'new-practice', rulesetId: 'free-v2', ranked: false })
  })

  it('prefers valid v2 data and recovers legacy records if v2 is corrupt', async () => {
    const fake = new FakeStorage()
    fake.setItem('dsbyte-aim:v1', JSON.stringify({ version: 1, runs: [legacyRun(makeRun('recover', 8))] }))
    fake.setItem('dsbyte-aim:v2', '{bad json')
    vi.stubGlobal('localStorage', fake)
    const storage = await import('./storage')
    expect(storage.getRecentRuns()[0]).toMatchObject({ id: 'recover', rulesetId: 'grid-v1' })
    storage.recordRun(makeRun('current', 4))
    vi.resetModules()
    const reloaded = await import('./storage')
    expect(reloaded.getRecentRuns().map((run) => run.id)).toEqual(['current', 'recover'])
  })

  it('keeps migrated scores usable when v2 persistence is unavailable', async () => {
    const legacy = JSON.stringify({ version: 1, runs: [legacyRun(makeRun('recover', 8))] })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'dsbyte-aim:v1' ? legacy : null,
      setItem: () => { throw new Error('quota') },
    })
    const storage = await import('./storage')
    expect(storage.getLeaderboard(30, 'grid-v1')[0].id).toBe('recover')
    expect(storage.loadStoredData().storageAvailable).toBe(false)
    expect(storage.recordRun(makeRun('memory-only', 5))).toBe(false)
    expect(storage.getLeaderboard(30)[0].id).toBe('memory-only')
  })
})
