let audioCtx: AudioContext | null = null;
let lastKitchenBellAt = 0;
let lastWaiterBellAt = 0;

const SOUND_PREF_KEY = 'la_dieta_sound_enabled_v1';

export function isSoundAlertEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_PREF_KEY);
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function setSoundAlertEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota errors
  }
}

function getAudioContext(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) {
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume();
  }
}

/**
 * Timbre de alerta para Cocina: doble campanada enérgica (A5 -> D6, repetida)
 */
export function playKitchenOrderBell(force = false): void {
  if (!force && !isSoundAlertEnabled()) return;
  const nowMs = Date.now();
  if (!force && nowMs - lastKitchenBellAt < 1200) return;
  lastKitchenBellAt = nowMs;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const sequence = [
      { freq: 880, offset: 0 },
      { freq: 1174.66, offset: 0.15 },
      { freq: 880, offset: 0.42 },
      { freq: 1318.51, offset: 0.57 },
    ];

    sequence.forEach(({ freq, offset }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + offset);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.32, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.36);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    });
  } catch {
    // Ignore audio restrictions before user gesture
  }
}

/**
 * Timbre de alerta para Mozo: campanilla de servicio (C6 -> E6 -> G6 -> C7)
 */
export function playWaiterReadyBell(force = false): void {
  if (!force && !isSoundAlertEnabled()) return;
  const nowMs = Date.now();
  if (!force && nowMs - lastWaiterBellAt < 1200) return;
  lastWaiterBellAt = nowMs;

  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const sequence = [
      { freq: 1046.5, offset: 0 },
      { freq: 1318.51, offset: 0.12 },
      { freq: 1567.98, offset: 0.24 },
      { freq: 2093.0, offset: 0.38 },
    ];

    sequence.forEach(({ freq, offset }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + offset);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.42);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.45);
    });
  } catch {
    // Ignore audio restrictions before user gesture
  }
}

export function playNewOrderChime(): void {
  playKitchenOrderBell(false);
}
