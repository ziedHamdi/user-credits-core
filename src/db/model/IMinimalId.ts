/**
 * Represents the minimal requirement for an id representation
 *
 * Equality of ids should be checked by a method instead of using the '===' operator
 */
export interface IMinimalId {
  toString(): string;
}
