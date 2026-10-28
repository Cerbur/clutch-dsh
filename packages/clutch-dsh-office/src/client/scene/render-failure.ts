import type { Camera, Object3D, WebGLRenderer } from 'three';

export interface KitchenRenderGuard {
  /** False after any render/shader failure or disposal; callers must stop scheduling frames. */
  render(scene: Object3D, camera: Camera): boolean;
  /** Restore only debug settings still owned by this guard; never dispose the renderer. */
  dispose(): void;
}

/** One guard per renderer. No DOM, RAF ownership, global hooks or automatic retries. */
export function createKitchenRenderGuard(
  renderer: Pick<WebGLRenderer, 'debug' | 'render'>,
  onFailure: () => void,
): KitchenRenderGuard {
  const debug = renderer.debug;
  const previousShaderError = debug.onShaderError;
  const previousCheck = debug.checkShaderErrors;
  let failed = false;
  let disposed = false;

  const fail = () => {
    if (failed || disposed) return;
    // Latch before notifying: callbacks may re-enter render or tear down this guard.
    failed = true;
    try {
      onFailure();
    } catch {
      // Reporting failures must not turn a failed frame into an uncaught RAF error.
    }
  };
  const shaderError: NonNullable<typeof debug.onShaderError> = function (...args) {
    if (disposed) return;
    fail();
    previousShaderError?.apply(debug, args);
  };
  debug.checkShaderErrors = true;
  debug.onShaderError = shaderError;

  return {
    render(scene, camera) {
      if (disposed || failed) return false;
      // A later debug-hook replacement must not silently disable driver diagnostics.
      if (
        renderer.debug !== debug ||
        debug.onShaderError !== shaderError ||
        !debug.checkShaderErrors
      ) {
        fail();
        return false;
      }
      try {
        renderer.render(scene, camera);
      } catch {
        // Includes onBeforeCompile exceptions and exceptions in prior diagnostics.
        fail();
      }
      return !failed && !disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (debug.onShaderError === shaderError) {
        debug.onShaderError = previousShaderError;
        if (debug.checkShaderErrors === true) debug.checkShaderErrors = previousCheck;
      }
    },
  };
}
