import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

type Tuple = [number, number, number]
interface Part { position: Tuple; scale: Tuple; rotation?: Tuple }

function armorGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const cut = 0.09
  shape.moveTo(-0.5 + cut, -0.5)
  shape.lineTo(0.5 - cut, -0.5)
  shape.lineTo(0.5, -0.5 + cut)
  shape.lineTo(0.5, 0.5 - cut)
  shape.lineTo(0.5 - cut, 0.5)
  shape.lineTo(-0.5 + cut, 0.5)
  shape.lineTo(-0.5, 0.5 - cut)
  shape.lineTo(-0.5, -0.5 + cut)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.94, steps: 1, bevelEnabled: true, bevelSegments: 1,
    bevelSize: 0.024, bevelThickness: 0.03, curveSegments: 1,
  })
  // Extrusion bevels expand the outline; normalize the complete bounds so tile
  // seams remain physical gaps instead of overlapping coplanar surfaces.
  geometry.computeBoundingBox()
  const dimensions = geometry.boundingBox!.getSize(new THREE.Vector3())
  geometry.center()
  geometry.scale(1 / dimensions.x, 1 / dimensions.y, 1 / dimensions.z)
  return geometry
}

function labelTexture(kind: 'identity' | 'console' | 'floor'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = kind === 'identity' ? 1536 : 512
  canvas.height = kind === 'identity' ? 256 : 512
  const ctx = canvas.getContext('2d')!
  if (kind === 'identity') {
    ctx.fillStyle = '#334651'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f1f3ed'
    ctx.font = 'bold 112px Arial'
    ctx.fillText('SECTOR 07', 64, 143)
    ctx.fillStyle = '#80c5ce'
    ctx.font = '28px Arial'
    ctx.fillText('KINETIC RESEARCH  /  PRECISION FACILITY', 68, 206)
    ctx.fillStyle = '#c4d1cd'
    ctx.fillRect(1240, 60, 220, 10)
    ctx.fillRect(1240, 87, 160, 10)
    ctx.fillRect(1240, 114, 100, 10)
  } else if (kind === 'console') {
    ctx.fillStyle = '#1a343d'
    ctx.fillRect(0, 0, 512, 512)
    ctx.strokeStyle = '#365d67'
    ctx.lineWidth = 2
    for (let p = 32; p < 512; p += 48) {
      ctx.beginPath(); ctx.moveTo(p, 80); ctx.lineTo(p, 380); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(24, p); ctx.lineTo(488, p); ctx.stroke()
    }
    ctx.fillStyle = '#91d1d4'
    ctx.font = 'bold 33px Arial'
    ctx.fillText('RANGE CONTROL', 26, 49)
    ctx.font = '19px Arial'
    ctx.fillText('03 ACTIVE / SYSTEM NOMINAL', 28, 459)
    ctx.lineWidth = 6
    ctx.strokeStyle = '#84d3c1'
    ctx.beginPath()
    for (let x = 24; x < 488; x += 8) {
      const y = 238 + Math.sin(x / 35) * 58 + Math.cos(x / 21) * 24
      if (x === 24) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.fillStyle = '#dfbd76'
    ctx.fillRect(28, 405, 285, 8)
  } else {
    ctx.fillStyle = '#899da4'
    ctx.fillRect(0, 0, 512, 512)
    // Deterministic fine wear remains quiet enough for target silhouettes.
    for (let index = 0; index < 650; index += 1) {
      const x = (index * 137) % 512
      const y = (index * 79) % 512
      ctx.fillStyle = index % 2 ? 'rgba(227,235,232,0.13)' : 'rgba(46,68,77,0.12)'
      ctx.fillRect(x, y, index % 5 + 1, 1)
    }
    ctx.strokeStyle = 'rgba(213,228,225,0.16)'
    ctx.lineWidth = 2
    ctx.strokeRect(18, 18, 476, 476)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function createFacility() {
  const root = new THREE.Group()
  root.name = 'sector-07-training-facility'
  const box = new THREE.BoxGeometry(1, 1, 1)
  const bevel = armorGeometry()
  const pipe = new THREE.CylinderGeometry(1, 1, 1, 12)
  const plane = new THREE.PlaneGeometry(1, 1)
  const geometryList = [box, bevel, pipe, plane]
  const textures = { floor: labelTexture('floor'), identity: labelTexture('identity'), console: labelTexture('console') }
  const materials = {
    armor: new THREE.MeshStandardMaterial({ color: '#d2d9d6', metalness: 0.12, roughness: 0.62 }),
    inset: new THREE.MeshStandardMaterial({ color: '#a3b1b7', metalness: 0.32, roughness: 0.56 }),
    metal: new THREE.MeshStandardMaterial({ color: '#617785', metalness: 0.68, roughness: 0.43 }),
    trim: new THREE.MeshStandardMaterial({ color: '#2a3d48', metalness: 0.45, roughness: 0.48 }),
    floor: new THREE.MeshStandardMaterial({ color: '#c2cecc', map: textures.floor, roughness: 0.83, metalness: 0.16 }),
    dark: new THREE.MeshStandardMaterial({ color: '#334952', roughness: 0.9 }),
    warm: new THREE.MeshStandardMaterial({ color: '#d9ba75', roughness: 0.55, metalness: 0.1 }),
    cyan: new THREE.MeshBasicMaterial({ color: '#81c5d0', toneMapped: false }),
    light: new THREE.MeshBasicMaterial({ color: '#eff7ee', toneMapped: false }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#789da8', roughness: 0.24, metalness: 0.18, transparent: true, opacity: 0.24, depthWrite: false }),
    identity: new THREE.MeshStandardMaterial({ map: textures.identity, roughness: 0.58 }),
    console: new THREE.MeshBasicMaterial({ map: textures.console, toneMapped: false }),
  }
  type MaterialRole = keyof typeof materials
  const batches = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; parts: Part[]; cast: boolean; receive: boolean }>()
  const add = (role: MaterialRole, position: Tuple, scale: Tuple, options: { geometry?: THREE.BufferGeometry; rotation?: Tuple; cast?: boolean; receive?: boolean } = {}) => {
    const geometry = options.geometry ?? box
    const material = materials[role]
    const key = `${geometry.uuid}:${role}:${!!options.cast}:${!!options.receive}`
    if (!batches.has(key)) batches.set(key, { geometry, material, parts: [], cast: !!options.cast, receive: !!options.receive })
    batches.get(key)!.parts.push({ position, scale, rotation: options.rotation })
  }

  // Near layer: an elevated firing platform with inset deck and safety markings.
  add('trim', [0, 0.48, 3.4], [11.5, 0.96, 8.2], { geometry: bevel, cast: true, receive: true })
  add('floor', [0, 1.04, 3.4], [11.3, 0.12, 8.0], { geometry: bevel, receive: true })
  add('metal', [0, 0.32, -0.68], [10.6, 0.18, 0.65], { geometry: bevel })
  add('armor', [0, 0.14, -1.12], [10.6, 0.22, 0.55], { geometry: bevel })
  for (const side of [-1, 1]) {
    add('warm', [side * 5.4, 1.112, 3.4], [0.07, 0.01, 7.3])
    for (let step = 0; step < 11; step += 1) {
      add('warm', [side * (4.8 - step * 0.37), 1.113, -0.35], [0.19, 0.012, 0.34], { rotation: [0, -0.55, 0] })
    }
    for (const z of [3.4, 6.3]) {
      add('trim', [side * 5.48, 1.55, z], [0.13, 1.05, 0.15])
    }
    add('metal', [side * 5.48, 2.06, 4.85], [0.16, 0.14, 3.2], { geometry: bevel })
    add('cyan', [side * 5.48, 1.17, 2.6], [0.055, 0.02, 1.8])
  }

  // Floor panels expose scale through seams, with continuous marked training lanes.
  add('dark', [0, -0.15, -12], [32, 0.2, 40], { receive: true })
  for (let x = -14; x <= 14; x += 4) {
    for (let z = -30; z <= 6; z += 4) {
      add('floor', [x, -0.01, z], [3.94, 0.12, 3.94], { geometry: bevel, receive: true })
    }
  }
  for (const x of [-7.8, 7.8]) {
    add('light', [x, 0.06, -14], [0.048, 0.008, 26])
    add('warm', [x + Math.sign(x) * 0.15, 0.064, -11.5], [0.07, 0.008, 11])
    for (let z = -23; z < -3; z += 2.4) add('dark', [x - Math.sign(x) * 0.4, 0.065, z], [0.4, 0.01, 0.07])
  }
  for (const z of [-7.6, -15.6, -23.6]) {
    for (const side of [-1, 1]) add('light', [side * 9.65, 0.065, z], [2.3, 0.008, 0.08])
  }

  // Mid layer: articulated structural columns, equipment pods, rails and ventilation.
  for (const side of [-1, 1]) {
    add('inset', [side * 16.1, 6.4, -12], [0.35, 13.0, 40])
    add('trim', [side * 15.85, 0.6, -12], [0.15, 1.2, 40])
    for (const z of [3, -5, -13, -21, -29]) {
      add('armor', [side * 15.68, 6.3, z], [0.22, 10.7, 7.5], { geometry: bevel })
      add('metal', [side * 13.75, 6.2, z], [0.8, 12.4, 1.25], { geometry: bevel, cast: true })
      add('armor', [side * 13.19, 5.4, z + 0.05], [0.56, 8.4, 1.34], { geometry: bevel })
      add('trim', [side * 13.13, 1.05, z + 0.1], [1.15, 2.1, 1.65], { geometry: bevel })
      add('cyan', [side * 12.86, 6.9, z + 0.73], [0.055, 2.7, 0.03])
      add('metal', [side * 14.75, 10.6, z], [2.1, 0.8, 1.45], { rotation: [0, 0, side * 0.38], geometry: bevel })
    }
    for (const z of [-7, -20]) {
      add('trim', [side * 11.12, 1.85, z], [2.8, 3.7, 2.9], { geometry: bevel, cast: true })
      add('armor', [side * 11.12, 1.95, z + 1.47], [2.6, 3.25, 0.13], { geometry: bevel })
      add('metal', [side * 11.12, 3.57, z + 0.9], [2.4, 0.3, 1.65], { rotation: [-0.15, 0, 0], geometry: bevel })
      add('console', [side * 11.12, 2.65, z + 1.555], [1.35, 0.91, 1], { geometry: plane })
      add('trim', [side * 11.12, 1.2, z + 1.56], [1.92, 0.85, 0.045], { geometry: bevel })
      for (let vent = 0; vent < 7; vent += 1) add('metal', [side * 11.12, 0.87 + vent * 0.105, z + 1.605], [1.7, 0.032, 0.05])
      add('warm', [side * 10.02, 1.8, z + 1.565], [0.075, 0.6, 0.025])
      for (const offset of [-0.85, 0.85]) add('metal', [side * 11.12 + offset, 1.92, z + 1.56], [0.065, 0.36, 0.08])
    }
    // Conduit banks run along the sidewalls, never through target silhouettes.
    for (const y of [3.6, 4.05, 4.5]) {
      add('metal', [side * 15.3, y, -12], [0.12, 34, 0.12], { geometry: pipe, rotation: [Math.PI / 2, 0, 0] })
    }
    add('armor', [side * 15.5, 8.1, -12], [0.5, 1.7, 36], { geometry: bevel })
    add('cyan', [side * 15.2, 8.0, -12], [0.04, 0.045, 34])
  }

  // Far layer: an observation booth behind the targets, framed by a functional gantry.
  add('armor', [0, 1.6, -28.9], [26.6, 3.2, 0.65], { geometry: bevel })
  add('armor', [0, 10.4, -28.9], [26.6, 5.0, 0.65], { geometry: bevel })
  for (const x of [-11.7, 11.7]) add('armor', [x, 5.5, -28.9], [3.2, 5.2, 0.65], { geometry: bevel })
  for (const x of [-10.04, 10.04]) add('trim', [x, 5.65, -28.62], [0.4, 5.5, 0.2], { geometry: bevel })
  for (const y of [3.01, 8.29]) add('trim', [0, y, -28.62], [20.1, 0.23, 0.2], { geometry: bevel })
  // The dark frame consists of bars; the aperture itself is a clear depth layer.
  add('armor', [0, 5.65, -31.6], [19.6, 5.0, 0.22], { geometry: bevel })
  add('light', [0, 7.85, -31.4], [18.2, 0.11, 0.05])
  add('inset', [0, 3.25, -30.8], [19.5, 0.28, 3.5])
  add('glass', [0, 5.7, -28.4], [19.5, 4.45, 1], { geometry: plane })
  for (const x of [-9.8, -4.9, 0, 4.9, 9.8]) add('metal', [x, 5.65, -28.25], [0.15, 4.8, 0.26], { geometry: bevel })
  for (const y of [3.27, 8.0]) add('metal', [0, y, -28.3], [20.0, 0.24, 0.42], { geometry: bevel })
  // Benches and instrumentation are visible through the observation glazing.
  for (const x of [-7.2, -2.4, 2.4, 7.2]) {
    add('metal', [x, 4.1, -30.3], [3.2, 0.2, 1.4], { geometry: bevel })
    add('trim', [x, 3.65, -30.3], [0.25, 0.9, 0.6])
    add('console', [x, 4.9, -30.12], [2.0, 0.85, 1], { geometry: plane })
  }
  add('identity', [0, 10.05, -28.46], [11.4, 1.9, 1], { geometry: plane })
  for (const x of [-11.4, 11.4]) {
    add('trim', [x, 4.15, -24.0], [0.7, 8.3, 0.85], { geometry: bevel, cast: true })
    add('armor', [x, 4.2, -23.48], [0.52, 7.2, 0.28], { geometry: bevel })
    add('metal', [x, 8.12, -26.2], [0.65, 0.7, 4.5], { geometry: bevel })
  }
  add('metal', [0, 8.17, -23.9], [23.4, 0.55, 1.15], { geometry: bevel })
  add('trim', [0, 8.52, -23.42], [22.4, 0.065, 0.06])
  for (let x = -10.5; x <= 10.5; x += 1.5) add('trim', [x, 8.88, -23.42], [0.048, 0.8, 0.06])
  add('metal', [0, 9.3, -23.42], [22.4, 0.06, 0.08])

  // Roof ribs and broad skylight cards establish daylight rather than neon darkness.
  add('inset', [0, 13.45, -12], [32, 0.4, 40])
  for (const z of [3, -5, -13, -21, -29]) {
    add('metal', [0, 12.68, z], [28, 0.65, 1.1], { geometry: bevel })
    add('armor', [0, 12.18, z], [20.5, 0.5, 0.8], { geometry: bevel })
    add('light', [0, 11.88, z + 0.04], [14.0, 0.03, 0.24])
  }
  for (const z of [-1, -9, -17, -25]) {
    add('trim', [0, 13.16, z], [12.1, 0.12, 5.65], { geometry: bevel })
    add('light', [0, 13.08, z], [11.55, 0.025, 5.12], { geometry: bevel })
    for (const x of [-3.8, 0, 3.8]) add('metal', [x, 13.03, z], [0.06, 0.04, 5.2])
  }
  for (const x of [-8.5, 8.5]) add('trim', [x, 12.7, -12], [0.2, 0.32, 39])

  // Rear enclosure is visible when players turn away from the target lane.
  // An armored airlock completes the room without constraining FPS look input.
  add('inset', [0, 6.6, 8.4], [32, 13.2, 0.5])
  for (const side of [-1, 1]) {
    for (const offset of [6.3, 10.25, 14.2]) {
      add('armor', [side * offset, 6.55, 8.08], [3.78, 10.8, 0.22], { geometry: bevel })
      add('metal', [side * offset, 1.08, 7.93], [3.78, 1.9, 0.13], { geometry: bevel })
      add('trim', [side * offset, 9.32, 7.9], [2.7, 0.055, 0.035])
    }
    add('trim', [side * 4.4, 4.45, 7.89], [0.75, 8.9, 0.6], { geometry: bevel })
    add('metal', [side * 1.93, 4.25, 8.0], [3.73, 8.4, 0.2], { geometry: bevel })
    add('armor', [side * 1.93, 4.31, 7.83], [3.38, 7.87, 0.17], { geometry: bevel })
    add('trim', [side * 1.9, 4.55, 7.71], [0.12, 1.75, 0.08], { geometry: bevel })
    add('cyan', [side * 4.03, 4.8, 7.52], [0.05, 6.8, 0.025])
    add('warm', [side * 2.55, 1.21, 7.71], [2.35, 0.16, 0.015])
    for (const y of [2.02, 6.62]) add('inset', [side * 1.93, y, 7.71], [2.77, 0.095, 0.03])
    add('console', [side * 5.12, 3.6, 7.91], [0.75, 1.1, 1], { geometry: plane, rotation: [0, Math.PI, 0] })
  }
  add('trim', [0, 8.98, 7.87], [9.55, 0.58, 0.6], { geometry: bevel })
  add('armor', [0, 11.35, 8.02], [8.2, 4.0, 0.25], { geometry: bevel })
  add('cyan', [0, 8.6, 7.52], [8.0, 0.045, 0.025])
  add('identity', [0, 10.48, 7.83], [6.2, 1.04, 1], { geometry: plane, rotation: [0, Math.PI, 0] })
  add('trim', [0, 4.15, 7.75], [0.09, 8.1, 0.06])
  add('metal', [0, 0.095, 7.47], [8.6, 0.15, 0.95], { geometry: bevel })

  const transform = new THREE.Object3D()
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.parts.length)
    mesh.castShadow = batch.cast
    mesh.receiveShadow = batch.receive
    for (let index = 0; index < batch.parts.length; index += 1) {
      const part = batch.parts[index]
      transform.position.fromArray(part.position)
      transform.scale.fromArray(part.scale)
      transform.rotation.set(...(part.rotation ?? [0, 0, 0]))
      transform.updateMatrix()
      mesh.setMatrixAt(index, transform.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    root.add(mesh)
  }
  const dispose = () => {
    for (const child of root.children) if (child instanceof THREE.InstancedMesh) child.dispose()
    for (const geometry of geometryList) geometry.dispose()
    for (const material of Object.values(materials)) material.dispose()
    for (const texture of Object.values(textures)) texture.dispose()
  }
  return { root, dispose }
}

export function ArenaFacility() {
  const { gl, scene, invalidate } = useThree()
  const keyTarget = useMemo(() => {
    const target = new THREE.Object3D()
    target.position.set(0, 1, -11)
    return target
  }, [])
  useEffect(() => {
    const facility = createFacility()
    scene.add(facility.root)
    const pmrem = new THREE.PMREMGenerator(gl)
    const room = new RoomEnvironment()
    const environment = pmrem.fromScene(room, 0.04)
    room.dispose()
    pmrem.dispose()
    scene.environment = environment.texture
    scene.environmentIntensity = 0.48
    invalidate()
    return () => {
      scene.remove(facility.root)
      facility.dispose()
      scene.environment = null
      environment.dispose()
    }
  }, [gl, invalidate, scene])
  return (
    <>
      <color attach="background" args={['#afc0c7']} />
      <fog attach="fog" args={['#b8c8cb', 34, 72]} />
      <hemisphereLight args={['#edf3ee', '#71858b', 1.35]} />
      <ambientLight intensity={0.26} />
      <primitive object={keyTarget} />
      <directionalLight
        position={[5, 12.5, 3]} target={keyTarget}
        color="#fff4da" intensity={2.4} castShadow
        shadow-mapSize={[1024, 1024]} shadow-bias={-0.0002} shadow-normalBias={0.04}
        shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={15} shadow-camera-bottom={-15}
        shadow-camera-near={0.5} shadow-camera-far={52}
      />
      <directionalLight position={[-9, 7, -19]} color="#adcfdc" intensity={0.85} />
    </>
  )
}
