import {FREE_FREIGHT, FREIGHT_COST} from '~/utils/constants'

type Show = {
  show: (close: boolean) => void
}

export default function Terms({show}: Show) {
  return (
    <div
      className="fixed z-10 inset-0 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-start justify-center pb-20 pt-4 px-4 min-h-screen text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 bg-black bg-opacity-75 transition-opacity"
          aria-hidden="true"
        ></div>
        <span
          className="hidden sm:inline-block sm:align-middle sm:h-screen"
          aria-hidden="true"
        >
          &#8203;
        </span>
        <div className="inline-block align-bottom text-left bg-white rounded-lg shadow-xl overflow-hidden transform transition-all sm:align-middle sm:my-8 sm:w-full sm:max-w-lg">
          <div className="pb-4 pt-5 px-4 bg-white sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              <div className="mt-3 sm:ml-4 sm:mt-0 sm:text-left">
                <div className="mt-2">
                  <p className="mb-2 text-gray-600 text-sm">
                    Alla örhängen är gjorda för hand och är därför unika, detta
                    kan göra att örhängena skiljer sig lite åt i färg från bild
                    eller kan ha små bubblor i sig.
                  </p>
                  <h3 className="text-gray-900 text-lg">
                    Villkor och information
                  </h3>
                  <p className="text-gray-600 text-sm">
                    Innehållet i denna webbutik tillhandahålls, uppdateras och
                    hanteras av följande:
                    <br />
                    <br />
                    Moaclayco <br />
                    www.moaclayco.com
                    <br />
                    <br />
                    E-postadress: moaclayco@gmail.com<br/><br/>
                  </p>
                  <h3 className="text-gray-900 text-lg">
                    Betalning och priser
                  </h3>
                  <div className="text-gray-600 text-sm">
                    Alla priser är dagsaktuella och kan komma att ändras i
                    framtiden. Individuellt och aktuellt totalpris för din
                    beställning summeras i kassan, inklusive eventuella avgifter
                    för frakt och betalning. Vi erbjuder följande betalsätt:
                    <br />
                    <br />
                    <span className="font-semibold">
                      Kortbetalning via Stripe
                    </span>
                    <br />
                    Det är en av världens största och mest använda
                    betallösningar för onlinebutiker. Andra företag som använder
                    Stripe är till exempel H&M, Volvo och KRY.
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
                    Klarna Checkout gör det enkelt, flexibelt och tryggt för dig
                    att handla på nätet. Genom att besvara ett par frågor
                    identifierar du dig enkelt och du kan välja den betalmetod
                    som passar dig bäst. En finess med Klarna Checkout är att vi
                    skiljer på köp och betalning. Först bekräftar du ditt köp
                    och sedan väljer du hur du vill betala. Antingen med Klarna
                    faktura eller Klarna konto – eller med kort eller
                    banköverföring. Allt är lika säkert. Villkor för betalning
                    anges även i kassan under respektive betalningsalternativ.{' '}
                    <br />
                    <br />
                    <h3 className="text-gray-900 text-lg">
                      Leveranser och returer
                    </h3>
                    Vi erbjuder följande leveransmetoder:
                    <br />
                    Fast pris {FREIGHT_COST} SEK (gratis frakt över{' '}
                    {FREE_FREIGHT} SEK) för leveranser inom Sverige. Leverans
                    inom 15 dagar till din brevlåda.
                    <br />
                    <br />
                    Om leveransförsening uppstår meddelar vi dig detta genom
                    e-post. Du som kund har alltid rätt att häva köpet vid
                    leveransförseningar. Vi kommer att göra allt vi kan för att
                    fullfölja din beställning. Det kan finnas tillfällen som gör
                    det omöjligt att fullfölja beställningen, exempelvis då vår
                    leverantör eller speditör inte kan fullfölja deras åtagande
                    till oss. Vi förbehåller oss rätten att friskriva oss från
                    all ersättning till kund gällande leveransförseningar.
                    <br />
                    <br />
                    <h3 className="text-gray-900 text-lg">Returer</h3>
                    Returer erbjuds inte då örhänge är en hygienprodukt. Därför
                    har vi ingen ångerrätt.<br/><br/>

                    <h3 className="text-gray-900 text-lg">
                      Reklamationer
                    </h3>
                    Vid reklamation vänligen kontakta Moaclayco kundservice:
                    moaclayco@gmail.com
                    <br />
                    <br />
                    <h3 className="text-gray-900 text-lg">
                      Integritetspolicy
                    </h3>
                    När du lägger din beställning hos oss behöver du uppge vissa
                    personuppgifter. I samband med din beställning godkänner du
                    att vi lagrar och använder dina uppgifter i vår verksamhet
                    för att fullfölja avtalet gentemot dig. Du har enligt
                    personuppgiftslagen (PUL) rätt att få den information som vi
                    har registrerat om dig. Om den är felaktig, ofullständig
                    eller irrelevant kan du begära att informationen ska rättas
                    eller tas bort. Kontakta oss i så fall via e-post.
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="px-4 py-3 bg-gray-50 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              onClick={() => {
                show(false)
              }}
              type="button"
              className="inline-flex justify-center px-4 py-2 w-full text-white text-base font-medium bg-red-600 hover:bg-red-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Stäng
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
