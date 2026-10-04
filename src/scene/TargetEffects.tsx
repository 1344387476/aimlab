import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { GamePhase } from '../types'
import { BurstPool, BURST_DURATION_MS, FRAGMENTS_PER_BURST, MAX_BURSTS } from './burstPool'

function createEffects() {
  const root = new THREE.Group()
  root.name = 'target-impact-effects'
  const shardGeometry = new THREE.IcosahedronGeometry(1, 0)
  const shardMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.42, metalness: 0.1,
    transparent: true, depthWrite: false,
  })
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BURSTS * FRAGMENTS_PER_BURST), 1)
  shardGeometry.setAttribute('burstOpacity', opacity)
  shardMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float burstOpacity; varying float vBurstOpacity;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBurstOpacity = burstOpacity;')
    shader.fragmentShader = 'varying float vBurstOpacity;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vBurstOpacity;')
  }
  shardMaterial.customProgramCacheKey = () => 'target-shard-opacity-v1'
  const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, MAX_BURSTS * FRAGMENTS_PER_BURST)
  shards.frustumCulled = false
  shards.renderOrder = 2
  root.add(shards)
  const ringGeometry = new THREE.RingGeometry(0.93, 1, 48)
  const flashGeometry = new THREE.SphereGeometry(1, 12, 8)
  const rings = Array.from({ length: MAX_BURSTS }, () => {
    const material = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    })
    const mesh = new THREE.Mesh(ringGeometry, material)
    root.add(mesh)
    return mesh
  })
  const flashes = Array.from({ length: MAX_BURSTS }, () => {
    const material = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    })
    const mesh = new THREE.Mesh(flashGeometry, material)
    root.add(mesh)
    return mesh
  })
  const transform = new THREE.Object3D()
  const tint = new THREE.Color()
  const directions = Array.from({ length: FRAGMENTS_PER_BURST }, (_, index) => {
    const y = 1 - ((index + 0.5) / FRAGMENTS_PER_BURST) * 2
    const width = Math.sqrt(1 - y * y)
    const angle = index * 2.399963
    return new THREE.Vector3(Math.cos(angle) * width, y, Math.sin(angle) * width)
  })

  const update = (pool: BurstPool, now: number, camera: THREE.Camera) => {
    pool.expire(now)
    const activeCount = pool.currentActive
    if (activeCount === 0 && !root.visible) return
    for (let index = 0; index < MAX_BURSTS; index += 1) {
      const slot = pool.slots[index]
      const t = THREE.MathUtils.clamp((now - slot.bornAt) / BURST_DURATION_MS, 0, 1)
      const fade = (1 - t) ** 1.5
      const ring = rings[index]
      const flash = flashes[index]
      ring.visible = slot.active
      flash.visible = slot.active && t < 0.38
      if (slot.active) {
        ring.position.fromArray(slot.impact)
        ring.quaternion.copy(camera.quaternion)
        ring.scale.setScalar(slot.radius * (0.55 + t * 2.4))
        ring.material.color.set(slot.color)
        ring.material.opacity = fade * 0.6
        flash.position.fromArray(slot.center)
        flash.scale.setScalar(slot.radius * (0.86 + t * 0.45))
        flash.material.color.set(slot.color)
        flash.material.opacity = Math.max(0, 0.6 - t * 1.65)
      }
      for (let fragment = 0; fragment < FRAGMENTS_PER_BURST; fragment += 1) {
        const particleIndex = index * FRAGMENTS_PER_BURST + fragment
        if (slot.active) {
          const direction = directions[fragment]
          const distance = slot.radius * (0.4 + t * 2.2)
          transform.position.fromArray(slot.center).addScaledVector(direction, distance)
          transform.position.y -= t * t * 0.38
          transform.rotation.set(t * 5 + fragment, t * 7 + slot.serial, fragment * 0.7)
          const scale = slot.radius * (0.15 + (fragment % 3) * 0.025) * (1 - t * 0.6)
          transform.scale.set(scale * 0.55, scale * 1.8, scale)
          tint.set(slot.color)
        } else {
          transform.scale.setScalar(0)
          tint.set('#000000')
        }
        transform.updateMatrix()
        shards.setMatrixAt(particleIndex, transform.matrix)
        shards.setColorAt(particleIndex, tint)
        opacity.setX(particleIndex, slot.active ? fade : 0)
      }
    }
    root.visible = activeCount > 0
    opacity.needsUpdate = true
    shards.instanceMatrix.needsUpdate = true
    if (shards.instanceColor) shards.instanceColor.needsUpdate = true
  }
  const dispose = () => {
    shardGeometry.dispose()
    shardMaterial.dispose()
    shards.dispose()
    ringGeometry.dispose()
    flashGeometry.dispose()
    for (const mesh of [...rings, ...flashes]) mesh.material.dispose()
  }
  return { root, update, dispose }
}

export function TargetEffects({ pool, phase, sessionId }: { pool: BurstPool; phase: GamePhase; sessionId: number }) {
  const { camera, gl, scene, invalidate } = useThree()
  const effects = useMemo(createEffects, [])
  useEffect(() => () => effects.dispose(), [effects])
  useEffect(() => {
    pool.clear()
    effects.update(pool, performance.now(), camera)
    invalidate()
  }, [camera, effects, invalidate, phase, pool, sessionId])
  useEffect(() => {
    let mounted = true
    // Wait until the facility has installed its environment and all scene lights
    // are committed. compileAsync traverses hidden meshes without displaying them.
    const frame = requestAnimationFrame(() => {
      const started = performance.now()
      const existingPrograms = new Set(gl.info.programs ?? [])
      void gl.compileAsync(effects.root, camera, scene).then(() => {
        if (!mounted) return
        // Without KHR_parallel_shader_compile, compileAsync can resolve before
        // link completion. Resolve the new programs' uniforms here, during menu
        // loading, so the first shot cannot pay that deferred first-use cost.
        for (const program of gl.info.programs ?? []) {
          if (!existingPrograms.has(program)) program.getUniforms()
        }
        pool.warmupReady = true
        pool.warmupDurationMs = performance.now() - started
      }).catch(() => {
        // Precompilation is an optimization; normal rendering remains usable.
        if (mounted) pool.warmupReady = false
      })
    })
    return () => {
      mounted = false
      cancelAnimationFrame(frame)
    }
  }, [camera, effects, gl, pool, scene])
  useFrame(() => {
    if (phase !== 'playing') return
    effects.update(pool, performance.now(), camera)
    if (pool.currentActive > 0) invalidate()
  })
  return <primitive object={effects.root} dispose={null} />
}
