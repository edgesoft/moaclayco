import { ActionFunction, data as json } from "react-router";
import { Discounts } from "../schemas/discounts";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

export let action: ActionFunction = async ({ request }) => {
  let body: FormData;
  try {
    body = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(
        { code: "", percentage: null, balance: 0 },
        { status: 413 }
      );
    }
    throw error;
  }
  const code = String(body.get("code") ?? "").trim();
  if (!code || code.length > 100) {
    return json({ code, percentage: null, balance: 0 });
  }

  const now = new Date();
  const discount: any = await Discounts.findOne({
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
