import { useMemo, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useNavigation,
} from "react-router";
import ArrowIcon from "~/components/ArrowIcon";
import SpecialOrderExpiryControl from "~/components/admin/SpecialOrderExpiryControl";
import SpecialOrderImageUpload from "~/components/admin/SpecialOrderImageUpload";
import type { Order } from "~/types";
import { FREE_FREIGHT, FREIGHT_COST } from "~/utils/constants";
import getFreightCost from "~/utils/getFreightCost";
import {
  specialOrderExpiryFormValue,
  specialOrderExpiryFromDays,
} from "~/utils/specialOrderExpiry";

export type SpecialOrderSource = {
  _id: string;
  headline: string;
  image?: string;
  images: string[];
  longDescription?: string;
  price: number;
  productInfos: string[];
};

export type SpecialOrderEditorData = {
  order?: Order;
  sources: SpecialOrderSource[];
};

type ActionData = {
  errors?: Record<string, string>;
};

const money = (value: number) =>
  new Intl.NumberFormat("sv-SE", {
    currency: "SEK",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);

const firstItem = (order?: Order) => order?.items[0];

const imageFileName = (value: string) => {
  try {
    const pathname = new URL(value).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
  } catch {
    return value;
  }
};

export default function SpecialOrderEditor({
  order,
  sources,
}: SpecialOrderEditorData) {
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const savedItem = firstItem(order);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceId, setSourceId] = useState(savedItem?.templateItemRef ?? "");
  const initialSource = sources.find((source) => source._id === sourceId);
  const [name, setName] = useState(savedItem?.name ?? initialSource?.headline ?? "");
  const [description, setDescription] = useState(
    savedItem?.description ?? initialSource?.productInfos.join(" · ") ?? ""
  );
  const [longDescription, setLongDescription] = useState(
    savedItem?.longDescription ?? initialSource?.longDescription ?? ""
  );
  const [price, setPrice] = useState(
    String(savedItem?.price ?? initialSource?.price ?? "")
  );
  const [quantity, setQuantity] = useState(String(savedItem?.quantity ?? 1));
  const [freightMode, setFreightMode] = useState<"AUTO" | "CUSTOM">(
    order?.specialOrder?.freightMode ?? (order ? "CUSTOM" : "AUTO")
  );
  const [customFreightCost, setCustomFreightCost] = useState(
    String(order?.freightCost ?? FREIGHT_COST)
  );
  const [image, setImage] = useState(
    savedItem?.image ?? initialSource?.images[0] ?? initialSource?.image ?? ""
  );
  const [expiresAt, setExpiresAt] = useState(() =>
    order?.specialOrder?.expiresAt
      ? specialOrderExpiryFormValue(
          order.specialOrder.expiresAt,
          order.specialOrder.expiryIncludesTime !== false
        )
      : specialOrderExpiryFromDays(7)
  );
  const filteredSources = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase("sv-SE");
    return sources
      .filter((source) =>
        query ? source.headline.toLocaleLowerCase("sv-SE").includes(query) : true
      )
      .slice(0, 8);
  }, [sourceQuery, sources]);
  const merchandiseTotal =
    (Number(price.replace(",", ".")) || 0) * (Number(quantity) || 0);
  const automaticFreightCost = getFreightCost(merchandiseTotal);
  const freightCost =
    freightMode === "AUTO"
      ? automaticFreightCost
      : Number(customFreightCost.replace(",", ".")) || 0;
  const total = merchandiseTotal + freightCost;
  const amountUntilFreeFreight = Math.max(0, FREE_FREIGHT - merchandiseTotal);
  const pendingIntent = navigation.formData?.get("intent");
  const isSubmitting = navigation.state !== "idle";
  const selectedSource = sources.find((source) => source._id === sourceId);
  const sourceImages = selectedSource?.images ?? [];
  const activeSourceImageIndex = sourceImages.findIndex(
    (sourceImage) =>
      sourceImage === image ||
      (Boolean(image) && imageFileName(sourceImage) === imageFileName(image))
  );
  const sourcePosition = sources.findIndex((source) => source._id === sourceId) + 1;

  const browseSourceImage = (direction: -1 | 1) => {
    if (!sourceImages.length) return;
    const currentIndex =
      activeSourceImageIndex >= 0
        ? activeSourceImageIndex
        : direction === 1
          ? -1
          : 0;
    const nextIndex =
      (currentIndex + direction + sourceImages.length) % sourceImages.length;
    setImage(sourceImages[nextIndex]);
  };

  const chooseSource = (source: SpecialOrderSource) => {
    setSourceId(source._id);
    setName(source.headline);
    setDescription(source.productInfos.join(" · "));
    setLongDescription(source.longDescription ?? "");
    setPrice(String(source.price));
    setImage(source.images[0] ?? source.image ?? "");
    setSourceOpen(false);
    setSourceQuery("");
  };

  const fieldError = (name: string) =>
    actionData?.errors?.[name] ? (
      <small className="special-editor-error">{actionData.errors[name]}</small>
    ) : null;

  return (
    <main className="special-editor-page">
      <div className="special-editor-shell">
        <header className="special-editor-hero">
          <Link className="special-editor-back" to="/admin/orders">
            <ArrowIcon direction="left" />
            Till ordrar
          </Link>
          <div>
            <p className="special-editor-kicker">Specialbeställning</p>
            <h1>{order ? "Redigera beställning" : "Ny beställning"}</h1>
          </div>
          <span className="special-editor-draft-mark">Utkast</span>
        </header>

        <Form className="special-editor-form" method="post">
          <input name="templateItemRef" type="hidden" value={sourceId} />
          <input name="image" type="hidden" value={image} />
          <input name="finalImage" type="hidden" value={savedItem?.finalImage ?? ""} />
          <input name="expiresAt" type="hidden" value={expiresAt} />

          {actionData?.errors?.form ? (
            <p className="special-editor-banner" role="alert">
              {actionData.errors.form}
            </p>
          ) : null}

          <section className="special-editor-section special-editor-section--customer">
            <div className="special-editor-section__heading">
              <span>01</span>
              <div>
                <h2>Kund</h2>
              </div>
            </div>
            <div className="special-editor-fields special-editor-fields--three">
              <label>
                <span>Förnamn</span>
                <input
                  autoComplete="given-name"
                  defaultValue={order?.customer.firstname}
                  name="firstname"
                  placeholder="Anna"
                  required
                />
                {fieldError("firstname")}
              </label>
              <label>
                <span>Efternamn</span>
                <input
                  autoComplete="family-name"
                  defaultValue={order?.customer.lastname}
                  name="lastname"
                  placeholder="Andersson"
                  required
                />
                {fieldError("lastname")}
              </label>
              <label>
                <span>E-post</span>
                <input
                  autoComplete="email"
                  defaultValue={order?.customer.email}
                  inputMode="email"
                  name="email"
                  placeholder="anna@exempel.se"
                  required
                  type="email"
                />
                {fieldError("email")}
              </label>
            </div>
          </section>

          <section className="special-editor-section special-editor-section--piece">
            <div className="special-editor-section__heading">
              <span>02</span>
              <div>
                <h2>Artikel</h2>
              </div>
            </div>

            <div className="special-source-picker">
              <button
                aria-expanded={sourceOpen}
                className="special-source-trigger"
                onClick={() => setSourceOpen((current) => !current)}
                type="button"
              >
                <span>
                  <small>Utgå från befintlig artikel</small>
                  <strong>
                    {selectedSource?.headline ?? "Välj inspirationsartikel"}
                  </strong>
                </span>
                <span aria-hidden="true">{sourceOpen ? "−" : "+"}</span>
              </button>
              {sourceOpen ? (
                <div className="special-source-popover">
                  <label>
                    <span className="sr-only">Sök produkt</span>
                    <input
                      onChange={(event) => setSourceQuery(event.target.value)}
                      placeholder="Sök bland produkter…"
                      type="search"
                      value={sourceQuery}
                    />
                  </label>
                  <div className="special-source-results">
                    {filteredSources.map((source) => (
                      <button
                        key={source._id}
                        onClick={() => chooseSource(source)}
                        type="button"
                      >
                        {source.image ? <img alt="" src={source.image} /> : <i />}
                        <span>
                          <strong>{source.headline}</strong>
                          <small>
                            {money(source.price)}
                            {source.images.length > 1
                              ? ` · ${source.images.length} bilder`
                              : ""}
                          </small>
                        </span>
                      </button>
                    ))}
                    {!filteredSources.length ? <p>Ingen produkt matchar.</p> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="special-editor-piece-grid">
              <div className="special-editor-piece-copy">
                <label>
                  <span>Namn på specialbeställningen</span>
                  <input
                    maxLength={180}
                    name="name"
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Exempel: Stor vågig vas i salviagrönt"
                    required
                    value={name}
                  />
                  {fieldError("name")}
                </label>
                <label>
                  <span>Kort beskrivning</span>
                  <textarea
                    maxLength={280}
                    name="description"
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Färg, form, storlek och det viktigaste ni har bestämt."
                    required
                    rows={3}
                    value={description}
                  />
                  <small>{description.length}/280</small>
                  {fieldError("description")}
                </label>
                <label>
                  <span>Längre beskrivning <em>valfritt</em></span>
                  <textarea
                    maxLength={4000}
                    name="longDescription"
                    onChange={(event) => setLongDescription(event.target.value)}
                    placeholder="Material, önskemål, leveranstid eller andra detaljer."
                    rows={5}
                    value={longDescription}
                  />
                  {fieldError("longDescription")}
                </label>
              </div>

              <aside className="special-editor-preview">
                <div className="special-editor-preview__media">
                  {image ? (
                    <img alt="Förhandsvisning" src={image} />
                  ) : (
                    <div className="special-editor-preview__placeholder">
                      <strong>Ingen bild vald</strong>
                      {sourceImages.length ? (
                        <button
                          onClick={() => setImage(sourceImages[0])}
                          type="button"
                        >
                          Välj en artikelbild
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
                {image && sourceImages.length ? (
                  <div
                    aria-label="Välj inspirationsbild"
                    className="mcc-shop-item__gallery-meta special-editor-preview__gallery-meta"
                  >
                    <div className="mcc-shop-item__gallery-meta-start">
                      <span className="mcc-shop-item__number">
                        {String(Math.max(sourcePosition, 1)).padStart(2, "0")}
                      </span>
                      <div className="mcc-shop-item__dots">
                        {sourceImages.map((sourceImage, index) => (
                          <button
                            aria-current={
                              activeSourceImageIndex === index ? "true" : undefined
                            }
                            aria-label={`Visa inspirationsbild ${index + 1}`}
                            key={sourceImage}
                            onClick={() => setImage(sourceImage)}
                            type="button"
                          />
                        ))}
                      </div>
                    </div>
                    <span className="mcc-shop-item__gallery-count">
                      {activeSourceImageIndex >= 0
                        ? String(activeSourceImageIndex + 1).padStart(2, "0")
                        : "–"}{" "}
                      / {String(sourceImages.length).padStart(2, "0")}
                    </span>
                    <div className="mcc-shop-item__gallery-actions">
                      {sourceImages.length > 1 ? (
                        <div className="mcc-shop-item__arrows">
                          <button
                            aria-label="Föregående inspirationsbild"
                            onClick={() => browseSourceImage(-1)}
                            type="button"
                          >
                            <ArrowIcon direction="left" />
                          </button>
                          <button
                            aria-label="Nästa inspirationsbild"
                            onClick={() => browseSourceImage(1)}
                            type="button"
                          >
                            <ArrowIcon />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="special-editor-preview__copy">
                  <h3>{name || "Din specialbeställning"}</h3>
                  {description ? <p>{description}</p> : null}
                  {order ? (
                    <SpecialOrderImageUpload
                      currentImage={image}
                      label="Ladda upp egen bild"
                      onComplete={setImage}
                      orderId={String(order._id)}
                      purpose="design"
                    />
                  ) : (
                    <small className="special-editor-preview__upload-note">
                      Egen bild kan laddas upp efter att utkastet sparats.
                    </small>
                  )}
                  {image ? (
                    <button onClick={() => setImage("")} type="button">
                      Ingen bild
                    </button>
                  ) : null}
                </div>
              </aside>
            </div>
          </section>

          <section className="special-editor-section">
            <div className="special-editor-section__heading">
              <span>03</span>
              <div>
                <h2>Pris och frakt</h2>
              </div>
            </div>
            <div className="special-editor-fields special-editor-fields--numbers">
              <label>
                <span>Produktpris per styck</span>
                <div className="special-editor-money-input">
                  <input
                    inputMode="decimal"
                    name="price"
                    onChange={(event) => setPrice(event.target.value)}
                    required
                    value={price}
                  />
                  <span>kr</span>
                </div>
                {fieldError("price")}
              </label>
              <label>
                <span>Antal</span>
                <input
                  inputMode="numeric"
                  min="1"
                  name="quantity"
                  onChange={(event) => setQuantity(event.target.value)}
                  required
                  type="number"
                  value={quantity}
                />
                {fieldError("quantity")}
              </label>
              <div className="special-editor-freight-field">
                <span className="special-editor-field-label">Frakt på ordern</span>
                <input name="freightMode" type="hidden" value={freightMode} />
                {freightMode === "AUTO" ? (
                  <>
                    <input
                      name="freightCost"
                      type="hidden"
                      value={automaticFreightCost}
                    />
                    <div className="special-editor-auto-freight" aria-live="polite">
                      <strong>
                        {automaticFreightCost === 0
                          ? "Fri frakt"
                          : money(automaticFreightCost)}
                      </strong>
                    </div>
                  </>
                ) : (
                  <div className="special-editor-money-input">
                    <input
                      aria-label="Eget fraktbelopp"
                      inputMode="decimal"
                      name="freightCost"
                      onChange={(event) => setCustomFreightCost(event.target.value)}
                      required
                      value={customFreightCost}
                    />
                    <span>kr</span>
                  </div>
                )}
                <div
                  aria-label="Välj hur frakten beräknas"
                  className="special-editor-freight-mode"
                  role="radiogroup"
                >
                  <button
                    aria-checked={freightMode === "AUTO"}
                    onClick={() => setFreightMode("AUTO")}
                    role="radio"
                    type="button"
                  >
                    Automatisk
                  </button>
                  <button
                    aria-checked={freightMode === "CUSTOM"}
                    onClick={() => setFreightMode("CUSTOM")}
                    role="radio"
                    type="button"
                  >
                    Eget belopp
                  </button>
                </div>
                <small className="special-editor-field-note">
                  {freightMode === "AUTO"
                    ? automaticFreightCost === 0
                      ? `Fri frakt från ${money(FREE_FREIGHT)} har aktiverats.`
                      : `${money(amountUntilFreeFreight)} kvar till fri frakt.`
                    : "Gäller endast den här beställningen."}
                </small>
                {fieldError("freightCost")}
              </div>
              <div className="special-editor-total">
                <span>Kunden betalar</span>
                <strong>{money(total)}</strong>
              </div>
            </div>
          </section>

          <section className="special-editor-section special-editor-section--address">
            <div className="special-editor-section__heading">
              <span>04</span>
              <div>
                <h2>Leveransadress <em>valfritt nu</em></h2>
                <p>Tom adress fylls i av kunden.</p>
              </div>
            </div>
            <div className="special-editor-fields special-editor-fields--address">
              <label className="special-editor-field--wide">
                <span>Gatuadress</span>
                <input
                  autoComplete="address-line1"
                  defaultValue={order?.customer.postaddress}
                  name="postaddress"
                  placeholder="Exempelgatan 12"
                />
              </label>
              <label>
                <span>Adressrad 2</span>
                <input
                  autoComplete="address-line2"
                  defaultValue={order?.customer.addressLine2}
                  name="addressLine2"
                  placeholder="C/o eller lägenhet"
                />
              </label>
              <label>
                <span>Postnummer</span>
                <input
                  autoComplete="postal-code"
                  defaultValue={order?.customer.zipcode}
                  inputMode="numeric"
                  name="zipcode"
                  placeholder="123 45"
                />
              </label>
              <label>
                <span>Ort</span>
                <input
                  autoComplete="address-level2"
                  defaultValue={order?.customer.city}
                  name="city"
                  placeholder="Stockholm"
                />
              </label>
              <input name="country" type="hidden" value="Sverige" />
              <input name="phone" type="hidden" value={order?.customer.phone ?? ""} />
            </div>
          </section>

          <section className="special-editor-send">
            <SpecialOrderExpiryControl
              error={actionData?.errors?.expiresAt}
              onChange={setExpiresAt}
              value={expiresAt}
            />
            <div className="special-editor-actions">
              <button
                className="special-editor-save"
                disabled={isSubmitting}
                name="intent"
                type="submit"
                value="save"
              >
                {isSubmitting && pendingIntent === "save" ? "Sparar…" : "Spara utkast"}
              </button>
              <button
                className="special-editor-send-button"
                disabled={isSubmitting}
                name="intent"
                type="submit"
                value="send"
              >
                <span>
                  {isSubmitting && pendingIntent === "send"
                    ? "Förbereder mejlet…"
                    : "Skicka privat betalningslänk"}
                </span>
                <ArrowIcon direction="up-right" />
              </button>
            </div>
          </section>
        </Form>
      </div>
    </main>
  );
}
