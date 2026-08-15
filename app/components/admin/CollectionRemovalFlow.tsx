import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useFetcher } from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowIcon from "~/components/ArrowIcon";
import { CollectionChoiceGrid } from "~/components/admin/CollectionChoiceGrid";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import ViewportPortal from "~/components/ViewportPortal";
import type { CollectionRemovalDecision } from "~/services/collection-removal.server";
import type { CollectionRemovalPlanData } from "~/routes/admin.collections.$collection.removal-plan";

type RemovalStage = "assign" | "review";

function DecisionCheck() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="m4.25 10.25 3.55 3.5 7.95-7.75" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

const imageWithWidth = (image: string, width: number) =>
  `${image}${image.includes("?") ? "&" : "?"}width=${width}`;

export default function CollectionRemovalFlow({
  collectionHeadline,
  collectionRef,
  disabled,
  error,
  isDeleting,
  itemCount,
}: {
  collectionHeadline: string;
  collectionRef: string;
  disabled: boolean;
  error?: string;
  isDeleting: boolean;
  itemCount: number;
}) {
  const fetcher = useFetcher<CollectionRemovalPlanData>();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<RemovalStage>("assign");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [visibleError, setVisibleError] = useState(error);
  const [decisions, setDecisions] = useState<
    Record<string, CollectionRemovalDecision>
  >({});
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasDeletingRef = useRef(isDeleting);
  const plan = fetcher.data;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setBulkOpen(false);
    setExpandedItemId(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const start = () => {
    if (disabled) return;
    setVisibleError(undefined);
    setDecisions({});
    setStage("assign");
    setExpandedItemId(null);
    setBulkOpen(false);
    setOpen(true);
    fetcher.load(`/admin/collections/${collectionRef}/removal-plan`);
  };

  useEffect(() => {
    if (wasDeletingRef.current && !isDeleting) {
      setVisibleError(error);
    } else if (!error) {
      setVisibleError(undefined);
    }
    wasDeletingRef.current = isDeleting;
  }, [error, isDeleting]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("mcc-removal-open");
    window.requestAnimationFrame(() => panelRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (expandedItemId || bulkOpen) {
          setExpandedItemId(null);
          setBulkOpen(false);
        } else {
          close();
        }
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
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
      document.body.classList.remove("mcc-removal-open");
    };
  }, [bulkOpen, close, expandedItemId, open]);

  const resolvedCount = plan
    ? plan.items.filter((item) => Boolean(decisions[item._id])).length
    : 0;
  const allResolved = Boolean(plan && resolvedCount === plan.items.length);
  const serializedPlan = useMemo(
    () =>
      JSON.stringify(
        plan?.items.flatMap((item) =>
          decisions[item._id] ? [decisions[item._id]] : []
        ) ?? []
      ),
    [decisions, plan?.items]
  );
  const reviewGroups = useMemo(() => {
    if (!plan) return [];
    const groups = new Map<
      string,
      { headline: string; items: CollectionRemovalPlanData["items"] }
    >();
    plan.items.forEach((item) => {
      const decision = decisions[item._id];
      if (!decision) return;
      const key =
        decision.action === "retire"
          ? "retire"
          : `move:${decision.targetCollectionRef}`;
      const headline =
        decision.action === "retire"
          ? "Tas bort från katalogen"
          : `Flyttas till ${
              plan.alternatives.find(
                (collection) =>
                  collection.shortUrl === decision.targetCollectionRef
              )?.headline ?? decision.targetCollectionRef
            }`;
      const group = groups.get(key) ?? { headline, items: [] };
      group.items.push(item);
      groups.set(key, group);
    });
    return [...groups.values()];
  }, [decisions, plan]);

  const assign = (
    itemId: string,
    decision:
      | { action: "move"; targetCollectionRef: string }
      | { action: "retire" }
  ) => {
    setDecisions((current) => ({
      ...current,
      [itemId]: { ...decision, itemId } as CollectionRemovalDecision,
    }));
    setExpandedItemId(null);
  };

  return (
    <>
      <button
        aria-label={
          itemCount
            ? `Ta bort ${collectionHeadline} och hantera ${itemCount} ${
                itemCount === 1 ? "produkt" : "produkter"
              }`
            : `Ta bort ${collectionHeadline}`
        }
        disabled={disabled}
        onClick={start}
        ref={triggerRef}
        type="button"
      >
        Ta bort Collection
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <ViewportPortal>
            <div className="mcc-removal-root">
              <motion.button
                animate={{ opacity: 1 }}
                aria-label="Stäng borttagningen"
                className="mcc-removal-backdrop"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                onClick={() => close()}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
                type="button"
              />
              <motion.section
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                aria-labelledby="mcc-removal-title"
                aria-modal="true"
                className="mcc-removal-panel"
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.97, x: 20, y: 26 }
                }
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.96, x: 24, y: 30 }
                }
                ref={panelRef}
                role="dialog"
                tabIndex={-1}
                transition={{
                  duration: reduceMotion ? 0 : 0.32,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="mcc-removal-scroll">
                  <header className="mcc-removal-heading">
                    <div className="mcc-removal-heading__topline">
                      <span>Ateljé / Collection</span>
                      <button
                        aria-label="Stäng borttagningen"
                        onClick={() => close()}
                        type="button"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                    <p>{stage === "assign" ? "Steg 1 av 2" : "Steg 2 av 2"}</p>
                    <h2 id="mcc-removal-title">
                      {stage === "assign"
                        ? `Fördela ${collectionHeadline}`
                        : `Ta bort ${collectionHeadline}`}
                    </h2>
                    <span>
                      {stage === "assign"
                        ? "Välj en ny Collection eller ta bort produkten från katalogen."
                        : "Kontrollera flyttarna innan Collectionen tas bort."}
                    </span>
                  </header>

                  {fetcher.state !== "idle" && !plan ? (
                    <div aria-live="polite" className="mcc-removal-loading">
                      <span />
                      <strong>Hämtar produkter och Collections…</strong>
                    </div>
                  ) : plan && stage === "assign" ? (
                    <>
                      <div className="mcc-removal-progress">
                        <div>
                          <span
                            style={{
                              width: plan.items.length
                                ? `${(resolvedCount / plan.items.length) * 100}%`
                                : "100%",
                            }}
                          />
                        </div>
                        <p aria-live="polite">
                          {resolvedCount} av {plan.items.length} klara
                        </p>
                      </div>

                      {plan.alternatives.length && plan.items.length > 1 ? (
                        <section className="mcc-removal-bulk">
                          <button
                            aria-expanded={bulkOpen}
                            onClick={() => {
                              setBulkOpen((current) => !current);
                              setExpandedItemId(null);
                            }}
                            type="button"
                          >
                            <span className="mcc-removal-bulk__mark">
                              <PlusMinusIcon operation={bulkOpen ? "minus" : "plus"} />
                            </span>
                            <span>
                              <small>Snabbval</small>
                              <strong>Flytta alla produkter</strong>
                            </span>
                          </button>
                          <AnimatePresence initial={false}>
                            {bulkOpen ? (
                              <motion.div
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                initial={
                                  reduceMotion
                                    ? false
                                    : { height: 0, opacity: 0 }
                                }
                                transition={{
                                  duration: reduceMotion ? 0 : 0.25,
                                  ease: [0.22, 1, 0.36, 1],
                                }}
                              >
                                <div className="mcc-removal-bulk__choices">
                                  <CollectionChoiceGrid
                                    collections={plan.alternatives}
                                    label="Flytta alla produkter till"
                                    onSelect={(targetCollectionRef) => {
                                      setDecisions(
                                        Object.fromEntries(
                                          plan.items.map((item) => [
                                            item._id,
                                            {
                                              action: "move",
                                              itemId: item._id,
                                              targetCollectionRef,
                                            } satisfies CollectionRemovalDecision,
                                          ])
                                        )
                                      );
                                      setBulkOpen(false);
                                    }}
                                  />
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </section>
                      ) : null}

                      <ol className="mcc-removal-product-list">
                        {plan.items.map((item, index) => {
                          const decision = decisions[item._id];
                          const destination =
                            decision?.action === "move"
                              ? plan.alternatives.find(
                                  (collection) =>
                                    collection.shortUrl ===
                                    decision.targetCollectionRef
                                )
                              : undefined;
                          const expanded = expandedItemId === item._id;
                          return (
                            <motion.li
                              animate={{ opacity: 1, y: 0 }}
                              className={`${decision ? "is-resolved" : ""}${
                                expanded ? " is-expanded" : ""
                              }`}
                              initial={
                                reduceMotion ? false : { opacity: 0, y: 12 }
                              }
                              key={item._id}
                              transition={{
                                delay: reduceMotion ? 0 : index * 0.04,
                                duration: reduceMotion ? 0 : 0.28,
                              }}
                            >
                              <button
                                aria-expanded={expanded}
                                className="mcc-removal-product"
                                onClick={() => {
                                  setExpandedItemId(expanded ? null : item._id);
                                  setBulkOpen(false);
                                }}
                                type="button"
                              >
                                <span className="mcc-removal-product__status">
                                  {decision ? <DecisionCheck /> : null}
                                </span>
                                <span className="mcc-removal-product__media">
                                  {item.image ? (
                                    <img
                                      alt=""
                                      decoding="async"
                                      loading={index > 4 ? "lazy" : "eager"}
                                      src={imageWithWidth(item.image, 180)}
                                    />
                                  ) : null}
                                </span>
                                <span className="mcc-removal-product__copy">
                                  <strong>{item.headline}</strong>
                                  <small>
                                    {item.amount} i lager · {item.price} SEK
                                  </small>
                                </span>
                                <span className="mcc-removal-product__decision">
                                  <strong>
                                    {decision?.action === "retire"
                                      ? "Tas bort"
                                      : destination?.headline ?? "Välj Collection"}
                                  </strong>
                                  <small>
                                    {decision?.action === "retire"
                                      ? "Från katalogen"
                                      : destination
                                        ? "Flyttas hit"
                                        : "Öppna val"}
                                  </small>
                                </span>
                              </button>

                              <AnimatePresence initial={false}>
                                {expanded ? (
                                  <motion.div
                                    animate={{ height: "auto", opacity: 1 }}
                                    className="mcc-removal-product-choices"
                                    exit={{ height: 0, opacity: 0 }}
                                    initial={
                                      reduceMotion
                                        ? false
                                        : { height: 0, opacity: 0 }
                                    }
                                    transition={{
                                      duration: reduceMotion ? 0 : 0.27,
                                      ease: [0.22, 1, 0.36, 1],
                                    }}
                                  >
                                    <div className="mcc-removal-product-choices__inner">
                                      <p>Flytta {item.headline} till</p>
                                      <CollectionChoiceGrid
                                        collections={plan.alternatives}
                                        label={`Flytta ${item.headline} till`}
                                        onSelect={(targetCollectionRef) =>
                                          assign(item._id, {
                                            action: "move",
                                            targetCollectionRef,
                                          })
                                        }
                                        selectedRef={
                                          decision?.action === "move"
                                            ? decision.targetCollectionRef
                                            : undefined
                                        }
                                      />
                                      <div className="mcc-removal-retire-choice">
                                        <button
                                          aria-pressed={
                                            decision?.action === "retire"
                                          }
                                          className={
                                            decision?.action === "retire"
                                              ? "is-selected"
                                              : undefined
                                          }
                                          onClick={() =>
                                            assign(item._id, { action: "retire" })
                                          }
                                          type="button"
                                        >
                                          <span className="mcc-removal-retire-choice__copy">
                                            <small>Alternativ till flytt</small>
                                            <strong>
                                              Ta bort produkten från katalogen
                                            </strong>
                                            <span>
                                              {item.activeOrderCount
                                                ? `${item.activeOrderCount} pågående ${
                                                    item.activeOrderCount === 1
                                                      ? "betalning kan"
                                                      : "betalningar kan"
                                                  } fortfarande slutföras.`
                                                : item.orderCount
                                                  ? `Orderhistorik från ${item.orderCount} ${
                                                      item.orderCount === 1
                                                        ? "order"
                                                        : "ordrar"
                                                    } bevaras.`
                                                  : "Produkten försvinner från butiken."}
                                            </span>
                                          </span>
                                          <span className="mcc-removal-retire-choice__mark">
                                            {decision?.action === "retire" ? (
                                              <DecisionCheck />
                                            ) : (
                                              <ArrowIcon />
                                            )}
                                          </span>
                                        </button>
                                      </div>
                                    </div>
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>
                            </motion.li>
                          );
                        })}
                      </ol>

                      <div className="mcc-removal-actions">
                        <p>
                          {allResolved
                            ? "Alla produkter har ett beslut."
                            : `${plan.items.length - resolvedCount} ${
                                plan.items.length - resolvedCount === 1
                                  ? "produkt behöver"
                                  : "produkter behöver"
                              } ett beslut.`}
                        </p>
                        <div>
                          <button onClick={() => close()} type="button">
                            Avbryt
                          </button>
                          <button
                            disabled={!allResolved}
                            onClick={() => {
                              setExpandedItemId(null);
                              setBulkOpen(false);
                              setStage("review");
                              panelRef.current
                                ?.querySelector<HTMLElement>(".mcc-removal-scroll")
                                ?.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            type="button"
                          >
                            Granska borttagning
                          </button>
                        </div>
                      </div>
                    </>
                  ) : plan && stage === "review" ? (
                    <div className="mcc-removal-review">
                      {plan.items.length ? (
                        <div className="mcc-removal-review__groups">
                          {reviewGroups.map((group, index) => (
                            <motion.section
                              animate={{ opacity: 1, y: 0 }}
                              initial={
                                reduceMotion ? false : { opacity: 0, y: 10 }
                              }
                              key={group.headline}
                              transition={{
                                delay: reduceMotion ? 0 : index * 0.05,
                              }}
                            >
                              <span>{String(index + 1).padStart(2, "0")}</span>
                              <div>
                                <h3>{group.headline}</h3>
                                <p>
                                  {group.items.map((item) => item.headline).join(", ")}
                                </p>
                              </div>
                              <strong>{group.items.length}</strong>
                            </motion.section>
                          ))}
                        </div>
                      ) : (
                        <p className="mcc-removal-review__empty">
                          {collectionHeadline} innehåller inga produkter och kan
                          tas bort direkt.
                        </p>
                      )}

                      <section className="mcc-removal-final">
                        <p className="mcc-editor-eyebrow">Slutligt steg</p>
                        <h3>Ta bort {collectionHeadline}</h3>
                        <p>
                          Flyttade produkter behåller sina bilder. Produkter som
                          tas bort arkiveras så att orderhistoriken förblir hel.
                          Efteråt kan hela borttagningen ångras i 10 sekunder.
                        </p>
                        {visibleError ? (
                          <div className="mcc-removal-submit-error" role="alert">
                            <span>
                              <strong>Borttagningen pausades.</strong>
                              {visibleError}
                            </span>
                          </div>
                        ) : null}
                        <input
                          form="mcc-collection-editor-form"
                          name="removalPlan"
                          type="hidden"
                          value={serializedPlan}
                        />
                        <div className="mcc-removal-final__actions">
                          {visibleError ? (
                            <button onClick={start} type="button">
                              Uppdatera underlag
                            </button>
                          ) : (
                            <>
                              {plan.items.length ? (
                                <button
                                  disabled={isDeleting}
                                  onClick={() => setStage("assign")}
                                  type="button"
                                >
                                  Ändra fördelning
                                </button>
                              ) : (
                                <button
                                  disabled={isDeleting}
                                  onClick={() => close()}
                                  type="button"
                                >
                                  Avbryt
                                </button>
                              )}
                              <button
                                disabled={isDeleting}
                                form="mcc-collection-editor-form"
                                formNoValidate
                                name="intent"
                                type="submit"
                                value="delete"
                              >
                                {isDeleting
                                  ? "Genomför…"
                                  : plan.items.length
                                    ? `Flytta och ta bort ${collectionHeadline}`
                                    : `Ta bort ${collectionHeadline}`}
                              </button>
                            </>
                          )}
                        </div>
                      </section>
                    </div>
                  ) : (
                    <div className="mcc-removal-loading" role="alert">
                      <strong>Underlaget kunde inte hämtas.</strong>
                      <button onClick={start} type="button">Försök igen</button>
                    </div>
                  )}
                </div>
              </motion.section>
            </div>
          </ViewportPortal>
        ) : null}
      </AnimatePresence>
    </>
  );
}
