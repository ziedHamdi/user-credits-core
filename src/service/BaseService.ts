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
  IMinimalId,
  IOffer,
  IOrder,
  IOrderStatus,
  ISubscription,
  ITokenTimetable,
  IUserCredits,
} from "../db/model/types";
import {
  EntityNotFoundError,
  InvalidOrderError,
  PaymentError,
} from "../errors";
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

  async orderStatusChanged(
    orderId: K,
    status: "pending" | "paid" | "refused",
  ): Promise<IOrder<K>> {
    const order: null | IOrder<K> = await this.orderDao.findById(orderId);
    if (!order) throw new EntityNotFoundError("IOrder", orderId);
    order.status = status;
    await order.save();
    return order as IOrder<K>;
  }

  async remainingTokens(userId: K): Promise<IUserCredits<K>> {
    const userCredits: null | IUserCredits<K> =
      await this.userCreditsDao.findOne({ userId });
    if (!userCredits) throw new EntityNotFoundError("IUserCredits", userId);
    return userCredits;
  }

  async checkLowTokens(
    userId: K,
    low: [{ min: number; offerGroup: string }],
  ): Promise<[IActivatedOffer] | []> {
    const userCredits = await this.userCreditsDao.findById(userId);
    const toReturn: [IActivatedOffer] | [] = [];
    if (!userCredits) return toReturn;

    for (const group of userCredits.offers) {
      if (!group || !group?.tokens) continue;

      for (const limit of low) {
        if (group.tokens - (limit?.min || 0) <= 0) {
          const activatedOffer: IActivatedOffer = group!;
          toReturn.push(activatedOffer);
        }
      }
    }
    return toReturn;
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
    if (!userCredits) {
      const subscription: Partial<ISubscription<K>> = this.buildSubscription(
        offer,
        order,
      );
      userCredits = await this.userCreditsDao.build({
        subscriptions: [subscription],
        userId,
      });
    } else {
      // Check if a subscription with the same orderId exists
      const existingSubscription = userCredits.subscriptions.find(
        (subscription) => subscription.orderId === order._id,
      );

      if (existingSubscription) {
        // Update the existing subscription
        existingSubscription.status = order.status;
        existingSubscription.starts = order.updatedAt;
      } else {
        // Create a new subscription and add it to the array
        const newSubscription: Partial<ISubscription<K>> =
          this.buildSubscription(offer, order);

        userCredits.subscriptions.push(
          newSubscription as unknown as ISubscription<K>,
        );
      }
    }
    return userCredits;
  }

  protected buildSubscription(offer: IOffer<K>, order: IOrder<K>) {
    return {
      currency: order.currency,
      customCycle: offer.customCycle,
      cycle: offer.cycle,
      expired: order.expires,
      name: offer.name,
      offerGroup: offer.offerGroup,
      offerId: order.offerId,
      orderId: order._id,
      quantity: order.quantity,
      starts: order.createdAt,
      status: "pending",
      tokens: offer.tokenCount,
      total: order.total,
    } as unknown as ISubscription<K>;
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
  ): Promise<void> {
    const now = new Date();
    if (order.starts) {
      if (now.getTime() > order.starts.getTime())
        throw new InvalidOrderError(
          "Explicit start date has passed:" + order.starts,
        );
      return;
    }

    const offer = await this.offerDao.findById(order.offerId);

    // volatile offers are safely handled here
    const appendDate = offer?.appendDate ?? false;
    if (!appendDate) {
      // If appendDate is false, use Date.now() as the start date
      order.starts = now;
    } else {
      const orderList: IOrder<K>[] = await this.orderDao.find({
        expires: { $exists: true },
        offerGroup: order.offerGroup,
        status: "paid",
        userId: order.userId,
      });
      if (!orderList || orderList.length == 0) {
        order.starts = now;
        return;
      }

      const lastToFirstExpiryDate = orderList.sort(
        (a, b) => (b.expires?.getTime() || 0) - (a.expires?.getTime() || 0),
      );
      order.starts = lastToFirstExpiryDate[0].expires;
      if (order.starts.getTime() < now.getTime()) order.starts = now;
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
    const existingSubscription: ISubscription<K> =
      userCredits.subscriptions.find((subscription) =>
        this.equals(subscription.orderId, updatedOrder._id),
      ) as ISubscription<K>;

    if (!existingSubscription) {
      throw new PaymentError(
        `Illegal state: userCredits(${
          userCredits._id
        }) has no subscription for orderId (${
          updatedOrder._id
        }). Found subscriptions: ${JSON.stringify(userCredits.subscriptions)}`,
      );
    }

    existingSubscription.status = updatedOrder.status;

    if (updatedOrder.status === "paid") {
      // Payment was successful, increment the user's offer tokens
      // existingSubscription.tokens += updatedOrder.tokenCount || 0;
      // Modify the offer object as needed
      // offerGroup
      const iActivatedOffer = (await this.updateAsPaid(
        userCredits,
        updatedOrder,
      )) as IActivatedOffer;

      // these will be saved by the caller
      existingSubscription.starts = updatedOrder.starts;
      existingSubscription.expires = updatedOrder.expires;

      if (updatedOrder.tokenCount) {
        const tokenTimetableDao = this.getDaoFactory().getTokenTimetableDao();
        await tokenTimetableDao.create({
          offerGroup: updatedOrder.offerGroup,
          tokens: updatedOrder.tokenCount,
          userId: userCredits.userId,
        } as Partial<ITokenTimetable<K>>);
      }

      return iActivatedOffer;
    }

    return null;
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
    const userId = order.userId;

    const mainOfferGroupInUserCredits = await this.updateOrderDateAndTokens(
      userId,
      order as unknown as IExpiryDateComputeInput<K> & ITokenHolder,
      userCredits,
    );

    if (order.combinedItems && order.combinedItems.length > 0) {
      for (const orderItemSpec of order.combinedItems) {
        const offer = (await this.offerDao.findById(
          orderItemSpec.offerId,
        )) as IOffer<K>;

        await this.updateOrderDateAndTokens(
          userId,
          orderItemSpec as unknown as IExpiryDateComputeInput<K> & ITokenHolder,
          userCredits,
          order.quantity,
        );

        // the tokens, start, and expiry dates are by now computed and stored in userCredits.offers, read them back to insert nested orders
        const computed = userCredits.offers?.find(
          (offer) => offer.offerGroup === orderItemSpec.offerGroup,
        );

        // save the order with its parent id and the computed tokenCount, starts and expiry dates
        await this.orderDao.create({
          currency: order.currency,
          customCycle: offer.customCycle,
          cycle: offer.cycle,
          expires: computed?.expires,
          offerGroup: orderItemSpec.offerGroup,
          offerId: orderItemSpec.offerId,
          parentId: order._id,
          quantity: (orderItemSpec.quantity || 1) * (order.quantity || 1),
          starts: computed?.starts,
          status: "paid",
          tokenCount: computed?.tokens,
          total: 0,
          userId,
        } as IOrder<K>);

        // Insert credits to the user
        await this.tokenTimetableDao.create({
          offerGroup: orderItemSpec.offerGroup,
          tokens: computed?.tokens,
          userId,
        } as ITokenTimetable<K>);
      }
    }

    return mainOfferGroupInUserCredits;
  }

  /**
   * Handles date computation and token updates for a specific order item.
   *
   * @param userId - The user ID.
   * @param orderItemSpec - The order item specifications.
   * @param userCredits - The user credits object.
   * @param quantity - the ordered quantity, defaults to 1: only used in combined offers to specify how many times a
   * sub-offer is to be included in a package.
   *
   * For example, a phone operator, may include 1000Mb of data. in that case,
   * the quantity will be 1000 if tokens are consumed by 1Mb or 1.000.000 if they are consumed by 1Kb.
   * @returns The updated offer group for the order item.
   * @protected
   */
  protected async updateOrderDateAndTokens(
    userId: K,
    orderItemSpec: IExpiryDateComputeInput<K> & ITokenHolder,
    userCredits: IUserCredits<K>,
    quantity: number = 1,
  ) {
    await this.computeStartDate(orderItemSpec);
    orderItemSpec.expires = this.calculateExpiryDate(orderItemSpec, quantity);
    return this.updateOfferGroupTokens(
      orderItemSpec,
      userCredits,
      orderItemSpec,
      quantity,
    );
  }

  /**
   * Updates the expiry date and token count of the offer group in user credits based on the order details.
   *
   * @param order - The order object.
   * @param userCredits - The user credits object.
   * @param expirySpecs - The expiry date computation specifications.
   * @param quantity - the ordered quantity, defaults to 1: only used in combined offers to specify how many times a
   * sub-offer is to be included in a package.
   *
   * @returns The updated offer group.
   * @protected
   */
  protected updateOfferGroupTokens(
    order: ITokenHolder,
    userCredits: IUserCredits<K>,
    expirySpecs: IExpiryDateComputeInput<K>,
    quantity: number = 1,
  ) {
    if (order.tokenCount && order.tokenCount > 0)
      order.tokenCount = quantity * order.tokenCount * (order.quantity || 1);

    const expires = expirySpecs.expires;

    const existingOfferIndex = userCredits.offers.findIndex(
      (offer) => offer.offerGroup === order.offerGroup,
    );
    if (existingOfferIndex !== -1) {
      // Extend the existing offer with the new information
      const existingPurchase = userCredits.offers[existingOfferIndex];
      existingPurchase.expires = expires;
      if (order.tokenCount) {
        if (!existingPurchase.tokens) {
          existingPurchase.tokens = 0;
        }
        existingPurchase.tokens += order.tokenCount * quantity;
      }
      return existingPurchase;
    }

    const newOffer = {
      expires,
      offerGroup: order.offerGroup,
      starts: expirySpecs.starts,
      tokens: order.tokenCount,
    };
    userCredits.offers.push(newOffer);
    return newOffer;
  }
}
