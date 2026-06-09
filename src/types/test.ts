export type TestId =
  | 'NN1'
  | 'NN2'
  | 'NN3'
  | 'NN4'
  | 'NN5'
  | 'BB1'
  | 'BB2'
  | 'BB3'
  | 'BB4'
  | 'FA1'
  | 'FA2'
  | 'FA3'
  | 'FA4'
  | 'FA5'
  | 'FA6'
  | 'KS1'
  | 'KS2'
  | 'KS3'
  | 'KS4'
  | 'KS5'
  | 'KS6';

export type Category = 'reflex' | 'balance' | 'rom' | 'mobility';

export type Level = 1 | 2 | 3;

export type Posture =
  | 'standing'
  | 'sitting'
  | 'standing-one-leg'
  | 'standing-feet-together';

export interface TestMetadata {
  id: TestId;
  name: string;
  category: Category;
  level: Level;
  icon: string;
  posture: Posture;
  durationSec: number;
  description: string;
  instructions: string[];
}

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface RawGameData {
  testId: TestId;
  hits?: number;
  misses?: number;
  breachCount?: number;
  maxSwayDegrees?: number;
  duration?: number;
  angleData?: number[];
  customMetrics?: Record<string, number>;
}

export interface HUDData {
  score?: number;
  timer: number;
  label: string;
  sublabel?: string;
}

export interface GameEngineInterface {
  init(): Promise<void>;
  processFrame(landmarks: NormalizedLandmark[], timestamp: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  getRawData(): RawGameData;
  getHUDData(): HUDData;
  destroy(): void;
}

// --- Game Event System ---
export type GameEventType =
  | 'hit'
  | 'miss'
  | 'breach'
  | 'milestone'
  | 'complete'
  | 'phase_change'
  | 'calibration_done';

export interface GameEvent {
  type: GameEventType;
  testId: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type GameEventCallback = (event: GameEvent) => void;

// --- Engine Factory Type ---
export type EngineFactory = (testId: TestId) => GameEngineInterface;

// --- Unified Test Config ---
export interface UnifiedTestConfig {
  id: TestId;
  name: string;
  category: Category;
  level: string;
  icon: string;
  description: string;
  [key: string]: unknown; // Allow category-specific extra fields
}
