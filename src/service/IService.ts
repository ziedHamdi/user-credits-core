import type { IDaoFactory } from "../db/dao/types";
import type {
  IActivatedOffer,
  IMinimalId,
  IOffer,
  IOrder,
  ITokenTimetable,
  IUserCredits,
} from "../db/model/types";

/* eslint-disable typescript-sort-keys/interface */
/**
 * This is the main interface for the UserCredits library, allowing clients to interact with pay-as-you-go features.
 *
 * ⚠️ **WARNING:** Before using any of these methods, ensure that you have thoroughly checked and validated user
 * permissions and rules. This documentation assumes that you are in a secure and controlled environment when executing
 * these calls.
 *
 * @template K - The type of foreign keys used throughout the library.
 */
export interface IService<K extends IMinimalId> {
  /**
   * This method is called by the web client (or by the payment webhook server callback) after a payment has been
   * executed by the client library, whether it was successful or not.
   * It updates the user's credits based on the provided order status.
   *
   * @param {IOrder<K>} order - The order resulting from a payment transaction.
   * @returns {Promise<IUserCredits<K>>} A promise that resolves to the updated user credits.
   */
  afterExecute(order: IOrder<K>): Promise<IUserCredits<K>>;

  /**
   * scans all subscribed offers and determines which are low in tokens
   * @param userId
   * @param low
   *
   */
  checkLowTokens(
    userId: K,
    low: [{ offerGroup: string; min: number }],
  ): Promise<IActivatedOffer[] | []>;

  /**
   * Creates an order for a user from a selected offer, saving the user's intention to purchase the offer.
   *
   * @param {unknown} offerId - The unique identifier of the selected offer.
   * @param {unknown} userId - The unique identifier of the user initiating the order.
   * @returns {Promise<IOrder<K>>} A promise that resolves to the created order.
   */
  createOrder(offerId: unknown, userId: unknown): Promise<IOrder<K>>;

  /**
   * You can define your own logic for key equality
   * @param {K} a - a key
   * @param {K} b - the other key
   * @returns {boolean} true if the keys are equal, false otherwise.
   */
  equals(a: K, b: K): boolean;

  /**
   * Provides access to the data access objects (DAOs) used to store data locally within the application.
   * This includes DAOs for offers, orders, token timetables, and user credits.
   *
   * @returns {IDaoFactory<K>} The DAO factory for accessing and manipulating local data.
   */
  getDaoFactory(): IDaoFactory<K>;

  /**
   * Retrieves a list of filtered anonymous offers and user-exclusive offers based on a user's unique identifier.
   * Exclusive offers become visible to users after they purchase a basic offer with the status 'paid'.
   * Exclusive offers can be overridden by other purchased offers using the `overridingKey` and `weight` properties,
   * allowing for customization of pricing and duration.
   *
   * Please read {@link /docs/offer_loading_explained.md} for a detailed explanation.
   *
   * @param {unknown} userId - The unique identifier of the user.
   * @param {string[]} envTags - The tags to filter the base offers with.
   * @returns {Promise<IOffer<K>[]>} A promise that resolves to an array of offers available to the user.
   */
  loadOffers(userId: unknown, envTags: string[]): Promise<IOffer<K>[]>;

  /**
   * Loads the current user credits status object
   * @param {K} userId - user id
   * @returns {Promise<IUserCredits<K> | null>} A promise that resolves to an {@link IUserCredits} instance if found, or `null` otherwise.
   */
  loadUserCredits(userId: K): Promise<IUserCredits<K>>;

  /**
   * Creates a payment intent for a user from a selected offer, saving the user's intention to purchase the offer.
   *
   * @param {K} orderId - The unique identifier of the selected order.
   * @returns {Promise<IOrder<K>>} A promise that resolves to the updated order.
   */
  payOrder(orderId: K): Promise<IOrder<K>>;

  /**
   * Consumes the count number of tokens for a specific offer group of the user.
   *
   * Please note that if the user is not subscribed to the offer, we will not throw an exception.
   * This is intentional to allow consuming before paying:
   * It's up to your code to check that a user is allowed to consume from an offerGroup before letting him pass.
   *
   * You can do that by scanning the {@link IUserCredits.offers} field in the object returned by {@link IService.loadUserCredits}
   *
   * @param {K} userId - The unique identifier of the user.
   * @param {string} offerGroup - The offer group for which to retrieve the remaining tokens.
   * @param {number} count - The number of tokens consumed.
   */
  tokensConsumed(
    userId: K,
    offerGroup: string,
    count: number,
  ): Promise<ITokenTimetable<K>>;
}
