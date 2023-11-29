import type {
  IDaoFactory,
  IOfferDao,
  IOrderDao,
  ITokenTimetableDao,
  IUserCreditsDao,
} from "../../db/dao/types";
import type {
  IOffer,
  IOrder,
  ITokenTimetable,
  IUserCredits,
} from "../../db/model/types";
import { MockOfferDao } from "./MockOfferDao";
import { MockOrderDao } from "./MockOrderDao";
import { MockTokenTimetableDao } from "./MockTokenTimetableDao";
import { MockUserCreditsDao } from "./MockUserCreditsDao";

export class MockDaoFactory implements IDaoFactory<string> {
  mockOfferDao = new MockOfferDao();
  mockOrderDao = new MockOrderDao();
  mockUserCreditsDao = new MockUserCreditsDao();
  mockTokenTimetableDao = new MockTokenTimetableDao();

  getOfferDao(): IOfferDao<string, IOffer<string>> {
    return this.mockOfferDao;
  }

  getOrderDao(): IOrderDao<string, IOrder<string>> {
    return this.mockOrderDao;
  }

  getTokenTimetableDao(): ITokenTimetableDao<string, ITokenTimetable<string>> {
    return this.mockTokenTimetableDao;
  }

  getUserCreditsDao(): IUserCreditsDao<string, IUserCredits<string>> {
    return this.mockUserCreditsDao;
  }
}
