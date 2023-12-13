import type { IMinimalId } from "../IMinimalId";
import type { IOfferCycle } from "../IOffer";

/**
 * When an offer has {@link IOffer.combinedItems} each item translates into an instance of this implementation
 */
export interface ICombinedOrder<K extends IMinimalId> {
  /**
   * Only allowed to have a value when cycle=custom. Expresses the order duration before expiry in seconds.
   */
  customCycle: number | null;
  /**
   * In some cases an offer can include a trial period of something, eg. internet TV package, for a period lower than the offer.
   */
  cycle: IOfferCycle;
  expires: Date;
  offerGroup: string;
  offerId: K;
  /**
   * Impacts both {@link expires} date and {@link tokenCount}
   */
  quantity: number;
  /**
   * If the start date is explicitly specified, then it iis used as is.
   *
   * If {@link offerId} is linked to an offer with {@link IOffer.appendDate} set to true: the start date will start
   * just after the expiry date of last order in that {@link offerGroup}. The {@link expires} date will be computed
   * from that start date (or the current date if not present or perished).
   *
   * If {@link IOffer.appendDate} is false, then the date of payment will be used.
   */
  starts: Date;
  tokenCount: number;
}
