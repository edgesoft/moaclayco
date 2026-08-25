import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { renderToStaticMarkup } from "react-dom/server";
import EmailOrderTemplate, {
  getOrderEmailSubject,
  getOrderEmailText,
  Template,
  shortOrderNumber,
} from "../app/components/mail/order";
import {
  orderEmailRecipients,
  sendOrderEmail,
} from "../app/services/order-email.server";
import { legacyShippingDeliveryView } from "../app/services/email-delivery.server";
import { canManageOrderShipment } from "../app/utils/orderShipping.shared";
import type { Order } from "../app/types";

const order: Order = {
  _id: "6a7c2fcacabeecd95e0044b9",
  customer: {
    city: "Göteborg",
    email: "test@example.com",
    firstname: "Test",
    lastname: "Kund",
    postaddress: "Ateljégatan 4",
    zipcode: "411 01",
  },
  discount: {
    amount: 50,
    code: "SOMMAR",
    percentage: 10,
  },
  freightCost: 0,
  items: [
    {
      _id: "item-1",
      additionalItems: [
        { name: "Presentask", packinfo: "Natur", price: 20 },
      ],
      image: "https://example.com/wanja.jpg",
      itemRef: "wanja",
      name: "Wanja",
      price: 329,
      quantity: 1,
    },
    {
      _id: "item-2",
      additionalItems: [],
      image: "",
      itemRef: "sollan",
      name: "Sollan ombre blå",
      price: 339,
      quantity: 1,
    },
  ],
  status: "SUCCESS",
  totalSum: 638,
};

test("order confirmation uses the shared editorial email design", () => {
  const html = renderToStaticMarkup(
    <EmailOrderTemplate
      copyrightYear={2026}
      order={order}
      template={Template.ORDER}
    />
  );

  assert.match(html, /ORDERBEKRÄFTELSE/);
  assert.match(html, /Tack för din beställning\./);
  assert.match(html, /#5E0044B9/);
  assert.match(html, /Ateljégatan 4/);
  assert.match(html, /Presentask/);
  assert.match(html, /SOMMAR/);
  assert.match(html, /Fri/);
  assert.match(html, /role="presentation"/);
  assert.match(html, /max-width:600px/);
  assert.match(html, /class="email-wordmark"/);
  assert.match(html, /border-radius:999px/);
  assert.match(html, /© 2026 Moa Clay Co/);
  assert.doesNotMatch(html, /D1FAE5|E5E7EB|All rights reserved/);
});

test("shipping email reuses the design with delivery-specific copy", () => {
  const html = renderToStaticMarkup(
    <EmailOrderTemplate
      copyrightYear={2026}
      order={order}
      template={Template.SHIPPING}
    />
  );

  assert.match(html, /PÅ VÄG TILL DIG/);
  assert.match(html, /Din beställning är på väg\./);
  assert.match(html, /lämnat ateljén/);
});

test("order emails never repeat an identical second address line", () => {
  const duplicateAddressOrder: Order = {
    ...order,
    customer: {
      ...order.customer,
      addressLine2: "  DATAVÄGEN   2A ",
      postaddress: "Datavägen 2A",
    },
  };
  const html = renderToStaticMarkup(
    <EmailOrderTemplate
      copyrightYear={2026}
      order={duplicateAddressOrder}
      template={Template.ORDER}
    />
  );
  const text = getOrderEmailText(duplicateAddressOrder, Template.ORDER);

  assert.equal(html.match(/Datavägen 2A/g)?.length, 1);
  assert.equal(text.match(/Datavägen 2A/g)?.length, 1);
  assert.doesNotMatch(html, /DATAVÄGEN/);
  assert.doesNotMatch(text, /DATAVÄGEN/);
});

test("special-order invitation is complete and attractive without an image or address", () => {
  const specialOrder: Order = {
    ...order,
    kind: "SPECIAL",
    customer: {
      ...order.customer,
      city: "",
      postaddress: "",
      zipcode: "",
    },
    items: [
      {
        _id: "special-1",
        additionalItems: [],
        description: "Handdrejad i salviagrönt med mjuk vågig kant.",
        image: "",
        inventoryMode: "UNTRACKED",
        name: "Annas vågiga vas",
        price: 1_250,
        quantity: 1,
      },
    ],
    specialOrder: {
      expiresAt: new Date("2026-08-24T21:59:00.000Z"),
    },
    totalSum: 1_299,
    freightCost: 49,
  };
  const actionUrl = "https://moaclayco.com/special-order/private-token";
  const html = renderToStaticMarkup(
    <EmailOrderTemplate
      actionUrl={actionUrl}
      copyrightYear={2026}
      order={specialOrder}
      template={Template.SPECIAL_INVITATION}
    />
  );
  const text = getOrderEmailText(
    specialOrder,
    Template.SPECIAL_INVITATION,
    actionUrl
  );

  assert.match(html, /DIN SPECIALBESTÄLLNING/);
  assert.match(html, /Special.*design/s);
  assert.match(html, /Bild läggs till när produkten är färdig/);
  assert.match(html, /Granska och gå till betalning/);
  assert.match(html, /24 augusti 2026 kl\. 23:59/);
  assert.match(html, /Kompletteras före betalning/);
  assert.match(text, /Handdrejad i salviagrönt/);
  assert.match(text, /Bild läggs till/);
  assert.match(text, /private-token/);
  assert.match(text, /24 augusti 2026 kl\. 23:59/);
  assert.match(text, /Kompletteras innan betalning/);

  const dateOnlyOrder: Order = {
    ...specialOrder,
    specialOrder: {
      ...specialOrder.specialOrder,
      expiryIncludesTime: false,
    },
  };
  const dateOnlyHtml = renderToStaticMarkup(
    <EmailOrderTemplate
      actionUrl={actionUrl}
      copyrightYear={2026}
      order={dateOnlyOrder}
      template={Template.SPECIAL_INVITATION}
    />
  );
  assert.match(dateOnlyHtml, /24 augusti 2026/);
  assert.doesNotMatch(dateOnlyHtml, /24 augusti 2026 kl\./);
});

test("shipping email favors the photographed finished special piece", () => {
  const specialOrder: Order = {
    ...order,
    kind: "SPECIAL",
    items: [
      {
        ...order.items[0],
        finalImage: "https://example.com/finished.webp",
        image: "https://example.com/inspiration.webp",
        inventoryMode: "UNTRACKED",
      },
    ],
  };
  const html = renderToStaticMarkup(
    <EmailOrderTemplate
      copyrightYear={2026}
      order={specialOrder}
      template={Template.SHIPPING}
    />
  );

  assert.match(html, /finished\.webp/);
  assert.doesNotMatch(html, /inspiration\.webp/);
});

test("order emails include concise subjects and a complete plain-text fallback", () => {
  assert.equal(
    getOrderEmailSubject(order, Template.ORDER),
    "Orderbekräftelse #5E0044B9 · Moa Clay Co"
  );
  assert.equal(
    getOrderEmailSubject(order, Template.SHIPPING),
    "Din order #5E0044B9 är på väg · Moa Clay Co"
  );

  const text = getOrderEmailText(order, Template.ORDER);
  assert.match(text, /1 × Wanja — 329\s+kr/);
  assert.match(text, /Presentask \(Natur\) — 20\s+kr/);
  assert.match(text, /Rabatt \(SOMMAR\): −50\s+kr/);
  assert.match(text, /Totalt: 638\s+kr/);
  assert.match(text, /Ateljégatan 4/);
  assert.match(text, /support@moaclayco\.com/);
});

test("order number formatting accepts MongoDB ObjectIds from live orders", () => {
  assert.equal(
    shortOrderNumber(new mongoose.Types.ObjectId("6a7c35036c097ff2e08f8569")),
    "#E08F8569"
  );
});

test("order email failures propagate so delivery can be retried", async () => {
  await assert.rejects(
    sendOrderEmail(order, Template.ORDER, {
      sendMail: async () => {
        throw new Error("SMTP unavailable");
      },
    }),
    /SMTP unavailable/
  );
});

test("stage can redirect every order email without production BCC", () => {
  assert.deepEqual(
    orderEmailRecipients(order, {
      EMAIL_REDIRECT_TO: " stage-inbox@example.test ",
    }),
    { to: "stage-inbox@example.test" }
  );
  assert.deepEqual(orderEmailRecipients(order, {}), {
    bcc: "support@moaclayco.com,wicket.programmer@gmail.com",
    to: order.customer.email,
  });
});

test("order emails use a stable message id across retries", async () => {
  const messages: Array<{ messageId?: string }> = [];
  const mailer = {
    sendMail: async (message: { messageId?: string }) => {
      messages.push(message);
      return { messageId: message.messageId };
    },
  };

  await sendOrderEmail(order, Template.ORDER, mailer);
  await sendOrderEmail(order, Template.ORDER, mailer);

  assert.equal(messages.length, 2);
  assert.equal(
    messages[0].messageId,
    "<order-6a7c2fcacabeecd95e0044b9@moaclayco.com>"
  );
  assert.equal(messages[1].messageId, messages[0].messageId);
});

test("a deliberate second delivery gets a distinct message id", async () => {
  const messages: Array<{ messageId?: string }> = [];
  const mailer = {
    sendMail: async (message: { messageId?: string }) => {
      messages.push(message);
      return { messageId: message.messageId };
    },
  };

  await sendOrderEmail(order, Template.SHIPPING, mailer, {
    deliveryAttempt: 2,
  });

  assert.equal(
    messages[0].messageId,
    "<shipping-6a7c2fcacabeecd95e0044b9-2@moaclayco.com>"
  );
});

test("legacy shipping delivery state can be shown without a database write", () => {
  const sent = legacyShippingDeliveryView({
    _id: order._id,
    shippingEmailAt: new Date("2026-08-25T12:00:00.000Z"),
    status: "SHIPPED",
  });
  const unknown = legacyShippingDeliveryView({
    _id: order._id,
    status: "SHIPPED",
  });
  const absent = legacyShippingDeliveryView({
    _id: order._id,
    status: "SUCCESS",
  });

  assert.equal(sent?.status, "SENT");
  assert.equal(unknown?.status, "UNKNOWN");
  assert.equal(absent, null);
});

test("paid-review special orders can ship without opening reviewed storefront stock", () => {
  assert.equal(
    canManageOrderShipment({ kind: "SPECIAL", status: "PAID_REVIEW" }),
    true
  );
  assert.equal(
    canManageOrderShipment({ kind: "STOREFRONT", status: "PAID_REVIEW" }),
    false
  );
  assert.equal(
    canManageOrderShipment({ kind: "SPECIAL", status: "AWAITING_CUSTOMER" }),
    false
  );
});
