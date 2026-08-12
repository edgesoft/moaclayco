import { ActionFunction, json } from "@remix-run/node";
import { Discounts } from "../schemas/discounts";
import { getDomain } from "~/utils/domain";

export let action: ActionFunction = async ({ request }) => {
  const body = await request.formData();
  const domain = getDomain(request);
  const code = String(body.get("code") ?? "").trim();
  if (!domain || !code) {
    return json({ code, percentage: null, balance: 0 });
  }

  const now = new Date();
  const discount: any = await Discounts.findOne({
    domain: domain.domain,
    code,
    balance: { $gt: 0 },
    percentage: { $gt: 0, $lte: 100 },
    $or: [
      { expireAt: { $exists: false } },
      { expireAt: null },
      { expireAt: { $gt: now } },
    ],
  }).lean();

  if (!discount) {
    return json({ code, percentage: null, balance: 0 });
  }

  return json({
    code,
    percentage: discount.percentage,
    balance: discount.balance,
  });
};
