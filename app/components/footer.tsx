import { useLocation } from "react-router";
import { useTheme } from "./Theme";

const isPublicStorefrontPath = (pathname: string) => {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";

  if (["/", "/cart", "/checkout", "/order"].includes(normalizedPath)) {
    return true;
  }

  const segments = normalizedPath.split("/").filter(Boolean);

  if (segments[0] === "collections") {
    return segments.length === 2 && segments[1] !== "new";
  }

  if (segments[0] === "items") {
    return segments.length === 3 && segments[2] !== "new";
  }

  return false;
};

const Footer = (): React.ReactElement | null => {
  const theme = useTheme();
  const location = useLocation();

  if (!isPublicStorefrontPath(location.pathname)) return null;

  return (
    <footer className="landing-footer">
      <div className="mcc-footer-inner">
        <div className="mcc-footer-heading">
          <p aria-label="Moa Clay Co" className="mcc-footer-wordmark">
            <span className="mcc-footer-wordmark__name">Moa Clay</span>
            <span className="mcc-footer-wordmark__co">Co</span>
          </p>
          <p className="mcc-footer-follow">Följ Moa</p>
        </div>

        <nav
          aria-label="Moa Clay Co i sociala medier"
          className="mcc-footer-socials"
        >
          {theme?.instagramUrl ? (
            <a
              aria-label="Följ Moa Clay Co på Instagram"
              className="mcc-footer-social"
              href={theme.instagramUrl}
              rel="noreferrer"
              target="_blank"
            >
              <span className="mcc-footer-social__icon" aria-hidden="true">
                <svg fill="currentColor" viewBox="0 0 24 24">
                  <path
                    clipRule="evenodd"
                    d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
                    fillRule="evenodd"
                  />
                </svg>
              </span>
              <span className="mcc-footer-social__copy">
                <span>Instagram</span>
                <small>@moaclayco</small>
              </span>
              <span className="mcc-footer-social__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ) : null}

          {theme?.tiktokUrl ? (
            <a
              aria-label="Följ Moa Clay Co på TikTok"
              className="mcc-footer-social"
              href={theme.tiktokUrl}
              rel="noreferrer"
              target="_blank"
            >
              <span className="mcc-footer-social__icon" aria-hidden="true">
                <svg
                  clipRule="evenodd"
                  fill="currentColor"
                  fillRule="evenodd"
                  viewBox="0 0 2859 3333"
                >
                  <path d="M2081 0c55 473 319 755 778 785v532c-266 26-499-61-770-225v995c0 1264-1378 1659-1932 753-356-583-138-1606 1004-1647v561c-87 14-180 36-265 65-254 86-398 247-358 531 77 544 1075 705 992-358V1h551z" />
                </svg>
              </span>
              <span className="mcc-footer-social__copy">
                <span>TikTok</span>
                <small>@moaclayco</small>
              </span>
              <span className="mcc-footer-social__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ) : null}

          {theme?.pinterestUrl ? (
            <a
              aria-label="Följ Moa Clay Co på Pinterest"
              className="mcc-footer-social"
              href={theme.pinterestUrl}
              rel="noreferrer"
              target="_blank"
            >
              <span className="mcc-footer-social__icon" aria-hidden="true">
                <svg fill="currentColor" viewBox="0 0 511.998 511.998">
                  <path d="M405.017,52.467C369.774,18.634,321.001,0,267.684,0C186.24,0,136.148,33.385,108.468,61.39c-34.114,34.513-53.675,80.34-53.675,125.732c0,56.993,23.839,100.737,63.76,117.011c2.68,1.098,5.377,1.651,8.021,1.651c8.422,0,15.095-5.511,17.407-14.35c1.348-5.071,4.47-17.582,5.828-23.013c2.906-10.725.558-15.884-5.78-23.353c-11.546-13.662-16.923-29.817-16.923-50.842c0-62.451,46.502-128.823,132.689-128.823c68.386,0,110.866,38.868,110.866,101.434c0,39.482-8.504,76.046-23.951,102.961c-10.734,18.702-29.609,40.995-58.585,40.995c-12.53,0-23.786-5.147-30.888-14.121c-6.709-8.483-8.921-19.441-6.222-30.862c3.048-12.904,7.205-26.364,11.228-39.376c7.337-23.766,14.273-46.213,14.273-64.122c0-30.632-18.832-51.215-46.857-51.215c-35.616,0-63.519,36.174-63.519,82.354c0,22.648,6.019,39.588,8.744,46.092c-4.487,19.01-31.153,132.03-36.211,153.342c-2.925,12.441-20.543,110.705,8.618,118.54c32.764,8.803,62.051-86.899,65.032-97.713c2.416-8.795,10.869-42.052,16.049-62.495c15.817,15.235,41.284,25.535,66.064,25.535c46.715,0,88.727-21.022,118.298-59.189c28.679-37.02,44.474-88.618,44.474-145.282C457.206,127.983,438.182,84.311,405.017,52.467z" />
                </svg>
              </span>
              <span className="mcc-footer-social__copy">
                <span>Pinterest</span>
                <small>@moaclayco</small>
              </span>
              <span className="mcc-footer-social__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ) : null}

          {theme?.twitterUrl ? (
            <a
              aria-label="Följ Moa Clay Co på X"
              className="mcc-footer-social"
              href={theme.twitterUrl}
              rel="noreferrer"
              target="_blank"
            >
              <span className="mcc-footer-social__icon" aria-hidden="true">
                <svg fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.967 6.817H1.68l7.73-8.835L1.254 2.25h6.826l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
                </svg>
              </span>
              <span className="mcc-footer-social__copy">
                <span>X</span>
                <small>@moaclayco</small>
              </span>
              <span className="mcc-footer-social__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ) : null}
        </nav>

        <div className="mcc-footer-meta">
          <a href={`mailto:${theme?.email}`}>{theme?.email}</a>
          <span>{theme?.footerText}</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
