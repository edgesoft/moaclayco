import {
  ActionFunction,
  data as json,
  Form,
  LoaderFunction,
  redirect,
  useLoaderData,
  useNavigate,
} from "react-router";
import { useState } from "react";
import { z } from "zod";
import { Users } from "~/schemas/user";
import { auth } from "~/services/auth.server";
import { commitSession, sessionStorage } from "~/services/session.server";
import { User } from "~/types";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

const formSchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2200),
});

export const loader: LoaderFunction = async ({ request }) => {
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  return json({ year: user.fiscalYear });
};

export const action: ActionFunction = async ({ request }) => {
  const user: User = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Formuläret är för stort" }, { status: 413 });
    }
    throw error;
  }
  const parsed = formSchema.safeParse({
    fiscalYear: formData.get("fiscalYear"),
  });

  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const fiscalYear = parsed.data.fiscalYear;
  await Users.updateOne({ _id: user._id }, { fiscalYear });
  user.fiscalYear = fiscalYear;

  const session = await sessionStorage.getSession(request.headers.get("cookie"));
  session.set("user", user);
  const headers = new Headers({ "Set-Cookie": await commitSession(session) });

  return redirect("/admin/verifications", { headers });
};

export default function Settings() {
  const navigate = useNavigate();
  const { year } = useLoaderData<{ year: number }>();
  const [selectedYear, setSelectedYear] = useState(year);
  const relevantYears = [year - 2, year - 1, year, year + 1];

  return (
    <section className="pb-16" aria-labelledby="fiscal-year-title">
      <button
        type="button"
        onClick={() => navigate("/admin/verifications")}
        className="mb-3 inline-flex h-10 items-center rounded-lg px-1 text-xs font-bold text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden="true" className="mr-2">←</span>
        Till verifikationer
      </button>

      <div className="max-w-3xl border-y border-stone-300 py-7 sm:py-9">
        <p className="accounting-kicker text-xs font-bold uppercase tracking-[0.14em]">
          Inställning
        </p>
        <h2
          id="fiscal-year-title"
          className="mt-3 text-3xl tracking-tight text-stone-950 sm:text-4xl"
        >
          Välj bokföringsår
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          Listan och rapporterna visar verifikationer från det valda året.
        </p>

        <Form method="post" className="mt-7">
          <fieldset>
            <legend className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
              Bokföringsår
            </legend>
            <div className="grid grid-cols-4 border-b border-stone-300">
              {relevantYears.map((relevantYear) => (
                <label key={relevantYear} className="group cursor-pointer">
                  <input
                    type="radio"
                    name="fiscalYear"
                    value={relevantYear}
                    checked={relevantYear === selectedYear}
                    onChange={() => setSelectedYear(relevantYear)}
                    className="peer sr-only"
                  />
                  <span className="-mb-px flex h-14 items-center justify-center border-b-2 border-transparent bg-transparent text-base font-medium text-stone-400 transition hover:text-stone-900 peer-checked:border-[#b86e59] peer-checked:text-[#985744] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#b86e59]">
                    {relevantYear}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="accounting-form-actions mt-7 grid gap-3 sm:grid-cols-[9.5rem_15rem] sm:justify-end">
            <button
              type="button"
              onClick={() => navigate("/admin/verifications")}
              className="accounting-cancel-action"
            >
              Avbryt
            </button>
            <button
              type="submit"
              className="accounting-submit-action"
            >
              Använd {selectedYear} <span aria-hidden="true">→</span>
            </button>
          </div>
        </Form>
      </div>
    </section>
  );
}
