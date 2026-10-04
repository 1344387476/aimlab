import type { RulesetId } from '../types'

export const CURRENT_RULESET: RulesetId = 'free-v2'
export const CAMERA_POSITION: [number, number, number] = [0, 2.8, 2.5]
export const TARGET_BOUNDS = { minX: -6.4, maxX: 6.4, minY: 0.9, maxY: 5.5, z: -9.5 } as const
export const TARGET_COUNT = 3
export const BASE_TARGET_RADIUS = 0.55
export const TARGET_CLEARANCE = 0.22
export const TARGET_ANGULAR_CLEARANCE = 0.01 // Radians; a small visible gap between silhouettes.

export function getTargetRadius(scale: number): number {
  return BASE_TARGET_RADIUS * scale
}
