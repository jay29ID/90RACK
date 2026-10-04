import { useEffect, useRef } from 'react';
import { spectrum } from '../audio';
import { getState } from '../store';

/**
 * LED-segment spectrum analyzer on a canvas. `live` reads the real Web Audio
 * analyser (Plex inputs); otherwise it animates from the active deck's
 * play state.
 */
export function Spectrum(props: { bands?: number; segments?: number; className?: string; live?: boolean; peaks?: boolean }) {
  const { bands = 20, segments = 16, className = '', live, peaks = true } = props;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    const peak = Array(bands).fill(0);
    const peakHold = Array(bands).fill(0);
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const s = getState();
      const np = s.now[s.input];
      const isLive = live ?? ((s.input === 'dvd' && !s.dvd?.demo) || (s.input === 'cd' && !s.cdSlots[s.cdSlot]?.demo));
      const levels = s.power ? spectrum(bands, isLive, Boolean(np?.playing)) : Array(bands).fill(0);

      g.clearRect(0, 0, w, h);
      const gap = Math.max(1, w / bands / 6);
      const bw = w / bands - gap;
      const sh = h / segments;
      for (let b = 0; b < bands; b++) {
        const lit = Math.round(levels[b] * segments);
        if (lit >= peak[b]) {
          peak[b] = lit;
          peakHold[b] = 30;
        } else if (peakHold[b]-- <= 0) peak[b] = Math.max(0, peak[b] - 0.25);
        for (let k = 0; k < segments; k++) {
          const on = k < lit || (peaks && Math.floor(peak[b]) === k && k > 0);
          const frac = k / segments;
          const hue = frac > 0.8 ? 4 : frac > 0.6 ? 38 : 168;
          g.fillStyle = on ? `hsl(${hue} 95% ${frac > 0.8 ? 58 : 60}%)` : `hsl(${hue} 50% 18% / 0.35)`;
          if (on) {
            g.shadowColor = `hsl(${hue} 100% 60%)`;
            g.shadowBlur = 6 * dpr;
          } else g.shadowBlur = 0;
          g.fillRect(b * (bw + gap) + gap / 2, h - (k + 1) * sh + sh * 0.18, bw, sh * 0.64);
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [bands, segments, live, peaks]);

  return <canvas ref={ref} className={`spectrum ${className}`} aria-hidden />;
}
