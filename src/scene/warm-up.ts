import type * as THREE from 'three/webgpu';

/** Longest we'll keep the veil up waiting for shaders before showing the scene anyway. */
const WARM_UP_LIMIT_MS = 12_000;

/**
 * Compiles every shader the scene needs before it's first shown.
 *
 * Without this, the first frames are drawn while the GPU is still compiling
 * pipelines. Chrome does that quickly, but Safari (especially on iPhone) can
 * take long enough that a first visit shows only the background until you
 * leave and come back. Compiling here, behind the veil, means the scene
 * appears whole. If compiling stalls or fails, we carry on and let rendering
 * compile as it goes, as before.
 */
export async function warmUp(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void> {
  let timer = 0;
  try {
    await Promise.race([
      renderer.compileAsync(scene, camera),
      new Promise<void>((resolve) => (timer = window.setTimeout(resolve, WARM_UP_LIMIT_MS))),
    ]);
  } catch {
    // Rendering will compile on demand instead.
  } finally {
    window.clearTimeout(timer);
  }
}
