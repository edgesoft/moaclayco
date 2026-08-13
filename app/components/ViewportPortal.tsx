import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import ClientOnly from "./ClientOnly";

type ViewportPortalProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

/**
 * Keeps viewport-fixed UI out of transformed or clipped route/header trees.
 * The optional fallback preserves server-rendered markup when a view needs it.
 */
export default function ViewportPortal({
  children,
  fallback = null,
}: ViewportPortalProps) {
  return (
    <ClientOnly fallback={fallback}>
      {() => createPortal(children, document.body)}
    </ClientOnly>
  );
}
