type PlusMinusIconProps = {
  className?: string;
  operation?: "minus" | "plus";
};

export default function PlusMinusIcon({
  className,
  operation = "plus",
}: PlusMinusIconProps) {
  const classes = ["mcc-plus-minus-icon", className]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      className={classes}
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      <path d="M4 10h12" />
      {operation === "plus" ? <path d="M10 4v12" /> : null}
    </svg>
  );
}
