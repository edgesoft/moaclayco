import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import {  AdditionalItemProps } from "~/types";
import { classNames } from "~/utils/classnames";



const AdditionalCartItem: React.FC<AdditionalItemProps> = ({
  item,
  handleSwitch,
  additionalIndex,
}): React.ReactElement => {
  const [on, setOn] = useState(false);
  return (
    <label
      className={classNames(
        "relative mb-1 mr-1 cursor-pointer inline-flex rounded-full px-2 py-1 text-xs font-semibold leading-5 transition-all duration-200 select-none",
        `${
          on ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"
        }`
      )}
    >
      <input
        aria-label={`${item.name}, ${item.price} SEK`}
        checked={on}
        className="sr-only"
        onChange={(event) => {
          const nextValue = event.target.checked;
          setOn(nextValue);
          handleSwitch(item, nextValue, additionalIndex);
        }}
        type="checkbox"
      />
      <span className={classNames("mr-1 -mt-0.5 flex")}>
        <span aria-hidden="true" className="relative top-1 -left-0.5">
          <span
            className={classNames(
              "block  h-4 w-6 rounded-full transition-all duration-200",
              `${on ? "bg-emerald-600" : "bg-slate-400"}`
            )}
          />
          <AnimatePresence initial={false}>
            <motion.span
              transition={{
                delay: 0.13,
                type: "spring",
                stiffness: 8000,
                damping: 20,
              }}
              animate={{ left: on ? 3 : 12 }}
              className={classNames(
                "dot absolute top-1 h-2 w-2 rounded-full bg-white transition"
              )}
            />
          </AnimatePresence>
        </span>
      </span>
      {item.name} +{item.price} SEK
    </label>
  );
};

export default AdditionalCartItem;
