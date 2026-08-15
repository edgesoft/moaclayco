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
import ArrowIcon from "~/components/ArrowIcon";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import CollectionRemovalFlow from "~/components/admin/CollectionRemovalFlow";
import { cleanupImageDraftUrl, createImageDraftId } from "~/utils/imageDraft.shared";
import {
  acceptedImageFileNamePattern,
  MAX_IMAGE_SIZE,
} from "~/utils/imageUpload.shared";

type LoaderData = {
  collection: (CollectionProps & { _id: string }) | null;
  itemCount: number;
};

type ActionData = {
  errors?: Record<string, string | undefined>;
  intent?: string;
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
  onStateChange,
}: {
  collection: LoaderData["collection"];
  onStateChange: (summary: UploadSummary) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | undefined>(undefined);
  const objectUrlsRef = useRef(new Set<string>());
  const draftIdRef = useRef("");
  const draftIdInputRef = useRef<HTMLInputElement>(null);
  const draftUrlsRef = useRef(new Set<string>());
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
      draftUrlsRef.current.forEach((url) => {
        void cleanupImageDraftUrl(draftIdRef.current, url, true);
      });
    }, []
  );

  const releaseObjectUrl = useCallback((url?: string) => {
    if (!url || !objectUrlsRef.current.has(url)) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  }, []);

  const releaseDraftUrl = useCallback((url?: string) => {
    if (!url || !draftUrlsRef.current.has(url)) return;
    draftUrlsRef.current.delete(url);
    void cleanupImageDraftUrl(draftIdRef.current, url);
  }, []);

  const ensureDraftId = useCallback(() => {
    if (!draftIdRef.current) {
      draftIdRef.current = createImageDraftId();
      if (draftIdInputRef.current) {
        draftIdInputRef.current.value = draftIdRef.current;
      }
    }
    return draftIdRef.current;
  }, []);

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
        | { error?: string; key?: string; sizeBytes?: number; uniqueFileName?: string; url?: string }
        | null;
      if (request.status < 200 || request.status >= 300 || !response?.url) {
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

      releaseObjectUrl(previewUrl);
      const url = response.url;
      draftUrlsRef.current.add(url);
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
    formData.append("draftId", ensureDraftId());
    request.send(formData);
  }, [ensureDraftId, releaseObjectUrl]);

  const chooseFile = useCallback(
    (file?: File) => {
      if (!file) return;
      const extensionAccepted = acceptedImageFileNamePattern.test(file.name);
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

      draftUrlsRef.current.forEach((url) => releaseDraftUrl(url));
      releaseObjectUrl(image?.previewUrl);
      uploadFile(file, previewUrl);
    },
    [image, releaseDraftUrl, releaseObjectUrl, uploadFile]
  );

  const removeImage = () => {
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDraftUrl(image?.url);
    releaseObjectUrl(image?.previewUrl);
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
        <span>01</span>
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
          {image ? "Välj en annan" : "Välj bild"} <span aria-hidden="true"><PlusMinusIcon /></span>
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
              {image.status === "complete" ? null : <strong>{image.name}</strong>}
            </div>
            <button
              aria-label="Ta bort Collection-bilden"
              className="mcc-collection-editor-remove-image"
              disabled={busy}
              onClick={removeImage}
              type="button"
            >
              <span>Ta bort bild</span>
              <span aria-hidden="true"><PlusMinusIcon operation="minus" /></span>
            </button>
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

      <input name="image" readOnly type="hidden" value={image?.status === "complete" ? image.url ?? "" : ""} />
      <input defaultValue="" name="imageDraftId" ref={draftIdInputRef} type="hidden" />
    </section>
  );
}

export default function CollectionEditor() {
  const { collection, itemCount } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [slug, setSlug] = useState(collection?.shortUrl ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(collection));
  const [uploadSummary, setUploadSummary] = useState<UploadSummary>({
    busy: false,
    error: false,
    ready: Boolean(collection?.image),
  });
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
      <Form
        className="mcc-editor-form"
        id="mcc-collection-editor-form"
        method="post"
      >
        <header className="mcc-editor-header">
          <div className="mcc-editor-header__topline">
            <Link to={collection ? `/collections/${collection.shortUrl}` : "/#collections"}>
              <span aria-hidden="true"><ArrowIcon direction="left" /></span> {collection ? `Tillbaka till ${collection.headline}` : "Tillbaka till Collections"}
            </Link>
            {collection ? (
              <Link className="mcc-editor-preview-link" to={`/collections/${collection.shortUrl}`}>
                Visa i butik <span aria-hidden="true"><ArrowIcon direction="up-right" /></span>
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
                  ? `${itemCount} ${itemCount === 1 ? "produkt behöver" : "produkter behöver"} flyttas eller tas bort från katalogen innan ${collection.headline} kan tas bort.`
                  : `${collection.headline} innehåller inga produkter.`}
              </p>
            </div>
            <CollectionRemovalFlow
              collectionHeadline={collection.headline}
              collectionRef={collection.shortUrl}
              disabled={isDeleting || uploadSummary.busy}
              error={
                actionData?.intent === "delete"
                  ? actionData.errors?.form
                  : undefined
              }
              isDeleting={isDeleting}
              itemCount={itemCount}
            />
          </section>
        ) : null}

        <div className="mcc-editor-savebar">
          <button disabled={isSaving || isDeleting || uploadSummary.busy || !uploadSummary.ready} type="submit">
            <span>{isSaving ? "Sparar…" : collection ? "Spara ändringar" : "Skapa Collection"}</span>
            <span aria-hidden="true"><ArrowIcon /></span>
          </button>
        </div>
      </Form>
    </main>
  );
}
