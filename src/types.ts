export type GamePhase =
  | 'menu'
  | 'leaderboard'
  | 'locking'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'result'

/** Legacy saved-run metadata; training settings no longer select a game profile. */
export type GameProfile = 'valorant' | 'cs2'
export type GameDuration = 30 | 60
export type CrosshairStyle = 'cross' | 'dot' | 'ring'
export type RulesetId = 'grid-v1' | 'free-v2'
export type ShotOutcome = 'hit' | 'miss' | 'ignored'

export interface GameSettings {
  sensitivity: number
  dpi: number
  fov: number // Horizontal field of view in degrees.
  crosshairStyle: CrosshairStyle
  crosshairSize: number
  crosshairColor: string
  targetColor: string
  targetScale: number
  durationSec: GameDuration
  soundEnabled: boolean
}

export interface TargetState {
  id: number
  position: [number, number, number]
  spawnedAtActiveMs: number
}

export interface GameSnapshot {
  targets: TargetState[]
  score: number
  hits: number
  misses: number
  shots: number
  streak: number
  bestStreak: number
  elapsedMs: number
  remainingMs: number
  avgTtkMs: number | null
  bestTtkMs: number | null
}

export interface RunResult extends Omit<GameSnapshot, 'targets' | 'remainingMs' | 'streak'> {
  rulesetId: RulesetId
  id: string
  playedAt: string
  durationSec: GameDuration
  targetScale: number
  profile: GameProfile
  sensitivity: number
  dpi: number
  fineTune: number
  fov: number
  shotsPerSecond: number
  ranked: boolean
}
