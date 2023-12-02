// Assuming your class is named 'YourClass'
import { IDaoFactory } from "../../db/dao/IDaoFactory";
import {
  IActivatedOffer,
  IOffer,
  IOrder,
  IUserCredits,
} from "../../db/model/types";
import { InvalidOrderError } from "../../errors";
import { addDays } from "../../util";
import type { IExpiryDateComputeInput, ITokenHolder } from "../BaseService";
import { BaseService } from "../BaseService";
import { MockDaoFactory } from "./MockDaoFactory";

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
  ): Promise<void> {
    return super.computeStartDate(
      userId,
      order as unknown as IExpiryDateComputeInput<string>,
    );
  }

  calculateExpiryDate(order: IExpiryDateComputeInput<string>): Date {
    return super.calculateExpiryDate(order);
  }

  updateOfferGroupTokens(
    order: ITokenHolder,
    userCredits: IUserCredits<string>,
    expirySpecs: IExpiryDateComputeInput<string>,
  ) {
    return super.updateOfferGroupTokens(order, userCredits, expirySpecs);
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
      ).resolves.toBeUndefined();
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

      await service.computeStartDateUsingOrder(order.userId, order);

      expect(order.starts).toBeInstanceOf(Date);
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

      await service.computeStartDateUsingOrder(order.userId, order);

      expect(order.starts).toBeInstanceOf(Date);
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

      await service.computeStartDateUsingOrder(order.userId, order);

      expect(order.starts).toBeInstanceOf(Date);
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

      await service.computeStartDateUsingOrder(order.userId, order);

      expect(order.starts).toBeInstanceOf(Date);
      expect(order.starts.getTime()).toBeGreaterThanOrEqual(Date.now());
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
  });
  describe("updateOfferGroupTokens", () => {
    let service: BaseServiceTest;
    let mockUserCredits: { offers: IActivatedOffer[]; userId: string };
    let mockOrder: ITokenHolder;
    let mockExpirySpecs: IExpiryDateComputeInput<string>;

    beforeEach(() => {
      service = new BaseServiceTest(new MockDaoFactory());
      mockUserCredits = {
        offers: [],
        userId: "mockUserId",
      };

      mockOrder = {
        offerGroup: "testOfferGroup",
        quantity: 2,
        tokenCount: 10,
      };

      mockExpirySpecs = {
        cycle: "daily",
        quantity: 2,
        starts: new Date(),
      } as unknown as IExpiryDateComputeInput<string>;
    });

    test("updates existing offer group", () => {
      // Add an existing offer to user credits
      const existingOffer = {
        expires: new Date(),
        offerGroup: mockOrder.offerGroup,
        tokens: 5,
      };
      mockUserCredits.offers.push(existingOffer);

      const updatedOffer = service.updateOfferGroupTokens(
        mockOrder,
        mockUserCredits as unknown as IUserCredits<string>,
        mockExpirySpecs,
      );

      // Assertions
      expect(updatedOffer).toBeDefined();
      expect(updatedOffer).toBe(existingOffer);
      expect(updatedOffer.expires).toEqual(
        service.calculateExpiryDate(mockExpirySpecs),
      );
      expect(updatedOffer.tokens).toEqual(5 + 2 * 10);
    });

    test("adds new offer group", () => {
      const updatedOffer = service.updateOfferGroupTokens(
        mockOrder,
        mockUserCredits as unknown as IUserCredits<string>,
        mockExpirySpecs,
      );

      // Assertions
      expect(updatedOffer).toBeDefined();
      expect(updatedOffer.expires).toEqual(
        service.calculateExpiryDate(mockExpirySpecs),
      );
      expect(updatedOffer.tokens).toEqual(mockOrder.tokenCount);

      // Check if the new offer is added to user credits
      expect(mockUserCredits.offers).toHaveLength(1);
      expect(mockUserCredits.offers[0]).toBe(updatedOffer);
    });
  });

  // describe("updateOfferGroupTokens", () => {
  //   let service: BaseServiceTest;
  //   let mockUserCredits: { offers: any[]; userId: string };
  //   let mockOrder: ITokenHolder;
  //   let mockExpirySpecs: IExpiryDateComputeInput<string>;
  //
  //   beforeEach(() => {
  //     service = new BaseServiceTest(new MockDaoFactory());
  //     mockUserCredits = {
  //       offers: [],
  //       userId: "mockUserId",
  //     };
  //
  //     mockOrder = {
  //       offerGroup: "testOfferGroup",
  //       quantity: 2,
  //       tokenCount: 10,
  //     };
  //
  //     mockExpirySpecs = {
  //       cycle: "daily",
  //       quantity: 2,
  //       starts: new Date(),
  //     } as unknown as IExpiryDateComputeInput<string>;
  //   });
  //   test("handles order date and tokens", async () => {
  //     // Mock necessary methods
  //     service.computeStartDate = jest.fn().mockResolvedValue(new Date());
  //     service.updateOfferGroupTokens = jest.fn().mockResolvedValue({
  //       // Set properties as needed
  //     });
  //
  //     // Call the method
  //     const result = await service.handleOrderDateAndTokens(
  //       mockOrder.userId,
  //       mockOrder,
  //       mockUserCredits,
  //     );
  //
  //     // Assertions
  //     expect(result).toBeDefined();
  //     // Add assertions based on your specific logic and expectations
  //
  //     // Check if computeStartDate and updateOfferGroupTokens were called
  //     expect(service.computeStartDate).toHaveBeenCalledWith(
  //       mockOrder.userId,
  //       expect.anything(), // Specify the expected orderItemSpec or use expect.anything()
  //     );
  //     expect(service.updateOfferGroupTokens).toHaveBeenCalledWith(
  //       expect.anything(), // Specify the expected orderItemSpec or use expect.anything()
  //       mockUserCredits,
  //       expect.anything(), // Specify the expected expirySpecs or use expect.anything()
  //     );
  //   });
  // });
});
