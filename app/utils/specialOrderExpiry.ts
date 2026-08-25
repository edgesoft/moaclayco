import {
  formatStockholmDateTime,
  parseStockholmDateTime,
} from "~/utils/accountingDates";

export const SPECIAL_ORDER_MAX_EXPIRY_DAYS = 30;

const pad = (value: number) => String(value).padStart(2, "0");

const addCalendarDays = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
};

export const specialOrderExpiryFromDays = (
  days: number,
  now = new Date(),
  time?: string
) => {
  const today = formatStockholmDateTime(now).slice(0, 10);
  const date = addCalendarDays(today, days);
  return time ? `${date} ${time}` : date;
};

export const resolveSpecialOrderExpiry = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/.exec(
    value.trim()
  );
  if (!match) return null;
  const [, date, time] = match;
  const expiresAt = parseStockholmDateTime(`${date} ${time ?? "23:59"}`);
  return expiresAt
    ? { expiresAt, includesTime: Boolean(time) }
    : null;
};

export const specialOrderExpiryFormValue = (
  value: Date | string | undefined,
  includesTime: boolean
) => {
  if (!value) return "";
  const formatted = formatStockholmDateTime(value);
  return includesTime ? formatted : formatted.slice(0, 10);
};

export const specialOrderExpiryLimits = (now = new Date()) => {
  const minimumDate = formatStockholmDateTime(now).slice(0, 10);
  return {
    maximumDate: addCalendarDays(minimumDate, SPECIAL_ORDER_MAX_EXPIRY_DAYS),
    minimumDate,
  };
};

export const specialOrderExpiryError = (
  value: unknown,
  now = new Date()
) => {
  const resolved = resolveSpecialOrderExpiry(value);
  if (!resolved) return "Välj ett giltigt slutdatum";
  if (resolved.expiresAt.getTime() <= now.getTime()) {
    return "Slutdatumet måste ligga framåt i tiden";
  }

  const dateKey = typeof value === "string" ? value.slice(0, 10) : "";
  const { maximumDate } = specialOrderExpiryLimits(now);
  if (dateKey > maximumDate) {
    return `Länken kan vara giltig i högst ${SPECIAL_ORDER_MAX_EXPIRY_DAYS} dagar`;
  }
  return null;
};
