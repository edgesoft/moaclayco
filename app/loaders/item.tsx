import {
  LoaderFunction,
  redirect,
} from "react-router";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { getDomain } from "~/utils/domain";
import { auth } from "~/services/auth.server";
import { toLoaderData } from "~/utils/loaderData";
import {
  collectionEditorProjection,
  itemEditorProjection,
} from "~/utils/queryProjections.server";

 const loader: LoaderFunction = async ({ params, request }) => {
    await auth.isAuthenticated(request, { failureRedirect: "/login" });
    const domain = getDomain(request)
    const [collection, item] = await Promise.all([
      Collections.findOne({
        shortUrl: params.collection,
        domain: domain?.domain,
      })
        .select(collectionEditorProjection)
        .lean()
        .exec(),
      params.id
        ? Items.findOne({
            _id: params.id,
            domain: domain?.domain,
            collectionRef: params.collection,
          })
            .select(itemEditorProjection)
            .lean()
            .exec()
        : null,
    ]);
  
    if (!collection) {
      return redirect("/");
    }

    if (params.id && !item) {
      return redirect(`/collections/${params.collection}`);
    }
  
    return toLoaderData({ collection, item });
  };

export const ItemLoader = loader
