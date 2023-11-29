// Assuming your class is named 'YourClass'
import { IDaoFactory } from "../../db/dao/IDaoFactory";
import { IOffer, IOrder, IUserCredits } from "../../db/model/types";
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

    // Add more test cases for different scenarios
  });

  // Add more test cases for other methods and scenarios
});
