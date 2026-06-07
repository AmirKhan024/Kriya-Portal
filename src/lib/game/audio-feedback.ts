/**
 * Kriya Game Audio Feedback — Matches Balance.html Section 7 exactly.
 *
 * Provides audio cues for all game events:
 *   - Breach sound (descending triple-tone, loud and attention-grabbing)
 *   - Complete sound (ascending C-E-G-C arpeggio)
 *   - Countdown beep (high/low pitch)
 *   - Timer warning (last 5 seconds tick)
 *   - Calibration ready (ascending triangle chord)
 *   - Leg switch sound (D-G ascending triangle)
 *   - Lift leg warning (ascending gentle triangle)
 *   - Voice instructions via SpeechSynthesis (with 2.5s throttle)
 *
 * All audio parameters (frequencies, durations, gains, waveforms) are
 * copied line-for-line from Balance.html lines 1728-1861.
 */

const AudioCtxClass = typeof window !== 'undefined'
  ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  : null;

let audioCtx: AudioContext | null = null;

/** Ensure the AudioContext is created and running. */
function ensureAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!AudioCtxClass) return null;
  if (!audioCtx) audioCtx = new AudioCtxClass();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => { /* ignore */ });
  }
  return audioCtx;
}

/**
 * Breach sound — loud descending triple-tone: 440→330→220 Hz.
 * Square wave, attention-grabbing from a distance.
 * Balance.html lines 1736-1750.
 */
export function playBreachSound(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  [440, 330, 220].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'square';
    const t = ctx.currentTime + i * 0.08;
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

/**
 * Game complete sound — ascending C-E-G-C arpeggio.
 * Sine wave, celebratory.
 * Balance.html lines 1752-1765.
 */
export function playCompleteSound(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  [523, 659, 784, 1047].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    const t = ctx.currentTime + i * 0.12;
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

/**
 * Countdown beep — low or high pitch.
 * 'low' = 660Hz (0.12s), 'high' = 1047Hz (0.3s, louder).
 * Balance.html lines 1767-1780.
 */
export function playCountdownBeep(pitch: 'low' | 'high'): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  const freq = pitch === 'high' ? 1047 : 660;
  const dur = pitch === 'high' ? 0.3 : 0.12;
  const vol = pitch === 'high' ? 0.2 : 0.14;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

/**
 * Timer warning tick — last 5 seconds.
 * Short 440Hz sine pulse.
 * Balance.html lines 1782-1792.
 */
export function playTimerWarning(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 440;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}

/**
 * Calibration ready — ascending A-C#-E triangle chord.
 * Balance.html lines 1794-1807.
 */
export function playCalibrationReady(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  [440, 554, 659].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'triangle';
    const t = ctx.currentTime + i * 0.1;
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.25);
  });
}

/**
 * Leg switch sound — D5 → G5 ascending triangle pair.
 * Balance.html lines 1809-1822.
 */
export function playLegSwitchSound(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  [587, 784].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'triangle';
    const t = ctx.currentTime + i * 0.15;
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.25);
  });
}

/**
 * Gentle ascending warning: "lift your leg" cue.
 * G-C-E ascending triangle triple.
 * Balance.html lines 1824-1838.
 */
export function playLiftLegWarning(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  [392, 523, 659].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'triangle';
    const t = ctx.currentTime + i * 0.12;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

// ── Reflex game audio cues (from Reflex.html Section 13) ──

/**
 * Hit sound — ascending 880→1100 Hz sine sweep.
 * Reflex.html playHit(): correct catch or torch.
 */
export function playHitSound(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.06);
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  osc.start();
  osc.stop(ctx.currentTime + 0.18);
}

/**
 * Wrong sound — low 200 Hz square wave.
 * Reflex.html playWrong(): wrong hand/colour catch.
 */
export function playWrongSound(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 200;
  osc.type = 'square';
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

/**
 * Penalty sound — descending 320→220 Hz double square tone.
 * Reflex.html playPenalty(): grey ball caught in NN3.
 */
export function playPenaltySound(): void {
  const ctx = ensureAudio();
  if (!ctx) return;

  [320, 220].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'square';
    const t = ctx.currentTime + i * 0.08;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

// ── Voice instruction system (SpeechSynthesis with throttle) ──
// Balance.html lines 1841-1861.

let lastSpokeAt = 0;
const SPEAK_COOLDOWN_MS = 2500;

/**
 * Speak an instruction aloud via SpeechSynthesis.
 * Throttled to prevent rapid-fire speech overlaps.
 *
 * Returns true if speech was queued, false if it was dropped by the
 * 2.5s global cooldown. Engine maybeSpeak helpers use the return value
 * so they only update their per-key state when speech actually fired
 * — otherwise a dropped second-slot warning would ghost-silence itself
 * for its entire per-key cooldown.
 */
export function speakInstruction(text: string): boolean {
  if (typeof window === 'undefined') return false;
  if (!('speechSynthesis' in window)) return false;

  const now = performance.now();
  if (now - lastSpokeAt < SPEAK_COOLDOWN_MS) return false;
  lastSpokeAt = now;

  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.1;
  utt.pitch = 1.0;
  utt.volume = 0.9;

  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith('en') && v.name.includes('Female')) ??
    voices.find((v) => v.lang.startsWith('en'));
  if (preferred) utt.voice = preferred;

  window.speechSynthesis.speak(utt);
  return true;
}

/**
 * Cancel any pending speech.
 */
export function cancelSpeech(): void {
  if (typeof window === 'undefined') return;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Clean up audio context (call on game exit).
 */
export function cleanupAudio(): void {
  cancelSpeech();
  // Don't close audioCtx — may be reused in next game
}
