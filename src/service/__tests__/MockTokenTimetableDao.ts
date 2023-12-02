import { ITokenTimetableDao } from "../../db/dao/ITokenTimetableDao";
import { ITokenTimetable } from "../../db/model/ITokenTimetable";
import { MockBaseDao } from "./MockBaseDao";

export class MockTokenTimetableDao
  extends MockBaseDao<ITokenTimetable<string>>
  implements ITokenTimetableDao<string, ITokenTimetable<string>>
{
  consumptionInDateRange = jest.fn();
}
