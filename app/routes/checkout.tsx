import { LoaderFunctionArgs, MetaFunction, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import {
  loadStripe,
  Stripe,
  StripeElementLocale,
  StripeElementsOptions,
  StripePaymentElement,
} from "@stripe/stripe-js";
import mongoose from "mongoose";
import { useEffect, useRef, useState } from "react";
import OrderSummary from "~/components/cart/OrderSummary";
import Terms from "~/components/terms";
import { themes } from "~/components/Theme";
import { Orders } from "~/schemas/orders";
import { orderCookie } from "~/services/order-cookie.server";
import { Order } from "~/types";
import { getDomain } from "~/utils/domain";

declare global {
  interface Window {
    ENV: { STRIPE_PUBLIC_KEY?: string };
  }
}

let stripePromise: Stripe | PromiseLike<Stripe | null> | null = null;
if (typeof window !== "undefined") {
  stripePromise = loadStripe(window.ENV?.STRIPE_PUBLIC_KEY ?? "");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const requestedOrderId = url.searchParams.get("order") ?? "";
  const cookieOrderId = String(
    (await orderCookie.parse(request.headers.get("Cookie"))) ?? ""
  );
  const domain = getDomain(request);

  if (!domain || !themes[domain.domain]) {
    throw new Response("Okänd butik", { status: 404 });
  }
  if (
    requestedOrderId !== cookieOrderId ||
    !mongoose.Types.ObjectId.isValid(requestedOrderId)
  ) {
    return redirect("/cart");
  }

  const order = (await Orders.findOne({
    _id: requestedOrderId,
    domain: domain.domain,
    status: { $in: ["OPENED", "PENDING"] },
  }).lean()) as Order | null;

  if (!order?.paymentIntent?.client_secret) {
    return redirect("/cart");
  }

  return {
    clientSecret: order.paymentIntent.client_secret,
    domain,
    order: {
      discount: order.discount,
      freightCost: order.freightCost,
      items: order.items.map((item) => ({
        _id: String(item._id ?? item.itemRef),
        additionalItems: item.additionalItems ?? [],
        image: item.image,
        itemRef: String(item.itemRef),
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
      totalSum: order.totalSum,
    },
    testMode:
      process.env.STRIPE_PUBLIC_KEY?.startsWith("pk_test_") === true &&
      process.env.STRIPE_SRV?.startsWith("sk_test_") === true,
  };
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const theme = themes[data?.domain.domain ?? "moaclayco"];
  return [
    { title: `Betalning — ${theme.longName}` },
    { name: "description", content: `Slutför din beställning hos ${theme.longName}` },
  ];
};

type CheckoutFormProps = {
  onReady: () => void;
};

function CheckoutForm({ onReady }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    if (!error) return;
    const handle = window.setTimeout(() => setError(undefined), 5000);
    return () => window.clearTimeout(handle);
  }, [error]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!stripe || !elements || isSubmitting) return;
    if (!termsRef.current?.checked) {
      setError("Du måste godkänna villkoren innan du går vidare.");
      termsRef.current?.focus();
      return;
    }

    setError(undefined);
    setIsSubmitting(true);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Kontrollera betalningsuppgifterna.");
      setIsSubmitting(false);

      if (
        submitError.code === "incomplete_number" ||
        submitError.code === "invalid_number"
      ) {
        window.requestAnimationFrame(() => paymentElementRef.current?.focus());
      }
      return;
    }

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${location.protocol}//${location.host}/order`,
      },
    });

    if (result.error) {
      setError(result.error.message ?? "Betalningen kunde inte startas.");
      setIsSubmitting(false);
    }
  };

  return (
    <form className="mcc-checkout-form" onSubmit={handleSubmit}>
      {showTerms ? <Terms show={setShowTerms} /> : null}

      <PaymentElement
        onReady={(element) => {
          paymentElementRef.current = element;
          onReady();
        }}
        options={{ layout: "tabs" }}
      />

      <div className="mcc-checkout-terms">
        <label>
          <input ref={termsRef} type="checkbox" />
          <span aria-hidden="true" className="mcc-checkout-checkbox" />
          <span>Jag godkänner</span>
        </label>
        <button onClick={() => setShowTerms(true)} type="button">
          villkoren
        </button>
      </div>

      {error ? (
        <p aria-live="polite" className="mcc-checkout-error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        aria-busy={isSubmitting}
        className="mcc-checkout-submit"
        disabled={!stripe || isSubmitting}
        type="submit"
      >
        {isSubmitting ? (
          <>
            <span aria-hidden="true" className="mcc-button-spinner" />
            Öppnar betalningen…
          </>
        ) : (
          <>
            Betala säkert
            <span aria-hidden="true">→</span>
          </>
        )}
      </button>
    </form>
  );
}

export default function CheckoutPage() {
  const data = useLoaderData<typeof loader>();
  const [paymentReady, setPaymentReady] = useState(false);
  const locale: StripeElementLocale = "sv";
  const options: StripeElementsOptions = {
    clientSecret: data.clientSecret,
    locale,
    appearance: {
      theme: "flat",
      variables: {
        borderRadius: "2px",
        colorBackground: "#fffdf9",
        colorDanger: "#a34d45",
        colorPrimary: "#9a5946",
        colorText: "#242321",
        colorTextSecondary: "#74706a",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSizeBase: "14px",
        spacingGridRow: "14px",
      },
      rules: {
        ".AccordionItem": {
          border: "1px solid rgba(74, 68, 61, 0.20)",
          boxShadow: "none",
        },
        ".Input": {
          backgroundColor: "transparent",
          border: "0",
          borderBottom: "1px solid #aaa39a",
          borderRadius: "0",
          boxShadow: "none",
          color: "#242321",
          fontSize: "14px",
          padding: "8px 1px",
        },
        ".Input:focus": {
          border: "0",
          borderBottom: "1px solid #b86e59",
          boxShadow: "none",
        },
        ".Input--invalid": {
          border: "0",
          borderBottom: "1px solid #b6534d",
          boxShadow: "none",
        },
        ".Input::placeholder": {
          color: "#b0aaa2",
        },
        ".Label": {
          color: "#6f6962",
          fontSize: "9px",
          fontWeight: "700",
          letterSpacing: "0.11em",
          textTransform: "uppercase",
        },
        ".Tab": {
          backgroundColor: "#fffdf9",
          border: "1px solid rgba(74, 68, 61, 0.20)",
          boxShadow: "none",
          color: "#74706a",
        },
        ".Tab:hover": {
          backgroundColor: "#fbf7f1",
          border: "1px solid rgba(184, 110, 89, 0.55)",
          color: "#965542",
        },
        ".Tab--selected": {
          backgroundColor: "#fbf7f1",
          border: "1px solid #b86e59",
          boxShadow: "inset 0 -3px 0 #b86e59",
          color: "#242321",
        },
        ".TabIcon": {
          color: "#7f7a73",
        },
        ".TabIcon--selected": {
          color: "#965542",
        },
        ".TabLabel--selected": {
          color: "#242321",
        },
      },
    },
  };

  return (
    <main className="mcc-purchase-page mcc-checkout-page">
      <div className="mcc-purchase-shell">
        <header className="mcc-purchase-hero">
          <Link className="mcc-purchase-back" to="/cart">
            <span aria-hidden="true">←</span>
            Tillbaka till varukorgen
          </Link>

          <div className="mcc-purchase-hero__copy">
            <p className="mcc-purchase-kicker">Sista steget</p>
            <h1>Betalning</h1>
            <p>Välj hur du vill betala. Dina uppgifter hanteras säkert av Stripe.</p>
          </div>

          <ol aria-label="Steg i köpet" className="mcc-purchase-steps">
            <li>
              <span>01</span> Varukorg
            </li>
            <li aria-current="step">
              <span>02</span> Betalning
            </li>
            <li>
              <span>03</span> Klart
            </li>
          </ol>
        </header>

        {data.testMode ? (
          <p className="mcc-purchase-test-note">
            <span aria-hidden="true">○</span>
            Testläge — inga riktiga pengar dras
          </p>
        ) : null}

        <div className="mcc-checkout-layout">
          <section
            aria-busy={!paymentReady}
            aria-labelledby="payment-method-heading"
            className="mcc-checkout-payment"
          >
            <div className="mcc-purchase-section-heading">
              <h2 id="payment-method-heading">Välj betalsätt</h2>
              <span>Säkert med Stripe</span>
            </div>

            <div
              className={`mcc-checkout-element${
                paymentReady ? " is-ready" : ""
              }`}
            >
              {!paymentReady ? (
                <div className="mcc-checkout-placeholder" role="status">
                  <span className="mcc-checkout-placeholder__line" />
                  <div>
                    <span />
                    <span />
                    <span />
                  </div>
                  <p>Läser in säkra betalsätt…</p>
                </div>
              ) : null}
              <div className="mcc-checkout-element__content">
                <Elements options={options} stripe={stripePromise}>
                  <CheckoutForm onReady={() => setPaymentReady(true)} />
                </Elements>
              </div>
            </div>

            <div className="mcc-checkout-assurance">
              <span aria-hidden="true">◇</span>
              <p>
                Betalningen krypteras. Moa Clay Co sparar aldrig dina kortuppgifter.
              </p>
            </div>
          </section>

          <OrderSummary {...data.order} />
        </div>
      </div>
    </main>
  );
}
