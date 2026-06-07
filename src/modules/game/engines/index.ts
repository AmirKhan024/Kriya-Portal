// Kriya Game Engine Factory
// Creates the correct engine instance based on testId

import { BalanceEngine } from './balance-engine';
import { BallEngine } from './ball-engine';
import { FlashEngine } from './flash-engine';
import { MobilityEngine } from './mobility-engine';
import { HipGateEngine } from './hip-gate-engine';
import { SpinalWaveEngine } from './spinal-wave-engine';
import { LateralFlexionEngine } from './lateral-flexion-engine';
import { DeepSquatEngine } from './deep-squat-engine';
import { CossackSquatEngine } from './cossack-squat-engine';
import { ROMv2Engine } from './rom-v2-engine';
import { HandSwingsEngine } from './hand-swings-engine';
import { PostureEngine } from './posture-engine';
import type { GameEngine } from './types';

export function createGameEngine(testId: string): GameEngine {
  if (testId.startsWith('BB')) return new BalanceEngine(testId as 'BB1' | 'BB2' | 'BB3' | 'BB4');
  if (testId === 'NN1' || testId === 'NN2' || testId === 'NN3') return new BallEngine(testId);
  if (testId === 'NN4' || testId === 'NN5') return new FlashEngine(testId);
  // Mobility: KS2-KS6 = v4 engines, KS1 = legacy
  if (testId === 'KS2') return new HipGateEngine();
  if (testId === 'KS3') return new SpinalWaveEngine();
  if (testId === 'KS4') return new LateralFlexionEngine();
  if (testId === 'KS5') return new DeepSquatEngine();
  if (testId === 'KS6') return new CossackSquatEngine();
  if (testId === 'KS1') return new MobilityEngine('KS1');
  // FA6 = Hand Swings (standalone engine, separate from ROMv2)
  if (testId === 'FA6') return new HandSwingsEngine();
  if (testId.startsWith('FA')) return new ROMv2Engine(testId as 'FA1' | 'FA2' | 'FA3' | 'FA4' | 'FA5');
  if (testId.startsWith('POSTURE')) return new PostureEngine(testId);
  throw new Error(`Unknown testId: ${testId}`);
}

export type { GameEngine, CalibrationStatus, HudMetrics } from './types';
