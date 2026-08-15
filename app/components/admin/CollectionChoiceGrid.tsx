import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import ArrowIcon from "~/components/ArrowIcon";
import type { CollectionProps } from "~/types";

export type CollectionChoice = Pick<
  CollectionProps,
  "_id" | "headline" | "image" | "shortUrl"
> & {
  itemCount?: number;
};

const imageWithWidth = (image: string, width: number) =>
  `${image}${image.includes("?") ? "&" : "?"}width=${width}`;

function ChoiceCheck() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="m4.25 10.25 3.55 3.5 7.95-7.75" />
    </svg>
  );
}

export function CollectionChoiceGrid({
  collections,
  currentRef,
  label,
  onSelect,
  selectedRef,
}: {
  collections: CollectionChoice[];
  currentRef?: string;
  label: string;
  onSelect: (collectionRef: string) => void;
  selectedRef?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (!collections.length) {
    return (
      <p className="mcc-collection-choice-empty">
        Det finns ingen annan Collection att välja ännu.
      </p>
    );
  }

  return (
    <div aria-label={label} className="mcc-collection-choice-grid">
      {collections.map((collection, index) => {
        const selected = collection.shortUrl === selectedRef;
        const current = collection.shortUrl === currentRef;
        return (
          <motion.button
            animate={{ opacity: 1, y: 0 }}
            aria-pressed={selected}
            className={`mcc-collection-choice${selected ? " is-selected" : ""}`}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            key={collection._id ?? collection.shortUrl}
            onClick={() => onSelect(collection.shortUrl)}
            transition={{
              delay: reduceMotion ? 0 : Math.min(index, 6) * 0.035,
              duration: reduceMotion ? 0 : 0.24,
              ease: [0.22, 1, 0.36, 1],
            }}
            type="button"
          >
            <span className="mcc-collection-choice__media">
              {collection.image ? (
                <img
                  alt=""
                  decoding="async"
                  loading={index > 5 ? "lazy" : "eager"}
                  src={imageWithWidth(collection.image, 220)}
                />
              ) : null}
            </span>
            <span className="mcc-collection-choice__copy">
              <strong>{collection.headline}</strong>
              <small>
                {current
                  ? "Nuvarande Collection"
                  : collection.itemCount !== undefined
                    ? `${collection.itemCount} ${
                        collection.itemCount === 1 ? "produkt" : "produkter"
                      }`
                    : "Flytta hit"}
              </small>
            </span>
            <span className="mcc-collection-choice__mark">
              {selected ? <ChoiceCheck /> : <ArrowIcon />}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

export function CollectionPickerField({
  collections,
  currentRef,
  error,
  onChange,
}: {
  collections: CollectionChoice[];
  currentRef: string;
  error?: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedRef, setSelectedRef] = useState(currentRef);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const selectedCollection = useMemo(
    () =>
      collections.find((collection) => collection.shortUrl === selectedRef) ??
      collections.find((collection) => collection.shortUrl === currentRef),
    [collections, currentRef, selectedRef]
  );

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  return (
    <div className="mcc-editor-field mcc-editor-field--wide" ref={rootRef}>
      <span>Collection <b>*</b></span>
      <button
        aria-expanded={open}
        className="mcc-collection-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="mcc-collection-picker-trigger__media">
          {selectedCollection?.image ? (
            <img alt="" src={imageWithWidth(selectedCollection.image, 140)} />
          ) : null}
        </span>
        <span>
          <small>
            {selectedRef === currentRef ? "Nuvarande Collection" : "Flyttas till"}
          </small>
          <strong>{selectedCollection?.headline ?? "Välj Collection"}</strong>
        </span>
        <span
          aria-hidden="true"
          className={`mcc-collection-picker-trigger__arrow${open ? " is-open" : ""}`}
        >
          <ArrowIcon />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="mcc-collection-picker-panel"
            exit={{ height: 0, opacity: 0 }}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            transition={{
              duration: reduceMotion ? 0 : 0.26,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="mcc-collection-picker-panel__inner">
              <p>Välj var produkten ska visas</p>
              <CollectionChoiceGrid
                collections={collections}
                currentRef={currentRef}
                label="Välj Collection för produkten"
                onSelect={(collectionRef) => {
                  setSelectedRef(collectionRef);
                  setOpen(false);
                  onChange();
                }}
                selectedRef={selectedRef}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <input name="collectionRef" type="hidden" value={selectedRef} />
      {error ? <small>{error}</small> : null}
      {selectedRef !== currentRef ? (
        <small className="mcc-editor-field__hint">
          Flytten genomförs när du sparar produkten.
        </small>
      ) : null}
    </div>
  );
}
