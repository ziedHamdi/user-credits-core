import { IOrderDao } from "../../db/dao/IOrderDao";
import { IOrder } from "../../db/model/IOrder";
import { MockBaseDao } from "./MockBaseDao";

export class MockOrderDao
  extends MockBaseDao<IOrder<string>>
  implements IOrderDao<string, IOrder<string>> {}
