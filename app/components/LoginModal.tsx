import { useEffect, useRef } from "react";
import ArrowIcon from "./ArrowIcon";
import ViewportPortal from "./ViewportPortal";

type LoginModalProps = {
  configured: boolean;
  errorMessage?: string | null;
  onClose: () => void;
};

function GoogleLogo() {
  return (
    <svg aria-hidden="true" className="mcc-login-google" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.93A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.63.39 3.17 1.04 4.55l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.88-2.88A9.66 9.66 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
      />
    </svg>
  );
}

export default function LoginModal({
  configured,
  errorMessage,
  onClose,
}: LoginModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const modal = (
    <div
      aria-labelledby="login-modal-title"
      aria-modal="true"
      className="mcc-login-modal"
      role="dialog"
    >
      <button
        aria-label="Stäng inloggningen"
        className="mcc-login-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div className="mcc-login-dialog" ref={dialogRef}>
        <button
          aria-label="Stäng inloggningen"
          className="mcc-login-close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>

        <div className="mcc-login-brand">
          <span aria-hidden="true" className="mcc-login-brand-mark">
            MC
          </span>
          <div>
            <p>Moa Clay Co</p>
            <span>Ateljéns administration</span>
          </div>
        </div>

        <div className="mcc-login-copy">
          <p className="mcc-login-kicker">Välkommen till ateljén</p>
          <h2 id="login-modal-title">Fint att se dig igen.</h2>
          <p>
            Logga in med ett godkänt Google-konto för att fortsätta till
            administrationen.
          </p>
        </div>

        {errorMessage ? (
          <div className="mcc-login-error" role="alert">
            <span aria-hidden="true">!</span>
            <p>{errorMessage}</p>
          </div>
        ) : null}

        <div className="mcc-login-action">
          {configured ? (
            <a href="/auth/google">
              <GoogleLogo />
              Fortsätt med Google
              <span aria-hidden="true" className="mcc-login-action-arrow">
                <ArrowIcon />
              </span>
            </a>
          ) : (
            <button disabled type="button">
              <GoogleLogo />
              Fortsätt med Google
            </button>
          )}
        </div>

        {!configured ? (
          <p className="mcc-login-configuration">
            Google-inloggningen behöver konfigureras innan den kan användas.
          </p>
        ) : null}

        <p className="mcc-login-privacy">
          <span aria-hidden="true">◇</span>
          Vi använder endast din verifierade e-postadress för att identifiera
          ditt administratörskonto.
        </p>
      </div>
    </div>
  );

  return <ViewportPortal fallback={modal}>{modal}</ViewportPortal>;
}
