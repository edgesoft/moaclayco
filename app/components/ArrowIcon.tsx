type ArrowDirection = "down" | "left" | "right" | "up" | "up-right";

type ArrowIconProps = {
  className?: string;
  direction?: ArrowDirection;
};

const rotations: Partial<Record<ArrowDirection, string>> = {
  down: "rotate(90 10 10)",
  left: "rotate(180 10 10)",
  up: "rotate(-90 10 10)",
};

export default function ArrowIcon({
  className,
  direction = "right",
}: ArrowIconProps) {
  const classes = ["mcc-arrow-icon", className].filter(Boolean).join(" ");

  return (
    <svg
      aria-hidden="true"
      className={classes}
      fill="none"
      focusable="false"
      viewBox="0 0 20 20"
    >
      {direction === "up-right" ? (
        <path d="M4.75 15.25 15.25 4.75M7.25 4.75h8v8" />
      ) : (
        <path
          d="M3.25 10h13.5M11.25 4.75 16.5 10l-5.25 5.25"
          transform={rotations[direction]}
        />
      )}
    </svg>
  );
}
