import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyEmailSendFailure,
  createDeliberateResend,
  deliverQueuedOrderEmail,
  queueOrderEmail,
  recoverPendingEmailDeliveries,
  recoverStaleEmailDeliveries,
  retryFailedOrderEmail,
  type EmailDeliveryDependencies,
  type OrderEmailDelivery,
} from "../app/services/email-delivery.server";
import { createOrderShippingService } from "../app/services/order-shipping.server";
import type { Order } from "../app/types";

const ORDER_ID = "6a7c2fcacabeecd95e0044b9";
const DELIVERY_ID = "6a7c2fcacabeecd95e0044ba";
const SECOND_DELIVERY_ID = "6a7c2fcacabeecd95e0044bb";
const FIXED_NOW = new Date("2026-08-25T12:00:00.000Z");

type DeliveryDocument = OrderEmailDelivery & {
  claimToken?: string;
  deduplicationKey: string;
  recipientFingerprint?: string;
};

const clone = <T>(value: T): T => structuredClone(value);

class FakeEmailDeliveries {
  documents = new Map<string, DeliveryDocument>();
  failNextSentWrite = false;
  throwDuplicateOnNextUpsert = false;

  seed(document: DeliveryDocument) {
    this.documents.set(String(document._id), clone(document));
  }

  findById(id: string) {
    return {
      lean: async () => clone(this.documents.get(String(id)) ?? null),
    };
  }

  find(filter: Record<string, any>) {
    return {
      sort: (_sort: Record<string, number>) => ({
        limit: (limit: number) => ({
          lean: async () =>
            [...this.documents.values()]
              .filter((document) => this.matches(document, filter))
              .sort(
                (left, right) =>
                  new Date(left.createdAt ?? 0).getTime() -
                  new Date(right.createdAt ?? 0).getTime()
              )
              .slice(0, limit)
              .map(clone),
        }),
      }),
    };
  }

  findOne(filter: Record<string, any>) {
    const read = async (sort?: Record<string, number>) => {
      const matches = [...this.documents.values()].filter((document) =>
        this.matches(document, filter)
      );
      if (sort?.attempt === -1) {
        matches.sort((left, right) => right.attempt - left.attempt);
      }
      return clone(matches[0] ?? null);
    };

    return {
      lean: () => read(),
      sort: (sort: Record<string, number>) => ({ lean: () => read(sort) }),
    };
  }

  findOneAndUpdate(
    filter: Record<string, any>,
    update: Record<string, any>,
    options: Record<string, any>
  ) {
    return {
      lean: async () => {
        const existing = [...this.documents.values()].find((document) =>
          this.matches(document, filter)
        );

        if (
          this.failNextSentWrite &&
          update.$set?.status === "SENT"
        ) {
          this.failNextSentWrite = false;
          throw new Error("simulated database failure after SMTP acceptance");
        }

        if (
          options.upsert &&
          filter.deduplicationKey &&
          this.throwDuplicateOnNextUpsert
        ) {
          this.throwDuplicateOnNextUpsert = false;
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }

        if (existing) {
          this.applyUpdate(existing, update, false);
          return clone(existing);
        }

        if (!options.upsert) return null;
        const nextId = [DELIVERY_ID, SECOND_DELIVERY_ID].find(
          (candidate) => !this.documents.has(candidate)
        );
        if (!nextId) throw new Error("fake delivery id pool exhausted");
        const inserted = {
          _id: nextId,
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
          ...filter,
          ...(update.$setOnInsert ?? {}),
        } as DeliveryDocument;
        this.documents.set(String(inserted._id), inserted);
        return clone(inserted);
      },
    };
  }

  async updateOne(
    filter: Record<string, any>,
    update: Record<string, any>
  ) {
    const existing = [...this.documents.values()].find((document) =>
      this.matches(document, filter)
    );
    if (existing) this.applyUpdate(existing, update, false);
    return { matchedCount: existing ? 1 : 0 };
  }

  async updateMany(
    filter: Record<string, any>,
    update: Record<string, any>
  ) {
    let modifiedCount = 0;
    for (const document of this.documents.values()) {
      if (!this.matches(document, filter)) continue;
      this.applyUpdate(document, update, false);
      modifiedCount += 1;
    }
    return { modifiedCount };
  }

  private applyUpdate(
    document: DeliveryDocument,
    update: Record<string, any>,
    inserted: boolean
  ) {
    if (inserted && update.$setOnInsert) {
      Object.assign(document, update.$setOnInsert);
    }
    if (update.$set) Object.assign(document, update.$set);
    for (const property of Object.keys(update.$unset ?? {})) {
      delete (document as unknown as Record<string, unknown>)[property];
    }
    document.updatedAt = FIXED_NOW;
  }

  private matches(
    document: DeliveryDocument,
    filter: Record<string, any>
  ) {
    return Object.entries(filter).every(([property, expected]) => {
      const actual = (document as unknown as Record<string, unknown>)[property];
      if (
        typeof expected === "object" &&
        expected !== null &&
        "$lt" in expected
      ) {
        return new Date(String(actual)).getTime() < new Date(expected.$lt).getTime();
      }
      return String(actual) === String(expected);
    });
  }
}

const makeOrder = (status: Order["status"] = "SHIPPED"): Order => ({
  _id: ORDER_ID,
  customer: {
    city: "Järfälla",
    email: "customer@example.com",
    firstname: "Mathias",
    lastname: "Nilsson",
    postaddress: "Datavägen 2A",
    zipcode: "175 43",
  },
  discount: {
    amount: 0,
    code: undefined,
    percentage: undefined,
  },
  freightCost: 0,
  items: [
    {
      _id: "item-1",
      additionalItems: [],
      description: "Specialdesign",
      image: "https://example.com/wanja.webp",
      name: "Wanja",
      price: 329,
      quantity: 1,
    },
  ],
  kind: "STOREFRONT",
  status,
  totalSum: 329,
});

const makeDependencies = (
  deliveries: FakeEmailDeliveries,
  order = makeOrder()
): EmailDeliveryDependencies => ({
  deliveries: deliveries as any,
  now: () => FIXED_NOW,
  orders: {
    findById: () => ({ lean: async () => clone(order) }),
    updateOne: async (_filter, update) => {
      Object.assign(order, (update.$set as Record<string, unknown>) ?? {});
      return { matchedCount: 1 };
    },
  },
  randomId: () => "claim-1",
});

const queueShippingEmail = async (
  deliveries: FakeEmailDeliveries,
  dependencies: EmailDeliveryDependencies
) => {
  const delivery = await queueOrderEmail(
    {
      kind: "SHIPPING",
      orderId: ORDER_ID,
      recipient: "customer@example.com",
    },
    dependencies
  );
  assert.ok(delivery);
  return delivery;
};

test("classifies only proven pre-acceptance SMTP failures as retryable", () => {
  assert.equal(
    classifyEmailSendFailure(
      Object.assign(new Error("authentication rejected"), { code: "EAUTH" })
    ),
    "FAILED"
  );
  assert.equal(
    classifyEmailSendFailure(
      Object.assign(new Error("recipient rejected"), { responseCode: 550 })
    ),
    "FAILED"
  );
  assert.equal(
    classifyEmailSendFailure(
      Object.assign(new Error("connection timed out"), {
        code: "ETIMEDOUT",
        command: "DATA",
      })
    ),
    "UNKNOWN"
  );
});

test("recovers a concurrent deterministic upsert without surfacing E11000", async () => {
  const deliveries = new FakeEmailDeliveries();
  const dependencies = makeDependencies(deliveries);
  const first = await queueShippingEmail(deliveries, dependencies);

  deliveries.throwDuplicateOnNextUpsert = true;
  const second = await queueShippingEmail(deliveries, dependencies);

  assert.equal(second._id, first._id);
  assert.equal(deliveries.documents.size, 1);
});

test("two concurrent claims produce one first SMTP send", async () => {
  const deliveries = new FakeEmailDeliveries();
  const dependencies = makeDependencies(deliveries);
  const delivery = await queueShippingEmail(deliveries, dependencies);
  let sends = 0;
  const sender = async () => {
    sends += 1;
    await Promise.resolve();
    return { messageId: "shipping-first" };
  };

  await Promise.all([
    deliverQueuedOrderEmail(String(delivery._id), sender, dependencies),
    deliverQueuedOrderEmail(String(delivery._id), sender, dependencies),
  ]);

  assert.equal(sends, 1);
  assert.equal(deliveries.documents.get(String(delivery._id))?.status, "SENT");

  await deliverQueuedOrderEmail(String(delivery._id), sender, dependencies);
  assert.equal(sends, 1, "a repeated request must not resend a sent delivery");
});

test("two deliberate resend requests converge on one next attempt", async () => {
  const deliveries = new FakeEmailDeliveries();
  deliveries.seed({
    _id: DELIVERY_ID,
    attempt: 1,
    createdAt: FIXED_NOW,
    deduplicationKey: `shipping:${ORDER_ID}:1`,
    kind: "SHIPPING",
    orderRef: ORDER_ID,
    status: "UNKNOWN",
  });
  const dependencies = makeDependencies(deliveries);
  let sends = 0;
  const sender = async () => {
    sends += 1;
    await Promise.resolve();
    return { messageId: "shipping-second-attempt" };
  };
  const input = {
    kind: "SHIPPING" as const,
    orderId: ORDER_ID,
    previousAttempt: 1,
    recipient: "customer@example.com",
  };

  await Promise.all([
    createDeliberateResend(input, sender, dependencies),
    createDeliberateResend(input, sender, dependencies),
  ]);

  assert.equal(sends, 1);
  assert.equal(deliveries.documents.size, 2);
  assert.equal(deliveries.documents.get(SECOND_DELIVERY_ID)?.attempt, 2);
  assert.equal(deliveries.documents.get(SECOND_DELIVERY_ID)?.status, "SENT");
});

test("a proven SMTP rejection is visible and retryable on the same attempt", async () => {
  const deliveries = new FakeEmailDeliveries();
  const order = makeOrder();
  const dependencies = makeDependencies(deliveries, order);
  const delivery = await queueShippingEmail(deliveries, dependencies);

  await deliverQueuedOrderEmail(
    String(delivery._id),
    async () => {
      throw Object.assign(new Error("SMTP authentication rejected"), {
        code: "EAUTH",
      });
    },
    dependencies
  );
  assert.equal(deliveries.documents.get(String(delivery._id))?.status, "FAILED");

  let retryAttempt: number | undefined;
  await retryFailedOrderEmail(
    String(delivery._id),
    async (_order, _template, _mailer, options) => {
      retryAttempt = options?.deliveryAttempt;
      return { messageId: "shipping-retry" };
    },
    dependencies
  );

  assert.equal(retryAttempt, 1);
  assert.equal(deliveries.documents.get(String(delivery._id))?.status, "SENT");
  assert.equal(order.shippingEmailAt, FIXED_NOW);
});

test("an ambiguous SMTP failure cannot use the direct retry path", async () => {
  const deliveries = new FakeEmailDeliveries();
  const dependencies = makeDependencies(deliveries);
  const delivery = await queueShippingEmail(deliveries, dependencies);

  await deliverQueuedOrderEmail(
    String(delivery._id),
    async () => {
      throw Object.assign(new Error("socket closed after DATA"), {
        code: "ETIMEDOUT",
        command: "DATA",
      });
    },
    dependencies
  );

  assert.equal(deliveries.documents.get(String(delivery._id))?.status, "UNKNOWN");
  await retryFailedOrderEmail(
    String(delivery._id),
    async () => {
      assert.fail("UNKNOWN deliveries must not be retried implicitly");
    },
    dependencies
  );
  assert.equal(deliveries.documents.get(String(delivery._id))?.status, "UNKNOWN");
});

test("SMTP success followed by a database failure becomes UNKNOWN", async () => {
  const deliveries = new FakeEmailDeliveries();
  const dependencies = makeDependencies(deliveries);
  const delivery = await queueShippingEmail(deliveries, dependencies);
  deliveries.failNextSentWrite = true;

  await deliverQueuedOrderEmail(
    String(delivery._id),
    async () => ({ messageId: "accepted-by-smtp" }),
    dependencies
  );

  const stored = deliveries.documents.get(String(delivery._id));
  assert.equal(stored?.status, "UNKNOWN");
  assert.match(stored?.lastError ?? "", /accepterade utskicket/);
});

test("stale SENDING deliveries recover to UNKNOWN without being resent", async () => {
  const deliveries = new FakeEmailDeliveries();
  deliveries.seed({
    _id: DELIVERY_ID,
    attempt: 1,
    claimedAt: new Date("2026-08-25T10:00:00.000Z"),
    claimToken: "abandoned-claim",
    createdAt: new Date("2026-08-25T09:59:00.000Z"),
    deduplicationKey: `shipping:${ORDER_ID}:1`,
    kind: "SHIPPING",
    orderRef: ORDER_ID,
    status: "SENDING",
  });

  await recoverStaleEmailDeliveries(
    new Date("2026-08-25T11:45:00.000Z"),
    makeDependencies(deliveries)
  );

  assert.equal(deliveries.documents.get(DELIVERY_ID)?.status, "UNKNOWN");
  assert.equal(deliveries.documents.get(DELIVERY_ID)?.claimToken, undefined);
});

test("pending shipping mail waits for SHIPPED before recovery sends it", async () => {
  const deliveries = new FakeEmailDeliveries();
  const order = makeOrder("SUCCESS");
  const dependencies = makeDependencies(deliveries, order);
  const delivery = await queueShippingEmail(deliveries, dependencies);
  let sends = 0;
  const sender = async () => {
    sends += 1;
    return { messageId: "recovered-pending" };
  };

  await recoverPendingEmailDeliveries(
    new Date("2026-08-25T12:01:00.000Z"),
    10,
    sender,
    dependencies
  );
  assert.equal(sends, 0);
  assert.equal(deliveries.documents.get(String(delivery._id))?.status, "PENDING");

  order.status = "SHIPPED";
  await recoverPendingEmailDeliveries(
    new Date("2026-08-25T12:01:00.000Z"),
    10,
    sender,
    dependencies
  );
  assert.equal(sends, 1);
  assert.equal(deliveries.documents.get(String(delivery._id))?.status, "SENT");
});

test("shipping persists its outbox row before status and preserves history on reversion", async () => {
  const order = makeOrder("SUCCESS");
  const state: { delivery: OrderEmailDelivery | null } = { delivery: null };
  const events: string[] = [];
  const service = createOrderShippingService({
    deliver: async () => {
      events.push("deliver");
      assert.equal(order.status, "SHIPPED");
      state.delivery = {
        ...(state.delivery as OrderEmailDelivery),
        status: "SENT",
      };
      return state.delivery;
    },
    ensureLegacy: async () => state.delivery,
    findOrder: async () => clone(order),
    getLatest: async () => state.delivery,
    queue: async () => {
      events.push("queue");
      state.delivery = {
        _id: DELIVERY_ID,
        attempt: 1,
        kind: "SHIPPING",
        orderRef: ORDER_ID,
        status: "PENDING",
      };
      return state.delivery;
    },
    updateStatus: async (_orderId, status) => {
      events.push(`status:${status}`);
      order.status = status;
    },
  });

  await service.markShippedAndEmail(ORDER_ID);
  assert.deepEqual(events, ["queue", "status:SHIPPED", "deliver"]);
  assert.equal(state.delivery?.status, "SENT");

  await service.markNotShipped(ORDER_ID);
  assert.equal(order.status, "SUCCESS");
  assert.equal(state.delivery?.status, "SENT");
});

test("an outbox failure leaves the order unshipped", async () => {
  const order = makeOrder("SUCCESS");
  let updated = false;
  const service = createOrderShippingService({
    deliver: async () => null,
    ensureLegacy: async () => null,
    findOrder: async () => clone(order),
    getLatest: async () => null,
    queue: async () => {
      throw new Error("database unavailable");
    },
    updateStatus: async () => {
      updated = true;
    },
  });

  await assert.rejects(
    () => service.markShippedAndEmail(ORDER_ID),
    /database unavailable/
  );
  assert.equal(updated, false);
  assert.equal(order.status, "SUCCESS");
});
