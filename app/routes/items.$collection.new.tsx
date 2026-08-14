import type { LinksFunction } from "react-router";
import { ItemLoader } from "../loaders/item";
import { ItemAction } from "~/actions/item";
import ItemComponent from "~/components/admin/item";
import itemEditorStyles from "~/styles/item-editor.css?url";

export const loader = ItemLoader;
export const action = ItemAction;
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: itemEditorStyles },
];

const NewItem = ItemComponent;
export default NewItem;
