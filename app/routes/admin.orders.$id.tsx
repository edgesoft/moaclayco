import { ActionFunction, data as json, LoaderFunction, MetaFunction } from "react-router";
import { Orders } from "../schemas/orders";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { auth } from "~/services/auth.server";
import stripeClient from "../stripeClient";
import { sendOrderEmail } from "~/services/order-email.server";
import { Template } from "~/components/mail/order";
import { Order } from "~/types";
import { Verifications } from "~/schemas/verifications";
import { createVerification } from "~/services/verification.server";
import { getDomain } from "~/utils/domain";
import type Stripe from "stripe";

type OrderDetailLoaderData = {
  order: Order;
  intent: Stripe.PaymentIntent | null;
  verification: { verificationNumber: number } | null;
};

const orderStatusMeta = {
  SUCCESS: { label: "Betald", tone: "paid" },
  FAILED: { label: "Betalning misslyckades", tone: "failed" },
  SHIPPED: { label: "Skickad", tone: "shipped" },
  CANCELED: { label: "Avbruten", tone: "canceled" },
  PAID_REVIEW: { label: "Betald · kontrollera", tone: "review" },
  MANUAL_PROCESSING: { label: "Manuell order", tone: "manual" },
  OPENED: { label: "Påbörjad", tone: "manual" },
  PENDING: { label: "Väntar", tone: "review" },
} as const;

const getStatusInfo = (status: Order["status"]) =>
  status ? orderStatusMeta[status] : orderStatusMeta.SUCCESS;

const formatPrice = (amount: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);

const formatDateTime = (value?: Date | string) => {
  if (!value) return "Datum saknas";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Datum saknas";

  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  })
    .format(date)
    .replace(" kl. ", " · ");
};

export let loader: LoaderFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);

  const order = await Orders.findOne({
    _id: params.id,
    domain: domain?.domain,
  });

  if (!order) throw new Response("Order not found", { status: 404 });

  const verification = await Verifications.findOne({
    "metadata.key": "orderId",
    "metadata.value": params.id,
    domain: order.domain
  });

  let intent = null;

  if (order.status === "FAILED") {
    try {
      if (order.paymentIntent && order.paymentIntent.id) {
        intent = await stripeClient.paymentIntents.retrieve(
          order.paymentIntent.id
        );
      }
      return json({ order, intent, verification });
    } catch (error) {
      console.error("Stripe PaymentIntent could not be retrieved", {
        orderId: order._id,
        error,
      });
    }
  }
  return json({ order, intent: null, verification });
};

export let meta: MetaFunction = ({ loaderData }) => {
  const orderId =
    (loaderData as OrderDetailLoaderData | undefined)?.order?._id ?? "okänd";
  return [
    {
      title: `Moa Clay Collection (order: ${orderId})`,
    },
    {
      name: "description",
      content: `Order: ${orderId}`,
    },
  ];
};

export let action: ActionFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);
  let body = new URLSearchParams(await request.text());
  const type = body.get("_action") || "";

  if (type === "verification") {
    const order: Order | null = await Orders.findOne({
      _id: params.id,
      domain: domain?.domain,
    }).lean();

    if (!order) return {}

    let intent = null;
    if (order.paymentIntent && order.paymentIntent.id) {
      intent = await stripeClient.paymentIntents.retrieve(
        order.paymentIntent.id,
        {
          expand: ["charges"], // Expanderar charges
        }
      );

      const chargeId = intent.latest_charge;
      if (typeof chargeId !== "string") {
        return json({ error: "Betalningen saknar Stripe-debitering" }, { status: 400 });
      }
      const charge = await stripeClient.charges.retrieve(chargeId);

      if (typeof charge.balance_transaction === "string") {
        const balanceTransaction =
          await stripeClient.balanceTransactions.retrieve(
            charge.balance_transaction
          );

        // Totalbelopp i SEK
        const totalAmount = Math.round(balanceTransaction.amount) / 100;
        const stripeFee = Math.round(balanceTransaction.fee) / 100;
        const netAmount = Math.round(balanceTransaction.net) / 100;

        // Beräkna momsbelopp baserat på bruttobeloppet
        const vatRate = 0.25; // 25% moms
        const vatAmount = Math.round(((totalAmount * vatRate) / (1 + vatRate)) * 100) / 100;
        const amountExVat = Math.round((totalAmount - vatAmount) * 100) / 100;

        await createVerification({
          domain: order.domain,
          idempotencyKey: `stripe:payment:${intent.id}`,
          verificationDate: new Date(charge.created * 1000),
          description: `Order id: ${order._id}\r\nPayment intent id: ${intent.id}`,
          metadata: [
            {
              key: "orderId",
              value: `${order._id}`
            },
            {
              key: "paymentIntentId",
              value: `${intent.id}`
            },
          ],
          journalEntries: [
            {
              account: 3001, // Försäljning exkl. moms
              credit: amountExVat,
            },
            {
              account: 2611, // Moms
              credit: vatAmount,
            },
            {
              account: 6570, // Stripe-avgifter
              debit: stripeFee,
            },
            {
              account: 1580, // Fordran på Stripe
              debit: netAmount,
            }
          ]
        });

        return {}

      }
    } else {
      if (order.manualOrderAt) {

        const vat = (order.totalSum * 0.2).toFixed(2)
        const exclVat = order.totalSum - Number(vat)

        await createVerification({
          domain: order.domain,
          idempotencyKey: `manual-order-accounting:${order._id}`,
          verificationDate: new Date(order.manualOrderAt),
          description: `Order id: ${order._id}`,
          metadata: [
            {
              key: "orderId",
              value: `${order._id}`
            }
          ],
          journalEntries: [
            {
              account: 3001, // Försäljning exkl. moms
              credit: exclVat.toFixed(2), // Belopp exklusive moms
            },
            {
              account: 2611, // Moms
              credit: vat, // Momsbelopp
            },
            {
              account: 1930, // Detta kanske måste ändras
              debit: order.totalSum.toFixed(2), // Momsbelopp
            }
          ]
        });
      }
    }

    return {};
  }

  const shippingValue = body.get("on");
  if (shippingValue === null) {
    return json({ error: "Leveransstatus saknas" }, { status: 400 });
  }

  const data = shippingValue === "true";
  const order: Order | null = await Orders.findOne({
    _id: params.id,
    domain: domain?.domain,
  }).lean();

  if (order) {
    await Orders.updateOne(
      {
        _id: params.id,
        domain: domain?.domain,
      },
      {
        status: data
          ? "SHIPPED"
          : order.manualOrderAt
          ? "MANUAL_PROCESSING"
          : "SUCCESS",
      }
    );

    if (data) {
      await sendOrderEmail(order, Template.SHIPPING);
    }
  }

  return {};
};

export default function OrderDetail() {
  let {
    order: {
      _id,
      customer: { firstname, lastname, email, postaddress, zipcode, city },
      totalSum,
      items,
      webhookAt,
      freightCost,
      status,
      discount,
      manualOrderAt,
    },
    intent,
    verification,
  } = useLoaderData<OrderDetailLoaderData>();
  const [on, setOn] = useState(status === "SHIPPED");
  const orderFetcher = useFetcher<{ error?: string }>();
  const navigate = useNavigate();
  const orderDate = webhookAt ?? manualOrderAt;
  const discountAmount = discount?.amount ?? 0;
  const productSubtotal = Math.max(0, totalSum - freightCost + discountAmount);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const statusInfo = getStatusInfo(status);
  const canManage =
    status === "SUCCESS" ||
    status === "SHIPPED" ||
    status === "MANUAL_PROCESSING";
  const pendingAction = orderFetcher.formData?.get("_action");
  const updatingShipment =
    orderFetcher.state !== "idle" && pendingAction === "shipping";
  const creatingVerification =
    orderFetcher.state !== "idle" && pendingAction === "verification";

  useEffect(() => {
    setOn(status === "SHIPPED");
  }, [status]);

  const closeDetail = () => {
    navigate("/admin/orders", { preventScrollReset: true });
  };

  const updateShipment = () => {
    const nextValue = !on;
    setOn(nextValue);
    orderFetcher.submit(
      { _action: "shipping", on: String(nextValue) },
      { method: "post" }
    );
  };

  return (
    <article className="order-detail">
      <header className="order-detail-header">
        <div className="order-detail-header__topline">
          <button className="order-detail-back" onClick={closeDetail} type="button">
            <span aria-hidden="true">←</span>
            Till orderlistan
          </button>
          <div className="order-detail-context">
            <span>Vald order</span>
            <p className={`order-detail-status tone-${statusInfo.tone}`}>
              {statusInfo.label}
            </p>
          </div>
        </div>
        <h2>
          {firstname} {lastname}
        </h2>
        <div className="order-detail-header__meta">
          <span>{formatDateTime(orderDate)}</span>
          <span>
            <code>#{_id.slice(-8).toLocaleUpperCase("sv-SE")}</code>
          </span>
        </div>
      </header>

      {canManage ? (
        <div className="order-detail-actions" aria-label="Orderåtgärder">
          <button
            aria-checked={on}
            className="order-detail-action"
            disabled={updatingShipment}
            onClick={updateShipment}
            role="switch"
            type="button"
          >
            <span className="order-detail-switch" aria-hidden="true" />
            {updatingShipment
              ? "Uppdaterar…"
              : on
              ? "Markerad som skickad"
              : "Markera som skickad"}
          </button>

          {verification ? (
            <span className="order-detail-action order-detail-action--complete">
              <span aria-hidden="true">✓</span>
              Bokförd som A{verification.verificationNumber}
            </span>
          ) : (
            <button
              className="order-detail-action order-detail-action--accounting"
              disabled={creatingVerification}
              onClick={() =>
                orderFetcher.submit(
                  { _action: "verification" },
                  { method: "post" }
                )
              }
              type="button"
            >
              <span aria-hidden="true">＋</span>
              {creatingVerification ? "Skapar verifikation…" : "Skapa verifikation"}
            </button>
          )}
        </div>
      ) : null}

      {intent?.last_payment_error?.message ? (
        <p className="order-detail-error">
          <strong>Betalningen gick inte igenom.</strong>{" "}
          {intent.last_payment_error.message}
        </p>
      ) : null}

      {orderFetcher.data?.error ? (
        <p className="order-detail-error" role="alert">
          {orderFetcher.data.error}
        </p>
      ) : null}

      <div className="order-detail-grid">
        <section className="order-detail-section" aria-labelledby="order-content-heading">
          <div className="order-detail-section__heading">
            <h3 id="order-content-heading">Innehåll</h3>
            <span>
              {itemCount} {itemCount === 1 ? "produkt" : "produkter"}
            </span>
          </div>

          <ol className="order-detail-items">
            {items.map((item, index) => (
              <li className="order-detail-item" key={item._id ?? `${item.itemRef}-${index}`}>
                {item.image ? (
                  <img
                    alt=""
                    className="order-detail-item__image"
                    loading="lazy"
                    src={item.image}
                  />
                ) : (
                  <span className="order-detail-item__image-placeholder" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                )}
                <div className="order-detail-item__copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.quantity} × {formatPrice(item.price)}
                  </small>
                  {item.additionalItems?.length ? (
                    <ul className="order-detail-additions">
                      {item.additionalItems.map((addition, additionIndex) => (
                        <li key={`${addition.name}-${additionIndex}`}>
                          <span>
                            {addition.name}
                            {addition.packinfo ? <em>{addition.packinfo}</em> : null}
                          </span>
                          <span>+{formatPrice(addition.price)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <span className="order-detail-item__price">
                  {formatPrice(item.price * item.quantity)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="order-detail-section">
          <div className="order-detail-customer">
            <h3>Kund &amp; leverans</h3>
            <address>
              <strong>
                {firstname} {lastname}
              </strong>
              {postaddress}
              <br />
              {zipcode} {city}
              <br />
              <a href={`mailto:${email}`}>{email}</a>
            </address>
          </div>

          <div className="order-detail-totals">
            <h3>Belopp</h3>
            <dl>
              <div>
                <dt>Produkter</dt>
                <dd>{formatPrice(productSubtotal)}</dd>
              </div>
              {discountAmount ? (
                <div>
                  <dt>{discount?.code ? `Rabatt · ${discount.code}` : "Rabatt"}</dt>
                  <dd>−{formatPrice(discountAmount)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Frakt</dt>
                <dd>{formatPrice(freightCost)}</dd>
              </div>
              <div className="order-detail-totals__total">
                <dt>Totalt</dt>
                <dd>{formatPrice(totalSum)}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      <p className="order-detail-footnote">
        {manualOrderAt
          ? "Manuellt registrerad order. Kontrollera leverans och verifikation innan ordern avslutas."
          : "Webborder. Orderbekräftelse och leveransbesked skickas till kundens e-postadress."}
      </p>
    </article>
  );
}
