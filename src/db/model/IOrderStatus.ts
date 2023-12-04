export interface IOrderStatus {
  date: Date;
  message: string;
  payload: string;
  status:
    | "pending"
    | "paid"
    | "refused"
    | "error"
    | "inconsistent"
    | "partial"
    | "expired";
}
