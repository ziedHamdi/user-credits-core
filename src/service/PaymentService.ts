import type { IDaoFactory } from "../db/dao/types";
import type { IMinimalId, IOrder, IUserCredits } from "../db/model/types";
import {
  InvalidPaymentError,
  PaymentErrorCode,
  PaymentErrorDetails,
} from "../errors";
import { BaseService } from "./BaseService";
import type { IPaymentClient } from "./IPaymentClient";

export type ITokenHolder = {
  offerGroup: string;
  quantity: number;
  tokenCount: number;
};

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
    if (order.total > 0) {
      // prepare intent of payment in gateway
      return await this.payLoadedOrder(order);
    } else {
      // execute immediately if there's nothing to pay. If you decide to condition the acceptance of free offers,
      // handle it accordingly in afterExecute() or afterFreeOrderExecuted()
      await this.afterExecute(order);
      // return the order saved in db
      return (await super
        .getDaoFactory()
        .getOrderDao()
        .findById(order._id)) as IOrder<K>;
    }
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

    let updatedOrder: IOrder<K>;
    if (order.total > 0) {
      // Check the payment status in the payment gateway and construct an updated order
      updatedOrder = await this.paymentClient.afterPaymentExecuted(order);
    } else {
      // skipping payment status check afterPaymentExecuted() if there's nothing that can be paid
      updatedOrder = this.afterFreeOrderExecuted(order);
    }
    // Update the subscription
    await this.updateCredits(userCredits, updatedOrder);
    // save the order with its new state and history (taken from the payment platform) and its start and expiry dates computed
    await updatedOrder.save();

    // Save the changes to user credits
    userCredits.markModified("offers");
    await userCredits.save();

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
}
