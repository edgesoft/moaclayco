import { json, redirect } from "@remix-run/node";
import type { ActionFunction } from "@remix-run/node";
import { z } from "zod";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { auth } from "~/services/auth.server";
import { getDomain } from "~/utils/domain";

const ItemSchema = z.object({
  amount: z
    .string()
    .min(1, { message: "Var god skriv in antal" })
    .refine(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 0,
      "Antal måste vara ett heltal på 0 eller mer"
    ),
  headline: z.string().trim().min(1, { message: "Var god fyll i namn" }),
  images: z.string().min(1, { message: "Var god ladda upp minst en bild" }),
  itemPrice: z
    .string()
    .min(1, { message: "Var god skriv in pris" })
    .refine(
      (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
      "Pris måste vara 0 eller mer"
    ),
});

const ProductInfoSchema = z.array(
  z.object({
    name: z.string().optional(),
    noValue: z.boolean().optional(),
    value: z.string().min(1),
  })
);

const AdditionalItemsSchema = z.array(
  z.object({
    name: z.string().min(1),
    value: z.union([z.string(), z.number()]),
  })
);

export const ItemAction: ActionFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);
  if (!domain) return json({ errors: { form: "Okänd domän" } }, { status: 400 });

  const collection = await Collections.findOne({
    domain: domain.domain,
    shortUrl: params.collection,
  });
  if (!collection) return redirect("/");

  const formData = await request.formData();
  const result = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, value.toString()])
  );
  const validatedItem = ItemSchema.safeParse(result);

  if (!validatedItem.success) {
    return json(
      {
        errors: validatedItem.error.issues.reduce<Record<string, string>>(
          (errors, issue) => {
            errors[String(issue.path[0])] = issue.message;
            return errors;
          },
          {}
        ),
      },
      { status: 400 }
    );
  }

  let productInfos: z.infer<typeof ProductInfoSchema>;
  let additionalItems: z.infer<typeof AdditionalItemsSchema>;
  try {
    productInfos = ProductInfoSchema.parse(JSON.parse(result.productInfos ?? "[]"));
    additionalItems = AdditionalItemsSchema.parse(
      JSON.parse(result.additionalItems ?? "[]")
    );
  } catch {
    return json(
      { errors: { form: "Detaljer eller tillval innehåller ogiltiga värden" } },
      { status: 400 }
    );
  }

  const images = validatedItem.data.images
    .split(",")
    .map((image) => image.trim())
    .filter(Boolean);
  if (!images.length) {
    return json(
      { errors: { images: "Var god ladda upp minst en bild" } },
      { status: 400 }
    );
  }

  const data = {
    additionalItems: additionalItems.map((addition) => ({
      name: addition.name.trim(),
      price: Number(addition.value),
    })),
    amount: Number(validatedItem.data.amount),
    collectionRef: params.collection,
    domain: domain.domain,
    headline: validatedItem.data.headline,
    images,
    instagram: result.instagram?.trim() ?? "",
    longDescription: result.longDescription?.trim() ?? "",
    price: Number(validatedItem.data.itemPrice),
    productInfos: productInfos.map((info) =>
      info.noValue ? info.value.trim() : `${info.name?.trim()}: ${info.value.trim()}`
    ),
  };

  if (params.id) {
    const updateResult = await Items.updateOne(
      {
        _id: params.id,
        collectionRef: params.collection,
        domain: domain.domain,
      },
      data
    );
    if (!updateResult.matchedCount) {
      return json({ errors: { form: "Produkten kunde inte hittas" } }, { status: 404 });
    }
  } else {
    await Items.create(data);
  }

  return redirect(`/collections/${params.collection}`);
};
