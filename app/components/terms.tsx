import { useEffect, useRef } from "react";
import { FREE_FREIGHT, FREIGHT_COST } from "~/utils/constants";
import { theme } from "./Theme";
import ViewportPortal from "./ViewportPortal";

type Show = {
  show: (close: boolean) => void;
};

export default function Terms({ show }: Show) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        show(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (focusable.length === 0) return;

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

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [show]);

  return (
    <ViewportPortal>
      <div
        className="mcc-terms-modal fixed inset-0"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true"
      >
        <div
          className="mcc-terms-backdrop fixed inset-0 transition-opacity"
          aria-hidden="true"
          onClick={() => show(false)}
        />
        <div className="mcc-terms-modal__positioner">
          <div className="mcc-terms-dialog" ref={dialogRef}>
            <header className="mcc-terms-toolbar">
              <h2 className="mcc-terms-title" id="modal-title">
                Villkor
              </h2>
              <button
                aria-label="Stäng villkoren"
                className="mcc-terms-icon-close"
                onClick={() => show(false)}
                ref={closeButtonRef}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <div className="mcc-terms-scroll">
              <div className="mcc-terms-content pb-4 pt-5 px-4 sm:p-6 sm:pb-4">
              <div className="sm:flex sm:items-start">
                <div className="mt-3 sm:ml-4 sm:mt-0 sm:text-left">
                  <div className="mt-2">
                    <p className="mb-2 text-gray-600 text-sm">
                      Alla örhängen är gjorda för hand och är därför unika,
                      detta kan göra att örhängena skiljer sig lite åt i färg
                      från bild eller kan ha små bubblor i sig.
                    </p>
                    <h3 className="text-gray-900 text-lg">
                      Villkor och information
                    </h3>
                    <p className="text-gray-600 text-sm">
                      Innehållet i denna webbutik tillhandahålls, uppdateras och
                      hanteras av följande:
                      <br />
                      <br />
                      {theme?.title} <br />
                      {theme?.primaryDomain}
                      <br />
                      <br />
                      E-postadress: {theme?.email}
                      <br />
                      <br />
                    </p>
                    <h3 className="text-gray-900 text-lg">
                      Betalning och priser
                    </h3>
                    <div className="text-gray-600 text-sm">
                      Alla priser är dagsaktuella och kan komma att ändras i
                      framtiden. Individuellt och aktuellt totalpris för din
                      beställning summeras i kassan, inklusive eventuella
                      avgifter för frakt och betalning. Vi erbjuder följande
                      betalsätt:
                      <br />
                      <br />
                      <span className="font-semibold">
                        Kortbetalning via Stripe
                      </span>
                      <br />
                      Det är en av världens största och mest använda
                      betallösningar för onlinebutiker. Andra företag som
                      använder Stripe är till exempel H&M, Volvo och KRY.
                      <br />
                      <br />
                      <span className="font-semibold">Google Pay</span>
                      <br />
                      <br />
                      <span className="font-semibold">Apple Pay</span>
                      <br />
                      <br />
                      <span className="font-semibold">Klarna Checkout</span>
                      <br />
                      Klarna Checkout gör det enkelt, flexibelt och tryggt för
                      dig att handla på nätet. Genom att besvara ett par frågor
                      identifierar du dig enkelt och du kan välja den betalmetod
                      som passar dig bäst. En finess med Klarna Checkout är att
                      vi skiljer på köp och betalning. Först bekräftar du ditt
                      köp och sedan väljer du hur du vill betala. Antingen med
                      Klarna faktura eller Klarna konto – eller med kort eller
                      banköverföring. Allt är lika säkert. Villkor för betalning
                      anges även i kassan under respektive betalningsalternativ.{" "}
                      <br />
                      <br />
                      <h3 className="text-gray-900 text-lg">
                        Leveranser och returer
                      </h3>
                      Vi erbjuder följande leveransmetoder:
                      <br />
                      Fast pris {FREIGHT_COST} SEK (gratis frakt över{" "}
                      {FREE_FREIGHT} SEK) för leveranser inom Sverige. Leverans
                      inom 15 dagar till din brevlåda.
                      <br />
                      <br />
                      Om leveransförsening uppstår meddelar vi dig detta genom
                      e-post. Du som kund har alltid rätt att häva köpet vid
                      leveransförseningar. Vi kommer att göra allt vi kan för
                      att fullfölja din beställning. Det kan finnas tillfällen
                      som gör det omöjligt att fullfölja beställningen,
                      exempelvis då vår leverantör eller speditör inte kan
                      fullfölja deras åtagande till oss. Vi förbehåller oss
                      rätten att friskriva oss från all ersättning till kund
                      gällande leveransförseningar.
                      <br />
                      <br />
                      <h3 className="text-gray-900 text-lg">Returer</h3>
                      Returer erbjuds inte då örhänge är en hygienprodukt.
                      Därför har vi ingen ångerrätt.
                      <br />
                      <br />
                      <h3 className="text-gray-900 text-lg">Reklamationer</h3>
                      Vid reklamation vänligen kontakta {theme?.title}{" "}
                      kundservice:
                      {theme?.email}
                      <br />
                      <br />
                      <h3 className="text-gray-900 text-lg">
                        Integritetspolicy
                      </h3>
                      När du lägger din beställning hos oss behöver du uppge
                      vissa personuppgifter. I samband med din beställning
                      godkänner du att vi lagrar och använder dina uppgifter i
                      vår verksamhet för att fullfölja avtalet gentemot dig. Du
                      har enligt personuppgiftslagen (PUL) rätt att få den
                      information som vi har registrerat om dig. Om den är
                      felaktig, ofullständig eller irrelevant kan du begära att
                      informationen ska rättas eller tas bort. Kontakta oss i så
                      fall via e-post.
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </div>
            <div className="mcc-terms-footer">
              <button
                onClick={() => show(false)}
                type="button"
                className="mcc-terms-close"
              >
                Stäng
              </button>
            </div>
          </div>
        </div>
      </div>
    </ViewportPortal>
  );
}
