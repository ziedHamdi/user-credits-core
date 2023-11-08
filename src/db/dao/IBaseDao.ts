import type { IMinimalId } from "../model/types";

/**
 * Used to group common DAO operations as in ORM frameworks
 * @template {IMinimalId} K the type used as the key type throughout the app
 * @template {IBaseEntity} D the entity
 */
export interface IBaseDao<K extends IMinimalId, D> {
  /**
   * Used to construct an instance of a document from a raw object
   * @template {IBaseEntity} D the entity
   * @param {IBaseEntity} attr the data to construct data from
   */
  build(attr: object): D;
  // Count documents that match a query
  count(query: object): Promise<number>;

  // Create a new document
  create(data: Partial<D>): Promise<D>;

  // Delete a document by ID
  deleteById(userId: string): Promise<boolean>;

  // Find documents that match a query
  find(query: object): Promise<D[]>;

  findById(id: K): Promise<D | null>;

  findOne(query: object): Promise<D | null>;

  // findOne(query: object): Promise<D>;

  // Update a document by ID
  updateById(id: string, update: Partial<D>): Promise<D | null>;
}
