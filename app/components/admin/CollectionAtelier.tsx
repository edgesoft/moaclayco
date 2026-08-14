import {
  AnimatePresence,
  motion,
  useDragControls,
  useReducedMotion,
} from "framer-motion";
import {
  Link,
  useFetcher,
} from "react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { CollectionOrderActionData } from "~/routes/admin.collections.order";
import type { CollectionProps } from "~/types";
import ArrowIcon from "~/components/ArrowIcon";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import ViewportPortal from "~/components/ViewportPortal";

type SortableCollection = CollectionProps & { _id: string };
type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
type DragOverlayMetrics = {
  height: number;
  left: number;
  top: number;
  width: number;
};
type CollectionDragState = {
  cancelArmed: boolean;
  collectionId: string;
  overlay: DragOverlayMetrics | null;
};
type AtelierState = {
  errorMessage: string;
  orderedIds: string[];
  status: SaveStatus;
};

type AtelierAction =
  | { order: string[]; type: "order" }
  | { order: string[]; type: "drag-cancel" }
  | { type: "save-start" }
  | { order: string[]; type: "save-success" }
  | { error: string; order: string[]; type: "save-error" }
  | { type: "idle" };

function atelierReducer(
  state: AtelierState,
  action: AtelierAction
): AtelierState {
  switch (action.type) {
    case "order":
      return { ...state, orderedIds: action.order, status: "dirty" };
    case "drag-cancel":
      return {
        errorMessage: "",
        orderedIds: action.order,
        status: "idle",
      };
    case "save-start":
      return { ...state, errorMessage: "", status: "saving" };
    case "save-success":
      return {
        errorMessage: "",
        orderedIds: action.order,
        status: "saved",
      };
    case "save-error":
      return {
        errorMessage: action.error,
        orderedIds: action.order,
        status: "error",
      };
    case "idle":
      return { ...state, status: "idle" };
  }
}

const imageWithWidth = (image: string, width: number) =>
  `${image}${image.includes("?") ? "&" : "?"}width=${width}`;

function CornerArrowIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`mcc-atelier-corner-arrow${open ? " is-open" : ""}`}
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <path d="M15.25 15.25 4.75 4.75M4.75 12.75v-8h8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mcc-atelier-check-icon"
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <path d="m4.25 10.25 3.55 3.5 7.95-7.75" />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mcc-atelier-cancel-icon"
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

function CollectionPositionNumber({
  index,
  originIndex,
  reduceMotion,
}: {
  index: number;
  originIndex?: number;
  reduceMotion: boolean;
}) {
  return (
    <span
      aria-label={
        originIndex !== undefined && originIndex !== index
          ? `Ny position ${index + 1}, tidigare position ${originIndex + 1}`
          : `Position ${index + 1}`
      }
      className="mcc-atelier-collection__number"
    >
      <span className="mcc-atelier-collection__number-current">
        {String(index + 1).padStart(2, "0")}
      </span>
      <AnimatePresence initial={false}>
        {originIndex !== undefined && originIndex !== index ? (
          <motion.del
            animate={{ opacity: 0.58, y: 0 }}
            aria-hidden="true"
            className="mcc-atelier-collection__number-origin"
            exit={{ opacity: 0, y: -3 }}
            initial={{ opacity: 0, y: 3 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
          >
            {String(originIndex + 1).padStart(2, "0")}
          </motion.del>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

function SortableCollectionRow({
  collection,
  disabled,
  dragging,
  index,
  originIndex,
  onDragMove,
  onDragStart,
  onDrop,
}: {
  collection: SortableCollection;
  disabled: boolean;
  dragging: boolean;
  index: number;
  originIndex?: number;
  onDragMove: (
    collectionId: string,
    pointerX: number,
    pointerY: number
  ) => void;
  onDragStart: (collectionId: string, pointerY: number) => void;
  onDrop: (collectionId: string, pointerX: number, pointerY: number) => void;
}) {
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();
  const didDragRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const touchPointerIdRef = useRef<number | null>(null);
  const touchDragActiveRef = useRef(false);
  const touchGestureCleanupRef = useRef<() => void>(() => {});
  const [longPressReady, setLongPressReady] = useState(false);

  const cleanupTouchGesture = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchPointerIdRef.current = null;
    touchDragActiveRef.current = false;
    setLongPressReady(false);
    touchGestureCleanupRef.current();
    touchGestureCleanupRef.current = () => {};
  }, []);

  useEffect(
    () => () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      touchGestureCleanupRef.current();
    },
    []
  );

  const preventEditAfterDrag = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!didDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const startPointerDrag = (event: React.PointerEvent<HTMLLIElement>) => {
    if (disabled || event.button !== 0 || !event.isPrimary) return;

    if (event.pointerType !== "touch") {
      dragControls.start(event);
      return;
    }

    cleanupTouchGesture();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerDownEvent = event.nativeEvent;
    touchPointerIdRef.current = pointerId;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (
        moveEvent.pointerId !== pointerId ||
        touchDragActiveRef.current
      ) {
        return;
      }

      const movement = Math.hypot(
        moveEvent.clientX - startX,
        moveEvent.clientY - startY
      );
      if (movement > 10) cleanupTouchGesture();
    };
    const handlePointerFinish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      const preventedEdit = touchDragActiveRef.current;
      cleanupTouchGesture();
      if (preventedEdit) {
        window.setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      }
    };
    const preventNativeScrollWhileDragging = (moveEvent: TouchEvent) => {
      if (touchDragActiveRef.current && moveEvent.cancelable) {
        moveEvent.preventDefault();
      }
    };

    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: true,
    });
    window.addEventListener("pointerup", handlePointerFinish, {
      capture: true,
      passive: true,
    });
    window.addEventListener("pointercancel", handlePointerFinish, {
      capture: true,
      passive: true,
    });
    window.addEventListener("touchmove", preventNativeScrollWhileDragging, {
      capture: true,
      passive: false,
    });
    touchGestureCleanupRef.current = () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerFinish, true);
      window.removeEventListener("pointercancel", handlePointerFinish, true);
      window.removeEventListener(
        "touchmove",
        preventNativeScrollWhileDragging,
        true
      );
    };

    longPressTimerRef.current = window.setTimeout(() => {
      if (touchPointerIdRef.current !== pointerId) return;
      longPressTimerRef.current = null;
      touchDragActiveRef.current = true;
      didDragRef.current = true;
      setLongPressReady(true);
      window.navigator.vibrate?.(10);
      dragControls.start(pointerDownEvent, { distanceThreshold: 2 });
    }, 340);
  };

  return (
    <motion.li
      aria-label={`Dra för att flytta ${collection.headline}`}
      className={`mcc-atelier-collection${index < 2 ? " is-featured" : ""}${
        dragging ? " is-dragging" : ""
      }${longPressReady ? " is-long-press-ready" : ""}`}
      data-collection-id={collection._id}
      dragConstraints={{ bottom: 0, top: 0 }}
      dragControls={dragControls}
      dragElastic={0}
      dragListener={false}
      layout={reduceMotion || dragging ? undefined : "position"}
      drag="y"
      dragMomentum={false}
      onContextMenu={(event) => {
        if (touchPointerIdRef.current !== null) event.preventDefault();
      }}
      onDrag={(_event, info) =>
        onDragMove(
          collection._id,
          info.point.x - window.scrollX,
          info.point.y - window.scrollY
        )
      }
      onDragEnd={(_event, info) => {
        cleanupTouchGesture();
        onDrop(
          collection._id,
          info.point.x - window.scrollX,
          info.point.y - window.scrollY
        );
        window.setTimeout(() => {
          didDragRef.current = false;
        }, 0);
      }}
      onDragStart={(_event, info) => {
        didDragRef.current = true;
        onDragStart(collection._id, info.point.y - window.scrollY)
      }}
      onPointerDown={startPointerDrag}
      transition={{
        duration: reduceMotion ? 0 : 0.28,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <CollectionPositionNumber
        index={index}
        originIndex={originIndex}
        reduceMotion={Boolean(reduceMotion)}
      />
      <Link
        aria-label={`Redigera ${collection.headline}`}
        className="mcc-atelier-collection__edit"
        draggable={false}
        onClick={preventEditAfterDrag}
        to={`/collections/${collection.shortUrl}/edit`}
      >
        <span className="mcc-atelier-collection__media">
          <img
            alt=""
            decoding="async"
            draggable={false}
            loading={index > 5 ? "lazy" : "eager"}
            src={imageWithWidth(collection.image, 160)}
          />
        </span>
        <span className="mcc-atelier-collection__copy">
          <strong>{collection.headline}</strong>
          <small>{index < 2 ? "Startsidans blickfång" : "Redigera Collection"}</small>
        </span>
        <span className="mcc-atelier-collection__edit-arrow">
          <ArrowIcon direction="up-right" />
        </span>
      </Link>
    </motion.li>
  );
}

function CollectionDragOverlay({
  collection,
  index,
  deltaY,
  metrics,
  originIndex,
  overlayRef,
  reduceMotion,
}: {
  collection: SortableCollection;
  deltaY: number;
  index: number;
  metrics: DragOverlayMetrics;
  originIndex?: number;
  overlayRef: RefObject<HTMLDivElement | null>;
  reduceMotion: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`mcc-atelier-drag-overlay${
        index < 2 ? " is-featured" : ""
      }`}
      ref={overlayRef}
      style={{
        height: metrics.height,
        left: metrics.left,
        top: metrics.top,
        transform: `translate3d(0, ${deltaY}px, 0)`,
        width: metrics.width,
      }}
    >
      <CollectionPositionNumber
        index={index}
        originIndex={originIndex}
        reduceMotion={reduceMotion}
      />
      <span className="mcc-atelier-collection__edit">
        <span className="mcc-atelier-collection__media">
          <img
            alt=""
            decoding="async"
            src={imageWithWidth(collection.image, 160)}
          />
        </span>
        <span className="mcc-atelier-collection__copy">
          <strong>{collection.headline}</strong>
          <small>
            {index < 2 ? "Startsidans blickfång" : "Redigera Collection"}
          </small>
        </span>
        <span className="mcc-atelier-collection__edit-arrow">
          <ArrowIcon direction="up-right" />
        </span>
      </span>
    </div>
  );
}

export default function CollectionAtelier({
  collections,
}: {
  collections: CollectionProps[];
}) {
  const fetcher = useFetcher<CollectionOrderActionData>();
  const reduceMotion = useReducedMotion();
  const sortableCollections = useMemo(
    () =>
      collections.filter(
        (collection): collection is SortableCollection =>
          typeof collection._id === "string" && collection._id.length > 0
      ),
    [collections]
  );
  const collectionById = useMemo(
    () =>
      new Map(
        sortableCollections.map((collection) => [collection._id, collection])
      ),
    [sortableCollections]
  );
  const incomingIds = useMemo(
    () => sortableCollections.map((collection) => collection._id),
    [sortableCollections]
  );
  const [open, setOpen] = useState(false);
  const [dragState, setDragState] = useState<CollectionDragState | null>(null);
  const [{ errorMessage, orderedIds, status }, dispatch] = useReducer(
    atelierReducer,
    { errorMessage: "", orderedIds: incomingIds, status: "idle" }
  );
  const panelRef = useRef<HTMLElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const orderedIdsRef = useRef(incomingIds);
  const savedIdsRef = useRef(incomingIds);
  const dragStartOrderRef = useRef<string[] | null>(null);
  const draggingCollectionIdRef = useRef<string | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  const dragOverlayDeltaYRef = useRef(0);
  const dragPointerCenterOffsetRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const cancelActiveDragRef = useRef<() => void>(() => {});
  const updateLiveOrderRef = useRef<() => void>(() => {});
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollTimestampRef = useRef<number | null>(null);
  const dragStartPointerYRef = useRef<number | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const handledResponseRef = useRef<CollectionOrderActionData | undefined>(
    undefined
  );
  const isSaving = status === "saving" || fetcher.state !== "idle";

  const closePanel = useCallback((restoreFocus = true) => {
    if (draggingCollectionIdRef.current) {
      cancelActiveDragRef.current();
    }
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const runAutoScroll = useCallback(function scrollNearPanelEdge(
    timestamp: number
  ) {
    const scrollElement = panelScrollRef.current;
    const pointerY = dragPointerYRef.current;
    const startPointerY = dragStartPointerYRef.current;
    if (!scrollElement || pointerY === null || startPointerY === null) {
      autoScrollFrameRef.current = null;
      autoScrollTimestampRef.current = null;
      return;
    }

    const bounds = scrollElement.getBoundingClientRect();
    const stickyCreate = scrollElement.querySelector<HTMLElement>(
      ".mcc-atelier-new-sticky"
    );
    const stickyBounds = stickyCreate?.getBoundingClientRect();
    const stickyBottom = stickyBounds
      ? Math.min(bounds.bottom, Math.max(bounds.top, stickyBounds.bottom))
      : bounds.top;
    const edgeSize = Math.min(84, bounds.height * 0.16);
    const topEdge = Math.min(bounds.bottom, stickyBottom + edgeSize);
    const bottomSafeInset = 58;
    const bottomBoundary = Math.max(bounds.top, bounds.bottom - bottomSafeInset);
    const bottomEdge = Math.max(bounds.top, bottomBoundary - edgeSize);
    const deliberateDragThreshold = 56;
    const verticalDragDistance = pointerY - startPointerY;
    let scrollAmount = 0;

    if (
      !cancelArmedRef.current &&
      verticalDragDistance <= -deliberateDragThreshold &&
      pointerY < topEdge
    ) {
      const topZoneSize = Math.max(1, topEdge - bounds.top);
      const pressure = Math.min(
        1,
        Math.max(0, (topEdge - pointerY) / topZoneSize)
      );
      scrollAmount = -(0.55 + pressure * pressure * 3.85);
    } else if (
      !cancelArmedRef.current &&
      verticalDragDistance >= deliberateDragThreshold &&
      pointerY > bottomEdge
    ) {
      const bottomZoneSize = Math.max(1, bounds.bottom - bottomEdge);
      const pressure = Math.min(
        1,
        Math.max(0, (pointerY - bottomEdge) / bottomZoneSize)
      );
      scrollAmount = 0.45 + pressure * pressure * 3.25;
    }

    if (!scrollAmount) {
      autoScrollFrameRef.current = null;
      autoScrollTimestampRef.current = null;
      return;
    }

    if (scrollAmount) {
      const maxScrollTop = Math.max(
        0,
        scrollElement.scrollHeight - scrollElement.clientHeight
      );
      const reachedBoundary =
        (scrollAmount < 0 && scrollElement.scrollTop <= 0) ||
        (scrollAmount > 0 && scrollElement.scrollTop >= maxScrollTop);
      if (reachedBoundary) {
        autoScrollFrameRef.current = null;
        autoScrollTimestampRef.current = null;
        return;
      }

      const previousTimestamp = autoScrollTimestampRef.current;
      const frameScale = previousTimestamp
        ? Math.min(2, Math.max(0, (timestamp - previousTimestamp) / 16.67))
        : 0;
      const nextScrollTop = Math.min(
        maxScrollTop,
        Math.max(0, scrollElement.scrollTop + scrollAmount * frameScale)
      );
      scrollElement.scrollTop = nextScrollTop;
      updateLiveOrderRef.current();
    }
    autoScrollTimestampRef.current = timestamp;
    autoScrollFrameRef.current = window.requestAnimationFrame(
      scrollNearPanelEdge
    );
  }, []);

  const startAutoScroll = useCallback(
    (pointerY: number) => {
      dragStartPointerYRef.current = pointerY;
      dragPointerYRef.current = pointerY;
      panelScrollRef.current?.classList.add("is-sorting");
      if (autoScrollFrameRef.current === null) {
        autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
      }
    },
    [runAutoScroll]
  );

  const updateAutoScroll = useCallback(
    (pointerY: number) => {
      dragPointerYRef.current = pointerY;
      if (
        draggingCollectionIdRef.current &&
        autoScrollFrameRef.current === null
      ) {
        autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScroll);
      }
    },
    [runAutoScroll]
  );

  const stopAutoScroll = useCallback(() => {
    dragStartPointerYRef.current = null;
    dragPointerYRef.current = null;
    autoScrollTimestampRef.current = null;
    panelScrollRef.current?.classList.remove("is-sorting");
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const isCancelPoint = useCallback((pointerX: number, pointerY: number) => {
    const isMobile = window.innerWidth < 900;
    const insideMobileCorner =
      isMobile &&
      pointerX >= window.innerWidth - 120 &&
      pointerY >= window.innerHeight - 140;
    if (insideMobileCorner) return true;

    const triggerBounds = triggerRef.current?.getBoundingClientRect();
    const cancelPadding = isMobile ? 28 : 14;
    const insideCornerTarget = Boolean(
      triggerBounds &&
        pointerX >= triggerBounds.left - cancelPadding &&
        pointerX <= triggerBounds.right + cancelPadding &&
        pointerY >= triggerBounds.top - cancelPadding &&
        pointerY <= triggerBounds.bottom + cancelPadding
    );
    if (insideCornerTarget) return true;

    const panelBounds = panelRef.current?.getBoundingClientRect();
    if (!panelBounds || isMobile) return false;
    const outsidePadding = 12;
    return (
      pointerX < panelBounds.left - outsidePadding ||
      pointerX > panelBounds.right + outsidePadding ||
      pointerY < panelBounds.top - outsidePadding ||
      pointerY > panelBounds.bottom + outsidePadding
    );
  }, []);

  const cancelActiveDrag = useCallback(() => {
    stopAutoScroll();
    const originalOrder = dragStartOrderRef.current;
    if (originalOrder) {
      orderedIdsRef.current = originalOrder;
      dispatch({ order: originalOrder, type: "drag-cancel" });
    }
    cancelArmedRef.current = false;
    dragOverlayDeltaYRef.current = 0;
    dragStartOrderRef.current = null;
    draggingCollectionIdRef.current = null;
    setDragState(null);
  }, [stopAutoScroll]);

  useEffect(() => {
    cancelActiveDragRef.current = cancelActiveDrag;
  }, [cancelActiveDrag]);

  const updateLiveOrder = useCallback(
    (collectionId?: string, pointerY?: number) => {
      const activeCollectionId =
        collectionId ?? draggingCollectionIdRef.current;
      const activePointerY = pointerY ?? dragPointerYRef.current;
      const scrollElement = panelScrollRef.current;
      if (
        !activeCollectionId ||
        activePointerY === null ||
        activePointerY === undefined ||
        !scrollElement ||
        cancelArmedRef.current
      ) {
        return;
      }

      const rows = Array.from(
        scrollElement.querySelectorAll<HTMLElement>(
          ".mcc-atelier-collection[data-collection-id]"
        )
      );
      const remainingIds = orderedIdsRef.current.filter(
        (orderedId) => orderedId !== activeCollectionId
      );
      const draggedCenterY =
        activePointerY + dragPointerCenterOffsetRef.current;
      let insertionIndex = remainingIds.length;

      for (let index = 0; index < remainingIds.length; index += 1) {
        const row = rows.find(
          (candidate) =>
            candidate.dataset.collectionId === remainingIds[index]
        );
        const bounds = row?.getBoundingClientRect();
        if (bounds && draggedCenterY < bounds.top + bounds.height / 2) {
          insertionIndex = index;
          break;
        }
      }

      const nextOrder = [...remainingIds];
      nextOrder.splice(insertionIndex, 0, activeCollectionId);
      if (
        nextOrder.every(
          (orderedId, index) => orderedIdsRef.current[index] === orderedId
        )
      ) {
        return;
      }

      orderedIdsRef.current = nextOrder;
      dispatch({ order: nextOrder, type: "order" });
    },
    []
  );

  useEffect(() => {
    updateLiveOrderRef.current = () => updateLiveOrder();
  }, [updateLiveOrder]);

  const startCollectionDrag = useCallback(
    (collectionId: string, pointerY: number) => {
      const row = panelScrollRef.current?.querySelector<HTMLElement>(
        `.mcc-atelier-collection[data-collection-id="${collectionId}"]`
      );
      const bounds = row?.getBoundingClientRect();
      dragStartOrderRef.current = [...orderedIdsRef.current];
      draggingCollectionIdRef.current = collectionId;
      dragOverlayDeltaYRef.current = 0;
      dragPointerCenterOffsetRef.current = bounds
        ? bounds.top + bounds.height / 2 - pointerY
        : 0;
      cancelArmedRef.current = false;
      setDragState({
        cancelArmed: false,
        collectionId,
        overlay: bounds
          ? {
              height: bounds.height,
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
            }
          : null,
      });
      startAutoScroll(pointerY);
    },
    [startAutoScroll]
  );

  const updateCollectionDrag = useCallback(
    (collectionId: string, pointerX: number, pointerY: number) => {
      const startPointerY = dragStartPointerYRef.current;
      dragOverlayDeltaYRef.current = startPointerY !== null
        ? pointerY - startPointerY
        : 0;
      if (dragOverlayRef.current) {
        dragOverlayRef.current.style.transform = `translate3d(0, ${dragOverlayDeltaYRef.current}px, 0)`;
      }
      updateAutoScroll(pointerY);
      const cancelArmed = isCancelPoint(pointerX, pointerY);
      if (!cancelArmed) updateLiveOrder(collectionId, pointerY);
      if (cancelArmedRef.current === cancelArmed) return;
      cancelArmedRef.current = cancelArmed;
      setDragState((current) =>
        current ? { ...current, cancelArmed } : current
      );
    },
    [isCancelPoint, updateAutoScroll, updateLiveOrder]
  );

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  useEffect(() => {
    const response = fetcher.data;
    if (!response || handledResponseRef.current === response) return;
    handledResponseRef.current = response;

    if (response.ok) {
      savedIdsRef.current = response.order;
      orderedIdsRef.current = response.order;
      dispatch({ order: response.order, type: "save-success" });
      return;
    }

    orderedIdsRef.current = savedIdsRef.current;
    dispatch({
      error: response.error,
      order: savedIdsRef.current,
      type: "save-error",
    });
  }, [fetcher.data]);

  useEffect(() => {
    if (status !== "saved") return;
    const confirmationTimer = window.setTimeout(
      () => dispatch({ type: "idle" }),
      1_050
    );
    return () => window.clearTimeout(confirmationTimer);
  }, [status]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("mcc-atelier-open");
    window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (draggingCollectionIdRef.current) {
          cancelActiveDragRef.current();
          return;
        }
        closePanel();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("mcc-atelier-open");
    };
  }, [closePanel, open]);

  const commitOrder = useCallback(
    (order: string[]) => {
      if (
        isSaving ||
        order.length !== incomingIds.length ||
        order.every((collectionId, index) => savedIdsRef.current[index] === collectionId)
      ) {
        if (status === "dirty") dispatch({ type: "idle" });
        return;
      }

      dispatch({ type: "save-start" });
      fetcher.submit(
        { order: JSON.stringify(order) },
        { action: "/admin/collections/order", method: "post" }
      );
    },
    [fetcher, incomingIds.length, isSaving, status]
  );

  const finishReorder = useCallback(
    (collectionId: string, pointerX: number, pointerY: number) => {
      if (cancelArmedRef.current || isCancelPoint(pointerX, pointerY)) {
        cancelActiveDrag();
        return;
      }

      updateLiveOrder(collectionId, pointerY);
      stopAutoScroll();
      const nextOrder = [...orderedIdsRef.current];
      cancelArmedRef.current = false;
      dragOverlayDeltaYRef.current = 0;
      dragStartOrderRef.current = null;
      draggingCollectionIdRef.current = null;
      setDragState(null);
      dispatch({ order: nextOrder, type: "order" });
      commitOrder(nextOrder);
    },
    [
      cancelActiveDrag,
      commitOrder,
      isCancelPoint,
      stopAutoScroll,
      updateLiveOrder,
    ]
  );

  const statusCopy =
    dragState
      ? dragState.cancelArmed
        ? "Släpp i hörnet för att avbryta sorteringen."
        : "Dra raden till krysset i hörnet för att avbryta."
      : status === "saving"
      ? "Sparar ordningen…"
      : status === "saved"
        ? "Ordningen är sparad."
        : status === "error"
          ? errorMessage
          : status === "dirty"
            ? "Släpp raden för att spara."
            : "";

  const draggedCollection = dragState
    ? collectionById.get(dragState.collectionId)
    : undefined;
  const draggedIndex = dragState
    ? orderedIds.indexOf(dragState.collectionId)
    : -1;
  const draggedOriginIndex = dragState
    ? dragStartOrderRef.current?.indexOf(dragState.collectionId)
    : undefined;

  return (
    <ViewportPortal>
      <div className={`mcc-collection-atelier-root${open ? " is-open" : ""}`}>
        <AnimatePresence initial={false}>
          {open ? (
            <>
              <motion.button
                animate={{ opacity: 1 }}
                aria-label="Stäng Collection-verktyget"
                className="mcc-atelier-backdrop"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                onClick={() => closePanel()}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
                type="button"
              />
              <motion.section
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                aria-describedby="mcc-atelier-description"
                aria-labelledby="mcc-atelier-title"
                aria-modal="true"
                className="mcc-atelier-panel"
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.96, x: 18, y: 24 }
                }
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.94, x: 28, y: 34 }
                }
                ref={panelRef}
                role="dialog"
                tabIndex={-1}
                transition={{
                  duration: reduceMotion ? 0 : 0.34,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <motion.div
                  className="mcc-atelier-panel__scroll"
                  layoutScroll
                  ref={panelScrollRef}
                >
                  <header className="mcc-atelier-heading">
                    <div className="mcc-atelier-heading__topline">
                      <span>Ateljé / Collections</span>
                      <em>{String(collections.length).padStart(2, "0")} st</em>
                    </div>
                    <h2 id="mcc-atelier-title">Hantera Collections</h2>
                    <p id="mcc-atelier-description">
                      De två första blir startsidans blickfång.{" "}
                      <span className="mcc-atelier-instruction-desktop">
                        Ta tag i en rad för att ändra ordningen.
                      </span>
                      <span className="mcc-atelier-instruction-mobile">
                        Scrolla som vanligt. Håll fingret stilla på en rad för
                        att sortera.
                      </span>
                    </p>
                  </header>

                  <div className="mcc-atelier-new-sticky">
                    <Link className="mcc-atelier-new" to="/collections/new">
                      <span className="mcc-atelier-new__mark">
                        <PlusMinusIcon />
                      </span>
                      <span>
                        <small>Ny i ateljén</small>
                        <strong>Skapa en Collection</strong>
                      </span>
                      <ArrowIcon />
                    </Link>
                  </div>

                  <div className="mcc-atelier-order-heading">
                    <strong>Ordning</strong>
                  </div>

                  {orderedIds.length ? (
                    <motion.ul className="mcc-atelier-collection-list">
                      {orderedIds.map((collectionId, index) => {
                        const collection = collectionById.get(collectionId);
                        if (!collection) return null;
                        return (
                          <SortableCollectionRow
                            collection={collection}
                            disabled={isSaving}
                            dragging={dragState?.collectionId === collectionId}
                            index={index}
                            key={collectionId}
                            originIndex={
                              dragState?.collectionId === collectionId
                                ? dragStartOrderRef.current?.indexOf(collectionId)
                                : undefined
                            }
                            onDragMove={updateCollectionDrag}
                            onDragStart={startCollectionDrag}
                            onDrop={finishReorder}
                          />
                        );
                      })}
                    </motion.ul>
                  ) : (
                    <p className="mcc-atelier-empty">
                      Det finns inga Collections ännu. Börja med att skapa den
                      första.
                    </p>
                  )}
                </motion.div>

                <div
                  aria-live="polite"
                  className="mcc-visually-hidden"
                  role={status === "error" ? "alert" : "status"}
                >
                  <p>{statusCopy}</p>
                </div>
              </motion.section>
            </>
          ) : null}
        </AnimatePresence>

        {dragState?.overlay && draggedCollection && draggedIndex >= 0 ? (
          <CollectionDragOverlay
            collection={draggedCollection}
            deltaY={dragOverlayDeltaYRef.current}
            index={draggedIndex}
            metrics={dragState.overlay}
            originIndex={draggedOriginIndex}
            overlayRef={dragOverlayRef}
            reduceMotion={Boolean(reduceMotion)}
          />
        ) : null}

        <button
          aria-controls="mcc-atelier-title"
          aria-expanded={open}
          aria-label={
            dragState
              ? dragState.cancelArmed
                ? "Släpp här för att avbryta sorteringen"
                : "Avbryt sorteringen"
              : !open
              ? "Öppna Collection-verktyget"
              : status === "saving"
                ? "Sparar ordningen"
                : status === "saved"
                  ? "Ordningen är sparad. Stäng Collection-verktyget"
                  : "Stäng Collection-verktyget"
          }
          className={`mcc-atelier-trigger${
            dragState ? " is-drag-cancel" : ""
          }${dragState?.cancelArmed ? " is-cancel-armed" : ""}`}
          onClick={() => {
            if (dragState) {
              cancelActiveDrag();
              return;
            }
            if (open) closePanel(false);
            else setOpen(true);
          }}
          ref={triggerRef}
          type="button"
        >
          <span className="mcc-atelier-trigger__icons">
            <AnimatePresence initial={false} mode="wait">
              {dragState ? (
                <motion.span
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  className="mcc-atelier-trigger__icon-motion"
                  exit={{ opacity: 0, rotate: 150, scale: 0.68 }}
                  initial={{ opacity: 0, rotate: -150, scale: 0.68 }}
                  key="cancel-drag"
                  transition={{
                    duration: reduceMotion ? 0 : 0.24,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <CancelIcon />
                </motion.span>
              ) : open && status === "saved" ? (
                <motion.span
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  className="mcc-atelier-trigger__icon-motion"
                  exit={{ opacity: 0, rotate: 150, scale: 0.68 }}
                  initial={{ opacity: 0, rotate: -150, scale: 0.68 }}
                  key="save-confirmation"
                  transition={{
                    duration: reduceMotion ? 0 : 0.28,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <CheckIcon />
                </motion.span>
              ) : (
                <motion.span
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  className="mcc-atelier-trigger__icon-motion"
                  exit={{ opacity: 0, rotate: 150, scale: 0.68 }}
                  initial={{ opacity: 0, rotate: -150, scale: 0.68 }}
                  key="corner-arrow"
                  transition={{
                    duration: reduceMotion ? 0 : 0.28,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <CornerArrowIcon open={open} />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </button>
      </div>
    </ViewportPortal>
  );
}
