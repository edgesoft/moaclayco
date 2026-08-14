import type {
  HeadersFunction,
  LoaderFunction,
  MetaFunction,
} from "react-router";
import {
  data as json,
  Link,
  redirect,
  useLoaderData,
  useNavigate,
  useNavigation,
  useOutletContext,
} from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "react-use-cart";
import ArrowIcon from "~/components/ArrowIcon";
import Loader from "~/components/loader";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import { useInlineImageZoom } from "~/hooks/useInlineImageZoom";
import type { IndexProps } from "~/root";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import type { CollectionProps, ItemProps } from "~/types";
import { toLoaderData } from "~/utils/loaderData";
import {
  collectionDetailProjection,
  collectionItemProjection,
} from "~/utils/queryProjections.server";
import {
  catalogCacheKeys,
  readCatalogCache,
} from "~/services/catalog-cache.server";
import {
  formatServerTiming,
  measureServerTiming,
  type ServerTimingMetric,
} from "~/utils/serverTiming.server";
import { mergePrivateRouteHeaders } from "~/utils/responseHeaders";

type ItemLoaderProps = {
  collection: CollectionProps;
  items: ItemProps[];
};

const imageWithWidth = (image: string, width: number) =>
  `${image}${image.includes("?") ? "&" : "?"}width=${width}`;

export const loader: LoaderFunction = async ({ params }) => {
  const timings: ServerTimingMetric[] = [];
  let catalogCacheStatus = "miss";
  const catalogData = await measureServerTiming(
    timings,
    "collection-catalog",
    () =>
      readCatalogCache(
        catalogCacheKeys.collection(params.collection ?? "missing"),
        async () => {
          const [collection, items] = await Promise.all([
            Collections.findOne({
              shortUrl: params.collection,
            })
              .select(collectionDetailProjection)
              .lean()
              .exec(),
            Items.find({
              collectionRef: params.collection,
            })
              .select(collectionItemProjection)
              .sort({ _id: -1 })
              .lean(),
          ]);
          return collection ? toLoaderData({ collection, items }) : null;
        },
        { onStatus: (status) => (catalogCacheStatus = status) }
      ),
    "collection and items"
  );

  if (!catalogData) return redirect("/");
  timings.push({
    description: catalogCacheStatus,
    duration: 0,
    name: "collection-cache",
  });

  return json(
    catalogData,
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": formatServerTiming(timings),
      },
    }
  );
};

export const headers: HeadersFunction = ({ parentHeaders, loaderHeaders }) =>
  mergePrivateRouteHeaders(parentHeaders, loaderHeaders);

export const meta: MetaFunction = ({ loaderData }) => {
  const { collection } = loaderData as ItemLoaderProps;
  const socialImage = imageWithWidth(collection.image, 1200);

  return [
    { title: `${collection.headline} — Moa Clay Co` },
    { name: "description", content: collection.shortDescription },
    { property: "twitter:image", content: socialImage },
    { property: "og:image", content: socialImage },
  ];
};

function Product({
  collectionTitle,
  featured,
  item,
  position,
  user,
}: {
  collectionTitle: string;
  featured: boolean;
  item: ItemProps;
  position: number;
  user: IndexProps["user"];
}) {
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [unoptimizedImages, setUnoptimizedImages] = useState<string[]>([]);
  const images = useMemo(
    () =>
      (item.images ?? []).filter(
        (image): image is string =>
          Boolean(image) && !failedImages.includes(image)
      ),
    [failedImages, item.images]
  );
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [detailImage, setDetailImage] = useState<string>();
  const [preloadDirection, setPreloadDirection] = useState<1 | -1>(1);
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  const [nearViewport, setNearViewport] = useState(position < 2);
  const [selectedAdditions, setSelectedAdditions] = useState<number[]>([]);
  const [additionGlowKey, setAdditionGlowKey] = useState(0);
  const [added, setAdded] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const cachedImageFrameRef = useRef<number | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const handledErrorAttemptRef = useRef<string | null>(null);
  const preloadRef = useRef<HTMLImageElement[]>([]);
  const resetInlineZoomRef = useRef<() => void>(() => undefined);
  const retryCountsRef = useRef<Map<string, number>>(new Map());
  const retryTimeoutRef = useRef<number | undefined>(undefined);
  const { addItem, getItem } = useCart();
  const reduceMotion = useReducedMotion();
  const currentIndex = Math.min(
    selectedImageIndex,
    Math.max(0, images.length - 1)
  );
  const activeImage = images[currentIndex];
  const useOriginalImage = activeImage
    ? unoptimizedImages.includes(activeImage)
    : false;

  useEffect(() => {
    if (nearViewport || !articleRef.current) return;

    if (!("IntersectionObserver" in window)) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "520px 0px" }
    );

    observer.observe(articleRef.current);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    if (!nearViewport || !loadedImage || images.length < 2) return;

    const connection = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; saveData?: boolean };
      }
    ).connection;
    if (connection?.saveData || connection?.effectiveType?.includes("2g")) {
      return;
    }

    let preloadTimer: number | undefined;
    const schedulePreload = () => {
      preloadTimer = window.setTimeout(() => {
        const nextIndex =
          (currentIndex + preloadDirection + images.length) % images.length;
        const preload = new Image();
        preload.sizes = featured
          ? "(max-width: 899px) 100vw, 62vw"
          : "(max-width: 899px) 100vw, 47vw";
        preload.srcset = `${imageWithWidth(
          images[nextIndex],
          480
        )} 480w, ${imageWithWidth(images[nextIndex], 760)} 760w, ${imageWithWidth(
          images[nextIndex],
          1100
        )} 1100w`;
        preload.src = imageWithWidth(images[nextIndex], 1100);
        preloadRef.current = [preload];
      }, position < 2 ? 1_200 : 1_800);
    };

    if (document.readyState === "complete") {
      schedulePreload();
    } else {
      window.addEventListener("load", schedulePreload, { once: true });
    }

    return () => {
      window.removeEventListener("load", schedulePreload);
      if (preloadTimer !== undefined) window.clearTimeout(preloadTimer);
    };
  }, [
    currentIndex,
    featured,
    images,
    loadedImage,
    nearViewport,
    position,
    preloadDirection,
  ]);

  useEffect(() => {
    if (!added) return;
    const resetTimer = window.setTimeout(() => setAdded(false), 2200);
    return () => window.clearTimeout(resetTimer);
  }, [added]);

  const previousImage = useCallback(() => {
    if (images.length < 2) return;
    resetInlineZoomRef.current();
    setPreloadDirection(-1);
    setSelectedImageIndex(
      currentIndex === 0 ? images.length - 1 : currentIndex - 1
    );
  }, [currentIndex, images.length]);

  const nextImage = useCallback(() => {
    if (images.length < 2) return;
    resetInlineZoomRef.current();
    setPreloadDirection(1);
    setSelectedImageIndex((currentIndex + 1) % images.length);
  }, [currentIndex, images.length]);

  const discardImage = useCallback(() => {
    if (!activeImage) return;
    resetInlineZoomRef.current();

    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = undefined;
    }
    retryCountsRef.current.delete(activeImage);
    const remainingImages = images.filter((image) => image !== activeImage);
    setLoadedImage(null);
    setSelectedImageIndex(
      remainingImages.length
        ? Math.min(currentIndex, remainingImages.length - 1)
        : 0
    );
    setFailedImages((current) =>
      current.includes(activeImage) ? current : [...current, activeImage]
    );
  }, [activeImage, currentIndex, images]);

  const handleImageError = useCallback(() => {
    if (!activeImage) return;

    const errorAttempt = `${activeImage}-${
      useOriginalImage ? "original" : "responsive"
    }-${imageAttempt}`;
    if (handledErrorAttemptRef.current === errorAttempt) return;
    handledErrorAttemptRef.current = errorAttempt;
    setLoadedImage(null);

    if (!useOriginalImage) {
      setUnoptimizedImages((current) =>
        current.includes(activeImage) ? current : [...current, activeImage]
      );
      return;
    }

    const retryCount = retryCountsRef.current.get(activeImage) ?? 0;
    if (retryCount < 1) {
      retryCountsRef.current.set(activeImage, retryCount + 1);
      retryTimeoutRef.current = window.setTimeout(() => {
        retryTimeoutRef.current = undefined;
        setImageAttempt((current) => current + 1);
      }, 320);
      return;
    }

    discardImage();
  }, [activeImage, discardImage, imageAttempt, useOriginalImage]);

  const handleImageLoad = useCallback(() => {
    if (!activeImage) return;

    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = undefined;
    }
    handledErrorAttemptRef.current = null;
    retryCountsRef.current.delete(activeImage);
    setLoadedImage(activeImage);
  }, [activeImage]);

  const setProductImageRef = useCallback(
    (image: HTMLImageElement | null) => {
      imageRef.current = image;
      if (cachedImageFrameRef.current !== null) {
        window.cancelAnimationFrame(cachedImageFrameRef.current);
        cachedImageFrameRef.current = null;
      }
      if (!image?.complete) return;

      cachedImageFrameRef.current = window.requestAnimationFrame(() => {
        cachedImageFrameRef.current = null;
        if (imageRef.current !== image) return;
        if (image.naturalWidth > 0) handleImageLoad();
        else handleImageError();
      });
    },
    [handleImageError, handleImageLoad]
  );

  useEffect(
    () => () => {
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = undefined;
      }
    },
    [activeImage]
  );

  const handleZoomIntent = useCallback(() => {
    if (activeImage) setDetailImage(activeImage);
  }, [activeImage]);
  const inlineZoom = useInlineImageZoom({
    imageKey: activeImage,
    onNext: nextImage,
    onPrevious: previousImage,
    onZoomIntent: handleZoomIntent,
  });
  useEffect(() => {
    resetInlineZoomRef.current = inlineZoom.resetView;
  }, [inlineZoom.resetView]);
  const detailRequested = detailImage === activeImage;

  const additionsTotal = selectedAdditions.reduce(
    (total, additionIndex) =>
      total + (item.additionalItems?.[additionIndex]?.price ?? 0),
    0
  );
  const totalPrice = item.price + additionsTotal;

  const addToCart = () => {
    const cartItem = getItem(item._id);
    const itemIndex = cartItem?.quantity ?? 0;

    addItem({
      id: item._id,
      parentId: null,
      price: item.price,
      balance: item.amount,
      image: images[0] ?? null,
      headline: item.headline,
      collectionRef: item.collectionRef,
    });

    selectedAdditions.forEach((additionIndex) => {
      const addition = item.additionalItems?.[additionIndex];
      if (!addition) return;

      addItem({
        id: `${item._id}_${itemIndex}_${additionIndex}`,
        parentId: item._id,
        price: addition.price,
        index: itemIndex,
        image: null,
        headline: addition.name,
        collectionRef: null,
      });
    });

    setAdded(true);
  };

  return (
    <article
      className={`mcc-shop-item${featured ? " mcc-shop-item--featured" : ""}${
        images.length ? "" : " mcc-shop-item--without-media"
      }`}
      data-banner-context-eyebrow="Produkt"
      data-banner-context-href={`/collections/${item.collectionRef}#${item._id}`}
      data-banner-context-kind="item"
      data-banner-context-title={item.headline}
      id={item._id}
      ref={articleRef}
    >
      {images.length ? (
        <div className="mcc-shop-item__gallery">
          <motion.div
            className="mcc-shop-item__media"
            initial={reduceMotion ? false : { opacity: 0, y: 34 }}
            transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
            viewport={{ amount: 0.12, once: true }}
            whileInView={{ opacity: 1, y: 0 }}
          >
            <div
              aria-busy={loadedImage !== activeImage}
              aria-describedby={`mcc-image-help-${item._id}`}
              aria-label={`${item.headline}, interaktiv produktbild`}
              className={`mcc-shop-item__image-stage${
                loadedImage === activeImage ? " is-loaded" : ""
              }${inlineZoom.isHoverPreview ? " is-hover-preview" : ""}${
                inlineZoom.isZoomed ? " is-zoomed" : ""
              }${inlineZoom.isInteracting ? " is-interacting" : ""}`}
              data-zoom-mode={
                inlineZoom.isZoomed
                  ? "zoomed"
                  : inlineZoom.isHoverPreview
                  ? "preview"
                  : "base"
              }
              data-zoom-scale={inlineZoom.scale.toFixed(2)}
              onKeyDown={inlineZoom.handleKeyDown}
              onPointerCancel={inlineZoom.handlePointerCancel}
              onPointerDown={inlineZoom.handlePointerDown}
              onPointerEnter={inlineZoom.handlePointerEnter}
              onPointerLeave={inlineZoom.handlePointerLeave}
              onPointerMove={inlineZoom.handlePointerMove}
              onPointerUp={inlineZoom.handlePointerUp}
              ref={inlineZoom.stageRef}
              role="button"
              aria-pressed={inlineZoom.isZoomed}
              tabIndex={0}
            >
              <img
                alt={`${item.headline}, bild ${currentIndex + 1} av ${
                  images.length
                }`}
                className={loadedImage === activeImage ? "is-loaded" : ""}
                decoding="async"
                draggable={false}
                key={`${activeImage}-${
                  useOriginalImage ? "original" : "responsive"
                }-${imageAttempt}`}
                loading="lazy"
                onError={handleImageError}
                onLoad={handleImageLoad}
                ref={setProductImageRef}
                sizes={
                  featured
                    ? "(max-width: 899px) 100vw, 62vw"
                    : "(max-width: 899px) 100vw, 47vw"
                }
                src={
                  useOriginalImage
                    ? activeImage
                    : imageWithWidth(activeImage, detailRequested ? 2200 : 1100)
                }
                srcSet={
                  !useOriginalImage && !detailRequested
                    ? `${imageWithWidth(
                        activeImage,
                        480
                      )} 480w, ${imageWithWidth(
                        activeImage,
                        760
                      )} 760w, ${imageWithWidth(activeImage, 1100)} 1100w`
                    : undefined
                }
                style={inlineZoom.imageStyle}
              />
              <span
                className="mcc-visually-hidden"
                id={`mcc-image-help-${item._id}`}
              >
                Svep åt sidan för att byta bild. Nyp eller dubbeltryck för att
                zooma. När bilden är zoomad drar du för att utforska den.
              </span>
            </div>

            <div className="mcc-shop-item__gallery-meta">
              <div className="mcc-shop-item__gallery-meta-start">
                <span className="mcc-shop-item__number">
                  {String(position + 1).padStart(2, "0")}
                </span>
                <div
                  aria-label="Välj produktbild"
                  className="mcc-shop-item__dots"
                >
                  {images.map((image, imageIndex) => (
                    <button
                      aria-current={
                        imageIndex === currentIndex ? "true" : undefined
                      }
                      aria-label={`Visa bild ${imageIndex + 1} av ${
                        item.headline
                      }`}
                      key={image}
                      onClick={() => {
                        inlineZoom.resetView();
                        setPreloadDirection(
                          imageIndex >= currentIndex ? 1 : -1
                        );
                        setSelectedImageIndex(imageIndex);
                      }}
                      type="button"
                    />
                  ))}
                </div>
              </div>
              <span className="mcc-shop-item__gallery-count">
                {String(currentIndex + 1).padStart(2, "0")} /{" "}
                {String(images.length).padStart(2, "0")}
              </span>
              <div className="mcc-shop-item__gallery-actions">
                {images.length > 1 ? (
                  <div className="mcc-shop-item__arrows">
                    <button
                      aria-label={`Föregående bild av ${item.headline}`}
                      onClick={previousImage}
                      type="button"
                    >
                      <ArrowIcon direction="left" />
                    </button>
                    <button
                      aria-label={`Nästa bild av ${item.headline}`}
                      onClick={nextImage}
                      type="button"
                    >
                      <ArrowIcon />
                    </button>
                  </div>
                ) : null}

                {user ? (
                  <Link
                    aria-label={`Redigera ${item.headline}`}
                    className="mcc-shop-item__edit"
                    prefetch="intent"
                    to={`/items/${item.collectionRef}/${item._id}/edit`}
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20">
                      <path d="M4.25 14.8 5 11.6 13.9 2.7a1.35 1.35 0 0 1 1.9 0l1.5 1.5a1.35 1.35 0 0 1 0 1.9L8.4 15l-3.2.75Z" />
                      <path d="m12.65 4 3.35 3.35" />
                    </svg>
                  </Link>
                ) : null}
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}

      <motion.div
        className="mcc-shop-item__copy"
        initial={reduceMotion ? false : { opacity: 0, y: 22 }}
        transition={{ delay: 0.08, duration: 0.5 }}
        viewport={{ amount: 0.18, once: true }}
        whileInView={{ opacity: 1, y: 0 }}
      >
        <div className="mcc-shop-item__summary">
          <p className="mcc-kicker">Handgjort / {collectionTitle}</p>
          <div className="mcc-shop-item__heading">
            <h2>{item.headline}</h2>
            <p>{item.price} SEK</p>
          </div>

          {item.longDescription ? (
            <p className="mcc-shop-item__description">
              {item.longDescription}
            </p>
          ) : null}

          <p className="mcc-shop-item__stock">
            {item.amount > 0
              ? item.amount === 1
                ? "Ett exemplar finns i lager"
                : `${item.amount} exemplar finns i lager`
              : "Tillfälligt slut"}
          </p>
        </div>

        {item.amount > 0 && item.additionalItems?.length ? (
          <div className="mcc-shop-item__additions">
            {item.additionalItems.map((addition, additionIndex) => {
              const selected = selectedAdditions.includes(additionIndex);
              return (
                <label
                  key={addition._id ?? `${addition.name}-${addition.price}`}
                >
                  <input
                    checked={selected}
                    onChange={() => {
                      if (!selected) {
                        setAdditionGlowKey((current) => current + 1);
                      }
                      setSelectedAdditions((current) =>
                        selected
                          ? current.filter((index) => index !== additionIndex)
                          : [...current, additionIndex]
                      );
                    }}
                    type="checkbox"
                  />
                  <span aria-hidden="true" className="mcc-shop-item__check" />
                  <span>{addition.name}</span>
                  <strong>+{addition.price} SEK</strong>
                </label>
              );
            })}
          </div>
        ) : null}

        {item.amount > 0 || item.instagram ? (
          <div className="mcc-shop-item__actions">
            {item.amount > 0 ? (
              <button
                aria-live="polite"
                className={added ? "is-added" : ""}
                onClick={addToCart}
                type="button"
              >
                {additionGlowKey > 0 && !reduceMotion ? (
                  <span
                    aria-hidden="true"
                    className="mcc-shop-item__addition-glow"
                    key={additionGlowKey}
                  />
                ) : null}
                <span>
                  {added ? "Tillagd i varukorgen" : "Lägg i varukorgen"}
                </span>
                <span>
                  {totalPrice} SEK
                  <ArrowIcon className="mcc-shop-item__buy-arrow" />
                </span>
              </button>
            ) : null}

            {item.instagram ? (
              <a href={item.instagram} rel="noreferrer" target="_blank">
                Se på Instagram <ArrowIcon direction="up-right" />
              </a>
            ) : null}
          </div>
        ) : null}

        {item.productInfos?.length ? (
          <details className="mcc-shop-item__details">
            <summary>
              Material & detaljer <PlusMinusIcon />
            </summary>
            <ul>
              {item.productInfos.map((info) => (
                <li key={info}>{info}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </motion.div>
    </article>
  );
}

function useCollectionScroll() {
  useEffect(() => {
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    if (!targetId) {
      window.scrollTo(0, 0);
      return;
    }

    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    }, 80);

    return () => window.clearTimeout(timer);
  }, []);
}

export default function Collection() {
  const { collection, items } = useLoaderData<ItemLoaderProps>();
  const { user } = useOutletContext<IndexProps>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const [heroUseOriginal, setHeroUseOriginal] = useState(false);
  const [renderedHeroImage, setRenderedHeroImage] = useState(collection.image);
  const heroCachedImageFrameRef = useRef<number | null>(null);
  const heroImageRef = useRef<HTMLImageElement>(null);
  const heroAvailable = Boolean(collection.image) && !heroFailed;
  useCollectionScroll();

  if (renderedHeroImage !== collection.image) {
    setRenderedHeroImage(collection.image);
    setHeroLoaded(false);
    setHeroFailed(false);
    setHeroUseOriginal(false);
  }

  const handleHeroError = useCallback(() => {
    setHeroLoaded(false);
    if (!heroUseOriginal) {
      setHeroUseOriginal(true);
      return;
    }
    setHeroFailed(true);
  }, [heroUseOriginal]);

  const setHeroImageRef = useCallback(
    (image: HTMLImageElement | null) => {
      heroImageRef.current = image;
      if (heroCachedImageFrameRef.current !== null) {
        window.cancelAnimationFrame(heroCachedImageFrameRef.current);
        heroCachedImageFrameRef.current = null;
      }
      if (!image?.complete) return;

      heroCachedImageFrameRef.current = window.requestAnimationFrame(() => {
        heroCachedImageFrameRef.current = null;
        if (heroImageRef.current !== image) return;
        if (image.naturalWidth > 0) setHeroLoaded(true);
        else handleHeroError();
      });
    },
    [handleHeroError]
  );

  return (
    <main className="collection-page">
      <Loader transition={navigation} />

      <section
        className={`mcc-collection-hero${
          heroAvailable ? "" : " mcc-collection-hero--without-media"
        }`}
      >
        <motion.div
          className="mcc-collection-hero__copy"
          initial={reduceMotion ? false : { opacity: 0.96, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduceMotion ? 0 : 0.24,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <Link
            className="mcc-collection-back"
            prefetch="intent"
            to="/#collections"
          >
            <ArrowIcon direction="left" /> Alla Collections
          </Link>
          <p className="mcc-kicker">Moa Clay Co / Collection</p>
          <h1 lang="sv">{collection.headline}</h1>
          {collection.shortDescription ? (
            <strong>{collection.shortDescription}</strong>
          ) : null}
          {collection.longDescription ? (
            <p>{collection.longDescription}</p>
          ) : null}
          <div className="mcc-collection-hero__footer">
            <a href="#pieces">
              Upptäck kollektionen <ArrowIcon direction="down" />
            </a>
            {user ? (
              <Link
                prefetch="intent"
                to={`/collections/${collection.shortUrl}/edit`}
              >
                Redigera Collection <ArrowIcon direction="up-right" />
              </Link>
            ) : null}
            <span>
              {String(items.length).padStart(2, "0")} handgjorda favoriter
            </span>
          </div>
        </motion.div>

        {heroAvailable ? (
          <motion.figure
            className="mcc-collection-hero__media"
            initial={
              reduceMotion
                ? false
                : { opacity: 0.97, rotate: 0.3, scale: 0.992 }
            }
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            transition={{
              delay: reduceMotion ? 0 : 0.03,
              duration: reduceMotion ? 0 : 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <img
              alt={collection.headline}
              className={heroLoaded ? "is-loaded" : ""}
              fetchPriority="high"
              key={heroUseOriginal ? "original" : "responsive"}
              loading="eager"
              onError={handleHeroError}
              onLoad={() => setHeroLoaded(true)}
              ref={setHeroImageRef}
              sizes="(max-width: 767px) 100vw, 52vw"
              src={
                heroUseOriginal
                  ? collection.image
                  : imageWithWidth(collection.image, 1200)
              }
              srcSet={
                heroUseOriginal
                  ? undefined
                  : `${imageWithWidth(
                      collection.image,
                      560
                    )} 560w, ${imageWithWidth(
                      collection.image,
                      840
                    )} 840w, ${imageWithWidth(collection.image, 1200)} 1200w`
              }
            />
            <figcaption>
              Formad för hand <span>·</span> Gjord för att bäras ofta
            </figcaption>
          </motion.figure>
        ) : null}
      </section>

      <section className="mcc-collection-products" id="pieces">
        {items.length ? (
          <div className="mcc-collection-products__grid">
            {items.map((item, index) => (
              <Product
                collectionTitle={collection.headline}
                featured={index === 0}
                item={item}
                key={item._id}
                position={index}
                user={user}
              />
            ))}
          </div>
        ) : (
          <div className="mcc-collection-empty">
            <p className="mcc-kicker">Snart här</p>
            <h2>Nya former håller på att ta plats.</h2>
            <p>Den här kollektionen fylls på så snart nästa par är klart.</p>
          </div>
        )}
      </section>

      <section className="mcc-collection-closing">
        <p className="mcc-kicker">Färg · form · personlighet</p>
        <h2>Handgjort får gärna synas.</h2>
        <Link prefetch="intent" to="/#collections">
          Se en annan Collection <ArrowIcon direction="up-right" />
        </Link>
      </section>

      {user ? (
        <button
          aria-label="Skapa en ny produkt"
          className="mcc-admin-add"
          onClick={() => navigate(`/items/${collection.shortUrl}/new`)}
          type="button"
        >
          <PlusMinusIcon />
        </button>
      ) : null}
    </main>
  );
}
