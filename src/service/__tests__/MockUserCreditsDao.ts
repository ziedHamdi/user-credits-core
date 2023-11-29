import { IUserCreditsDao } from "../../db/dao/IUserCreditsDao";
import { IUserCredits } from "../../db/model/IUserCredits";
import { MockBaseDao } from "./MockBaseDao";

export class MockUserCreditsDao
  extends MockBaseDao<IUserCredits<string>>
  implements IUserCreditsDao<string, IUserCredits<string>>
{
  findByUserId = jest.fn();
}
