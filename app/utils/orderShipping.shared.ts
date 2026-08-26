import type { Order } from "~/types";

export const canManageOrderShipment = ({
  kind,
  status,
}: Pick<Order, "kind" | "status">) =>
  status === "SUCCESS" ||
  status === "SHIPPED" ||
  status === "MANUAL_PROCESSING" ||
  (kind === "SPECIAL" && status === "PAID_REVIEW");
