import { describe, it, expect } from 'vitest';
import { createGameEngine } from '@/modules/game/engines';
import type { NormalizedLandmark } from '@/modules/game/engines/types';

/**
 * Guards the ported game-engine factory: every battery test maps to an engine that
 * implements the GameEngine interface, and feeding synthetic landmarks through
 * calibration/play does not throw. (Canvas render is not exercised here.)
 */
const BATTERY = ['BB1', 'NN1', 'FA1', 'KS1'] as const;

function synthLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
}

describe('createGameEngine (ported)', () => {
  it.each(BATTERY)('returns a GameEngine for %s', (testId) => {
    const e = createGameEngine(testId);
    for (const m of ['reset', 'processCalibration', 'processFrame', 'getHudMetrics', 'isComplete', 'getRawData', 'destroy'] as const) {
      expect(typeof e[m]).toBe('function');
    }
    e.destroy();
  });

  it('runs synthetic calibration + frames for each battery game without throwing', () => {
    for (const testId of BATTERY) {
      const e = createGameEngine(testId);
      e.reset();
      const lm = synthLandmarks();
      expect(() => {
        e.processCalibration(lm);
        for (let t = 0; t < 5; t++) e.processFrame(lm, t * 33);
        e.getHudMetrics();
        e.isComplete();
        e.getRawData();
      }).not.toThrow();
      e.destroy();
    }
  });
});
