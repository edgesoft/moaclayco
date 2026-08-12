export const parseAccountingDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
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
