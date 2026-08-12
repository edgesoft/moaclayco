export type VerificationDraftEntry = {
  account?: number | null;
  debit?: number | string | null;
  credit?: number | string | null;
};

const decodeFileName = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const fallbackVerificationFileLabel = (fileName: string) => {
  const baseName = decodeFileName(fileName.split("/").pop() || fileName)
    .replace(/^\d{10,}[-_\s]*/, "")
    .replace(/\.(pdf|png|jpe?g|webp|heic|gif|tiff?)$/i, "")
    .replace(/\s*_\s*/g, " – ")
    .replace(/\s+-\s+/g, " – ")
    .replace(/\s+/g, " ")
    .trim();

  return (baseName || "Underlag").slice(0, 120);
};

export const sanitizeVerificationFileLabel = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 120);

export const hasMeaningfulVerificationInput = ({
  description,
  journalEntries,
  verificationDate,
  initialVerificationDate,
}: {
  description?: string | null;
  journalEntries?: VerificationDraftEntry[] | null;
  verificationDate?: string | null;
  initialVerificationDate?: string | null;
}) => {
  if (description?.trim()) return true;
  if (
    typeof verificationDate === "string" &&
    typeof initialVerificationDate === "string" &&
    verificationDate !== initialVerificationDate
  ) {
    return true;
  }

  return Boolean(
    journalEntries?.some(
      (entry) =>
        Number(entry.account || 0) > 0 ||
        Number(entry.debit || 0) !== 0 ||
        Number(entry.credit || 0) !== 0
    )
  );
};
