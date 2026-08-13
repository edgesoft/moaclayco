import assert from "node:assert/strict";
import test from "node:test";
import { formSchema } from "../app/schemas/discount-form";

test("discount form accepts numeric values and an open-ended period", () => {
  const result = formSchema.safeParse({
    balance: 3,
    code: " SOMMAR20 ",
    expireAt: "",
    percentage: 20,
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data, {
      balance: 3,
      code: "SOMMAR20",
      expireAt: "",
      percentage: 20,
    });
  }
});

test("discount form rejects invalid numeric form values", () => {
  const result = formSchema.safeParse({
    balance: Number.NaN,
    code: "",
    expireAt: "2026-08-12",
    percentage: Number.NaN,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(
      result.error.issues.map((issue) => issue.message),
      [
        "Ange en rabattkod.",
        "Ange rabatten i procent.",
        "Ange hur många gånger koden får användas.",
        "Formatet måste vara ÅÅÅÅ-MM-DD TT:mm",
      ]
    );
  }
});
