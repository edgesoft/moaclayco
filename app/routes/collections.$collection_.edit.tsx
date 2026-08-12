import { CollectionAction } from "~/actions/collection";
import CollectionEditor from "~/components/admin/collection";
import { CollectionLoader } from "~/loaders/collection";

export const loader = CollectionLoader;
export const action = CollectionAction;

export default CollectionEditor;
