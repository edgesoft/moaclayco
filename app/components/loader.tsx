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
  if (!forceSpinner && !hasLoadingState({ transition })) return null;

  return <DelayedLoader />;
}

function DelayedLoader() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setShow(true), 650);
    return () => clearTimeout(handle);
  }, []);

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
