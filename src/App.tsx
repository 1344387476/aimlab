import { useCallback, useEffect, useRef, useState } from 'react'
import { TrainingEngine } from './game/engine'
import { TrainingAudio } from './audio/TrainingAudio'
import { CURRENT_RULESET } from './game/arena'
import { DEFAULT_SETTINGS } from './game/profiles'
import {
  getLeaderboard,
  getRecentRuns,
  loadStoredData,
  recordRun,
  saveSettings,
} from './game/storage'
import { GameScene } from './scene/GameScene'
import { requestPointerLockPreferRaw } from './input/pointerLock'
import {
  Countdown,
  Crosshair,
  Hud,
  LeaderboardOverlay,
  MenuOverlay,
  PauseOverlay,
  ResultOverlay,
  UnsupportedScreen,
} from './ui/Overlays'
import type { GameDuration, GamePhase, GameSettings, RulesetId, RunResult, ShotOutcome } from './types'

type LockAction = 'new' | 'resume'

function getSupportError(): string | null {
  if (window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches) {
    return '请使用桌面浏览器和键鼠游玩。'
  }
  if (!HTMLCanvasElement.prototype.requestPointerLock) {
    return '当前浏览器不支持鼠标锁定，无法进行 FPS 瞄准训练。'
  }
  const testCanvas = document.createElement('canvas')
  if (!testCanvas.getContext('webgl2')) {
    return '当前设备无法启用 WebGL 2，无法显示 3D 靶场。'
  }
  return null
}

const initialData = loadStoredData()

export default function App() {
  const [supportError] = useState(getSupportError)
  const [phase, setPhase] = useState<GamePhase>('menu')
  const phaseRef = useRef<GamePhase>('menu')
  const [settings, setSettings] = useState<GameSettings>(initialData.settings ?? DEFAULT_SETTINGS)
  const [activeSettings, setActiveSettings] = useState<GameSettings>(initialData.settings ?? DEFAULT_SETTINGS)
  const activeSettingsRef = useRef<GameSettings>(initialData.settings ?? DEFAULT_SETTINGS)
  const [runs, setRuns] = useState<RunResult[]>(initialData.runs)
  const [leaderboardDuration, setLeaderboardDuration] = useState<GameDuration>(initialData.settings?.durationSec ?? 60)
  const [leaderboardRuleset, setLeaderboardRuleset] = useState<RulesetId>(CURRENT_RULESET)
  const [leaderboardReturn, setLeaderboardReturn] = useState<'menu' | 'result'>('menu')
  const [sessionId, setSessionId] = useState(0)
  const [countdown, setCountdown] = useState(3)
  const [error, setError] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(
    initialData.storageAvailable ? null : '本地存储不可用，本次成绩刷新后不会保留。',
  )
  const [lastResult, setLastResult] = useState<RunResult | null>(initialData.runs[0] ?? null)
  const [isBest, setIsBest] = useState(false)
  const [canvasReady, setCanvasReady] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef(new TrainingEngine())
  const audioRef = useRef(new TrainingAudio())
  const [snapshot, setSnapshot] = useState(() => engineRef.current.snapshot(performance.now()))
  const pendingActionRef = useRef<LockAction>('new')
  const pendingSettingsRef = useRef<GameSettings>(initialData.settings ?? DEFAULT_SETTINGS)
  const lockOriginRef = useRef<'menu' | 'paused' | 'result'>('menu')
  const lockAttemptRef = useRef(0)
  const lockErrorTimerRef = useRef<number | null>(null)
  const runInitializedRef = useRef(false)

  const changePhase = useCallback((next: GamePhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const finishRun = useCallback((now: number) => {
    if (phaseRef.current !== 'playing') return
    const previousBest = getLeaderboard(activeSettingsRef.current.durationSec)[0]?.score ?? -1
    const result = engineRef.current.finish(now)
    const saved = recordRun(result)
    if (!saved) setStorageWarning('本地存储不可用，本次成绩刷新后不会保留。')
    setRuns(getRecentRuns())
    setLastResult(result)
    setIsBest(saved && result.ranked && result.score > previousBest)
    changePhase('result')
    if (document.pointerLockElement === canvasRef.current) document.exitPointerLock()
  }, [changePhase])

  const pauseCurrent = useCallback(() => {
    const current = phaseRef.current
    if (current !== 'playing' && current !== 'countdown' && current !== 'locking') return
    if (current === 'locking') {
      changePhase(lockOriginRef.current)
      if (document.pointerLockElement === canvasRef.current) document.exitPointerLock()
      return
    }
    if (current === 'playing') {
      const now = performance.now()
      if (engineRef.current.tick(now) || engineRef.current.isFinished) {
        finishRun(now)
        return
      }
      engineRef.current.pause(now)
      setSnapshot(engineRef.current.snapshot(now))
    }
    changePhase('paused')
    if (document.pointerLockElement === canvasRef.current) document.exitPointerLock()
  }, [changePhase, finishRun])

  const lockFailed = useCallback((message: string, attempt: number) => {
    if (attempt !== lockAttemptRef.current || phaseRef.current !== 'locking') return
    setError(message)
    changePhase(lockOriginRef.current)
  }, [changePhase])

  const requestLock = useCallback((action: LockAction) => {
    const canvas = canvasRef.current
    if (!canvas) {
      setError('靶场仍在加载，请稍后重试。')
      return
    }
    const origin = phaseRef.current
    const attempt = ++lockAttemptRef.current
    if (lockErrorTimerRef.current !== null) {
      window.clearTimeout(lockErrorTimerRef.current)
      lockErrorTimerRef.current = null
    }
    lockOriginRef.current = origin === 'paused' || origin === 'result' ? origin : 'menu'
    if (action === 'new') {
      pendingSettingsRef.current = { ...settings }
    }
    // This runs directly in the click/keyboard gesture, before requesting lock.
    audioRef.current.unlock(action === 'new' ? settings.soundEnabled : activeSettingsRef.current.soundEnabled)
    pendingActionRef.current = action
    setError(null)
    changePhase('locking')
    void requestPointerLockPreferRaw(canvas).catch(() => {
      lockFailed('鼠标锁定被拒绝。请点击按钮重新尝试，并允许浏览器锁定鼠标。', attempt)
    })
  }, [changePhase, lockFailed, settings])

  useEffect(() => {
    const onLockChange = () => {
      if (document.pointerLockElement === canvasRef.current) {
        if (phaseRef.current === 'locking') {
          if (lockErrorTimerRef.current !== null) {
            window.clearTimeout(lockErrorTimerRef.current)
            lockErrorTimerRef.current = null
          }
          if (pendingActionRef.current === 'new') {
            activeSettingsRef.current = pendingSettingsRef.current
            setActiveSettings(pendingSettingsRef.current)
            runInitializedRef.current = false
            setSessionId((value) => value + 1)
          }
          setError(null)
          setCountdown(3)
          changePhase('countdown')
        } else if (phaseRef.current !== 'countdown' && phaseRef.current !== 'playing') {
          document.exitPointerLock()
        }
      } else {
        pauseCurrent()
      }
    }
    const onLockError = () => {
      const attempt = lockAttemptRef.current
      if (lockErrorTimerRef.current !== null) window.clearTimeout(lockErrorTimerRef.current)
      lockErrorTimerRef.current = window.setTimeout(() => {
        lockErrorTimerRef.current = null
        if (document.pointerLockElement !== canvasRef.current) {
          lockFailed('无法锁定鼠标。请确认浏览器权限，然后再次点击开始。', attempt)
        }
      }, 1000)
    }
    const onVisibilityChange = () => {
      if (document.hidden) pauseCurrent()
    }
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', pauseCurrent)
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', pauseCurrent)
      if (lockErrorTimerRef.current !== null) window.clearTimeout(lockErrorTimerRef.current)
    }
  }, [changePhase, lockFailed, pauseCurrent])

  useEffect(() => {
    if (phase !== 'countdown') return
    const started = performance.now()
    let completed = false
    const timer = window.setInterval(() => {
      const remaining = Math.ceil((3000 - (performance.now() - started)) / 1000)
      if (remaining > 0) {
        setCountdown(remaining)
        return
      }
      if (completed) return
      completed = true
      window.clearInterval(timer)
      if (document.pointerLockElement !== canvasRef.current) {
        pauseCurrent()
        return
      }
      const now = performance.now()
      if (pendingActionRef.current === 'resume' && runInitializedRef.current) {
        engineRef.current.resume(now)
      } else {
        engineRef.current.start(activeSettingsRef.current, now)
        runInitializedRef.current = true
      }
      setSnapshot(engineRef.current.snapshot(now))
      changePhase('playing')
    }, 32)
    return () => window.clearInterval(timer)
  }, [phase, changePhase, pauseCurrent])

  useEffect(() => {
    if (phase !== 'playing') return
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (engineRef.current.tick(now)) finishRun(now)
      else setSnapshot(engineRef.current.snapshot(now))
    }, 40)
    return () => window.clearInterval(timer)
  }, [phase, finishRun])

  const onShoot = useCallback((targetId: number | null): ShotOutcome => {
    if (phaseRef.current !== 'playing') return 'ignored'
    const now = performance.now()
    const hit = engineRef.current.shoot(targetId, now)
    if (engineRef.current.isFinished) {
      finishRun(now)
      return 'ignored'
    }
    const next = engineRef.current.snapshot(now)
    setSnapshot(next)
    const outcome = hit ? 'hit' : 'miss'
    audioRef.current.play(outcome, next.streak)
    return outcome
  }, [finishRun])

  useEffect(() => {
    if (phase !== 'playing') audioRef.current.stop()
  }, [phase, sessionId])

  useEffect(() => () => audioRef.current.dispose(), [])

  const restart = useCallback(() => {
    const current = phaseRef.current
    if (current === 'playing' && document.pointerLockElement === canvasRef.current) {
      const selectedSettings = { ...settings }
      activeSettingsRef.current = selectedSettings
      setActiveSettings(selectedSettings)
      runInitializedRef.current = false
      pendingActionRef.current = 'new'
      setSessionId((value) => value + 1)
      setCountdown(3)
      audioRef.current.stop()
      audioRef.current.unlock(selectedSettings.soundEnabled)
      changePhase('countdown')
    } else if (current === 'paused' || current === 'result') {
      requestLock('new')
    }
  }, [changePhase, requestLock, settings])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'Escape' && ['playing', 'countdown', 'locking'].includes(phaseRef.current)) {
        event.preventDefault()
        pauseCurrent()
        return
      }
      if (event.key === 'Escape' && phaseRef.current === 'leaderboard') {
        event.preventDefault()
        changePhase(leaderboardReturn)
        return
      }
      if (target instanceof Element && target.closest('input, select, textarea, [contenteditable="true"]')) return
      if (event.code === 'KeyR' && ['playing', 'paused', 'result'].includes(phaseRef.current)) {
        event.preventDefault()
        restart()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [changePhase, leaderboardReturn, pauseCurrent, restart])

  const onSettingsChange = useCallback((next: GameSettings) => {
    setSettings(next)
    if (!saveSettings(next)) setStorageWarning('本地存储不可用，设置刷新后不会保留。')
  }, [])

  const openLeaderboard = (from: 'menu' | 'result') => {
    setLeaderboardReturn(from)
    setLeaderboardDuration(from === 'result' && lastResult ? lastResult.durationSec : settings.durationSec)
    setLeaderboardRuleset(from === 'result' && lastResult ? lastResult.rulesetId : CURRENT_RULESET)
    changePhase('leaderboard')
  }

  const quitToMenu = () => {
    runInitializedRef.current = false
    setSessionId((value) => value + 1)
    changePhase('menu')
    if (document.pointerLockElement === canvasRef.current) document.exitPointerLock()
  }

  const sceneSettings = phase === 'menu' || phase === 'leaderboard'
    ? settings
    : activeSettings
  const sceneTargets = phase === 'playing' || phase === 'paused'
    ? snapshot.targets
    : []

  useEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_QA === '1')) return
    const diagnostics = {
      get phase() { return phaseRef.current },
      get snapshot() { return engineRef.current.snapshot(performance.now()) },
      get audio() { return audioRef.current.diagnostics },
      get settings() { return activeSettingsRef.current },
    }
    Object.assign(window, { __AIM_GAME_DIAGNOSTICS__: diagnostics })
    return () => { Reflect.deleteProperty(window, '__AIM_GAME_DIAGNOSTICS__') }
  }, [])

  if (supportError) return <UnsupportedScreen reason={supportError} />

  return (
    <main className={`app-shell${phase === 'menu' ? ' app-shell--menu' : ''}`}>
      <div className="scene-layer" aria-hidden="true">
        <GameScene
          targets={sceneTargets}
          settings={sceneSettings}
          phase={phase}
          sessionId={sessionId}
          onShoot={onShoot}
          onCanvasReady={(canvas) => {
            canvasRef.current = canvas
            setCanvasReady(true)
          }}
        />
      </div>
      <div className="arena-vignette" aria-hidden="true" />
      {!canvasReady && <div className="loading-screen" role="status">靶场加载中…</div>}
      {canvasReady && (
        <div className="overlay-layer">
          {phase === 'menu' && (
            <MenuOverlay
              settings={settings}
              onChange={onSettingsChange}
              onStart={() => requestLock('new')}
              onLeaderboard={() => openLeaderboard('menu')}
              error={error}
              storageWarning={storageWarning}
            />
          )}
          {phase === 'leaderboard' && (
            <LeaderboardOverlay
              duration={leaderboardDuration}
              rulesetId={leaderboardRuleset}
              onRulesetChange={setLeaderboardRuleset}
              hasLegacyRecords={getLeaderboard(30, 'grid-v1').length > 0 || getLeaderboard(60, 'grid-v1').length > 0}
              runs={getLeaderboard(leaderboardDuration, leaderboardRuleset)}
              recentRuns={runs}
              storageWarning={storageWarning}
              onDurationChange={setLeaderboardDuration}
              onClose={() => changePhase(leaderboardReturn)}
            />
          )}
          {phase === 'locking' && <div className="loading-screen loading-screen--locking" role="status">正在锁定鼠标…</div>}
          {phase === 'countdown' && <><Crosshair settings={activeSettings} /><Countdown value={countdown} /></>}
          {phase === 'playing' && <><Crosshair settings={activeSettings} /><Hud snapshot={snapshot} /></>}
          {phase === 'paused' && (
            <PauseOverlay
              onResume={() => requestLock(runInitializedRef.current ? 'resume' : 'new')}
              onRestart={restart}
              onQuit={quitToMenu}
              error={error}
            />
          )}
          {phase === 'result' && lastResult && (
            <ResultOverlay
              result={lastResult}
              isBest={isBest}
              error={error}
              storageWarning={storageWarning}
              onAgain={() => requestLock('new')}
              onMenu={quitToMenu}
              onLeaderboard={() => openLeaderboard('result')}
            />
          )}
        </div>
      )}
    </main>
  )
}
