import { IBaseDao } from "../../db/dao/types";
import { IBaseEntity } from "../../db/model/IBaseEntity";

export class MockBaseDao<O extends IBaseEntity<string>>
  implements IBaseDao<string, O>
{
  build = jest.fn();
  count = jest.fn();
  deleteById = jest.fn();
  find = jest.fn();
  findById = jest.fn();
  findByIdStr = jest.fn();
  findOne = jest.fn();
  updateById = jest.fn();

  create = (obj: O) => {
    obj.markModified = jest.fn();
    return Promise.resolve(obj);
  };
}
