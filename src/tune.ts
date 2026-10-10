import GUI from 'lil-gui';
import type { SandField } from './sand/field';
import type { TideParams } from './sand/tide';
import type { WriterParams } from './strokes/writer';

/** Live tuning panel for the handwriting and the sea. Opened with ?tune. */
export function createTuner(params: WriterParams, field: SandField, tide: TideParams, writeSample: () => void): GUI {
  const gui = new GUI({ title: 'Handwriting' });
  const hand = gui.addFolder('Hand');
  hand.add(params.timing, 'speed', 0.5, 5, 0.05).name('speed (m/s)');
  hand.add(params.timing, 'curvatureRef', 1, 40, 0.5).name('slow-down curvature');
  hand.add(params.timing, 'minSpeedRatio', 0.1, 1, 0.01).name('slowest in curves');
  hand.add(params, 'wobble', 0, 0.01, 0.0002).name('tremor (m)');
  hand.add(params, 'wobbleWavelength', 0.02, 0.3, 0.005).name('tremor wavelength');
  hand.add(params, 'catchUp', 0, 0.6, 0.01).name('catch-up per letter');
  hand.add(params, 'maxRate', 1, 4, 0.1).name('max catch-up');
  hand.add(params, 'deferDelay', 0.1, 3, 0.05).name('dot i’s after (s)');
  const press = gui.addFolder('Pressure');
  press.add(params.timing, 'pressureBase', 0, 1, 0.01).name('base');
  press.add(params.timing, 'pressureStart', 0, 1, 0.01).name('landing');
  press.add(params.timing, 'pressureTurn', 0, 1, 0.01).name('turns');
  const sand = gui.addFolder('Sand');
  sand.add(field.brush, 'radius', 0.005, 0.04, 0.0005).name('tip radius (m)');
  sand.add(field.brush, 'depth', 0.001, 0.02, 0.0005).name('groove depth (m)');
  sand.add(field.brush, 'ridge', 0, 0.008, 0.0002).name('ridge height (m)');
  const sea = gui.addFolder('Sea');
  sea.add(tide, 'gapMin', 0, 5, 0.1).name('shortest gap (s)');
  sea.add(tide, 'gapMax', 0, 10, 0.1).name('longest gap (s)');
  sea.add(tide, 'bigChanceCalm', 0, 1, 0.01).name('big waves, calm');
  sea.add(tide, 'bigChanceSwell', 0, 1, 0.01).name('big waves, swell');
  sea.add(tide, 'bigReachMin', 1, 7, 0.1).name('big reach min (m)');
  sea.add(tide, 'bigReachMax', 1, 8, 0.1).name('big reach max (m)');
  sea.add(tide, 'swellPeriod', 5, 180, 1).name('swell period (s)');
  sea.add(tide, 'writingLull', 0, 1, 0.01).name('ease off while writing');
  gui.add({ sample: writeSample }, 'sample').name('Write a sample line');
  gui.add({ smooth: () => field.clear() }, 'smooth').name('Smooth the sand');
  return gui;
}
