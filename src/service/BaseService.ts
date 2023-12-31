import * as console from "console";

import type {
  IDaoFactory,
  IOfferDao,
  IOrderDao,
  ITokenTimetableDao,
  IUserCreditsDao,
} from "../db/dao/types";
import { ICombinedOrder } from "../db/model/combine/ICombinedOrder";
import { IOfferCycle } from "../db/model/IOffer";
import type {
  IActivatedOffer,
  ICombinedOffer,
  IMinimalId,
  IOffer,
  IOrder,
  IOrderStatus,
  ISubscription,
  ITokenTimetable,
  IUserCredits,
} from "../db/model/types";
import { InvalidOrderError, PaymentError } from "../errors";
import {
  addDays,
  addMonths,
  addSeconds,
  addYears,
  defaultCustomEquals,
} from "../util";
import type { IService } from "./IService";

export interface IExpiryDateComputeInput<K extends IMinimalId> {
  appendDate: boolean;
  customCycle?: number;
  cycle: IOfferCycle;
  expires: Date;
  offerGroup: string;
  offerId: K;
  quantity: number;
  starts: Date;
  userId: K;
}

export type ITokenHolder = {
  offerGroup: string;
  quantity: number;
  tokenCount: number;
};

export abstract class BaseService<K extends IMinimalId> implements IService<K> {
  protected daoFactory: IDaoFactory<K>;

  protected readonly offerDao: IOfferDao<K, IOffer<K>>;
  protected readonly orderDao: IOrderDao<K, IOrder<K>>;
  protected readonly tokenTimetableDao: ITokenTimetableDao<
    K,
    ITokenTimetable<K>
  >;
  protected readonly userCreditsDao: IUserCreditsDao<K, IUserCredits<K>>;

  protected constructor(
    daoFactory: IDaoFactory<K>,
    protected defaultCurrency: string = "usd",
  ) {
    this.daoFactory = daoFactory;

    this.offerDao = daoFactory.getOfferDao();
    this.orderDao = daoFactory.getOrderDao();
    this.tokenTimetableDao = daoFactory.getTokenTimetableDao();
    this.userCreditsDao = daoFactory.getUserCreditsDao();
  }

  getDaoFactory(): IDaoFactory<K> {
    return this.daoFactory;
  }

  /**
   * Load offers based on user ID, applying overriding logic for subOffers.
   * @param userId The user's ID.
   * @param {string[]} envTags tags used to prefilter unconditional offers with environment filters out of the scope of this library
   * @returns A promise that resolves to an array of merged offers.
   */
  async loadOffers(userId: K | null, envTags?: string[]): Promise<IOffer<K>[]> {
    if (!userId) {
      return await this.getRegularOffers(envTags);
    }
    const activeSubscriptions = await this.getActiveSubscriptions(userId);
    const purchasedOfferGroups: string[] = activeSubscriptions.map(
      (subs) => subs.offerGroup,
    );
    const dependentOffers = await this.offerDao.loadOffers({
      unlockedBy: purchasedOfferGroups,
    });
    const regularOffers = await this.getRegularOffers(envTags);

    // mergedOffers
    return this.mergeOffers(regularOffers, dependentOffers);
  }

  async createOrder(
    offerId: K,
    userId: K,
    quantity?: number, // Optional quantity parameter
    currency: string = this.defaultCurrency,
  ): Promise<IOrder<K>> {
    const offer = await this.offerDao.findOne({ _id: offerId });

    if (!offer) {
      throw new Error("Offer not found"); // Handle this case based on your requirements
    }

    const total = this.computeTotal(quantity, offer);

    const order: IOrder<K> = (await this.orderDao.create({
      currency,
      customCycle: offer.customCycle,
      cycle: offer.cycle,
      offerGroup: offer.offerGroup,
      offerId,
      quantity,
      status: "pending",
      tokenCount: offer.tokenCount, //copy unconditionally
      total,
      userId,
    } as IOrder<K>)) as IOrder<K>;

    await this.prefillCombinedOrders(offer, offerId, order);
    // add Combined Orders to subscriptions here
    await this.onOrderChange(userId, order, offer);

    return order;
  }

  /**
   * Get active subscriptions for a user.
   * @param userId The user's ID.
   * @returns A promise that resolves to an array of active subscriptions.
   */
  async getActiveSubscriptions(userId: K): Promise<ISubscription<K>[]> {
    const userCredits: IUserCredits<K> =
      await this.userCreditsDao.findByUserId(userId);
    return (
      (userCredits?.subscriptions as ISubscription<K>[]).filter(
        (subscription) => subscription.status === "paid",
      ) || []
    );
  }

  /**
   * Get "regular" offers without dependent offers.
   * @returns A promise that resolves to an array of "regular" offers.
   */
  async getRegularOffers(envTags?: string[]): Promise<IOffer<K>[]> {
    // this is the simplest offer case where a user only declared some offers and some dependent offers: we make sure to filter out dependent offers
    if (!envTags) return this.offerDao.find({ unlockedBy: { $size: 0 } });

    return await this.offerDao.loadOffers({
      allTags: true,
      tags: envTags,
    });
  }

  /**
   * Merge "regular" offers with unlockedOffers, applying overriding logic.
   *
   * Unlocked Offers (by a purchase) that have the same overridingKey as a regular offer override them (keeping only the promotional exclusive offers).
   * So the method returns an intersection of regularOffers and unlockedOffers that intersect on the value of overridingKey.
   *
   * Exclusive offers have a weight, in case two unlocked offers conflict, the one with the highest weight overrides the others.
   * @param regularOffers An array of "regular" offers.
   * @param unlockedOffers An array of suboffers.
   * @returns An array of merged offers.
   */
  mergeOffers(
    regularOffers: IOffer<K>[],
    unlockedOffers: IOffer<K>[],
  ): IOffer<K>[] {
    // Create a Map to store unlockedOffers by their overridingKey
    const unlockedOffersMap = new Map<string, IOffer<K>>();

    // Populate the unlockedOffersMap with unlockedOffers, overriding duplicates
    for (const unlockedOffer of unlockedOffers) {
      const existingSubOffer = unlockedOffersMap.get(
        unlockedOffer.overridingKey,
      );
      if (
        !existingSubOffer ||
        unlockedOffer.weight > (existingSubOffer.weight || 0)
      ) {
        unlockedOffersMap.set(unlockedOffer.overridingKey, unlockedOffer);
      }
    }

    // Filter regularOffers to keep only those that are not overridden by unlockedOffers
    const mergedOffers = regularOffers.filter((regularOffer) => {
      const subOffer = unlockedOffersMap.get(regularOffer.overridingKey);
      return !subOffer; // Exclude offers overridden by suboffers
    });

    // Add the unlockedOffers to the mergedOffers
    mergedOffers.push(...Array.from(unlockedOffersMap.values()));

    return mergedOffers;
  }

  async isUserAlreadySubscribed(
    userId: K,
    offerId: K,
  ): Promise<IOrder<K> | null> {
    // existingSubscription
    return await this.orderDao.findOne({
      offerId: offerId,
      status: "paid",
      userId: userId, // You may want to adjust this based on your criteria
    });
  }

  abstract afterExecute(order: IOrder<K>): Promise<IUserCredits<K>>;

  loadUserCredits(userId: K): Promise<IUserCredits<K>> {
    return this.daoFactory.getUserCreditsDao().findByUserId(userId);
  }

  equals(a: K, b: K): boolean {
    return defaultCustomEquals(a, b);
  }

  async tokensConsumed(
    userId: K,
    offerGroup: string,
    count: number,
  ): Promise<ITokenTimetable<K>> {
    const tokenTimetableDao = this.getDaoFactory().getTokenTimetableDao();
    const tokenTimetable = await tokenTimetableDao.create({
      offerGroup,
      tokens: -count,
      userId,
    } as Partial<ITokenTimetable<K>>);
    const userCredits = await this.getUserCredits(userId);
    const offer = userCredits.offers.find((activeOfferGroup) => {
      if (activeOfferGroup.offerGroup === offerGroup) {
        activeOfferGroup.tokens = (activeOfferGroup.tokens ?? 0) - count;
        return true;
      }
      return false;
    });
    if (!offer) {
      if (!userCredits.offers) userCredits.offers = [];

      userCredits.offers.push({
        offerGroup,
        starts: new Date(),
        tokens: -count,
      } as IActivatedOffer);
    }

    userCredits.markModified("offers");
    await userCredits.save();
    return tokenTimetable;
  }

  abstract payOrder(orderId: K): Promise<IOrder<K>>;

  /**
   * Checks for expired orders and warnings based on both expiration date and low token criteria.
   *
   * @param userId - The unique identifier of the user.
   * @param warnBeforeInMillis - Optional parameter specifying the warning duration in milliseconds before an order expires.
   * @param low - Optional parameter specifying the minimum token limit and the associated offer group to warn the user about low credits.
   * @returns A promise that resolves to an object containing arrays of expired and warned offers.
   *
   * @example
   * // Example usage:
   * const userId = "uniqueUserId";
   * const warningDuration = 86400000; // 24 hours in milliseconds
   * const lowLimits = [{ min: 10, offerGroup: "GroupA" }, { min: 5, offerGroup: "GroupB" }];
   * const { expired, warnings } = await yourOfferAndOrdersLibrary.checkForExpiredOrders(userId, warningDuration, lowLimits);
   * // Result: An object with arrays of expired and warned offers.
   */
  async checkForExpiredOrders(
    userId: K,
    warnBeforeInMillis?: number,
    low?: { min: number; offerGroup: string }[],
  ): Promise<{
    expired: IActivatedOffer[] | [];
    warnings: IActivatedOffer[] | [];
  }> {
    const userCredits = await this.userCreditsDao.findById(userId);
    const warnings: IActivatedOffer[] = [];
    const expired: IActivatedOffer[] = [];
    if (!userCredits) return { expired, warnings };
    const now = Date.now();

    // loop over the active offer group states
    for (const group of userCredits.offers) {
      if (!group || !group?.expires) continue;

      if (group.expires.getTime() - now <= (warnBeforeInMillis || 0)) {
        if (group.expires.getTime() - now <= 0) {
          expired.push(group);
          const tokensToSubtract = await this.processExpiredOrderGroup(
            userId,
            group.offerGroup,
          );
          // this is to cover negative tokens cases
          if (!group.tokens) group.tokens = 0;

          group.tokens -= tokensToSubtract;
        } else {
          warnings.push(group);
        }
      }

      if (group.tokens && low) {
        const limit = low.find(
          (offerGroupSpec) => offerGroupSpec.offerGroup === group.offerGroup,
        );
        if (limit && group.tokens - (limit?.min || 0) <= 0) {
          warnings.push(group);
        }
      }
    }
    // if the userCredits object was altered, save changes.
    if (expired.length > 0) {
      // Remove the expired group from active groups in userCredits.offers
      userCredits.offers = userCredits.offers.filter((offer) => {
        const found = expired.find(
          (expiredItem) => offer.offerGroup === expiredItem.offerGroup,
        );
        return !found; // skip if in the expired list
      });
      userCredits.markModified("offers");

      await userCredits.save();
    }

    return { expired, warnings };
  }

  /**
   * Processes the expiration of orders within a specific offer group for a user.
   *
   * @protected
   * @param {string} userId - The unique identifier of the user.
   * @param {string} offerGroup - The offer group for which to process expired orders.
   * @returns {Promise<number>} A promise that resolves to the total tokens to subtract as a result of processing expired orders.
   *
   * @example
   * // Example usage:
   * const userId = "uniqueUserId";
   * const offerGroup = "GroupA";
   * const tokensToSubtract = await yourOfferAndOrdersLibrary.processExpiredOrderGroup(userId, offerGroup);
   * // Result: Total tokens subtracted as a result of processing expired orders in the specified offer group.
   */
  protected async processExpiredOrderGroup(
    userId: K,
    offerGroup: string,
  ): Promise<number> {
    /* eslint-disable sort-keys-fix/sort-keys-fix */
    // don't sort: order is important for performance
    const orderList = (await this.orderDao.find({
      userId,
      status: "paid",
      offerGroup,
    })) as IOrder<K>[];
    /* eslint-enable sort-keys-fix/sort-keys-fix */

    let tokensToSubtract = 0;
    // double check the date is expired
    for (const order of orderList) {
      if (order.expires.getTime() - Date.now() > 0) {
        // leave the paid orders that didn't expire untouched
        continue;
      }
      // add what the order brought, then remove what was consumed to obtain the remaining tokens that will have to be deleted as the order expired
      tokensToSubtract += order.tokenCount || 0;
      tokensToSubtract += await this.tokenTimetableDao.consumptionInDateRange(
        offerGroup,
        order.starts,
        order.expires,
      );
      order.status = "expired";
      await order.save();
    }
    return tokensToSubtract;
  }

  /**
   * Each offer in {@link IOffer.combinedItems} will have a corresponding item in the order {@link IOrder.combinedItems}
   * @param offer
   * @param offerId
   * @param order
   * @protected
   */
  protected async prefillCombinedOrders(
    offer: IOffer<K>,
    offerId: K,
    order: IOrder<K>,
  ) {
    if (offer.combinedItems && offer.combinedItems.length > 0) {
      for (const item of offer.combinedItems) {
        const combinedOffer = await this.offerDao.findById(item.offerId);
        if (!combinedOffer) {
          console.error(
            "There's an error in the specification of offer: " +
              offer._id +
              " : the combinedItem with offerId: " +
              offerId +
              " can't be resolved.",
          );
          continue;
        }
        const tokenCount =
          (item.quantity || 1) * (combinedOffer.tokenCount ?? 0);
        if (!order.combinedItems) order.combinedItems = [];

        const orderItem = {
          offerGroup: item.offerGroup,
          offerId: item.offerId,
          quantity: item.quantity,
          tokenCount,
        } as ICombinedOrder<K>;

        order.combinedItems.push(orderItem);
      }
    }
    order.markModified("combinedItems");
  }

  protected computeTotal(quantity: number | undefined, offer: IOffer<K>) {
    // Check if the offer's maximum allowed quantity is defined and higher than the requested quantity
    if (
      offer.quantityLimit !== null &&
      quantity !== undefined &&
      quantity > offer.quantityLimit
    ) {
      throw new InvalidOrderError("Requested quantity exceeds the limit");
    }
    return quantity !== undefined ? offer.price * quantity : offer.price;
  }

  protected async onOrderChange(userId: K, order: IOrder<K>, offer: IOffer<K>) {
    let userCredits: IUserCredits<K> | null =
      await this.userCreditsDao.findByUserId(userId);
    userCredits = await this.updateSubscriptionsOnOrderChange(
      userCredits,
      offer,
      order,
      userId,
    );

    await userCredits.save();
  }

  protected async updateSubscriptionsOnOrderChange(
    userCredits: IUserCredits<K> | null,
    offer: IOffer<K>,
    order: IOrder<K>,
    userId: K,
  ) {
    const subscriptionList: ISubscription<K>[] = this.buildSubscriptionList(
      offer,
      order,
    );
    if (!userCredits) {
      userCredits = await this.userCreditsDao.build({
        subscriptions: subscriptionList,
        userId,
      });
    } else {
      for (const subscription of subscriptionList) {
        // Check if a subscription with the same orderId exists
        subscription.status = order.status;
        const existingSubscription = userCredits.subscriptions.find(
          (ucSubscription) =>
            ucSubscription.orderId.toString() === order._id.toString() &&
            ucSubscription.offerId.toString() ===
              subscription.offerId.toString(),
        );
        if (existingSubscription) {
          // Update the existing subscription
          existingSubscription.expires = subscription.expires;
          existingSubscription.starts = subscription.starts;
          existingSubscription.status = subscription.status;
        } else {
          userCredits.subscriptions.push(
            subscription as unknown as ISubscription<K>,
          );
        }
      }
    }
    return userCredits;
  }

  protected buildSubscriptionList(offer: IOffer<K>, order: IOrder<K>) {
    const toReturn: ISubscription<K>[] = [];
    if (offer.combinedItems) {
      for (const offerItem of offer.combinedItems) {
        const combinedOrder = order
          ? order.combinedItems?.find(
              (item) => item.offerGroup === offerItem.offerGroup,
            )
          : null;
        const quantity = (order.quantity || 1) * (combinedOrder?.quantity || 1);
        // this avoids loading the offer from database
        const offerTokenCount = combinedOrder?.tokenCount
          ? combinedOrder?.tokenCount / (order.quantity || 1)
          : undefined;
        toReturn.push({
          currency: order.currency,
          customCycle: offerItem.customCycle ?? offer.customCycle,
          cycle: offerItem.cycle ?? offer.cycle,
          expires: combinedOrder?.expires ?? order.expires,
          name: offerItem.offerGroup,
          offerGroup: offerItem.offerGroup,
          offerId: offerItem.offerId,
          orderId: order._id,
          quantity,
          starts: combinedOrder?.starts ?? order.starts,
          status: "pending",
          tokens: offerTokenCount,
          total: 0,
        } as unknown as ISubscription<K>);
      }
    }
    toReturn.push({
      currency: order.currency,
      customCycle: offer.customCycle,
      cycle: offer.cycle,
      expires: order.expires,
      name: offer.name,
      offerGroup: offer.offerGroup,
      offerId: order.offerId,
      orderId: order._id,
      quantity: order.quantity || 1,
      starts: order.starts,
      status: "pending",
      tokens: offer.tokenCount,
      total: order.total,
    } as unknown as ISubscription<K>);

    return toReturn;
  }

  protected async getUserCredits(userId: K): Promise<IUserCredits<K>> {
    const userCredits: IUserCredits<K> = await this.daoFactory
      .getUserCreditsDao()
      .findByUserId(userId);

    if (!userCredits) {
      throw new PaymentError(
        `Illegal state: user has no prepared userCredits (${userId}).`,
      );
    }

    return userCredits;
  }

  protected calculateExpiryDate(
    order: IExpiryDateComputeInput<K>,
    quantityMultiplier: number = 1,
  ): Date {
    const { quantity = 1, starts } = order;
    const totalQuantity = quantityMultiplier * quantity;
    const date = new Date(starts);

    switch (order.cycle) {
      case "once":
        return date;
      case "daily":
        return addDays(date, totalQuantity);
      case "weekly":
        return addDays(date, 7 * totalQuantity);
      case "bi-weekly":
        return addDays(date, 14 * totalQuantity);
      case "monthly":
        return addMonths(date, totalQuantity);
      case "trimester":
        return addMonths(date, 3 * totalQuantity);
      case "semester":
        return addMonths(date, 4 * totalQuantity);
      case "yearly":
        return addYears(date, totalQuantity);
      case "custom":
        // eslint-disable-next-line no-case-declarations
        const { customCycle } = order;
        if (customCycle !== undefined && customCycle >= 0) {
          return addSeconds(date, customCycle * totalQuantity);
        }
        break;
    }

    // Handle invalid or missing cycle
    throw new Error("Invalid or missing cycle value");
  }

  /**
   * Computes the start date for an order based on the specified logic.
   * If an explicit start date is provided, it is used unless it has passed.
   * If no explicit start date is provided, it is determined based on the appendDate setting.
   *
   * @param order - The order for which to compute the start date.
   * @throws {InvalidOrderError} - If the explicit start date has passed.
   */
  protected async computeStartDate(
    order: IExpiryDateComputeInput<K>,
  ): Promise<Date> {
    const now = new Date();
    if (order.starts) {
      if (now.getTime() > order.starts.getTime())
        throw new InvalidOrderError(
          "Explicit start date has passed:" + order.starts,
        );
      return order.starts;
    }

    const offer = await this.offerDao.findById(order.offerId);

    if (!offer) console.error("Order related offerId not found: ", order);
    // volatile offers are safely handled here
    const appendDate = offer?.appendDate ?? false;
    if (!appendDate) {
      // If appendDate is false, use Date.now() as the start date
      return now;
    } else {
      const orderList: IOrder<K>[] = await this.orderDao.find({
        expires: { $exists: true },
        offerGroup: order.offerGroup,
        status: "paid",
        userId: order.userId,
      });
      if (!orderList || orderList.length == 0) {
        return now;
      }

      const lastToFirstExpiryDate = orderList.sort(
        (a, b) => (b.expires?.getTime() || 0) - (a.expires?.getTime() || 0),
      );
      const starts = lastToFirstExpiryDate[0].expires;
      return starts.getTime() > now.getTime() ? starts : now;
    }
  }

  protected afterFreeOrderExecuted(order: IOrder<K>) {
    order.status = "paid";
    const historyItem = {
      message: "Free subscription succeeded",
      status: "paid",
    } as IOrderStatus;
    if (!order.history) {
      order.history = [] as unknown as [IOrderStatus];
    }
    historyItem.date = historyItem.date ?? new Date();
    order.history.push(historyItem);
    order.markModified("history");

    return order;
  }

  // Might want to return the order too to indicate it was changed
  protected async updateCredits(
    userCredits: IUserCredits<K>,
    updatedOrder: IOrder<K>,
  ): Promise<IActivatedOffer | null> {
    let offer = await this.offerDao.findById(updatedOrder.offerId);
    if (!offer) {
      // this is in case the offer was deleted meanwhile, not properly handled for now
      offer = {
        ...updatedOrder,
      } as unknown as IOffer<K>;
      if (updatedOrder.tokenCount) {
        offer.tokenCount = updatedOrder.tokenCount / updatedOrder.quantity;
      }
    }
    let iActivatedOffer = null;
    if (updatedOrder.status === "paid") {
      // Payment was successful, increment the user's offer tokens
      // existingSubscription.tokens += updatedOrder.tokenCount || 0;
      // Modify the offer object as needed
      // offerGroup

      iActivatedOffer = (await this.updateAsPaid(
        userCredits,
        updatedOrder,
      )) as IActivatedOffer;

      // these will be saved by the caller
      if (updatedOrder.tokenCount) {
        const tokenTimetableDao = this.getDaoFactory().getTokenTimetableDao();
        await tokenTimetableDao.create({
          offerGroup: updatedOrder.offerGroup,
          tokens: updatedOrder.tokenCount,
          userId: userCredits.userId,
        } as Partial<ITokenTimetable<K>>);
      }
    }

    // has to be done after expiry date ahs been computed
    await this.updateSubscriptionsOnOrderChange(
      userCredits,
      offer,
      updatedOrder,
      userCredits.userId,
    );

    return iActivatedOffer;
  }

  /**
   * Updates the {@link IOrder} object and handles combined orders after a successful payment.
   * Also updates the passed {@link IUserCredits} object.
   *
   * This method ensures the order and its combined items are correctly processed,
   * considering date computation and token handling.
   *
   * WARNING: Nested offers' {@link IOffer.appendDate} field is treated independently from the root offer.
   * If you want a combined offer nested subOffers not to be linked with their regular peers,
   * create a copy of them with a different {@link IOffer.appendDate} value and the same offerGroup.
   * This way, you will benefit from token addition while controlling the expiry and start dates.
   *
   * For example, if a user purchases a phone package with calling hours and internet data,
   * then adds phone hours, you can control the validity date of the added phone hours by changing
   * the value of {@link IOffer.appendDate} (and reversely, buying calling hours then a phone package).
   *
   * IMPROVEMENT Might want to return the order too to indicate it was changed (or find another naming convention prefix than update, which is confusing)
   * @param userCredits - The user credits object.
   * @param order - The order object to update.
   * @returns The activated offer group in user credits.
   * @protected
   */
  protected async updateAsPaid(
    userCredits: IUserCredits<K>,
    order: IOrder<K>,
  ): Promise<IActivatedOffer> {
    order.starts = await this.computeStartDate(
      order as unknown as IExpiryDateComputeInput<K>,
    );
    order.expires = this.calculateExpiryDate(
      order as unknown as IExpiryDateComputeInput<K>,
    );
    order.tokenCount = (order.quantity || 1) * (order.tokenCount || 0);
    const activeOffer = this.appendOrPushActiveOffer(userCredits, {
      expires: order.expires,
      offerGroup: order.offerGroup,
      starts: order.starts,
      tokens: order.tokenCount,
    });

    const offer = await this.offerDao.findById(order.offerId);
    // IMPROVEMENT this behavior should be improved to accept lost offers, and act upon the order data
    if (!offer) {
      throw new InvalidOrderError(
        "Offer with id " + order.offerId + " in order " + order._id,
      );
    }
    const combinedItems = offer.combinedItems;
    if (combinedItems && combinedItems.length > 0) {
      order.combinedItems = order.combinedItems ?? [];
      for (const orderItemSpec of combinedItems) {
        await this.updateNestedItemAsPaid(orderItemSpec, userCredits, order);
      }
    }

    return activeOffer;
  }

  protected async updateNestedItemAsPaid(
    orderItemSpec: ICombinedOffer<K>,
    userCredits: IUserCredits<K>,
    rootOrder: IOrder<K>,
  ) {
    const offer = (await this.offerDao.findById(
      orderItemSpec.offerId,
    )) as IOffer<K>;

    await this.updateNestedItemDateAndTokens(
      offer,
      rootOrder,
      userCredits,
      orderItemSpec,
    );

    // the tokens, start, and expiry dates are by now computed and stored in userCredits.offers, read them back to insert nested orders
    const computed = userCredits.offers?.find(
      (offer) => offer.offerGroup === orderItemSpec.offerGroup,
    );

    // save the order with its parent id and the computed tokenCount, starts and expiry dates
    const quantity = (orderItemSpec.quantity || 1) * (rootOrder.quantity || 1);
    const nested = {
      cycle: offer.cycle,
      expires: computed?.expires,
      offerGroup: orderItemSpec.offerGroup,
      offerId: orderItemSpec.offerId,
      quantity,
      starts: computed?.starts,
      tokenCount: 0,
    };
    if (offer.tokenCount) {
      nested.tokenCount = offer.tokenCount * quantity;
    }
    rootOrder.combinedItems.push(nested as ICombinedOrder<K>);

    await this.orderDao.create({
      ...nested,
      currency: rootOrder.currency,
      customCycle: offer.customCycle,
      parentId: rootOrder._id,
      status: "paid",
      total: 0,
      userId: userCredits.userId,
    } as IOrder<K>);

    // Insert credits to the user
    await this.tokenTimetableDao.create({
      offerGroup: orderItemSpec.offerGroup,
      tokens: (offer.tokenCount || 0) * quantity,
      userId: userCredits.userId,
    } as ITokenTimetable<K>);
  }

  protected async updateNestedItemDateAndTokens(
    offer: IOffer<K>,
    rootOrder: IOrder<K>,
    userCredits: IUserCredits<K>,
    orderItemSpec: ICombinedOffer<K>,
  ): Promise<IActivatedOffer> {
    const orderComputeInput =
      orderItemSpec as unknown as IExpiryDateComputeInput<K> & ITokenHolder;

    // since we don't have an order, we emulate it by copying the tokenCount from the offer.
    if (!orderComputeInput.tokenCount && offer.tokenCount) {
      orderComputeInput.tokenCount = offer.tokenCount;
    }

    let starts;
    let expires;

    if (offer.appendDate) {
      orderComputeInput.cycle = orderComputeInput.cycle ?? offer.cycle;
      orderComputeInput.userId = rootOrder.userId;
      starts = await this.computeStartDate(orderComputeInput);
      expires = this.calculateExpiryDate(
        { ...orderComputeInput, starts },
        rootOrder.quantity,
      );
    } else {
      const rootActiveOffer = userCredits.offers.find(
        (item) => item.offerGroup === rootOrder.offerGroup,
      );
      starts = rootActiveOffer!.starts;
      expires = rootActiveOffer!.expires;
    }
    const activeOffer = {
      expires,
      offerGroup: orderItemSpec.offerGroup,
      starts,
      tokens:
        (rootOrder.quantity || 1) *
        (orderComputeInput.quantity || 1) *
        (orderComputeInput.tokenCount || 0),
    };

    return this.appendOrPushActiveOffer(userCredits, activeOffer);
  }

  protected appendOrPushActiveOffer(
    userCredits: IUserCredits<K>,
    activeOffer: IActivatedOffer,
  ): IActivatedOffer {
    const found = userCredits.offers.find(
      (offer) => offer.offerGroup === activeOffer.offerGroup,
    );
    if (found) {
      found.expires = activeOffer.expires;
      found.starts = activeOffer.starts;
      if (found.tokens) {
        if (activeOffer.tokens) found.tokens += activeOffer.tokens;
      }
      return found;
    } else {
      userCredits.offers.push(activeOffer);
      return activeOffer;
    }
  }
}
