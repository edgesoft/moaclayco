import {
  Link,
  useLoaderData,
  useLocation,
  useNavigate,
} from "@remix-run/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import React, { useEffect, useMemo, useRef } from "react";
import { useCart } from "react-use-cart";
import { CollectionProps, User } from "~/types";
import ClientOnly from "./ClientOnly";
import LoginModal from "./LoginModal";

type IndexLoadingType = {
  user?: User;
  ENV: { STRIPE_PUBLIC_KEY?: string };
  collections: CollectionProps[];
  googleAuthenticationConfigured: boolean;
};

type BannerContext = {
  direction: 1 | -1;
  eyebrow: string;
  href: string;
  kind: "collection" | "item" | "section";
  key: string;
  next?: BannerNeighbor;
  previous?: BannerNeighbor;
  title: string;
};

type BannerNeighbor = {
  href: string;
  title: string;
};

function OriginalBannerArtwork() {
  return (
    <div aria-hidden="true" className="mcc-original-banner">
      <div className="mcc-original-banner__canvas">
        <div className="mcc-original-banner__exact" />
      </div>
      <div className="mcc-original-banner__icon-safe-zone" />
    </div>
  );
}

type IconName =
  | "account"
  | "arrow"
  | "cart"
  | "close"
  | "discount"
  | "home"
  | "ledger"
  | "menu"
  | "orders";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    account: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.8 18.2c.7-3.1 2.4-4.7 5.2-4.7 1.5 0 2.7.4 3.6 1.2" />
        <path d="M14 9.5h6M17.5 6l3.5 3.5-3.5 3.5" />
      </>
    ),
    arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
    cart: (
      <>
        <path d="M5.5 8.5h13l-1 11h-11l-1-11Z" />
        <path d="M9 9V6.5a3 3 0 0 1 6 0V9" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    discount: (
      <>
        <path d="m4 5.5 7-2 9.5 9.5-7.5 7.5L3.5 11l.5-5.5Z" />
        <circle cx="8" cy="8" r="1" />
        <path d="m10 15 5-5" />
      </>
    ),
    home: (
      <>
        <path d="m3.5 11 8.5-7 8.5 7" />
        <path d="M5.5 10v10h13V10M10 20v-6h4v6" />
      </>
    ),
    ledger: (
      <>
        <path d="M5 3.5h11.5A2.5 2.5 0 0 1 19 6v14H5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
        <path d="M7.5 3.5V20M11 8h5M11 12h5M11 16h3" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    orders: (
      <>
        <path d="M5 4h14v16H5zM8 4V2M16 4V2" />
        <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="mcc-nav-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      >
        {paths[name]}
      </g>
    </svg>
  );
}

function NavigationWordmark() {
  return (
    <div
      aria-label="Moa Clay Co"
      className="mcc-navigation-wordmark"
      role="img"
    >
      <span className="mcc-navigation-wordmark__name" aria-hidden="true">
        Moa Clay
      </span>
      <span className="mcc-navigation-wordmark__co" aria-hidden="true">
        Co
      </span>
    </div>
  );
}

function Hamburger({ onLogin }: { onLogin: () => void }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [mobileMenuCompact, setMobileMenuCompact] = React.useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const data = useLoaderData<IndexLoadingType>();
  const navigate = useNavigate();

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    setMobileMenuCompact(false);
    if (restoreFocus) {
      window.setTimeout(() => menuButtonRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("mcc-menu-open");
    const closeButton = window.matchMedia("(max-width: 899px)").matches
      ? mobileCloseButtonRef.current
      : closeButtonRef.current;
    closeButton?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("mcc-menu-open");
    };
  }, [menuOpen]);

  const onAccount = () => {
    closeMenu();
    if (data.user) navigate("/logout");
    else onLogin();
  };

  const closeAfterNavigation = () => closeMenu();

  return (
    <>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        aria-label="Öppna meny"
        className="mcc-header-action mcc-header-action--menu"
        onClick={() => setMenuOpen(true)}
        ref={menuButtonRef}
        type="button"
      >
        <Icon name="menu" />
      </button>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="mcc-navigation-layer"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <button
              aria-label="Stäng meny"
              className="mcc-navigation-backdrop"
              onClick={() => closeMenu(true)}
              type="button"
            />

            <div
              aria-label="Huvudmeny"
              aria-modal="true"
              className={`mcc-navigation-shell${
                mobileMenuCompact ? " mcc-navigation-shell--compact" : ""
              }`}
              onScroll={(event) => {
                const compact = event.currentTarget.scrollTop > 190;
                setMobileMenuCompact((current) =>
                  current === compact ? current : compact
                );
              }}
              role="dialog"
            >
              <motion.div
                animate={{ x: 0 }}
                className="mcc-navigation-heading mcc-navigation-mobile-heading"
                exit={{ x: "100%" }}
                initial={{ x: "100%" }}
                transition={{
                  duration: 0.42,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="mcc-navigation-mobile-title">
                  <NavigationWordmark />
                </div>

                <nav
                  aria-label="Snabbval"
                  className="mcc-navigation-mobile-shortcuts"
                >
                  <Link
                    aria-label="Startsida"
                    className="mcc-navigation-shortcut"
                    onClick={closeAfterNavigation}
                    prefetch="intent"
                    to="/"
                  >
                    <Icon name="home" />
                  </Link>
                  <button
                    aria-label={data.user ? "Logga ut" : "Logga in"}
                    className="mcc-navigation-shortcut"
                    onClick={onAccount}
                    type="button"
                  >
                    <Icon name="account" />
                  </button>
                  {data.user ? (
                    <>
                      <Link
                        aria-label="Ordrar"
                        className="mcc-navigation-shortcut"
                        onClick={closeAfterNavigation}
                        prefetch="intent"
                        to="/admin/orders"
                      >
                        <Icon name="orders" />
                      </Link>
                      <Link
                        aria-label="Bokföring"
                        className="mcc-navigation-shortcut"
                        onClick={closeAfterNavigation}
                        prefetch="intent"
                        to="/admin/verifications"
                      >
                        <Icon name="ledger" />
                      </Link>
                      <Link
                        aria-label="Rabatter"
                        className="mcc-navigation-shortcut"
                        onClick={() => {
                          sessionStorage.setItem("scrollPosition", "0");
                          closeAfterNavigation();
                        }}
                        prefetch="intent"
                        to="/admin/discounts"
                      >
                        <Icon name="discount" />
                      </Link>
                    </>
                  ) : null}
                </nav>

                <button
                  aria-label="Stäng meny"
                  className="mcc-navigation-close"
                  onClick={() => closeMenu(true)}
                  ref={mobileCloseButtonRef}
                  type="button"
                >
                  <Icon name="close" />
                </button>
              </motion.div>

              <motion.aside
                animate={{ x: 0 }}
                className="mcc-navigation-rail"
                exit={{ x: "100%" }}
                initial={{ x: "100%" }}
                transition={{
                  duration: 0.5,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="mcc-navigation-heading">
                  <NavigationWordmark />
                  <button
                    aria-label="Stäng meny"
                    className="mcc-navigation-close"
                    onClick={() => closeMenu(true)}
                    ref={closeButtonRef}
                    type="button"
                  >
                    <Icon name="close" />
                  </button>
                </div>

                <nav aria-label="Sidor" className="mcc-navigation-actions">
                  <Link
                    className="mcc-navigation-action"
                    onClick={closeAfterNavigation}
                    prefetch="intent"
                    to="/"
                  >
                    <span className="mcc-navigation-action-icon">
                      <Icon name="home" />
                    </span>
                    <span>
                      <small>Butiken</small>
                      Startsida
                    </span>
                    <Icon name="arrow" />
                  </Link>

                  <button
                    className="mcc-navigation-action"
                    onClick={onAccount}
                    type="button"
                  >
                    <span className="mcc-navigation-action-icon">
                      <Icon name="account" />
                    </span>
                    <span>
                      <small>Konto</small>
                      {data.user ? "Logga ut" : "Logga in"}
                    </span>
                    <Icon name="arrow" />
                  </button>

                  {data.user ? (
                    <>
                      <Link
                        className="mcc-navigation-action"
                        onClick={closeAfterNavigation}
                        prefetch="intent"
                        to="/admin/orders"
                      >
                        <span className="mcc-navigation-action-icon">
                          <Icon name="orders" />
                        </span>
                        <span>
                          <small>Admin</small>
                          Ordrar
                        </span>
                        <Icon name="arrow" />
                      </Link>
                      <Link
                        className="mcc-navigation-action"
                        onClick={closeAfterNavigation}
                        prefetch="intent"
                        to="/admin/verifications"
                      >
                        <span className="mcc-navigation-action-icon">
                          <Icon name="ledger" />
                        </span>
                        <span>
                          <small>Admin</small>
                          Bokföring
                        </span>
                        <Icon name="arrow" />
                      </Link>
                      <Link
                        className="mcc-navigation-action"
                        onClick={() => {
                          sessionStorage.setItem("scrollPosition", "0");
                          closeAfterNavigation();
                        }}
                        prefetch="intent"
                        to="/admin/discounts"
                      >
                        <span className="mcc-navigation-action-icon">
                          <Icon name="discount" />
                        </span>
                        <span>
                          <small>Admin</small>
                          Rabatter
                        </span>
                        <Icon name="arrow" />
                      </Link>
                    </>
                  ) : null}
                </nav>

                <p className="mcc-navigation-rail-note">
                  Handgjorda smycken, formade och målade för hand.
                </p>
              </motion.aside>

              <motion.section
                animate={{ opacity: 1, y: 0 }}
                aria-labelledby="mcc-collections-heading"
                className="mcc-navigation-collections"
                exit={{ opacity: 0, y: 36 }}
                initial={{ opacity: 0, y: 36 }}
                transition={{
                  delay: 0.08,
                  duration: 0.55,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="mcc-navigation-collections-heading">
                  <div>
                    <span className="mcc-navigation-kicker">
                      Utforska kollektionerna
                    </span>
                    <h2 id="mcc-collections-heading">Collections</h2>
                  </div>
                  <span className="mcc-navigation-count">
                    {String(data.collections.length).padStart(2, "0")}
                  </span>
                </div>

                <div className="mcc-navigation-collection-grid">
                  {data.collections.map((collection, index) => (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      initial={{ opacity: 0, y: 14 }}
                      key={collection._id ?? collection.shortUrl}
                      transition={{
                        delay: 0.14 + Math.min(index, 10) * 0.035,
                        duration: 0.4,
                      }}
                    >
                      <Link
                        aria-label={`Öppna ${collection.headline}`}
                        className="mcc-navigation-collection"
                        onClick={closeAfterNavigation}
                        prefetch="intent"
                        to={`/collections/${collection.shortUrl}`}
                      >
                        <span className="mcc-navigation-collection-media">
                          <img
                            alt=""
                            loading={index > 3 ? "lazy" : "eager"}
                            src={collection.image}
                          />
                        </span>
                        <span className="mcc-navigation-collection-copy">
                          <small>
                            Collection {String(index + 1).padStart(2, "0")}
                          </small>
                          <strong>{collection.headline}</strong>
                        </span>
                        <span className="mcc-navigation-collection-arrow">
                          <Icon name="arrow" />
                        </span>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

const CartComponent = (): JSX.Element | null => {
  const { items } = useCart();
  const totalItems = useMemo(
    () =>
      items.reduce(
        (count, item) =>
          item.parentId == null ? count + (item.quantity || 0) : count,
        0
      ),
    [items]
  );
  const navigate = useNavigate();

  if (totalItems <= 0) return null;

  return (
    <motion.button
      animate={{ opacity: 1, scale: 1 }}
      aria-label={`Öppna varukorgen, ${totalItems} varor`}
      className="mcc-header-action mcc-header-action--cart"
      initial={{ opacity: 0, scale: 0.82 }}
      onClick={() => navigate("/cart")}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      type="button"
    >
      <Icon name="cart" />
      <span className="mcc-cart-count">{totalItems}</span>
    </motion.button>
  );
};

const Header = (): JSX.Element | null => {
  const data = useLoaderData<IndexLoadingType>();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const [loginOpen, setLoginOpen] = React.useState(false);
  const showCompactBrand = true;
  const [bannerContext, setBannerContext] = React.useState<BannerContext | null>(
    null
  );
  const isHomePage = location.pathname === "/";
  const supportsBannerContext =
    isHomePage || location.pathname.startsWith("/collections/");
  const compactBrandVisible = !isHomePage || showCompactBrand;
  const bannerContextHasNavigation =
    bannerContext?.kind === "section" ||
    Boolean(bannerContext?.previous || bannerContext?.next);

  useEffect(() => {
    // A route change can keep the header mounted. Clear the previous page's
    // scroll context before collecting the context elements for the new page.
    setBannerContext(null);

    if (!supportsBannerContext) {
      return;
    }

    const contextElements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-banner-context-title]")
    );

    const contexts = contextElements.flatMap((element) => {
      const title = element.dataset.bannerContextTitle;
      const eyebrow = element.dataset.bannerContextEyebrow;
      const href = element.dataset.bannerContextHref;

      if (!title || !eyebrow || !href) return [];

      return [
        {
          element,
          eyebrow,
          href,
          kind:
            element.dataset.bannerContextKind === "collection"
              ? ("collection" as const)
              : element.dataset.bannerContextKind === "item"
                ? ("item" as const)
                : ("section" as const),
          title,
        },
      ];
    });

    let lastScrollPosition = window.scrollY;

    const updateBrandPosition = () => {
      const direction: 1 | -1 =
        window.scrollY >= lastScrollPosition ? 1 : -1;
      const triggerLine = Math.min(window.innerHeight * 0.38, 360);
      let nextContext: BannerContext | null = null;

      for (const context of contexts) {
        if (context.element.getBoundingClientRect().top > triggerLine) break;

        if (context.kind !== "section") {
          const siblingContexts = contexts.filter(
            (candidate) => candidate.kind === context.kind
          );
          const contextIndex = siblingContexts.indexOf(context);
          const previous = siblingContexts[contextIndex - 1];
          const next = siblingContexts[contextIndex + 1];

          nextContext = {
            direction,
            eyebrow: context.eyebrow,
            href: context.href,
            key: `${context.eyebrow}-${context.title}-${context.href}`,
            kind: context.kind,
            next: next
              ? { href: next.href, title: next.title }
              : undefined,
            previous: previous
              ? { href: previous.href, title: previous.title }
              : undefined,
            title: context.title,
          };
        } else {
          nextContext = {
            direction,
            eyebrow: context.eyebrow,
            href: context.href,
            key: `${context.eyebrow}-${context.title}-${context.href}`,
            kind: context.kind,
            title: context.title,
          };
        }
      }

      setBannerContext((current) => {
        if (!nextContext) return current ? null : current;
        return current?.key === nextContext.key ? current : nextContext;
      });
      lastScrollPosition = window.scrollY;
    };

    updateBrandPosition();
    window.addEventListener("scroll", updateBrandPosition, { passive: true });
    return () => window.removeEventListener("scroll", updateBrandPosition);
  }, [location.pathname, supportsBannerContext]);

  return (
    <>
      <header className="mcc-site-header">
        <OriginalBannerArtwork />
        <Link
          aria-label="Moa Clay Co – startsida"
          className={`mcc-site-home-link${bannerContext ? " mcc-site-home-link--context" : ""}`}
          prefetch="intent"
          to="/"
        >
          <span className="mcc-visually-hidden">Moa Clay Co</span>
          <AnimatePresence initial={!reduceMotion}>
            {compactBrandVisible ? (
              <motion.span
                animate={{
                  clipPath: "inset(0 0% 0 0 round 999px)",
                  filter: "blur(0px)",
                  opacity: 1,
                  y: 0,
                }}
                className="mcc-scroll-brand"
                exit={
                  reduceMotion
                    ? undefined
                    : {
                        clipPath: "inset(0 100% 0 0 round 999px)",
                        opacity: 0,
                        y: -5,
                      }
                }
                initial={
                  reduceMotion
                    ? false
                    : {
                        clipPath: "inset(0 100% 0 0 round 999px)",
                        filter: "blur(4px)",
                        opacity: 0,
                        y: 8,
                      }
                }
                transition={{
                  delay: reduceMotion ? 0 : 0.16,
                  duration: reduceMotion ? 0 : 0.58,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <span className="mcc-scroll-brand__name">Moa Clay</span>
                <span className="mcc-scroll-brand__collection">Co</span>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </Link>
        <AnimatePresence initial={false} mode="wait">
          {compactBrandVisible &&
          bannerContext &&
          bannerContextHasNavigation ? (
            <motion.div
              animate={{ opacity: 1, scaleX: 1, x: 0 }}
              className={`mcc-scroll-context-wrap${
                bannerContext.kind !== "section"
                  ? " mcc-scroll-context-wrap--navigator"
                  : ""
              }`}
              exit={
                reduceMotion
                  ? undefined
                  : bannerContext.kind !== "section"
                    ? { opacity: 0 }
                    : { opacity: 0, scaleX: 0.96, x: -12 }
              }
              initial={
                reduceMotion
                  ? false
                  : bannerContext.kind !== "section"
                    ? { opacity: 0 }
                    : { opacity: 0, scaleX: 0.94, x: -22 }
              }
              key={
                bannerContext.kind === "section"
                  ? bannerContext.key
                  : bannerContext.kind
              }
              transition={{
                duration: reduceMotion ? 0 : 0.34,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {bannerContext.kind !== "section" ? (
                <nav
                  aria-label={`Närliggande ${
                    bannerContext.kind === "item" ? "produkter" : "Collections"
                  } runt ${bannerContext.title}`}
                  className="mcc-scroll-collection-nav"
                >
                  {bannerContext.previous ? (
                    <span className="mcc-scroll-collection-nav__item">
                      <Link
                        aria-label={`Föregående ${
                          bannerContext.kind === "item"
                            ? "produkt"
                            : "Collection"
                        }: ${bannerContext.previous.title}`}
                        className="mcc-scroll-collection-nav__link mcc-scroll-collection-nav__link--previous"
                        prefetch="intent"
                        to={bannerContext.previous.href}
                      >
                        <span
                          aria-hidden="true"
                          className="mcc-scroll-collection-nav__arrow"
                        >
                          ←
                        </span>
                        <span className="mcc-scroll-collection-nav__copy">
                          <small>Föregående</small>
                          <AnimatePresence
                            initial={!reduceMotion}
                            mode="popLayout"
                          >
                            <motion.strong
                              animate={{
                                filter: "blur(0px)",
                                opacity: 1,
                                x: 0,
                              }}
                              exit={
                                reduceMotion
                                  ? undefined
                                  : {
                                      filter: "blur(2px)",
                                      opacity: 0,
                                      x: bannerContext.direction * -14,
                                    }
                              }
                              initial={
                                reduceMotion
                                  ? false
                                  : {
                                      filter: "blur(3px)",
                                      opacity: 0,
                                      x: bannerContext.direction * 14,
                                    }
                              }
                              key={`previous-${bannerContext.previous.href}`}
                              transition={{
                                duration: reduceMotion ? 0 : 0.34,
                                ease: [0.22, 1, 0.36, 1],
                              }}
                            >
                              {bannerContext.previous.title}
                            </motion.strong>
                          </AnimatePresence>
                        </span>
                      </Link>
                    </span>
                  ) : null}

                  {bannerContext.next ? (
                    <span className="mcc-scroll-collection-nav__item">
                      <Link
                        aria-label={`Nästa ${
                          bannerContext.kind === "item" ? "produkt" : "Collection"
                        }: ${bannerContext.next.title}`}
                        className="mcc-scroll-collection-nav__link mcc-scroll-collection-nav__link--next"
                        prefetch="intent"
                        to={bannerContext.next.href}
                      >
                        <span className="mcc-scroll-collection-nav__copy">
                          <small>Nästa</small>
                          <AnimatePresence initial={!reduceMotion} mode="popLayout">
                            <motion.strong
                              animate={{ filter: "blur(0px)", opacity: 1, x: 0 }}
                              exit={
                                reduceMotion
                                  ? undefined
                                  : {
                                      filter: "blur(2px)",
                                      opacity: 0,
                                      x: bannerContext.direction * -14,
                                    }
                              }
                              initial={
                                reduceMotion
                                  ? false
                                  : {
                                      filter: "blur(3px)",
                                      opacity: 0,
                                      x: bannerContext.direction * 14,
                                    }
                              }
                              key={`next-${bannerContext.next.href}`}
                              transition={{
                                delay: reduceMotion ? 0 : 0.035,
                                duration: reduceMotion ? 0 : 0.34,
                                ease: [0.22, 1, 0.36, 1],
                              }}
                            >
                              {bannerContext.next.title}
                            </motion.strong>
                          </AnimatePresence>
                        </span>
                        <span aria-hidden="true" className="mcc-scroll-collection-nav__arrow">
                          →
                        </span>
                      </Link>
                    </span>
                  ) : null}
                </nav>
              ) : (
                <Link
                  aria-label={`${bannerContext.eyebrow}: ${bannerContext.title}`}
                  className="mcc-scroll-context"
                  prefetch="intent"
                  to={bannerContext.href}
                >
                  <span className="mcc-scroll-context__eyebrow">
                    {bannerContext.eyebrow}
                  </span>
                  <strong>{bannerContext.title}</strong>
                  <span aria-hidden="true" className="mcc-scroll-context__arrow">
                    ↗
                  </span>
                </Link>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="mcc-site-header-actions">
          <ClientOnly fallback={null}>{() => <CartComponent />}</ClientOnly>
          <Hamburger onLogin={() => setLoginOpen(true)} />
        </div>
      </header>
      {loginOpen ? (
        <LoginModal
          configured={data.googleAuthenticationConfigured}
          onClose={() => setLoginOpen(false)}
        />
      ) : null}
    </>
  );
};

export default Header;
