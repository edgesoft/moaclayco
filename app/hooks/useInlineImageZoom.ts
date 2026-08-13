import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Point = { x: number; y: number };
type Size = { height: number; width: number };

type Gesture = {
  moved: boolean;
  pointerType: string;
  startDistance: number;
  startMidpoint: Point;
  startPoint: Point;
  startPosition: Point;
  startScale: number;
  startedAt: number;
  usedMultiplePointers: boolean;
};

type InlineImageZoomOptions = {
  imageKey: string;
  onNext: () => void;
  onPrevious: () => void;
  onZoomIntent: () => void;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const TAP_SCALE = 2;
const PAN_EDGE_GUARD = 1;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const distanceBetween = (first: Point, second: Point) =>
  Math.hypot(second.x - first.x, second.y - first.y);

const midpointBetween = (first: Point, second: Point): Point => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

const supportsHoverZoom = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function useInlineImageZoom({
  imageKey,
  onNext,
  onPrevious,
  onZoomIntent,
}: InlineImageZoomOptions) {
  const [hoverPosition, setHoverPosition] = useState<Point>({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [scale, setScale] = useState(MIN_SCALE);
  const gestureRef = useRef<Gesture | null>(null);
  const hoverPointRef = useRef<Point>({ x: 0, y: 0 });
  const hoverPositionRef = useRef<Point>({ x: 0, y: 0 });
  const naturalSizeKeyRef = useRef(imageKey);
  const lastTapRef = useRef<{ at: number; point: Point } | null>(null);
  const naturalSizeRef = useRef<Size | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const positionRef = useRef<Point>({ x: 0, y: 0 });
  const previewScaleRef = useRef(MIN_SCALE);
  const scaleRef = useRef(MIN_SCALE);
  const stageRef = useRef<HTMLDivElement>(null);

  if (naturalSizeKeyRef.current !== imageKey) {
    naturalSizeKeyRef.current = imageKey;
    naturalSizeRef.current = null;
  }

  const getCachedCoverSize = useCallback((): Size | null => {
    const stage = stageRef.current;
    if (!stage) return null;

    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const naturalSize = naturalSizeRef.current;
    if (!naturalSize) return null;

    const coverScale = Math.max(
      stageWidth / naturalSize.width,
      stageHeight / naturalSize.height
    );
    return {
      height: naturalSize.height * coverScale,
      width: naturalSize.width * coverScale,
    };
  }, []);

  const getCoverSize = useCallback((): Size | null => {
    const stage = stageRef.current;
    if (!stage) return null;

    const image = stage.querySelector("img");
    const naturalWidth = image?.naturalWidth ?? 0;
    const naturalHeight = image?.naturalHeight ?? 0;

    if (naturalWidth > 0 && naturalHeight > 0) {
      naturalSizeRef.current = {
        height: naturalHeight,
        width: naturalWidth,
      };
    }

    return getCachedCoverSize();
  }, [getCachedCoverSize]);

  const getBounds = useCallback(
    (nextScale: number) => {
      const stage = stageRef.current;
      if (!stage || nextScale <= MIN_SCALE) return { x: 0, y: 0 };

      const coverSize = getCoverSize() ?? {
        height: stage.clientHeight,
        width: stage.clientWidth,
      };

      return {
        x: Math.max(
          0,
          (coverSize.width * nextScale - stage.clientWidth) / 2 -
            PAN_EDGE_GUARD
        ),
        y: Math.max(
          0,
          (coverSize.height * nextScale - stage.clientHeight) / 2 -
            PAN_EDGE_GUARD
        ),
      };
    },
    [getCoverSize]
  );

  const clampPosition = useCallback(
    (nextPosition: Point, nextScale: number): Point => {
      const bounds = getBounds(nextScale);
      return {
        x: clamp(nextPosition.x, -bounds.x, bounds.x),
        y: clamp(nextPosition.y, -bounds.y, bounds.y),
      };
    },
    [getBounds]
  );

  const commitView = useCallback(
    (nextScale: number, nextPosition: Point) => {
      const boundedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const boundedPosition =
        boundedScale === MIN_SCALE
          ? { x: 0, y: 0 }
          : clampPosition(nextPosition, boundedScale);

      scaleRef.current = boundedScale;
      positionRef.current = boundedPosition;
      setScale(boundedScale);
      setPosition(boundedPosition);
    },
    [clampPosition]
  );

  const resetView = useCallback(() => {
    commitView(MIN_SCALE, { x: 0, y: 0 });
    gestureRef.current = null;
    lastTapRef.current = null;
    pointersRef.current.clear();
    previewScaleRef.current = MIN_SCALE;
    setIsHovering(false);
    setIsInteracting(false);
  }, [commitView]);

  const positionForPoint = useCallback(
    (clientPoint: Point, nextScale: number): Point => {
      const stage = stageRef.current;
      if (!stage) return { x: 0, y: 0 };

      const rect = stage.getBoundingClientRect();
      const relativeX = clamp((clientPoint.x - rect.left) / rect.width, 0, 1);
      const relativeY = clamp((clientPoint.y - rect.top) / rect.height, 0, 1);
      const bounds = getBounds(nextScale);
      return clampPosition(
        {
          x: (0.5 - relativeX) * bounds.x * 2,
          y: (0.5 - relativeY) * bounds.y * 2,
        },
        nextScale
      );
    },
    [clampPosition, getBounds]
  );

  const setHoverView = useCallback(
    (point: Point, nextScale = previewScaleRef.current) => {
      hoverPointRef.current = point;
      const nextPosition = positionForPoint(point, nextScale);
      hoverPositionRef.current = nextPosition;
      setHoverPosition(nextPosition);
    },
    [positionForPoint]
  );

  const zoomAtPoint = useCallback(
    (nextScale: number, clientPoint?: Point) => {
      const currentScale = scaleRef.current;
      const boundedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (boundedScale > MIN_SCALE) onZoomIntent();
      if (boundedScale <= MIN_SCALE) {
        resetView();
        return;
      }

      const stage = stageRef.current;
      if (!stage || !clientPoint) {
        commitView(boundedScale, positionRef.current);
        return;
      }

      const rect = stage.getBoundingClientRect();
      const focalPoint = {
        x: clientPoint.x - (rect.left + rect.width / 2),
        y: clientPoint.y - (rect.top + rect.height / 2),
      };
      const ratio = boundedScale / currentScale;
      commitView(boundedScale, {
        x: focalPoint.x - ratio * (focalPoint.x - positionRef.current.x),
        y: focalPoint.y - ratio * (focalPoint.y - positionRef.current.y),
      });
    },
    [commitView, onZoomIntent, resetView]
  );

  const toggleZoom = useCallback(() => {
    if (scaleRef.current > MIN_SCALE) {
      resetView();
      return;
    }

    onZoomIntent();
    const nextScale =
      isHovering && previewScaleRef.current > MIN_SCALE
        ? previewScaleRef.current
        : TAP_SCALE;
    commitView(
      nextScale,
      isHovering
        ? positionForPoint(hoverPointRef.current, nextScale)
        : { x: 0, y: 0 }
    );
    setIsHovering(false);
    if (supportsHoverZoom()) {
      stageRef.current?.focus({ preventScroll: true });
    }
  }, [
    commitView,
    isHovering,
    onZoomIntent,
    positionForPoint,
    resetView,
  ]);

  useEffect(() => {
    const handleResize = () =>
      commitView(
        scaleRef.current,
        clampPosition(positionRef.current, scaleRef.current)
      );
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampPosition, commitView]);

  useEffect(() => {
    const handleKeyboardIntent = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        stageRef.current?.removeAttribute("data-focus-origin");
      }
    };

    window.addEventListener("keydown", handleKeyboardIntent, true);
    return () =>
      window.removeEventListener("keydown", handleKeyboardIntent, true);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      if (scaleRef.current <= MIN_SCALE) {
        if (!isHovering || (!event.ctrlKey && !event.metaKey)) return;
        event.preventDefault();
        onZoomIntent();
        const nextPreviewScale = clamp(
          previewScaleRef.current + (event.deltaY < 0 ? 0.25 : -0.25),
          MIN_SCALE,
          MAX_SCALE
        );
        previewScaleRef.current = nextPreviewScale;
        setHoverView(
          { x: event.clientX, y: event.clientY },
          nextPreviewScale
        );
        return;
      }
      event.preventDefault();
      zoomAtPoint(
        scaleRef.current + (event.deltaY < 0 ? 0.3 : -0.3),
        { x: event.clientX, y: event.clientY }
      );
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [isHovering, onZoomIntent, setHoverView, zoomAtPoint]);

  const handlePointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !supportsHoverZoom()) return;
    if (scaleRef.current > MIN_SCALE) return;

    onZoomIntent();
    previewScaleRef.current = MIN_SCALE;
    setHoverView({ x: event.clientX, y: event.clientY }, MIN_SCALE);
    setIsHovering(true);
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && pointersRef.current.size === 0) {
      previewScaleRef.current = MIN_SCALE;
      setHoverPosition({ x: 0, y: 0 });
      setIsHovering(false);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      event.currentTarget.dataset.focusOrigin = "pointer";
    }
    const point = { x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events used in regression tests cannot be captured.
    }
    pointersRef.current.set(event.pointerId, point);
    const points = [...pointersRef.current.values()];

    if (points.length === 1) {
      gestureRef.current = {
        moved: false,
        pointerType: event.pointerType,
        startDistance: 0,
        startMidpoint: point,
        startPoint: point,
        startPosition: positionRef.current,
        startScale: scaleRef.current,
        startedAt: event.timeStamp,
        usedMultiplePointers: false,
      };
      setIsInteracting(scaleRef.current > MIN_SCALE);
      return;
    }

    if (points.length === 2) {
      event.preventDefault();
      onZoomIntent();
      setIsHovering(false);
      setIsInteracting(true);
      gestureRef.current = {
        moved: false,
        pointerType: event.pointerType,
        startDistance: distanceBetween(points[0], points[1]),
        startMidpoint: midpointBetween(points[0], points[1]),
        startPoint: points[0],
        startPosition: positionRef.current,
        startScale: scaleRef.current,
        startedAt: event.timeStamp,
        usedMultiplePointers: true,
      };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = { x: event.clientX, y: event.clientY };
    const gesture = gestureRef.current;

    if (!pointersRef.current.has(event.pointerId) || !gesture) {
      if (
        event.pointerType === "mouse" &&
        supportsHoverZoom() &&
        scaleRef.current === MIN_SCALE
      ) {
        setHoverView(point);
      }
      return;
    }

    pointersRef.current.set(event.pointerId, point);
    const points = [...pointersRef.current.values()];

    if (points.length >= 2 && gesture.startDistance > 0) {
      event.preventDefault();
      const nextMidpoint = midpointBetween(points[0], points[1]);
      const nextScale = clamp(
        gesture.startScale *
          (distanceBetween(points[0], points[1]) / gesture.startDistance),
        MIN_SCALE,
        MAX_SCALE
      );
      const stage = stageRef.current;
      const stageCenter = stage
        ? {
            x: stage.getBoundingClientRect().left + stage.clientWidth / 2,
            y: stage.getBoundingClientRect().top + stage.clientHeight / 2,
          }
        : { x: 0, y: 0 };
      const ratio = nextScale / gesture.startScale;
      const focalPoint = {
        x: gesture.startMidpoint.x - stageCenter.x,
        y: gesture.startMidpoint.y - stageCenter.y,
      };

      gesture.moved = true;
      commitView(nextScale, {
        x:
          gesture.startPosition.x +
          (nextMidpoint.x - gesture.startMidpoint.x) -
          (focalPoint.x - gesture.startPosition.x) * (ratio - 1),
        y:
          gesture.startPosition.y +
          (nextMidpoint.y - gesture.startMidpoint.y) -
          (focalPoint.y - gesture.startPosition.y) * (ratio - 1),
      });
      return;
    }

    const deltaX = point.x - gesture.startPoint.x;
    const deltaY = point.y - gesture.startPoint.y;
    if (Math.hypot(deltaX, deltaY) > 6) gesture.moved = true;

    if (scaleRef.current > MIN_SCALE) {
      event.preventDefault();
      commitView(scaleRef.current, {
        x: gesture.startPosition.x + deltaX,
        y: gesture.startPosition.y + deltaY,
      });
    } else if (event.pointerType === "mouse") {
      setHoverView(point);
    }
  };

  const finishPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => {
    const gesture = gestureRef.current;
    const point = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);

    if (pointersRef.current.size > 0) {
      const remainingPoint = [...pointersRef.current.values()][0];
      gestureRef.current = {
        moved: true,
        pointerType: event.pointerType,
        startDistance: 0,
        startMidpoint: remainingPoint,
        startPoint: remainingPoint,
        startPosition: positionRef.current,
        startScale: scaleRef.current,
        startedAt: event.timeStamp,
        usedMultiplePointers: true,
      };
      return;
    }

    setIsInteracting(false);
    gestureRef.current = null;
    if (cancelled || !gesture || !point) return;

    if (gesture.usedMultiplePointers) {
      if (scaleRef.current <= 1.04) resetView();
      return;
    }

    const deltaX = point.x - gesture.startPoint.x;
    const deltaY = point.y - gesture.startPoint.y;
    const elapsed = Math.max(1, event.timeStamp - gesture.startedAt);
    const horizontalDistance = Math.abs(deltaX);
    const isSwipe =
      gesture.pointerType !== "mouse" &&
      scaleRef.current === MIN_SCALE &&
      horizontalDistance > 44 &&
      (horizontalDistance > 72 || horizontalDistance / elapsed > 0.18) &&
      horizontalDistance > Math.abs(deltaY) * 1.2;

    if (isSwipe) {
      lastTapRef.current = null;
      if (deltaX > 0) onPrevious();
      else onNext();
      return;
    }

    if (gesture.moved) return;

    if (gesture.pointerType === "mouse") {
      toggleZoom();
      return;
    }

    const previousTap = lastTapRef.current;
    const isDoubleTap =
      previousTap &&
      event.timeStamp - previousTap.at < 320 &&
      distanceBetween(previousTap.point, point) < 32;

    if (isDoubleTap) {
      event.preventDefault();
      lastTapRef.current = null;
      if (scaleRef.current > MIN_SCALE) resetView();
      else {
        onZoomIntent();
        commitView(TAP_SCALE, positionForPoint(point, TAP_SCALE));
      }
    } else {
      lastTapRef.current = { at: event.timeStamp, point };
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) =>
    finishPointer(event, false);
  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) =>
    finishPointer(event, true);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "0") {
      event.preventDefault();
      resetView();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleZoom();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAtPoint(scaleRef.current + 0.35);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAtPoint(scaleRef.current - 0.35);
    } else if (event.key === "ArrowLeft" && scaleRef.current === MIN_SCALE) {
      event.preventDefault();
      onPrevious();
    } else if (event.key === "ArrowRight" && scaleRef.current === MIN_SCALE) {
      event.preventDefault();
      onNext();
    }
  };

  const isHoverPreview =
    isHovering && scale === MIN_SCALE && previewScaleRef.current > MIN_SCALE;
  const displayScale = isHoverPreview ? previewScaleRef.current : scale;
  const displayPosition = isHoverPreview ? hoverPosition : position;
  const isZoomed = scale > MIN_SCALE;
  const coverSize =
    displayScale > MIN_SCALE ? getCoverSize() : getCachedCoverSize();
  const imageStyle: CSSProperties = coverSize
    ? {
        height: `${coverSize.height}px`,
        inset: "auto",
        left: "50%",
        maxHeight: "none",
        maxWidth: "none",
        top: "50%",
        transform: `translate(-50%, -50%) translate3d(${displayPosition.x}px, ${displayPosition.y}px, 0) scale(${displayScale})`,
        width: `${coverSize.width}px`,
      }
    : {
        transform: `translate3d(${displayPosition.x}px, ${displayPosition.y}px, 0) scale(${displayScale})`,
      };

  return {
    handleKeyDown,
    handlePointerCancel,
    handlePointerDown,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerMove,
    handlePointerUp,
    imageStyle,
    isHoverPreview,
    isInteracting,
    isZoomed,
    resetView,
    scale,
    stageRef,
    toggleZoom,
  };
}
