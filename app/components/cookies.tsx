import { useEffect, useRef } from "react";
import useLocalStorage from "~/hooks/useLocalStorage";

function CookieIllustration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48">
      <path d="M39.5 18.2A10.7 10.7 0 0 1 29.8 8.5 16.7 16.7 0 1 0 39.5 18.2Z" />
      <circle cx="17" cy="19" r="1.7" />
      <circle cx="24.5" cy="29.5" r="2" />
      <circle cx="14" cy="31.5" r="1.4" />
      <circle cx="27.5" cy="17" r="1.3" />
    </svg>
  );
}

const Cookies = (): React.ReactElement | null => {
  const [accepted, setAccepted, loaded] = useLocalStorage<boolean>(
    "accept-cookies",
    false
  );
  const acceptButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!loaded || accepted) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    acceptButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [accepted, loaded]);

  if (!loaded) {
    return <div aria-hidden="true" className="mcc-cookie-hydration-guard" />;
  }

  if (accepted) return null;

  return (
    <div
      aria-labelledby="mcc-cookie-title"
      aria-modal="true"
      className="mcc-cookie-modal"
      role="dialog"
    >
      <div aria-hidden="true" className="mcc-cookie-backdrop" />
      <div className="mcc-cookie-dialog">
        <div className="mcc-cookie-illustration">
          <CookieIllustration />
        </div>

        <div className="mcc-cookie-copy">
          <p className="mcc-cookie-kicker">En liten sak först</p>
          <h2 id="mcc-cookie-title">Cookies, för en smidigare butik.</h2>
          <p>
            Vi använder nödvändiga cookies för att varukorgen och köpet ska
            fungera. De hjälper oss också att ge dig en bättre upplevelse när
            du rör dig mellan våra Collections.
          </p>
        </div>

        <div className="mcc-cookie-actions">
          <p>Du kan rensa sparade cookies i din webbläsare när som helst.</p>
          <button
            onClick={() => setAccepted(true)}
            ref={acceptButtonRef}
            type="button"
          >
            Acceptera cookies
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Cookies;
