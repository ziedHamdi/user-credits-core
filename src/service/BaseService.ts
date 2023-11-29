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
  offerGroup: string;
  offerId: K;
  quantity: number;
  starts: Date;
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

  protected calculateExpiryDate(order: IExpiryDateComputeInput<K>): Date {
    const { quantity, starts } = order;
    const date = new Date(starts);

    switch (order.cycle) {
      case "once":
        return date;
      case "daily":
        return addDays(date, quantity);
      case "weekly":
        return addDays(date, 7 * quantity);
      case "bi-weekly":
        return addDays(date, 14 * quantity);
      case "monthly":
        return addMonths(date, quantity);
      case "trimester":
        return addMonths(date, 3 * quantity);
      case "semester":
        return addMonths(date, 4 * quantity);
      case "yearly":
        return addYears(date, quantity);
      case "custom":
        // eslint-disable-next-line no-case-declarations
        const { customCycle } = order;
        if (customCycle !== undefined && customCycle >= 0) {
          return addSeconds(date, customCycle * quantity);
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
    userId: K,
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
        userId: userId,
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

  // Might want to return the order too to indicate it was changed
  protected async updateAsPaid(
    userCredits: IUserCredits<K>,
    order: IOrder<K>,
  ): Promise<IActivatedOffer> {
    const userId = order.userId;
    const mainOfferGroupInUserCredits = await this.handleOrderDateAndTokens(
      userId,
      order as unknown as IExpiryDateComputeInput<K> & ITokenHolder,
      userCredits,
    );

    if (order.combinedItems && order.combinedItems.length > 0) {
      for (const orderItemSpec of order.combinedItems) {
        await this.handleOrderDateAndTokens(
          userId,
          orderItemSpec as unknown as IExpiryDateComputeInput<K> & ITokenHolder,
          userCredits,
        );
      }
    }

    return mainOfferGroupInUserCredits;
  }

  protected async handleOrderDateAndTokens(
    userId: K,
    orderItemSpec: IExpiryDateComputeInput<K> & ITokenHolder,
    userCredits: IUserCredits<K>,
  ) {
    await this.computeStartDate(userId, orderItemSpec);

    return this.updateOfferGroupTokens(
      orderItemSpec,
      userCredits,
      orderItemSpec,
    );
  }

  protected updateOfferGroupTokens(
    order: ITokenHolder,
    userCredits: IUserCredits<K>,
    expirySpecs: IExpiryDateComputeInput<K>,
  ) {
    if (order.tokenCount && order.tokenCount > 0)
      order.tokenCount = order.tokenCount * (order.quantity || 1);

    const expires = this.calculateExpiryDate(expirySpecs);

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
        existingPurchase.tokens += order.tokenCount;
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
