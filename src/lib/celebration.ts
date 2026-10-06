import confetti from 'canvas-confetti';

/**
 * Triggers visual (confetti) and auditory (success chime) celebration
 * exclusively when a lead transitions to the 'Cliente' stage.
 */
export function celebrateClientConversion(): void {
  // 1. Accessibility Check: prefers-reduced-motion
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 2. Audio Chime via Web Audio API (Synthesized Bell Chime - zero external network dependencies)
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (AudioContextClass) {
      const ctx = new AudioContextClass();

      // Play an ascending major chord chime (C5 -> E5 -> G5 -> C6)
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.08);

        // Soft bell envelope
        const startTime = ctx.currentTime + index * 0.08;
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.65);
      });
    }
  } catch (err) {
    // Fail silently without interrupting UI or data flow
    console.debug('Audio celebration caught browser restriction:', err);
  }

  // 3. Confetti Effect
  if (!prefersReducedMotion && typeof confetti === 'function') {
    try {
      const count = 180;
      const defaults = {
        origin: { y: 0.65 },
        colors: ['#FF6600', '#16A34A', '#3B82F6', '#8B5CF6', '#FFFFFF'],
        disableForReducedMotion: true,
      };

      // Left stream
      confetti({
        ...defaults,
        particleCount: Math.floor(count * 0.4),
        angle: 60,
        spread: 55,
        origin: { x: 0.1, y: 0.65 },
      });

      // Right stream
      confetti({
        ...defaults,
        particleCount: Math.floor(count * 0.4),
        angle: 120,
        spread: 55,
        origin: { x: 0.9, y: 0.65 },
      });

      // Center pop
      setTimeout(() => {
        confetti({
          ...defaults,
          particleCount: Math.floor(count * 0.2),
          spread: 90,
          decay: 0.91,
          scalar: 1.1,
          origin: { x: 0.5, y: 0.5 },
        });
      }, 200);
    } catch (err) {
      console.debug('Confetti effect failed silently:', err);
    }
  }
}
