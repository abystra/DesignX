import { useLayoutEffect } from "react";
export function useVisualViewport(ref) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const resize = () => {
      node.style.setProperty(
        "--dx-visible-height",
        `${window.visualViewport?.height || window.innerHeight}px`,
      );
      node.style.setProperty(
        "--dx-viewport-top",
        `${window.visualViewport?.offsetTop || 0}px`,
      );
    };
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
  }, [ref]);
}
