import type { IDaoFactory } from "../db/dao/types";
import type {
  IActivatedOffer,
  IMinimalId,
  IOrder,
  ISubscription,
  ITokenTimetable,
  IUserCredits,
} from "../db/model/types";
import {
  EntityNotFoundError,
  InvalidPaymentError,
  PaymentError,
  PaymentErrorCode,
  PaymentErrorDetails,
} from "../errors";
import { BaseService } from "./BaseService";
import type { IPaymentClient } from "./IPaymentClient";

export class PaymentService<K extends IMinimalId> extends BaseService<K> {
  constructor(
    daoFactory: IDaoFactory<K>,
    protected paymentClient: IPaymentClient<K>,
    protected defaultCurrency: string,
  ) {
    super(daoFactory, defaultCurrency);
  }

  async createOrder(
    offerId: K,
    userId: K,
    quantity?: number, // Optional quantity parameter
    currency: string = this.defaultCurrency,
  ): Promise<IOrder<K>> {
    const order = await super.createOrder(offerId, userId, quantity, currency);
    return await this.payLoadedOrder(order);
  }

  async payOrder(orderId: K): Promise<IOrder<K>> {
    const order = (await super
      .getDaoFactory()
      .getOrderDao()
      .findById(orderId)) as IOrder<K>;
    return await this.payLoadedOrder(order);
  }

  async afterExecute(order: IOrder<K>): Promise<IUserCredits<K>> {
    if (order.status == "paid") {
      throw new InvalidPaymentError("order is already paid", {
        errorCode: PaymentErrorCode.DuplicateAttemptError,
        orderId: order._id,
      } as PaymentErrorDetails);
    }
    // Retrieve user credits
    const userCredits: IUserCredits<K> = await this.getUserCredits(
      order.userId,
    );

    // Execute the payment and get the updated order
    const updatedOrder: IOrder<K> =
      await this.paymentClient.afterPaymentExecuted(order);

    // Update the subscription
    await this.updateCredits(userCredits, updatedOrder);
    // save the order with its new state and history (taken from the payment platform) and its start and expiry dates computed
    await updatedOrder.save();

    // Save the changes to user credits
    userCredits.markModified("offers");
    await userCredits.save();

    return userCredits;
  }

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

  protected async payLoadedOrder(order: IOrder<K>) {
    const orderWithIntent = await this.paymentClient.createPaymentIntent(order);
    if (!orderWithIntent)
      throw new InvalidPaymentError("Failed to create payment intent", {
        orderId: order._id,
      });

    // save the paymentIntentId to the original order: https://github.com/ziedHamdi/user-credits-core/issues/1
    const updatedOrder = (await this.getDaoFactory()
      .getOrderDao()
      .findById(order._id)) as IOrder<K>;
    updatedOrder.paymentIntentId = orderWithIntent.paymentIntentId;
    await updatedOrder.save();

    //this value should not be saved to db, it is temporary for the transaction only
    updatedOrder.paymentIntentSecret = orderWithIntent.paymentIntentSecret;
    return updatedOrder;
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
    if (!order.starts) {
      await this.computeStartDate(order);
    }
    // Create a new offer if not found
    order.expires = this.calculateExpiryDate(
      order.starts,
      order.cycle,
      order.quantity,
    );

    if (order.tokenCount && order.tokenCount > 0)
      order.tokenCount = order.tokenCount * (order.quantity || 1);

    const existingOfferIndex = userCredits.offers.findIndex(
      (offer) => offer.offerGroup === order.offerGroup,
    );
    if (existingOfferIndex !== -1) {
      // Extend the existing offer with the new information
      const existingPurchase = userCredits.offers[existingOfferIndex];
      existingPurchase.expires = this.calculateExpiryDate(
        existingPurchase.expires,
        order.cycle,
        order.quantity,
      );
      if (order.tokenCount) {
        if (!existingPurchase.tokens) {
          existingPurchase.tokens = 0;
        }
        existingPurchase.tokens += order.tokenCount;
      }
      return existingPurchase;
    }

    const newOffer = {
      expires: order.expires,
      offerGroup: order.offerGroup,
      starts: order.starts,
      tokens: order.tokenCount,
    };
    userCredits.offers.push(newOffer);
    return newOffer;
  }
}
