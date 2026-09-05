/**
 * Decides what happens to products that are mapped in Medusa but no longer
 * come back from Base.
 *
 * The delicate part is not the action but the inference: absence is read off a
 * paginated listing, and a timed-out page, a changed inventory_id or a broken
 * pagination loop all look exactly like a mass deletion. So every plan runs
 * through a guard before anything is written.
 */

export type MissingProductStrategy = "draft" | "delete" | "ignore";

export interface MissingProductsInput {
  /** Base ids already mapped to Medusa products. */
  knownBaseProductIds: string[];
  /** Base ids returned by the sync that just ran. */
  seenBaseProductIds: string[];
  strategy: MissingProductStrategy;
  /**
   * Largest share of mapped products a single run may affect. Above it the
   * plan aborts, on the grounds that a real catalog withdrawal is rarely a
   * step change while an API failure always is.
   */
  maxMissingRatio: number;
}

export interface MissingProductsPlan {
  /** Base ids to act on. Empty when the plan is aborted or has nothing to do. */
  missing: string[];
  strategy: MissingProductStrategy;
  /** True when the guard refused the plan; nothing should be written. */
  aborted: boolean;
  /** Present when aborted, for the log line the operator will read. */
  reason?: string;
  ratio: number;
}

export const planMissingProducts = ({
  knownBaseProductIds,
  seenBaseProductIds,
  strategy,
  maxMissingRatio,
}: MissingProductsInput): MissingProductsPlan => {
  const seen = new Set(seenBaseProductIds);
  const missing = knownBaseProductIds.filter((id) => !seen.has(id));
  const ratio = knownBaseProductIds.length
    ? missing.length / knownBaseProductIds.length
    : 0;

  if (strategy === "ignore" || !missing.length) {
    return { missing: [], strategy, aborted: false, ratio };
  }

  // An empty catalog is the signature of a failed call, never of a real
  // inventory, so it is refused regardless of the ratio.
  if (!seenBaseProductIds.length) {
    return {
      missing: [],
      strategy,
      aborted: true,
      ratio,
      reason:
        "Base returned no products at all - refusing to touch the catalog, as this is far more likely an API failure than an empty inventory",
    };
  }

  if (ratio > maxMissingRatio) {
    return {
      missing: [],
      strategy,
      aborted: true,
      ratio,
      reason:
        `${missing.length} of ${knownBaseProductIds.length} mapped products are missing from Base ` +
        `(${Math.round(ratio * 100)}%, limit ${Math.round(maxMissingRatio * 100)}%) - refusing to act. ` +
        "Raise max_missing_ratio if the withdrawal is genuine.",
    };
  }

  return { missing, strategy, aborted: false, ratio };
};
