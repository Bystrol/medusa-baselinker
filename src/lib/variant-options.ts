/**
 * Derives Medusa product options from the features Base holds on variants.
 *
 * Base has no concept of an option axis. What it does have is `features` on a
 * product's text_fields - a plain key/value map - and a variant is a product
 * in its own right, so a variant can carry them too. When every variant of a
 * product describes itself with the same feature keys, those keys are exactly
 * the axes Medusa needs: one for colour, one for size.
 *
 * The catch is that features are invisible in the variants nested under a
 * parent; they only appear when the variant is fetched by its own id.
 *
 * Where the data does not support real axes, this falls back to a single
 * generated option whose values are the variant names. A broken axis would be
 * worse than an honest one-dimensional list.
 */

import { toText } from "./coerce";

/** Title of the generated option used when features cannot describe the variants. */
export const FALLBACK_OPTION_TITLE = "Variant";

export interface OptionSource {
  /** Base id of the variant. */
  id: string;
  /** Variant name, used for the fallback option value. */
  title: string;
  /** Features read from the variant fetched as its own product. */
  features?: Record<string, unknown> | null;
}

export interface ResolvedOptions {
  /** Option titles in the order they should appear. */
  titles: string[];
  /** Values per variant id, keyed by option title. */
  valuesByVariant: Record<string, Record<string, string>>;
  /** True when features were usable; false when the fallback was applied. */
  fromFeatures: boolean;
}

/** Feature keys of a variant, empty when it declares none usable. */
const featureKeys = (source: OptionSource): string[] => {
  const features = source.features;
  if (!features || typeof features !== "object") return [];

  return Object.entries(features)
    .filter(([key, value]) => toText(key) !== "" && toText(value) !== "")
    .map(([key]) => key);
};

/**
 * Ensures option values stay unique within a product, since Base allows two
 * variants to share a name.
 */
const uniqueValue = (value: string, taken: Set<string>): string => {
  if (!taken.has(value)) {
    taken.add(value);
    return value;
  }

  let suffix = 2;
  while (taken.has(`${value} ${suffix}`)) suffix++;

  const unique = `${value} ${suffix}`;
  taken.add(unique);
  return unique;
};

const fallback = (variants: OptionSource[]): ResolvedOptions => {
  const taken = new Set<string>();
  const valuesByVariant: Record<string, Record<string, string>> = {};

  for (const variant of variants) {
    const value = uniqueValue(toText(variant.title) || variant.id, taken);
    valuesByVariant[variant.id] = { [FALLBACK_OPTION_TITLE]: value };
  }

  return {
    titles: [FALLBACK_OPTION_TITLE],
    valuesByVariant,
    fromFeatures: false,
  };
};

export const resolveVariantOptions = (
  variants: OptionSource[]
): ResolvedOptions => {
  if (!variants.length) {
    return { titles: [], valuesByVariant: {}, fromFeatures: false };
  }

  // Order comes from the first variant, so the axes appear as the merchant
  // entered them rather than alphabetically.
  const titles = featureKeys(variants[0]);
  if (!titles.length) return fallback(variants);

  const signature = [...titles].sort().join(" ");
  const valuesByVariant: Record<string, Record<string, string>> = {};
  const combinations = new Set<string>();

  for (const variant of variants) {
    const keys = featureKeys(variant);

    // Every variant has to describe itself along the same axes. A product
    // where one variant declares a colour and another declares nothing cannot
    // be expressed as a consistent set of options.
    if ([...keys].sort().join(" ") !== signature) {
      return fallback(variants);
    }

    const values: Record<string, string> = {};
    for (const title of titles) {
      values[title] = toText(
        (variant.features as Record<string, unknown>)[title]
      );
    }

    // Medusa requires each variant to occupy a distinct combination.
    const combination = titles.map((title) => values[title]).join(" ");
    if (combinations.has(combination)) {
      return fallback(variants);
    }

    combinations.add(combination);
    valuesByVariant[variant.id] = values;
  }

  return { titles, valuesByVariant, fromFeatures: true };
};
