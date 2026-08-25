import { useState } from "react";
import type { Order } from "~/types";

type OrderSummaryProps = {
  discount?: {
    amount?: number;
    code?: string;
    percentage?: number;
  };
  freightCost: number;
  heading?: string;
  items: Order["items"];
  totalSum: number;
};

const sekFormatter = new Intl.NumberFormat("sv-SE", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const formatSek = (amount: number) => `${sekFormatter.format(amount)} SEK`;

function OrderItemMedia({
  image,
  special,
}: {
  image?: string;
  special?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return image && !failed ? (
    <img alt="" onError={() => setFailed(true)} src={image} />
  ) : (
    <span
      aria-hidden="true"
      className={special ? "mcc-special-piece-placeholder" : undefined}
    >
      {special ? <><i /> <small>Unik</small></> : "M"}
    </span>
  );
}

export default function OrderSummary({
  discount,
  freightCost,
  heading = "Din beställning",
  items,
  totalSum,
}: OrderSummaryProps) {
  const discountAmount = discount?.amount ?? 0;
  const merchandiseTotal = totalSum - freightCost + discountAmount;
  const totalItems = items.reduce(
    (sum, item) => sum + (item.quantity ?? 0),
    0
  );

  return (
    <section
      aria-labelledby="purchase-summary-heading"
      className="mcc-purchase-summary"
    >
      <div className="mcc-purchase-section-heading">
        <h2 id="purchase-summary-heading">{heading}</h2>
        <span>
          {totalItems} {totalItems === 1 ? "vara" : "varor"}
        </span>
      </div>

      <div className="mcc-purchase-items">
        {items.map((item) => {
          const additionsTotal = (item.additionalItems ?? []).reduce(
            (sum, addition) => sum + Number(addition.price),
            0
          );
          const lineTotal =
            Number(item.price) * Number(item.quantity) + additionsTotal;

          return (
            <article className="mcc-purchase-item" key={item._id ?? item.itemRef}>
              <div className="mcc-purchase-item__media">
                <OrderItemMedia
                  image={item.finalImage || item.image}
                  key={item.finalImage || item.image || "missing-image"}
                  special={item.inventoryMode === "UNTRACKED"}
                />
              </div>
              <div className="mcc-purchase-item__copy">
                <h3>{item.name}</h3>
                <p>
                  {item.quantity} × {formatSek(Number(item.price))}
                </p>
                {(item.additionalItems ?? []).length > 0 ? (
                  <ul>
                    {item.additionalItems.map((addition) => (
                      <li
                        key={
                          addition._id ??
                          `${addition.name}-${addition.packinfo}-${addition.price}`
                        }
                      >
                        + {addition.name} · {formatSek(Number(addition.price))}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <strong>{formatSek(lineTotal)}</strong>
            </article>
          );
        })}
      </div>

      <dl className="mcc-purchase-totals">
        <div>
          <dt>Varor</dt>
          <dd>{formatSek(merchandiseTotal)}</dd>
        </div>
        <div>
          <dt>Frakt</dt>
          <dd>{freightCost === 0 ? "Fri" : formatSek(freightCost)}</dd>
        </div>
        {discountAmount > 0 ? (
          <div className="mcc-purchase-totals__discount">
            <dt>Rabatt</dt>
            <dd>− {formatSek(discountAmount)}</dd>
          </div>
        ) : null}
        <div className="mcc-purchase-totals__total">
          <dt>Totalt</dt>
          <dd>{formatSek(totalSum)}</dd>
        </div>
      </dl>
    </section>
  );
}
