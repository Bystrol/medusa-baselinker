/**
 * Type coercion for values coming out of the Base.com API.
 *
 * Base does not keep field types stable. Observed on a single live account:
 * two variants of one product returned `79` and `"89.00"` for the same price
 * field, the very same price came back as an int from one endpoint and a
 * string from another, and booleans arrive as `"0"` / `"1"` strings.
 *
 * So nothing read from the API may be trusted to have the type its JSON
 * suggests - every field goes through one of these.
 */

export const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

export const toInteger = (value: unknown, fallback = 0): number =>
  Math.trunc(toNumber(value, fallback));

/**
 * Base sends booleans as `true`, `1` or `"1"` depending on the endpoint,
 * and the falsy side as `false`, `0` or `"0"`.
 */
export const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "0" && normalized !== "false";
  }

  return false;
};

export const toText = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
};

/**
 * Base uses empty strings where a value is absent - `ean: ""` rather than
 * null. Carrying those into Medusa risks unique-constraint collisions between
 * every product that happens to lack the field, so they become null here.
 */
export const toTextOrNull = (value: unknown): string | null => {
  const text = toText(value);
  return text === "" ? null : text;
};

/**
 * Dimensions and weights come back as 0 when unset, which is not the same as
 * "weighs nothing" - Medusa is better served by an explicit null.
 */
export const toPositiveOrNull = (value: unknown): number | null => {
  const parsed = toNumber(value, 0);
  return parsed > 0 ? parsed : null;
};
