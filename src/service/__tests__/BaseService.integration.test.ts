// Assuming your class is named 'YourClass'
import { IDaoFactory } from "../../db/dao/IDaoFactory";
import {
  IActivatedOffer,
  ICombinedOrder,
  IOffer,
  IOrder,
  IUserCredits,
} from "../../db/model/types";
import { addDays, addMonths } from "../../util";
import type { IExpiryDateComputeInput, ITokenHolder } from "../BaseService";
import { BaseService } from "../BaseService";
import { MockDaoFactory } from "./MockDaoFactory";

class BaseServiceIntegrationTest extends BaseService<string> {
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

  async computeStartDate(
    userId: string,
    order: IExpiryDateComputeInput<string>,
  ): Promise<void> {
    return super.computeStartDate(userId, order);
  }

  async updateAsPaid(
    userCredits: IUserCredits<string>,
    order: IOrder<string>,
  ): Promise<IActivatedOffer> {
    return super.updateAsPaid(userCredits, order);
  }
}

describe("BaseService integration tests", () => {
  let service: BaseServiceIntegrationTest;

  beforeEach(() => {
    service = new BaseServiceIntegrationTest(new MockDaoFactory());
  });

  describe("updateAsPaid", () => {
    let mockUserCredits: IUserCredits<string>;
    let mockOrder: IOrder<string>;
    const now = new Date();

    beforeEach(() => {
      mockUserCredits = {
        offers: [],
        userId: "mockUserId",
      } as unknown as IUserCredits<string>;

      mockOrder = {
        combinedItems: [
          // Add items depending on the test
        ],
        cycle: "weekly",
        offerGroup: "mockHelpDesk",
        offerId: "mockOfferId",
        tokens: 1, // can call support once a week
        userId: "mockUserId",
      } as unknown as IOrder<string>;
    });

    test("updates as paid with combined items typical case", async () => {
      // Mock the specific call to orderDao.find
      const findOfferByIdMock = jest.fn().mockResolvedValue(
        {
          appendDate: true,
          offerGroup: "mockedOfferGroup",
        } as unknown as IOffer<string>,
        // Add more mocked orders as needed
      );
      const lastExpiryDateForNestedOrders = addMonths(now, 7);
      const findOrderListMock = jest.fn().mockResolvedValue([
        {
          appendDate: true,
          expires: addMonths(now, 6),
        },
        {
          appendDate: true,
          expires: lastExpiryDateForNestedOrders,
        },
      ]);

      mockOrder.combinedItems = [
        {
          cycle: "monthly",
          offerGroup: "calls",
          offerId: "mockCallsOffer",
          quantity: 20,
          tokenCount: 60, // minutes as the smallest consumption is 1 minute
        } as unknown as ICombinedOrder<string>,
        {
          cycle: "monthly",
          offerGroup: "data",
          offerId: "mockDataMbOffer",
          quantity: 2,
          tokenCount: 500, // 50Mb
        } as unknown as ICombinedOrder<string>,
      ];

      // Mock the orderDao.find method
      service.offerDaoProp.findById = findOfferByIdMock;
      service.orderDaoProp.find = findOrderListMock;
      // spy on nested functions
      const computeStartDateSpy = jest.spyOn(service, "computeStartDate");
      const updateOfferGroupTokens = jest.spyOn(
        service,
        "updateOfferGroupTokens",
      );

      // Call the method
      const result = await service.updateAsPaid(mockUserCredits, mockOrder);

      // Assertions
      expect(result).toBeDefined();
      // Add assertions based on your specific logic and expectations

      // Check if computeStartDate and updateOfferGroupTokens were called
      expect(computeStartDateSpy).toHaveBeenCalledWith(
        mockOrder.userId,
        mockOrder,
      );
      expect(computeStartDateSpy).toHaveBeenCalledTimes(3);
      expect(updateOfferGroupTokens).toHaveBeenCalledWith(
        mockOrder,
        mockUserCredits,
        mockOrder,
      );

      // Check the calls to orderDao.find
      expect(findOfferByIdMock).toHaveBeenCalledWith(mockOrder.offerId);

      // Restore the original method to avoid interference with other tests
      jest.restoreAllMocks();

      const helpDeskGroup = mockUserCredits.offers.find(
        (offer) => offer.offerGroup === "mockHelpDesk",
      )!;
      expect(helpDeskGroup).toBeDefined();
      expect(helpDeskGroup.starts).toEqual(lastExpiryDateForNestedOrders);
      expect(helpDeskGroup.expires).toEqual(
        addDays(lastExpiryDateForNestedOrders, 7),
      );

      const callsGroup = mockUserCredits.offers.find(
        (offer) => offer.offerGroup === "calls",
      )!;
      expect(callsGroup).toBeDefined();
      expect(callsGroup.starts).toEqual(lastExpiryDateForNestedOrders);
      expect(callsGroup.expires).toEqual(
        addMonths(lastExpiryDateForNestedOrders, 20),
      );

      const dataGroup = mockUserCredits.offers.find(
        (offer) => offer.offerGroup === "data",
      )!;
      expect(dataGroup).toBeDefined();
      expect(dataGroup.starts).toEqual(lastExpiryDateForNestedOrders);
      expect(dataGroup.expires).toEqual(
        addMonths(lastExpiryDateForNestedOrders, 2),
      );
    });
  });
});
