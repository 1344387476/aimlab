import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CAMERA_POSITION, getTargetRadius, TARGET_BOUNDS } from '../game/arena'
import { BurstPool, BURST_DURATION_MS, FRAGMENTS_PER_BURST, MAX_BURSTS } from './burstPool'

describe('whole sphere raycast', () => {
  it('hits the curved colored edge, and misses immediately outside the silhouette', () => {
    const geometry = new THREE.SphereGeometry(1, 32, 24)
    const material = new THREE.MeshPhysicalMaterial({ color: '#ff6d57' })
    const target = new THREE.Mesh(geometry, material)
    const radius = getTargetRadius(1)
    target.position.set(0, CAMERA_POSITION[1], TARGET_BOUNDS.z)
    target.scale.setScalar(radius)
    target.updateMatrixWorld()
    const origin = new THREE.Vector3(...CAMERA_POSITION)
    const castAtOffset = (x: number) => {
      const point = target.position.clone().add(new THREE.Vector3(x, 0, 0))
      const ray = new THREE.Raycaster(origin, point.sub(origin).normalize())
      return ray.intersectObject(target)
    }
    expect(castAtOffset(radius * 0.94).length).toBeGreaterThan(0)
    expect(castAtOffset(-radius * 0.94).length).toBeGreaterThan(0)
    expect(castAtOffset(radius * 1.08)).toHaveLength(0)
    expect(castAtOffset(-radius * 1.08)).toHaveLength(0)
    geometry.dispose()
    material.dispose()
  })
})

describe('pooled sphere destruction', () => {
  const input = () => ({ center: [1, 2, -9.5] as THREE.Vector3Tuple, impact: [1, 2, -9] as THREE.Vector3Tuple, radius: 0.55, color: '#ff6d57' })

  it('copies impact positions before a removed target can mutate them', () => {
    const pool = new BurstPool()
    const event = input()
    pool.add(event, 100)
    event.center[0] = 999
    event.impact[2] = 999
    expect(pool.slots[0].center).toEqual([1, 2, -9.5])
    expect(pool.slots[0].impact).toEqual([1, 2, -9])
  })

  it('stays bounded during rapid shooting and reuses the oldest slots', () => {
    const pool = new BurstPool()
    for (let count = 0; count < 100; count += 1) pool.add(input(), 100)
    expect(pool.slots).toHaveLength(MAX_BURSTS)
    expect(pool.currentActive * FRAGMENTS_PER_BURST).toBe(80)
    expect(pool.totalBursts).toBe(100)
    expect(Math.min(...pool.slots.map((slot) => slot.serial))).toBe(93)
  })

  it('expires at 280ms and clears immediately for pause, result or restart', () => {
    const pool = new BurstPool()
    pool.add(input(), 100)
    pool.expire(100 + BURST_DURATION_MS - 1)
    expect(pool.currentActive).toBe(1)
    pool.expire(100 + BURST_DURATION_MS)
    expect(pool.currentActive).toBe(0)
    pool.add(input(), 600)
    pool.clear()
    expect(pool.currentActive).toBe(0)
    expect(pool.totalBursts).toBe(2)
  })
})
