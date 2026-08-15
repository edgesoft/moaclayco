import type {
  HeadersFunction,
  LoaderFunction,
  MetaFunction,
} from "react-router";
import {
  data as json,
  Link,
  useLoaderData,
  useOutletContext,
  useRevalidator,
} from "react-router";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { useEffect, useRef } from "react";
import ArrowIcon from "~/components/ArrowIcon";
import CollectionAtelier from "~/components/admin/CollectionAtelier";
import CollectionUndoSnackbar from "~/components/admin/CollectionUndoSnackbar";
import { theme } from "~/components/Theme";
import useMediaQuery from "~/hooks/useMediaQuery";
import { Items } from "~/schemas/items";
import type { CollectionProps, ItemProps } from "~/types";
import type { IndexProps } from "~/root";
import { toLoaderData } from "~/utils/loaderData";
import { landingItemProjection } from "~/utils/queryProjections.server";
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
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";

type LandingLoaderData = {
  latestItems: ItemProps[];
};

const imageWithWidth = (image: string, width: number) =>
  `${image}${image.includes("?") ? "&" : "?"}width=${width}`;

export const loader: LoaderFunction = async () => {
  const timings: ServerTimingMetric[] = [];
  let catalogCacheStatus = "miss";
  const latestItems = await measureServerTiming(
    timings,
    "home-catalog",
    () =>
      readCatalogCache(
        catalogCacheKeys.latestItems,
        async () =>
          toLoaderData(
            await Items.find(activeCatalogItemFilter)
              .select(landingItemProjection)
              .slice("images", 2)
              .sort({ _id: -1 })
              .limit(6)
              .lean()
          ),
        { onStatus: (status) => (catalogCacheStatus = status) }
      ),
    "latest items"
  );
  timings.push({
    description: catalogCacheStatus,
    duration: 0,
    name: "home-cache",
  });

  return json(
    { latestItems },
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

export const meta: MetaFunction = () => {
  return [
    {
      title: `${theme.longName} — färg, form och personlighet`,
    },
    {
      name: "description",
      content:
        "Upptäck Moa Clay Collections och hitta örhängen med färg, form och personlighet.",
    },
    {
      property: "twitter:image",
      content: theme.backgroundImage,
    },
    {
      property: "og:image",
      content: theme.backgroundImage,
    },
  ];
};

function HeroCollection({
  collection,
  index,
}: {
  collection: CollectionProps;
  index: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={`mcc-hero-card mcc-hero-card--${index + 1}`}
      initial={reduceMotion ? false : { opacity: 0.96, y: 8 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{
        delay: reduceMotion ? 0 : 0.04 + index * 0.04,
        duration: reduceMotion ? 0 : 0.28,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <Link
        aria-label={`Öppna kollektionen ${collection.headline}`}
        prefetch="intent"
        to={`/collections/${collection.shortUrl}`}
      >
        <span className="mcc-hero-card__media">
          <img
            alt={collection.headline}
            fetchPriority={index === 0 ? "high" : "auto"}
            loading="eager"
            sizes="(max-width: 767px) 46vw, 25vw"
            src={imageWithWidth(collection.image, 700)}
            srcSet={`
              ${imageWithWidth(collection.image, 320)} 320w,
              ${imageWithWidth(collection.image, 480)} 480w,
              ${imageWithWidth(collection.image, 700)} 700w
            `}
          />
        </span>
        <span className="mcc-hero-card__label">
          <small>Collection</small>
          <strong>{collection.headline}</strong>
        </span>
      </Link>
    </motion.div>
  );
}

function ProductScrollStory({ item }: { item: ItemProps }) {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const images = item.images?.filter(Boolean) ?? [];
  const firstImage = images[0];
  const secondImage = images[1];
  const itemHref = `/collections/${item.collectionRef}#${item._id}`;
  const productScale = useTransform(
    scrollYProgress,
    [0, 0.48, 1],
    [0.94, 1.035, 0.97]
  );
  const productRotate = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [-2.5, 1.5, -0.5]
  );
  const detailX = useTransform(scrollYProgress, [0, 0.5, 1], [18, -10, 4]);
  const detailY = useTransform(scrollYProgress, [0, 0.5, 1], [24, -18, 0]);
  const detailRotate = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [7, -4, 2]
  );

  if (!firstImage) return null;

  return (
    <section
      aria-label={`Produktberättelse för ${item.headline}`}
      className="mcc-product-journey"
      data-banner-context-eyebrow="Utvald nyhet"
      data-banner-context-href={itemHref}
      data-banner-context-title={item.headline}
      id="featured"
      ref={sectionRef}
    >
      <div className="mcc-product-journey__shell">
        <div className="mcc-product-journey__visual">
          <div className="mcc-product-journey__label" aria-hidden="true">
            Utvald / 01
          </div>
          <Link
            aria-label={`Öppna ${item.headline} i Collection`}
            className="mcc-product-journey__visual-link"
            prefetch="intent"
            to={itemHref}
          >
            <motion.div
              className="mcc-product-journey__frame"
              style={
                reduceMotion
                  ? undefined
                  : { rotate: productRotate, scale: productScale }
              }
            >
              <img
                alt={item.headline}
                decoding="async"
                loading="lazy"
                sizes="(max-width: 899px) 82vw, 42vw"
                src={imageWithWidth(firstImage, 1000)}
                srcSet={`
                  ${imageWithWidth(firstImage, 480)} 480w,
                  ${imageWithWidth(firstImage, 700)} 700w,
                  ${imageWithWidth(firstImage, 1000)} 1000w
                `}
              />
              {secondImage ? (
                <motion.img
                  alt=""
                  aria-hidden="true"
                  className="mcc-product-journey__detail-image"
                  decoding="async"
                  loading="lazy"
                  src={imageWithWidth(secondImage, 480)}
                  style={
                    reduceMotion
                      ? undefined
                      : { rotate: detailRotate, x: detailX, y: detailY }
                  }
                />
              ) : null}
              <span className="mcc-product-journey__visual-cta">
                Öppna i Collection
                <ArrowIcon direction="up-right" />
              </span>
            </motion.div>
          </Link>
        </div>

        <div className="mcc-product-journey__steps">
          <motion.article
            className="mcc-product-journey__step"
            initial={reduceMotion ? false : { x: -24 }}
            whileInView={{ x: 0 }}
            viewport={{ amount: 0.35, once: true }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
          >
            <span>01</span>
            <p className="mcc-kicker">Utvald nyhet</p>
            <h2>{item.headline}</h2>
            <p>
              Ett uttrycksfullt par som får ta plats — handgjort för dagar när
              detaljerna ska göra hela looken.
            </p>
          </motion.article>

          <motion.article
            className="mcc-product-journey__step"
            initial={reduceMotion ? false : { x: 24 }}
            whileInView={{ x: 0 }}
            viewport={{ amount: 0.35, once: true }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
          >
            <span>02</span>
            <p className="mcc-kicker">Titta närmare</p>
            <h3>Formen gör hela uttrycket.</h3>
            <p>
              {item.productInfos?.slice(0, 3).join(" · ") ||
                item.longDescription ||
                "Färg, form och personlighet i ett enda par."}
            </p>
            <Link
              aria-label={`Visa ${item.headline} i Collection`}
              className="mcc-product-journey__step-link"
              prefetch="intent"
              to={itemHref}
            >
              Visa i Collection
              <ArrowIcon direction="up-right" />
            </Link>
          </motion.article>

          <motion.article
            className="mcc-product-journey__step mcc-product-journey__step--buy"
            initial={reduceMotion ? false : { y: 24 }}
            whileInView={{ y: 0 }}
            viewport={{ amount: 0.35, once: true }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
          >
            <span>03</span>
            <p className="mcc-kicker">Din nästa favorit</p>
            <h3>{item.price} SEK</h3>
            <p>{item.amount > 0 ? "Finns i lager" : "Tillfälligt slut"}</p>
            <Link
              className="mcc-button mcc-button--cream"
              prefetch="intent"
              to={itemHref}
            >
              Se och köp
              <ArrowIcon direction="up-right" />
            </Link>
          </motion.article>
        </div>
      </div>
    </section>
  );
}

function CollectionScene({
  collection,
  editable,
  index,
  total,
}: {
  collection: CollectionProps;
  editable: boolean;
  index: number;
  total: number;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const usesCompactLayout = useMediaQuery("(max-width: 899px)");
  const layout = index % 3;
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const mediaParallaxY = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    layout === 1 ? [58, 0, -52] : [-52, 0, 58]
  );
  const mediaParallaxScale = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [1.085, 1.015, 1.07]
  );
  const copyParallaxX = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    layout === 1 ? [44, 0, -18] : [-44, 0, 18]
  );
  const copyParallaxY = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [34, 0, -24]
  );
  const copyOpacity = useTransform(
    scrollYProgress,
    [0, 0.16, 0.84, 1],
    [0.56, 1, 1, 0.76]
  );
  const imageEntrance = [
    { scale: 1.14, x: "11%", rotate: 1.1 },
    { scale: 1.14, x: "-11%", rotate: -1.1 },
    { scale: 1.18, y: "7%", rotate: 1.4 },
  ][layout];
  return (
    <section
      aria-label={`Collection ${collection.headline}`}
      className={`mcc-collection-scene mcc-collection-scene--${layout + 1}`}
      data-banner-context-eyebrow={`Collection ${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`}
      data-banner-context-href={`/collections/${collection.shortUrl}`}
      data-banner-context-kind="collection"
      data-banner-context-title={collection.headline}
      ref={sectionRef}
    >
      <div className="mcc-collection-scene__stage">
        <div className="mcc-collection-scene__progress" aria-hidden="true">
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span>/</span>
          <span>{String(total).padStart(2, "0")}</span>
        </div>

        <Link
          aria-label={`Öppna Collection ${collection.headline}`}
          className="mcc-collection-scene__media"
          prefetch="intent"
          to={`/collections/${collection.shortUrl}`}
        >
          <motion.span
            className="mcc-collection-scene__parallax"
            style={
              reduceMotion
                ? undefined
                : { scale: mediaParallaxScale, y: mediaParallaxY }
            }
          >
            <motion.img
              alt={collection.headline}
              decoding="async"
              initial={reduceMotion ? false : imageEntrance}
              loading="lazy"
              sizes="(max-width: 767px) 94vw, 68vw"
              src={imageWithWidth(collection.image, 1000)}
              srcSet={`
                ${imageWithWidth(collection.image, 480)} 480w,
                ${imageWithWidth(collection.image, 700)} 700w,
                ${imageWithWidth(collection.image, 1000)} 1000w
              `}
              transition={{ duration: 0.82, ease: [0.22, 1, 0.36, 1] }}
              viewport={{ amount: 0.18, once: true }}
              whileInView={{ rotate: 0, scale: 1, x: 0, y: 0 }}
            />
          </motion.span>
        </Link>

        <motion.div
          className="mcc-collection-scene__copy"
          style={
            reduceMotion
              ? undefined
              : usesCompactLayout
                ? { opacity: copyOpacity }
              : {
                  opacity: copyOpacity,
                  x: copyParallaxX,
                  y: copyParallaxY,
                }
          }
        >
          <p className="mcc-kicker">Collection</p>
          <h2>{collection.headline}</h2>
          {collection.shortDescription ? (
            <strong>{collection.shortDescription}</strong>
          ) : null}
          {collection.longDescription ? (
            <p className="mcc-collection-scene__description">
              {collection.longDescription}
            </p>
          ) : null}
          <div className="mcc-collection-scene__links">
            <Link
              className="mcc-collection-scene__link"
              prefetch="intent"
              to={`/collections/${collection.shortUrl}`}
            >
              Se Collection
              <ArrowIcon direction="up-right" />
            </Link>
            {editable ? (
              <Link
                className="mcc-collection-scene__edit"
                prefetch="intent"
                to={`/collections/${collection.shortUrl}/edit`}
              >
                Redigera
              </Link>
            ) : null}
          </div>
        </motion.div>

        <div className="mcc-collection-scene__continue" aria-hidden="true">
          Scrolla vidare
          <ArrowIcon direction="down" />
        </div>
      </div>
    </section>
  );
}

function ProductCard({ item }: { item: ItemProps }) {
  const image = item.images?.[0];

  if (!image) return null;

  return (
    <article className="mcc-product">
      <Link
        className="mcc-product__link"
        prefetch="intent"
        to={`/collections/${item.collectionRef}#${item._id}`}
      >
        <div className="mcc-product__media">
          <img
            alt={item.headline}
            loading="lazy"
            sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"
            src={imageWithWidth(image, 700)}
            srcSet={`
              ${imageWithWidth(image, 320)} 320w,
              ${imageWithWidth(image, 480)} 480w,
              ${imageWithWidth(image, 700)} 700w
            `}
          />
          <span>{item.amount > 0 ? "Nyast" : "Tillfälligt slut"}</span>
        </div>
        <div className="mcc-product__copy">
          <div>
            <h3>{item.headline}</h3>
            <p>{item.price} SEK</p>
          </div>
          <ArrowIcon direction="up-right" />
        </div>
      </Link>
    </article>
  );
}

export default function Index() {
  const { user, collections } = useOutletContext<IndexProps>();
  const { latestItems } = useLoaderData<LandingLoaderData>();
  const revalidator = useRevalidator();
  const attemptedEmptyDataRepairRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const heroCollections = collections.slice(0, 2);
  const featuredItem = latestItems[0];

  useEffect(() => {
    if (
      collections.length > 0 ||
      attemptedEmptyDataRepairRef.current ||
      revalidator.state !== "idle"
    ) {
      return;
    }

    attemptedEmptyDataRepairRef.current = true;
    revalidator.revalidate();
  }, [collections.length, revalidator]);

  return (
    <main className="landing-page">
      <section className="mcc-hero">
        <motion.div
          className="mcc-hero__copy"
          initial={reduceMotion ? false : { opacity: 0.96, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: reduceMotion ? 0 : 0.24,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <motion.p
            aria-label="Moa Clay Collection"
            className="mcc-kicker mcc-hero-brand"
          >
            <span aria-hidden="true" className="mcc-hero-brand__words">
              {["Moa", "Clay", "Collection"].map((word, index) => (
                <span className="mcc-hero-brand__mask" key={word}>
                  <motion.span
                    animate={{ opacity: 1, rotate: 0, y: 0 }}
                    className="mcc-hero-brand__word"
                    initial={
                      reduceMotion
                        ? false
                        : { opacity: 0.75, y: "35%" }
                    }
                    transition={{
                      delay: reduceMotion ? 0 : 0.02 + index * 0.035,
                      duration: reduceMotion ? 0 : 0.24,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    {word}
                  </motion.span>
                </span>
              ))}
            </span>
          </motion.p>
          <h1>Små detaljer. Mycket personlighet.</h1>
          <p className="mcc-hero__intro">
            Lekfulla former, härliga färger och örhängen som gör det lite
            roligare att klä sig.
          </p>
          <div className="mcc-actions">
            <a className="mcc-button mcc-button--dark" href="#collections">
              Se alla Collections
              <ArrowIcon direction="down" />
            </a>
            {featuredItem ? (
              <a className="mcc-button mcc-button--light" href="#featured">
                Se utvald nyhet
              </a>
            ) : null}
          </div>
        </motion.div>

        <div className="mcc-hero__gallery">
          {heroCollections.map((collection, index) => (
            <HeroCollection
              collection={collection}
              index={index}
              key={collection._id ?? collection.shortUrl}
            />
          ))}
        </div>
      </section>

      {featuredItem ? <ProductScrollStory item={featuredItem} /> : null}

      <section
        aria-label="Alla Collections"
        className="mcc-collection-showcase"
        id="collections"
      >
        <div className="mcc-collection-showcase__intro">
          <div className="mcc-section-heading">
            <div>
            <p className="mcc-kicker">Alla Collections</p>
              <h2>En Collection i taget.</h2>
            </div>
            <p>
              Stanna i varje uttryck, upptäck detaljerna och öppna den
              Collection som känns mest du — eller scrolla vidare.
            </p>
          </div>
        </div>

        {collections.map((collection, index) => (
          <CollectionScene
            collection={collection}
            editable={Boolean(user)}
            index={index}
            key={collection._id ?? collection.shortUrl}
            total={collections.length}
          />
        ))}
      </section>

      {latestItems.length > 0 ? (
        <section
          className="mcc-latest"
          id="latest"
        >
          <div className="mcc-section-heading mcc-section-heading--light">
            <div>
              <p className="mcc-kicker">Nytt i butiken</p>
              <h2>Senast tillagda</h2>
            </div>
            <p>
              Scrolla sidledes genom de nyaste örhängena och gå direkt till
              produkten du fastnar för.
            </p>
          </div>

          <div className="mcc-product-grid">
            {latestItems.map((item) => (
              <ProductCard item={item} key={item._id} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mcc-closing">
        <motion.div
          initial={reduceMotion ? false : { y: 28, scale: 0.985 }}
          whileInView={{ scale: 1, y: 0 }}
          viewport={{ amount: 0.35, once: true }}
          transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="mcc-kicker">Moa Clay Co</p>
          <h2>Vilket par blir ditt?</h2>
          <div className="mcc-actions mcc-actions--center">
            <a className="mcc-button mcc-button--cream" href="#collections">
              Upptäck Collections
            </a>
            {theme?.instagramUrl ? (
              <a
                className="mcc-social-link"
                href={theme.instagramUrl}
                rel="noreferrer"
                target="_blank"
              >
                Följ på Instagram
                <ArrowIcon direction="up-right" />
              </a>
            ) : null}
          </div>
        </motion.div>
      </section>

      {user ? <CollectionAtelier collections={collections} /> : null}
      {user ? <CollectionUndoSnackbar /> : null}
    </main>
  );
}
