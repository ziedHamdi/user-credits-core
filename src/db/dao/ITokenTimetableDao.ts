import type { IMinimalId, ITokenTimetable } from "../model/types";
import type { IBaseDao } from "./IBaseDao";

export type ConsumptionPerOfferGroup = {
  _id: string;
  totalTokens: number;
};

export interface ITokenTimetableDao<
  K extends IMinimalId,
  D extends ITokenTimetable<K>,
> extends IBaseDao<K, D> {
  checkTokens(
    startDate: Date,
    endDate?: Date,
    negative?: boolean,
  ): Promise<ConsumptionPerOfferGroup[]>;

  consumptionInDateRange(
    offerGroup: string,
    startDate: Date,
    endDate?: Date,
  ): Promise<number>;
}
