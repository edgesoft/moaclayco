import { ActionFunction, json, redirect } from "@remix-run/node";
import { z, ZodError } from "zod";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";

const ItemSchema = z.object({
  headline: z.string().min(1, { message: "Var god fyll i namn" }),
  itemPrice: z.string().min(1, {
    message: "Var god skriv in pris",
  }),
  amount: z.string().min(1, {
    message: "Var skriv in antal",
  }),
  images: z.string().min(1, {
    message: "Var god ladda upp minst en bild",
  }),
});

const action: ActionFunction = async ({ request, params }) => {
  const collection = await Collections.findOne({ shortUrl: params.collection });
  if (!collection) {
    return redirect("/");
  }

  const result = {} as any;
  for (const [key, value] of await request.formData()) {
    result[key] = value;
  }

  try {
    ItemSchema.parse(result);

    const productInfos = JSON.parse(result.productInfos);
    const additionalItems = JSON.parse(result.additionalItems);
    const images = result.images.split(",");

    const data =  {
      headline: result.headline,
      price: Number(result.itemPrice),
      instagram: result.instagram,
      collectionRef: params.collection,
      amount: Number(result.amount),
      images: images,
      longDescription: result.longDescription,
      productInfos: productInfos.map((p) =>
        p.noValue ? `${p.value}` : `${p.name}: ${p.value}`
      ),
      additionalItems: additionalItems.map((a) => ({
        name: a.name,
        price: Number(a.value),
      })),
    }
    if (params.id) {
      const item = await Items.updateOne(
        { _id: params.id },
       data
      );
    } else {
      const item = await Items.create(data);
    }

    return redirect(`/collections/${params.collection}`);
  } catch (e) {
    const s = e as ZodError;

    return json({
      errors: s.issues.reduce((acc, i) => {
        acc[i.path[0]] = i.message;
        return acc;
      }, {} as any),
    });
  }
};

export const ItemAction = action;
