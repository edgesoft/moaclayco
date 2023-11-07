import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { AdditionalItem } from "~/types";
import { classNames } from "~/utils/classnames";

type AdditionalItemProps = {
  item: AdditionalItem;
  handleSwitch: (
    item: AdditionalItem,
    on: boolean,
    additionalIndex: number
  ) => void;
  additionalIndex: number;
};

export type AdditionCartItemType = {
  item: AdditionalItem;
  index: number;
  additionalIndex: number;
};

const AdditionalCartItem: React.FC<AdditionalItemProps> = ({
  item,
  handleSwitch,
  additionalIndex,
}): JSX.Element => {
  const [on, setOn] = useState(false);
  return (
    <span
      onClick={() => {
        setOn(!on);
        handleSwitch(item, !on, additionalIndex);
      }}
      className={classNames(
        "relative mb-1 mr-1 cursor-pointer inline-flex rounded-full px-2 py-1 text-xs font-semibold leading-5 transition-all duration-200 select-none",
        `${
          on ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"
        }`
      )}
    >
      <div className={classNames("mr-1 -mt-0.5 flex")}>
        <label className="flex cursor-pointer">
          <input type="hidden" name="_action" value={"disable"} />
          <input type="submit" name="id" style={{ display: "none" }} />
          <div
            className="relative top-1 -left-0.5"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOn(!on);
              handleSwitch(item, !on, additionalIndex);
            }}
          >
            <input type="checkbox" className="sr-only" />
            <div
              className={classNames(
                "block  h-4 w-6 rounded-full transition-all duration-200",
                `${on ? "bg-emerald-600" : "bg-slate-400"}`
              )}
            ></div>
            <AnimatePresence initial={false}>
              <motion.div
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
              ></motion.div>
            </AnimatePresence>
          </div>
        </label>
      </div>
      {item.name} +{item.price} SEK
    </span>
  );
};

export default AdditionalCartItem;
