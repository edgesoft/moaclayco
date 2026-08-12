import { useEffect } from "react";

type LoginModalProps = {
  configured: boolean;
  errorMessage?: string | null;
  onClose: () => void;
};

function GoogleLogo() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
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
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      aria-labelledby="login-modal-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/55 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl shadow-slate-950/30">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-800 via-emerald-600 to-amber-300" />

        <button
          aria-label="Stäng inloggningen"
          autoFocus
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M4.3 4.3a1 1 0 0 1 1.4 0L10 8.6l4.3-4.3a1 1 0 1 1 1.4 1.4L11.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 0 1-1.4-1.4L8.6 10 4.3 5.7a1 1 0 0 1 0-1.4Z" />
          </svg>
        </button>

        <div className="px-6 pb-7 pt-10 sm:px-9 sm:pb-9">
          <div className="mb-7 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-900 text-sm font-semibold tracking-tight text-white shadow-sm">
              MC
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
                Moa Clay Co
              </p>
              <p className="mt-0.5 text-sm text-slate-500">Administration</p>
            </div>
          </div>

          <h2
            className="text-3xl font-semibold tracking-tight text-slate-900"
            id="login-modal-title"
          >
            Välkommen tillbaka
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-600">
            Logga in med ett godkänt Google-konto för att fortsätta till
            administrationen.
          </p>

          {errorMessage ? (
            <div
              className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-800"
              role="alert"
            >
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-7">
            {configured ? (
              <a
                className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                href="/auth/google"
              >
                <GoogleLogo />
                Fortsätt med Google
              </a>
            ) : (
              <button
                className="flex min-h-[52px] w-full cursor-not-allowed items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-400"
                disabled
                type="button"
              >
                <GoogleLogo />
                Fortsätt med Google
              </button>
            )}
          </div>

          {!configured ? (
            <p className="mt-3 text-center text-xs leading-5 text-slate-500">
              Google-inloggningen behöver konfigureras innan den kan användas.
            </p>
          ) : null}

          <div className="mt-7 flex items-start gap-2.5 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-500">
            <svg aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-emerald-700" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 1.7a4 4 0 0 0-4 4V7H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1V5.7a4 4 0 0 0-4-4ZM12 7V5.7a2 2 0 1 0-4 0V7h4Z" clipRule="evenodd" />
            </svg>
            <span>
              Vi använder endast din verifierade e-postadress för att identifiera
              ditt administratörskonto.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
