import { useEffect, RefObject } from "react";

type TargetEvent = MouseEvent | TouchEvent;

const hasTarget = (e: TargetEvent, r: RefObject<HTMLElement>): boolean =>
  r && !!r.current && r.current.contains(e.target as HTMLElement);

const recursiveHasTarget = (
  e: TargetEvent,
  [r, ...refs]: RefObject<HTMLElement>[]
): boolean => {
  if (!r) return false;
  return hasTarget(e, r) || recursiveHasTarget(e, refs);
};

export default function useOnClickOutside(
  ref: RefObject<HTMLElement> | RefObject<HTMLElement>[],
  handler: (event: TargetEvent) => void
): void {
  useEffect((): void | (() => void) => {
    const listener = function (event: TargetEvent): void {
      // Do nothing if clicking ref's element or descendent elements
      if (Array.isArray(ref)) {
        if (recursiveHasTarget(event, ref)) return;
      } else if (hasTarget(event, ref)) return;

      handler(event);
    };

    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);

    return (): void => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]); // Empty array ensures that effect is only run on mount and unmount
}