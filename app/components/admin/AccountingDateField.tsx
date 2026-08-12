import { useEffect, useMemo, useRef, useState } from "react";

type AccountingDateFieldProps = {
  id: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label?: string;
  error?: boolean;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const parseDate = (value?: string) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
};
const stockholmToday = () =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Stockholm",
  }).format(new Date());

const monthLabel = new Intl.DateTimeFormat("sv-SE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dateLabel = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const weekDays = ["M", "T", "O", "T", "F", "L", "S"];

export function AccountingDateField({
  id,
  name,
  value,
  defaultValue = "",
  onChange,
  label = "Välj datum",
  error = false,
}: AccountingDateFieldProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const selectedDate = useMemo(() => parseDate(selectedValue), [selectedValue]);
  const todayDate = parseDate(stockholmToday())!;
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(
      Date.UTC(
        (selectedDate ?? todayDate).getUTCFullYear(),
        (selectedDate ?? todayDate).getUTCMonth(),
        1
      )
    )
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open && selectedDate) {
      setVisibleMonth(
        new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1))
      );
    }
  }, [open, selectedDate]);

  const days = useMemo(() => {
    const year = visibleMonth.getUTCFullYear();
    const month = visibleMonth.getUTCMonth();
    const leadingEmptyDays =
      (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
    const numberOfDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return [
      ...Array.from({ length: leadingEmptyDays }, () => null),
      ...Array.from({ length: numberOfDays }, (_, index) =>
        new Date(Date.UTC(year, month, index + 1, 12))
      ),
    ];
  }, [visibleMonth]);

  const selectDate = (nextValue: string) => {
    if (onChange) onChange(nextValue);
    else setInternalValue(nextValue);
    setOpen(false);
  };

  const moveMonth = (direction: number) => {
    setVisibleMonth(
      new Date(
        Date.UTC(
          visibleMonth.getUTCFullYear(),
          visibleMonth.getUTCMonth() + direction,
          1
        )
      )
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={selectedValue} readOnly />
      <button
        id={id}
        type="button"
        aria-label={`${label}: ${
          selectedDate ? dateLabel.format(selectedDate) : "inget datum valt"
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`group flex h-14 w-full items-center justify-between rounded-2xl border bg-white px-4 text-left text-sm shadow-[0_1px_0_rgba(41,37,36,0.04)] outline-none transition hover:border-[#c58a79] focus:ring-2 ${
          error
            ? "border-red-400 focus:border-red-500 focus:ring-red-100"
            : "border-stone-300 focus:border-[#b86e59] focus:ring-[#f3e4de]"
        }`}
      >
        <span
          className={`min-w-0 truncate pr-1 ${
            selectedDate ? "font-semibold text-stone-900" : "text-stone-400"
          }`}
        >
          {selectedDate ? dateLabel.format(selectedDate) : label}
        </span>
        <span
          aria-hidden="true"
          className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3e4de] text-[#985744] transition group-hover:bg-[#ead5cd]"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z" />
            <path d="M8 13h2M14 13h2M8 16.5h2M14 16.5h2" />
          </svg>
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-[1.25rem] border border-stone-300 bg-[#fffdf8] p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-stone-200 pb-3">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              aria-label="Föregående månad"
              className="flex h-9 w-9 items-center justify-center rounded-full text-stone-600 hover:bg-[#f3e4de] hover:text-[#985744]"
            >
              ←
            </button>
            <strong className="text-sm capitalize text-stone-900">
              {monthLabel.format(visibleMonth)}
            </strong>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              aria-label="Nästa månad"
              className="flex h-9 w-9 items-center justify-center rounded-full text-stone-600 hover:bg-[#f3e4de] hover:text-[#985744]"
            >
              →
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 text-center text-[10px] font-bold uppercase text-stone-400">
            {weekDays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-0.5">
            {days.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} className="h-9" />;
              const dayValue = isoDate(day);
              const selected = dayValue === selectedValue;
              const today = dayValue === stockholmToday();
              return (
                <button
                  key={dayValue}
                  type="button"
                  onClick={() => selectDate(dayValue)}
                  aria-pressed={selected}
                  className={`h-9 rounded-full text-xs tabular-nums transition ${
                    selected
                      ? "bg-[#a85f4b] font-bold text-white"
                      : today
                      ? "border border-[#b86e59] font-bold text-[#985744]"
                      : "text-stone-700 hover:bg-[#f3e4de]"
                  }`}
                >
                  {day.getUTCDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-stone-200 pt-3">
            <button
              type="button"
              onClick={() => selectDate("")}
              className="text-xs font-bold text-stone-500 hover:text-stone-900"
            >
              Rensa
            </button>
            <button
              type="button"
              onClick={() => selectDate(stockholmToday())}
              className="rounded-lg bg-[#f3e4de] px-3 py-2 text-xs font-bold text-[#985744]"
            >
              Idag
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
