import { data as json, type ActionFunction } from "react-router";
import {
  CollectionOrderConflictError,
  CollectionOrderValidationError,
  parseCollectionOrder,
  persistCollectionOrder,
} from "~/services/collection-order.server";
import { auth } from "~/services/auth.server";

export type CollectionOrderActionData =
  | { ok: true; order: string[] }
  | { error: string; ok: false };

const privateHeaders = { "Cache-Control": "private, no-store" };

export const action: ActionFunction = async ({ request }) => {
  const user = await auth.isAuthenticated(request);
  if (!user) {
    return json<CollectionOrderActionData>(
      { error: "Du behöver logga in igen för att spara ordningen.", ok: false },
      { headers: privateHeaders, status: 401 }
    );
  }

  try {
    const formData = await request.formData();
    const rawOrder = formData.get("order");
    if (typeof rawOrder !== "string") {
      throw new CollectionOrderValidationError("Ordningen saknas.");
    }

    const order = parseCollectionOrder(rawOrder);
    await persistCollectionOrder(order);
    return json<CollectionOrderActionData>(
      { ok: true, order },
      { headers: privateHeaders }
    );
  } catch (error) {
    if (error instanceof CollectionOrderValidationError) {
      return json<CollectionOrderActionData>(
        { error: error.message, ok: false },
        { headers: privateHeaders, status: 400 }
      );
    }
    if (error instanceof CollectionOrderConflictError) {
      return json<CollectionOrderActionData>(
        { error: error.message, ok: false },
        { headers: privateHeaders, status: 409 }
      );
    }

    console.error("Collection-ordningen kunde inte sparas", error);
    return json<CollectionOrderActionData>(
      { error: "Ordningen kunde inte sparas. Försök igen.", ok: false },
      { headers: privateHeaders, status: 500 }
    );
  }
};
