import { useNavigation } from "react-router";
import { useEffect, useState } from "react";

type Navigation = ReturnType<typeof useNavigation>;

type Fetcher = {
  state: string;
};

type LoaderProps = {
  transition: Navigation | Fetcher;
  forceSpinner?: boolean;
};

const loadingState = ["loading", "submitting"];

const hasLoadingState = ({ transition }: LoaderProps): boolean =>
  loadingState.includes(transition.state);

export default function Loader({ transition, forceSpinner }: LoaderProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    if (forceSpinner || hasLoadingState({ transition })) {
      handle = setTimeout(() => {
        if (forceSpinner || hasLoadingState({ transition })) setShow(true);
      }, 650);
    } else {
      setShow(false);
    }

    return () => {
      if (handle) clearTimeout(handle);
    };
  }, [transition, forceSpinner]);

  if (!show) return null;

  return (
    <div aria-live="polite" className="mcc-route-loader" role="status">
      <span aria-hidden="true" className="mcc-route-loader-mark">
        <span />
      </span>
      <span>Laddar nästa vy</span>
    </div>
  );
}
