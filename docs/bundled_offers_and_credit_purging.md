# Unveiling New Features: Bundled Offers and Deduction of Expired Credits

In my continuous effort to enhance user-credits, I'm excited to introduce two groundbreaking features that bring the library to its 1.0.0-beta launch: Bundled Offers and the Deduction of Expired Credits.

## Bundled Offers: Simplifying Multi-Offer Management

Traditionally, managing multiple offers simultaneously has been a challenge:
- How to process multiple orders in a single transaction?
- How to monitor service consumption individually?
- Which services can be extended with other offers and which cannot?

### How Bundled Offers Work

Offers can now be combined, enabling the creation of packages similar to those offered by mobile service providers. Picture offering users diverse packages for $20, $50, and $100/month, proposing different quotas of calling hours, mobile data, and additional services like mobile TV or games—all seamlessly combined.

Now, another question arises: if a user buys a $20 package, what happens if they then purchase a $50 one? Or if they want to extend their calling quota only, can they buy that? Does it extend the expiry date of the calls?

Briefly delving into "Offer Design" in this article, for a more in-depth understanding of how offers work, check [this one](https://github.com/ziedHamdi/user-credits/blob/master/docs/offers_explained.md).

We only need to create a few basic offers, then create the bundles pointing to them by their _id. For the example of the mobile operator, the basic offers would be `Call` where a token is one minute, `Data` where a token is one Kb, and `TV` where there are no tokens, only an expiry date.

From that, we could create the bundled offers, such as the $20 bundled offer proposing 4 hours (quantity= 4 x 60 units) of `Calls` and 500Mb (quantity= 500 x 1024 units of Kb) of `Data`.

An `IOffer` now has a `combinedItems` field, which is an array of ICombinedOffer.

```javascript
export interface ICombinedOffer<K extends IMinimalId> {
  _id: K;
  offerGroup: string;
  offerId: K;
  quantity: number;
}
```

The root offer decides on the expiry date of all the bundled suboffers through its cycle field. But suboffers have the possibility to get their expiry date extended if the offer allows it.

To do that, the field `appendDate` was introduced; here's its JSDoc which explains it all:

```typescript
/**
 * Determines how the expiry date is handled at the time of purchase.
 *
 * If {@link IOrder.starts} is not null, no algorithm is executed: it is used as-is, unless the date has passed, in which case, an error occurs.
 *
 * If set to true:
 * - The expiry date extends from the current expiry date of the same offerGroup in {@link IUserCredits.offers[offerGroup]}.
 * - The extension is by the duration specified in {@link IOffer.cycle}.
 *
 * If set to false:
 * - Otherwise, {@link Date.now()} is used as the start date.
 * - The expiry date is calculated by adding {@link IOffer.cycle} to the start date.
 *
 * When the expiry date is reached:
 * - Remaining tokens are deducted from the offerGroup.
 *
 * The computation of remaining tokens:
 * - SUM of tokens from {@link ITokenTimeTable} for the period between start and expires.
 * - This includes added tokens at creation minus all consumptions during that period.
 *
 * As the date expires and nothing can be appended to it:
 * - Unused tokens from that purchase are removed.
 * NOTE1: the field {@link IOrder.quantity} will always multiply {@link IOffer.cycle} to compute the final expiry date.
 * NOTE2: It's not recommended to mix offers with different appendDate values in the same "offerGroup" as it can mislead users.
 */
appendDate: boolean;
```

### Real-Time Credit Tracking

Developers can effortlessly track their users' credit balances and consumption for each bundled offer by calling a single function. Whether checking calling minutes, data usage, or entertainment credits, the new feature provides clear visibility. Additionally, it's through this function that expired orders are deactivated, and their corresponding credits are deducted from the user balance.

## Deduction of Expired Credits: Streamlining Credit Management

Efficient credit management involves handling expired credits seamlessly. The **Deduction of Expired Credits** feature streamlines the process, ensuring users are promptly informed (warning them in advance and logging all operations) and credits are deducted seamlessly. As every token operation is saved in the `ITokenTimetable` collection, and as different offers can be grouped in the same bag when they have the `offerGroup` value, consuming tokens is done without knowing which exact order is targeted. But don't worry, we can decide upon that when the time comes.

This is the signature of a token consumption call:

```typescript
tokensConsumed(


  userId: K, // the user that consumed tokens
  offerGroup: string, // the offerGroup that the user consumed from
  count: number, // the count of tokens consumed
): Promise<ITokenTimetable<K>>;
```

Each call to this method creates a line, saving the date and the consumed tokens as a negative number in the `ITokenTimetable` collection. Conversely, each (successful) purchase of any offer triggers a line with a positive number in the same collection. This happens when you call `afterExecute`: it first contacts the payment gateway to read the state of the payment. If it was paid, multiple operations happen, and among them, a line is added with that date to `ITokenTimetable`.

```typescript
IService.afterExecute(order: IOrder<K>): Promise<IUserCredits<K>>;
```

So when an order expires, we know how many tokens it added to the offerGroup basket, we also know when it started and when it expired. So computing how many tokens of that order were consumed in the allocated time translates to summing up negative entries from `ITokenTimetable` between the two dates.

An important rule is that orders are kept unchanged from the moment their status becomes "paid". We consider the order entry an archive of what exactly happened: it also copies information from the offer to be able to keep the history clean if ever offers come to change (which is something we don't advise to do, we recommend creating a new offer with the same offerGroup instead). The only thing that can change in an order is its status, and that happens only a few times: before the payment is validated, when the payment fails, or is validated, and when the expiry date hits.

> Please note that when the expiry date of an order hits, nothing happens automatically. I decided to let the developer choose when is the opportune time to call the `checkForExpiredOrders` function. The function does all the work, but you have to adopt a strategy on when to call it: it can be a cron that runs every day once for all users, it can be a table that stores the dates of the soon expiring orders and calls those that expired immediately when they end. You pick it.

### Warnings for Low Credits and Imminent Expiry

```typescript
const userId = "uniqueUserId";
const warningDuration = 7 * 24 * 3600 * 1000; // 7 days in milliseconds
const lowLimits = [{ min: 60, offerGroup: "calls" }, { min: 5000, offerGroup: "data" }];
const { expired, warnings } = await service.checkForExpiredOrders(userId, warningDuration, lowLimits);
```

Not only does this function clean the database from the trailing tokens, but it also empowers developers with timely warnings about low credits and imminent expiry of offers. The `checkForExpiredOrders` function allows users to set warnings for durations and low token levels.

## Conclusion

With Bundled Offers and the Deduction of Expired Credits, we're ushering in a new era of simplicity and effectiveness in credit management. These features not only enhance user experience but also open doors to innovative pricing models and subscription plans.

Ready to elevate your credit management game? Host a user-credits library today in a side docker VM and start experimenting without any risks. You might end-up having the credit management as your first micro-service in your app.

Happy coding!