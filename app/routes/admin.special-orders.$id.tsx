import { data as json, redirect } from "react-router";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import SpecialOrderEditor, {
  type SpecialOrderEditorData,
} from "~/components/admin/SpecialOrderEditor";
import { Orders } from "~/schemas/orders";
import { auth } from "~/services/auth.server";
import { googleMapsBrowserApiKey } from "~/services/google-maps.server";
import {
  deliverQueuedOrderEmail,
  queueOrderEmail,
} from "~/services/email-delivery.server";
import {
  lockAndSendSpecialOrder,
  specialOrderFormSchema,
  updateSpecialOrderDraft,
} from "~/services/special-order.server";
import {
  publicOriginFrom,
  sourceProducts,
} from "~/services/special-order-admin.server";
import specialOrderStyles from "~/styles/special-order.css?url";
import type { Order } from "~/types";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import { toLoaderData } from "~/utils/loaderData";

export const links: LinksFunction = () => [
  { href: specialOrderStyles, rel: "stylesheet" },
];

export const meta: MetaFunction = () => [
  { title: "Redigera specialbeställning — Moa Clay Collection" },
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const order = (await Orders.findOne({
    _id: params.id,
    kind: "SPECIAL",
  }).lean()) as Order | null;
  if (!order) throw new Response("Beställningen hittades inte", { status: 404 });
  if (order.status !== "DRAFT") return redirect(`/admin/orders/${params.id}`);
  return json<SpecialOrderEditorData>(
    toLoaderData({
      googleMapsApiKey: googleMapsBrowserApiKey(),
      order,
      sources: await sourceProducts(),
    })
  );
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ errors: { form: "Formuläret är för stort." } }, { status: 413 });
    }
    throw error;
  }
  const values = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
  );
  const parsed = specialOrderFormSchema.safeParse(values);
  if (!parsed.success) {
    return json(
      {
        errors: parsed.error.issues.reduce<Record<string, string>>(
          (errors, issue) => {
            errors[String(issue.path[0] ?? "form")] = issue.message;
            return errors;
          },
          {}
        ),
      },
      { status: 400 }
    );
  }
  const order = await updateSpecialOrderDraft(String(params.id), parsed.data);
  if (!order) {
    return json({ errors: { form: "Utkastet ändrades i en annan flik." } }, { status: 409 });
  }
  if (values.intent !== "send") return redirect(`/admin/special-orders/${params.id}`);

  const locked = await lockAndSendSpecialOrder({
    expiresAt: parsed.data.expiresAt,
    orderId: String(params.id),
    publicOrigin: publicOriginFrom(request),
  });
  if (!locked) {
    return json({ errors: { form: "Beställningen kunde inte låsas." } }, { status: 409 });
  }
  const delivery = await queueOrderEmail({
    kind: "SPECIAL_ORDER_INVITATION",
    orderId: String(params.id),
    recipient: locked.customer.email,
  });
  if (delivery) await deliverQueuedOrderEmail(String(delivery._id));
  return redirect(`/admin/orders/${params.id}`);
};

export default function EditSpecialOrder({ loaderData }: { loaderData: SpecialOrderEditorData }) {
  return <SpecialOrderEditor {...loaderData} />;
}
