import { MetaFunction, LoaderFunction } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import stripeClient from "../stripeClient";
import {
  loadStripe,
  Stripe,
  StripeElementLocale,
  StripePaymentElement,
} from "@stripe/stripe-js";
import { Orders } from "~/schemas/orders";
import { useEffect, useRef, useState } from "react";
import { classNames } from "~/utils/classnames";
import Loader from "../components/loader";
import Terms from "../components/terms";
import { Order } from "../types";
import Feedback from "../components/feedback";

declare global {
  interface Window {
    ENV: any;
  }
}

let stripePromise: Stripe | PromiseLike<Stripe | null> | null = null;
if (typeof window !== "undefined") {
  stripePromise = loadStripe(window ? window.ENV.STRIPE_PUBLIC_KEY : "");
}

export let loader: LoaderFunction = async ({ request }) => {
  let url = new URL(await request.url);
  let body = new URLSearchParams(url.search);
  const order: Order | null = await Orders.findOne({ _id: body.get("order") });

  if (!order) {
    throw new Error("Order not found");
  }

  if (order && order.paymentIntent?.id) {
    const paymentIntent = await stripeClient.paymentIntents.update(
      order.paymentIntent.id,
      {
        amount: order.totalSum * 100,
        currency: "sek",
        payment_method_types: ["swish", "klarna", "card"],
      }
    );
    return { clientSecret: paymentIntent.client_secret };
  }

  const paymentIntent = await stripeClient.paymentIntents.create({
    amount: order.totalSum * 100,
    currency: "sek",
    payment_method_types: ["swish", "klarna", "card"],
  });

  await Orders.updateOne(
    { _id: order._id },
    {
      paymentIntent: {
        id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
      },
    }
  );

  return { clientSecret: paymentIntent.client_secret };
};

export let meta: MetaFunction = () => {
  return [
    {
      title: "Moa Clay Collection",
    },
    {
      name: "description",
      content: "Moa Clay Collection",
    },
  ];
};

interface Props {
  setShow: (show: boolean) => void;
}

type ClientType = {
  clientSecret?: string;
};

export default function Index() {
  let data: ClientType = useLoaderData();
  let transition = useNavigation();
  const [show, setShow] = useState(false);
  const locale: StripeElementLocale = "sv";

  const options = {
    clientSecret: data.clientSecret,
    locale,
  };

  const CheckoutForm = ({ setShow }: Props) => {
    const stripe = useStripe();
    const elements = useElements();
    const termsRef: React.RefObject<HTMLInputElement> = useRef(null);
    const [error, showError] = useState<string | undefined>(undefined);
    const [showTerm, setShowTerm] = useState<boolean>(false);

    useEffect(() => {
      if (error) {
        setTimeout(() => {
          showError(undefined);
        }, 2000);
      }
    }, [error]);

    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault();

      if (!stripe || !elements) {
        return;
      }
      const agreeTerms = termsRef.current && termsRef.current.checked;
      if (agreeTerms) {
        const result = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${location.protocol}//${location.host}/order`,
          },
        });

        if (result.error) {
          showError(result.error.message);
        }
      } else {
        showError("Du måste godkänna villkoren");
      }
    };

    return (
      <form onSubmit={handleSubmit}>
        {showTerm ? <Terms show={setShowTerm} /> : null}
        <PaymentElement
          onReady={(e: StripePaymentElement) => {
            setShow(true);
          }}
        />
        <div className="flex mt-3">
          <input
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            ref={termsRef}
            type="checkbox"
          />{" "}
          <span
            className="-mt-2 px-1 py-1 underline"
            onClick={() => {
              setShowTerm(true);
            }}
          >
            Jag godkänner villkoren
          </span>
        </div>
        <button
          disabled={!stripe}
          className="mt-2 p-2 text-gray-700 font-medium bg-rosa rounded"
        >
          Gå vidare till betalning
        </button>
        <Feedback
          headline="Fel i formulär"
          forceInvisble={!error}
          type="error"
          message={error}
        />
      </form>
    );
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <>
        <Loader forceSpinner={!show} transition={transition} />
        <section
          className={classNames(
            show && transition.state !== "loading"
              ? "mx-auto px-4 py-5 max-w-6xl sm:px-6 lg:px-4 visible"
              : "hidden"
          )}
        >
          <div className="grid gap-6 grid-cols-1 my-20 lg:grid-cols-2">
            <div className="flex flex-col w-full bg-gray-50 rounded-lg shadow-lg">
              <div className="p-2">
                <div className="mb-1 text-gray-700 text-xl">Betalning</div>
                <CheckoutForm setShow={setShow} />
              </div>
            </div>
          </div>
        </section>
      </>
    </Elements>
  );
}
