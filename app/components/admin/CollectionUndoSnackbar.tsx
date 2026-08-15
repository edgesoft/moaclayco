import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  useFetcher,
  useLocation,
  useNavigate,
} from "react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import ViewportPortal from "~/components/ViewportPortal";
import { COLLECTION_REMOVAL_UNDO_WINDOW_MS } from "~/utils/collectionRemoval.shared";

type UndoActionData = {
  error?: string;
};

function UndoIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M9 8 5 12l4 4" />
      <path d="M6 12h7.25a5.25 5.25 0 0 1 5.25 5.25V18" />
    </svg>
  );
}

export default function CollectionUndoSnackbar() {
  const fetcher = useFetcher<UndoActionData>();
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const operationId = params.get("collectionUndo") ?? "";
  const label = params.get("undoLabel")?.trim() || "Collectionen";
  const undoUntil = Number(params.get("undoUntil"));
  const [now, setNow] = useState(() => Date.now());

  const clearUndoParams = useCallback(() => {
    const next = new URLSearchParams(location.search);
    next.delete("collectionUndo");
    next.delete("undoLabel");
    next.delete("undoUntil");
    void navigate(
      {
        pathname: location.pathname,
        search: next.size ? `?${next.toString()}` : "",
        hash: location.hash,
      },
      { preventScrollReset: true, replace: true }
    );
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!operationId || !Number.isFinite(undoUntil)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [operationId, undoUntil]);

  const remainingMs = Math.max(0, undoUntil - now);
  useEffect(() => {
    if (!operationId || remainingMs > 0 || fetcher.state !== "idle") return;
    const timer = window.setTimeout(clearUndoParams, reduceMotion ? 0 : 220);
    return () => window.clearTimeout(timer);
  }, [
    clearUndoParams,
    fetcher.state,
    operationId,
    reduceMotion,
    remainingMs,
  ]);

  if (!operationId || !Number.isFinite(undoUntil)) return null;

  const error = fetcher.data?.error;
  const visible = remainingMs > 0 || fetcher.state !== "idle";
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const progress = Math.min(
    100,
    (remainingMs / COLLECTION_REMOVAL_UNDO_WINDOW_MS) * 100
  );

  return (
    <ViewportPortal>
      <AnimatePresence initial={false}>
        {visible ? (
          <motion.aside
            animate={{ opacity: 1, scale: 1, x: "-50%", y: 0 }}
            aria-label="Ångra borttagning"
            className={`mcc-undo-snackbar${error ? " has-error" : ""}`}
            exit={{ opacity: 0, scale: 0.98, x: "-50%", y: 14 }}
            initial={
              reduceMotion
                ? { x: "-50%" }
                : { opacity: 0, scale: 0.98, x: "-50%", y: 18 }
            }
            transition={{
              duration: reduceMotion ? 0 : 0.28,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <span className="mcc-undo-snackbar__icon">
              <UndoIcon />
            </span>
            <p aria-live="polite">
              <small>{error ? "Kunde inte återställa" : "Collection borttagen"}</small>
              <strong>{error ?? `${label} kan återställas`}</strong>
            </p>
            {error ? (
              <button onClick={clearUndoParams} type="button">
                Stäng
              </button>
            ) : (
              <button
                disabled={fetcher.state !== "idle" || remainingMs <= 0}
                onClick={() =>
                  fetcher.submit(null, {
                    action: `/admin/catalog-undo/${operationId}`,
                    method: "post",
                  })
                }
                type="button"
              >
                <span>{fetcher.state === "idle" ? "Ångra" : "Återställer…"}</span>
                {fetcher.state === "idle" ? <small>{seconds} s</small> : null}
              </button>
            )}
            <span className="mcc-undo-snackbar__progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </ViewportPortal>
  );
}
