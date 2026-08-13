import {
  data as json,
  Outlet,
  ShouldRevalidateFunction,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useParams,
} from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Types } from "mongoose";
import { auth } from "~/services/auth.server";
import { Orders as OrderEntity } from "~/schemas/orders";
import ordersStyles from "~/styles/orders.css?url";
import ArrowIcon from "~/components/ArrowIcon";
import PlusMinusIcon from "~/components/PlusMinusIcon";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: ordersStyles },
];

enum Status {
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  SHIPPED = "SHIPPED",
  CANCELED = "CANCELED",
  PAID_REVIEW = "PAID_REVIEW",
  MANUAL_PROCESSING = "MANUAL_PROCESSING",
}

type StatusTone =
  | "paid"
  | "failed"
  | "shipped"
  | "canceled"
  | "review"
  | "manual";

type StatusMeta = {
  label: string;
  shortLabel: string;
  tone: StatusTone;
};

const statusMeta: Record<Status, StatusMeta> = {
  [Status.SUCCESS]: { label: "Betald", shortLabel: "Betald", tone: "paid" },
  [Status.FAILED]: {
    label: "Betalning misslyckades",
    shortLabel: "Misslyckad",
    tone: "failed",
  },
  [Status.SHIPPED]: {
    label: "Skickad",
    shortLabel: "Skickad",
    tone: "shipped",
  },
  [Status.CANCELED]: {
    label: "Avbruten",
    shortLabel: "Avbruten",
    tone: "canceled",
  },
  [Status.PAID_REVIEW]: {
    label: "Betald · kontrollera",
    shortLabel: "Kontrollera",
    tone: "review",
  },
  [Status.MANUAL_PROCESSING]: {
    label: "Manuell order",
    shortLabel: "Manuell",
    tone: "manual",
  },
};

const statusFor = (status: Status) =>
  statusMeta[status] ?? statusMeta[Status.SUCCESS];

export type Order = {
  status: Status;
  _id: string;
  createdAt: string;
  customer: {
    firstname?: string;
    lastname?: string;
  };
  totalSum: number;
};

type Filter = "all" | "todo" | "shipped" | "attention";

type OrderCounts = Record<Filter, number>;

type OrdersLoaderData = {
  applied: {
    filter: Filter;
    search: string;
  };
  counts: OrderCounts;
  matchingCount: number;
  orders: Order[];
  orderValue: number;
  pageInfo: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};

type OrderResultsState = {
  appliedLoaderData: OrdersLoaderData;
  appliedMoreData: OrdersLoaderData | undefined;
  appliedResultsData: OrdersLoaderData | undefined;
  displayedQueryKey: string;
  matchingCount: number;
  orders: Order[];
  pageInfo: OrdersLoaderData["pageInfo"];
};

type OrderStats = {
  all: number;
  attention: number;
  orderValue: number;
  shipped: number;
  todo: number;
};

const PAGE_SIZE = 50;

const includedStatuses = Object.values(Status);
const todoStatuses = [
  Status.SUCCESS,
  Status.MANUAL_PROCESSING,
  Status.PAID_REVIEW,
];
const attentionStatuses = [
  Status.FAILED,
  Status.CANCELED,
  Status.PAID_REVIEW,
];

const filterStatuses: Record<Exclude<Filter, "all">, Status[]> = {
  attention: attentionStatuses,
  shipped: [Status.SHIPPED],
  todo: todoStatuses,
};

const filters: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Alla" },
  { key: "todo", label: "Att hantera" },
  { key: "shipped", label: "Skickade" },
  { key: "attention", label: "Behöver koll" },
];

const parseFilter = (value: string | null): Filter =>
  filters.some((filter) => filter.key === value) ? (value as Filter) : "all";

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildSearchCondition = (search: string) => {
  const regex = new RegExp(escapeRegex(search), "i");
  const normalizedSearch = search.toLocaleLowerCase("sv-SE");
  const matchingStatuses = Object.entries(statusMeta)
    .filter(([, meta]) =>
      `${meta.label} ${meta.shortLabel}`
        .toLocaleLowerCase("sv-SE")
        .includes(normalizedSearch)
    )
    .map(([status]) => status);
  const numericSearch = Number(search.replace(",", ".").replace(/[^0-9.-]/g, ""));
  const conditions: Record<string, unknown>[] = [
    {
      $expr: {
        $regexMatch: {
          input: { $toString: "$_id" },
          regex,
        },
      },
    },
    {
      $expr: {
        $regexMatch: {
          input: {
            $concat: [
              { $ifNull: ["$customer.firstname", ""] },
              " ",
              { $ifNull: ["$customer.lastname", ""] },
            ],
          },
          regex,
        },
      },
    },
  ];

  if (matchingStatuses.length) {
    conditions.push({ status: { $in: matchingStatuses } });
  }

  if (Number.isFinite(numericSearch) && /\d/.test(search)) {
    conditions.push({ totalSum: numericSearch });
  }

  return { $or: conditions };
};

type DecodedCursor = {
  createdAt: Date;
  id: Types.ObjectId;
};

const decodeCursor = (value: string | null): DecodedCursor | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const createdAt = new Date(parsed.createdAt);

    if (
      Number.isNaN(createdAt.getTime()) ||
      !Types.ObjectId.isValid(parsed.id)
    ) {
      return null;
    }

    return { createdAt, id: new Types.ObjectId(parsed.id) };
  } catch {
    return null;
  }
};

const encodeCursor = (order: { createdAt?: unknown; _id: unknown }) => {
  const createdAt =
    order.createdAt instanceof Date
      ? order.createdAt
      : new Date(String(order.createdAt ?? ""));
  const id = String(order._id);

  if (Number.isNaN(createdAt.getTime()) || !Types.ObjectId.isValid(id)) {
    return null;
  }

  return Buffer.from(
    JSON.stringify({
      createdAt: createdAt.toISOString(),
      id,
    })
  ).toString("base64url");
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const url = new URL(request.url);
  const filter = parseFilter(url.searchParams.get("filter"));
  const search = url.searchParams.get("q")?.trim().slice(0, 120) ?? "";
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const includeSummary = url.searchParams.get("partial") !== "1";
  const baseMatch = {
    status: { $in: includedStatuses },
  };
  const filteredConditions: Record<string, unknown>[] = [baseMatch];

  if (filter !== "all") {
    filteredConditions.push({ status: { $in: filterStatuses[filter] } });
  }

  if (search) {
    filteredConditions.push(buildSearchCondition(search));
  }

  const filteredMatch =
    filteredConditions.length === 1
      ? baseMatch
      : { $and: filteredConditions };
  const pageMatch = cursor
    ? {
        $and: [
          filteredMatch,
          {
            $or: [
              { createdAt: { $lt: cursor.createdAt } },
              {
                createdAt: cursor.createdAt,
                _id: { $lt: cursor.id },
              },
            ],
          },
        ],
      }
    : filteredMatch;
  const needsMatchingCount =
    !cursor && (!includeSummary || filter !== "all" || Boolean(search));

  const [pageDocuments, queriedMatchingCount, statsRows] = await Promise.all([
    OrderEntity.find(pageMatch, {
      status: 1,
      createdAt: 1,
      customer: 1,
      _id: 1,
      totalSum: 1,
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAGE_SIZE + 1)
      .lean(),
    needsMatchingCount
      ? OrderEntity.countDocuments(filteredMatch)
      : Promise.resolve(-1),
    includeSummary
      ? OrderEntity.aggregate<OrderStats>([
          { $match: baseMatch },
          {
            $group: {
              _id: null,
              all: { $sum: 1 },
              attention: {
                $sum: {
                  $cond: [{ $in: ["$status", attentionStatuses] }, 1, 0],
                },
              },
              orderValue: {
                $sum: {
                  $cond: [
                    { $in: ["$status", [Status.FAILED, Status.CANCELED]] },
                    0,
                    { $ifNull: ["$totalSum", 0] },
                  ],
                },
              },
              shipped: {
                $sum: {
                  $cond: [{ $eq: ["$status", Status.SHIPPED] }, 1, 0],
                },
              },
              todo: {
                $sum: { $cond: [{ $in: ["$status", todoStatuses] }, 1, 0] },
              },
            },
          },
        ])
      : Promise.resolve([] as OrderStats[]),
  ]);

  const hasMore = pageDocuments.length > PAGE_SIZE;
  const visibleDocuments = pageDocuments.slice(0, PAGE_SIZE);
  const lastDocument = visibleDocuments.at(-1);
  const nextCursor = hasMore && lastDocument ? encodeCursor(lastDocument) : null;
  const stats = statsRows[0] ?? {
    all: 0,
    attention: 0,
    orderValue: 0,
    shipped: 0,
    todo: 0,
  };
  const matchingCount = cursor
    ? -1
    : needsMatchingCount
      ? queriedMatchingCount
      : Number(stats.all ?? 0);
  const orders: Order[] = visibleDocuments.map((order) => ({
    _id: String(order._id),
    createdAt: order.createdAt?.toISOString() ?? "",
    customer: {
      firstname: order.customer?.firstname,
      lastname: order.customer?.lastname,
    },
    status: order.status as Status,
    totalSum: Number(order.totalSum ?? 0),
  }));

  return json<OrdersLoaderData>({
    applied: { filter, search },
    counts: {
      all: Number(stats.all ?? 0),
      attention: Number(stats.attention ?? 0),
      shipped: Number(stats.shipped ?? 0),
      todo: Number(stats.todo ?? 0),
    },
    matchingCount,
    orders,
    orderValue: Number(stats.orderValue ?? 0),
    pageInfo: {
      hasMore: Boolean(nextCursor),
      nextCursor,
    },
  });
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  defaultShouldRevalidate,
  formMethod,
  nextUrl,
}) => {
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate;

  const staysInOrders =
    currentUrl.pathname.startsWith("/admin/orders") &&
    nextUrl.pathname.startsWith("/admin/orders");

  if (staysInOrders && currentUrl.search === nextUrl.search) return false;
  return defaultShouldRevalidate;
};

const formatPrice = (amount: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);

const formatOrderDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Datum saknas";

  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  })
    .format(date)
    .replace(" kl. ", " · ");
};

const shortOrderNumber = (orderId: string) =>
  `#${orderId.slice(-8).toLocaleUpperCase("sv-SE")}`;

const fixedWorkspaceMedia =
  "(min-width: 960px) and (min-height: 620px)";

const getQueryKey = (filter: Filter, search: string) =>
  `${filter}\u0000${search.trim()}`;

const replaceOrderResults = (
  current: OrderResultsState,
  data: OrdersLoaderData,
  displayedQueryKey: string
): OrderResultsState => ({
  ...current,
  displayedQueryKey,
  matchingCount:
    data.matchingCount >= 0 ? data.matchingCount : current.matchingCount,
  orders: data.orders,
  pageInfo: data.pageInfo,
});

const appendOrderResults = (
  current: OrderResultsState,
  data: OrdersLoaderData
): OrderResultsState => {
  const knownOrderIds = new Set(current.orders.map((order) => order._id));
  return {
    ...current,
    matchingCount:
      data.matchingCount >= 0 ? data.matchingCount : current.matchingCount,
    orders: [
      ...current.orders,
      ...data.orders.filter((order) => !knownOrderIds.has(order._id)),
    ],
    pageInfo: data.pageInfo,
  };
};

const synchronizeOrderResults = ({
  activeQueryKey,
  current,
  loaderData,
  moreData,
  resultsData,
}: {
  activeQueryKey: string;
  current: OrderResultsState;
  loaderData: OrdersLoaderData;
  moreData: OrdersLoaderData | undefined;
  resultsData: OrdersLoaderData | undefined;
}): OrderResultsState => {
  let next = current;

  if (next.appliedLoaderData !== loaderData) {
    next = { ...next, appliedLoaderData: loaderData };
    const responseKey = getQueryKey(
      loaderData.applied.filter,
      loaderData.applied.search
    );
    if (responseKey === activeQueryKey) {
      next = replaceOrderResults(next, loaderData, responseKey);
    }
  }

  if (next.appliedResultsData !== resultsData) {
    next = { ...next, appliedResultsData: resultsData };
    if (resultsData) {
      const responseKey = getQueryKey(
        resultsData.applied.filter,
        resultsData.applied.search
      );
      if (responseKey === activeQueryKey) {
        next = replaceOrderResults(next, resultsData, responseKey);
      }
    }
  }

  if (next.appliedMoreData !== moreData) {
    next = { ...next, appliedMoreData: moreData };
    if (moreData) {
      const responseKey = getQueryKey(
        moreData.applied.filter,
        moreData.applied.search
      );
      if (
        responseKey === activeQueryKey &&
        next.displayedQueryKey === responseKey
      ) {
        next = appendOrderResults(next, moreData);
      }
    }
  }

  return next;
};

const getOrdersRequestUrl = (
  filter: Filter,
  search: string,
  cursor?: string | null
) => {
  const params = new URLSearchParams();
  const trimmedSearch = search.trim();

  if (filter !== "all") params.set("filter", filter);
  if (trimmedSearch) params.set("q", trimmedSearch);
  if (cursor) params.set("cursor", cursor);
  params.set("partial", "1");

  const query = params.toString();
  return query ? `/admin/orders?${query}` : "/admin/orders";
};

export default function Orders() {
  const data = useLoaderData<OrdersLoaderData>();
  const resultsFetcher = useFetcher<OrdersLoaderData>();
  const loadOrderResults = resultsFetcher.load;
  const moreFetcher = useFetcher<OrdersLoaderData>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const { id } = useParams();
  const [filter, setFilter] = useState<Filter>(data.applied.filter);
  const [search, setSearch] = useState(data.applied.search);
  const [results, setResults] = useState<OrderResultsState>(() => ({
    appliedLoaderData: data,
    appliedMoreData: undefined,
    appliedResultsData: undefined,
    displayedQueryKey: getQueryKey(data.applied.filter, data.applied.search),
    matchingCount: data.matchingCount,
    orders: data.orders,
    pageInfo: data.pageInfo,
  }));
  const [lastViewedId, setLastViewedId] = useState<string | undefined>(id);
  const previousOrderIdRef = useRef(id);
  const navigationScrollPositionRef = useRef<number | null>(null);
  const navigationListScrollPositionRef = useRef<number | null>(null);
  const didInitializeQueryRef = useRef(false);
  const activeQueryKey = getQueryKey(filter, search);
  const synchronizedResults = synchronizeOrderResults({
    activeQueryKey,
    current: results,
    loaderData: data,
    moreData: moreFetcher.data,
    resultsData: resultsFetcher.data,
  });
  if (synchronizedResults !== results) {
    setResults(synchronizedResults);
  }

  const { displayedQueryKey, matchingCount, orders, pageInfo } = results;
  const isQueryPending =
    activeQueryKey !== displayedQueryKey || resultsFetcher.state !== "idle";
  const isLoadingMore = moreFetcher.state !== "idle";
  const remainingCount = Math.max(0, matchingCount - orders.length);

  useEffect(() => {
    const html = document.documentElement;
    const fixedWorkspace = window.matchMedia(fixedWorkspaceMedia);
    let firstFrame = 0;
    let secondFrame = 0;

    const resetFixedWorkspaceScroll = () => {
      if (!fixedWorkspace.matches) return;

      const previousBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      window.scrollTo({ top: 0, behavior: "auto" });
      html.style.scrollBehavior = previousBehavior;
    };

    const syncFixedWorkspace = () => {
      resetFixedWorkspaceScroll();
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      firstFrame = window.requestAnimationFrame(() => {
        resetFixedWorkspaceScroll();
        secondFrame = window.requestAnimationFrame(resetFixedWorkspaceScroll);
      });
    };

    html.classList.add("orders-scroll-context");
    fixedWorkspace.addEventListener("change", syncFixedWorkspace);
    syncFixedWorkspace();

    return () => {
      fixedWorkspace.removeEventListener("change", syncFixedWorkspace);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      html.classList.remove("orders-scroll-context");
    };
  }, []);

  useEffect(() => {
    if (!didInitializeQueryRef.current) {
      didInitializeQueryRef.current = true;
      return;
    }

    const timeout = window.setTimeout(
      () => loadOrderResults(getOrdersRequestUrl(filter, search)),
      search.trim() === data.applied.search ? 0 : 280
    );

    return () => window.clearTimeout(timeout);
  }, [data.applied.search, filter, loadOrderResults, search]);

  const loadMoreOrders = () => {
    if (!pageInfo.nextCursor || isLoadingMore || isQueryPending) return;

    moreFetcher.load(
      getOrdersRequestUrl(filter, search, pageInfo.nextCursor)
    );
  };

  const openOrder = (orderId: string) => {
    const isCompact = window.matchMedia("(max-width: 959px)").matches;
    const closesCurrentOrder = id === orderId;

    sessionStorage.setItem("ordersScrollPosition", window.scrollY.toString());
    sessionStorage.setItem("ordersLastViewedId", orderId);
    navigationScrollPositionRef.current = window.scrollY;
    navigationListScrollPositionRef.current =
      document.querySelector<HTMLElement>(".orders-list")?.scrollTop ?? null;
    setLastViewedId(orderId);

    navigate(
      closesCurrentOrder ? "/admin/orders" : `/admin/orders/${orderId}`,
      { preventScrollReset: !isCompact }
    );
  };

  useEffect(() => {
    if (navigation.state !== "idle" || previousOrderIdRef.current === id) {
      return;
    }

    const isCompact = window.matchMedia("(max-width: 959px)").matches;
    const usesFixedWorkspace = window.matchMedia(fixedWorkspaceMedia).matches;
    const previousId = previousOrderIdRef.current;
    const persistedPosition = sessionStorage.getItem("ordersScrollPosition");
    const persistedOrderId = sessionStorage.getItem("ordersLastViewedId");
    const parsedPersistedPosition =
      persistedPosition === null ? null : Number(persistedPosition);
    const storedPosition =
      navigationScrollPositionRef.current ??
      (persistedOrderId === previousId &&
      parsedPersistedPosition !== null &&
      Number.isFinite(parsedPersistedPosition)
        ? parsedPersistedPosition
        : null);
    const storedListPosition = navigationListScrollPositionRef.current;
    previousOrderIdRef.current = id;

    if (isCompact && id) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    if (storedPosition !== null) {
      const restorePosition = () => {
        const html = document.documentElement;
        const previousBehavior = html.style.scrollBehavior;
        html.style.scrollBehavior = "auto";
        window.scrollTo({
          top: usesFixedWorkspace ? 0 : storedPosition,
          behavior: "auto",
        });
        html.style.scrollBehavior = previousBehavior;

        const list = document.querySelector<HTMLElement>(".orders-list");
        if (!isCompact && list && storedListPosition !== null) {
          list.scrollTop = storedListPosition;
        }

        if (isCompact && !id) {
          const orderId = lastViewedId ?? persistedOrderId;
          if (orderId) {
            document
              .getElementById(`order-${orderId}`)
              ?.focus({ preventScroll: true });
          }
        }
      };

      restorePosition();
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        restorePosition();
        secondFrame = window.requestAnimationFrame(restorePosition);
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }
  }, [id, lastViewedId, navigation.state]);

  return (
    <main className={`orders-page${id ? " orders-page--detail" : ""}`}>
      <div className="orders-shell">
        <header className="orders-header">
          <div>
            <p className="orders-kicker">Ateljén · administration</p>
            <h1>Ordrar</h1>
            <p className="orders-intro">
              Från betalning till packad beställning — de senaste ordrarna
              först, med fler på begäran.
            </p>
          </div>
          <p className="orders-header-note">
            <span>Uppdaterad vy</span>
            Öppna en order för leverans och bokföring
          </p>
        </header>

        <section className="orders-summary" aria-label="Orderöversikt">
          <div>
            <span>Att hantera</span>
            <strong>{data.counts.todo}</strong>
          </div>
          <div>
            <span>Skickade</span>
            <strong>{data.counts.shipped}</strong>
          </div>
          <div>
            <span>Ordervärde</span>
            <strong>{formatPrice(data.orderValue)}</strong>
          </div>
        </section>

        <section
          aria-busy={isQueryPending || undefined}
          aria-label="Sök och filtrera ordrar"
          className="orders-tools"
        >
          <label className="orders-search" htmlFor="order-search">
            <span aria-hidden="true" className="orders-search-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
              >
                <circle cx="10.5" cy="10.5" r="5.75" />
                <path d="m15 15 4.25 4.25" />
              </svg>
            </span>
            <span className="sr-only">Sök bland ordrar</span>
            <input
              id="order-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på kund eller ordernummer"
              type="search"
              value={search}
            />
            {isQueryPending ? (
              <span
                aria-label="Söker bland alla ordrar"
                className="orders-search-progress"
                role="status"
              >
                <i aria-hidden="true" />
              </span>
            ) : null}
            {search ? (
              <button onClick={() => setSearch("")} type="button">
                Rensa
              </button>
            ) : null}
          </label>

          <div className="orders-filters" role="group" aria-label="Orderfilter">
            {filters.map((item) => (
              <button
                aria-pressed={filter === item.key}
                className={filter === item.key ? "is-active" : ""}
                key={item.key}
                onClick={() => setFilter(item.key)}
                type="button"
              >
                <span>{item.label}</span>
                <small>{data.counts[item.key]}</small>
              </button>
            ))}
          </div>
        </section>

        <div
          className={`orders-workspace${id ? " orders-workspace--detail" : ""}`}
        >
          <section className="orders-list" aria-label="Ordrar">
            <div className="orders-list-heading">
              <div>
                <h2>Beställningar</h2>
                <p>
                  {isQueryPending
                    ? "Söker i orderhistoriken…"
                    : matchingCount === 1
                      ? "Visar 1 order"
                      : `Visar ${orders.length} av ${matchingCount} ordrar`}
                </p>
              </div>
              {filter !== "all" || search ? (
                <button
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                  }}
                  type="button"
                >
                  Visa alla
                </button>
              ) : null}
            </div>

            {orders.length ? (
              <>
                <ol className="orders-order-list">
                {orders.map((order) => {
                  const meta = statusFor(order.status);
                  const isSelected = id === order._id;
                  const isOpening =
                    navigation.state !== "idle" &&
                    navigation.location?.pathname ===
                      `/admin/orders/${order._id}`;
                  const wasLastViewed = !id && lastViewedId === order._id;
                  const customerName = [
                    order.customer?.firstname,
                    order.customer?.lastname,
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <li key={order._id}>
                      <button
                        aria-busy={isOpening || undefined}
                        aria-current={isSelected ? "true" : undefined}
                        aria-expanded={isSelected}
                        className={`orders-order-row${
                          isSelected ? " is-selected" : ""
                        }${
                          isOpening ? " is-opening" : ""
                        }${
                          wasLastViewed ? " was-last-viewed" : ""
                        }`}
                        id={`order-${order._id}`}
                        onClick={() => openOrder(order._id)}
                        type="button"
                      >
                        <span className="orders-order-row__identity">
                          <strong>{shortOrderNumber(order._id)}</strong>
                          <small>{formatOrderDate(order.createdAt)}</small>
                        </span>
                        <span className="orders-order-row__customer">
                          <strong>{customerName || "Kundnamn saknas"}</strong>
                          <small className={`orders-compact-status tone-${meta.tone}`}>
                            {meta.shortLabel}
                          </small>
                        </span>
                        <span
                          className={`orders-status tone-${meta.tone}`}
                        >
                          {meta.label}
                        </span>
                        <span className="orders-order-row__price">
                          {formatPrice(order.totalSum)}
                        </span>
                        <span className="orders-order-row__arrow" aria-hidden="true">
                          {isSelected ? (
                            <PlusMinusIcon operation="minus" />
                          ) : (
                            <ArrowIcon direction="up-right" />
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
                </ol>
                {!isQueryPending && pageInfo.hasMore ? (
                  <div className="orders-load-more">
                    <button
                      disabled={isLoadingMore}
                      onClick={loadMoreOrders}
                      type="button"
                    >
                      <span>
                        {isLoadingMore ? "Hämtar fler…" : "Ladda fler ordrar"}
                      </span>
                      <small>{remainingCount} kvar</small>
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="orders-empty">
                <span aria-hidden="true">○</span>
                <h2>
                  {data.counts.all ? "Inga ordrar matchar" : "Inga ordrar ännu"}
                </h2>
                <p>
                  {data.counts.all
                    ? "Prova ett annat kundnamn, ordernummer eller filter."
                    : "När en beställning är genomförd kommer den att visas här."}
                </p>
              </div>
            )}
          </section>

          {id ? (
            <aside
              className="orders-detail-pane"
              id="order-detail"
              key={id}
            >
              <Outlet />
            </aside>
          ) : (
            <aside className="orders-detail-placeholder" aria-hidden="true">
              <span>01</span>
              <div>
                <p className="orders-kicker">Orderflöde</p>
                <h2>Välj en beställning</h2>
                <p>
                  Här visas kundens uppgifter, orderrader och nästa steg för
                  leverans och bokföring.
                </p>
              </div>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
