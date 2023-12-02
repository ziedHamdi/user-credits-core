import { ICombinedOrder } from "./combine/ICombinedOrder";
import { IBaseEntity } from "./IBaseEntity";
import { IMinimalId } from "./IMinimalId";
import { IOfferCycle } from "./IOffer";
import { IOrderStatus } from "./IOrderStatus";

/**
 * Represents an order entity with details about the order, including date-instruction related information.
 *
 * @template {K} - The type of foreign keys used throughout the entity.
 */
export interface IOrder<K extends IMinimalId> extends IBaseEntity<K> {
  /**
   * An array of combined orders associated with this order along with quantities and other specifications.
   * This can be used for example in a mobile operator to propose calling minutes along with an internet quota and a TV package.
   * The users will still be able to purchase individual offers. Rules applied to {@link IOffer.offerGroup} will be used along with {@link IOffer.appendDate}
   */
  combinedItems: ICombinedOrder<K>[];

  /**
   * The country associated with the order (used at payment time).
   */
  country: string | null;

  /**
   * The date and time when the order was created.
   */
  createdAt: Date;

  /**
   * The currency the order was attempted to be/paid with.
   */
  currency: string;

  /**
   * Custom cycle duration, if {@link IOffer.cycle} == "custom" specified.
   */
  customCycle: number | null;

  /**
   * The standard cycle duration associated with the order.
   */
  cycle: IOfferCycle;

  /**
   * The date and time when the order expires. This can trigger a suppression of the non consumed tokens if {@link IOffer.appendDate} is false
   */
  expires: Date;

  /**
   * History of payment operations, represented as an array of order status entities.
   */
  history: [IOrderStatus] | null;

  /**
   * The offer group to which the order belongs. Check documentation in @IOffer.
   */
  offerGroup: string;

  /**
   * The unique identifier of the associated offer.
   */
  offerId: K;

  /**
   * Represents an offer that, when combined with other offers in {@link IOffer.combinedItems},
   * generates orders with a distinct relationship. Each order created in this manner contains a
   * non-null {@link parentId} field, linking it to the parent order. This approach allows us to
   * differentiate orders paid individually from those paid as part of a larger transaction.
   *
   * While this introduces denormalization and may impact update speed, the performance cost is
   * incurred only once per item during offer payment. The benefit lies in enhancing database
   * readability by establishing clear dependencies between parent and child orders.
   *
   * @template {K} The type of identifier used for parent-child relationships.
   */
  parentId: K;

  /**
   * The payment intent ID associated with the order.
   * This field value can change if an intent is abandoned,
   * and a new intent is created to complete the payment.
   */
  paymentIntentId: string | null;

  /**
   * This field is not saved to the database; it only carries information during the session.
   * The payment intent secret associated with the order.
   */
  paymentIntentSecret: string | null;

  /**
   * The quantity specified in the order.
   */
  quantity: number;

  /**
   * The date and time when the order starts.
   * If pre-filled, use with caution, as the start date computation will be skipped.
   */
  starts: Date;

  /**
   * The current status of the order. For a complete history of statuses you can check {@link history}
   */
  status: "pending" | "paid" | "refused" | "error" | "inconsistent" | "partial";

  /**
   * The tax rate associated with the order.
   */
  taxRate: number | null;

  /**
   * The count of tokens associated with the order.
   */
  tokenCount: number | null;

  /**
   * The total cost of the order.
   */
  total: number;

  /**
   * The date and time when the order was last updated.
   */
  updatedAt: Date;

  /**
   * The unique identifier of the user/organization associated with the order.
   */
  userId: K;
}
