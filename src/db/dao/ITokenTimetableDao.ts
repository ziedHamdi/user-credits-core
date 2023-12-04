import type { IMinimalId, ITokenTimetable } from "../model/types";
import type { IBaseDao } from "./IBaseDao";

export interface ITokenTimetableDao<
  K extends IMinimalId,
  D extends ITokenTimetable<K>,
> extends IBaseDao<K, D> {
  checkTokens(
    startDate: Date,
    endDate?: Date,
  ): [{ offerGroup: string; totalNegativeTokens: number }];

  consumptionInDateRange(
    offerGroup: string,
    startDate: Date,
    endDate?: Date,
  ): Promise<number>;
}
