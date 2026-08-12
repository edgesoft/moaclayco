import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

type FeedbackProp = {
  type: "error" | "success";
  headline: string;
  onHandleClick?: () => void;
  message?: string;
  forceInvisble?: boolean;
  visibleInMillis?: number;
};

const initialYValue = 18;

const Feedback: React.FC<FeedbackProp> = ({
  headline,
  message,
  type,
  onHandleClick,
  forceInvisble = false,
  visibleInMillis,
}): JSX.Element | null => {
  const [value, setValue] = useState<string>();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    setValue(headline);
    if (visibleInMillis) {
      handle = setTimeout(() => setValue(undefined), visibleInMillis);
    }
    return () => {
      if (handle) clearTimeout(handle);
    };
  }, [visibleInMillis, headline, message]);

  return (
    <AnimatePresence>
      {!forceInvisble && value ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          aria-live={type === "error" ? "assertive" : "polite"}
          className={`mcc-feedback mcc-feedback--${type}`}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: initialYValue }}
          initial={
            reduceMotion ? { opacity: 0 } : { opacity: 0, y: initialYValue }
          }
          onClick={onHandleClick}
          role={type === "error" ? "alert" : "status"}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}
        >
          <span aria-hidden="true" className="mcc-feedback-mark">
            {type === "error" ? "!" : "✓"}
          </span>
          <div className="mcc-feedback-copy">
            <p>{value}</p>
            {message ? <span>{message}</span> : null}
          </div>
          {!visibleInMillis ? (
            <button
              aria-label="Stäng meddelandet"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setValue(undefined);
              }}
              type="button"
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

export default Feedback;
