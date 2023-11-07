import { useEffect, useState } from "react";
import useMediaQuery from "~/hooks/useMediaQuery";
import { classNames } from "~/utils/classnames";

type MagnifierProps = {
    imageUrl: string | undefined;
    close: (p: string | undefined) => void;
  };
  
  const Magnifier: React.FC<MagnifierProps> = ({
    imageUrl,
    close,
  }): JSX.Element | null => {
    const [isLoaded, setIsLoaded] = useState(false);
    const isDesktop = useMediaQuery("(min-width: 960px)");
  
    useEffect(() => {
      if (imageUrl) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "unset";
      }
    }, [imageUrl]);
  
    if (!imageUrl) return null;
  
    return (
      <div className="fixed z-10 left-0 top-0 w-full h-full overflow-scroll">
        <div
          className={classNames(
            "relative min-w-max min-h-screen overflow-hidden"
          )}
        >
          <img
            className={classNames(isLoaded ? "visible" : "hidden")}
            onLoad={() => {
              setIsLoaded(true);
            }}
            width={isDesktop ? 2000 : 1000}
            src={`${imageUrl}?twic=v1/resize=2000/quality=100`}
          />
  
          <img
            className={classNames(isLoaded ? "hidden" : "visible")}
            width={2000}
            src={`${imageUrl}?twic=v1/resize=40/quality=10`}
          />
  
          <div
            className="fixed right-1 top-1 text-white"
            onClick={() => {
              setIsLoaded(false);
              close(undefined);
            }}
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      </div>
    );
  };

  export default Magnifier