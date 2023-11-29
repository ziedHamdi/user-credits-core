import { ICombinedOffer } from "./combine/ICombinedOffer";
import { IBaseEntity } from "./IBaseEntity";
import { IMinimalId } from "./IMinimalId";

export type IOfferCycle =
  | "once"
  | "daily"
  | "weekly"
  | "bi-weekly"
  | "monthly"
  | "trimester"
  | "semester"
  | "yearly"
  | "custom";

/**
 * @param K the type of foreign keys (is used for all foreign keys type)
 */
export interface IOffer<K extends IMinimalId> extends IBaseEntity<K> {
  /**
   * Determines how the expiry date is handled at the time of purchase.
   *
   * If {@link IOrder.starts} is not null, no algorithm is executed: it is used as is, unless the date has passed, in which case, an error occurs.
   *
   * If set to true:
   * - The expiry date extends from the current expiry date of the same offerGroup in {@link IUserCredits.offers[offerGroup]}.
   * - The extension is by the duration specified in {@link IOffer.cycle}.
   *
   * If set to false:
   * - Otherwise, {@link Date.now()} is used as the start date.
   * - The expiry date is calculated by adding {@link IOffer.cycle} to the start date.
   *
   * When the expiry date is reached:
   * - Remaining tokens are deducted from the offerGroup.
   *
   * The computation of remaining tokens:
   * - SUM of tokens from {@link ITokenTimeTable} for the period between start and expires.
   * - This includes added tokens at creation minus all consumptions during that period.
   *
   * As the date expires and nothing can be appended to it:
   * - Unused tokens from that purchase are removed.
   * NOTE1: the field {@link IOrder.quantity} will always multiply {@link IOffer.cycle} to compute the final expiry date.
   * NOTE2: It's not recommended to mix offers with different appendDate values in the same "offerGroup" as it can mislead users.
   */
  appendDate: boolean;
  asUnlockingOfferGroups(offerGroups: string[], reset?: boolean): string[];
  /**
   * Method to set offers this offer depends on
   * @param dependsOnOffers the current offer can be unlocked only by purchasing at least one of dependsOnOffers
   * @param reset if true resets dependencies, otherwise adds the ones not already referenced
   *
   * @return string[] array of distinct offerGroups it can be unlocked by
   */
  asUnlockingOffers(dependsOnOffers: IOffer<K>[], reset?: boolean): string[];
  /**
   * An offer can combine multiple offers in one payment. Each offer is encapsulated as an {@link ICombinedOffer} that
   * specifies data on how that offer should behave in that context: eg. if it can be overridden by user's overriding offers.
   *
   * The prices of individual offers in this list will be ignored to the profit of the root offer.
   */
  combinedItems: ICombinedOffer<K>[];
  /**
   * The currency in which the price is specified: you can have multiple versions of the same offer with different
   * currencies, and filter against the customer you're displaying your information to, or have a live currency conversion.
   */
  currency: string;
  /**
   * Only allowed to have a value when cycle=custom. Expresses the order duration before expiry in seconds.
   */
  customCycle: number | null;
  /**
   * Specifies how often the offer has to be renewed.
   */
  cycle: IOfferCycle;
  /**
   * If true, signals that it unlocks other offers when purchased: check the {@link unlockedBy} field.
   */
  hasDependentOffers: boolean;
  kind: "subscription" | "tokens" | "expertise";
  name: string;
  /**
   * The value of this field groups distinct offers so that the expiration date is computed jointly:
   * For example, a "regular" subscription offer can be in different durations (week, month, trimester, etc...).
   * To group these offers as one, use the same value for this field. Another offer could be a special service
   * eg. TV on mobile. The offers related to TV that merge should have another value for offerGroup.
   * The expiration date of the corresponding offer will be computed from the last date of the same offerGroup.
   *
   * If a subscription to this offerGroup unlocks other offer, use the {@link unlockedBy} field to denote them
   * and change the value of {@link hasDependentOffers} to true.
   */
  offerGroup: string;
  /**
   * The unit price in {@link currency}
   */
  price: number;
  /**
   * The maximum allowed quantity to buy if any limit exists, or null
   */
  quantityLimit: number | null;
  /**
   * Tags here are called "functional tags" in the sense that their value is intended to change the program behavior,
   * it's not an information to be displayed to the user. You can use tags to group offers that do not necessarily
   * belong to the same offerGroup. For example: you could have "monthly billing" and "yearly billing" offers along
   * with a free limited-use offer that you want to display next to both cases. While you will have the value
   * "subscription" in offerGroup for all offers, you will have both "monthly" and "yearly" tags for the free offer,
   * and only one of these tag value for the other offers ("monthly" or "yearly").
   */
  tags: string[];
  /**
   * How many tokens this offer attributes to the user when purchased
   */
  tokenCount: number | null;
  /**
   * An array of offerGroup values informing about which purchased offers unlock access to this offer.
   * For better performance, an offer that unlocks at least one other offer when purchased is marked with
   * {@link hasDependentOffers}=true
   */
  unlockedBy: string[];
  /**
   * This field works in conjunction with {@link overridingKey}: when two overrides conflict, the one with the higher
   * {@link weight} is picked.
   */
  weight: number;

  /**if an exclusive offer has the same key as a regular one, the exclusive offer will override the regular*/
  overridingKey: string;

  /**
   * This field allows highlighting an offer for example with the text: "recommended". It is declared as a number to
   * allow multiple possibilities of highlighting eg. "recommended"=1, "best seller"=2
   */
  popular: number;
}
