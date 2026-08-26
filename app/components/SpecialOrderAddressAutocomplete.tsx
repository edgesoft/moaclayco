import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  swedishAddressFromGoogle,
  type GoogleAddressComponent,
  type SwedishAddress,
} from "~/utils/googleAddress";
import ArrowIcon from "~/components/ArrowIcon";

type Place = {
  addressComponents?: GoogleAddressComponent[];
  fetchFields: (options: { fields: string[] }) => Promise<void>;
};

type PlacePrediction = {
  mainText?: { text?: string };
  placeId?: string;
  secondaryText?: { text?: string };
  text?: { text?: string };
  toPlace: () => Place;
};

type AutocompleteSuggestion = {
  placePrediction?: PlacePrediction;
};

type PlacesLibrary = {
  AutocompleteSessionToken: new () => unknown;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: {
      includedRegionCodes: string[];
      input: string;
      language: string;
      region: string;
      sessionToken: unknown;
    }) => Promise<{ suggestions: AutocompleteSuggestion[] }>;
  };
};

declare global {
  interface Window {
    __moaclaycoGoogleMapsReady?: () => void;
    google?: {
      maps?: {
        importLibrary?: (name: "places") => Promise<unknown>;
      };
    };
  }
}

let placesLibraryPromise: Promise<PlacesLibrary> | null = null;
let loadedKey = "";
const GOOGLE_MAPS_CALLBACK = "__moaclaycoGoogleMapsReady";

const loadPlacesLibrary = (apiKey: string) => {
  if (placesLibraryPromise && loadedKey === apiKey) return placesLibraryPromise;

  loadedKey = apiKey;
  placesLibraryPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      resolve();
      return;
    }

    const onLoad = () => {
      window.__moaclaycoGoogleMapsReady = undefined;
      resolve();
    };
    const onError = () => {
      window.__moaclaycoGoogleMapsReady = undefined;
      document.querySelector("script[data-special-order-google-maps]")?.remove();
      reject(new Error("Google Maps could not be loaded"));
    };
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-special-order-google-maps]"
    );
    window.__moaclaycoGoogleMapsReady = onLoad;

    if (existing) {
      existing.addEventListener("error", onError, { once: true });
      return;
    }

    const script = document.createElement("script");
    const query = new URLSearchParams({
      callback: GOOGLE_MAPS_CALLBACK,
      key: apiKey,
      language: "sv",
      libraries: "places",
      loading: "async",
      region: "SE",
      v: "weekly",
    });
    script.async = true;
    script.dataset.specialOrderGoogleMaps = "true";
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.src = `https://maps.googleapis.com/maps/api/js?${query}`;
    script.addEventListener("error", onError, { once: true });
    document.head.append(script);
  }).then(async () => {
    const library = await window.google?.maps?.importLibrary?.("places");
    if (!library) throw new Error("Google Places is not available");
    return library as PlacesLibrary;
  }).catch((error) => {
    placesLibraryPromise = null;
    loadedKey = "";
    throw error;
  });

  return placesLibraryPromise;
};

type Props = {
  apiKey: string;
  className?: string;
  error?: string;
  label: string;
  name?: string;
  onAddressSelect: (address: SwedishAddress) => void;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  value: string;
};

export default function SpecialOrderAddressAutocomplete({
  apiKey,
  className,
  error,
  label,
  name = "postaddress",
  onAddressSelect,
  onChange,
  placeholder,
  required,
  value,
}: Props) {
  const id = useId();
  const listboxId = `${id}-suggestions`;
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestNumberRef = useRef(0);
  const sessionTokenRef = useRef<unknown>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);

  const open = focused && (failed || suggestions.length > 0);

  useEffect(() => {
    const query = value.trim();
    if (!apiKey || !focused || query.length < 3) {
      return;
    }

    const currentRequest = ++requestNumberRef.current;
    const timer = window.setTimeout(async () => {
      setFailed(false);
      setLoading(true);
      try {
        const library = await loadPlacesLibrary(apiKey);
        sessionTokenRef.current ??= new library.AutocompleteSessionToken();
        const response = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          includedRegionCodes: ["se"],
          input: query,
          language: "sv",
          region: "se",
          sessionToken: sessionTokenRef.current,
        });
        if (currentRequest !== requestNumberRef.current) return;
        setSuggestions(
          response.suggestions.filter((suggestion) => suggestion.placePrediction)
        );
        setActiveIndex(-1);
      } catch {
        if (currentRequest !== requestNumberRef.current) return;
        setFailed(true);
        setSuggestions([]);
      } finally {
        if (currentRequest === requestNumberRef.current) setLoading(false);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [apiKey, focused, value]);

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  const close = () => {
    requestNumberRef.current += 1;
    setFocused(false);
    setActiveIndex(-1);
    setLoading(false);
    setSuggestions([]);
  };

  const selectSuggestion = async (suggestion: AutocompleteSuggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;
    const fallbackStreet = prediction.mainText?.text || prediction.text?.text || value;
    onChange(fallbackStreet);
    setLoading(true);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["addressComponents"] });
      onAddressSelect(
        swedishAddressFromGoogle(place.addressComponents ?? [], fallbackStreet)
      );
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      sessionTokenRef.current = null;
      setLoading(false);
      close();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (!suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      void selectSuggestion(suggestions[activeIndex]);
    }
  };

  return (
    <div className={["special-address-field", className].filter(Boolean).join(" ")}>
      <label htmlFor={id}>{label}</label>
      <div className="special-address-autocomplete">
        <input
          aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          aria-autocomplete={apiKey ? "list" : undefined}
          aria-controls={apiKey ? listboxId : undefined}
          aria-expanded={apiKey ? open : undefined}
          autoComplete="address-line1"
          id={id}
          name={name}
          onBlur={() => {
            blurTimerRef.current = setTimeout(close, 140);
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            requestNumberRef.current += 1;
            setActiveIndex(-1);
            setFailed(false);
            setSuggestions([]);
            if (nextValue.trim().length < 3) setLoading(false);
            onChange(nextValue);
          }}
          onFocus={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            setFocused(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          required={required}
          role={apiKey ? "combobox" : undefined}
          value={value}
        />
        {loading ? <i aria-label="Söker adress" className="special-address-autocomplete__progress" /> : null}
        {open ? (
          <div className="special-address-autocomplete__popover">
            {suggestions.length ? (
              <div aria-label="Adressförslag" className="special-address-autocomplete__results" id={listboxId} role="listbox">
                {suggestions.map((suggestion, index) => {
                  const prediction = suggestion.placePrediction;
                  if (!prediction) return null;
                  const primary = prediction.mainText?.text || prediction.text?.text || value;
                  const secondary = prediction.secondaryText?.text;
                  return (
                    <button
                      aria-selected={activeIndex === index}
                      id={`${id}-option-${index}`}
                      key={prediction.placeId ?? `${primary}-${secondary ?? ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void selectSuggestion(suggestion)}
                      role="option"
                      type="button"
                    >
                      <span>
                        <strong>{primary}</strong>
                        {secondary ? <small>{secondary}</small> : null}
                      </span>
                      <span aria-hidden="true"><ArrowIcon direction="up-right" /></span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {failed ? (
              <small className="special-address-autocomplete__error" role="status">
                Adressförslag är tillfälligt otillgängliga. Fyll i adressen manuellt.
              </small>
            ) : null}
            {suggestions.length ? (
              <div className="special-address-autocomplete__attribution">
                <img
                  alt="Powered by Google"
                  height="14"
                  src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png"
                  width="120"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <small>{error}</small> : null}
    </div>
  );
}
