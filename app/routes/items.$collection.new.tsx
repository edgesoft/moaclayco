import { ItemLoader } from "../loaders/item";
import { ItemAction } from "~/actions/item";
import ItemComponent from "~/components/admin/item";

export const loader = ItemLoader;
export const action = ItemAction;

const NewItem = ItemComponent;
export default NewItem;
