import GUI from 'lil-gui';
import type { SandField } from './sand/field';
import type { TideParams } from './sand/tide';

/** Live tuning panel for the sand and the sea. Opened with ?tune. */
export function createTuner(field: SandField, tide: TideParams): GUI {
  const gui = new GUI({ title: 'Tuning' });
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
  sea.add(tide, 'writingLull', 0, 1, 0.01).name('ease off while drawing');
  sea.add(tide, 'seekChance', 0, 1, 0.01).name('come for the writing');
  sea.add(tide, 'seekStep', 0.1, 2, 0.05).name('each wave further (m)');
  gui.add({ smooth: () => field.clear() }, 'smooth').name('Smooth the sand');
  return gui;
}
