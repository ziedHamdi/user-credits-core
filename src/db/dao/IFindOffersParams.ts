// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { IMinimalId } from "../model/types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface IFindOffersParams<K extends IMinimalId> {
  allTags?: boolean;
  offerGroup?: string;
  tags?: string[];
  unlockedBy?: string[];
}
