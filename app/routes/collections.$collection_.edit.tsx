import { CollectionAction } from "~/actions/collection";
import CollectionEditor from "~/components/admin/collection";
import { CollectionLoader } from "~/loaders/collection";
import "~/styles/item-editor.css";

export const loader = CollectionLoader;
export const action = CollectionAction;

export default CollectionEditor;
