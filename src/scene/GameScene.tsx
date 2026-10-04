import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { GamePhase, GameSettings, ShotOutcome, TargetState } from '../types'
import { FIXED_HORIZONTAL_FOV, getDegreesPerMouseUnit } from '../game/profiles'
import { CAMERA_POSITION, getTargetRadius, TARGET_BOUNDS } from '../game/arena'
import { ArenaFacility } from './ArenaFacility'
import { BurstPool } from './burstPool'
import { TargetEffects } from './TargetEffects'
import './GameScene.css'

export interface GameSceneProps {
  targets: TargetState[]
  settings: GameSettings
  phase: GamePhase
  sessionId: number
  onShoot: (targetId: number | null) => ShotOutcome
  onCanvasReady: (canvas: HTMLCanvasElement) => void
}

const PREVIEW_TARGETS: TargetState[] = [
  { id: -1, position: [-3.3, 4.1, TARGET_BOUNDS.z], spawnedAtActiveMs: 0 },
  { id: -2, position: [1.5, 2.6, TARGET_BOUNDS.z], spawnedAtActiveMs: 0 },
  { id: -3, position: [4.4, 4.8, TARGET_BOUNDS.z], spawnedAtActiveMs: 0 },
]
const DIAGNOSTICS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_QA === '1'

function horizontalToVerticalFov(horizontalDegrees: number, aspect: number): number {
  const horizontalRadians = THREE.MathUtils.degToRad(horizontalDegrees)
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontalRadians / 2) / aspect))
}

function CameraAndInput({ phase, settings, sessionId, onShoot, targetMeshes, pool }: {
  phase: GamePhase
  settings: GameSettings
  sessionId: number
  onShoot: GameSceneProps['onShoot']
  targetMeshes: React.MutableRefObject<Map<number, THREE.Mesh>>
  pool: BurstPool
}) {
  const { camera, gl, size, invalidate } = useThree()
  const yaw = useRef(0)
  const pitch = useRef(0)
  const raycaster = useRef(new THREE.Raycaster())
  const center = useRef(new THREE.Vector2(0, 0))
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const phaseRef = useRef(phase)
  const onShootRef = useRef(onShoot)
  const degreesPerUnitRef = useRef(getDegreesPerMouseUnit(settings))
  phaseRef.current = phase
  onShootRef.current = onShoot
  degreesPerUnitRef.current = getDegreesPerMouseUnit(settings)

  useEffect(() => {
    camera.position.fromArray(CAMERA_POSITION)
    yaw.current = 0
    pitch.current = 0
    camera.quaternion.identity()
    invalidate()
  }, [camera, invalidate, sessionId])

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return
    camera.fov = horizontalToVerticalFov(FIXED_HORIZONTAL_FOV, size.width / Math.max(size.height, 1))
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, invalidate, size.height, size.width])

  useEffect(() => {
    const canvas = gl.domElement
    const isLive = () => phaseRef.current === 'playing' && document.pointerLockElement === canvas
    const handleMouseMove = (event: MouseEvent) => {
      if (!isLive()) return
      const radiansPerUnit = THREE.MathUtils.degToRad(degreesPerUnitRef.current)
      yaw.current -= event.movementX * radiansPerUnit
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - event.movementY * radiansPerUnit,
        -Math.PI / 2 + 0.02,
        Math.PI / 2 - 0.02,
      )
      camera.quaternion.setFromEuler(euler.current.set(pitch.current, yaw.current, 0, 'YXZ'))
      invalidate()
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !isLive()) return
      event.preventDefault()
      // Update matrices before raycasting, including input that arrives between demand frames.
      camera.updateMatrixWorld()
      for (const mesh of targetMeshes.current.values()) mesh.updateWorldMatrix(true, false)
      raycaster.current.setFromCamera(center.current, camera)
      const intersection = raycaster.current.intersectObjects([...targetMeshes.current.values()], false)[0]
      const id = intersection?.object.userData.targetId
      const mesh = intersection?.object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> | undefined
      // Copy every effect input before React removes the hit target.
      const burst = mesh && intersection ? {
        center: mesh.getWorldPosition(new THREE.Vector3()).toArray() as THREE.Vector3Tuple,
        impact: intersection.point.toArray() as THREE.Vector3Tuple,
        radius: mesh.scale.x,
        color: `#${mesh.material.color.getHexString()}`,
      } : null
      const outcome = onShootRef.current(typeof id === 'number' ? id : null)
      if (outcome === 'hit' && burst) {
        pool.add(burst, performance.now())
        invalidate()
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [camera, gl, invalidate, pool, targetMeshes])
  return null
}

function TargetVisual({ target, radius, geometry, material, register }: {
  target: TargetState
  radius: number
  geometry: THREE.SphereGeometry
  material: THREE.MeshPhysicalMaterial
  register: (id: number, mesh: THREE.Mesh | null) => void
}) {
  return (
    <mesh
      ref={(mesh) => register(target.id, mesh)}
      geometry={geometry} material={material} dispose={null}
      position={target.position} scale={radius}
      userData={{ targetId: target.id }} castShadow
    />
  )
}

function SceneDiagnostics({ targetMeshes, pool, phase, sessionId }: {
  targetMeshes: React.MutableRefObject<Map<number, THREE.Mesh>>
  pool: BurstPool
  phase: GamePhase
  sessionId: number
}) {
  const { gl, camera } = useThree()
  const timings = useRef<number[]>([])
  const previousFrame = useRef<number | null>(null)
  const previousHadBurst = useRef(false)
  const phaseRef = useRef(phase)
  const sessionRef = useRef(sessionId)
  phaseRef.current = phase
  sessionRef.current = sessionId
  useFrame(() => {
    if (!DIAGNOSTICS_ENABLED) return
    const now = performance.now()
    const previous = previousFrame.current
    const delta = previous === null ? 0 : now - previous
    // Include the ending frame of an active burst so even a stall that expires
    // the effect is measured. Idle demand-loop gaps are excluded by the flag.
    if (previousHadBurst.current && delta > 0) {
      timings.current.push(delta)
      if (timings.current.length > 120) timings.current.shift()
    }
    previousFrame.current = now
    previousHadBurst.current = pool.currentActive > 0
  })
  useEffect(() => {
    if (!DIAGNOSTICS_ENABLED) return
    const getter = () => {
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      const samples = [...timings.current].sort((a, b) => a - b)
      const quantile = (fraction: number) => samples.length ? samples[Math.floor((samples.length - 1) * fraction)] : null
      return {
        phase: phaseRef.current,
        sessionId: sessionRef.current,
        renderer: {
          calls: gl.info.render.calls, triangles: gl.info.render.triangles,
          geometries: gl.info.memory.geometries, textures: gl.info.memory.textures,
          programs: gl.info.programs?.length ?? 0,
          dpr: gl.getPixelRatio(), shadowLights: 1, shadowMapSize: 1024,
        },
        effects: {
          totalBursts: pool.totalBursts, currentActive: pool.currentActive,
          fragments: pool.currentActive * 10, capacity: 8,
          warmupReady: pool.warmupReady, warmupDurationMs: pool.warmupDurationMs,
        },
        frameTime: { samples: samples.length, medianMs: quantile(0.5), p95Ms: quantile(0.95), maxMs: quantile(1) },
        camera: { position: camera.position.toArray(), yaw: euler.y, pitch: euler.x },
        targets: [...targetMeshes.current.entries()].map(([id, mesh]) => ({
          id, center: mesh.getWorldPosition(new THREE.Vector3()).toArray(), radius: mesh.scale.x,
        })),
      }
    }
    Object.defineProperty(window, '__AIM_SCENE_DIAGNOSTICS__', { configurable: true, get: getter })
    return () => { Reflect.deleteProperty(window, '__AIM_SCENE_DIAGNOSTICS__') }
  }, [camera, gl, pool, targetMeshes])
  return null
}

function TrainingScene({ targets, settings, phase, sessionId, onShoot }: Omit<GameSceneProps, 'onCanvasReady'>) {
  const targetMeshes = useRef(new Map<number, THREE.Mesh>())
  const pool = useMemo(() => new BurstPool(), [])
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 32, 24), [])
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: settings.targetColor, emissive: settings.targetColor, emissiveIntensity: 0.09,
    roughness: 0.38, metalness: 0.08, clearcoat: 0.35, clearcoatRoughness: 0.3,
    envMapIntensity: 0.8,
  }), [])
  const { invalidate } = useThree()
  useEffect(() => () => { sphere.dispose(); material.dispose() }, [material, sphere])
  useEffect(() => {
    material.color.set(settings.targetColor)
    material.emissive.set(settings.targetColor)
    invalidate()
  }, [invalidate, material, settings.targetColor])
  const registerTarget = useCallback((id: number, mesh: THREE.Mesh | null) => {
    if (mesh) targetMeshes.current.set(id, mesh)
    else targetMeshes.current.delete(id)
  }, [])
  const hasLiveTargets = ['playing', 'paused', 'locking', 'countdown'].includes(phase) && targets.length > 0
  const visibleTargets = hasLiveTargets ? targets : PREVIEW_TARGETS
  return (
    <>
      <ArenaFacility />
      <CameraAndInput phase={phase} settings={settings} sessionId={sessionId} onShoot={onShoot} targetMeshes={targetMeshes} pool={pool} />
      {visibleTargets.map((target) => (
        <TargetVisual key={target.id} target={target} radius={getTargetRadius(settings.targetScale)} geometry={sphere} material={material} register={registerTarget} />
      ))}
      <TargetEffects pool={pool} phase={phase} sessionId={sessionId} />
      <SceneDiagnostics targetMeshes={targetMeshes} pool={pool} phase={phase} sessionId={sessionId} />
    </>
  )
}

export function GameScene(props: GameSceneProps) {
  return (
    <div className="game-scene" aria-hidden="true">
      <Canvas
        camera={{ position: CAMERA_POSITION, near: 0.05, far: 80, fov: 60 }}
        dpr={[1, 1.5]} shadows="soft" frameloop="demand"
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
        onCreated={({ gl }) => props.onCanvasReady(gl.domElement)}
      >
        <TrainingScene {...props} />
      </Canvas>
    </div>
  )
}
