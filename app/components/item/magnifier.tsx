import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";

type MagnifierProps = {
  alt?: string;
  currentIndex: number;
  close: (p: string | undefined) => void;
  images: string[];
  onIndexChange: (index: number) => void;
};

type Point = { x: number; y: number };
type Position = Point;
type Gesture = {
  moved: boolean;
  startDistance: number;
  startMidpoint: Point;
  startPoint: Point;
  startPosition: Position;
  startScale: number;
  usedMultiplePointers: boolean;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const CLICK_ZOOM = 2.35;

const imageWithWidth = (image: string, width: number) =>
  `${image}${image.includes("?") ? "&" : "?"}width=${width}`;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const distanceBetween = (first: Point, second: Point) =>
  Math.hypot(second.x - first.x, second.y - first.y);

const midpointBetween = (first: Point, second: Point): Point => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

const Magnifier: React.FC<MagnifierProps> = ({
  alt = "Produktbild i större format",
  currentIndex,
  close,
  images,
  onIndexChange,
}): React.ReactElement | null => {
  const [isInteracting, setIsInteracting] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [scale, setScale] = useState(MIN_SCALE);
  const [stageSize, setStageSize] = useState<{
    height: number;
    width: number;
  } | null>(null);
  const [useOriginal, setUseOriginal] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const handledErrorRef = useRef<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const stageRef = useRef<HTMLDivElement>(null);
  const imageUrl = images[currentIndex];
  const canNavigate = images.length > 1;
  const isOpen = Boolean(imageUrl && portalNode);

  const updateStageSize = useCallback(() => {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image?.naturalWidth || !image.naturalHeight) return;

    const frameStyle = window.getComputedStyle(frame);
    const availableWidth =
      frame.clientWidth -
      Number.parseFloat(frameStyle.paddingLeft) -
      Number.parseFloat(frameStyle.paddingRight);
    const availableHeight =
      frame.clientHeight -
      Number.parseFloat(frameStyle.paddingTop) -
      Number.parseFloat(frameStyle.paddingBottom);
    const fitScale = Math.min(
      availableWidth / image.naturalWidth,
      availableHeight / image.naturalHeight
    );

    setStageSize({
      height: Math.round(image.naturalHeight * fitScale),
      width: Math.round(image.naturalWidth * fitScale),
    });
  }, []);

  const getPanBounds = useCallback((nextScale: number) => {
    const image = imageRef.current;
    const stage = stageRef.current;
    if (!image || !stage || !image.naturalWidth || !image.naturalHeight) {
      return { x: 0, y: 0 };
    }

    const stageRect = stage.getBoundingClientRect();
    const fitScale = Math.min(
      stageRect.width / image.naturalWidth,
      stageRect.height / image.naturalHeight
    );
    const renderedWidth = image.naturalWidth * fitScale;
    const renderedHeight = image.naturalHeight * fitScale;

    return {
      x: Math.max(0, (renderedWidth * nextScale - stageRect.width) / 2),
      y: Math.max(0, (renderedHeight * nextScale - stageRect.height) / 2),
    };
  }, []);

  const clampPosition = useCallback(
    (nextPosition: Position, nextScale: number): Position => {
      const bounds = getPanBounds(nextScale);
      return {
        x: clamp(nextPosition.x, -bounds.x, bounds.x),
        y: clamp(nextPosition.y, -bounds.y, bounds.y),
      };
    },
    [getPanBounds]
  );

  const setZoom = useCallback(
    (nextScale: number) => {
      const boundedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      setScale(boundedScale);
      setPosition((current) =>
        boundedScale === MIN_SCALE
          ? { x: 0, y: 0 }
          : clampPosition(current, boundedScale)
      );
    },
    [clampPosition]
  );

  const resetView = useCallback(() => {
    setScale(MIN_SCALE);
    setPosition({ x: 0, y: 0 });
    pointersRef.current.clear();
    gestureRef.current = null;
    setIsInteracting(false);
  }, []);

  const previousImage = useCallback(() => {
    if (!canNavigate) return;
    resetView();
    onIndexChange(currentIndex === 0 ? images.length - 1 : currentIndex - 1);
  }, [canNavigate, currentIndex, images.length, onIndexChange, resetView]);

  const nextImage = useCallback(() => {
    if (!canNavigate) return;
    resetView();
    onIndexChange((currentIndex + 1) % images.length);
  }, [canNavigate, currentIndex, images.length, onIndexChange, resetView]);

  useEffect(() => setPortalNode(document.body), []);

  useEffect(() => {
    setIsLoaded(false);
    setStageSize(null);
    setUseOriginal(false);
    handledErrorRef.current = null;
    resetView();
  }, [imageUrl, resetView]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus()
    );

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(undefined);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        previousImage();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nextImage();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom(scale + 0.5);
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom(scale - 0.5);
      } else if (event.key === "0") {
        event.preventDefault();
        resetView();
      } else if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable?.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, isOpen, nextImage, previousImage, resetView, scale, setZoom]);

  useEffect(() => {
    if (!isOpen) return;

    const onResize = () => {
      updateStageSize();
      setPosition((current) => clampPosition(current, scale));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPosition, isOpen, scale, updateStageSize]);

  const handleLoad = useCallback(() => {
    handledErrorRef.current = null;
    setIsLoaded(true);
    window.requestAnimationFrame(updateStageSize);
  }, [updateStageSize]);

  const handleError = useCallback(() => {
    if (!imageUrl) return;

    const failedSource = `${imageUrl}-${useOriginal ? "original" : "responsive"}`;
    if (handledErrorRef.current === failedSource) return;
    handledErrorRef.current = failedSource;
    setIsLoaded(false);

    if (!useOriginal) {
      setUseOriginal(true);
      return;
    }

    close(undefined);
  }, [close, imageUrl, useOriginal]);

  useEffect(() => {
    const image = imageRef.current;
    if (!imageUrl || !image?.complete) return;

    if (image.naturalWidth > 0) handleLoad();
    else handleError();
  }, [handleError, handleLoad, imageUrl]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    const points = [...pointersRef.current.values()];
    setIsInteracting(true);

    if (points.length === 1) {
      gestureRef.current = {
        moved: false,
        startDistance: 0,
        startMidpoint: point,
        startPoint: point,
        startPosition: position,
        startScale: scale,
        usedMultiplePointers: false,
      };
    } else if (points.length === 2) {
      gestureRef.current = {
        moved: false,
        startDistance: distanceBetween(points[0], points[1]),
        startMidpoint: midpointBetween(points[0], points[1]),
        startPoint: points[0],
        startPosition: position,
        startScale: scale,
        usedMultiplePointers: true,
      };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId) || !gestureRef.current) return;

    event.preventDefault();
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const points = [...pointersRef.current.values()];
    const gesture = gestureRef.current;

    if (points.length >= 2 && gesture.startDistance > 0) {
      const nextMidpoint = midpointBetween(points[0], points[1]);
      const nextScale = clamp(
        gesture.startScale *
          (distanceBetween(points[0], points[1]) / gesture.startDistance),
        MIN_SCALE,
        MAX_SCALE
      );
      const nextPosition = {
        x:
          gesture.startPosition.x +
          (nextMidpoint.x - gesture.startMidpoint.x),
        y:
          gesture.startPosition.y +
          (nextMidpoint.y - gesture.startMidpoint.y),
      };
      gesture.moved = true;
      setScale(nextScale);
      setPosition(
        nextScale === MIN_SCALE
          ? { x: 0, y: 0 }
          : clampPosition(nextPosition, nextScale)
      );
      return;
    }

    const deltaX = event.clientX - gesture.startPoint.x;
    const deltaY = event.clientY - gesture.startPoint.y;
    if (Math.hypot(deltaX, deltaY) > 5) gesture.moved = true;

    if (scale > MIN_SCALE) {
      setPosition(
        clampPosition(
          {
            x: gesture.startPosition.x + deltaX,
            y: gesture.startPosition.y + deltaY,
          },
          scale
        )
      );
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const point = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);

    if (pointersRef.current.size > 0) return;
    setIsInteracting(false);

    if (gesture && point && !gesture.usedMultiplePointers) {
      const deltaX = point.x - gesture.startPoint.x;
      const deltaY = point.y - gesture.startPoint.y;
      const isSwipe =
        scale === MIN_SCALE &&
        Math.abs(deltaX) > 64 &&
        Math.abs(deltaX) > Math.abs(deltaY) * 1.35;

      if (isSwipe) {
        if (deltaX > 0) previousImage();
        else nextImage();
      } else if (!gesture.moved) {
        setZoom(scale === MIN_SCALE ? CLICK_ZOOM : MIN_SCALE);
      }
    }

    gestureRef.current = null;
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom(scale + (event.deltaY < 0 ? 0.35 : -0.35));
  };

  if (!imageUrl || !portalNode) return null;

  const imageSource = useOriginal ? imageUrl : imageWithWidth(imageUrl, 2200);
  const zoomPercent = Math.round(scale * 100);

  return createPortal(
    <div
      aria-describedby="mcc-image-viewer-help"
      aria-label={alt}
      aria-modal="true"
      className={`mcc-image-viewer${scale > MIN_SCALE ? " is-zoomed" : ""}`}
      ref={dialogRef}
      role="dialog"
    >
      <button
        aria-label="Stäng stor bild"
        className="mcc-image-viewer__backdrop"
        onClick={() => close(undefined)}
        tabIndex={-1}
        type="button"
      />

      <div className="mcc-image-viewer__frame" ref={frameRef}>
        <div
          className={`mcc-image-viewer__stage${
            isInteracting ? " is-interacting" : ""
          }`}
          onPointerCancel={finishPointer}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onWheel={handleWheel}
          ref={stageRef}
          style={stageSize ?? undefined}
        >
          <img
            alt={alt}
            className={`mcc-image-viewer__image${
              isLoaded ? " is-loaded" : ""
            }`}
            draggable={false}
            key={useOriginal ? "original" : "responsive"}
            onError={handleError}
            onLoad={handleLoad}
            ref={imageRef}
            sizes="96vw"
            src={imageSource}
            style={{
              transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
            }}
          />
        </div>
      </div>

      <button
        aria-label="Stäng stor bild"
        className="mcc-image-viewer__close"
        onClick={() => close(undefined)}
        ref={closeButtonRef}
        type="button"
      >
        <span>Stäng</span>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m5 5 10 10M15 5 5 15" />
        </svg>
      </button>

      <p className="mcc-image-viewer__help" id="mcc-image-viewer-help">
        {scale === MIN_SCALE
          ? "Tryck, nyp eller scrolla för att zooma"
          : "Dra bilden för att utforska"}
      </p>

      <div className="mcc-image-viewer__toolbar">
        {canNavigate ? (
          <>
            <button
              aria-label="Föregående produktbild"
              onClick={previousImage}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
              </svg>
            </button>
            <span className="mcc-image-viewer__count">
              {String(currentIndex + 1).padStart(2, "0")} /{" "}
              {String(images.length).padStart(2, "0")}
            </span>
            <button
              aria-label="Nästa produktbild"
              onClick={nextImage}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
              </svg>
            </button>
            <span aria-hidden="true" className="mcc-image-viewer__divider" />
          </>
        ) : null}

        <button
          aria-label="Zooma ut"
          disabled={scale === MIN_SCALE}
          onClick={() => setZoom(scale - 0.5)}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M5 10h10" />
          </svg>
        </button>
        <button
          aria-label="Återställ zoom"
          className="mcc-image-viewer__zoom-level"
          disabled={scale === MIN_SCALE}
          onClick={resetView}
          type="button"
        >
          {zoomPercent}%
        </button>
        <button
          aria-label="Zooma in"
          disabled={scale === MAX_SCALE}
          onClick={() => setZoom(scale + 0.5)}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M5 10h10M10 5v10" />
          </svg>
        </button>
      </div>

      <span aria-live="polite" className="mcc-visually-hidden">
        Zoom {zoomPercent} procent
      </span>
    </div>,
    portalNode
  );
};

export default Magnifier;
