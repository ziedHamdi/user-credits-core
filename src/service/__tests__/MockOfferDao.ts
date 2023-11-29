import { IOfferDao } from "../../db/dao/IOfferDao";
import { IOffer } from "../../db/model/IOffer";
import { MockBaseDao } from "./MockBaseDao";

export class MockOfferDao
  extends MockBaseDao<IOffer<string>>
  implements IOfferDao<string, IOffer<string>>
{
  loadOffers = jest.fn();
  loadOffersUnlockedByGroup = jest.fn();
  loadTaggedOffers = jest.fn();
}
