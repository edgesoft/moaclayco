import { data as json, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { z } from "zod";
import { distinctAddressLine2 } from "~/utils/customerAddress";
import ArrowIcon from "~/components/ArrowIcon";
import SpecialOrderAddressAutocomplete from "~/components/SpecialOrderAddressAutocomplete";
import Terms from "~/components/terms";
import { theme } from "~/components/Theme";
import { Orders } from "~/schemas/orders";
import {
  buildCheckoutPaymentIntent,
} from "~/services/checkout-payment.server";
import { orderCookie } from "~/services/order-cookie.server";
import { googleMapsBrowserApiKey } from "~/services/google-maps.server";
import {
  hashSpecialOrderAccessToken,
  readSpecialOrderAccessToken,
  resolveSpecialOrderPublicLinkState,
} from "~/services/special-order.server";
import specialOrderStyles from "~/styles/special-order.css?url";
import stripeClient from "~/stripeClient";
import type { Order } from "~/types";
import { toLoaderData } from "~/utils/loaderData";
import { useState } from "react";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

export const links: LinksFunction = () => [
  { href: specialOrderStyles, rel: "stylesheet" },
];

export const headers: HeadersFunction = () => ({
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Robots-Tag": "noindex, nofollow",
});

export const meta: MetaFunction = () => [
  { title: `Din specialbeställning — ${theme.longName}` },
  {
    name: "description",
    content: "Granska och betala din privata specialbeställning.",
  },
  { name: "robots", content: "noindex,nofollow" },
];

const addressSchema = z.object({
  addressLine2: z.string().trim().max(160).optional().transform((value) => value || ""),
  city: z.string().trim().min(1, "Fyll i ort").max(100),
  phone: z.string().trim().max(40).optional().transform((value) => value || ""),
  postaddress: z.string().trim().min(1, "Fyll i gatuadress").max(200),
  terms: z.literal("on", { error: "Godkänn villkoren för att fortsätta" }),
  zipcode: z.string().trim().min(1, "Fyll i postnummer").max(20),
});

const readPublicOrder = async (token: string) => {
  const access = readSpecialOrderAccessToken(token);
  if (!access) return null;
  const order = (await Orders.findOne({
    _id: access.orderId,
    kind: "SPECIAL",
  }).lean()) as Order | null;
  if (!order) return null;
  return {
    access,
    linkState: resolveSpecialOrderPublicLinkState(order, token),
    order,
    tokenHash: hashSpecialOrderAccessToken(token),
  };
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = String(params.token ?? "");
  const result = await readPublicOrder(token);
  if (!result || result.linkState === "INVALID") {
    throw new Response("Länken är inte giltig", { status: 404 });
  }
  if (!["ACTIVE", "COMPLETE"].includes(result.linkState)) {
    return json({ googleMapsApiKey: "", linkState: result.linkState, order: null });
  }
  const { order } = result;
  return json(
    toLoaderData({
      googleMapsApiKey: googleMapsBrowserApiKey(),
      linkState: result.linkState,
      order: {
        _id: order._id,
        customer: order.customer,
        freightCost: order.freightCost,
        items: order.items,
        specialOrder: order.specialOrder,
        status: order.status,
        totalSum: order.totalSum,
      },
    })
  );
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const token = String(params.token ?? "");
  const result = await readPublicOrder(token);
  if (!result || result.linkState === "INVALID") {
    return json({ errors: { form: "Länken är inte giltig." } }, { status: 404 });
  }
  if (result.linkState !== "ACTIVE") {
    const messages = {
      COMPLETE: "Beställningen är redan betald.",
      EXPIRED: "Länken har gått ut. Kontakta Moa för en ny.",
      REPLACED: "Länken har ersatts. Använd den senaste länken du fått.",
      REVOKED: "Länken har stängts och går inte längre att använda.",
      UNAVAILABLE: "Beställningen går inte längre att betala.",
    } as const;
    return json(
      { errors: { form: messages[result.linkState] } },
      { status: result.linkState === "EXPIRED" ? 410 : 409 }
    );
  }
  const { access, order, tokenHash } = result;

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ errors: { form: "Uppgifterna är för stora." } }, { status: 413 });
    }
    throw error;
  }
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return json(
      {
        errors: parsed.error.issues.reduce<Record<string, string>>(
          (errors, issue) => {
            errors[String(issue.path[0] ?? "form")] = issue.message;
            return errors;
          },
          {}
        ),
      },
      { status: 400 }
    );
  }

  const now = new Date();
  const addressUpdate = await Orders.updateOne(
    {
      _id: order._id,
      kind: "SPECIAL",
      "specialOrder.accessVersion": access.version,
      "specialOrder.publicTokenHash": tokenHash,
      status: { $in: ["AWAITING_CUSTOMER", "OPENED", "PENDING", "FAILED"] },
    },
    {
      $set: {
        "customer.addressLine2": distinctAddressLine2(
          parsed.data.postaddress,
          parsed.data.addressLine2
        ),
        "customer.city": parsed.data.city,
        "customer.country": "Sverige",
        "customer.phone": parsed.data.phone,
        "customer.postaddress": parsed.data.postaddress,
        "customer.zipcode": parsed.data.zipcode,
        "specialOrder.addressConfirmedAt": now,
        "specialOrder.termsAcceptedAt": now,
        status: order.paymentIntent?.client_secret ? "PENDING" : "OPENED",
        updatedAt: now,
      },
    }
  );
  if (!addressUpdate.matchedCount) {
    return json(
      { errors: { form: "Länken ändrades medan sidan var öppen. Ladda om sidan." } },
      { status: 409 }
    );
  }

  const currentOrder = (await Orders.findOne({
    _id: order._id,
    kind: "SPECIAL",
    "specialOrder.accessVersion": access.version,
    "specialOrder.publicTokenHash": tokenHash,
    status: { $in: ["OPENED", "PENDING", "FAILED"] },
  }).lean()) as Order | null;
  if (!currentOrder) {
    return json(
      { errors: { form: "Länken ändrades medan sidan var öppen. Ladda om sidan." } },
      { status: 409 }
    );
  }

  if (!currentOrder.checkoutToken) {
    throw new Response("Betalningssessionen saknas", { status: 409 });
  }
  let clientSecret = currentOrder.paymentIntent?.client_secret;
  let paymentIntentId = currentOrder.paymentIntent?.id;
  if (!clientSecret || !paymentIntentId) {
    const paymentIntentRequest = buildCheckoutPaymentIntent({
      checkoutToken: currentOrder.checkoutToken,
      order: currentOrder,
      paymentMethods: theme.paymentMethods,
    });
    const paymentIntent = await stripeClient.paymentIntents.create(
      paymentIntentRequest.params,
      paymentIntentRequest.options
    );
    if (!paymentIntent.client_secret) {
      throw new Response("Betalningen kunde inte startas", { status: 502 });
    }
    clientSecret = paymentIntent.client_secret;
    paymentIntentId = paymentIntent.id;
    const updated = await Orders.updateOne(
      {
        _id: currentOrder._id,
        checkoutToken: currentOrder.checkoutToken,
        "paymentIntent.id": { $exists: false },
        "specialOrder.accessVersion": access.version,
        "specialOrder.publicTokenHash": tokenHash,
        status: "OPENED",
      },
      {
        $set: {
          paymentIntent: { client_secret: clientSecret, id: paymentIntentId },
          status: "PENDING",
          updatedAt: new Date(),
        },
      }
    );
    if (!updated.matchedCount) {
      const current = (await Orders.findById(currentOrder._id)
        .select("paymentIntent")
        .lean()) as Order | null;
      if (current?.paymentIntent?.id !== paymentIntentId) {
        try {
          await stripeClient.paymentIntents.cancel(paymentIntentId);
        } catch (error) {
          console.error("Unused special-order PaymentIntent could not be canceled", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            paymentIntentId,
          });
        }
        throw new Error("Special order payment intent could not be attached");
      }
    }
  }

  return redirect(`/checkout?order=${String(order._id)}`, {
    headers: {
      "Set-Cookie": await orderCookie.serialize(String(order._id)),
    },
  });
};

const money = (amount: number) =>
  new Intl.NumberFormat("sv-SE", {
    currency: "SEK",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(amount);

export default function SpecialOrderPage() {
  const { googleMapsApiKey, linkState, order } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ errors?: Record<string, string> }>();
  const navigation = useNavigation();
  const [showTerms, setShowTerms] = useState(false);
  const [postaddress, setPostaddress] = useState(order?.customer.postaddress ?? "");
  const [zipcode, setZipcode] = useState(order?.customer.zipcode ?? "");
  const [city, setCity] = useState(order?.customer.city ?? "");
  if (!order) {
    const stateCopy = {
      EXPIRED: {
        heading: "Länken har gått ut.",
        text: "Svara på mejlet eller kontakta Moa om du behöver en ny betalningslänk.",
      },
      REPLACED: {
        heading: "Länken har ersatts.",
        text: "Använd den senaste betalningslänken du har fått från Moa.",
      },
      REVOKED: {
        heading: "Länken är stängd.",
        text: "Beställningen går inte längre att betala via den här länken.",
      },
      UNAVAILABLE: {
        heading: "Beställningen är inte tillgänglig.",
        text: "Kontakta Moa om du behöver hjälp med beställningen.",
      },
    } as const;
    const copy = stateCopy[linkState as keyof typeof stateCopy];
    return (
      <main className="special-public-page">
        <section className="special-public-complete special-public-complete--expired">
          <span aria-hidden="true">○</span>
          <p>Privat beställning</p>
          <h1>{copy.heading}</h1>
          <p>{copy.text}</p>
          <a href={`mailto:${theme.email}`}>Kontakta ateljén</a>
        </section>
      </main>
    );
  }
  const item = order.items[0];
  const pending = navigation.state !== "idle";
  const expiresAt = new Date(order.specialOrder?.expiresAt ?? 0);
  const expiryIncludesTime = order.specialOrder?.expiryIncludesTime !== false;
  const formattedExpiry = new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Stockholm",
    ...(expiryIncludesTime
      ? { hour: "2-digit", hourCycle: "h23" as const, minute: "2-digit" }
      : {}),
  }).format(expiresAt);

  if (linkState === "COMPLETE") {
    return (
      <main className="special-public-page">
        <section className="special-public-complete">
          <span aria-hidden="true">✓</span>
          <p>Specialbeställning</p>
          <h1>Den är redan din.</h1>
          <p>Betalningen är registrerad. Du får ett mejl när beställningen lämnar ateljén.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="special-public-page">
      <div className="special-public-shell">
        {showTerms ? <Terms show={setShowTerms} /> : null}
        <header className="special-public-header">
          <div>
            <p>Privat beställning · framtagen för</p>
            <strong>{order.customer.firstname} {order.customer.lastname}</strong>
          </div>
          <span>Giltig till {formattedExpiry}</span>
        </header>

        <section className="special-public-hero">
          <div className="special-public-media">
            {item.image ? (
              <img alt={item.name} src={item.image} />
            ) : (
              <div>
                <i aria-hidden="true" />
                <p>Skapas för hand</p>
                <strong>Din form finns först i samtalet.</strong>
                <small>Ett foto läggs till när specialdesignen är färdig.</small>
              </div>
            )}
          </div>
          <div className="special-public-copy">
            <p className="special-public-kicker">Ett unikt exemplar</p>
            <h1>{item.name}</h1>
            <p className="special-public-description">{item.description}</p>
            {item.longDescription ? (
              <p className="special-public-long-description">{item.longDescription}</p>
            ) : null}
            <dl className="special-public-facts">
              <div><dt>Antal</dt><dd>{item.quantity} st · låst</dd></div>
              <div><dt>Pris</dt><dd>{money(item.price)} / st</dd></div>
              <div><dt>Frakt</dt><dd>{order.freightCost ? money(order.freightCost) : "Fri"}</dd></div>
              <div><dt>Totalt</dt><dd>{money(order.totalSum)}</dd></div>
            </dl>
          </div>
        </section>

        <form className="special-public-address" method="post">
          <div className="special-public-address__heading">
            <span>01</span>
            <div>
              <p className="special-public-kicker">Leverans</p>
              <h2>{order.customer.postaddress ? "Bekräfta din adress" : "Vart ska den skickas?"}</h2>
              <p>Kontrollera adressen. Därefter väljer du betalsätt säkert hos Stripe.</p>
            </div>
          </div>
          <div className="special-public-address__fields">
            <SpecialOrderAddressAutocomplete
              apiKey={googleMapsApiKey}
              className="special-public-field--wide"
              error={actionData?.errors?.postaddress}
              label="Gatuadress"
              onAddressSelect={(address) => {
                setPostaddress(address.postaddress);
                if (address.zipcode) setZipcode(address.zipcode);
                if (address.city) setCity(address.city);
              }}
              onChange={setPostaddress}
              placeholder="Gatuadress och nummer"
              required
              value={postaddress}
            />
            <label>
              <span>Adressrad 2 <em>valfritt</em></span>
              <input
                autoComplete="address-line2"
                defaultValue={order.customer.addressLine2}
                name="addressLine2"
                placeholder="C/o eller lägenhet"
              />
            </label>
            <label>
              <span>Postnummer</span>
              <input autoComplete="postal-code" inputMode="numeric" name="zipcode" onChange={(event) => setZipcode(event.target.value)} placeholder="123 45" required value={zipcode} />
              {actionData?.errors?.zipcode ? <small>{actionData.errors.zipcode}</small> : null}
            </label>
            <label>
              <span>Ort</span>
              <input autoComplete="address-level2" name="city" onChange={(event) => setCity(event.target.value)} placeholder="Ort" required value={city} />
              {actionData?.errors?.city ? <small>{actionData.errors.city}</small> : null}
            </label>
            <label>
              <span>Telefon <em>valfritt</em></span>
              <input autoComplete="tel" defaultValue={order.customer.phone} inputMode="tel" name="phone" placeholder="För leveransen" />
            </label>
          </div>

          <label className="special-public-consent">
            <input name="terms" type="checkbox" />
            <span aria-hidden="true" />
            <span>
              Jag har kontrollerat beskrivning, antal och totalsumma och godkänner{" "}
              <button onClick={() => setShowTerms(true)} type="button">villkoren</button>.
            </span>
          </label>
          {actionData?.errors?.terms ? <small className="special-public-form-error">{actionData.errors.terms}</small> : null}
          {actionData?.errors?.form ? <p className="special-public-form-error" role="alert">{actionData.errors.form}</p> : null}

          <button className="special-public-continue" disabled={pending} type="submit">
            <span>{pending ? "Förbereder säker betalning…" : "Fortsätt till betalning"}</span>
            <ArrowIcon direction="up-right" />
          </button>
          <p className="special-public-assurance">Säker betalning med Stripe · inga kortuppgifter sparas hos Moa Clay Co</p>
        </form>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="special-public-page">
      <section className="special-public-complete special-public-complete--expired">
        <span aria-hidden="true">○</span>
        <p>Privat beställning</p>
        <h1>Länken går inte att använda.</h1>
        <p>Den kan ha gått ut eller ersatts. Svara på mejlet så hjälper Moa dig vidare.</p>
        <a href={`mailto:${theme.email}`}>Kontakta ateljén</a>
      </section>
    </main>
  );
}
