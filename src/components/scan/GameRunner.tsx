'use client';

import { useEffect, useRef, useState } from 'react';
import { createGameEngine } from '@/modules/game/engines';
import type { GameEngine, HudMetrics, NormalizedLandmark } from '@/modules/game/engines/types';
import { useCamera } from '@/lib/mediapipe/use-camera';
import { usePoseDetector } from '@/lib/mediapipe/use-pose';
import { POSE_CONNECTIONS } from '@/modules/pose/landmarks';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { TestId } from '@/types/test';
import { Button } from '@/components/ui/Button';
import { dbg, dbgError } from '@/lib/debug';

type Phase = 'loading' | 'calibrating' | 'countdown' | 'playing' | 'complete' | 'error';

/**
 * Generic MediaPipe camera scan runner (feature 1c-UI-b). Drives any test via the
 * production GameEngine interface from createGameEngine(testId): camera → pose → engine
 * (calibrate → countdown → play) → getRawData() → onComplete. Scores are computed from
 * raw (un-mirrored) landmarks, so display choices never affect scoring.
 */
export function GameRunner({
  testId,
  name,
  durationSec,
  onComplete,
  onCancel,
}: {
  testId: TestId;
  name: string;
  durationSec: number;
  onComplete: (rawData: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const phaseRef = useRef<Phase>('loading');
  const completedRef = useRef(false);

  const camera = useCamera();
  const pose = usePoseDetector();

  const [phase, setPhase] = useState<Phase>('loading');
  const [countdown, setCountdown] = useState(3);
  const [hud, setHud] = useState<HudMetrics | null>(null);
  const [calibMsg, setCalibMsg] = useState('Getting you in frame…');
  const [error, setError] = useState<string | null>(null);

  function goPhase(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  function finish() {
    if (completedRef.current) return;
    completedRef.current = true;
    dbg('GameRunner:finish', { testId });
    try {
      const raw = engineRef.current?.getRawData() ?? {};
      pose.stopDetection();
      camera.stop();
      goPhase('complete');
      onComplete(raw as Record<string, unknown>);
    } catch (err) {
      dbgError('GameRunner:finish error', err);
    }
  }

  function draw(landmarks: PoseLandmarks | null) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const w = canvas.width;
    const h = canvas.height;

    ctx.drawImage(video, 0, 0, w, h);

    // Light skeleton overlay (teal) for feedback.
    if (landmarks && landmarks.length) {
      ctx.strokeStyle = 'rgba(45,212,191,0.7)';
      ctx.lineWidth = 3;
      for (const [a, b] of POSE_CONNECTIONS) {
        const pa = landmarks[a];
        const pb = landmarks[b];
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      }
    }

    // Engine overlays (sway circle, targets, etc.).
    try {
      engineRef.current?.render(ctx, w, h);
    } catch { /* engine render is best-effort */ }
  }

  // Boot once.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        dbg('GameRunner:boot', { testId });
        const engine = createGameEngine(testId);
        engine.reset();
        engineRef.current = engine;

        if (!videoRef.current) return;
        await camera.start(videoRef.current);
        await pose.init();
        if (cancelled) return;

        pose.startDetection(videoRef.current, (landmarks, timestamp) => {
          const eng = engineRef.current;
          if (!eng) return;
          const lm = (landmarks ?? []) as unknown as NormalizedLandmark[];

          if (phaseRef.current === 'calibrating') {
            if (landmarks && landmarks.length) {
              const cal = eng.processCalibration(lm);
              setCalibMsg(cal.feedback || cal.message || 'Hold still…');
              if (cal.isCalibrated || cal.isReady) goPhase('countdown');
            }
          } else if (phaseRef.current === 'playing') {
            if (landmarks && landmarks.length) eng.processFrame(lm, timestamp);
            setHud(eng.getHudMetrics());
            if (eng.isComplete()) finish();
          }
          draw(landmarks);
        });

        goPhase('calibrating');
      } catch (err) {
        dbgError('GameRunner:boot failed', err);
        if (!cancelled) {
          setError(camera.error ?? pose.error ?? (err instanceof Error ? err.message : 'Failed to start camera'));
          goPhase('error');
        }
      }
    }
    boot();
    return () => {
      cancelled = true;
      pose.stopDetection();
      camera.stop();
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId]);

  // Calibration safety timeout — force start after 10s if gates never pass.
  useEffect(() => {
    if (phase !== 'calibrating') return;
    const t = setTimeout(() => { if (phaseRef.current === 'calibrating') goPhase('countdown'); }, 10000);
    return () => clearTimeout(t);
  }, [phase]);

  // Countdown 3→0 → playing.
  useEffect(() => {
    if (phase !== 'countdown') return;
    setCountdown(3);
    let n = 3;
    const iv = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n <= 0) { clearInterval(iv); goPhase('playing'); }
    }, 1000);
    return () => clearInterval(iv);
  }, [phase]);

  // Duration safety net — engine.isComplete() is primary; this guarantees an end.
  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setTimeout(() => finish(), (durationSec + 5) * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, durationSec]);

  const hudPrimary = hud?.primary;
  const hudTimer = hud?.timer as { elapsed?: number; total?: number } | number | undefined;
  const elapsedSec = typeof hudTimer === 'object' && hudTimer ? Math.round((hudTimer.elapsed ?? 0) / 1000) : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-contain opacity-0" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain" />

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-4">
        <span className="text-white font-semibold text-sm bg-black/40 rounded-lg px-3 py-1">{name}</span>
        <button onClick={onCancel} aria-label="Cancel scan" className="w-9 h-9 rounded-full bg-white/15 border border-white/20 text-white text-lg hover:bg-white/25">×</button>
      </div>

      {phase === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-white/70 text-sm">Starting camera & pose detection…</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 max-w-sm">
            <p className="text-red-400 text-sm font-semibold mb-2">Camera error</p>
            <p className="text-white/70 text-xs mb-4">{error}</p>
            <div className="flex gap-2 justify-center">
              <Button variant="secondary" onClick={onCancel}>Close</Button>
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          </div>
        </div>
      )}

      {phase === 'calibrating' && (
        <div className="absolute inset-x-0 bottom-16 flex justify-center">
          <p className="text-white bg-teal-500/20 border border-teal-400/40 rounded-xl px-4 py-2 text-sm">{calibMsg}</p>
        </div>
      )}

      {phase === 'countdown' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold text-7xl tabular-nums drop-shadow-lg">{countdown > 0 ? countdown : 'Go'}</span>
        </div>
      )}

      {phase === 'playing' && (
        <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-4">
          {hudPrimary && (
            <div className="bg-black/50 rounded-xl px-4 py-2 text-center">
              <div className="text-2xl font-bold tabular-nums" style={{ color: hudPrimary.color ?? '#2dd4bf' }}>{String(hudPrimary.value)}</div>
              <div className="text-[10px] uppercase tracking-wider text-white/60">{hudPrimary.label}</div>
            </div>
          )}
          {elapsedSec !== undefined && (
            <div className="bg-black/50 rounded-xl px-4 py-2 text-center">
              <div className="text-2xl font-bold text-white tabular-nums">{elapsedSec}s</div>
              <div className="text-[10px] uppercase tracking-wider text-white/60">Time</div>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={finish}>Finish</Button>
        </div>
      )}
    </div>
  );
}
