import {
  LoaderFunction,
  redirect,
} from "@remix-run/node";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";

 const loader: LoaderFunction = async ({ params }) => {
    const collection = await Collections.findOne({ shortUrl: params.collection }).lean();
  
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