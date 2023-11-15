import type { IDaoFactory } from "../db/dao/types";
import type {
  IActivatedOffer,
  IMinimalId,
  IOrder,
  ISubscription,
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
    const orderWithIntent = await this.paymentClient.createPaymentIntent(order);
    if (!orderWithIntent)
      throw new InvalidPaymentError("Failed to create payment intent", {
        orderId: order._id,
      });

    // FIXME save the paymentIntentId to the original order: https://github.com/ziedHamdi/user-credits-core/issues/1
    return orderWithIntent;
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
    this.updateCredits(userCredits, updatedOrder);

    // Save the changes to user credits
    userCredits.markModified("offers");
    await userCredits.save();

    return userCredits;
  }

  protected updateCredits(
    userCredits: IUserCredits<K>,
    updatedOrder: IOrder<K>,
  ): IActivatedOffer | null {
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
      return this.updateOfferGroup(
        userCredits,
        updatedOrder,
      ) as IActivatedOffer;
    }
    return null;
  }

  protected updateOfferGroup(
    userCredits: IUserCredits<K>,
    order: IOrder<K>,
  ): IActivatedOffer {
    const existingOfferIndex = userCredits.offers.findIndex(
      (offer: IActivatedOffer) => offer.offerGroup === order.offerGroup,
    );

    if (existingOfferIndex !== -1) {
      // Update the existing offer with the new information
      const existingOffer = userCredits.offers[existingOfferIndex];
      existingOffer.expires = this.calculateExpiryDate(
        existingOffer.expires,
        order.cycle,
        order.quantity,
      );
      existingOffer.tokens += (order.tokenCount || 0) * order.quantity;
      return existingOffer;
    }

    const currentDate = order.updatedAt || order.createdAt || new Date();
    // Create a new offer if not found
    const newOffer: IActivatedOffer = {
      expires: this.calculateExpiryDate(
        currentDate,
        order.cycle,
        order.quantity,
      ),
      offerGroup: order.offerGroup,
      starts: currentDate,
      tokens: (order.tokenCount || 0) * (order.quantity || 1),
    };
    userCredits.offers.push(newOffer);

    return newOffer;
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
}
