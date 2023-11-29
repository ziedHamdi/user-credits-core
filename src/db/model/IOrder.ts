import { ICombinedOrder } from "./combine/ICombinedOrder";
import { IBaseEntity } from "./IBaseEntity";
import { IMinimalId } from "./IMinimalId";
import { IOfferCycle } from "./IOffer";
import { IOrderStatus } from "./IOrderStatus";

/**
 * @param K the type of foreign keys (is used for all foreign keys type)
 */
export interface IOrder<K extends IMinimalId> extends IBaseEntity<K> {
  combinedItems: ICombinedOrder<K>[];
  country: string | null;
  createdAt: Date;
  currency: string;
  customCycle: number | null;
  cycle: IOfferCycle;
  expires: Date;
  history: [IOrderStatus] | null;
  /** Check documentation in @IOffer */
  offerGroup: string;
  offerId: K;
  /**
   * This field value can change if an intent is abandoned: a new intent can be created to complete the payment.
   */
  paymentIntentId: string | null;
  /**
   * This field is not saved to db, it only carries info during the session
   */
  paymentIntentSecret: string | null;
  quantity: number;
  starts: Date;
  status: "pending" | "paid" | "refused" | "error" | "inconsistent" | "partial";
  taxRate: number | null;
  tokenCount: number | null;
  total: number;
  updatedAt: Date;
  userId: K;
}
