// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { TrainingAudio } from './audio/TrainingAudio'
import type { GameSceneProps } from './scene/GameScene'
import type { GameSettings, ShotOutcome } from './types'

vi.mock('./scene/GameScene', () => ({
  GameScene: ({ targets, settings, onShoot, onCanvasReady }: GameSceneProps) => {
    lastSceneSettings = settings
    return (
    <canvas
      data-testid="game-canvas"
      ref={(element) => { if (element) onCanvasReady(element) }}
      onMouseDown={(event) => { lastShotOutcome = onShoot(event.button === 2 ? null : targets[0]?.id ?? null) }}
    />
    )
  },
}))

let lockedElement: Element | null = null
let lastShotOutcome: ShotOutcome | null = null
let lastSceneSettings: GameSettings | null = null

function canvas(): HTMLCanvasElement {
  return screen.getByTestId('game-canvas') as HTMLCanvasElement
}

function grantPointerLock(): void {
  lockedElement = canvas()
  act(() => document.dispatchEvent(new Event('pointerlockchange')))
}

function releasePointerLock(): void {
  lockedElement = null
  lastShotOutcome = null
  act(() => document.dispatchEvent(new Event('pointerlockchange')))
}

function finishCountdown(): void {
  act(() => vi.advanceTimersByTime(3100))
}

beforeEach(() => {
  window.localStorage.clear()
  vi.useFakeTimers()
  lockedElement = null
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })),
  })
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => lockedElement,
  })
  Object.defineProperty(document, 'exitPointerLock', {
    configurable: true,
    value: vi.fn(releasePointerLock),
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) =>
    contextId === 'webgl2' ? {} : null) as typeof HTMLCanvasElement.prototype.getContext)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('App training flow', () => {
  it('edits all setup on the menu and starts a round using the selected configuration', () => {
    render(<App />)
    expect(screen.queryByRole('dialog', { name: '游戏设置' })).toBeNull()
    fireEvent.change(screen.getByRole('spinbutton', { name: '鼠标灵敏度' }), { target: { value: '0.62' } })
    expect(screen.queryByRole('spinbutton', { name: '鼠标 DPI' })).toBeNull()
    expect(screen.queryByText('CM / 360°')).toBeNull()
    expect(screen.queryByRole('slider', { name: /水平 FOV/ })).toBeNull()
    expect(screen.queryByRole('slider', { name: /网页微调倍率/ })).toBeNull()
    fireEvent.change(screen.getByRole('slider', { name: /靶子大小/ }), { target: { value: '1.2' } })
    fireEvent.click(screen.getByRole('button', { name: '圆环' }))
    fireEvent.click(screen.getByRole('button', { name: '30 秒' }))
    const selected = { sensitivity: 0.62, fov: 100, targetScale: 1.2, crosshairStyle: 'ring', durationSec: 30 }
    expect(lastSceneSettings).toMatchObject(selected)
    fireEvent.click(screen.getByRole('button', { name: /开始训练/ }))
    grantPointerLock()
    finishCountdown()
    expect(lastSceneSettings).toMatchObject(selected)
    act(() => vi.advanceTimersByTime(30000))
    expect(screen.getByRole('dialog', { name: '训练结果' })).toBeTruthy()
    const saved = JSON.parse(window.localStorage.getItem('dsbyte-aim:v2')!)
    expect(saved.runs[0]).toMatchObject({ sensitivity: 0.62, fineTune: 1, fov: 100, targetScale: 1.2, durationSec: 30, ranked: false })
  })

  it('acknowledges accepted shots and never plays feedback while the game is inactive', () => {
    const audio = vi.spyOn(TrainingAudio.prototype, 'play')
    render(<App />)
    fireEvent.mouseDown(canvas())
    expect(lastShotOutcome).toBe('ignored')
    fireEvent.click(screen.getByRole('button', { name: /开始训练/ }))
    grantPointerLock()
    fireEvent.mouseDown(canvas())
    expect(lastShotOutcome).toBe('ignored')
    finishCountdown()
    fireEvent.mouseDown(canvas())
    expect(lastShotOutcome).toBe('hit')
    expect(audio).toHaveBeenLastCalledWith('hit', 1)
    fireEvent.mouseDown(canvas(), { button: 2 })
    expect(lastShotOutcome).toBe('miss')
    expect(audio).toHaveBeenLastCalledWith('miss', 0)
    releasePointerLock()
    fireEvent.mouseDown(canvas())
    expect(lastShotOutcome).toBe('ignored')
    expect(audio).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: /继续训练/ }))
    grantPointerLock()
    finishCountdown()
    act(() => vi.advanceTimersByTime(60000))
    expect(screen.getByRole('dialog', { name: '训练结果' })).toBeTruthy()
    fireEvent.mouseDown(canvas())
    expect(lastShotOutcome).toBe('ignored')
    expect(audio).toHaveBeenCalledTimes(2)
  })

  it('keeps the menu until pointer lock succeeds, then counts down before enabling training', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /开始训练/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /开始训练/ }))
    expect(screen.getByText('正在锁定鼠标…')).toBeTruthy()
    expect(screen.queryByLabelText('训练数据')).toBeNull()

    grantPointerLock()
    expect(screen.getByText('准备射击')).toBeTruthy()
    expect(screen.queryByLabelText('训练数据')).toBeNull()

    act(() => vi.advanceTimersByTime(2900))
    expect(screen.queryByLabelText('训练数据')).toBeNull()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByLabelText('训练数据')).toBeTruthy()
    expect(screen.queryByText('准备射击')).toBeNull()
  })

  it('pauses on lock loss, resumes after another lock and countdown, and restarts with R', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /开始训练/ }))
    grantPointerLock()
    finishCountdown()

    fireEvent.mouseDown(canvas())
    expect(screen.getByRole('group', { name: '得分' }).textContent).toBe('1')

    releasePointerLock()
    expect(screen.getByRole('dialog', { name: '训练暂停' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /游戏设置/ })).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: '鼠标灵敏度' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '训练暂停' }).querySelectorAll('button')).toHaveLength(3)
    act(() => vi.advanceTimersByTime(5000))
    fireEvent.click(screen.getByRole('button', { name: /继续训练/ }))
    expect(screen.getByText('正在锁定鼠标…')).toBeTruthy()
    grantPointerLock()
    expect(screen.queryByLabelText('训练数据')).toBeNull()
    finishCountdown()
    expect(screen.getByRole('group', { name: '得分' }).textContent).toBe('1')

    fireEvent.keyDown(canvas(), { code: 'KeyR', key: 'r' })
    expect(screen.getByText('准备射击')).toBeTruthy()
    finishCountdown()
    expect(screen.getByRole('group', { name: '得分' }).textContent).toBe('0')

    fireEvent.mouseDown(canvas())
    expect(screen.getByRole('group', { name: '得分' }).textContent).toBe('1')
    fireEvent.keyDown(window, { code: 'KeyR', key: 'r' })
    expect(screen.getByText('准备射击')).toBeTruthy()
    finishCountdown()
    expect(screen.getByRole('group', { name: '得分' }).textContent).toBe('0')
  })

  it('returns to the menu after a rejected lock and succeeds on retry', async () => {
    const requestLock = vi.fn()
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValue(undefined)
    Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', {
      configurable: true,
      value: requestLock,
    })
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /开始训练/ }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toContain('鼠标锁定被拒绝')
    expect(screen.getByRole('button', { name: /开始训练/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /开始训练/ }))
    grantPointerLock()
    finishCountdown()
    expect(requestLock).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('训练数据')).toBeTruthy()
  })
})
