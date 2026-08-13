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
import { sendOrderEmail } from "../app/services/order-email.server";
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
  domain: "moaclayco",
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
