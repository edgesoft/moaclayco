import { data as json, redirect, type ActionFunction } from "react-router";
import { auth } from "~/services/auth.server";
import {
  CollectionRemovalUndoConflictError,
  CollectionRemovalUndoExpiredError,
  undoCollectionRemoval,
} from "~/services/collection-removal.server";

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const action: ActionFunction = async ({ params, request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const operationId = params.operation ?? "";
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    return json(
      { error: "Återställningslänken är inte giltig." },
      { status: 400 }
    );
  }

  try {
    const restored = await undoCollectionRemoval(operationId);
    return redirect(`/collections/${restored.collectionRef}/edit?restored=1`);
  } catch (error) {
    if (error instanceof CollectionRemovalUndoExpiredError) {
      return json({ error: error.message }, { status: 410 });
    }
    if (error instanceof CollectionRemovalUndoConflictError) {
      return json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
};
