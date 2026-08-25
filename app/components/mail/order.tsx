import React, { CSSProperties } from "react";
import { Order, OrderItem } from "~/types";
import { distinctAddressLine2 } from "~/utils/customerAddress";
import { theme } from "../Theme";

export enum Template {
  ORDER,
  SHIPPING,
  SPECIAL_INVITATION,
}

export type TemplateType = {
  copyrightYear: number;
  order: Order;
  template: Template;
  actionUrl?: string;
};

const colors = {
  accent: "#B86E59",
  accentDark: "#8F513F",
  ink: "#1C1B19",
  line: "#DDD8CF",
  muted: "#706D67",
  paper: "#F3F1EC",
  softPaper: "#F8F3EE",
  surface: "#FFFEFA",
};

const serif =
  "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Baskerville, Georgia, 'Times New Roman', serif";
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const formatSek = (amount: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);

const formatSpecialOrderExpiry = (order: Order) => {
  const expiresAt = order.specialOrder?.expiresAt;
  if (!expiresAt) return "";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "";
  const expiryIncludesTime = order.specialOrder?.expiryIncludesTime !== false;
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Stockholm",
    year: "numeric",
    ...(expiryIncludesTime
      ? { hour: "2-digit", hourCycle: "h23" as const, minute: "2-digit" }
      : {}),
  }).format(date);
};

export const shortOrderNumber = (orderId: string | { toString(): string }) =>
  `#${String(orderId).slice(-8).toLocaleUpperCase("sv-SE")}`;

const customerName = (order: Order) =>
  [order.customer.firstname, order.customer.lastname].filter(Boolean).join(" ") ||
  "Kund";

const orderCopy = (template: Template) => {
  if (template === Template.ORDER) {
    return {
      eyebrow: "ORDERBEKRÄFTELSE",
      title: "Tack för din beställning.",
      intro:
        "Vi har tagit emot din order och börjar göra den redo så snart vi kan. Du får ett nytt mejl när paketet lämnar ateljén.",
      preheader:
        "Tack för din beställning. Här hittar du orderinnehåll, leveransadress och totalsumma.",
    };
  }
  if (template === Template.SPECIAL_INVITATION) {
    return {
      eyebrow: "DIN SPECIALBESTÄLLNING",
      title: "Skapad särskilt för dig.",
      intro:
        "Moa har förberett en specialbeställning. Kontrollera innehållet och leveransuppgifterna innan du går vidare till betalningen.",
      preheader:
        "Din specialbeställning är redo att granskas och betalas.",
    };
  }
  return {
    eyebrow: "PÅ VÄG TILL DIG",
    title: "Din beställning är på väg.",
    intro:
      "Nu är din order packad och har lämnat ateljén. Vi hoppas att den snart landar fint hos dig.",
    preheader:
      "Din beställning har lämnat ateljén och är nu på väg till dig.",
  };
};

export const getOrderEmailSubject = (order: Order, template: Template) => {
  const orderNumber = shortOrderNumber(order._id);

  if (template === Template.ORDER) {
    return `Orderbekräftelse ${orderNumber} · ${theme.title}`;
  }
  if (template === Template.SPECIAL_INVITATION) {
    return `Din specialbeställning ${orderNumber} · ${theme.title}`;
  }
  return `Din order ${orderNumber} är på väg · ${theme.title}`;
};

const itemTextLines = (item: OrderItem) => {
  const lines = [
    `- ${item.quantity} × ${item.name} — ${formatSek(
      item.price * item.quantity
    )}`,
  ];

  if (item.description) lines.push(`  ${item.description}`);
  if (!item.image && !item.finalImage) {
    lines.push("  Bild läggs till när specialdesignen är färdig.");
  }

  for (const addition of item.additionalItems ?? []) {
    const additionPrice = addition.price * item.quantity;
    const packInfo = addition.packinfo ? ` (${addition.packinfo})` : "";
    lines.push(
      `  + ${addition.name}${packInfo} — ${
        additionPrice ? formatSek(additionPrice) : "ingår"
      }`
    );
  }

  return lines;
};

export const getOrderEmailText = (
  order: Order,
  template: Template,
  actionUrl?: string
) => {
  const copy = orderCopy(template);
  const specialOrderExpiry = formatSpecialOrderExpiry(order);
  const discountAmount = order.discount?.amount ?? 0;
  const merchandiseTotal = Math.max(
    0,
    order.totalSum - order.freightCost + discountAmount
  );
  const addressLine2 = distinctAddressLine2(
    order.customer.postaddress,
    order.customer.addressLine2
  );
  const address = [
    order.customer.postaddress,
    addressLine2,
    `${order.customer.zipcode ?? ""} ${order.customer.city ?? ""}`.trim(),
  ].filter(Boolean);

  return [
    copy.eyebrow,
    copy.title,
    "",
    `Hej ${customerName(order)}!`,
    copy.intro,
    "",
    `Order ${shortOrderNumber(order._id)}`,
    "",
    "INNEHÅLL",
    ...order.items.flatMap(itemTextLines),
    "",
    `Produkter: ${formatSek(merchandiseTotal)}`,
    `Frakt: ${order.freightCost ? formatSek(order.freightCost) : "Fri"}`,
    ...(discountAmount
      ? [
          `Rabatt${order.discount?.code ? ` (${order.discount.code})` : ""}: −${formatSek(
            discountAmount
          )}`,
        ]
      : []),
    `Totalt: ${formatSek(order.totalSum)}`,
    ...(template === Template.SPECIAL_INVITATION && actionUrl
      ? [
          "",
          "GRANSKA OCH BETALA",
          ...(specialOrderExpiry
            ? [`Länken är giltig till ${specialOrderExpiry}.`]
            : []),
          actionUrl,
        ]
      : []),
    "",
    "LEVERANS TILL",
    customerName(order),
    ...(address.length ? address : ["Kompletteras innan betalning"]),
    "",
    `Har du frågor? Svara på det här mejlet eller kontakta ${theme.email}.`,
    "",
    `Varmt,`,
    theme.title,
  ].join("\n");
};

const tableReset: CSSProperties = {
  borderCollapse: "collapse",
  borderSpacing: 0,
};

const paragraphStyle: CSSProperties = {
  color: colors.muted,
  fontFamily: sans,
  fontSize: "15px",
  lineHeight: "160%",
  margin: 0,
};

const sectionLabelStyle: CSSProperties = {
  color: colors.accentDark,
  fontFamily: sans,
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "1.25px",
  lineHeight: "140%",
  margin: 0,
  textTransform: "uppercase",
};

const EmailOrderTemplate: React.FC<TemplateType> = ({
  actionUrl,
  copyrightYear,
  order,
  template,
}) => {
  const { _id, customer, items, freightCost, discount, totalSum } = order;
  const addressLine2 = distinctAddressLine2(
    customer.postaddress,
    customer.addressLine2
  );
  const copy = orderCopy(template);
  const name = customerName(order);
  const specialOrderExpiry = formatSpecialOrderExpiry(order);
  const discountAmount = discount?.amount ?? 0;
  const merchandiseTotal = Math.max(
    0,
    totalSum - freightCost + discountAmount
  );

  return (
    <html lang="sv">
      <head>
        <meta httpEquiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{getOrderEmailSubject(order, template)}</title>
        <style type="text/css">
          {`
            html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
            table, td, th { border-collapse: collapse !important; }
            .email-wordmark { border-collapse: separate !important; }
            img { border: 0; display: block; line-height: 100%; outline: none; text-decoration: none; }
            a { color: ${colors.accentDark}; }
            @media screen and (max-width: 620px) {
              .email-shell { width: 100% !important; }
              .email-pad { padding-left: 20px !important; padding-right: 20px !important; }
              .email-hero { padding-top: 30px !important; padding-bottom: 30px !important; }
              .email-title { font-size: 32px !important; line-height: 108% !important; }
              .email-order-number { font-size: 12px !important; }
              .email-item-image-cell { width: 60px !important; }
              .email-item-image { height: 52px !important; width: 52px !important; }
              .email-item-copy { padding-left: 12px !important; }
              .email-item-price { font-size: 16px !important; width: 84px !important; }
              .email-stack-column { display: block !important; width: 100% !important; }
              .email-stack-column + .email-stack-column { border-left: 0 !important; border-top: 1px solid ${colors.line} !important; }
              .email-footer { padding-left: 20px !important; padding-right: 20px !important; }
            }
            @media screen and (max-width: 380px) {
              .email-item-image-cell { display: none !important; }
              .email-item-copy { padding-left: 0 !important; }
              .email-item-price { width: 74px !important; }
            }
          `}
        </style>
      </head>
      <body
        style={{
          backgroundColor: colors.paper,
          color: colors.ink,
          fontFamily: sans,
          margin: 0,
          padding: 0,
          WebkitTextSizeAdjust: "100%",
        }}
      >
        <div
          style={{
            color: "transparent",
            display: "none",
            fontSize: "1px",
            lineHeight: "1px",
            maxHeight: 0,
            maxWidth: 0,
            opacity: 0,
            overflow: "hidden",
          }}
        >
          {copy.preheader}
        </div>

        <table
          cellPadding="0"
          cellSpacing="0"
          role="presentation"
          style={{ ...tableReset, backgroundColor: colors.paper, width: "100%" }}
          width="100%"
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 10px 36px" }}>
                <table
                  cellPadding="0"
                  cellSpacing="0"
                  className="email-shell"
                  role="presentation"
                  style={{
                    ...tableReset,
                    backgroundColor: colors.surface,
                    borderTop: `4px solid ${colors.accent}`,
                    maxWidth: "600px",
                    width: "600px",
                  }}
                  width="600"
                >
                  <tbody>
                    <tr>
                      <td className="email-pad" style={{ padding: "24px 32px 22px" }}>
                        <table
                          cellPadding="0"
                          cellSpacing="0"
                          role="presentation"
                          style={{ ...tableReset, width: "100%" }}
                          width="100%"
                        >
                          <tbody>
                            <tr>
                              <td style={{ verticalAlign: "middle" }}>
                                <table
                                  cellPadding="0"
                                  cellSpacing="0"
                                  className="email-wordmark"
                                  role="presentation"
                                  style={{
                                    backgroundColor: colors.surface,
                                    border: `1px solid ${colors.line}`,
                                    borderCollapse: "separate",
                                    borderRadius: "999px",
                                    borderSpacing: 0,
                                  }}
                                >
                                  <tbody>
                                    <tr>
                                      <td
                                        style={{
                                          borderRadius: "999px",
                                          padding: "10px 18px 11px",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        <span
                                          style={{
                                            color: colors.ink,
                                            fontFamily: serif,
                                            fontSize: "23px",
                                            fontStyle: "italic",
                                            letterSpacing: "-0.6px",
                                            lineHeight: "100%",
                                          }}
                                        >
                                          Moa Clay
                                        </span>{" "}
                                        <span
                                          style={{
                                            color: colors.accentDark,
                                            fontFamily: sans,
                                            fontSize: "9px",
                                            fontWeight: 700,
                                            letterSpacing: "1.2px",
                                            textTransform: "lowercase",
                                          }}
                                        >
                                          co
                                        </span>
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </td>
                              <td
                                align="right"
                                style={{
                                  color: colors.muted,
                                  fontFamily: sans,
                                  fontSize: "10px",
                                  letterSpacing: "1.2px",
                                  textTransform: "uppercase",
                                  verticalAlign: "middle",
                                }}
                              >
                                Från ateljén
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td>
                        <img
                          alt=""
                          height="44"
                          role="presentation"
                          src={theme.backgroundImage}
                          style={{
                            backgroundColor: "#FFFFFF",
                            height: "auto",
                            maxWidth: "600px",
                            width: "100%",
                          }}
                          width="600"
                        />
                      </td>
                    </tr>

                    <tr>
                      <td
                        className="email-hero email-pad"
                        style={{
                          backgroundColor: colors.softPaper,
                          borderBottom: `1px solid ${colors.line}`,
                          padding: "38px 32px 36px",
                        }}
                      >
                        <p style={sectionLabelStyle}>{copy.eyebrow}</p>
                        <h1
                          className="email-title"
                          style={{
                            color: colors.ink,
                            fontFamily: serif,
                            fontSize: "38px",
                            fontWeight: 400,
                            letterSpacing: "-0.9px",
                            lineHeight: "108%",
                            margin: "11px 0 18px",
                          }}
                        >
                          {copy.title}
                        </h1>
                        <p style={{ ...paragraphStyle, color: colors.ink }}>
                          Hej {name}!
                        </p>
                        <p style={{ ...paragraphStyle, marginTop: "6px", maxWidth: "480px" }}>
                          {copy.intro}
                        </p>
                      </td>
                    </tr>

                    <tr>
                      <td
                        className="email-pad"
                        style={{
                          borderBottom: `1px solid ${colors.line}`,
                          padding: "17px 32px",
                        }}
                      >
                        <table
                          cellPadding="0"
                          cellSpacing="0"
                          role="presentation"
                          style={{ ...tableReset, width: "100%" }}
                          width="100%"
                        >
                          <tbody>
                            <tr>
                              <td style={sectionLabelStyle}>Din order</td>
                              <td
                                align="right"
                                className="email-order-number"
                                style={{
                                  color: colors.ink,
                                  fontFamily:
                                    "'Courier New', Courier, monospace",
                                  fontSize: "13px",
                                  fontWeight: 700,
                                  letterSpacing: "0.4px",
                                }}
                              >
                                {shortOrderNumber(_id)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td className="email-pad" style={{ padding: "30px 32px 10px" }}>
                        <p style={sectionLabelStyle}>Innehåll</p>
                      </td>
                    </tr>

                    <tr>
                      <td className="email-pad" style={{ padding: "0 32px 26px" }}>
                        <table
                          cellPadding="0"
                          cellSpacing="0"
                          role="presentation"
                          style={{ ...tableReset, width: "100%" }}
                          width="100%"
                        >
                          <tbody>
                            {items.map((item) => {
                              const displayImage = item.finalImage || item.image;
                              return (
                                <tr key={item._id || item.itemRef || item.name}>
                                <td
                                  className="email-item-image-cell"
                                  style={{
                                    borderBottom: `1px solid ${colors.line}`,
                                    padding: "16px 0",
                                    verticalAlign: "top",
                                    width: "72px",
                                  }}
                                >
                                  {displayImage ? (
                                    <img
                                      alt={item.name}
                                      className="email-item-image"
                                      height="64"
                                      src={displayImage}
                                      style={{
                                        backgroundColor: colors.paper,
                                        borderRadius: "4px",
                                        height: "64px",
                                        objectFit: "cover",
                                        width: "64px",
                                      }}
                                      width="64"
                                    />
                                  ) : (
                                    <table
                                      cellPadding="0"
                                      cellSpacing="0"
                                      className="email-item-image"
                                      role="presentation"
                                      style={{
                                        ...tableReset,
                                        backgroundColor: colors.softPaper,
                                        height: "64px",
                                        width: "64px",
                                      }}
                                      width="64"
                                    >
                                      <tbody>
                                        <tr>
                                          <td
                                            align="center"
                                            style={{
                                              color: colors.accent,
                                              fontFamily: serif,
                                              fontSize: "9px",
                                              fontWeight: 700,
                                              letterSpacing: "0.7px",
                                              lineHeight: "130%",
                                              textTransform: "uppercase",
                                            }}
                                          >
                                            Special
                                            <br />
                                            design
                                          </td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                                <td
                                  className="email-item-copy"
                                  style={{
                                    borderBottom: `1px solid ${colors.line}`,
                                    padding: "16px 12px 16px 16px",
                                    verticalAlign: "top",
                                  }}
                                >
                                  <p
                                    style={{
                                      color: colors.ink,
                                      fontFamily: serif,
                                      fontSize: "18px",
                                      lineHeight: "125%",
                                      margin: 0,
                                    }}
                                  >
                                    {item.name}
                                  </p>
                                  <p
                                    style={{
                                      color: colors.muted,
                                      fontFamily: sans,
                                      fontSize: "11px",
                                      lineHeight: "145%",
                                      margin: "4px 0 0",
                                    }}
                                  >
                                    {item.quantity} st · {formatSek(item.price)}/st
                                  </p>
                                  {item.description ? (
                                    <p
                                      style={{
                                        color: colors.muted,
                                        fontFamily: sans,
                                        fontSize: "11px",
                                        lineHeight: "150%",
                                        margin: "7px 0 0",
                                      }}
                                    >
                                      {item.description}
                                    </p>
                                  ) : null}
                                  {!displayImage && order.kind === "SPECIAL" ? (
                                    <p
                                      style={{
                                        color: colors.accentDark,
                                        fontFamily: sans,
                                        fontSize: "10px",
                                        lineHeight: "145%",
                                        margin: "7px 0 0",
                                      }}
                                    >
                                      Bild läggs till när produkten är färdig.
                                    </p>
                                  ) : null}
                                  {(item.additionalItems ?? []).map(
                                    (addition) => (
                                      <p
                                        key={
                                          addition._id ??
                                          `${addition.name}-${addition.packinfo}-${addition.price}`
                                        }
                                        style={{
                                          color: colors.accentDark,
                                          fontFamily: sans,
                                          fontSize: "11px",
                                          lineHeight: "145%",
                                          margin: "5px 0 0",
                                        }}
                                      >
                                        + {addition.name}
                                        {addition.packinfo
                                          ? ` · ${addition.packinfo}`
                                          : ""}
                                        {addition.price
                                          ? ` · ${formatSek(
                                              addition.price * item.quantity
                                            )}`
                                          : ""}
                                      </p>
                                    )
                                  )}
                                </td>
                                <td
                                  align="right"
                                  className="email-item-price"
                                  style={{
                                    borderBottom: `1px solid ${colors.line}`,
                                    color: colors.ink,
                                    fontFamily: serif,
                                    fontSize: "18px",
                                    padding: "16px 0",
                                    verticalAlign: "top",
                                    whiteSpace: "nowrap",
                                    width: "96px",
                                  }}
                                >
                                  {formatSek(item.price * item.quantity)}
                                </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    {template === Template.SPECIAL_INVITATION && actionUrl ? (
                      <tr>
                        <td
                          align="center"
                          className="email-pad"
                          style={{ padding: "2px 32px 32px" }}
                        >
                          <a
                            href={actionUrl}
                            style={{
                              backgroundColor: colors.accentDark,
                              borderRadius: "999px",
                              color: "#FFFFFF",
                              display: "inline-block",
                              fontFamily: sans,
                              fontSize: "12px",
                              fontWeight: 700,
                              letterSpacing: "0.7px",
                              padding: "14px 24px",
                              textDecoration: "none",
                            }}
                          >
                            Granska och gå till betalning
                          </a>
                          {specialOrderExpiry ? (
                            <p
                              style={{
                                ...paragraphStyle,
                                fontSize: "11px",
                                marginTop: "10px",
                              }}
                            >
                              Länken är giltig till {specialOrderExpiry}.
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}

                    <tr>
                      <td
                        className="email-pad"
                        style={{
                          backgroundColor: colors.softPaper,
                          borderBottom: `1px solid ${colors.line}`,
                          borderTop: `1px solid ${colors.line}`,
                          padding: "0 32px",
                        }}
                      >
                        <table
                          cellPadding="0"
                          cellSpacing="0"
                          role="presentation"
                          style={{ ...tableReset, width: "100%" }}
                          width="100%"
                        >
                          <tbody>
                            <tr>
                              <th
                                className="email-stack-column"
                                style={{
                                  fontWeight: 400,
                                  padding: "28px 22px 28px 0",
                                  textAlign: "left",
                                  verticalAlign: "top",
                                  width: "50%",
                                }}
                              >
                                <p style={sectionLabelStyle}>Leverans till</p>
                                <p
                                  style={{
                                    color: colors.ink,
                                    fontFamily: sans,
                                    fontSize: "13px",
                                    fontWeight: 700,
                                    lineHeight: "155%",
                                    margin: "11px 0 0",
                                  }}
                                >
                                  {name}
                                </p>
                                <p style={{ ...paragraphStyle, fontSize: "13px" }}>
                                  {customer.postaddress ||
                                    "Kompletteras före betalning"}
                                  {addressLine2 ? (
                                    <>
                                      <br />
                                      {addressLine2}
                                    </>
                                  ) : null}
                                  {customer.postaddress ? (
                                    <>
                                      <br />
                                      {customer.zipcode} {customer.city}
                                    </>
                                  ) : null}
                                </p>
                              </th>
                              <th
                                className="email-stack-column"
                                style={{
                                  borderLeft: `1px solid ${colors.line}`,
                                  fontWeight: 400,
                                  padding: "28px 0 28px 22px",
                                  textAlign: "left",
                                  verticalAlign: "top",
                                  width: "50%",
                                }}
                              >
                                <p style={sectionLabelStyle}>Summering</p>
                                <table
                                  cellPadding="0"
                                  cellSpacing="0"
                                  role="presentation"
                                  style={{ ...tableReset, marginTop: "8px", width: "100%" }}
                                  width="100%"
                                >
                                  <tbody>
                                    <SummaryRow
                                      label="Produkter"
                                      value={formatSek(merchandiseTotal)}
                                    />
                                    <SummaryRow
                                      label="Frakt"
                                      value={freightCost ? formatSek(freightCost) : "Fri"}
                                    />
                                    {discountAmount ? (
                                      <SummaryRow
                                        label={
                                          discount?.code
                                            ? `Rabatt · ${discount.code}`
                                            : "Rabatt"
                                        }
                                        value={`−${formatSek(discountAmount)}`}
                                      />
                                    ) : null}
                                    <tr>
                                      <td
                                        style={{
                                          borderTop: `1px solid ${colors.line}`,
                                          color: colors.ink,
                                          fontFamily: sans,
                                          fontSize: "12px",
                                          fontWeight: 700,
                                          padding: "13px 0 0",
                                        }}
                                      >
                                        Totalt
                                      </td>
                                      <td
                                        align="right"
                                        style={{
                                          borderTop: `1px solid ${colors.line}`,
                                          color: colors.ink,
                                          fontFamily: serif,
                                          fontSize: "21px",
                                          padding: "10px 0 0",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {formatSek(totalSum)}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </th>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>

                    <tr>
                      <td
                        className="email-footer"
                        style={{
                          backgroundColor: colors.surface,
                          padding: "30px 32px 32px",
                          textAlign: "center",
                        }}
                      >
                        <p
                          style={{
                            color: colors.ink,
                            fontFamily: serif,
                            fontSize: "19px",
                            lineHeight: "130%",
                            margin: 0,
                          }}
                        >
                          Varmt från ateljén,
                          <br />
                          {theme.title}
                        </p>
                        <p
                          style={{
                            color: colors.muted,
                            fontFamily: sans,
                            fontSize: "11px",
                            lineHeight: "160%",
                            margin: "15px 0 0",
                          }}
                        >
                          Frågor om din order? Svara på det här mejlet eller skriv till{" "}
                          <a
                            href={`mailto:${theme.email}`}
                            style={{ color: colors.accentDark, textDecoration: "underline" }}
                          >
                            {theme.email}
                          </a>
                          .
                        </p>
                        <p
                          style={{
                            color: "#9A968F",
                            fontFamily: sans,
                            fontSize: "9px",
                            letterSpacing: "0.7px",
                            lineHeight: "150%",
                            margin: "20px 0 0",
                            textTransform: "uppercase",
                          }}
                        >
                          © {copyrightYear} {theme.title}
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
};

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <tr>
    <td
      style={{
        color: colors.muted,
        fontFamily: sans,
        fontSize: "11px",
        lineHeight: "145%",
        padding: "5px 8px 5px 0",
      }}
    >
      {label}
    </td>
    <td
      align="right"
      style={{
        color: colors.ink,
        fontFamily: sans,
        fontSize: "11px",
        lineHeight: "145%",
        padding: "5px 0",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </td>
  </tr>
);

export default EmailOrderTemplate;
