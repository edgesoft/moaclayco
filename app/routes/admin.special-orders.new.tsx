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
import { auth } from "~/services/auth.server";
import {
  deliverQueuedOrderEmail,
  queueOrderEmail,
} from "~/services/email-delivery.server";
import {
  createSpecialOrderDraft,
  lockAndSendSpecialOrder,
  specialOrderFormSchema,
} from "~/services/special-order.server";
import specialOrderStyles from "~/styles/special-order.css?url";
import {
  publicOriginFrom,
  sourceProducts,
} from "~/services/special-order-admin.server";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

export const links: LinksFunction = () => [
  { href: specialOrderStyles, rel: "stylesheet" },
];

export const meta: MetaFunction = () => [
  { title: "Ny specialbeställning — Moa Clay Collection" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  return json<SpecialOrderEditorData>({ sources: await sourceProducts() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
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

  const order = await createSpecialOrderDraft(parsed.data);
  if (values.intent !== "send") {
    return redirect(`/admin/special-orders/${String(order._id)}`);
  }

  const locked = await lockAndSendSpecialOrder({
    expiresAt: parsed.data.expiresAt,
    orderId: String(order._id),
    publicOrigin: publicOriginFrom(request),
  });
  if (!locked) {
    return json({ errors: { form: "Beställningen kunde inte låsas." } }, { status: 409 });
  }
  const delivery = await queueOrderEmail({
    kind: "SPECIAL_ORDER_INVITATION",
    orderId: String(order._id),
    recipient: locked.customer.email,
  });
  if (delivery) await deliverQueuedOrderEmail(String(delivery._id));
  return redirect(`/admin/orders/${String(order._id)}`);
};

export default function NewSpecialOrder({ loaderData }: { loaderData: SpecialOrderEditorData }) {
  return <SpecialOrderEditor {...loaderData} />;
}
