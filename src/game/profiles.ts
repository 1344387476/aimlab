import type { GameSettings } from '../types'

/** Degrees of yaw per mouse count at sensitivity 1, used only as a theoretical reference. */
const DEGREES_PER_COUNT = 0.07
export const FIXED_HORIZONTAL_FOV = 100

export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 0.35,
  dpi: 800,
  fov: FIXED_HORIZONTAL_FOV,
  crosshairStyle: 'cross',
  crosshairSize: 8,
  crosshairColor: '#eafff3',
  targetColor: '#ff586b',
  targetScale: 1,
  durationSec: 60,
  soundEnabled: true,
}

/**
 * Browser movementX is not guaranteed to be raw hardware counts, so this is
 * a starting gain for calibration, not a promise of game-identical rotation.
 * DPI belongs in the physical-distance estimate below, not in this gain.
 */
export function getDegreesPerMouseUnit(settings: GameSettings): number {
  return DEGREES_PER_COUNT * settings.sensitivity
}

/** Theoretical physical centimetres for one complete turn at the chosen DPI. */
export function getCm360(settings: GameSettings): number {
  const degreesPerCount = DEGREES_PER_COUNT * settings.sensitivity
  const countsPerCm = settings.dpi / 2.54
  if (degreesPerCount <= 0 || countsPerCm <= 0) return Number.POSITIVE_INFINITY
  return 360 / (degreesPerCount * countsPerCm)
}
