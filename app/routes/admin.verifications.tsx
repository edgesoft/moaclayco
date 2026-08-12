import { data as json, LoaderFunction } from "react-router";
import {
  Link,
  Outlet,
  ShouldRevalidateFunction,
  useLoaderData,
  useLocation,
  useSearchParams,
} from "react-router";
import { useMemo, useState } from "react";
import { ListVerification } from "~/components/admin/listVerification";
import { Verifications } from "~/schemas/verifications";
import { auth } from "~/services/auth.server";
import { VerificationProps } from "~/types";
import {
  accountingMonthKey,
  accountingMonthKeyForVerification,
  getAccountingYearBounds,
} from "~/utils/accountingDates";
import { getDomain } from "~/utils/domain";

const normalizePathname = (pathname: string) => pathname.replace(/\/+$/, "");
const verificationNumberFrom = (verification: unknown) => {
  if (!verification || Array.isArray(verification) || typeof verification !== "object") {
    return 0;
  }

  const verificationNumber = (
    verification as { verificationNumber?: unknown }
  ).verificationNumber;
  return typeof verificationNumber === "number" ? verificationNumber : 0;
};

export const loader: LoaderFunction = async ({ request, url }) => {
  const user = await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);
  const pathname = normalizePathname(url.pathname);
  const isOverview = pathname === "/admin/verifications";
  const needsLatestVerificationNumber = pathname.endsWith("/new");
  const currentYearMonth = accountingMonthKey(new Date()) as string;
  const fiscalBounds = getAccountingYearBounds(user.fiscalYear);
  if (!fiscalBounds) {
    throw new Response("Ogiltigt bokföringsår", { status: 400 });
  }

  if (!isOverview) {
    const latestVerification = needsLatestVerificationNumber
      ? await Verifications.findOne({ domain: domain?.domain })
          .sort({ verificationNumber: -1 })
          .select("verificationNumber")
          .lean()
          .exec()
      : null;

    return json({
      verifications: [],
      year: user.fiscalYear,
      currentYearMonth,
      latestVerificationNumber: verificationNumberFrom(latestVerification),
      vatReports: [],
    });
  }

  const verificationsPromise = Verifications.find({
    verificationDate: {
      $gte: fiscalBounds.start,
      $lt: fiscalBounds.end,
    },
    domain: domain?.domain,
  })
    .select(
      "recordType description verificationNumber verificationDate metadata files journalEntries"
    )
    .sort({ verificationDate: -1 })
    .lean()
    .exec();

  const vatReportsPromise = Verifications.find({
    domain: domain?.domain,
    metadata: {
      $elemMatch: {
        key: "vatReport",
        value: { $regex: `^${user.fiscalYear}-(0[1-9]|1[0-2])$` },
      },
    },
  })
    .select(
      "recordType description verificationNumber verificationDate metadata files journalEntries"
    )
    .lean()
    .exec();

  const latestVerificationNumberPromise = Verifications.findOne({
    domain: domain?.domain,
  })
    .sort({ verificationNumber: -1 })
    .select("verificationNumber")
    .lean()
    .exec();

  const [verifications, latestVerification, vatReports] = await Promise.all([
    verificationsPromise,
    latestVerificationNumberPromise,
    vatReportsPromise,
  ]);

  return json({
    verifications,
    year: user.fiscalYear,
    currentYearMonth,
    latestVerificationNumber: verificationNumberFrom(latestVerification),
    vatReports,
  });
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  const currentPath = normalizePathname(currentUrl.pathname);
  const nextPath = normalizePathname(nextUrl.pathname);
  const overviewPath = "/admin/verifications";

  // En sparad eller registrerad bokföringshändelse ska alltid slå igenom direkt.
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;

  // Behåll den redan hämtade översikten när en undervy öppnas. Annars ersätts
  // listan av den avsiktligt lätta child-loadern och webbläsarens Tillbaka kan
  // återställa en tom översikt från historiken.
  if (currentPath === overviewPath && nextPath !== overviewPath) return false;

  // När användaren återvänder från en undervy ska aktuell bokföring alltid
  // hämtas, även vid browser back/forward där Remix annars kan återanvända data.
  if (nextPath === overviewPath && currentPath !== overviewPath) return true;

  const opensOrStaysOnReport = nextPath.endsWith("/financial-overview");

  return opensOrStaysOnReport ? false : defaultShouldRevalidate;
};

const groupByMonth = (verifications: VerificationProps[]) => {
  const grouped: Record<string, VerificationProps[]> = {};

  verifications.forEach((verification) => {
    const monthKey = accountingMonthKeyForVerification(verification);
    if (!monthKey) return;

    grouped[monthKey] ||= [];
    grouped[monthKey].push(verification);
  });

  Object.values(grouped).forEach((month) => {
    month.sort((a, b) => {
      const dateDifference =
        new Date(b.verificationDate).getTime() -
        new Date(a.verificationDate).getTime();
      return dateDifference || b.verificationNumber - a.verificationNumber;
    });
  });

  return grouped;
};

const elapsedFiscalMonthKeys = (year: number, currentYearMonth: string) => {
  const [currentYear, currentMonth] = currentYearMonth.split("-").map(Number);
  const lastMonth =
    year < currentYear ? 12 : year === currentYear ? Math.max(0, currentMonth - 1) : 0;
  return Array.from(
    { length: lastMonth },
    (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`
  );
};

type LoaderData = {
  verifications: VerificationProps[];
  vatReports: VerificationProps[];
  latestVerificationNumber: number;
  year: number;
  currentYearMonth: string;
};

const hasVatReport = (
  verifications: VerificationProps[],
  vatReports: VerificationProps[],
  monthKey: string
) =>
  [...verifications, ...vatReports].find((verification) =>
    verification.metadata?.some(
      (meta) => meta.key === "vatReport" && meta.value === monthKey
    )
  );

const navClass = (active: boolean) =>
  `accounting-tab ${active ? "accounting-tab--active" : ""}`;

export default function VerificationsPage() {
  const {
    verifications,
    year,
    currentYearMonth,
    latestVerificationNumber,
    vatReports,
  } =
    useLoaderData<LoaderData>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");

  const normalizedPath = normalizePathname(location.pathname);
  const isOverview = normalizedPath === "/admin/verifications";
  const isReport = normalizedPath.endsWith("/financial-overview");
  const selectedReport = searchParams.get("report") || "income";

  const displayVerifications = useMemo(() => {
    return verifications;
  }, [verifications]);

  const filteredVerifications = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("sv-SE");
    if (!query) return displayVerifications;

    return displayVerifications.filter((verification) => {
      const searchable = [
        `a${verification.verificationNumber}`,
        verification.verificationNumber,
        verification.description,
        ...verification.journalEntries.map((entry) => entry.account),
      ]
        .join(" ")
        .toLocaleLowerCase("sv-SE");
      return searchable.includes(query);
    });
  }, [displayVerifications, search]);

  const groupedVerifications = useMemo(() => {
    const grouped = groupByMonth(filteredVerifications);
    if (search.trim()) return grouped;

    elapsedFiscalMonthKeys(year, currentYearMonth).forEach((monthKey) => {
      grouped[monthKey] ||= [];
    });
    return grouped;
  }, [currentYearMonth, filteredVerifications, search, year]);
  const monthKeys = Object.keys(groupedVerifications).sort().reverse();
  const attachmentCount = displayVerifications.reduce(
    (sum, verification) => sum + (verification.files?.length || 0),
    0
  );

  return (
    <main className="accounting-page min-h-screen text-slate-900">
      <div className="accounting-shell mx-auto w-full px-4 py-7 sm:px-7 sm:py-10">
        <header className="accounting-header mb-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="accounting-kicker mb-2 text-xs font-bold uppercase tracking-[0.18em]">
                Ekonomi
              </p>
              <h1 className="accounting-title text-4xl tracking-tight sm:text-5xl">
                Bokföring
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
                Verifikationer och rapporter för bokföringsår {year}.
              </p>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-2 sm:flex">
              <Link
                to="/admin/verifications/settings"
                prefetch="intent"
                className="accounting-secondary-action"
              >
                År&nbsp; <span>{year}</span>
                <span aria-hidden="true" className="ml-2 opacity-50">⌄</span>
              </Link>
              <Link
                to="/admin/verifications/new"
                prefetch="intent"
                className="accounting-primary-action"
              >
                <span aria-hidden="true" className="mr-2 text-base leading-none">+</span>
                <span className="hidden sm:inline">Ny verifikation</span>
                <span className="sm:hidden">Ny</span>
              </Link>
            </div>
          </div>

          <nav
            aria-label="Bokföring"
            className="accounting-nav mt-7 grid grid-cols-3"
          >
            <Link to="/admin/verifications" className={navClass(isOverview)}>
              Verifikationer
            </Link>
            <Link
              to="/admin/verifications/financial-overview?report=income"
              prefetch="intent"
              className={navClass(isReport && selectedReport === "income")}
            >
              Resultat
            </Link>
            <Link
              to="/admin/verifications/financial-overview?report=balance"
              prefetch="intent"
              className={navClass(isReport && selectedReport === "balance")}
            >
              Balans
            </Link>
          </nav>
        </header>

        <Outlet context={{ latestVerificationNumber }} />

        {isOverview ? (
          <div className="space-y-5">
            <section className="accounting-summary-line grid grid-cols-3" aria-label="Översikt">
              <div className="accounting-summary-item">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 sm:text-xs">
                  Verifikationer
                </p>
                <p className="mt-1 text-xl text-stone-900 sm:text-2xl">
                  {displayVerifications.length}
                </p>
              </div>
              <div className="accounting-summary-item">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 sm:text-xs">
                  Senaste nummer
                </p>
                <p className="mt-1 text-xl text-stone-900 sm:text-2xl">
                  {latestVerificationNumber ? `A${latestVerificationNumber}` : "—"}
                </p>
              </div>
              <div className="accounting-summary-item">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 sm:text-xs">
                  Bilagor
                </p>
                <p className="mt-1 text-xl text-stone-900 sm:text-2xl">
                  {attachmentCount}
                </p>
              </div>
            </section>

            <section className="accounting-search-shell">
              <label htmlFor="verification-search" className="sr-only">
                Sök bland verifikationer
              </label>
              <div className="accounting-search flex h-12 items-center px-4">
                <span
                  aria-hidden="true"
                  className="mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fbf3ef] text-[#985744]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    className="h-5 w-5"
                  >
                    <circle cx="10.5" cy="10.5" r="5.75" />
                    <path d="m15 15 4.25 4.25" />
                  </svg>
                </span>
                <input
                  id="verification-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Sök på nummer, beskrivning eller konto"
                  className="accounting-search-input min-w-0 flex-1 border-0 bg-transparent py-3 text-base text-stone-900 outline-none placeholder:text-stone-400 sm:text-sm"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="ml-2 inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-stone-200 bg-[#fffdf9] px-3 text-xs font-bold text-stone-600 transition hover:border-[#c58a79] hover:bg-[#fbf3ef] hover:text-[#985744] focus:outline-none focus:ring-2 focus:ring-[#e7c8be]"
                  >
                    <span aria-hidden="true" className="text-base leading-none text-[#985744]">×</span>
                    Rensa
                  </button>
                ) : null}
              </div>
            </section>

            {monthKeys.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                <p className="text-lg font-bold text-slate-900">
                  {search ? "Inga träffar" : `Inga verifikationer för ${year}`}
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {search
                    ? "Prova ett annat verifikationsnummer, en beskrivning eller ett kontonummer."
                    : "Skapa årets första verifikation eller ladda upp ett underlag för att komma igång."}
                </p>
                {!search ? (
                  <Link
                    to="/admin/verifications/new"
                    className="mt-5 inline-flex h-12 items-center justify-center rounded-2xl border border-[#a85f4b] bg-[#a85f4b] px-6 text-sm font-bold text-white shadow-[0_7px_18px_rgba(126,67,51,0.14)] transition hover:-translate-y-px hover:border-[#8f4f3e] hover:bg-[#8f4f3e]"
                  >
                    Skapa verifikation <span aria-hidden="true" className="ml-3">→</span>
                  </Link>
                ) : null}
              </section>
            ) : (
              <section className="space-y-3" aria-label="Verifikationer per månad">
                {monthKeys.map((monthKey, index) => (
                  <ListVerification
                    key={monthKey}
                    groupedVerifications={groupedVerifications}
                    vatReportVerification={hasVatReport(
                      verifications,
                      vatReports,
                      monthKey
                    )}
                    monthKey={monthKey}
                    currentYearMonth={currentYearMonth}
                    isExpanded={Boolean(search) || index === 0}
                  />
                ))}
              </section>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
