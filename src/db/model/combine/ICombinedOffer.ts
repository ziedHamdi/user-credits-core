import { IMinimalId } from "../IMinimalId";
import { IOfferCycle } from "../IOffer";

/**
 * Represents an offer meta data when combined in a {@link IOffer} offer
 */
export interface ICombinedOffer<K extends IMinimalId> {
  _id: K;

  /**
   * Only allowed to have a value when cycle=custom. Expresses the order duration before expiry in seconds.
   */
  customCycle: number | null;

  /**
   * In some cases an offer can include a trial period of something, eg. internet TV package, for a period lower than the offer.
   */
  cycle: IOfferCycle;

  /**
   * Specifies the offerGroup to consume tokens from. It is allowed to specify an {@link offerGroup} value different from the one in the offer under {@link offerId}.
   * An offerGroup path (using the semicolon separator) can also be used eg: parentOfferGroup:offerGroupSample to consume from combined offers by default but fallback to root offers in the offerGroupSample group if combined a perished.
   * By default, the opposite applies: when consuming from offerGroupSample, the system will first search for root orders in that group, then fallback to finding if a combined offer contains them. You can avoid that by specifying a different offerGroup for the combined offers here.
   */
  offerGroup: string;

  /**
   * The id of the offer that is combined
   */
  offerId: K;

  /**
   * The quantity of 'offer' to include in the order
   */
  quantity: number;
}
