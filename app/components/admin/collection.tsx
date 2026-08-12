import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CollectionProps } from "~/types";

type LoaderData = {
  collection: (CollectionProps & { _id: string }) | null;
  itemCount: number;
};

type ActionData = {
  errors?: Record<string, string | undefined>;
};

type ImageStatus = "complete" | "uploading" | "processing" | "error";

type ImageDraft = {
  error?: string;
  file?: File;
  name: string;
  optimizedSize?: number;
  previewUrl?: string;
  progress: number;
  status: ImageStatus;
  url?: string;
};

type UploadSummary = {
  busy: boolean;
  error: boolean;
  ready: boolean;
};

const MAX_IMAGE_SIZE = 18 * 1024 * 1024;
const acceptedImagePattern = /\.(jpe?g|png|webp|heic|heif)$/i;

const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
};

const fileNameFromUrl = (url: string) => {
  const fileName = url.split("?")[0].split("/").pop();
  return fileName ? decodeURIComponent(fileName) : "Collection-bild";
};

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v2.75A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V15.5" />
    </svg>
  );
}

function CollectionImageUpload({
  collection,
  onDirty,
  onStateChange,
}: {
  collection: LoaderData["collection"];
  onDirty: () => void;
  onStateChange: (summary: UploadSummary) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest>();
  const objectUrlsRef = useRef(new Set<string>());
  const [dragging, setDragging] = useState(false);
  const [image, setImage] = useState<ImageDraft | null>(() =>
    collection?.image
      ? {
          name: fileNameFromUrl(collection.image),
          previewUrl: collection.image,
          progress: 100,
          status: "complete",
          url: collection.image,
        }
      : null
  );

  useEffect(() => {
    onStateChange({
      busy: image?.status === "uploading" || image?.status === "processing",
      error: image?.status === "error",
      ready: image?.status === "complete" && Boolean(image.url),
    });
  }, [image, onStateChange]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    }, []
  );

  const uploadFile = useCallback((file: File, previewUrl: string) => {
    const request = new XMLHttpRequest();
    requestRef.current?.abort();
    requestRef.current = request;
    setImage({
      file,
      name: file.name,
      previewUrl,
      progress: 2,
      status: "uploading",
    });

    request.open("POST", "/admin/collection/upload");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      setImage((current) =>
        current
          ? {
              ...current,
              progress: Math.max(
                4,
                Math.min(92, Math.round((event.loaded / event.total) * 92))
              ),
            }
          : current
      );
    };
    request.upload.onload = () =>
      setImage((current) =>
        current ? { ...current, progress: 94, status: "processing" } : current
      );
    request.onerror = () =>
      setImage((current) =>
        current
          ? {
              ...current,
              error: "Uppladdningen tappade kontakten. Försök igen.",
              progress: 0,
              status: "error",
            }
          : current
      );
    request.onload = () => {
      requestRef.current = undefined;
      const response = request.response as
        | { error?: string; key?: string; sizeBytes?: number; uniqueFileName?: string }
        | null;
      if (request.status < 200 || request.status >= 300 || !response?.key) {
        setImage((current) =>
          current
            ? {
                ...current,
                error:
                  response?.error ??
                  "Bilden kunde inte bearbetas. Prova en annan fil.",
                progress: 0,
                status: "error",
              }
            : current
        );
        return;
      }

      const url = `https://38vabcm3.twic.pics/${response.key}`;
      setImage({
        name: response.uniqueFileName ?? file.name,
        optimizedSize: response.sizeBytes,
        previewUrl: url,
        progress: 100,
        status: "complete",
        url,
      });
    };

    const formData = new FormData();
    formData.append("file", file);
    request.send(formData);
  }, []);

  const chooseFile = useCallback(
    (file?: File) => {
      if (!file) return;
      onDirty();
      const extensionAccepted = acceptedImagePattern.test(file.name);
      const sizeAccepted = file.size <= MAX_IMAGE_SIZE;
      const previewUrl = extensionAccepted ? URL.createObjectURL(file) : undefined;
      if (previewUrl) objectUrlsRef.current.add(previewUrl);

      if (!extensionAccepted || !sizeAccepted || !previewUrl) {
        setImage({
          error: !extensionAccepted
            ? "Välj JPG, PNG, WebP eller HEIC."
            : `Filen är större än ${formatFileSize(MAX_IMAGE_SIZE)}.`,
          name: file.name,
          previewUrl,
          progress: 0,
          status: "error",
        });
        return;
      }

      uploadFile(file, previewUrl);
    },
    [onDirty, uploadFile]
  );

  const removeImage = () => {
    requestRef.current?.abort();
    requestRef.current = undefined;
    onDirty();
    setImage(null);
  };

  const busy = image?.status === "uploading" || image?.status === "processing";

  return (
    <section className="mcc-editor-section mcc-collection-editor-media">
      <div className="mcc-editor-section__heading">
        <div>
          <p className="mcc-editor-eyebrow">Collection-omslag</p>
          <h2>Bild</h2>
        </div>
        <span>{image?.status === "complete" ? "Klar" : "01"}</span>
      </div>

      <div
        className={`mcc-editor-dropzone${dragging ? " is-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          chooseFile(event.dataTransfer.files[0]);
        }}
      >
        <span className="mcc-editor-dropzone__icon"><UploadIcon /></span>
        <div>
          <strong>{dragging ? "Släpp bilden här" : image ? "Byt Collection-bild" : "Dra in en bild eller välj från enheten"}</strong>
          <small>JPG, PNG, WebP eller HEIC · upp till {formatFileSize(MAX_IMAGE_SIZE)}</small>
        </div>
        <button onClick={() => inputRef.current?.click()} type="button">
          {image ? "Välj en annan" : "Välj bild"} <span aria-hidden="true">＋</span>
        </button>
        <input
          accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="mcc-editor-visually-hidden"
          onChange={(event) => {
            chooseFile(event.target.files?.[0]);
            event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
      </div>

      {image ? (
        <figure className={`mcc-collection-editor-figure is-${image.status}`}>
          <div className="mcc-collection-editor-image">
            {image.previewUrl ? <img alt="Förhandsvisning av Collection" src={image.previewUrl} /> : <span>Ingen förhandsvisning</span>}
            {busy ? (
              <div className="mcc-editor-image__progress">
                <span>{image.status === "processing" ? "Optimerar" : "Laddar upp"}</span>
                <strong>{image.progress}%</strong>
                <i style={{ "--upload-progress": `${image.progress}%` } as CSSProperties} />
              </div>
            ) : null}
            {image.status === "complete" ? <span className="mcc-editor-image__ready">✓</span> : null}
          </div>
          <figcaption>
            <div>
              <span>Collection-bild</span>
              <strong>{image.status === "complete" ? "Klar att använda" : image.name}</strong>
              {image.optimizedSize ? <small>Optimerad · {formatFileSize(image.optimizedSize)}</small> : null}
            </div>
            <button disabled={busy} onClick={removeImage} type="button">Ta bort</button>
          </figcaption>
          {image.error ? (
            <div className="mcc-editor-image__error" role="alert">
              <span>{image.error}</span>
              {image.file ? (
                <button onClick={() => uploadFile(image.file!, image.previewUrl!)} type="button">Försök igen</button>
              ) : null}
            </div>
          ) : null}
        </figure>
      ) : (
        <div className="mcc-collection-editor-placeholder">
          <span>01</span>
          <p>Välj en stående eller kvadratisk bild. Den används både i listningen och högst upp i din Collection.</p>
        </div>
      )}

      <p className="mcc-editor-upload-status" aria-live="polite">
        {busy
          ? "Bilden optimeras. Du kan fortsätta skriva under tiden."
          : image?.status === "complete"
          ? "Bilden är redo att sparas."
          : "Lägg till en bild för att kunna spara Collection."}
      </p>
      <input name="image" readOnly type="hidden" value={image?.status === "complete" ? image.url ?? "" : ""} />
    </section>
  );
}

export default function CollectionEditor() {
  const { collection, itemCount } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [dirty, setDirty] = useState(false);
  const [slug, setSlug] = useState(collection?.shortUrl ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(collection));
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary>({
    busy: false,
    error: false,
    ready: Boolean(collection?.image),
  });
  const handleDirty = useCallback(() => setDirty(true), []);
  const handleUploadStateChange = useCallback(
    (summary: UploadSummary) => setUploadSummary(summary),
    []
  );
  const isDeleting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "delete";
  const isSaving = navigation.state === "submitting" && !isDeleting;
  const hasErrors = Boolean(actionData?.errors && Object.keys(actionData.errors).length);

  return (
    <main className="mcc-editor-page mcc-collection-editor-page">
      <Form className="mcc-editor-form" method="post" onChange={handleDirty}>
        <header className="mcc-editor-header">
          <div className="mcc-editor-header__topline">
            <Link to={collection ? `/collections/${collection.shortUrl}` : "/#collections"}>
              <span aria-hidden="true">←</span> {collection ? `Tillbaka till ${collection.headline}` : "Tillbaka till Collections"}
            </Link>
            {collection ? (
              <Link className="mcc-editor-preview-link" to={`/collections/${collection.shortUrl}`}>
                Visa i butik <span aria-hidden="true">↗</span>
              </Link>
            ) : null}
          </div>
          <div className="mcc-editor-header__title">
            <div>
              <p className="mcc-kicker">Ateljé / Collection</p>
              <h1>{collection ? `Redigera ${collection.headline}` : "Skapa en ny Collection"}</h1>
            </div>
          </div>
        </header>

        {hasErrors ? (
          <div className="mcc-editor-error-summary" role="alert">
            <strong>Det finns något kvar att ordna.</strong>
            <ul>
              {Object.entries(actionData?.errors ?? {}).map(([key, message]) => <li key={key}>{message}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="mcc-editor-workspace mcc-collection-editor-workspace">
          <CollectionImageUpload
            collection={collection}
            onDirty={handleDirty}
            onStateChange={handleUploadStateChange}
          />

          <div className="mcc-editor-copy-column">
            <section className="mcc-editor-section">
              <div className="mcc-editor-section__heading">
                <div>
                  <p className="mcc-editor-eyebrow">Grunduppgifter</p>
                  <h2>Collection</h2>
                </div>
                <span>01</span>
              </div>

              <div className="mcc-editor-fields">
                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>Namn <b>*</b></span>
                  <input
                    aria-invalid={Boolean(actionData?.errors?.headline)}
                    defaultValue={collection?.headline ?? ""}
                    name="headline"
                    onChange={(event) => {
                      if (!slugTouched) setSlug(slugify(event.target.value));
                    }}
                    placeholder="Till exempel Wanja"
                    required
                    type="text"
                  />
                  {actionData?.errors?.headline ? <small>{actionData.errors.headline}</small> : null}
                </label>

                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>URL-namn <b>*</b></span>
                  <span className="mcc-collection-editor-slug">
                    <span>/collections/</span>
                    <input
                      aria-invalid={Boolean(actionData?.errors?.shortUrl)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      name="shortUrl"
                      onChange={(event) => {
                        setSlugTouched(true);
                        setSlug(
                          event.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9-]/g, "")
                            .replace(/-+/g, "-")
                        );
                      }}
                      placeholder="wanja"
                      required
                      spellCheck={false}
                      type="text"
                      value={slug}
                    />
                  </span>
                  {actionData?.errors?.shortUrl ? <small>{actionData.errors.shortUrl}</small> : <small className="mcc-editor-field__hint">Används i länken. Små bokstäver och bindestreck.</small>}
                </label>
              </div>
            </section>

            <section className="mcc-editor-section">
              <div className="mcc-editor-section__heading">
                <div>
                  <p className="mcc-editor-eyebrow">Berättelse</p>
                  <h2>Texter</h2>
                </div>
                <span>02</span>
              </div>
              <div className="mcc-editor-fields">
                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>Kort beskrivning <b>*</b></span>
                  <textarea
                    aria-invalid={Boolean(actionData?.errors?.shortDescription)}
                    defaultValue={collection?.shortDescription ?? ""}
                    maxLength={240}
                    name="shortDescription"
                    placeholder="En kort rad som sätter känslan för Collection."
                    required
                    rows={3}
                  />
                  {actionData?.errors?.shortDescription ? <small>{actionData.errors.shortDescription}</small> : <small className="mcc-editor-field__hint">Visas som ingress i listningen.</small>}
                </label>
                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>Längre beskrivning</span>
                  <textarea
                    defaultValue={collection?.longDescription ?? ""}
                    maxLength={1600}
                    name="longDescription"
                    placeholder="Berätta mer om färg, form och uttryck."
                    rows={7}
                  />
                </label>
              </div>
            </section>

            <section className="mcc-editor-section">
              <div className="mcc-editor-section__heading">
                <div>
                  <p className="mcc-editor-eyebrow">Länkar</p>
                  <h2>Socialt</h2>
                </div>
                <span>03</span>
              </div>
              <div className="mcc-editor-fields">
                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>Instagram</span>
                  <input defaultValue={collection?.instagram ?? ""} name="instagram" placeholder="https://instagram.com/..." type="url" />
                </label>
                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>X / Twitter</span>
                  <input defaultValue={collection?.twitter ?? ""} name="twitter" placeholder="https://x.com/..." type="url" />
                </label>
              </div>
            </section>
          </div>
        </div>

        {collection ? (
          <section className="mcc-collection-danger">
            <div>
              <p className="mcc-editor-eyebrow">Riskzon</p>
              <h2>Ta bort Collection</h2>
              <p>
                {itemCount
                  ? `Detta tar även bort ${itemCount} ${itemCount === 1 ? "produkt" : "produkter"} som tillhör ${collection.headline}.`
                  : `${collection.headline} innehåller inga produkter.`}
              </p>
            </div>
            {!deleteConfirmation ? (
              <button onClick={() => setDeleteConfirmation(true)} type="button">Ta bort Collection</button>
            ) : (
              <div className="mcc-collection-danger__confirmation" role="alert">
                <strong>Är du helt säker?</strong>
                <span>Det går inte att ångra.</span>
                <div>
                  <button onClick={() => setDeleteConfirmation(false)} type="button">Avbryt</button>
                  <button disabled={isDeleting} name="intent" type="submit" value="delete">{isDeleting ? "Tar bort…" : "Ta bort permanent"}</button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        <div className="mcc-editor-savebar">
          <div aria-live="polite">
            <span className={dirty ? "is-dirty" : ""} />
            <p>
              <strong>{uploadSummary.busy ? "Bilden laddas upp" : dirty ? "Ändringar ej sparade" : "Redo att redigera"}</strong>
              <small>{uploadSummary.error ? "Bilden behöver din uppmärksamhet." : uploadSummary.busy ? "Du kan fortsätta skriva under tiden." : "Spara när allt känns klart."}</small>
            </p>
          </div>
          <button disabled={isSaving || isDeleting || uploadSummary.busy || !uploadSummary.ready} type="submit">
            <span>{isSaving ? "Sparar…" : collection ? "Spara ändringar" : "Skapa Collection"}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </Form>
    </main>
  );
}
