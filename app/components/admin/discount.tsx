import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useFetcher, useLoaderData } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "react-toastify";
import { z } from "zod";
import { formSchema } from "~/schemas/discount-form";
import { formatDateToUTC } from "~/utils/formatDateToUTC";
import type { DiscountType } from "~/types";
import ArrowIcon from "~/components/ArrowIcon";

type DiscountFormData = z.infer<typeof formSchema>;

type DiscountActionData = {
  error?: string;
  errors?: Record<string, string | undefined>;
};

type CalendarDay = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

const swedishMonth = new Intl.DateTimeFormat("sv-SE", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const swedishDate = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const pad = (value: number) => String(value).padStart(2, "0");

const dateToKey = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const todayKey = () => {
  const today = new Date();
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
};

const splitExpiry = (value: string) => {
  const [date = "", time = "23:59"] = value.split(" ");
  return { date, time: /^\d{2}:\d{2}$/.test(time) ? time : "23:59" };
};

const formatExpiry = (value: string) => {
  const { date, time } = splitExpiry(value);
  if (!date) return "Utan slutdatum";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${swedishDate.format(parsed)} · ${time}`;
};

const createCalendarDays = (year: number, month: number): CalendarDay[] => {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const currentDay = todayKey();

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - firstWeekday + 1));
    return {
      date: dateToKey(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
      isToday: dateToKey(date) === currentDay,
    };
  });
};

const futureDate = ({ days = 0, months = 0 }: { days?: number; months?: number }) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  if (months) date.setUTCMonth(date.getUTCMonth() + months);
  if (days) date.setUTCDate(date.getUTCDate() + days);
  return `${dateToKey(date)} 23:59`;
};

function DiscountDateControl({
  error,
  onChange,
  value,
}: {
  error?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { date: selectedDate, time } = splitExpiry(value);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initialDate = selectedDate
      ? new Date(`${selectedDate}T00:00:00Z`)
      : new Date();
    return {
      month: initialDate.getUTCMonth(),
      year: initialDate.getUTCFullYear(),
    };
  });

  useEffect(() => {
    if (!calendarOpen) return;
    const closeCalendar = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setCalendarOpen(false);
    };
    document.addEventListener("mousedown", closeCalendar);
    return () => document.removeEventListener("mousedown", closeCalendar);
  }, [calendarOpen]);

  const days = useMemo(
    () => createCalendarDays(visibleMonth.year, visibleMonth.month),
    [visibleMonth]
  );

  const moveMonth = (amount: number) => {
    setVisibleMonth((current) => {
      const next = new Date(Date.UTC(current.year, current.month + amount, 1));
      return { month: next.getUTCMonth(), year: next.getUTCFullYear() };
    });
  };

  const chooseDate = (date: string) => {
    const parsed = new Date(`${date}T00:00:00Z`);
    onChange(`${date} ${time}`);
    setVisibleMonth({ month: parsed.getUTCMonth(), year: parsed.getUTCFullYear() });
    setCalendarOpen(false);
  };

  return (
    <div className="mcc-discount-period" ref={wrapperRef}>
      <div className="mcc-discount-quick-periods" aria-label="Snabbval för giltighet">
        <button onClick={() => onChange(futureDate({ days: 7 }))} type="button">7 dagar</button>
        <button onClick={() => onChange(futureDate({ days: 30 }))} type="button">30 dagar</button>
        <button onClick={() => onChange(futureDate({ months: 3 }))} type="button">3 månader</button>
        <button className={!value ? "is-selected" : ""} onClick={() => onChange("")} type="button">
          Utan slutdatum
        </button>
      </div>

      <div className="mcc-discount-date-row">
        <div className="mcc-discount-date-picker">
          <span className="mcc-discount-control-label">Gäller till</span>
          <button
            aria-expanded={calendarOpen}
            aria-haspopup="dialog"
            className={error ? "has-error" : ""}
            onClick={() => setCalendarOpen((open) => !open)}
            type="button"
          >
            <span>{selectedDate ? formatExpiry(value).split(" · ")[0] : "Välj ett datum"}</span>
            <span aria-hidden="true"><ArrowIcon direction="down" /></span>
          </button>

          {calendarOpen ? (
            <div aria-label="Välj slutdatum" className="mcc-discount-calendar" role="dialog">
              <div className="mcc-discount-calendar__header">
                <button aria-label="Föregående månad" onClick={() => moveMonth(-1)} type="button"><ArrowIcon direction="left" /></button>
                <strong>
                  {swedishMonth.format(new Date(Date.UTC(visibleMonth.year, visibleMonth.month, 1)))}
                </strong>
                <button aria-label="Nästa månad" onClick={() => moveMonth(1)} type="button"><ArrowIcon /></button>
              </div>
              <div className="mcc-discount-calendar__weekdays" aria-hidden="true">
                {[
                  "Mån",
                  "Tis",
                  "Ons",
                  "Tor",
                  "Fre",
                  "Lör",
                  "Sön",
                ].map((weekday) => <span key={weekday}>{weekday}</span>)}
              </div>
              <div className="mcc-discount-calendar__days">
                {days.map((day) => (
                  <button
                    aria-current={day.isToday ? "date" : undefined}
                    aria-label={swedishDate.format(new Date(`${day.date}T00:00:00Z`))}
                    aria-pressed={day.date === selectedDate}
                    className={`${day.inMonth ? "" : "is-outside"}${day.isToday ? " is-today" : ""}${day.date === selectedDate ? " is-selected" : ""}`}
                    key={day.date}
                    onClick={() => chooseDate(day.date)}
                    type="button"
                  >
                    {day.day}
                  </button>
                ))}
              </div>
              <button className="mcc-discount-calendar__clear" onClick={() => { onChange(""); setCalendarOpen(false); }} type="button">
                Ingen tidsgräns
              </button>
            </div>
          ) : null}
        </div>

        <div className="mcc-discount-time-picker">
          <span className="mcc-discount-control-label">Klockslag</span>
          <div aria-label="Klockslag" role="radiogroup">
            {["12:00", "18:00", "23:59"].map((option) => (
              <button
                aria-checked={Boolean(selectedDate) && time === option}
                className={Boolean(selectedDate) && time === option ? "is-selected" : ""}
                disabled={!selectedDate}
                key={option}
                onClick={() => onChange(`${selectedDate} ${option}`)}
                role="radio"
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error ? <small className="mcc-discount-period__error">{error}</small> : null}
    </div>
  );
}

function DiscountPreview({ code, percentage, balance, expireAt }: {
  balance: number;
  code: string;
  expireAt: string;
  percentage: number;
}) {
  const isEmpty = !Number.isFinite(balance) || balance <= 0;
  const [currentTime] = useState(Date.now);
  const isExpired = expireAt
    ? new Date(expireAt.replace(" ", "T")).getTime() < currentTime
    : false;
  const state = isEmpty ? "Inga användningar kvar" : isExpired ? "Giltigheten har gått ut" : "Redo att användas";

  return (
    <section className="mcc-editor-section mcc-discount-preview">
      <div className="mcc-editor-section__heading">
        <div>
          <p className="mcc-editor-eyebrow">Förhandsvisning</p>
          <h2>Rabatt</h2>
        </div>
        <span>01</span>
      </div>

      <div className="mcc-discount-ticket">
        <div className="mcc-discount-ticket__percentage">
          <strong>{Number.isFinite(percentage) && percentage > 0 ? percentage : "—"}</strong>
          <span>%</span>
        </div>
        <p>Rabatt på beställningen</p>
        <div className="mcc-discount-ticket__code">
          <span>Kod</span>
          <strong>{code.trim() || "DIN KOD"}</strong>
        </div>
      </div>

      <div className="mcc-discount-preview__summary" aria-live="polite">
        <span className={isEmpty || isExpired ? "is-inactive" : ""} />
        <div>
          <strong>{state}</strong>
          <small>
            {isEmpty
              ? "Öka antalet för att aktivera rabatten igen."
              : `${balance} ${balance === 1 ? "användning" : "användningar"} · ${formatExpiry(expireAt)}`}
          </small>
        </div>
      </div>
    </section>
  );
}

export default function Discount() {
  const discount = useLoaderData<DiscountType | null>();
  const fetcher = useFetcher<DiscountActionData>();
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);

  const {
    formState: { errors, isDirty },
    handleSubmit,
    register,
    setValue,
    watch,
  } = useForm<DiscountFormData>({
    defaultValues: {
      balance: discount?.balance ?? 1,
      code: discount?.code ?? "",
      expireAt: discount?.expireAt ? formatDateToUTC(discount.expireAt) : "",
      percentage: discount?.percentage ?? 10,
    },
    resolver: zodResolver(formSchema),
  });

  const code = watch("code") ?? "";
  const percentage = watch("percentage");
  const balance = watch("balance");
  const expireAt = watch("expireAt") ?? "";
  const isSaving = fetcher.state !== "idle" && fetcher.formData?.get("action") === "save";
  const isDeleting = fetcher.state !== "idle" && fetcher.formData?.get("action") === "delete";
  const serverErrors = fetcher.data?.errors;
  const hasErrors = Boolean(Object.keys(errors).length || serverErrors || fetcher.data?.error);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.warn(fetcher.data.error, {
        autoClose: 1800,
        closeOnClick: true,
        draggable: false,
        hideProgressBar: true,
        pauseOnHover: true,
        position: "top-right",
        theme: "light",
      });
    }
  }, [fetcher.data, fetcher.state]);

  const onSubmit = (formData: DiscountFormData) => {
    fetcher.submit(
      {
        action: "save",
        balance: String(formData.balance),
        code: formData.code.trim(),
        expireAt: formData.expireAt,
        percentage: String(formData.percentage),
      },
      { method: "post" }
    );
  };

  return (
    <main className="mcc-editor-page mcc-discount-editor-page">
      <form className="mcc-editor-form" method="post" onSubmit={handleSubmit(onSubmit)}>
        <header className="mcc-editor-header">
          <div className="mcc-editor-header__topline">
            <Link to="/admin/discounts"><span aria-hidden="true"><ArrowIcon direction="left" /></span> Tillbaka till rabatter</Link>
          </div>
          <div className="mcc-editor-header__title">
            <div>
              <p className="mcc-kicker">Ateljé / Rabatter</p>
              <h1>{discount ? `Redigera ${discount.code}` : "Skapa en ny rabatt"}</h1>
            </div>
          </div>
        </header>

        {hasErrors ? (
          <div className="mcc-editor-error-summary" role="alert">
            <strong>Det finns något kvar att ordna.</strong>
            <ul>
              {Object.entries(errors).map(([field, error]) =>
                error?.message ? <li key={field}>{error.message}</li> : null
              )}
              {Object.entries(serverErrors ?? {}).map(([key, message]) => message ? <li key={key}>{message}</li> : null)}
              {fetcher.data?.error ? <li>{fetcher.data.error}</li> : null}
            </ul>
          </div>
        ) : null}

        <div className="mcc-editor-workspace mcc-discount-editor-workspace">
          <DiscountPreview
            balance={Number.isFinite(balance) ? balance : 0}
            code={code}
            expireAt={expireAt}
            percentage={Number.isFinite(percentage) ? percentage : 0}
          />

          <div className="mcc-editor-copy-column">
            <section className="mcc-editor-section">
              <div className="mcc-editor-section__heading">
                <div>
                  <p className="mcc-editor-eyebrow">Grunduppgifter</p>
                  <h2>Kod & värde</h2>
                </div>
                <span>02</span>
              </div>

              <div className="mcc-editor-fields">
                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>Rabattkod <b>*</b></span>
                  <input
                    aria-invalid={Boolean(errors.code || serverErrors?.code)}
                    autoCapitalize="characters"
                    autoComplete="off"
                    placeholder="Till exempel SOMMAR20"
                    spellCheck={false}
                    type="text"
                    {...register("code")}
                  />
                  {errors.code?.message ? <small>{errors.code.message}</small> : null}
                </label>

                <label className="mcc-editor-field">
                  <span>Rabatt <b>*</b></span>
                  <span className="mcc-editor-input-suffix">
                    <input
                      aria-invalid={Boolean(errors.percentage || serverErrors?.percentage)}
                      inputMode="numeric"
                      max="100"
                      min="1"
                      placeholder="10"
                      step="1"
                      type="number"
                      {...register("percentage", { valueAsNumber: true })}
                    />
                    <span>%</span>
                  </span>
                  {errors.percentage?.message ? <small>{errors.percentage.message}</small> : null}
                </label>

                <label className="mcc-editor-field">
                  <span>Antal användningar <b>*</b></span>
                  <input
                    aria-invalid={Boolean(errors.balance || serverErrors?.balance)}
                    inputMode="numeric"
                    min="0"
                    placeholder="1"
                    step="1"
                    type="number"
                    {...register("balance", { valueAsNumber: true })}
                  />
                  {errors.balance?.message ? <small>{errors.balance.message}</small> : <small className="mcc-editor-field__hint">Sätt 0 för att pausa koden.</small>}
                </label>
              </div>
            </section>

            <section className="mcc-editor-section">
              <div className="mcc-editor-section__heading">
                <div>
                  <p className="mcc-editor-eyebrow">Giltighet</p>
                  <h2>Period</h2>
                </div>
                <span>03</span>
              </div>
              <input type="hidden" {...register("expireAt")} />
              <DiscountDateControl
                error={errors.expireAt?.message ?? serverErrors?.expireAt}
                onChange={(nextValue) => setValue("expireAt", nextValue, { shouldDirty: true, shouldValidate: true })}
                value={expireAt}
              />
              <p className="mcc-discount-period-note">
                Lämna utan slutdatum om rabatten ska gälla tills antalet användningar är slut.
              </p>
            </section>
          </div>
        </div>

        {discount ? (
          <section className="mcc-collection-danger mcc-discount-danger">
            <div>
              <p className="mcc-editor-eyebrow">Riskzon</p>
              <h2>Ta bort rabatt</h2>
              <p>Koden {discount.code} slutar fungera direkt och kan inte återställas.</p>
            </div>
            {!deleteConfirmation ? (
              <button onClick={() => setDeleteConfirmation(true)} type="button">Ta bort rabatt</button>
            ) : (
              <div className="mcc-collection-danger__confirmation" role="alert">
                <strong>Är du helt säker?</strong>
                <span>Det går inte att ångra.</span>
                <div>
                  <button onClick={() => setDeleteConfirmation(false)} type="button">Avbryt</button>
                  <button
                    disabled={isDeleting}
                    onClick={() => fetcher.submit({ action: "delete" }, { method: "post" })}
                    type="button"
                  >
                    {isDeleting ? "Tar bort…" : "Ta bort permanent"}
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {!deleteConfirmation ? (
          <div className="mcc-editor-savebar">
            <div aria-live="polite">
              <span className={isDirty ? "is-dirty" : ""} />
              <p>
                <strong>{isSaving ? "Rabatten sparas" : isDirty ? "Ändringar ej sparade" : "Redo att redigera"}</strong>
                <small>{isSaving ? "Ett ögonblick…" : "Spara när allt känns klart."}</small>
              </p>
            </div>
            <button disabled={isSaving || isDeleting} type="submit">
              <span>{isSaving ? "Sparar…" : discount ? "Spara ändringar" : "Skapa rabatt"}</span>
              <span aria-hidden="true"><ArrowIcon /></span>
            </button>
          </div>
        ) : null}
      </form>
    </main>
  );
}
