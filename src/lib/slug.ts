/**
 * Handle generation for products imported from Base.
 *
 * Medusa enforces a unique handle, and Base happily holds several products
 * under one name, so slugifying the title alone is not enough - the u11d
 * plugin does exactly that and the second product of a matching pair fails
 * to insert.
 */

/** Characters that survive Unicode decomposition and need an explicit mapping. */
const SPECIAL_CHARACTERS: Record<string, string> = {
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ø: "o",
  Ø: "O",
  ß: "ss",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
};

export const toHandle = (title: string, fallback = "product"): string => {
  const mapped = Array.from(title)
    .map((character) => SPECIAL_CHARACTERS[character] ?? character)
    .join("");

  const slug = mapped
    .normalize("NFD")
    // Strip the combining accents left behind by decomposition.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
};

/**
 * Returns a handle not present in `taken`, adding the result to the set so a
 * batch of products stays collision free without a database round trip.
 */
export const uniqueHandle = (handle: string, taken: Set<string>): string => {
  if (!taken.has(handle)) {
    taken.add(handle);
    return handle;
  }

  let suffix = 2;
  while (taken.has(`${handle}-${suffix}`)) {
    suffix++;
  }

  const unique = `${handle}-${suffix}`;
  taken.add(unique);
  return unique;
};
