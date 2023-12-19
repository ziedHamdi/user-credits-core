// Assuming your class is named 'YourClass'
import { IDaoFactory } from "../../db/dao/IDaoFactory";
import {
  IActivatedOffer,
  type ICombinedOffer,
  ICombinedOrder,
  IOffer,
  IOrder,
  IUserCredits,
} from "../../db/model/types";
import { InvalidOrderError } from "../../errors";
import { addDays, addMonths } from "../../util";
import type { IExpiryDateComputeInput } from "../BaseService";
import { BaseService } from "../BaseService";
import { MockDaoFactory } from "./MockDaoFactory";

function roundTimeToSecond(date: Date) {
  return Math.round(date.getTime() / 1000) * 1000;
}

function expectDatesEqualInSeconds(date: Date, now: Date) {
  expect(new Date(roundTimeToSecond(date))).toEqual(
    new Date(roundTimeToSecond(now)),
  );
}

class BaseServiceTest extends BaseService<string> {
  //make protected fields public for testing
  computeTotal = super.computeTotal;
  onOrderChange = super.onOrderChange;

  constructor(
    daoFactory: IDaoFactory<string>,
    protected defaultCurrency: string = "usd",
  ) {
    super(daoFactory, defaultCurrency);
  }

  get offerDaoProp() {
    return this.offerDao;
  }

  get orderDaoProp() {
    return this.orderDao;
  }

  get userCreditsDaoProp() {
    return this.userCreditsDao;
  }

  get tokenTimetableDaoProp() {
    return this.tokenTimetableDao;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  afterExecute(order: IOrder<string>): Promise<IUserCredits<string>> {
    throw new Error("unneeded");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  payOrder(orderId: string): Promise<IOrder<string>> {
    throw new Error("unneeded");
  }

  async prefillCombinedOrders(
    offer: IOffer<string>,
    offerId: string,
    order: IOrder<string>,
  ) {
    return super.prefillCombinedOrders(offer, offerId, order);
  }

  async computeStartDateUsingOrder(
    userId: string,
    order: IOrder<string>,
  ): Promise<Date> {
    return super.computeStartDate(
      order as unknown as IExpiryDateComputeInput<string>,
    );
  }

  calculateExpiryDate(
    order: IExpiryDateComputeInput<string>,
    quantity: number = 1,
  ): Date {
    return super.calculateExpiryDate(order, quantity);
  }

  processExpiredOrderGroup(
    userId: string,
    offerGroup: string,
  ): Promise<number> {
    return super.processExpiredOrderGroup(userId, offerGroup);
  }

  async updateNestedItemDateAndTokens(
    offer: IOffer<string>,
    rootOrder: IOrder<string>,
    userCredits: IUserCredits<string>,
    orderItemSpec: ICombinedOffer<string>,
  ): Promise<IActivatedOffer> {
    return super.updateNestedItemDateAndTokens(
      offer,
      rootOrder,
      userCredits,
      orderItemSpec,
    );
  }
}

describe("BaseService", () => {
  let service: BaseServiceTest;

  beforeAll(() => {});

  beforeEach(() => {
    service = new BaseServiceTest(new MockDaoFactory());
  });

  describe("createOrder", () => {
    test("creates order with valid input", async () => {
      // Mock offer data and necessary dependencies
      const mockOfferId = "phoneCalls";
      const mockUserId = "mockUserId";
      const mockQuantity = 3; // Change this based on your test case

      // Mock the necessary methods used within createOrder
      service.offerDaoProp.findOne = jest.fn().mockResolvedValue({
        _id: mockOfferId,
        cycle: "monthly",
        offerGroup: "minuteCalls",
        tokenCount: 60,
      } as IOffer<string>);

      service.computeTotal = jest.fn().mockReturnValue(30); // Adjust as needed

      service.prefillCombinedOrders = jest.fn();

      service.onOrderChange = jest.fn();

      // Call the method
      const order = await service.createOrder(
        mockOfferId,
        mockUserId,
        mockQuantity,
      );

      // Assertions
      expect(order).toBeDefined();
      expect(order).toHaveProperty("status", "pending");
      expect(order).toHaveProperty("total", 30);
      expect(order).toHaveProperty("userId", mockUserId);
      expect(order).toHaveProperty("cycle", "monthly");
      expect(order).toHaveProperty("offerGroup", "minuteCalls");
      expect(order).toHaveProperty("tokenCount", 60);

      // Add more assertions based on your method implementation
    });
    test("intergration test for createOrder() including prefillCombinedOrders()", async () => {
      // Mock offer data and necessary dependencies
      const mockOfferId = "phoneCalls";
      const mockUserId = "mockUserId";
      const mockQuantity = 3; // Change this based on your test case

      // Mock the necessary methods used within createOrder
      service.offerDaoProp.findOne = jest.fn().mockResolvedValue({
        _id: mockOfferId,
        combinedItems: [
          {
            applyOverride: false,
            offerGroup: "callHours",
            offerId: "mockCallHoursOfferId",
            quantity: 4,
          },
          {
            applyOverride: true,
            offerGroup: "internetGigaPack",
            offerId: "mockInternetOfferId",
            quantity: 2,
          },
        ],
        cycle: "monthly",
        offerGroup: "minuteCalls",
        tokenCount: 60,
      } as unknown as IOffer<string>);

      service.computeTotal = jest.fn().mockReturnValue(30); // Adjust as needed
      service.onOrderChange = jest.fn();
      service.offerDaoProp.findById = jest.fn().mockResolvedValue({
        tokenCount: 25,
      });
      // Call the method
      const order = await service.createOrder(
        mockOfferId,
        mockUserId,
        mockQuantity,
      );

      // Assertions
      expect(order).toBeDefined();
      expect(order).toHaveProperty("status", "pending");
      expect(order).toHaveProperty("total", 30);
      expect(order).toHaveProperty("userId", mockUserId);
      expect(order).toHaveProperty("cycle", "monthly");
      expect(order).toHaveProperty("offerGroup", "minuteCalls");
      expect(order).toHaveProperty("tokenCount", 60);

      expect(order.combinedItems.length).toBe(2);

      expect(order.combinedItems[0].offerId).toBe("mockCallHoursOfferId");
      expect(order.combinedItems[0].offerGroup).toBe("callHours");
      expect(order.combinedItems[0].quantity).toBe(4);
      expect(order.combinedItems[0].tokenCount).toBe(25 * 4);

      expect(order.combinedItems[1].offerId).toBe("mockInternetOfferId");
      expect(order.combinedItems[1].offerGroup).toBe("internetGigaPack");
      expect(order.combinedItems[1].quantity).toBe(2);
      expect(order.combinedItems[1].tokenCount).toBe(25 * 2);
      // Add more assertions based on your method implementation
    });
  });

  describe("prefillCombinedOrders", () => {
    // You can mock dependencies similarly and write tests for this method
    test("no combinedItems in order if none in offer", async () => {
      // Mock data
      const mockOffer = {
        _id: "mockOfferId",
        /* Other offer properties */
      } as unknown as IOffer<string>;

      const mockOrder = {
        _id: "mockOrderId",
        combinedItems: [],
        markModified: jest.fn(),
      } as unknown as IOrder<string>;

      service.offerDaoProp.findById = jest.fn().mockResolvedValue({
        tokenCount: 15,
      });

      // Call the method
      await service.prefillCombinedOrders(
        mockOffer,
        "mockCombinedOfferId",
        mockOrder,
      );

      // Assertions
      expect(mockOrder.combinedItems.length).toBe(0);
      // Add more assertions based on your method implementation
    });
    test("handles combinedItems with valid data", async () => {
      // Mock data
      const mockOffer = {
        _id: "mockOfferId",
        combinedItems: [
          {
            applyOverride: false,
            offerGroup: "callHours",
            offerId: "mockCallHoursOfferId",
            quantity: 4,
          },
          {
            applyOverride: true,
            offerGroup: "internetGigaPack",
            offerId: "mockInternetOfferId",
            quantity: 2,
          },
        ],
        /* Other offer properties */
      } as unknown as IOffer<string>;

      const mockOrder = {
        _id: "mockOrderId",
        combinedItems: [],
        markModified: jest.fn(),
      } as unknown as IOrder<string>;

      service.offerDaoProp.findById = jest.fn().mockResolvedValue({
        tokenCount: 15, // Adjust as needed
        /* Other combinedOffer properties */
      });

      // Call the method
      await service.prefillCombinedOrders(
        mockOffer,
        "mockCombinedOfferId",
        mockOrder,
      );

      // Assertions
      expect(mockOrder.combinedItems.length).toBe(2);

      expect(mockOrder.combinedItems[0].offerId).toBe("mockCallHoursOfferId");
      expect(mockOrder.combinedItems[0].offerGroup).toBe("callHours");
      expect(mockOrder.combinedItems[0].quantity).toBe(4);
      expect(mockOrder.combinedItems[0].tokenCount).toBe(15 * 4);

      expect(mockOrder.combinedItems[1].offerId).toBe("mockInternetOfferId");
      expect(mockOrder.combinedItems[1].offerGroup).toBe("internetGigaPack");
      expect(mockOrder.combinedItems[1].quantity).toBe(2);
      expect(mockOrder.combinedItems[1].tokenCount).toBe(15 * 2);
    });
  });

  describe("computeStartDate", () => {
    test("handles explicit start date in the future", async () => {
      const order = {
        starts: new Date(Date.now() + 1000000),
      } as IOrder<string>;

      await expect(
        service.computeStartDateUsingOrder(order.userId, order),
      ).resolves.toEqual(order.starts);
    });

    test("throws error for explicit start date in the past", async () => {
      const order = {
        starts: new Date(Date.now() - 1000000),
      } as IOrder<string>;

      await expect(
        service.computeStartDateUsingOrder(order.userId, order),
      ).rejects.toThrow(InvalidOrderError);
    });

    test("handles no explicit start date with appendDate set to false", async () => {
      const order = {
        offerId: "phoneCalls",
        starts: null,
        userId: "mockUserId",
      } as unknown as IOrder<string>;

      // Mock offer data with appendDate set to false
      service.offerDaoProp.findById = jest.fn().mockResolvedValue({
        _id: "phoneCalls",
        appendDate: false,
      } as IOffer<string>);

      const starts = await service.computeStartDateUsingOrder(
        order.userId,
        order,
      );

      expect(starts).toBeInstanceOf(Date);
    });

    test("handles no explicit start date with appendDate set to true and no previous orders", async () => {
      const order = {
        offerId: "phoneCalls",
        starts: null,
        userId: "mockUserId",
      } as unknown as IOrder<string>;

      // Mock offer data with appendDate set to true
      service.offerDaoProp.findById = jest.fn().mockResolvedValue({
        _id: "phoneCalls",
        appendDate: true,
      } as unknown as IOffer<string>);

      service.orderDaoProp.find = jest.fn().mockResolvedValue([]);

      const starts = await service.computeStartDateUsingOrder(
        order.userId,
        order,
      );

      expect(starts).toBeInstanceOf(Date);
    });

    test("handles no explicit start date with appendDate set to true and previous orders", async () => {
      const order = {
        offerId: "phoneCalls",
        starts: null,
        userId: "mockUserId",
      } as unknown as IOrder<string>;

      // Mock offer data with appendDate set to true
      service.offerDaoProp.findById = jest.fn().mockResolvedValue({
        _id: "phoneCalls",
        appendDate: true,
      } as unknown as IOffer<string>);

      // Mock previous orders
      service.orderDaoProp.find = jest
        .fn()
        .mockResolvedValue([
          { expires: new Date(Date.now() + 1000000) } as IOrder<string>,
        ]);

      const starts = await service.computeStartDateUsingOrder(
        order.userId,
        order,
      );

      expect(starts).toBeInstanceOf(Date);
    });
    test("handles computed start date in the past", async () => {
      const order = {
        offerId: "phoneCalls",
        starts: null,
        userId: "mockUserId",
      } as unknown as IOrder<string>;

      // Mock offer data with appendDate set to true
      service.offerDaoProp.findById = jest.fn().mockResolvedValue({
        _id: "phoneCalls",
        appendDate: true,
      } as unknown as IOffer<string>);

      // Mock previous orders with an expired one
      service.orderDaoProp.find = jest
        .fn()
        .mockResolvedValue([
          { expires: new Date(Date.now() - 1000000) } as IOrder<string>,
        ]);

      const starts = await service.computeStartDateUsingOrder(
        order.userId,
        order,
      );

      expect(starts).toBeInstanceOf(Date);
      expectDatesEqualInSeconds(starts, new Date());
    });
  });
  describe("calculateExpiryDate", () => {
    let service: BaseServiceTest;

    beforeEach(() => {
      service = new BaseServiceTest(new MockDaoFactory());
    });

    test("calculates expiry date for once cycle", () => {
      const order = {
        cycle: "once",
        quantity: 1,
        starts: new Date(),
      } as unknown as IExpiryDateComputeInput<string>;

      const expiryDate = service.calculateExpiryDate(order);

      // Assertions
      expect(expiryDate).toStrictEqual(order.starts);
    });

    test("calculates expiry date for daily cycle", () => {
      const order = {
        cycle: "daily",
        quantity: 2,
        starts: new Date(),
      } as unknown as IExpiryDateComputeInput<string>;

      const expiryDate = service.calculateExpiryDate(order);

      // Assertions
      const expectedExpiryDate = addDays(order.starts, 2);
      expect(expiryDate).toEqual(expectedExpiryDate);
    });

    // Add more test cases for other cycle types...

    test("throws error for invalid or missing cycle", () => {
      const order = {
        cycle: "invalidCycle",
        quantity: 1,
        starts: new Date(),
      } as unknown as IExpiryDateComputeInput<string>;

      // Assertions
      expect(() => service.calculateExpiryDate(order)).toThrowError(
        "Invalid or missing cycle value",
      );
    });
    test("Checks that the user Id is filled from the order for nested items, and that the query has the right params", async () => {
      const order = {
        combinedItems: [
          { offerGroup: "offerGroupC1Mock" } as ICombinedOrder<string>,
          { offerGroup: "offerGroupC2Mock" } as ICombinedOrder<string>,
        ],
        offerId: "phoneCalls",
        starts: null,
        userId: "mockUserId",
      } as unknown as IOrder<string>;

      // Mock offer data with appendDate set to true
      service.offerDaoProp.findById = jest.fn().mockResolvedValue({
        _id: "phoneCalls",
        appendDate: true,
      } as unknown as IOffer<string>);

      await service.updateNestedItemDateAndTokens(
        { appendDate: true, cycle: "once", tokenCount: 123 } as IOffer<string>,
        order,
        {
          offers: [{ offerGroup: "offerGroupC2Mock" }],
        } as IUserCredits<string>,
        { offerGroup: "offerGroupC2Mock" } as ICombinedOffer<string>,
      );

      expect(service.orderDaoProp.find).toHaveBeenCalledWith({
        expires: { $exists: true },
        offerGroup: "offerGroupC2Mock",
        status: "paid",
        userId: order.userId,
      });
    });
  });

  describe("BaseService expiry routines", () => {
    describe("checkForExpiredOrders", () => {
      let yesterday: Date;
      let ago3Months: Date;
      let inTenDays: Date;
      let inTwentyDays: Date;

      let mockOrderSave: jest.Mock;
      let mockUserCreditsSave: jest.Mock;
      let mockMarkModified: jest.Mock;
      let mockUserCredits: IUserCredits<string>;
      let mockExpiredActiveOffer1: IActivatedOffer;
      let mockExpiredActiveOffer2: IActivatedOffer;
      let mockExpiredOrder: IOrder<string>;
      let mockActiveOffer1: IActivatedOffer;
      let mockActiveOffer2: IActivatedOffer;
      let mockLow: { min: number; offerGroup: string }[];

      let service: BaseServiceTest;

      const now = new Date();

      beforeEach(() => {
        yesterday = addDays(now, -1);
        ago3Months = addMonths(now, -3);
        inTenDays = addDays(now, 10);
        inTwentyDays = addDays(now, 20);

        mockOrderSave = jest.fn();
        mockUserCreditsSave = jest.fn();
        mockMarkModified = jest.fn();

        mockUserCredits = {
          markModified: mockMarkModified,
          offers: [],
          save: mockUserCreditsSave,
          userId: "mockUserId",
        } as unknown as IUserCredits<string>;

        mockExpiredActiveOffer1 = {
          expires: yesterday,
          offerGroup: "expiredGroup1",
          tokens: 10,
        } as IActivatedOffer;
        mockExpiredActiveOffer2 = {
          expires: ago3Months,
          offerGroup: "expiredGroup2",
          tokens: 10,
        } as IActivatedOffer;
        mockExpiredOrder = {
          expires: yesterday,
          offerGroup: "expiredGroup",
          save: mockOrderSave,
          starts: ago3Months,
          status: "paid",
        } as unknown as IOrder<string>;

        mockActiveOffer1 = {
          expires: inTenDays,
          offerGroup: "activeGroup1",
          tokens: 10,
        } as IActivatedOffer;
        mockActiveOffer2 = {
          expires: inTwentyDays,
          offerGroup: "activeGroup2",
          tokens: 10,
        } as IActivatedOffer;

        mockLow = [{ min: 5, offerGroup: "expiredGroup" }];

        service = new BaseServiceTest(new MockDaoFactory());

        (service.userCreditsDaoProp.findById as jest.Mock).mockResolvedValue(
          mockUserCredits,
        );

        (service.orderDaoProp.find as jest.Mock).mockResolvedValue([
          mockExpiredOrder,
        ]);
      });

      afterEach(() => {
        jest.resetAllMocks();
      });

      test("marks expired orders as 'expired'", async () => {
        // Arrange
        const mockWarnBeforeInMillis = 0; // Immediate expiration for testing purposes
        mockUserCredits.offers = [
          mockExpiredActiveOffer1,
          mockExpiredActiveOffer2,
          mockActiveOffer1,
          mockActiveOffer2,
        ];

        // Act
        const result = await service.checkForExpiredOrders(
          mockUserCredits.userId,
          mockWarnBeforeInMillis,
          mockLow,
        );

        // FIXME I still have to check that the correct count of tokens was removed from the offerGroup (and test with multiple paid orders that end the same date)
        // Assert
        expect(result.expired.length).toBe(2);
        expect(result.expired[0].offerGroup).toBe("expiredGroup1");
        expect(result.expired[1].offerGroup).toBe("expiredGroup2");

        expect(mockMarkModified).toHaveBeenCalledTimes(1);
        expect(mockUserCreditsSave).toHaveBeenCalledTimes(1);
        expect(mockUserCredits.offers.length).toBe(2);
        expect(mockUserCredits.offers[0].offerGroup).toBe("activeGroup1");
        expect(mockUserCredits.offers[1].offerGroup).toBe("activeGroup2");

        expect(mockOrderSave).toHaveBeenCalledTimes(2);
        expect(mockExpiredOrder.status).toEqual("expired");
      });

      test("processes expired order group correctly", async () => {
        // Arrange
        const mockUserId = "mockUserId";
        const mockOfferGroup = "expiredGroup";
        const mockActiveOrder1 = {
          ...mockExpiredOrder,
          _id: "orderId2",
          expires: inTenDays,
          status: "paid",
        };
        const mockExpiredOrder2 = {
          ...mockExpiredOrder,
          _id: "orderId2",
          expires: ago3Months,
        };

        // Mock the orderDao.find method to return the order list
        (service.orderDaoProp.find as jest.Mock).mockResolvedValue([
          mockExpiredOrder,
          mockActiveOrder1,
          mockExpiredOrder2,
        ]);
        (
          service.tokenTimetableDaoProp.consumptionInDateRange as jest.Mock
        ).mockResolvedValue(-6);

        // Act
        const tokensToSubtract = await service.processExpiredOrderGroup(
          mockUserId,
          mockOfferGroup,
        );

        // Assert
        expect(mockOrderSave).toHaveBeenCalledTimes(2);
        expect(mockExpiredOrder.status).toEqual("expired");
        expect(mockActiveOrder1.status).toEqual("paid"); // remains untouched
        expect(mockExpiredOrder2.status).toEqual("expired");
        expect(tokensToSubtract).toBe(-12);
      });

      test("warns for low tokens and imminent expiry dates", async () => {
        // Arrange
        const mockWarnBeforeInMillis =
          addDays(now, 4).getTime() - now.getTime();
        mockActiveOffer1.expires = addDays(now, 2); // expires in 2 days
        mockActiveOffer1.offerGroup = "imminentExpiryGroup";
        mockActiveOffer2.expires = addDays(now, 5); // expires in 5 days
        mockUserCredits.offers = [
          mockActiveOffer1,
          mockExpiredActiveOffer1,
          mockActiveOffer2,
          mockExpiredActiveOffer2,
        ];

        (service.userCreditsDaoProp.findById as jest.Mock).mockResolvedValue(
          mockUserCredits,
        );

        // Act
        const result = await service.checkForExpiredOrders(
          mockUserCredits.userId,
          mockWarnBeforeInMillis,
          mockLow,
        );

        // Assert
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0].offerGroup).toBe("imminentExpiryGroup");
      });
    });
  });
});
