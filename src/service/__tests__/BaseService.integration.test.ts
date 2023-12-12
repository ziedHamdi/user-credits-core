import { IDaoFactory } from "../../db/dao/IDaoFactory";
import {
  IActivatedOffer,
  ICombinedOrder,
  IOffer,
  IOrder,
  ITokenTimetable,
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
  ): Promise<void> {
    return super.computeStartDate(
      order as unknown as IExpiryDateComputeInput<string>,
    );
  }

  calculateExpiryDate(
    order: IExpiryDateComputeInput<string>,
    quantity: number,
  ): Date {
    return super.calculateExpiryDate(order, quantity);
  }

  updateOfferGroupTokens(
    order: ITokenHolder,
    userCredits: IUserCredits<string>,
    expirySpecs: IExpiryDateComputeInput<string>,
    quantity: number,
  ) {
    return super.updateOfferGroupTokens(
      order,
      userCredits,
      expirySpecs,
      quantity,
    );
  }

  async computeStartDate(
    order: IExpiryDateComputeInput<string>,
  ): Promise<void> {
    return super.computeStartDate(order);
  }

  async updateAsPaid(
    userCredits: IUserCredits<string>,
    order: IOrder<string>,
  ): Promise<IActivatedOffer> {
    return super.updateAsPaid(userCredits, order);
  }
}

function roundTimeToSecond(date: Date) {
  return Math.round(date.getTime() / 1000) * 1000;
}

function expectDatesEqualInSeconds(date: Date, now: Date) {
  expect(new Date(roundTimeToSecond(date))).toEqual(
    new Date(roundTimeToSecond(now)),
  );
}

describe("BaseService integration tests", () => {
  let service: BaseServiceIntegrationTest;
  type CreateOrderSpy = jest.MockedFunction<typeof service.orderDaoProp.create>;
  type CreateTokenTimeTableSpy = jest.MockedFunction<
    typeof service.tokenTimetableDaoProp.create
  >;

  beforeEach(() => {
    service = new BaseServiceIntegrationTest(new MockDaoFactory());
  });

  describe("updateAsPaid", () => {
    const now = new Date();
    const lastExpiryDateForNestedOrders = addMonths(now, 7);

    const rootOfferProps = {
      appendDate: false,
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
          { _id: "mockCallsNestedId", ...nestedCallsOfferProps },
          { _id: "mockDataNestedId", ...nestedDataOfferProps },
        ],
        currency: "$",
        ...rootOfferProps,
        quantity: 2,
        tokenCount: rootOfferProps.tokens,
        tokens: undefined,
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

    /**
     * Tests if orders and tokenTimeTables lines were correctly inserted if the parent order has nested suborders (is a combined one),
     * it also checks if the passed {@link mockUserCredits} has changed as expected (reading the data from the mocks)
     * @param combinedOrder the nested order
     * @param expectedStart now if appendDate is false, and the date of the last order for the offer group: mocked to lastExpiryDateForNestedOrders if true
     * @param insertOrder the function mock from the dao
     * @param insertTokenTimeTable the function mock from the dao
     */
    function testNestedOrder(
      combinedOrder: ICombinedOrder<string>,
      expectedStart: Date,
      insertOrder: CreateOrderSpy,
      insertTokenTimeTable: CreateTokenTimeTableSpy,
    ) {
      const callsGroup = mockUserCredits.offers.find(
        (offer) => offer.offerGroup === combinedOrder.offerGroup,
      )! as unknown as IActivatedOffer;
      expect(callsGroup).toBeDefined();
      expectDatesEqualInSeconds(callsGroup.starts, expectedStart);
      expectDatesEqualInSeconds(
        callsGroup.expires,
        addMonths(expectedStart, mockOrder.quantity * combinedOrder.quantity),
      );

      const [insertedCallsOrder] = insertOrder.mock.calls.find(([call]) => {
        // first argument of dao.create is the order
        return call.offerId === combinedOrder.offerId;
      })! as unknown as [IOrder<string>];
      expect(insertedCallsOrder.starts).toEqual(callsGroup.starts);
      expect(insertedCallsOrder.expires).toEqual(callsGroup.expires);
      expect(insertedCallsOrder.tokenCount).toEqual(callsGroup.tokens);

      const [insertedCallsTokenTimeTable] =
        insertTokenTimeTable.mock.calls.find(([createCall]) => {
          // first argument of dao.create is the ITokenTimetable to insert
          return createCall.offerGroup === combinedOrder.offerGroup;
        })! as unknown as [ITokenTimetable<string>];
      expect(insertedCallsTokenTimeTable).toEqual(
        expect.objectContaining({
          tokens:
            mockOrder.quantity *
            combinedOrder.quantity *
            combinedOrder.tokenCount,
          userId: mockOrder.userId,
        }),
      );
    }

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
      const insertOrder = jest.spyOn(
        service.orderDaoProp,
        "create",
      ) as CreateOrderSpy;
      const insertTokenTimeTable = jest.spyOn(
        service.tokenTimetableDaoProp,
        "create",
      ) as CreateTokenTimeTableSpy;
      // Call the method
      const result = await service.updateAsPaid(
        { ...mockUserCredits },
        mockOrder,
      );

      // Assertions
      expect(result).toBeDefined();
      // Add assertions based on your specific logic and expectations

      // Check if computeStartDate and updateOfferGroupTokens were called
      expect(computeStartDateSpy).toHaveBeenCalledWith(mockOrder);
      expect(computeStartDateSpy).toHaveBeenCalledTimes(3);
      expect(updateOfferGroupTokens).toHaveBeenCalledTimes(3);
      expect(updateOfferGroupTokens).toHaveBeenCalledWith(
        mockOrder,
        mockUserCredits,
        mockOrder,
        1,
      );
      // these are the two nested orders
      expect(updateOfferGroupTokens).toHaveBeenCalledWith(
        expect.anything(),
        mockUserCredits,
        expect.anything(),
        2,
      );

      expect(insertOrder).toHaveBeenCalledTimes(2);
      expect(insertOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "$",
          customCycle: now,
          parentId: "mockOrderId",
          status: "paid",
          total: 0,
          userId: "mockUserId",
          ...nestedCallsOfferProps,
          quantity: mockOrder.quantity * nestedCallsOfferProps.quantity,
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
          quantity: mockOrder.quantity * nestedDataOfferProps.quantity,
          tokenCount:
            mockOrder.quantity *
            nestedDataOfferProps.quantity *
            nestedDataOfferProps.tokenCount,
        }),
      );

      // Check the calls to orderDao.find
      expect(findOfferByIdMock).toHaveBeenCalledWith(mockOrder.offerId);

      const helpDeskGroup = mockUserCredits.offers.find(
        (offer) => offer.offerGroup === "mockHelpDesk",
      )!;
      expect(helpDeskGroup).toBeDefined();
      expectDatesEqualInSeconds(helpDeskGroup.starts, now); // appendDate == false
      expectDatesEqualInSeconds(
        helpDeskGroup.expires,
        addDays(now, mockOrder.quantity * 7),
      );

      testNestedOrder(
        nestedCallsOfferProps,
        lastExpiryDateForNestedOrders,
        insertOrder,
        insertTokenTimeTable,
      );

      testNestedOrder(
        nestedDataOfferProps,
        now,
        insertOrder,
        insertTokenTimeTable,
      );

      // Restore the original method to avoid interference with other tests
      jest.restoreAllMocks();
    });
  });
});
