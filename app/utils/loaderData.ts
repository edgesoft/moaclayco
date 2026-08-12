type MongoLikeValue = {
  toHexString?: () => string;
  toObject?: () => unknown;
};

const normalizeLoaderValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalizeLoaderValue);
  if (typeof value !== "object") return value;

  const mongoValue = value as MongoLikeValue;
  if (typeof mongoValue.toHexString === "function") {
    return mongoValue.toHexString();
  }
  if (typeof mongoValue.toObject === "function") {
    return normalizeLoaderValue(mongoValue.toObject());
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      normalizeLoaderValue(nestedValue),
    ])
  );
};

/**
 * Converts Mongo documents and ObjectIds into data React Router can hydrate.
 * Dates remain Date instances because React Router supports them natively.
 */
export const toLoaderData = <T>(value: T): T =>
  normalizeLoaderValue(value) as T;
