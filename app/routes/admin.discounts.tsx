import type { LoaderFunction } from "react-router";
import { Link, Outlet, useLoaderData, useLocation } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import { auth } from "~/services/auth.server";
import type { DiscountType } from "~/types";
import { toLoaderData } from "~/utils/loaderData";
import ArrowIcon from "~/components/ArrowIcon";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import { discountProjection } from "~/utils/queryProjections.server";

export const loader: LoaderFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  return toLoaderData(
    await DiscountEntity.find({})
      .select(discountProjection)
      .sort({ code: 1 })
      .lean()
  );
};

const listDate = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Stockholm",
});

const listTime = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

const formatValidity = (value: DiscountType["expireAt"]) => {
  if (!value) return "Utan slutdatum";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Datum saknas";
  return `${listDate.format(date)} · ${listTime.format(date)}`;
};

const getDiscountState = (discount: DiscountType) => {
  if (discount.balance <= 0) return { label: "Slut", tone: "is-empty" };
  if (discount.expireAt && new Date(discount.expireAt).getTime() < Date.now()) {
    return { label: "Utgången", tone: "is-expired" };
  }
  return { label: "Aktiv", tone: "is-active" };
};

export default function Discounts() {
  const discounts = useLoaderData<DiscountType[]>();
  const location = useLocation();
  const titleRef = useRef<HTMLDivElement>(null);
  const [showStickyTitle, setShowStickyTitle] = useState(false);

  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const siteHeaderHeight =
      document.querySelector<HTMLElement>(".mcc-site-header")?.getBoundingClientRect().height ?? 72;

    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyTitle(!entry.isIntersecting),
      { rootMargin: `-${siteHeaderHeight}px 0px 0px 0px`, threshold: 0 }
    );

    observer.observe(title);
    return () => observer.disconnect();
  }, [location.pathname]);

  if (location.pathname.replace(/\/$/, "") !== "/admin/discounts") {
    return <Outlet />;
  }

  const activeCount = discounts.filter((discount) => getDiscountState(discount).label === "Aktiv").length;

  return (
    <main className="mcc-editor-page mcc-discount-list-page">
      <div className="mcc-editor-form">
        <header className="mcc-editor-header">
          <div className="mcc-editor-header__topline">
            <Link to="/"><span aria-hidden="true"><ArrowIcon direction="left" /></span> Tillbaka till butiken</Link>
          </div>
          <div className="mcc-editor-header__title mcc-discount-list-title" ref={titleRef}>
            <div>
              <p className="mcc-kicker">Ateljé / Försäljning</p>
              <h1>Rabatter</h1>
              <p className="mcc-discount-list-intro">
                {discounts.length
                  ? `${activeCount} ${activeCount === 1 ? "aktiv kod" : "aktiva koder"} av ${discounts.length}.`
                  : "Skapa tydliga rabattkoder för kampanjer och återkommande kunder."}
              </p>
            </div>
            <Link className="mcc-discount-create" to="/admin/discounts/new">
              <span>Ny rabatt</span><span aria-hidden="true"><PlusMinusIcon /></span>
            </Link>
          </div>
        </header>

        <div
          aria-hidden={!showStickyTitle}
          className={`mcc-discount-mobile-sticky${showStickyTitle ? " is-visible" : ""}`}
        >
          <strong>Rabatter</strong>
          <Link aria-label="Ny rabatt" tabIndex={showStickyTitle ? undefined : -1} to="/admin/discounts/new">
            <span aria-hidden="true"><PlusMinusIcon /></span>
          </Link>
        </div>

        <section className="mcc-discount-index" aria-labelledby="discount-list-heading">
          <div className="mcc-discount-index__heading">
            <div>
              <p className="mcc-editor-eyebrow">Översikt</p>
              <h2 id="discount-list-heading">Alla koder</h2>
            </div>
            <span>{String(discounts.length).padStart(2, "0")}</span>
          </div>

          {discounts.length ? (
            <div className="mcc-discount-list">
              <div className="mcc-discount-list__labels" aria-hidden="true">
                <span>Kod</span>
                <span>Rabatt</span>
                <span>Kvar</span>
                <span>Giltighet</span>
                <span>Status</span>
                <span />
              </div>
              {discounts.map((discount) => {
                const state = getDiscountState(discount);
                return (
                  <Link className="mcc-discount-row" key={discount._id} to={`/admin/discounts/${discount._id}`}>
                    <span className="mcc-discount-row__code" data-label="Kod">{discount.code}</span>
                    <span className="mcc-discount-row__percentage" data-label="Rabatt">
                      <strong>{discount.percentage}</strong><small>%</small>
                    </span>
                    <span className="mcc-discount-row__balance" data-label="Kvar">
                      {discount.balance} {discount.balance === 1 ? "gång" : "gånger"}
                    </span>
                    <span className="mcc-discount-row__validity" data-label="Giltighet">
                      {formatValidity(discount.expireAt)}
                    </span>
                    <span className={`mcc-discount-row__state ${state.tone}`} data-label="Status">
                      <i /> {state.label}
                    </span>
                    <span className="mcc-discount-row__arrow" aria-hidden="true"><ArrowIcon /></span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="mcc-discount-empty">
              <span>01</span>
              <div>
                <h3>Här är det tomt än så länge.</h3>
                <p>Skapa din första rabattkod. Du väljer procentsats, antal användningar och om koden ska ha ett slutdatum.</p>
                <Link to="/admin/discounts/new">Skapa en rabatt <span aria-hidden="true"><ArrowIcon /></span></Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
