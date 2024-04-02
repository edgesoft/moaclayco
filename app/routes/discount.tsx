import { ActionFunction, json } from "@remix-run/node";
import { Discounts } from "../schemas/discounts";

export let action: ActionFunction = async ({ request }) => {
  let body = new URLSearchParams(await request.text());

  let discount = await Discounts.findOne({ code: body.get("code") });
  if (!discount) {
    return json({ percentage: null, amount: 0 });
  }

  const now = new Date();
  const expireAtInLocalTimezone = new Date(now.toLocaleString('sv-SE', {timeZone: 'Europe/Stockholm'}));
  if (discount.expireAt && discount.expireAt < expireAtInLocalTimezone) {
    
    return json({ percentage: null, amount: 0, error: "Discount has expired" }, { status: 400 });
  }

  return json({ amount: 0, ...discount.toObject() });
};

