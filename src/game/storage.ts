import type { GameDuration, GameSettings, RulesetId, RunResult } from '../types'
import { DEFAULT_SETTINGS } from './profiles'
import { CURRENT_RULESET } from './arena'

const STORAGE_KEY = 'dsbyte-aim:v2'
const LEGACY_STORAGE_KEY = 'dsbyte-aim:v1'
const STORAGE_VERSION = 2
const RECENT_LIMIT = 50
const LEADERBOARD_LIMIT = 10

interface StoredPayload {
  version: 2
  settings: GameSettings
  runs: RunResult[]
  leaderboards: Record<RulesetId, Record<GameDuration, RunResult[]>>
}

export interface StoredData {
  settings: GameSettings
  runs: RunResult[]
  storageAvailable: boolean
}

let cache: StoredPayload | null = null
let storageAvailable = false

function emptyPayload(): StoredPayload {
  return {
    version: STORAGE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    runs: [],
    leaderboards: {
      'grid-v1': { 30: [], 60: [] },
      'free-v2': { 30: [], 60: [] },
    },
  }
}

function finiteBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function colorOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

function readSettings(value: unknown): GameSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS }
  const source = value as Record<string, unknown>
  // Preserve the previous mouse gain when importing a removed CS2 setting.
  const sensitivity = finiteBetween(source.sensitivity, 0.001, 30) ? source.sensitivity : DEFAULT_SETTINGS.sensitivity
  const legacyFineTune = finiteBetween(source.fineTune, 0.1, 3) ? source.fineTune : 1
  const profileSensitivity = source.profile === 'cs2' ? Math.max(0.01, sensitivity * 0.022 / 0.07) : sensitivity
  return {
    sensitivity: profileSensitivity * legacyFineTune,
    dpi: finiteBetween(source.dpi, 100, 32000) ? source.dpi : DEFAULT_SETTINGS.dpi,
    fov: DEFAULT_SETTINGS.fov,
    crosshairStyle: source.crosshairStyle === 'cross' || source.crosshairStyle === 'dot' || source.crosshairStyle === 'ring'
      ? source.crosshairStyle : DEFAULT_SETTINGS.crosshairStyle,
    crosshairSize: finiteBetween(source.crosshairSize, 2, 30) ? source.crosshairSize : DEFAULT_SETTINGS.crosshairSize,
    crosshairColor: colorOrDefault(source.crosshairColor, DEFAULT_SETTINGS.crosshairColor),
    targetColor: colorOrDefault(source.targetColor, DEFAULT_SETTINGS.targetColor),
    targetScale: finiteBetween(source.targetScale, 0.4, 1.5) ? source.targetScale : DEFAULT_SETTINGS.targetScale,
    durationSec: source.durationSec === 30 || source.durationSec === 60
      ? source.durationSec : DEFAULT_SETTINGS.durationSec,
    soundEnabled: typeof source.soundEnabled === 'boolean' ? source.soundEnabled : true,
  }
}

function readRun(value: unknown, legacyRuleset?: RulesetId): RunResult | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const rulesetId = legacyRuleset ?? source.rulesetId
  if (typeof source.id !== 'string' || !source.id ||
    (rulesetId !== 'grid-v1' && rulesetId !== 'free-v2') ||
    typeof source.playedAt !== 'string' || !Number.isFinite(Date.parse(source.playedAt)) ||
    (source.durationSec !== 30 && source.durationSec !== 60) ||
    (source.profile !== 'valorant' && source.profile !== 'cs2') ||
    !finiteBetween(source.targetScale, 0.4, 1.5) ||
    !finiteBetween(source.hits, 0, 100000) ||
    !finiteBetween(source.misses, 0, 100000) ||
    !finiteBetween(source.bestStreak, 0, 100000) ||
    !finiteBetween(source.elapsedMs, 0, source.durationSec * 1000) ||
    !finiteBetween(source.sensitivity, 0.001, 30) ||
    !finiteBetween(source.dpi, 100, 32000) ||
    !finiteBetween(source.fineTune, 0.1, 3) ||
    !finiteBetween(source.fov, 60, 150)) return null

  const hits = Math.floor(source.hits)
  const misses = Math.floor(source.misses)
  const shots = hits + misses
  const elapsedMs = source.elapsedMs
  const avgTtkMs = source.avgTtkMs === null || source.avgTtkMs === undefined
    ? null : finiteBetween(source.avgTtkMs, 0, 60000) ? source.avgTtkMs : null
  const bestTtkMs = source.bestTtkMs === null || source.bestTtkMs === undefined
    ? null : finiteBetween(source.bestTtkMs, 0, 60000) ? source.bestTtkMs : null

  return {
    rulesetId,
    id: source.id,
    playedAt: source.playedAt,
    durationSec: source.durationSec,
    targetScale: source.targetScale,
    profile: source.profile,
    sensitivity: source.sensitivity,
    dpi: source.dpi,
    fineTune: source.fineTune,
    fov: source.fov,
    hits,
    misses,
    shots,
    score: hits,
    bestStreak: Math.min(Math.floor(source.bestStreak), hits),
    elapsedMs,
    avgTtkMs,
    bestTtkMs,
    shotsPerSecond: elapsedMs > 0 ? shots / (elapsedMs / 1000) : 0,
    ranked: source.targetScale === 1,
  }
}

function rankRuns(runs: RunResult[], durationSec: GameDuration, rulesetId: RulesetId): RunResult[] {
  const unique = new Map<string, RunResult>()
  for (const run of runs) {
    if (run.durationSec === durationSec && run.targetScale === 1 && run.rulesetId === rulesetId) unique.set(run.id, run)
  }
  return [...unique.values()]
    .sort((a, b) => b.score - a.score || b.hits - a.hits || a.misses - b.misses || a.elapsedMs - b.elapsedMs)
    .slice(0, LEADERBOARD_LIMIT)
}

function readPayload(value: unknown, expectedVersion: 1 | 2): StoredPayload | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (source.version !== expectedVersion) return null
  const legacyRuleset = expectedVersion === 1 ? 'grid-v1' : undefined
  const runs = Array.isArray(source.runs)
    ? source.runs.map((run) => readRun(run, legacyRuleset)).filter((run): run is RunResult => run !== null).slice(0, RECENT_LIMIT)
    : []
  const boards = source.leaderboards && typeof source.leaderboards === 'object'
    ? source.leaderboards as Record<string, unknown> : {}
  const leaderboards = emptyPayload().leaderboards
  for (const rulesetId of ['grid-v1', 'free-v2'] as const) {
    const ruleBoards = expectedVersion === 1
      ? rulesetId === 'grid-v1' ? boards : {}
      : boards[rulesetId] && typeof boards[rulesetId] === 'object' ? boards[rulesetId] as Record<string, unknown> : {}
    for (const durationSec of [30, 60] as const) {
      const values = ruleBoards[durationSec]
      const boardRuns = Array.isArray(values)
        ? values.map((run) => readRun(run, legacyRuleset)).filter((run): run is RunResult => run !== null) : []
      leaderboards[rulesetId][durationSec] = rankRuns([...boardRuns, ...runs], durationSec, rulesetId)
    }
  }
  return {
    version: STORAGE_VERSION,
    settings: readSettings(source.settings),
    runs,
    leaderboards,
  }
}

function parsePayload(raw: string | null, version: 1 | 2): StoredPayload | null {
  if (raw === null) return null
  try { return readPayload(JSON.parse(raw), version) } catch { return null }
}

function ensureLoaded(): StoredPayload {
  if (cache) return cache
  cache = emptyPayload()
  try {
    if (typeof localStorage === 'undefined') return cache
    const raw = localStorage.getItem(STORAGE_KEY)
    storageAvailable = true
    const current = parsePayload(raw, 2)
    if (current) {
      cache = current
    } else {
      const migrated = parsePayload(localStorage.getItem(LEGACY_STORAGE_KEY), 1)
      if (migrated) {
        cache = migrated
        // Keep the legacy key intact so older builds and legacy scores remain recoverable.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
      }
    }
  } catch {
    storageAvailable = false
  }
  return cache
}

function persist(): boolean {
  const data = ensureLoaded()
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    storageAvailable = true
    return true
  } catch {
    storageAvailable = false
    return false
  }
}

export function loadStoredData(): StoredData {
  const data = ensureLoaded()
  return {
    settings: { ...data.settings },
    runs: data.runs.map((run) => ({ ...run })),
    storageAvailable,
  }
}

/** Returns whether the update was saved to persistent browser storage. */
export function saveSettings(settings: GameSettings): boolean {
  ensureLoaded().settings = readSettings(settings)
  return persist()
}

/** Recent history and each ruleset/duration's all-time top tens are saved separately. */
export function recordRun(run: RunResult): boolean {
  const data = ensureLoaded()
  const validRun = readRun(run)
  if (!validRun) return false
  data.runs = [validRun, ...data.runs.filter((entry) => entry.id !== validRun.id)].slice(0, RECENT_LIMIT)
  if (validRun.targetScale === 1) {
    const duration = validRun.durationSec
    const rulesetId = validRun.rulesetId
    data.leaderboards[rulesetId][duration] = rankRuns([...data.leaderboards[rulesetId][duration], validRun], duration, rulesetId)
  }
  return persist()
}

export function getLeaderboard(durationSec: GameDuration, rulesetId: RulesetId = CURRENT_RULESET): RunResult[] {
  return ensureLoaded().leaderboards[rulesetId][durationSec].map((run) => ({ ...run }))
}

export function getRecentRuns(): RunResult[] {
  return ensureLoaded().runs.map((run) => ({ ...run }))
}
