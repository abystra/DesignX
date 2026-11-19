import { useEffect, useRef } from "react";
/** Modeless drawer: toolbar remains reachable, opening and closing have a focus target. */
export function useDrawerFocus(ref, open, query) {
  const previous = useRef(null);
  useEffect(() => {
    if (!open || !window.matchMedia(query).matches) return;
    previous.current = document.activeElement;
    ref.current
      ?.querySelector(
        "textarea,input:not([type=hidden]),button:not([disabled])",
      )
      ?.focus();
    return () => {
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, [ref, open, query]);
}
