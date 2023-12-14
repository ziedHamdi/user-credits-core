import { IDaoFactory } from "../../db/dao/IDaoFactory";
import {
  IActivatedOffer,
  ICombinedOffer,
  ICombinedOrder,
  IOffer,
  IOrder,
  ITokenTimetable,
  IUserCredits,
} from "../../db/model/types";
import { addDays, addMonths } from "../../util";
import type { IExpiryDateComputeInput } from "../BaseService";
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
  ): Promise<Date> {
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

  async computeStartDate(
    order: IExpiryDateComputeInput<string>,
  ): Promise<Date> {
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
    const rootOfferProps = {
      appendDate: false,
      combinedItems: [
        {
          ...nestedCallsOfferProps,
        } as unknown as ICombinedOffer<string>,
        {
          ...nestedDataOfferProps,
          cycle: undefined,
        } as unknown as ICombinedOffer<string>,
      ],
      cycle: "weekly",
      offerGroup: "mockHelpDesk",
      offerId: "mockOfferId",
      tokens: 1, // can call support once a week
      userId: "mockUserId",
    };

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
        ...rootOfferProps,
        _id: "mockOrderId",
        combinedItems: [
          { _id: "mockCallsNestedId", ...nestedCallsOfferProps },
          { _id: "mockDataNestedId", ...nestedDataOfferProps },
        ],
        currency: "$",
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
     * @param userCreditsResult the object to test against
     * @param combinedOrder the nested order
     * @param expectedStart now if appendDate is false, and the date of the last order for the offer group: mocked to lastExpiryDateForNestedOrders if true
     * @param insertOrder the function mock from the dao
     * @param insertTokenTimeTable the function mock from the dao
     */
    function testNestedOrder(
      userCreditsResult: IUserCredits<string>,
      combinedOrder: ICombinedOrder<string>,
      expectedStart: Date,
      insertOrder: CreateOrderSpy,
      insertTokenTimeTable: CreateTokenTimeTableSpy,
    ) {
      const creditsGroup = userCreditsResult.offers.find(
        (offer) => offer.offerGroup === combinedOrder.offerGroup,
      )! as unknown as IActivatedOffer;
      expect(creditsGroup).toBeDefined();
      expectDatesEqualInSeconds(creditsGroup.starts, expectedStart);
      expectDatesEqualInSeconds(
        creditsGroup.expires,
        addMonths(
          expectedStart,
          (mockOrder.quantity || 1) * combinedOrder.quantity,
        ),
      );

      const [insertedCallsOrder] = insertOrder.mock.calls.find(([call]) => {
        // first argument of dao.create is the order
        return call.offerId === combinedOrder.offerId;
      })! as unknown as [IOrder<string>];
      expect(insertedCallsOrder.starts).toEqual(creditsGroup.starts);
      expect(insertedCallsOrder.expires).toEqual(creditsGroup.expires);
      expect(insertedCallsOrder.tokenCount).toEqual(
        creditsGroup.tokens! - 1000,
      );

      const [insertedCallsTokenTimeTable] =
        insertTokenTimeTable.mock.calls.find(([createCall]) => {
          // first argument of dao.create is the ITokenTimetable to insert
          return createCall.offerGroup === combinedOrder.offerGroup;
        })! as unknown as [ITokenTimetable<string>];
      expect(insertedCallsTokenTimeTable).toEqual(
        expect.objectContaining({
          tokens:
            (mockOrder.quantity || 1) *
            combinedOrder.quantity *
            combinedOrder.tokenCount,
          userId: mockOrder.userId,
        }),
      );
    }

    test(
      "updates as paid with combined items typical case",
      async () => {
        // Mock the specific call to orderDao.find
        const findOrderListMock = jest
          .fn()
          .mockResolvedValue(findOrderListMockValue);

        // Mock the orderDao.find method
        service.offerDaoProp.findById = findOfferByIdMock;
        service.orderDaoProp.find = findOrderListMock;
        // spy on nested functions
        const computeStartDateSpy = jest.spyOn(service, "computeStartDate");

        const insertOrder = jest.spyOn(
          service.orderDaoProp,
          "create",
        ) as CreateOrderSpy;
        const insertTokenTimeTable = jest.spyOn(
          service.tokenTimetableDaoProp,
          "create",
        ) as CreateTokenTimeTableSpy;
        // Call the method
        const userCreditsResult = {
          ...mockUserCredits,
          offers: [
            {
              expires: addDays(now, 3),
              offerGroup: "calls",
              starts: addDays(now, -12),
              tokens: 1000,
            } as IActivatedOffer,
          ],
        };
        const result = await service.updateAsPaid(userCreditsResult, mockOrder);

        // Assertions
        expect(result).toBeDefined();
        // Add assertions based on your specific logic and expectations

        // Check if computeStartDate  were called
        expect(computeStartDateSpy).toHaveBeenCalledWith(mockOrder);
        expect(computeStartDateSpy).toHaveBeenCalledTimes(2);

        expect(insertOrder).toHaveBeenCalledTimes(2);
        expect(insertOrder).toHaveBeenCalledWith(
          expect.objectContaining({
            ...nestedCallsOfferProps,
            currency: "$",
            customCycle: now,
            parentId: "mockOrderId",
            quantity: mockOrder.quantity * nestedCallsOfferProps.quantity,
            status: "paid",
            tokenCount:
              mockOrder.quantity *
              nestedCallsOfferProps.quantity *
              nestedCallsOfferProps.tokenCount,
            total: 0,
            userId: "mockUserId",
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

        const helpDeskGroup = userCreditsResult.offers.find(
          (offer) => offer.offerGroup === "mockHelpDesk",
        )!;
        expect(helpDeskGroup).toBeDefined();
        expectDatesEqualInSeconds(helpDeskGroup.starts, now); // appendDate == false

        expectDatesEqualInSeconds(
          helpDeskGroup.expires,
          addDays(now, mockOrder.quantity * 7),
        );

        testNestedOrder(
          userCreditsResult,
          nestedCallsOfferProps,
          lastExpiryDateForNestedOrders,
          insertOrder,
          insertTokenTimeTable,
        );

        const creditsDataGroup = userCreditsResult.offers.find(
          (offer) => offer.offerGroup === nestedDataOfferProps.offerGroup,
        )! as unknown as IActivatedOffer;
        expect(creditsDataGroup).toBeDefined();
        expectDatesEqualInSeconds(creditsDataGroup.starts, now);
        expectDatesEqualInSeconds(
          creditsDataGroup.expires,
          addDays(now, mockOrder.quantity * 7),
        );

        const rootTokens = userCreditsResult.offers.find(
          (item) => item.offerGroup === "mockHelpDesk",
        );
        expect(rootTokens).toBeDefined();
        expect(rootTokens!.tokens).toEqual(
          mockOrder.quantity * rootOfferProps.tokens,
        );

        const callsTokens = userCreditsResult.offers.find(
          (item) => item.offerGroup === nestedCallsOfferProps.offerGroup,
        );
        expect(callsTokens).toBeDefined();
        expect(callsTokens!.tokens).toEqual(
          1000 +
            mockOrder.quantity *
              nestedCallsOfferProps.quantity *
              nestedCallsOfferProps.tokenCount,
        );

        const dataTokens = userCreditsResult.offers.find(
          (item) => item.offerGroup === "data",
        );
        expect(dataTokens).toBeDefined();
        expect(dataTokens!.tokens).toEqual(
          mockOrder.quantity *
            nestedDataOfferProps.quantity *
            nestedDataOfferProps.tokenCount,
        );

        // Restore the original method to avoid interference with other tests
        jest.restoreAllMocks();
      },
      1000 * 60,
    );
  });
});
