import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import { useCart } from "react-use-cart";
import ArrowIcon from "~/components/ArrowIcon";
import Feedback from "~/components/feedback";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import useStickyState from "~/hooks/useStickyState";
import { classNames } from "~/utils/classnames";
import { FREE_FREIGHT } from "~/utils/constants";
import getFreightCost from "~/utils/getFreightCost";

enum ItemError {
  PRICE,
  BALANCE,
}

type ErrorItemVal = {
  [key: string]: {
    error: string;
    clientValue: string;
    serverValue: string;
    type: ItemError;
  };
};

type CartFetcherData = {
  key?: number;
  errors?: { items?: true | ErrorItemVal; message?: string };
};

type CartInputProps = {
  name: string;
  label: string;
  placeholder: string;
  type?: "email" | "text";
  autoComplete?: string;
};

type CartAddition = {
  id: string;
  name: string;
  balance: number;
  price: number;
};

const getDiscount = (
  balance: number,
  percentage: number,
  cartTotal: number
) => {
  if (balance <= 0 || percentage <= 0 || percentage > 100) return 0;
  return Math.round(cartTotal * (percentage / 100));
};

const getLastError = (data: CartFetcherData | undefined) =>
  data?.errors?.message;

const scrollToTop = () => {
  try {
    window.scroll({ top: 0, left: 0, behavior: "auto" });
  } catch {
    window.scrollTo(0, 0);
  }
};

function CartInput({
  name,
  label,
  placeholder,
  type = "text",
  autoComplete,
}: CartInputProps) {
  const [value, setValue] = useStickyState("", name);
  const [invalid, setInvalid] = useState(false);

  return (
    <label className="mcc-cart-field">
      <span>{label}</span>
      <input
        aria-invalid={invalid}
        autoComplete={autoComplete}
        className={classNames(
          "mcc-cart-input",
          invalid ? "mcc-cart-input--invalid" : ""
        )}
        name={name}
        onChange={(event) => {
          setInvalid(false);
          setValue(event.target.value);
        }}
        onInvalid={() => setInvalid(true)}
        placeholder={placeholder}
        required
        type={type}
        value={value}
      />
    </label>
  );
}

function useUserDiscount(code: string) {
  const fetcher = useFetcher<{
    code?: string;
    balance?: number;
    percentage?: number | null;
  }>();
  const submitDiscount = fetcher.submit;
  useEffect(() => {
    const handler = window.setTimeout(() => {
      const normalizedCode = code.trim();
      submitDiscount(
        { code: normalizedCode },
        { action: "/discount", method: "post" }
      );
    }, 300);

    return () => window.clearTimeout(handler);
  }, [code, submitDiscount]);

  const normalizedCode = code.trim();
  const isChecked =
    Boolean(normalizedCode) &&
    fetcher.state === "idle" &&
    fetcher.data?.code === normalizedCode;
  const isChecking = Boolean(normalizedCode) && !isChecked;
  const isValid =
    isChecked &&
    fetcher.data?.code === normalizedCode &&
    (fetcher.data?.balance ?? 0) > 0;

  return {
    balance: isValid ? fetcher.data?.balance ?? 0 : 0,
    code: normalizedCode,
    isChecked,
    isChecking,
    isValid,
    percentage: isValid ? fetcher.data?.percentage ?? null : null,
  };
}

export default function CartView() {
  const { items, updateItemQuantity, cartTotal, removeItem } = useCart();
  const cartFetcher = useFetcher<CartFetcherData>();
  const formRef = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [discountValue, setDiscountValue] = useState("");
  const discount = useUserDiscount(discountValue);

  const itemsError = cartFetcher.data?.errors?.items;
  const getItemError = (key: string) =>
    typeof cartFetcher.data?.errors?.items === "object"
      ? cartFetcher.data.errors.items[key]
      : undefined;

  useEffect(() => scrollToTop(), []);

  useEffect(() => {
    if (itemsError) scrollToTop();
  }, [itemsError]);

  useEffect(() => {
    if (cartTotal === 0) navigate("/");
  }, [cartTotal, navigate]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    if (form.checkValidity()) return;

    event.preventDefault();

    const firstInvalidField = form.querySelector<HTMLInputElement>(
      ".mcc-cart-delivery input:invalid"
    );
    if (!firstInvalidField) return;

    firstInvalidField.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      firstInvalidField.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
        inline: "nearest",
      });
    });
  };

  const freightCost = getFreightCost(cartTotal);
  const discountAmount = getDiscount(
    discount.balance,
    discount.percentage ?? 0,
    cartTotal
  );
  const orderTotal = cartTotal + freightCost - discountAmount;
  const parentItems = items.filter((item) => !item.parentId);
  const totalItems = parentItems.reduce(
    (total, item) => total + (item.quantity ?? 0),
    0
  );
  const amountUntilFreeFreight = Math.max(0, FREE_FREIGHT - cartTotal);
  const freightProgress = Math.min(100, (cartTotal / FREE_FREIGHT) * 100);

  const getAdditions = (item: any): CartAddition[] =>
    Object.values(
      items.reduce<Record<string, CartAddition>>((acc, additionalItem: any) => {
        if (additionalItem.parentId === item.id) {
          const parts = String(additionalItem.id).split("_");
          const key = `${item.id}_${parts[2]}`;

          if (acc[key]) acc[key].balance += 1;
          else {
            acc[key] = {
              id: key,
              name: additionalItem.headline,
              balance: 1,
              price: additionalItem.price,
            };
          }
        }
        return acc;
      }, {})
    );

  const decreaseItem = (item: any) => {
    const quantity = item.quantity ?? 0;
    const removedIndex = quantity - 1;

    items
      .filter(
        (additionalItem) =>
          additionalItem.parentId === item.id &&
          additionalItem.index === removedIndex
      )
      .forEach((additionalItem) => removeItem(additionalItem.id));

    if (quantity <= 1) removeItem(item.id);
    else updateItemQuantity(item.id, quantity - 1);
  };

  const removeProduct = (item: any) => {
    items
      .filter((additionalItem) => additionalItem.parentId === item.id)
      .forEach((additionalItem) => removeItem(additionalItem.id));
    removeItem(item.id);
  };

  return (
    <cartFetcher.Form
      className="mcc-cart-page"
      method="post"
      noValidate
      onSubmit={handleSubmit}
      ref={formRef}
    >
      {cartTotal > 0 ? (
        <main className="mcc-cart-shell">
          <header className="mcc-cart-hero">
            <Link className="mcc-cart-back" to="/">
              <ArrowIcon direction="left" />
              Fortsätt handla
            </Link>

            <div className="mcc-cart-hero__title">
              <div>
                <p className="mcc-cart-kicker">Din beställning</p>
                <h1>Varukorg</h1>
                <p>
                  Dina utvalda favoriter, samlade och redo för nästa steg.
                </p>
              </div>
              <span
                aria-label={`${totalItems} varor`}
                className="mcc-cart-hero__count"
              >
                {String(totalItems).padStart(2, "0")}
              </span>
            </div>

            <ol aria-label="Steg i köpet" className="mcc-cart-steps">
              <li aria-current="step">
                <span>01</span> Varukorg
              </li>
              <li>
                <span>02</span> Betalning
              </li>
              <li>
                <span>03</span> Klart
              </li>
            </ol>
          </header>

          <div className="mcc-cart-layout">
            <section
              aria-labelledby="cart-products-heading"
              className="mcc-cart-products"
            >
              <div className="mcc-cart-section-heading">
                <h2 id="cart-products-heading">Dina val</h2>
                <span>
                  {totalItems} {totalItems === 1 ? "vara" : "varor"}
                </span>
              </div>

              <div className="mcc-cart-product-list">
                {parentItems.map((item, index) => {
                  const error = getItemError(String(item.id));
                  const additions = getAdditions(item);
                  const additionsTotal = additions.reduce(
                    (total, addition) =>
                      total + addition.price * addition.balance,
                    0
                  );
                  const lineTotal =
                    Number(item.price) * (item.quantity ?? 0) + additionsTotal;
                  const canIncrease =
                    typeof item.balance === "number" &&
                    (item.quantity ?? 0) < item.balance;

                  return (
                    <motion.article
                      animate={{ opacity: 1, y: 0 }}
                      className="mcc-cart-product"
                      initial={
                        reduceMotion ? false : { opacity: 0, y: 18 }
                      }
                      key={item.id}
                      transition={{
                        delay: reduceMotion ? 0 : index * 0.06,
                        duration: 0.42,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <Link
                        aria-label={`Visa ${item.headline}`}
                        className="mcc-cart-product__media"
                        to={`/collections/${item.collectionRef}#${item.id}`}
                      >
                        <img
                          alt={String(item.headline)}
                          src={String(item.image)}
                        />
                      </Link>

                      <div className="mcc-cart-product__copy">
                        <p className="mcc-cart-product__eyebrow">
                          Ur kollektionen
                        </p>
                        <Link
                          className="mcc-cart-product__name"
                          to={`/collections/${item.collectionRef}#${item.id}`}
                        >
                          {item.headline}
                        </Link>
                        <p className="mcc-cart-product__unit-price">
                          {item.price} SEK / st
                        </p>

                        {additions.length > 0 ? (
                          <div className="mcc-cart-additions">
                            <p>Tillval</p>
                            <ul>
                              {additions.map((addition) => (
                                <li key={addition.id}>
                                  <span>{addition.name}</span>
                                  <span>
                                    {addition.balance > 1
                                      ? `${addition.balance} × `
                                      : "+ "}
                                    {addition.price} SEK
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {(error && error.type === ItemError.BALANCE) ||
                        Number(item.balance) < (item.quantity ?? 0) ? (
                          <p className="mcc-cart-product__error" role="alert">
                            Det finns högst{" "}
                            {error ? error.serverValue : item.balance} i lager.
                          </p>
                        ) : null}
                        {error && error.type === ItemError.PRICE ? (
                          <p className="mcc-cart-product__error" role="alert">
                            Priset har uppdaterats till {error.serverValue} SEK.
                          </p>
                        ) : null}
                      </div>

                      <div className="mcc-cart-product__actions">
                        <strong>{lineTotal} SEK</strong>
                        <div className="mcc-cart-product__controls">
                          <div
                            aria-label={`Antal ${item.headline}`}
                            className="mcc-cart-quantity"
                            role="group"
                          >
                          <button
                            aria-label={`Minska antal ${item.headline}`}
                            onClick={() => decreaseItem(item)}
                            type="button"
                          >
                            <PlusMinusIcon operation="minus" />
                          </button>
                          <output aria-live="polite">{item.quantity}</output>
                          <button
                            aria-label={`Öka antal ${item.headline}`}
                            disabled={!canIncrease}
                            onClick={() =>
                              updateItemQuantity(
                                item.id,
                                (item.quantity ?? 0) + 1
                              )
                            }
                            type="button"
                          >
                            <PlusMinusIcon />
                          </button>
                          </div>
                          <button
                            aria-label={`Ta bort ${item.headline} ur varukorgen`}
                            className="mcc-cart-remove"
                            onClick={() => removeProduct(item)}
                            title="Ta bort varan"
                            type="button"
                          >
                            <span aria-hidden="true">×</span>
                          </button>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            </section>

            <aside className="mcc-cart-sidebar">
              <section
                aria-labelledby="cart-summary-heading"
                className="mcc-cart-summary"
              >
                <div className="mcc-cart-section-heading">
                  <h2 id="cart-summary-heading">Sammanfattning</h2>
                  <span>SEK</span>
                </div>

                <div className="mcc-cart-freight-note">
                  <div>
                    <span>
                      {amountUntilFreeFreight > 0
                        ? `${amountUntilFreeFreight} SEK kvar till fri frakt`
                        : "Du har fri frakt"}
                    </span>
                    <span>{Math.round(freightProgress)}%</span>
                  </div>
                  <div className="mcc-cart-freight-track" aria-hidden="true">
                    <span style={{ width: `${freightProgress}%` }} />
                  </div>
                </div>

                <dl className="mcc-cart-totals">
                  <div>
                    <dt>Varor</dt>
                    <dd>{cartTotal} SEK</dd>
                  </div>
                  <div>
                    <dt>Frakt</dt>
                    <dd>
                      {freightCost === 0 ? "Fri" : `${freightCost} SEK`}
                    </dd>
                  </div>
                  {discountAmount > 0 ? (
                    <div className="mcc-cart-totals__discount">
                      <dt>Rabatt</dt>
                      <dd>− {discountAmount} SEK</dd>
                    </div>
                  ) : null}
                </dl>

                <label className="mcc-cart-discount">
                  <span>Rabattkod</span>
                  <input
                    aria-describedby="discount-status"
                    className={classNames(
                      "mcc-cart-input",
                      discount.code &&
                        discount.isChecked &&
                        !discount.isValid
                        ? "mcc-cart-input--invalid"
                        : ""
                    )}
                    name="discount"
                    onChange={(event) =>
                      setDiscountValue(event.target.value)
                    }
                    placeholder="Skriv din kod"
                    type="text"
                    value={discountValue}
                  />
                </label>
                <div
                  aria-live="polite"
                  className="mcc-cart-discount__status"
                  id="discount-status"
                >
                  {discount.isChecking ? (
                    <p>Kontrollerar koden…</p>
                  ) : discount.code && discount.isValid ? (
                    <p className="mcc-cart-discount__success">
                      {discount.percentage}% rabatt är tillagd.
                    </p>
                  ) : discount.code && discount.isChecked ? (
                    <p className="mcc-cart-discount__error">
                      Koden kunde inte användas.
                    </p>
                  ) : null}
                </div>

                <div className="mcc-cart-grand-total">
                  <span>Totalt</span>
                  <strong>{orderTotal} SEK</strong>
                </div>
                <p className="mcc-cart-summary__note">
                  Frakt och eventuell rabatt är inkluderad.
                </p>
              </section>

              <section
                aria-labelledby="delivery-heading"
                className="mcc-cart-delivery"
              >
                <p className="mcc-cart-kicker">Nästa steg</p>
                <h2 id="delivery-heading">Vart ska paketet?</h2>
                <p className="mcc-cart-delivery__intro">
                  Fyll i adressen så tar vi dig vidare till säker betalning.
                </p>
                <div className="mcc-cart-address-grid">
                  <CartInput
                    autoComplete="given-name"
                    label="Förnamn"
                    name="firstname"
                    placeholder="Moa"
                  />
                  <CartInput
                    autoComplete="family-name"
                    label="Efternamn"
                    name="lastname"
                    placeholder="Clay"
                  />
                  <div className="mcc-cart-field--full">
                    <CartInput
                      autoComplete="email"
                      label="E-post"
                      name="email"
                      placeholder="du@exempel.se"
                      type="email"
                    />
                  </div>
                  <div className="mcc-cart-field--full">
                    <CartInput
                      autoComplete="street-address"
                      label="Gatuadress"
                      name="postaddress"
                      placeholder="Gatan 1"
                    />
                  </div>
                  <CartInput
                    autoComplete="postal-code"
                    label="Postnummer"
                    name="zipcode"
                    placeholder="123 45"
                  />
                  <CartInput
                    autoComplete="address-level2"
                    label="Ort"
                    name="city"
                    placeholder="Stockholm"
                  />
                </div>

                <input
                  name="items"
                  type="hidden"
                  value={JSON.stringify(items)}
                />
                <div className="mcc-cart-delivery__footer">
                  <p>
                    <span aria-hidden="true">○</span>
                    Säker betalning i nästa steg
                  </p>
                  <button
                    aria-busy={cartFetcher.state !== "idle"}
                    className="mcc-cart-checkout"
                    disabled={cartFetcher.state !== "idle"}
                    type="submit"
                  >
                    {cartFetcher.state === "idle" ? (
                      <>
                        Till betalningen
                        <ArrowIcon />
                      </>
                    ) : (
                      <>
                        <span
                          aria-hidden="true"
                          className="mcc-button-spinner"
                        />
                        Förbereder betalningen…
                      </>
                    )}
                  </button>
                </div>
              </section>
            </aside>
          </div>
        </main>
      ) : null}

      <Feedback
        forceInvisble={!cartFetcher.data}
        headline="Kontrollera uppgifterna"
        key={cartFetcher.data?.key}
        message={getLastError(cartFetcher.data)}
        type="error"
        visibleInMillis={4000}
      />
    </cartFetcher.Form>
  );
}
