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

function roundTimeToSecond(date: Date) {
  return Math.round(date.getTime() / 1000);
}

function expectDatesEqualInSeconds(date: Date, now: Date) {
  expect(roundTimeToSecond(date)).toEqual(roundTimeToSecond(now)); // appendDate is false
}

describe("BaseService integration tests", () => {
  let service: BaseServiceIntegrationTest;

  beforeEach(() => {
    service = new BaseServiceIntegrationTest(new MockDaoFactory());
  });

  describe("updateAsPaid", () => {
    const now = new Date();
    const lastExpiryDateForNestedOrders = addMonths(now, 7);

    const rootOfferProps = {
      cycle: "weekly",
      offerGroup: "mockHelpDesk",
      offerId: "mockOfferId",
      tokens: 1, // can call support once a week
      userId: "mockUserId",
    };
    const nestedCallsOfferProps = {
      cycle: "monthly",
      offerGroup: "calls",
      offerId: "mockCallsOffer",
      quantity: 20,
      tokenCount: 60, // minutes as the smallest consumption is 1 minute
    } as unknown as ICombinedOrder<string>;
    const nestedDataOfferProps = {
      cycle: "monthly",
      offerGroup: "data",
      offerId: "mockDataMbOffer",
      quantity: 2,
      tokenCount: 500, // 500Mb
    } as unknown as ICombinedOrder<string>;

    let mockUserCredits: IUserCredits<string>;
    let mockOrder: IOrder<string>;
    let findOrderListMockValue: [IOrder<string>];
    let findOfferByIdMock: jest.Mock<Promise<IOffer<string> | null>>;

    beforeEach(() => {
      mockUserCredits = {
        offers: [],
        userId: "mockUserId",
      } as unknown as IUserCredits<string>;

      mockOrder = {
        _id: "mockOrderId",
        combinedItems: [
          { ...nestedCallsOfferProps },
          { ...nestedDataOfferProps },
        ],
        currency: "$",
        ...rootOfferProps,
        quantity: 1,
        userId: "mockUserId",
      } as unknown as IOrder<string>;

      findOrderListMockValue = [
        {
          appendDate: true,
          expires: addMonths(now, 6),
        } as unknown as IOrder<string>,
        {
          appendDate: true,
          expires: lastExpiryDateForNestedOrders,
        } as unknown as IOrder<string>,
      ] as unknown as [IOrder<string>];

      findOfferByIdMock = jest.fn().mockImplementation((id) => {
        const offers = [
          { ...rootOfferProps },
          { appendDate: true, ...nestedCallsOfferProps },
          { ...nestedDataOfferProps },
        ];
        const found = offers.find((offerMock) => offerMock.offerId === id)!;
        return {
          _id: found.offerId,
          customCycle: now, // just to verify that customCycle is copied too
          ...found,
        }; // emulate _id
      });
    });

    test("updates as paid with combined items typical case", async () => {
      // Mock the specific call to orderDao.find
      const findOrderListMock = jest
        .fn()
        .mockResolvedValue(findOrderListMockValue);

      // Mock the orderDao.find method
      service.offerDaoProp.findById = findOfferByIdMock;
      service.orderDaoProp.find = findOrderListMock;
      // spy on nested functions
      const computeStartDateSpy = jest.spyOn(service, "computeStartDate");
      const updateOfferGroupTokens = jest.spyOn(
        service,
        "updateOfferGroupTokens",
      );
      const insertOrder = jest.spyOn(service.orderDaoProp, "create");

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

      expect(insertOrder).toHaveBeenCalledTimes(2);
      expect(insertOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "$",
          parentId: "mockOrderId",
          status: "paid",
          total: 0,
          userId: "mockUserId",
          ...nestedCallsOfferProps,
          tokenCount:
            mockOrder.quantity *
            nestedCallsOfferProps.quantity *
            nestedCallsOfferProps.tokenCount,
        }),
      );
      expect(insertOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "$",
          parentId: "mockOrderId",
          status: "paid",
          total: 0,
          userId: "mockUserId",
          ...nestedDataOfferProps,
          tokenCount:
            mockOrder.quantity *
            nestedDataOfferProps.quantity *
            nestedDataOfferProps.tokenCount,
        }),
      );

      // Check the calls to orderDao.find
      expect(findOfferByIdMock).toHaveBeenCalledWith(mockOrder.offerId);

      // Restore the original method to avoid interference with other tests
      jest.restoreAllMocks();

      const helpDeskGroup = mockUserCredits.offers.find(
        (offer) => offer.offerGroup === "mockHelpDesk",
      )!;
      expect(helpDeskGroup).toBeDefined();
      expectDatesEqualInSeconds(helpDeskGroup.starts, now); // appendDate == false
      expectDatesEqualInSeconds(helpDeskGroup.expires, addDays(now, 7));

      // two equivalent blocks (any change must be applied to both
      // block 1
      const callsGroup = mockUserCredits.offers.find(
        (offer) => offer.offerGroup === nestedCallsOfferProps.offerGroup,
      )! as unknown as IActivatedOffer;
      expect(callsGroup).toBeDefined();
      expectDatesEqualInSeconds(
        callsGroup.starts,
        lastExpiryDateForNestedOrders,
      );
      expect(callsGroup.expires).toEqual(
        addMonths(lastExpiryDateForNestedOrders, 20),
      );
      const [insertedCallsOrder] = insertOrder.mock.calls.find(([call]) => {
        // first argument of dao.create is the order
        return call.offerId === nestedCallsOfferProps.offerId;
      })! as unknown as [IOrder<string>];
      expect(insertedCallsOrder.starts).toEqual(callsGroup.starts);
      expect(insertedCallsOrder.expires).toEqual(callsGroup.expires);
      // end block 1

      // block 2
      const dataGroup = mockUserCredits.offers.find(
        (offer) => offer.offerGroup === nestedDataOfferProps.offerGroup,
      )! as unknown as IActivatedOffer;
      expect(dataGroup).toBeDefined();
      expectDatesEqualInSeconds(dataGroup.starts, now); // appendDate == false (testing nested too)
      expectDatesEqualInSeconds(dataGroup.expires, addMonths(now, 2));

      const [insertedDataOrder] = insertOrder.mock.calls.find(([call]) => {
        // first argument of dao.create is the order
        return call.offerId === nestedDataOfferProps.offerId;
      })! as unknown as [IOrder<string>];
      expect(insertedDataOrder.starts).toEqual(dataGroup.starts);
      expect(insertedDataOrder.expires).toEqual(dataGroup.expires);
      // end block 2
    });
  });
});
