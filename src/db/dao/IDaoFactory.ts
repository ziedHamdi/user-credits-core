import { IMinimalId, IOffer, IOrder, ITokenTimetable, IUserCredits } from "../model";
import {
  IOfferDao,
  IOrderDao,
  ITokenTimetableDao,
  IUserCreditsDao,
} from "./index";

export interface IDaoFactory<K extends IMinimalId> {
  getOfferDao(): IOfferDao<K, IOffer<K>>;
  getOrderDao(): IOrderDao<K, IOrder<K>>;
  getTokenTimetableDao(): ITokenTimetableDao<K, ITokenTimetable<K>>;
  getUserCreditsDao(): IUserCreditsDao<K, IUserCredits<K>>;
}
