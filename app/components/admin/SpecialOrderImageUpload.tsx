import { useRef, useState } from "react";

type Props = {
  className?: string;
  currentImage?: string;
  label: string;
  onComplete?: (url: string) => void;
  orderId: string;
  purpose: "design" | "final";
};

const createDraftId = () =>
  `special-${crypto.randomUUID().replaceAll("-", "")}`;

export default function SpecialOrderImageUpload({
  className = "",
  currentImage,
  label,
  onComplete,
  orderId,
  purpose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const upload = (file: File) => {
    setError(undefined);
    setProgress(2);
    setUploading(true);
    const request = new XMLHttpRequest();
    request.open("POST", "/admin/special-order-image");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      setProgress(Math.min(92, Math.max(3, Math.round((event.loaded / event.total) * 92))));
    };
    request.upload.onload = () => setProgress(95);
    request.onerror = () => {
      setError("Uppladdningen tappade kontakten. Försök igen.");
      setUploading(false);
      setProgress(0);
    };
    request.onabort = () => {
      setError("Uppladdningen avbröts. Försök igen.");
      setUploading(false);
      setProgress(0);
    };
    request.onload = () => {
      const response = request.response as { error?: string; url?: string } | null;
      if (request.status < 200 || request.status >= 300 || !response?.url) {
        setError(response?.error ?? "Bilden kunde inte laddas upp.");
        setUploading(false);
        setProgress(0);
        return;
      }
      setProgress(100);
      setUploading(false);
      onComplete?.(response.url);
    };
    const formData = new FormData();
    formData.append("draftId", createDraftId());
    formData.append("file", file);
    formData.append("orderId", orderId);
    formData.append("purpose", purpose);
    request.send(formData);
  };

  return (
    <div className={`special-image-upload ${className}`.trim()}>
      <input
        accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />
      <button disabled={uploading} onClick={() => inputRef.current?.click()} type="button">
        {uploading
          ? progress < 95
            ? "Laddar upp…"
            : "Bearbetar bilden…"
          : currentImage
            ? `Byt ${label.toLocaleLowerCase("sv-SE")}`
            : label}
      </button>
      {uploading ? (
        <div className="special-image-upload__status" aria-live="polite">
          <span className="special-image-upload__progress-meta">
            <span>{progress < 95 ? "Laddar upp" : "Bearbetar"}</span>
            <strong>{progress}%</strong>
          </span>
          <span
            aria-label={`${progress} procent uppladdat`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress}
            className="special-image-upload__progress"
            role="progressbar"
          >
            <i style={{ width: `${progress}%` }} />
          </span>
        </div>
      ) : null}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
