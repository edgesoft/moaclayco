import type { LinksFunction } from "react-router";
import { CollectionAction } from "~/actions/collection";
import CollectionEditor from "~/components/admin/collection";
import { CollectionLoader } from "~/loaders/collection";
import itemEditorStyles from "~/styles/item-editor.css?url";

export const loader = CollectionLoader;
export const action = CollectionAction;
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: itemEditorStyles },
];

export default CollectionEditor;
