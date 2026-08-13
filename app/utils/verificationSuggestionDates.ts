export type VerificationSuggestionDateNotice = {
  blocksAutomaticDate: boolean;
  kind: "invalid" | "outside_year" | "old" | "future";
  message: string;
};

const dateKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseDateKey = (dateKey: string) => {
  const match = dateKey.match(dateKeyPattern);
  if (!match) return null;

  const [, year, month, day] = match;
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return value.toISOString().slice(0, 10) === dateKey ? value : null;
};

const formatSwedishDate = (date: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);

export const getVerificationSuggestionDateNotice = ({
  dateKey,
  fiscalYear,
  now = new Date(),
}: {
  dateKey: string;
  fiscalYear: number;
  now?: Date;
}): VerificationSuggestionDateNotice | null => {
  const documentDate = parseDateKey(dateKey);
  if (!documentDate) {
    return {
      blocksAutomaticDate: true,
      kind: "invalid",
      message: "Dokumentets datum kunde inte verifieras. Välj bokföringsdatum manuellt.",
    };
  }

  const formattedDate = formatSwedishDate(documentDate);
  if (documentDate.getUTCFullYear() !== fiscalYear) {
    return {
      blocksAutomaticDate: true,
      kind: "outside_year",
      message: `Underlaget är daterat ${formattedDate}, men du arbetar i bokföringsår ${fiscalYear}. Välj ett bokföringsdatum i ${fiscalYear}.`,
    };
  }

  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const ageInDays = Math.floor(
    (todayUtc - documentDate.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (ageInDays > 90) {
    return {
      blocksAutomaticDate: false,
      kind: "old",
      message: `Underlaget är daterat ${formattedDate}, mer än 90 dagar tillbaka. Kontrollera att bokföringsdatumet är rätt.`,
    };
  }
  if (ageInDays < -1) {
    return {
      blocksAutomaticDate: true,
      kind: "future",
      message: `Underlaget är daterat ${formattedDate}, vilket ligger i framtiden. Välj bokföringsdatum manuellt.`,
    };
  }

  return null;
};
