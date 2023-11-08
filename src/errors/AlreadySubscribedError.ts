import { IMinimalId, IOrder } from "../db/model";

export class AlreadySubscribedError<K extends IMinimalId> extends Error {
  conflictingOrder: IOrder<K> | null;

  constructor(message: string, conflictingOrder: IOrder<K> | null = null) {
    super(message);
    Object.setPrototypeOf(this, AlreadySubscribedError.prototype);

    this.name = "AlreadySubscribedError";
    this.conflictingOrder = conflictingOrder;
  }
}
