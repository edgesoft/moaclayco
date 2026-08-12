import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useParams,
} from "react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CollectionProps, ItemProps } from "~/types";

type LoaderDataItemProps = {
  collection: CollectionProps;
  item: ItemProps | null;
};

type ActionData = {
  errors?: Record<string, string | undefined>;
};

type ProductInfoDraft = {
  id: string;
  name: string;
  value: string;
  noValue?: boolean;
};

type AdditionalItemDraft = {
  id: string;
  name: string;
  value: string | number;
};

type UploadStatus = "complete" | "uploading" | "processing" | "deleting" | "error";

type ImageDraft = {
  id: string;
  name: string;
  previewUrl?: string;
  url?: string;
  file?: File;
  progress: number;
  status: UploadStatus;
  error?: string;
  optimizedSize?: number;
};

type UploadSummary = {
  busy: boolean;
  completeCount: number;
  failedCount: number;
};

const MAX_IMAGE_SIZE = 18 * 1024 * 1024;
const MAX_IMAGES = 12;
const acceptedImagePattern = /\.(jpe?g|png|webp|heic|heif)$/i;

const productInfoOptions = [
  { label: "Längd", value: "Längd" },
  { label: "Bredd", value: "Bredd" },
  { label: "Vikt", value: "Vikt" },
  { label: "Storlek", value: "Storlek" },
  { label: "Diameter", value: "Diameter" },
  { label: "Höjd", value: "Höjd" },
  {
    label: "Lackad",
    value: "lackad med resin",
    noValue: true,
  },
];

const makeId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const fileNameFromUrl = (url: string) => {
  const cleanUrl = url.split("?")[0];
  return decodeURIComponent(cleanUrl.split("/").pop() || "Bild");
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
};

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d={direction === "left" ? "M15 10H5m4-4-4 4 4 4" : "M5 10h10m-4-4 4 4-4 4"} />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m6 6 8 8m0-8-8 8" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v2.75A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V15.5" />
    </svg>
  );
}

function getProductInfo(data: string): Omit<ProductInfoDraft, "id"> {
  if (data.includes(":")) {
    const separator = data.indexOf(":");
    return {
      name: data.slice(0, separator).trim(),
      value: data.slice(separator + 1).trim(),
    };
  }

  const option = productInfoOptions.find(
    (candidate) => candidate.value.toLowerCase() === data.trim().toLowerCase()
  );

  return {
    name: option?.label ?? "Detalj",
    value: data.trim(),
    noValue: true,
  };
}

function ProductInfoEditor({ item }: { item: ItemProps | null }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [noValue, setNoValue] = useState(false);
  const [productInfos, setProductInfos] = useState<ProductInfoDraft[]>(() =>
    (item?.productInfos ?? []).map((info) => ({ id: makeId(), ...getProductInfo(info) }))
  );

  const addInfo = () => {
    const trimmedName = name.trim();
    const trimmedValue = value.trim();
    if (!trimmedValue || (!noValue && !trimmedName)) return;

    setProductInfos((current) => [
      ...current,
      {
        id: makeId(),
        name: trimmedName || "Detalj",
        value: trimmedValue,
        noValue,
      },
    ]);
    setName("");
    setValue("");
    setNoValue(false);
  };

  const chooseOption = (option: (typeof productInfoOptions)[number]) => {
    setName(option.label);
    setNoValue(Boolean(option.noValue));
    setValue(option.noValue ? option.value : "");
  };

  return (
    <section className="mcc-editor-section mcc-editor-section--list">
      <div className="mcc-editor-section__heading">
        <div>
          <p className="mcc-editor-eyebrow">Specifikation</p>
          <h2>Material & detaljer</h2>
        </div>
        <span>{productInfos.length || "—"}</span>
      </div>

      <div className="mcc-editor-suggestions" aria-label="Vanliga egenskaper">
        {productInfoOptions.map((option) => (
          <button
            className={name === option.label ? "is-selected" : ""}
            key={option.label}
            onClick={() => chooseOption(option)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mcc-editor-inline-fields">
        <label>
          <span>Typ</span>
          <input
            onChange={(event) => {
              setName(event.target.value);
              setNoValue(false);
            }}
            placeholder="Till exempel Material"
            type="text"
            value={name}
          />
        </label>
        <label>
          <span>Värde</span>
          <input
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addInfo();
            }}
            placeholder="Till exempel Stengods"
            type="text"
            value={value}
          />
        </label>
        <button
          className="mcc-editor-add-row"
          disabled={!value.trim() || (!noValue && !name.trim())}
          onClick={addInfo}
          type="button"
        >
          Lägg till <span aria-hidden="true">＋</span>
        </button>
      </div>

      {productInfos.length ? (
        <ul className="mcc-editor-rows">
          {productInfos.map((info) => (
            <li key={info.id}>
              <span>{info.noValue ? "Egenskap" : info.name}</span>
              <strong>{info.value}</strong>
              <button
                aria-label={`Ta bort ${info.value}`}
                onClick={() =>
                  setProductInfos((current) =>
                    current.filter((candidate) => candidate.id !== info.id)
                  )
                }
                type="button"
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mcc-editor-empty-row">Inga detaljer tillagda ännu.</p>
      )}

      <input
        name="productInfos"
        readOnly
        type="hidden"
        value={JSON.stringify(
          productInfos.map(({ name: infoName, value: infoValue, noValue: infoNoValue }) => ({
            name: infoName,
            value: infoValue,
            noValue: infoNoValue,
          }))
        )}
      />
    </section>
  );
}

function AdditionalItemsEditor({ item }: { item: ItemProps | null }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [additionalItems, setAdditionalItems] = useState<AdditionalItemDraft[]>(() =>
    (item?.additionalItems ?? []).map((addition) => ({
      id: makeId(),
      name: addition.name,
      value: addition.price,
    }))
  );

  const addItem = () => {
    if (!name.trim() || !price.trim()) return;
    setAdditionalItems((current) => [
      ...current,
      { id: makeId(), name: name.trim(), value: price },
    ]);
    setName("");
    setPrice("");
  };

  return (
    <section className="mcc-editor-section mcc-editor-section--list">
      <div className="mcc-editor-section__heading">
        <div>
          <p className="mcc-editor-eyebrow">Valbart</p>
          <h2>Tillval</h2>
        </div>
        <span>{additionalItems.length || "—"}</span>
      </div>

      <div className="mcc-editor-suggestions" aria-label="Vanliga tillval">
        <button
          className={name === "Sterling silver 925" ? "is-selected" : ""}
          onClick={() => setName("Sterling silver 925")}
          type="button"
        >
          Sterling silver 925
        </button>
      </div>

      <div className="mcc-editor-inline-fields">
        <label>
          <span>Tillval</span>
          <input
            onChange={(event) => setName(event.target.value)}
            placeholder="Namn på tillval"
            type="text"
            value={name}
          />
        </label>
        <label>
          <span>Pris</span>
          <span className="mcc-editor-input-suffix">
            <input
              min="0"
              onChange={(event) => setPrice(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addItem();
              }}
              placeholder="0"
              step="1"
              type="number"
              value={price}
            />
            <span>SEK</span>
          </span>
        </label>
        <button
          className="mcc-editor-add-row"
          disabled={!name.trim() || !price.trim()}
          onClick={addItem}
          type="button"
        >
          Lägg till <span aria-hidden="true">＋</span>
        </button>
      </div>

      {additionalItems.length ? (
        <ul className="mcc-editor-rows">
          {additionalItems.map((addition) => (
            <li key={addition.id}>
              <span>Tillval</span>
              <strong>{addition.name}</strong>
              <em>{addition.value} SEK</em>
              <button
                aria-label={`Ta bort ${addition.name}`}
                onClick={() =>
                  setAdditionalItems((current) =>
                    current.filter((candidate) => candidate.id !== addition.id)
                  )
                }
                type="button"
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mcc-editor-empty-row">Inga tillval tillagda.</p>
      )}

      <input
        name="additionalItems"
        readOnly
        type="hidden"
        value={JSON.stringify(
          additionalItems.map(({ name: additionName, value: additionValue }) => ({
            name: additionName,
            value: additionValue,
          }))
        )}
      />
    </section>
  );
}

function FileUpload({
  item,
  onDirty,
  onStateChange,
}: {
  item: ItemProps | null;
  onDirty: () => void;
  onStateChange: (summary: UploadSummary) => void;
}) {
  const { collection = "" } = useParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRequestsRef = useRef(new Map<string, XMLHttpRequest>());
  const objectUrlsRef = useRef(new Set<string>());
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [images, setImages] = useState<ImageDraft[]>(() =>
    (item?.images ?? []).filter(Boolean).map((url) => ({
      id: makeId(),
      name: fileNameFromUrl(url),
      previewUrl: url,
      url,
      progress: 100,
      status: "complete",
    }))
  );

  const updateImage = useCallback((id: string, patch: Partial<ImageDraft>) => {
    setImages((current) =>
      current.map((image) => (image.id === id ? { ...image, ...patch } : image))
    );
  }, []);

  useEffect(() => {
    const completeCount = images.filter(
      (image) => image.status === "complete" && image.url
    ).length;
    const failedCount = images.filter((image) => image.status === "error").length;
    const busy = images.some(
      (image) => image.status === "uploading" || image.status === "processing" || image.status === "deleting"
    );
    onStateChange({ busy, completeCount, failedCount });
  }, [images, onStateChange]);

  useEffect(
    () => () => {
      xhrRequestsRef.current.forEach((request) => request.abort());
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    }, []
  );

  const uploadImage = useCallback(
    (id: string, file: File) => {
      updateImage(id, { error: undefined, progress: 2, status: "uploading" });

      const request = new XMLHttpRequest();
      xhrRequestsRef.current.set(id, request);
      request.open("POST", "/admin/upload");
      request.responseType = "json";

      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        updateImage(id, {
          progress: Math.max(4, Math.min(92, Math.round((event.loaded / event.total) * 92))),
        });
      };

      request.upload.onload = () =>
        updateImage(id, { progress: 94, status: "processing" });

      request.onerror = () => {
        xhrRequestsRef.current.delete(id);
        updateImage(id, {
          error: "Uppladdningen tappade kontakten. Försök igen.",
          progress: 0,
          status: "error",
        });
      };

      request.onabort = () => xhrRequestsRef.current.delete(id);

      request.onload = () => {
        xhrRequestsRef.current.delete(id);
        const response = request.response as
          | { key?: string; uniqueFileName?: string; sizeBytes?: number; error?: string }
          | null;

        if (request.status < 200 || request.status >= 300 || !response?.key) {
          updateImage(id, {
            error: response?.error ?? "Bilden kunde inte bearbetas. Prova en annan fil.",
            progress: 0,
            status: "error",
          });
          return;
        }

        const url = `https://38vabcm3.twic.pics/${response.key}`;
        updateImage(id, {
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
      formData.append("collectionRef", collection);
      request.send(formData);
    },
    [collection, updateImage]
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const availableSlots = Math.max(0, MAX_IMAGES - images.length);
      const selectedFiles = Array.from(fileList).slice(0, availableSlots);

      if (!availableSlots) {
        setNotice(`Du kan ha högst ${MAX_IMAGES} bilder per produkt.`);
        return;
      }

      onDirty();

      if (Array.from(fileList).length > availableSlots) {
        setNotice(`De första ${availableSlots} bilderna lades till. Max är ${MAX_IMAGES}.`);
      } else {
        setNotice(undefined);
      }

      const drafts = selectedFiles.map((file) => {
        const extensionAccepted = acceptedImagePattern.test(file.name);
        const sizeAccepted = file.size <= MAX_IMAGE_SIZE;
        const uploadAccepted = extensionAccepted && sizeAccepted;
        const previewUrl = extensionAccepted ? URL.createObjectURL(file) : undefined;
        if (previewUrl) objectUrlsRef.current.add(previewUrl);

        return {
          id: makeId(),
          name: file.name,
          previewUrl,
          file: uploadAccepted ? file : undefined,
          progress: 0,
          status: uploadAccepted ? "uploading" : "error",
          error: !extensionAccepted
            ? "Välj JPG, PNG, WebP eller HEIC."
            : !sizeAccepted
            ? `Filen är större än ${formatFileSize(MAX_IMAGE_SIZE)}.`
            : undefined,
        } satisfies ImageDraft;
      });

      setImages((current) => [...current, ...drafts]);
      drafts.forEach((draft) => {
        if (draft.status === "uploading" && draft.file) uploadImage(draft.id, draft.file);
      });
    },
    [images.length, onDirty, uploadImage]
  );

  const removeImage = async (image: ImageDraft) => {
    onDirty();
    const request = xhrRequestsRef.current.get(image.id);
    if (request) {
      request.abort();
      xhrRequestsRef.current.delete(image.id);
    }

    if (!image.url) {
      setImages((current) => current.filter((candidate) => candidate.id !== image.id));
      return;
    }

    updateImage(image.id, { error: undefined, status: "deleting" });
    const formData = new FormData();
    formData.append("imageName", image.name);
    formData.append("collection", collection);
    formData.append("id", item?._id ?? "");

    try {
      const response = await fetch("/admin/upload/delete", {
        body: formData,
        method: "DELETE",
      });
      const result = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;

      if (!response.ok || !result?.success) {
        updateImage(image.id, {
          error: result?.error ?? "Bilden kunde inte tas bort. Försök igen.",
          status: "complete",
        });
        return;
      }

      setImages((current) => current.filter((candidate) => candidate.id !== image.id));
    } catch {
      updateImage(image.id, {
        error: "Bilden kunde inte tas bort. Kontrollera anslutningen.",
        status: "complete",
      });
    }
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= images.length) return;
    onDirty();
    setImages((current) => {
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const completeImages = useMemo(
    () => images.filter((image) => image.status === "complete" && image.url),
    [images]
  );

  return (
    <section className="mcc-editor-section mcc-editor-media">
      <div className="mcc-editor-section__heading">
        <div>
          <p className="mcc-editor-eyebrow">Bildserie</p>
          <h2>Bilder</h2>
        </div>
        <span>{completeImages.length}/{MAX_IMAGES}</span>
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
          addFiles(event.dataTransfer.files);
        }}
      >
        <span className="mcc-editor-dropzone__icon"><UploadIcon /></span>
        <div>
          <strong>{dragging ? "Släpp bilderna här" : "Dra in bilder eller välj från enheten"}</strong>
          <small>JPG, PNG, WebP eller HEIC · upp till {formatFileSize(MAX_IMAGE_SIZE)}</small>
        </div>
        <button onClick={() => fileInputRef.current?.click()} type="button">
          Välj bilder <span aria-hidden="true">＋</span>
        </button>
        <input
          accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="mcc-editor-visually-hidden"
          multiple
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>

      {notice ? <p className="mcc-editor-upload-notice" role="status">{notice}</p> : null}

      {images.length ? (
        <ol className="mcc-editor-image-grid">
          {images.map((image, index) => {
            const isBusy = image.status === "uploading" || image.status === "processing" || image.status === "deleting";
            return (
              <li className={`mcc-editor-image is-${image.status}`} key={image.id}>
                <div className="mcc-editor-image__preview">
                  {image.previewUrl ? <img alt="" src={image.previewUrl} /> : <span>Ingen förhandsvisning</span>}
                  {isBusy ? (
                    <div className="mcc-editor-image__progress">
                      <span>{image.status === "processing" ? "Optimerar" : image.status === "deleting" ? "Tar bort" : "Laddar upp"}</span>
                      {image.status !== "deleting" ? <strong>{image.progress}%</strong> : null}
                      <i style={{ "--upload-progress": `${image.progress}%` } as React.CSSProperties} />
                    </div>
                  ) : null}
                  {image.status === "complete" ? (
                    <span className="mcc-editor-image__ready" aria-label="Uppladdad">✓</span>
                  ) : null}
                </div>

                <div className="mcc-editor-image__meta">
                  <div>
                    <span>{index === 0 ? "Omslagsbild" : `Bild ${index + 1}`}</span>
                    <strong title={image.name}>{image.status === "complete" ? "Klar" : image.name}</strong>
                    {image.optimizedSize ? <small>Optimerad · {formatFileSize(image.optimizedSize)}</small> : null}
                  </div>
                  <div className="mcc-editor-image__actions">
                    <button
                      aria-label="Flytta bilden bakåt"
                      disabled={index === 0 || isBusy}
                      onClick={() => moveImage(index, -1)}
                      type="button"
                    >
                      <ArrowIcon direction="left" />
                    </button>
                    <button
                      aria-label="Flytta bilden framåt"
                      disabled={index === images.length - 1 || isBusy}
                      onClick={() => moveImage(index, 1)}
                      type="button"
                    >
                      <ArrowIcon direction="right" />
                    </button>
                    <button
                      aria-label={`Ta bort ${image.name}`}
                      disabled={image.status === "deleting"}
                      onClick={() => removeImage(image)}
                      type="button"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                </div>

                {image.error ? (
                  <div className="mcc-editor-image__error" role="alert">
                    <span>{image.error}</span>
                    {image.file && image.status === "error" ? (
                      <button
                        onClick={() => {
                          onDirty();
                          uploadImage(image.id, image.file!);
                        }}
                        type="button"
                      >
                        Försök igen
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mcc-editor-media-empty">
          <span>01</span>
          <p>Den första bilden blir omslag i listningen. Du kan ändra ordningen när bilderna är uppladdade.</p>
        </div>
      )}

      <p className="mcc-editor-upload-status" aria-live="polite">
        {images.some((image) => image.status === "uploading" || image.status === "processing")
          ? "Bilderna bearbetas. Du kan fortsätta fylla i resten under tiden."
          : completeImages.length
          ? `${completeImages.length} ${completeImages.length === 1 ? "bild är" : "bilder är"} redo att sparas.`
          : "Lägg till minst en bild för att kunna spara produkten."}
      </p>

      <input name="images" readOnly type="hidden" value={completeImages.map((image) => image.url).join(",")} />
    </section>
  );
}

export default function ItemComponent() {
  const actionData = useActionData<ActionData>();
  const { collection, item } = useLoaderData<LoaderDataItemProps>();
  const navigation = useNavigation();
  const [dirty, setDirty] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary>({
    busy: false,
    completeCount: item?.images.filter(Boolean).length ?? 0,
    failedCount: 0,
  });
  const handleUploadStateChange = useCallback((summary: UploadSummary) => {
    setUploadSummary(summary);
  }, []);
  const handleEditorDirty = useCallback(() => setDirty(true), []);
  const isSubmitting = navigation.state === "submitting";
  const hasErrors = Boolean(actionData?.errors && Object.keys(actionData.errors).length);
  const saveDisabled = isSubmitting || uploadSummary.busy || uploadSummary.completeCount === 0;

  return (
    <main className="mcc-editor-page">
      <Form className="mcc-editor-form" method="post" onChange={() => setDirty(true)}>
        <header className="mcc-editor-header">
          <div className="mcc-editor-header__topline">
            <Link to={`/collections/${collection.shortUrl}${item ? `#${item._id}` : ""}`}>
              <span aria-hidden="true">←</span> Tillbaka till {collection.headline}
            </Link>
            {item ? (
              <Link className="mcc-editor-preview-link" to={`/collections/${collection.shortUrl}#${item._id}`}>
                Visa i butik <span aria-hidden="true">↗</span>
              </Link>
            ) : null}
          </div>
          <div className="mcc-editor-header__title">
            <div>
              <p className="mcc-kicker">Ateljé / {collection.headline}</p>
              <h1>{item ? `Redigera ${item.headline}` : "Skapa en ny produkt"}</h1>
            </div>
          </div>
        </header>

        {hasErrors ? (
          <div className="mcc-editor-error-summary" role="alert">
            <strong>Det finns något kvar att ordna.</strong>
            <ul>
              {Object.entries(actionData?.errors ?? {}).map(([key, message]) => (
                <li key={key}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mcc-editor-workspace">
          <FileUpload
            item={item}
            onDirty={handleEditorDirty}
            onStateChange={handleUploadStateChange}
          />

          <div className="mcc-editor-copy-column">
            <section className="mcc-editor-section">
              <div className="mcc-editor-section__heading">
                <div>
                  <p className="mcc-editor-eyebrow">Grunduppgifter</p>
                  <h2>Produkt</h2>
                </div>
                <span>01</span>
              </div>
              <div className="mcc-editor-fields">
                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>Namn <b>*</b></span>
                  <input
                    aria-invalid={Boolean(actionData?.errors?.headline)}
                    defaultValue={item?.headline ?? ""}
                    name="headline"
                    placeholder="Till exempel Moln"
                    required
                    type="text"
                  />
                  {actionData?.errors?.headline ? <small>{actionData.errors.headline}</small> : null}
                </label>

                <label className="mcc-editor-field">
                  <span>Pris <b>*</b></span>
                  <span className="mcc-editor-input-suffix">
                    <input
                      aria-invalid={Boolean(actionData?.errors?.itemPrice)}
                      defaultValue={item?.price ?? ""}
                      min="0"
                      name="itemPrice"
                      placeholder="0"
                      required
                      step="1"
                      type="number"
                    />
                    <span>SEK</span>
                  </span>
                  {actionData?.errors?.itemPrice ? <small>{actionData.errors.itemPrice}</small> : null}
                </label>

                <label className="mcc-editor-field">
                  <span>Antal i lager <b>*</b></span>
                  <input
                    aria-invalid={Boolean(actionData?.errors?.amount)}
                    defaultValue={item?.amount ?? ""}
                    min="0"
                    name="amount"
                    placeholder="1"
                    required
                    step="1"
                    type="number"
                  />
                  {actionData?.errors?.amount ? <small>{actionData.errors.amount}</small> : null}
                </label>

                <label className="mcc-editor-field mcc-editor-field--wide">
                  <span>Instagram-länk</span>
                  <input
                    defaultValue={item?.instagram ?? ""}
                    name="instagram"
                    placeholder="https://instagram.com/..."
                    type="url"
                  />
                </label>
              </div>
            </section>

            <section className="mcc-editor-section">
              <div className="mcc-editor-section__heading">
                <div>
                  <p className="mcc-editor-eyebrow">Berättelse</p>
                  <h2>Beskrivning</h2>
                </div>
                <span>02</span>
              </div>
              <label className="mcc-editor-field mcc-editor-field--wide">
                <span>Text i listningen</span>
                <textarea
                  defaultValue={item?.longDescription ?? ""}
                  maxLength={640}
                  name="longDescription"
                  placeholder="Beskriv formen, känslan eller hur produkten är gjord."
                  rows={7}
                />
                <small className="mcc-editor-field__hint">Kort och konkret fungerar bäst i listningen.</small>
              </label>
            </section>
          </div>
        </div>

        <div className="mcc-editor-secondary-grid">
          <ProductInfoEditor item={item} />
          <AdditionalItemsEditor item={item} />
        </div>

        <div className="mcc-editor-savebar">
          <div aria-live="polite">
            <span className={dirty ? "is-dirty" : ""} />
            <p>
              <strong>{uploadSummary.busy ? "Bilder laddas upp" : dirty ? "Ändringar ej sparade" : "Redo att redigera"}</strong>
              <small>
                {uploadSummary.failedCount
                  ? `${uploadSummary.failedCount} bild behöver din uppmärksamhet.`
                  : uploadSummary.busy
                  ? "Du kan fortsätta arbeta medan vi optimerar."
                  : "Spara när allt känns klart."}
              </small>
            </p>
          </div>
          <button disabled={saveDisabled} type="submit">
            <span>{isSubmitting ? "Sparar…" : item ? "Spara ändringar" : "Skapa produkt"}</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </Form>
    </main>
  );
}
