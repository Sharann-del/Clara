import { useEffect, useState } from 'react';

/** `value`, but only after it has stopped changing for `ms`. The first value is returned immediately. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  // Before the first non-null value settles, don't make callers wait.
  return debounced ?? value;
}
