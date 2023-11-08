import type {
  IMinimalId,
  IOffer,
  IOrder,
  ITokenTimetable,
  IUserCredits,
} from "../model/types";
import type {
  IOfferDao,
  IOrderDao,
  ITokenTimetableDao,
  IUserCreditsDao,
} from "./types";

export interface IDaoFactory<K extends IMinimalId> {
  getOfferDao(): IOfferDao<K, IOffer<K>>;
  getOrderDao(): IOrderDao<K, IOrder<K>>;
  getTokenTimetableDao(): ITokenTimetableDao<K, ITokenTimetable<K>>;
  getUserCreditsDao(): IUserCreditsDao<K, IUserCredits<K>>;
}
