import type { IMinimalId, IOrder } from "../db/model/types";

export class AlreadySubscribedError<K extends IMinimalId> extends Error {
  conflictingOrder: IOrder<K> | null;

  constructor(message: string, conflictingOrder: IOrder<K> | null = null) {
    super(message);
    Object.setPrototypeOf(this, AlreadySubscribedError.prototype);

    this.name = "AlreadySubscribedError";
    this.conflictingOrder = conflictingOrder;
  }
}
