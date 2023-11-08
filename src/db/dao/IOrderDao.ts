import type { IMinimalId, IOrder } from "../model/types";
import type { IBaseDao } from "./IBaseDao";

export interface IOrderDao<K extends IMinimalId, D extends IOrder<K>>
  extends IBaseDao<K, D> {}
