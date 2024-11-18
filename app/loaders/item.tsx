import {
  LoaderFunction,
  redirect,
} from "@remix-run/node";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { getDomain } from "~/utils/domain";

 const loader: LoaderFunction = async ({ params, request }) => {
    const domain = getDomain(request)
    const collection = await Collections.findOne({ shortUrl: params.collection, domain: domain?.domain }).lean();
  
    if (!collection) {
      return redirect("/");
    }

    let item = params.id ? await Items.findOne({ _id: params.id}).lean(): null

    if (params.id && !item) {
      if (!item) {
        return redirect(`/collections/${params.collection}`);
      }
  
    }
  
    return { collection, item };
  };

export const ItemLoader = loader