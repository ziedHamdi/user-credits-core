import { IMinimalId, ITokenTimetable } from "../model";
import { IBaseDao } from "./IBaseDao";

export interface ITokenTimetableDao<
  K extends IMinimalId,
  D extends ITokenTimetable<K>,
> extends IBaseDao<K, D> {}
