import { formatStockholmDateTime } from "./accountingDates";

export const formatDateToUTC = (date: Date | string) =>
  date ? formatStockholmDateTime(date) : "";
