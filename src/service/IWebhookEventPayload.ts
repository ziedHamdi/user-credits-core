/**
 * Payload that comes from payment gateway on callback
 */
export interface IWebhookEventPayload {
    body: string;
    headers: {};
}