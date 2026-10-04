import { useEffect, useRef, useState } from 'react';
import { getState, patchNow, useStore, type Input } from './store';

/** Fires `fn` every `ms` while `active`. */
export function useInterval(fn: () => void, ms: number, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

/**
 * Demo discs have no real media, so this advances their clock in the store
 * as if they were playing and calls `onEnd` when they run out.
 */
export function useDemoClock(input: Input, enabled: boolean, onEnd: () => void) {
  const playing = useStore((s) => Boolean(s.now[input]?.playing));
  useInterval(
    () => {
      const np = getState().now[input];
      if (!np) return;
      const position = np.position + 0.25;
      if (position >= np.duration) onEnd();
      else patchNow(input, { position });
    },
    250,
    enabled && playing,
  );
}

/** A flag that is true for `ms` after each change of `key`: OSD flashes etc. */
export function useFlash(key: unknown, ms = 2500) {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const id = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return on;
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useInterval(() => setNow(new Date()), 1000);
  return now;
}
