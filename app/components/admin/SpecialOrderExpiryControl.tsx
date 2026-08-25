import { useEffect, useMemo, useRef, useState } from "react";
import ArrowIcon from "~/components/ArrowIcon";
import {
  specialOrderExpiryError,
  specialOrderExpiryFromDays,
  specialOrderExpiryLimits,
} from "~/utils/specialOrderExpiry";

type CalendarDay = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

const pad = (value: number) => String(value).padStart(2, "0");
const dateToKey = (date: Date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;

const monthLabel = new Intl.DateTimeFormat("sv-SE", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});
const dateLabel = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});
const shortDateLabel = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
const weekDays = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const hours = Array.from({ length: 24 }, (_, index) => pad(index));
const standardMinutes = [
  "00",
  "05",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
  "55",
  "59",
];

const splitExpiry = (value: string) => {
  const [date = "", time = ""] = value.split(" ");
  return { date, time };
};

const parseDateKey = (value: string) => new Date(`${value}T12:00:00Z`);

const calendarDays = (
  year: number,
  month: number,
  today: string
): CalendarDay[] => {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - firstWeekday + 1, 12));
    const dateKey = dateToKey(date);
    return {
      date: dateKey,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
      isToday: dateKey === today,
    };
  });
};

export default function SpecialOrderExpiryControl({
  error,
  onChange,
  value,
}: {
  error?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);
  const [referenceTime] = useState(() => new Date());
  const { maximumDate, minimumDate } = specialOrderExpiryLimits(referenceTime);
  const { date: selectedDate, time } = splitExpiry(value);
  const initialDate = selectedDate ? parseDateKey(selectedDate) : parseDateKey(minimumDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState({
    month: initialDate.getUTCMonth(),
    year: initialDate.getUTCFullYear(),
  });

  useEffect(() => {
    if (!calendarOpen && !timeOpen) return;
    const closePickers = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setCalendarOpen(false);
        setTimeOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCalendarOpen(false);
        setTimeOpen(false);
      }
    };
    document.addEventListener("mousedown", closePickers);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closePickers);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [calendarOpen, timeOpen]);

  useEffect(() => {
    if (!timeOpen) return;
    const frame = requestAnimationFrame(() => {
      [hourListRef.current, minuteListRef.current].forEach((list) => {
        const option = list?.querySelector<HTMLElement>('[aria-selected="true"]');
        if (!list || !option) return;
        const listRect = list.getBoundingClientRect();
        const optionRect = option.getBoundingClientRect();
        list.scrollTop +=
          optionRect.top -
          listRect.top -
          (list.clientHeight - optionRect.height) / 2;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [timeOpen]);

  const days = useMemo(
    () => calendarDays(visibleMonth.year, visibleMonth.month, minimumDate),
    [minimumDate, visibleMonth]
  );
  const selectedDateObject = selectedDate ? parseDateKey(selectedDate) : null;
  const [timeHour, timeMinute] = time.split(":");
  const selectedHour = timeHour || "12";
  const selectedMinute = timeMinute || "00";
  const minutes = Array.from(new Set([...standardMinutes, selectedMinute])).sort();
  const selectedError = error ?? specialOrderExpiryError(value, referenceTime) ?? undefined;
  const currentMonthKey = `${visibleMonth.year}-${pad(visibleMonth.month + 1)}`;
  const minimumMonthKey = minimumDate.slice(0, 7);
  const maximumMonthKey = maximumDate.slice(0, 7);

  const moveMonth = (amount: number) => {
    setVisibleMonth((current) => {
      const next = new Date(Date.UTC(current.year, current.month + amount, 1, 12));
      const nextMonthKey = `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`;
      if (nextMonthKey < minimumMonthKey || nextMonthKey > maximumMonthKey) {
        return current;
      }
      return { month: next.getUTCMonth(), year: next.getUTCFullYear() };
    });
  };

  const chooseDate = (date: string) => {
    if (date < minimumDate || date > maximumDate) return;
    const parsed = parseDateKey(date);
    onChange(time ? `${date} ${time}` : date);
    setVisibleMonth({ month: parsed.getUTCMonth(), year: parsed.getUTCFullYear() });
    setCalendarOpen(false);
  };

  const chooseQuickPeriod = (period: number) => {
    const next = specialOrderExpiryFromDays(
      period,
      referenceTime,
      time || undefined
    );
    const { date } = splitExpiry(next);
    const parsed = parseDateKey(date);
    onChange(next);
    setVisibleMonth({ month: parsed.getUTCMonth(), year: parsed.getUTCFullYear() });
    setTimeOpen(false);
  };

  const chooseTimePart = (part: "hour" | "minute", option: string) => {
    if (!selectedDate) return;
    const nextHour = part === "hour" ? option : selectedHour;
    const nextMinute = part === "minute" ? option : selectedMinute;
    onChange(`${selectedDate} ${nextHour}:${nextMinute}`);
  };

  const removeTime = () => {
    if (!selectedDate) return;
    onChange(selectedDate);
    setTimeOpen(false);
  };

  return (
    <div className="special-expiry-control" ref={wrapperRef}>
      <p className="special-editor-kicker">Länkens giltighet</p>
      <div aria-label="Snabbval för giltighet" className="special-expiry-quick">
        {[3, 7, 14].map((period) => {
          const quickDate = splitExpiry(
            specialOrderExpiryFromDays(period, referenceTime)
          ).date;
          return (
            <button
              aria-pressed={selectedDate === quickDate}
              key={period}
              onClick={() => chooseQuickPeriod(period)}
              type="button"
            >
              {period} dagar
            </button>
          );
        })}
      </div>

      <div className="special-expiry-fields">
        <div className="special-expiry-date">
          <span className="special-expiry-label">Gäller till</span>
          <button
            aria-expanded={calendarOpen}
            aria-haspopup="dialog"
            className={selectedError ? "has-error" : ""}
            onClick={() => {
              setTimeOpen(false);
              setCalendarOpen((open) => !open);
            }}
            type="button"
          >
            <span>
              {selectedDateObject
                ? shortDateLabel.format(selectedDateObject)
                : "Välj datum"}
            </span>
            <span aria-hidden="true" className="special-expiry-calendar-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z" />
                <path d="M8 13h2M14 13h2M8 16.5h2M14 16.5h2" />
              </svg>
            </span>
          </button>

          {calendarOpen ? (
            <div
              aria-label="Välj sista giltighetsdag"
              className="special-expiry-calendar"
              role="dialog"
            >
              <div className="special-expiry-calendar__header">
                <button
                  aria-label="Föregående månad"
                  disabled={currentMonthKey <= minimumMonthKey}
                  onClick={() => moveMonth(-1)}
                  type="button"
                >
                  <ArrowIcon direction="left" />
                </button>
                <strong>
                  {monthLabel.format(
                    new Date(Date.UTC(visibleMonth.year, visibleMonth.month, 1, 12))
                  )}
                </strong>
                <button
                  aria-label="Nästa månad"
                  disabled={currentMonthKey >= maximumMonthKey}
                  onClick={() => moveMonth(1)}
                  type="button"
                >
                  <ArrowIcon />
                </button>
              </div>
              <div className="special-expiry-calendar__weekdays" aria-hidden="true">
                {weekDays.map((weekDay) => (
                  <span key={weekDay}>{weekDay}</span>
                ))}
              </div>
              <div className="special-expiry-calendar__days">
                {days.map((day) => {
                  const disabled = day.date < minimumDate || day.date > maximumDate;
                  return (
                    <button
                      aria-current={day.isToday ? "date" : undefined}
                      aria-label={dateLabel.format(parseDateKey(day.date))}
                      aria-pressed={day.date === selectedDate}
                      className={`${day.inMonth ? "" : "is-outside"}${
                        day.isToday ? " is-today" : ""
                      }${day.date === selectedDate ? " is-selected" : ""}`}
                      disabled={disabled}
                      key={day.date}
                      onClick={() => chooseDate(day.date)}
                      type="button"
                    >
                      {day.day}
                    </button>
                  );
                })}
              </div>
              <p>Välj ett datum inom 30 dagar.</p>
            </div>
          ) : null}
        </div>

        <div className="special-expiry-time">
          <div className="special-expiry-label-row">
            <span className="special-expiry-label">
              Klockslag <em>valfritt</em>
            </span>
            {time ? (
              <button onClick={removeTime} type="button">
                Ta bort
              </button>
            ) : null}
          </div>
          <button
            aria-expanded={timeOpen}
            aria-haspopup="dialog"
            className={`special-expiry-time-trigger${time ? "" : " is-empty"}`}
            onClick={() => {
              setCalendarOpen(false);
              setTimeOpen((open) => !open);
            }}
            type="button"
          >
            <span>{time || "Lägg till tid"}</span>
            <span aria-hidden="true" className="special-expiry-time-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
            </span>
          </button>
          {timeOpen ? (
            <div
              aria-label="Välj klockslag"
              className="special-expiry-time-picker"
              role="dialog"
            >
              <div className="special-expiry-time-picker__header">
                <span>Välj klockslag</span>
                <strong>
                  {selectedHour}:{selectedMinute}
                </strong>
              </div>
              <div className="special-expiry-time-picker__columns">
                <div>
                  <span>Timme</span>
                  <div aria-label="Välj timme" ref={hourListRef} role="listbox">
                    {hours.map((hour) => (
                      <button
                        aria-selected={selectedHour === hour}
                        key={hour}
                        onClick={() => chooseTimePart("hour", hour)}
                        role="option"
                        type="button"
                      >
                        {hour}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span>Minut</span>
                  <div aria-label="Välj minut" ref={minuteListRef} role="listbox">
                    {minutes.map((minute) => (
                      <button
                        aria-selected={selectedMinute === minute}
                        key={minute}
                        onClick={() => chooseTimePart("minute", minute)}
                        role="option"
                        type="button"
                      >
                        {minute}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="special-expiry-time-picker__footer">
                {time ? (
                  <button onClick={removeTime} type="button">
                    Ta bort klockslag
                  </button>
                ) : (
                  <span>Klockslaget är valfritt</span>
                )}
                <button onClick={() => setTimeOpen(false)} type="button">
                  Klar
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {selectedDateObject ? (
        <p className="special-expiry-summary" aria-live="polite">
          {time
            ? `Länken stängs ${dateLabel.format(selectedDateObject)} kl. ${time}.`
            : `Länken gäller till och med ${dateLabel.format(selectedDateObject)}.`}
        </p>
      ) : null}
      {selectedError ? (
        <small className="special-editor-error" role="alert">
          {selectedError}
        </small>
      ) : null}
    </div>
  );
}
