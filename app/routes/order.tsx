import {
  data as json,
  Link,
  LoaderFunctionArgs,
  MetaFunction,
  redirect,
  useLoaderData,
} from "react-router";
import mongoose from "mongoose";
import { useEffect } from "react";
import { useCart } from "react-use-cart";
import ArrowIcon from "~/components/ArrowIcon";
import OrderSummary from "~/components/cart/OrderSummary";
import { useTheme } from "~/components/Theme";
import { Orders } from "~/schemas/orders";
import { orderCookie } from "~/services/order-cookie.server";
import stripeClient from "~/stripeClient";
import { Order } from "~/types";
import { getDomain } from "~/utils/domain";
import { toLoaderData } from "~/utils/loaderData";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const paymentIntentId = url.searchParams.get("payment_intent") ?? "";
  const cookieOrderId = String(
    (await orderCookie.parse(request.headers.get("Cookie"))) ?? ""
  );
  const domain = getDomain(request);

  if (
    !domain ||
    !mongoose.Types.ObjectId.isValid(cookieOrderId) ||
    !paymentIntentId
  ) {
    return redirect("/");
  }

  const order = (await Orders.findOne({
    _id: cookieOrderId,
    domain: domain.domain,
    "paymentIntent.id": paymentIntentId,
  }).lean()) as Order | null;

  if (!order) return redirect("/");

  const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
  const paymentSucceeded = paymentIntent.status === "succeeded";
  const serializedOrder: Order = {
    ...order,
    _id: String(order._id),
    items: order.items.map((item) => ({
      ...item,
      _id: String(item._id ?? item.itemRef),
      itemRef: String(item.itemRef),
    })),
  };

  return json(
    toLoaderData({
      ...serializedOrder,
      redirect_status: paymentSucceeded ? "succeeded" : paymentIntent.status,
      testMode:
        process.env.STRIPE_PUBLIC_KEY?.startsWith("pk_test_") === true &&
        process.env.STRIPE_SRV?.startsWith("sk_test_") === true,
    }),
    {
      headers: paymentSucceeded
        ? { "Set-Cookie": await orderCookie.serialize("", { maxAge: 0 }) }
        : undefined,
    }
  );
};

export const meta: MetaFunction = () => [
  { title: "Orderbekräftelse — Moa Clay Collection" },
  { name: "description", content: "Status för din beställning hos Moa Clay Collection" },
];

export default function OrderPage() {
  const theme = useTheme();
  const data = useLoaderData<typeof loader>();
  const { emptyCart } = useCart();
  const succeeded = data.redirect_status === "succeeded";
  const shortOrderId = String(data._id).slice(-8).toUpperCase();

  useEffect(() => {
    if (succeeded) emptyCart();
  }, [succeeded, emptyCart]);

  return (
    <main className="mcc-purchase-page mcc-order-page">
      <div className="mcc-purchase-shell">
        <header className="mcc-purchase-hero mcc-order-hero">
          <Link className="mcc-purchase-back" to="/">
            <ArrowIcon direction="left" />
            Till kollektionerna
          </Link>

          <div className="mcc-purchase-hero__copy">
            <p className="mcc-purchase-kicker">
              {succeeded ? "Beställningen är mottagen" : "Betalningen avbröts"}
            </p>
            <h1>{succeeded ? "Tack." : "Inte riktigt klart."}</h1>
            <p>
              {succeeded
                ? "Vi packar din beställning omsorgsfullt och hör av oss när den är på väg."
                : "Inga pengar har dragits. Du kan gå tillbaka och försöka igen."}
            </p>
          </div>

          <ol aria-label="Steg i köpet" className="mcc-purchase-steps">
            <li>
              <span>01</span> Varukorg
            </li>
            <li aria-current={succeeded ? undefined : "step"}>
              <span>02</span> Betalning
            </li>
            <li aria-current={succeeded ? "step" : undefined}>
              <span>03</span> Klart
            </li>
          </ol>
        </header>

        {data.testMode ? (
          <p className="mcc-purchase-test-note">
            <span aria-hidden="true">○</span>
            Testorder — inga riktiga pengar har dragits
          </p>
        ) : null}

        <div className="mcc-order-layout">
          <section className="mcc-order-result">
            <div
              aria-hidden="true"
              className={`mcc-order-result__mark${succeeded ? " is-success" : ""}`}
            >
              {succeeded ? "✓" : "↩"}
            </div>
            <p className="mcc-order-result__label">Ordernummer</p>
            <p className="mcc-order-result__number">{shortOrderId}</p>

            {succeeded ? (
              <>
                <p className="mcc-order-result__message">
                  En bekräftelse skickas till <strong>{data.customer.email}</strong>.
                  Leveransen går till {data.customer.firstname} {data.customer.lastname}
                  {" på "}{data.customer.postaddress}, {data.customer.zipcode}{" "}
                  {data.customer.city}.
                </p>
                <div className="mcc-order-result__note">
                  <span aria-hidden="true">◇</span>
                  <p>
                    Har du frågor? Skriv till{" "}
                    <a href={`mailto:${theme?.email}`}>{theme?.email}</a> och ange
                    ordernummer {shortOrderId}.
                  </p>
                </div>
                <Link className="mcc-purchase-action" to="/">
                  Se kollektioner <ArrowIcon />
                </Link>
              </>
            ) : (
              <>
                <p className="mcc-order-result__message">
                  Betalningen fick status <strong>{data.redirect_status}</strong>.
                  Din varukorg finns kvar medan du försöker igen.
                </p>
                <Link
                  className="mcc-purchase-action"
                  to={`/checkout?order=${data._id}`}
                >
                  Försök betala igen <ArrowIcon />
                </Link>
              </>
            )}
          </section>

          <OrderSummary
            discount={data.discount}
            freightCost={data.freightCost}
            heading="Ordersammanfattning"
            items={data.items}
            totalSum={data.totalSum}
          />
        </div>
      </div>
    </main>
  );
}
