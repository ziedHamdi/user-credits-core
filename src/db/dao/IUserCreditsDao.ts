import type { IMinimalId, IUserCredits } from "../model/types";
import type { IBaseDao } from "./IBaseDao";

export interface IUserCreditsDao<
  K extends IMinimalId,
  D extends IUserCredits<K>,
> extends IBaseDao<K, D> {
  findByUserId(userId: K): Promise<IUserCredits<K>>;
}
