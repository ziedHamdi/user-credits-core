import { IBaseEntity } from "./IBaseEntity";
import { IMinimalId } from "./IMinimalId";
import { IOfferCycle } from "./IOffer";

/**
 * Interface representing a subscription.
 * @param K - The type of foreign keys (used for all foreign key types).
 */
export interface ISubscription<K extends IMinimalId> extends IBaseEntity<K> {
  /**
   * The used currency for the order
   */
  currency?: string;
  /**
   * The custom cycle duration in seconds, only applicable when cycle is 'custom'.
   */
  customCycle: number | null;

  /**
   * The cycle of the subscription (e.g., 'once', 'weekly', 'monthly', etc.).
   */
  cycle: IOfferCycle;
  expires: Date;
  name: string;
  /**
   * The grouping of offers belonging to the same service.
   * Example: "Mobile TV Basic" offer with multiple subscription options.
   */
  offerGroup: string;

  /**
   * The foreign key of the associated offer.
   */
  offerId: K;

  /**
   * The foreign key of the associated order.
   */
  orderId: K;

  /**
   * The ordered quantity
   */
  quantity: number;
  /**
   * The start date of the subscription.
   */
  starts: Date;

  /**
   * The status of the subscription, which can be 'pending', 'paid', 'refused', or 'error'.
   */
  status:
    | "pending"
    | "paid"
    | "refused"
    | "error"
    | "inconsistent"
    | "partial"
    | "expired";

  /**
   * The number of tokens associated with the subscription.
   */
  tokens: number;

  /**
   * The total price billed
   */
  total: number;
}
