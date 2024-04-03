import { DiscountAction } from "~/actions/discount";
import Discount from "~/components/admin/discount";
import { DiscountLoader } from "~/loaders/discount";

export const loader = DiscountLoader;
export const action = DiscountAction
export default Discount