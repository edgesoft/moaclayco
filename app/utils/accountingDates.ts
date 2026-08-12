type AccountingDateParts = {
  year: number;
  monthIndex: number;
  day: number;
};

const parseAccountingDateParts = (
  value: unknown
): AccountingDateParts | null => {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, monthIndex, day };
};

export const parseAccountingDate = (value: unknown): Date | null => {
  const parts = parseAccountingDateParts(value);
  return parts
    ? new Date(Date.UTC(parts.year, parts.monthIndex, parts.day, 12))
    : null;
};

const stockholmDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Stockholm",
});

const stockholmMonthFormatter = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  timeZone: "Europe/Stockholm",
});

const partNumber = (parts: Intl.DateTimeFormatPart[], type: string) =>
  Number(parts.find((part) => part.type === type)?.value);

// MongoDB stores instants in UTC. Accounting periods are Swedish calendar
// months, so their boundaries must follow Europe/Stockholm, including DST.
const stockholmWallTimeUtc = (
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
) => {
  const utcGuess = Date.UTC(year, monthIndex, day, hour, minute, second);
  const parts = stockholmDateFormatter.formatToParts(new Date(utcGuess));
  const representedAsUtc = Date.UTC(
    partNumber(parts, "year"),
    partNumber(parts, "month") - 1,
    partNumber(parts, "day"),
    partNumber(parts, "hour"),
    partNumber(parts, "minute"),
    partNumber(parts, "second")
  );
  return new Date(utcGuess - (representedAsUtc - utcGuess));
};

const stockholmMidnightUtc = (year: number, monthIndex: number, day: number) =>
  stockholmWallTimeUtc(year, monthIndex, day);

export const parseStockholmDateTime = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const wallTime = new Date(Date.UTC(year, monthIndex, day, hour, minute));
  if (
    wallTime.getUTCFullYear() !== year ||
    wallTime.getUTCMonth() !== monthIndex ||
    wallTime.getUTCDate() !== day ||
    wallTime.getUTCHours() !== hour ||
    wallTime.getUTCMinutes() !== minute
  ) {
    return null;
  }

  const instant = stockholmWallTimeUtc(
    year,
    monthIndex,
    day,
    hour,
    minute
  );
  const parts = stockholmDateFormatter.formatToParts(instant);
  const matchesRequestedTime =
    partNumber(parts, "year") === year &&
    partNumber(parts, "month") === monthIndex + 1 &&
    partNumber(parts, "day") === day &&
    partNumber(parts, "hour") === hour &&
    partNumber(parts, "minute") === minute;

  return matchesRequestedTime ? instant : null;
};

export const formatStockholmDateTime = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = stockholmDateFormatter.formatToParts(date);
  const part = (type: string) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
};

export const accountingMonthKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = stockholmMonthFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : null;
};

export const accountingDateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = stockholmDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
};

export const accountingYear = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return partNumber(stockholmDateFormatter.formatToParts(date), "year");
};

export const accountingMonthKeyForVerification = (verification: {
  verificationDate: string | Date;
  metadata?: Array<{ key: string; value: string }>;
}) => accountingMonthKey(verification.verificationDate);

export const getAccountingMonthBounds = (month: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (year < 2000 || year > 2200 || monthIndex < 0 || monthIndex > 11) return null;
  return {
    year,
    monthIndex,
    start: stockholmMidnightUtc(year, monthIndex, 1),
    end: stockholmMidnightUtc(year, monthIndex + 1, 1),
  };
};

export const getAccountingDateBounds = (from: string, to = from) => {
  const fromParts = parseAccountingDateParts(from);
  const toParts = parseAccountingDateParts(to);
  if (!fromParts || !toParts || from > to) return null;

  return {
    start: stockholmMidnightUtc(
      fromParts.year,
      fromParts.monthIndex,
      fromParts.day
    ),
    end: stockholmMidnightUtc(
      toParts.year,
      toParts.monthIndex,
      toParts.day + 1
    ),
  };
};

export const getAccountingYearBounds = (year: number) => {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return null;
  return {
    year,
    start: stockholmMidnightUtc(year, 0, 1),
    end: stockholmMidnightUtc(year + 1, 0, 1),
  };
};
