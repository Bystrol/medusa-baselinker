/**
 * Works out what Base should be told about an order's payment.
 *
 * Base never takes money. Payment happens through a Medusa provider, and Base
 * only needs the operational consequence: has anything been collected, and
 * must the courier collect the rest on delivery.
 *
 * Three fields carry that, and only one of them is dangerous to get wrong:
 *
 * - `payment_method` is a free-text label. Base shows it in the panel and
 *   keys its automation rules on it.
 * - `payment_done` is an amount, not a flag. Base subtracts it to know what
 *   is still owed.
 * - `payment_method_cod` decides whether the courier collects on delivery and
 *   what goes on the shipping label. A prepaid order marked as cash on
 *   delivery gets charged twice; a cash-on-delivery order marked prepaid ships
 *   without collecting anything.
 */

import { toNumber, toText } from "./coerce";

export interface PaymentInput {
  /** Payment provider the customer used, e.g. "pp_stripe_stripe". */
  providerId?: string | null;
  /**
   * Amount actually captured, summed across the order's payment collections.
   *
   * This is the whole answer on its own, which is why no payment status is
   * taken: an authorized-but-uncaptured collection reports zero captured, so
   * money that is merely reserved never counts as collected. The order's
   * `payment_status` would have been the obvious source and is not usable -
   * it is a computed field and does not come back through query.graph at all.
   */
  capturedAmount?: number | null;
  /** Provider ids the merchant treats as cash on delivery. */
  codProviderIds?: string[];
  /** Friendly names per provider id, for the label Base displays. */
  labels?: Record<string, string>;
}

export interface PaymentDetails {
  payment_method: string;
  payment_method_cod: boolean;
  /** Amount already collected. Always 0 for cash on delivery. */
  payment_done: number;
}

export const resolvePayment = ({
  providerId,
  capturedAmount,
  codProviderIds = [],
  labels = {},
}: PaymentInput): PaymentDetails => {
  const provider = toText(providerId);
  const isCod = provider !== "" && codProviderIds.includes(provider);

  // The label falls back to the provider id rather than to something generic:
  // an unmapped "pp_stripe_stripe" in the Base panel is ugly but tells the
  // operator exactly what to add to the mapping.
  const label = labels[provider] ?? (provider || "Medusa");

  if (isCod) {
    // Nothing has been collected yet by definition, whatever Medusa's status
    // says. Sending a non-zero amount here would tell the courier to collect
    // less than the order is worth.
    return {
      payment_method: label,
      payment_method_cod: true,
      payment_done: 0,
    };
  }

  return {
    payment_method: label,
    payment_method_cod: false,
    // Reserved money is not collected money: an authorization leaves the
    // captured amount at zero, which is exactly what the warehouse should see.
    payment_done: Math.max(0, toNumber(capturedAmount)),
  };
};
