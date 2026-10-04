function isUnsupportedRawInput(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'NotSupportedError'
}

/**
 * Request raw mouse movement first. Older browsers may ignore the option or
 * return void, so callers must still wait for pointerlockchange before play.
 */
export async function requestPointerLockPreferRaw(canvas: HTMLCanvasElement): Promise<void> {
  try {
    await canvas.requestPointerLock({ unadjustedMovement: true })
  } catch (error) {
    if (!isUnsupportedRawInput(error)) throw error
    await canvas.requestPointerLock()
  }
}
