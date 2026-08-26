import {
  ActionFunction,
  data as json,
  HeadersFunction,
  LoaderFunction,
  MetaFunction,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRevalidator,
} from "react-router";
import { Orders } from "../schemas/orders";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { auth } from "~/services/auth.server";
import stripeClient from "../stripeClient";
import { Order } from "~/types";
import { Verifications } from "~/schemas/verifications";
import { createVerification } from "~/services/verification.server";
import { toLoaderData } from "~/utils/loaderData";
import ArrowIcon from "~/components/ArrowIcon";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import ClientOnly from "~/components/ClientOnly";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  readTextWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import { orderDetailProjection } from "~/utils/queryProjections.server";
import SpecialOrderImageUpload from "~/components/admin/SpecialOrderImageUpload";
import {
  createDeliberateResend,
  deliverQueuedOrderEmail,
  getLatestOrderEmailDelivery,
  legacyShippingDeliveryView,
  retryFailedOrderEmail,
  type OrderEmailDelivery,
} from "~/services/email-delivery.server";
import {
  FinalSpecialOrderImageRequiredError,
  markOrderNotShipped,
  markOrderShippedAndEmail,
} from "~/services/order-shipping.server";
import { canManageOrderShipment } from "~/utils/orderShipping.shared";
import {
  canShareSpecialOrderInvitation,
  specialOrderPublicUrl,
} from "~/services/special-order.server";

type OrderDetailLoaderData = {
  order: Order;
  invitationDelivery: OrderEmailDelivery | null;
  shippingDelivery: OrderEmailDelivery | null;
  specialOrderUrl: string | null;
  verification: { verificationNumber: number } | null;
};

const orderStatusMeta = {
  DRAFT: { label: "Utkast", tone: "manual" },
  AWAITING_CUSTOMER: { label: "Inväntar kund", tone: "review" },
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

function OrderItemMedia({ image, index }: { image?: string; index: number }) {
  const [failed, setFailed] = useState(false);

  if (!image || failed) {
    return (
      <span className="order-detail-item__image-placeholder" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
    );
  }

  return (
    <img
      alt=""
      className="order-detail-item__image"
      loading="lazy"
      onError={() => setFailed(true)}
      src={image}
    />
  );
}

const writeClipboardText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy was rejected");
};

export const headers: HeadersFunction = () => ({
  "Cache-Control": "private, no-store",
});

export let loader: LoaderFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  const orderId = String(params.id ?? "");
  const [order, storedInvitationDelivery, storedShippingDelivery, verification] =
    await Promise.all([
      Orders.findOne({ _id: orderId })
        .select(orderDetailProjection)
        .lean()
        .exec() as unknown as Promise<Order | null>,
      getLatestOrderEmailDelivery(orderId, "SPECIAL_ORDER_INVITATION"),
      getLatestOrderEmailDelivery(orderId, "SHIPPING"),
      Verifications.findOne({
        "metadata.key": "orderId",
        "metadata.value": orderId,
      })
        .select("verificationNumber")
        .lean() as unknown as Promise<{ verificationNumber: number } | null>,
    ]);

  if (!order) throw new Response("Order not found", { status: 404 });

  const invitationDelivery =
    order.kind === "SPECIAL" ? storedInvitationDelivery : null;
  const shippingDelivery =
    storedShippingDelivery ?? legacyShippingDeliveryView(order);
  const specialOrderUrl = canShareSpecialOrderInvitation(order)
    ? specialOrderPublicUrl(order)
    : null;

  return json({
    order: toLoaderData(order),
    invitationDelivery: toLoaderData(invitationDelivery),
    shippingDelivery: toLoaderData(shippingDelivery),
    specialOrderUrl,
    verification: toLoaderData(verification),
  });
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

  let bodyText: string;
  try {
    bodyText = await readTextWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Formuläret är för stort" }, { status: 413 });
    }
    throw error;
  }
  const body = new URLSearchParams(bodyText);
  const type = body.get("_action") || "";

  if (type === "verification") {
    const order = await Orders.findOne({
      _id: params.id,
    }).lean<Order>();

    if (!order) return {}

    if (order.paymentIntent && order.paymentIntent.id) {
      const intent = await stripeClient.paymentIntents.retrieve(
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

  if (
    type === "process-email" ||
    type === "retry-email" ||
    type === "resend-email"
  ) {
    const kind = body.get("kind") === "invitation"
      ? "SPECIAL_ORDER_INVITATION"
      : "SHIPPING";
    const order = await Orders.findById(params.id).lean<Order>();
    if (!order) return json({ error: "Ordern hittades inte" }, { status: 404 });
    const delivery = await getLatestOrderEmailDelivery(String(order._id), kind);
    if (!delivery) {
      return json({ error: "Mejlleveransen hittades inte" }, { status: 404 });
    }
    if (type === "process-email") {
      if (delivery.status !== "PENDING") {
        return json({ error: "Utskicket väntar inte längre i kön" }, { status: 409 });
      }
      await deliverQueuedOrderEmail(String(delivery._id));
    } else if (type === "retry-email") {
      if (delivery.status !== "FAILED") {
        return json({ error: "Endast misslyckade utskick kan provas igen direkt" }, { status: 409 });
      }
      await retryFailedOrderEmail(String(delivery._id));
    } else {
      if (delivery.status !== "UNKNOWN") {
        return json({ error: "Ett nytt utskick kräver okänd leveransstatus" }, { status: 409 });
      }
      await createDeliberateResend({
        kind,
        orderId: String(order._id),
        previousAttempt: delivery.attempt,
        recipient: order.customer.email,
      });
    }
    return json({ ok: true });
  }

  const shippingValue = body.get("on");
  if (shippingValue === null) {
    return json({ error: "Leveransstatus saknas" }, { status: 400 });
  }

  try {
    if (shippingValue === "true") {
      const result = await markOrderShippedAndEmail(String(params.id));
      if (!result) return json({ error: "Ordern hittades inte" }, { status: 404 });
    } else {
      const result = await markOrderNotShipped(String(params.id));
      if (!result) return json({ error: "Ordern hittades inte" }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof FinalSpecialOrderImageRequiredError) {
      return json({ error: error.message }, { status: 409 });
    }
    console.error("Shipment status update failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      orderId: String(params.id),
    });
    return json(
      {
        error:
          "Leveransen kunde inte uppdateras klart. Kontrollera order- och mejlstatus innan du försöker igen.",
      },
      { status: 500 }
    );
  }

  return {};
};

export default function OrderDetail() {
  const data = useLoaderData<OrderDetailLoaderData>();
  return <OrderDetailContent key={String(data.order._id)} data={data} />;
}

function OrderDetailContent({ data }: { data: OrderDetailLoaderData }) {
  let {
    order: {
      _id,
      customer: { firstname, lastname, email, postaddress, zipcode, city },
      totalSum,
      items,
      webhookAt,
      createdAt,
      freightCost,
      status,
      discount,
      manualOrderAt,
      kind,
    },
    invitationDelivery,
    shippingDelivery,
    specialOrderUrl,
    verification,
  } = data;
  const orderFetcher = useFetcher<{ error?: string }>();
  const paymentErrorFetcher = useFetcher<{ message?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const swipeStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const orderDate = webhookAt ?? manualOrderAt ?? createdAt;
  const discountAmount = discount?.amount ?? 0;
  const productSubtotal = Math.max(0, totalSum - freightCost + discountAmount);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const statusInfo = getStatusInfo(status);
  const storedFinalImage = items[0]?.finalImage ?? "";
  const [uploadedFinalImage, setUploadedFinalImage] = useState("");
  const [invitationActionMessage, setInvitationActionMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const finalImage = uploadedFinalImage || storedFinalImage;
  const canManageShipment = canManageOrderShipment({ kind, status });
  const pendingAction = orderFetcher.formData?.get("_action");
  const updatingShipment =
    orderFetcher.state !== "idle" && pendingAction === "shipping";
  const creatingVerification =
    orderFetcher.state !== "idle" && pendingAction === "verification";
  const loadPaymentError = paymentErrorFetcher.load;

  useEffect(() => {
    if (
      status !== "FAILED" ||
      paymentErrorFetcher.data !== undefined ||
      paymentErrorFetcher.state !== "idle"
    ) {
      return;
    }
    void loadPaymentError(`/admin/orders/${_id}/payment-error`);
  }, [
    _id,
    loadPaymentError,
    paymentErrorFetcher.data,
    paymentErrorFetcher.state,
    status,
  ]);

  const requestedReturnTo = (location.state as { returnTo?: unknown } | null)
    ?.returnTo;
  const returnTo =
    typeof requestedReturnTo === "string" &&
    /^\/admin\/verifications(?:[/?#]|$)/.test(requestedReturnTo)
      ? requestedReturnTo
      : null;

  const closeDetail = useCallback(() => {
    navigate(returnTo || "/admin/orders", {
      preventScrollReset: true,
      replace: Boolean(returnTo),
    });
  }, [navigate, returnTo]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        !window.matchMedia("(min-width: 960px)").matches
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement)
      ) {
        return;
      }

      closeDetail();
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeDetail]);

  const beginSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      !event.isPrimary ||
      !window.matchMedia("(max-width: 959px)").matches
    ) {
      return;
    }

    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishSwipe = (event: ReactPointerEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;

    const horizontalDistance = event.clientX - start.x;
    const verticalDistance = event.clientY - start.y;
    if (
      horizontalDistance <= -72 &&
      Math.abs(horizontalDistance) > Math.abs(verticalDistance) * 1.25
    ) {
      closeDetail();
    }
  };

  const updateShipment = () => {
    orderFetcher.submit(
      { _action: "shipping", on: String(status !== "SHIPPED") },
      { method: "post" }
    );
  };

  const copyInvitationLink = async () => {
    if (!specialOrderUrl) return;
    try {
      await writeClipboardText(specialOrderUrl);
      setInvitationActionMessage({
        kind: "success",
        text: "Betalningslänken är kopierad.",
      });
    } catch {
      setInvitationActionMessage({
        kind: "error",
        text: "Länken kunde inte kopieras. Försök igen.",
      });
    }
  };

  const shareInvitationLink = async () => {
    if (!specialOrderUrl || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: "Privat beställning · Moa Clay Co",
        text: "Här är den privata betalningslänken för din beställning.",
        url: specialOrderUrl,
      });
      setInvitationActionMessage({
        kind: "success",
        text: "Betalningslänken är delad.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setInvitationActionMessage({
        kind: "error",
        text: "Delningen kunde inte öppnas. Kopiera länken i stället.",
      });
    }
  };

  const deliveryCopy = (delivery: OrderEmailDelivery | null) => {
    if (!delivery) return "Inte skickat";
    if (delivery.status === "PENDING") return "Väntar på utskick";
    if (delivery.status === "SENDING") return "Skickas nu";
    if (delivery.status === "SENT") return "Mejl levererat till mejlservern";
    if (delivery.status === "FAILED") return "Mejlet misslyckades";
    return "Leveransstatus okänd — kontrollera innan nytt mejl";
  };

  return (
    <article
      className="order-detail"
      onPointerCancel={() => {
        swipeStartRef.current = null;
      }}
      onPointerDown={beginSwipe}
      onPointerUp={finishSwipe}
    >
      <header className="order-detail-header">
        <div className="order-detail-header__topline">
          <button
            className="order-detail-back"
            onClick={closeDetail}
            type="button"
          >
            <span aria-hidden="true">
              <ArrowIcon direction="left" />
            </span>
            Tillbaka
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

      {status === "DRAFT" && kind === "SPECIAL" ? (
        <div className="order-detail-actions" aria-label="Orderåtgärder">
          <button
            className="order-detail-action order-detail-action--special"
            onClick={() => navigate(`/admin/special-orders/${_id}`)}
            type="button"
          >
            Fortsätt redigera specialbeställningen
            <ArrowIcon direction="up-right" />
          </button>
        </div>
      ) : null}

      {kind === "SPECIAL" && ["SUCCESS", "PAID_REVIEW", "MANUAL_PROCESSING"].includes(String(status)) ? (
        <section className="order-detail-final-image" aria-label="Foto av färdig specialbeställning">
          {finalImage ? (
            <img alt={`Färdig ${items[0].name}`} key={finalImage} src={finalImage} />
          ) : (
            <div aria-hidden="true"><span>Foto saknas</span></div>
          )}
          <div>
            <span>Före leverans</span>
            <strong>Fotografera det färdiga exemplaret</strong>
            <p>Fotot följer med leveransmejlet och måste finnas innan ordern markeras skickad.</p>
            <SpecialOrderImageUpload
              currentImage={finalImage}
              label="Ladda upp slutfoto"
              onComplete={(url) => {
                setUploadedFinalImage(url);
                void revalidator.revalidate();
              }}
              orderId={String(_id)}
              purpose="final"
            />
          </div>
        </section>
      ) : null}

      {canManageShipment ? (
        <div className="order-detail-actions" aria-label="Orderåtgärder">
          <button
            aria-checked={status === "SHIPPED"}
            className="order-detail-action"
            disabled={updatingShipment}
            onClick={updateShipment}
            role="switch"
            type="button"
          >
            <span className="order-detail-switch" aria-hidden="true" />
            {updatingShipment
              ? "Uppdaterar…"
              : status === "SHIPPED"
              ? "Markerad som skickad"
              : "Markera skickad och mejla kund"}
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
              <span aria-hidden="true"><PlusMinusIcon /></span>
              {creatingVerification ? "Skapar verifikation…" : "Skapa verifikation"}
            </button>
          )}
        </div>
      ) : null}

      {invitationDelivery || specialOrderUrl || shippingDelivery ? (
        <section
          className="order-detail-deliveries"
          aria-label="Betalningslänk och mejlleveranser"
        >
          {invitationDelivery || specialOrderUrl ? (
            <div>
              <span>Privat betalningslänk</span>
              <strong>{deliveryCopy(invitationDelivery)}</strong>
              {specialOrderUrl ? (
                <>
                  <div className="order-detail-delivery-actions">
                    <button
                      aria-label="Kopiera betalningslänk"
                      onClick={() => void copyInvitationLink()}
                      type="button"
                    >
                      Kopiera länk
                    </button>
                    <ClientOnly>
                      {() => {
                        const shareData = {
                          title: "Privat beställning · Moa Clay Co",
                          text: "Här är den privata betalningslänken för din beställning.",
                          url: specialOrderUrl,
                        };
                        const canShare =
                          typeof navigator.share === "function" &&
                          (typeof navigator.canShare !== "function" ||
                            navigator.canShare(shareData));
                        return canShare ? (
                          <button
                            aria-label="Dela betalningslänk"
                            onClick={() => void shareInvitationLink()}
                            type="button"
                          >
                            Dela
                            <ArrowIcon direction="up-right" />
                          </button>
                        ) : null;
                      }}
                    </ClientOnly>
                  </div>
                  {invitationActionMessage ? (
                    <small
                      className={`order-detail-delivery-feedback is-${invitationActionMessage.kind}`}
                      role="status"
                    >
                      {invitationActionMessage.text}
                    </small>
                  ) : null}
                </>
              ) : null}
              {invitationDelivery &&
              ["FAILED", "PENDING", "UNKNOWN"].includes(invitationDelivery.status) ? (
                <button
                  disabled={orderFetcher.state !== "idle"}
                  onClick={() => orderFetcher.submit(
                    {
                      _action:
                        invitationDelivery.status === "PENDING"
                          ? "process-email"
                          : invitationDelivery.status === "FAILED"
                            ? "retry-email"
                            : "resend-email",
                      kind: "invitation",
                    },
                    { method: "post" }
                  )}
                  type="button"
                >
                  {invitationDelivery.status === "PENDING"
                    ? "Skicka nu"
                    : invitationDelivery.status === "FAILED"
                      ? "Försök igen"
                      : "Skicka ett nytt mejl"}
                </button>
              ) : null}
            </div>
          ) : null}
          {shippingDelivery ? (
            <div>
              <span>Leveransbesked</span>
              <strong>{deliveryCopy(shippingDelivery)}</strong>
              {["FAILED", "PENDING", "UNKNOWN"].includes(shippingDelivery.status) ? (
                <button
                  disabled={orderFetcher.state !== "idle"}
                  onClick={() => orderFetcher.submit(
                    {
                      _action:
                        shippingDelivery.status === "PENDING"
                          ? "process-email"
                          : shippingDelivery.status === "FAILED"
                            ? "retry-email"
                            : "resend-email",
                      kind: "shipping",
                    },
                    { method: "post" }
                  )}
                  type="button"
                >
                  {shippingDelivery.status === "PENDING"
                    ? "Skicka nu"
                    : shippingDelivery.status === "FAILED"
                      ? "Försök igen"
                      : "Skicka ett nytt mejl"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {status === "FAILED" ? (
        <p className="order-detail-error">
          <strong>Betalningen gick inte igenom.</strong>
          {paymentErrorFetcher.data?.message
            ? ` ${paymentErrorFetcher.data.message}`
            : null}
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
              <li className="order-detail-item" key={item._id ?? item.itemRef}>
                <OrderItemMedia
                  image={
                    kind === "SPECIAL"
                      ? (index === 0 ? finalImage : item.finalImage) || item.image
                      : item.image
                  }
                  index={index}
                  key={
                    (kind === "SPECIAL" && index === 0 ? finalImage : item.finalImage) ||
                    item.image ||
                    "missing-image"
                  }
                />
                <div className="order-detail-item__copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.quantity} × {formatPrice(item.price)}
                  </small>
                  {item.description ? <p className="order-detail-item__description">{item.description}</p> : null}
                  {item.additionalItems?.length ? (
                    <ul className="order-detail-additions">
                      {item.additionalItems.map((addition) => (
                        <li
                          key={
                            addition._id ??
                            `${addition.name}-${addition.packinfo}-${addition.price}`
                          }
                        >
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
