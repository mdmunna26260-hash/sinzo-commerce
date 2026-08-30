"use client";
import { useCallback, useEffect, useRef, useState } /* no react-import needed beyond these */ from "react";

/* Tiny reusable async-action state: idle → loading → success/error.
   - run(fn): sets busy for the duration, swallows nothing (errors propagate
     to the caller's catch), and NEVER leaves the spinner running if the
     component unmounted.
   - guard: true while busy → buttons disabled → no duplicate submissions. */
export function useLoadingState() {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return undefined; // duplicate-click guard
    setBusy(true);
    try {
      const out = await fn();
      return out;
    } finally {
      if (alive.current) setBusy(false); // cleanup on success AND error
    }
  }, [busy]);
  return { busy, setBusy, run };
}
