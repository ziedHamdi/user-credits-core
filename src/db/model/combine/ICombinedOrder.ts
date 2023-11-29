import { IMinimalId } from "../IMinimalId";
/**
 * When an offer has {@link IOffer.combinedItems} each item translates into an instance of this implementation
 */
export interface ICombinedOrder<K extends IMinimalId> {
  expires: Date;
  offerGroup: string;
  offerId: K;
  quantity: number;
  starts: Date;
  tokenCount: number;
}
