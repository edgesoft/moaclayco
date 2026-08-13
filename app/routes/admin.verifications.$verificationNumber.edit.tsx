import {
  type ActionFunction,
  data as json,
  Link,
  type LoaderFunction,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import Select from "react-select";
import { Verifications } from "~/schemas/verifications";
import { auth } from "~/services/auth.server";
import {
  editVerification,
  getVerificationEditPolicy,
  VerificationEditBlockedError,
} from "~/services/verification.server";
import { AccountingDateField } from "~/components/admin/AccountingDateField";
import JournalEntryAmountField from "~/components/admin/JournalEntryAmountField";
import ArrowIcon from "~/components/ArrowIcon";
import ClientOnly from "~/components/ClientOnly";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import { accounts } from "~/utils/accounts";
import {
  accountingDateKey,
  accountingYear,
  parseAccountingDate,
} from "~/utils/accountingDates";
import { getDomain } from "~/utils/domain";
import { toLoaderData } from "~/utils/loaderData";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import { VerificationValidationError } from "~/utils/verificationValidation";

type JournalEntry = {
  account: number;
  debit: number;
  credit: number;
};

type EditForm = {
  description: string;
  verificationDate: string;
  journalEntries: JournalEntry[];
  reason: string;
};

type LoaderData = {
  verification: {
    verificationNumber: number;
    description: string;
    verificationDate: string;
    journalEntries: JournalEntry[];
  };
  policy: {
    editable: boolean;
    reason: string | null;
  };
};

type ActionData = { error?: string };

const verificationNumberFrom = (value: string | undefined) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

export const loader: LoaderFunction = async ({ request, params }) => {
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  const domain = getDomain(request);
  if (!domain) throw new Response("Okänd domän", { status: 404 });
  const verificationNumber = verificationNumberFrom(params.verificationNumber);
  if (!verificationNumber) {
    throw new Response("Ogiltigt verifikationsnummer", { status: 400 });
  }

  const verification = await Verifications.findOne({
    domain: domain.domain,
    verificationNumber,
  })
    .select(
      "recordType description verificationNumber verificationDate metadata journalEntries"
    )
    .lean()
    .exec();
  if (!verification) throw new Response("Verifikationen hittades inte", { status: 404 });

  const verificationDate = new Date(verification.verificationDate);
  let policy = await getVerificationEditPolicy({
    domain: domain.domain,
    verification: {
      recordType: verification.recordType,
      verificationDate,
      metadata: verification.metadata,
    },
  });
  const verificationYear = accountingYear(verificationDate);
  if (verificationYear !== user.fiscalYear) {
    policy = {
      editable: false,
      reportedPeriods: [],
      reason: `Välj bokföringsår ${verificationYear ?? "för verifikationen"} innan du redigerar A${verificationNumber}.`,
    };
  }

  return json(
    toLoaderData({
      verification: {
        verificationNumber,
        description: verification.description,
        verificationDate: accountingDateKey(verificationDate),
        journalEntries: (verification.journalEntries ?? []).map((entry: any) => ({
          account: Number(entry.account),
          debit: Number(entry.debit || 0),
          credit: Number(entry.credit || 0),
        })),
      },
      policy,
    })
  );
};

export const action: ActionFunction = async ({ request, params }) => {
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  const domain = getDomain(request);
  if (!domain) throw new Response("Okänd domän", { status: 404 });
  const verificationNumber = verificationNumberFrom(params.verificationNumber);
  if (!verificationNumber) {
    return json({ error: "Ogiltigt verifikationsnummer" }, { status: 400 });
  }

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

  const description = formData.get("description");
  const dateValue = formData.get("verificationDate");
  const reason = formData.get("reason");
  const rawJournalEntries = formData.get("journalEntries");
  if (
    typeof description !== "string" ||
    typeof dateValue !== "string" ||
    typeof reason !== "string" ||
    typeof rawJournalEntries !== "string"
  ) {
    return json({ error: "Formuläret är inte komplett" }, { status: 400 });
  }
  const verificationDate = parseAccountingDate(dateValue);
  if (!verificationDate) {
    return json({ error: "Bokföringsdatumet är ogiltigt" }, { status: 400 });
  }
  let journalEntries: unknown;
  try {
    journalEntries = JSON.parse(rawJournalEntries);
  } catch {
    return json({ error: "Konteringsraderna kunde inte läsas" }, { status: 400 });
  }

  try {
    await editVerification({
      domain: domain.domain,
      verificationNumber,
      expectedYear: user.fiscalYear,
      description,
      verificationDate,
      journalEntries,
      reason,
      editedBy: user.email,
    });
  } catch (error) {
    if (error instanceof VerificationEditBlockedError) {
      return json({ error: error.message }, { status: 409 });
    }
    if (error instanceof VerificationValidationError) {
      return json({ error: error.message }, { status: 400 });
    }
    console.error("Verification edit failed", {
      verificationNumber,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json(
      { error: "Verifikationen kunde inte uppdateras. Försök igen." },
      { status: 500 }
    );
  }

  return redirect(`/admin/verifications?edited=${verificationNumber}`);
};

const money = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function EditVerification() {
  const { verification, policy } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const {
    control,
    handleSubmit,
    register,
    setValue,
    watch,
  } = useForm<EditForm>({
    defaultValues: { ...verification, reason: "" },
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "journalEntries",
  });
  const currentEntries = watch("journalEntries") ?? [];
  const currentDescription = watch("description") ?? "";
  const currentDate = watch("verificationDate") ?? "";
  const currentReason = watch("reason") ?? "";
  const totals = currentEntries.reduce(
    (sum, entry) => ({
      debit: sum.debit + Number(entry.debit || 0),
      credit: sum.credit + Number(entry.credit || 0),
    }),
    { debit: 0, credit: 0 }
  );
  const difference = Math.abs(totals.debit - totals.credit);
  const rowsAreComplete =
    currentEntries.length >= 2 &&
    currentEntries.every(
      (entry) =>
        Number(entry.account) >= 1000 &&
        ((Number(entry.debit) > 0 && Number(entry.credit || 0) === 0) ||
          (Number(entry.credit) > 0 && Number(entry.debit || 0) === 0))
    );
  const canSubmit =
    rowsAreComplete &&
    totals.debit > 0 &&
    difference < 0.005 &&
    Boolean(currentDescription.trim()) &&
    Boolean(currentDate) &&
    currentReason.trim().length >= 3;
  const isSubmitting = navigation.state === "submitting";

  const onSubmit = handleSubmit((values) => {
    const payload = new FormData();
    payload.append("description", values.description);
    payload.append("verificationDate", values.verificationDate);
    payload.append("journalEntries", JSON.stringify(values.journalEntries));
    payload.append("reason", values.reason);
    submit(payload, { method: "post" });
  });

  return (
    <section aria-labelledby="edit-verification-title" className="pb-20">
      <Link
        to="/admin/verifications"
        className="mb-3 inline-flex h-10 items-center rounded-lg px-1 text-xs font-bold text-stone-500 transition hover:text-stone-950"
      >
        <span aria-hidden="true" className="mr-2"><ArrowIcon direction="left" /></span>
        Till bokföringen
      </Link>

      <header className="max-w-3xl border-y border-stone-300 py-6 sm:py-8">
        <p className="accounting-kicker text-xs font-bold uppercase tracking-[0.14em]">
          Verifikation A{verification.verificationNumber}
        </p>
        <h2 id="edit-verification-title" className="mt-3 text-3xl tracking-tight text-stone-950 sm:text-4xl">
          Redigera bokföringsunderlag
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
          Ändringen sparas med tidigare värden, tidpunkt och orsak. Verifikationsnumret ligger kvar.
        </p>
      </header>

      {!policy.editable ? (
        <section className="mt-7 max-w-3xl border-y border-[#d3b6aa] bg-[#fbf3ef] px-4 py-6 sm:px-6 sm:py-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#985744]">
            Originalet är låst
          </p>
          <h3 className="mt-2 text-2xl text-stone-950">Skapa en rättelse i stället</h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
            {policy.reason}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/admin/verifications/new" className="accounting-primary-action">
              Ny rättelseverifikation <span aria-hidden="true" className="ml-2"><ArrowIcon /></span>
            </Link>
            <Link to="/admin/verifications" className="accounting-secondary-action">
              Tillbaka
            </Link>
          </div>
        </section>
      ) : (
        <form onSubmit={onSubmit} className="mt-7 space-y-6">
          <section className="max-w-4xl border-b border-stone-300 pb-6 sm:pb-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#985744]">
              Grunduppgifter
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <div>
                <label htmlFor="edit-description" className="mb-1.5 block text-xs font-bold text-stone-700">
                  Beskrivning
                </label>
                <input
                  id="edit-description"
                  type="text"
                  autoComplete="off"
                  maxLength={1000}
                  {...register("description")}
                  className="h-14 w-full rounded-xl border border-stone-300 bg-white px-4 text-base text-stone-900 outline-none transition focus:border-[#ad644f] focus:ring-2 focus:ring-[#efd8d0] sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="edit-verification-date" className="mb-1.5 block text-xs font-bold text-stone-700">
                  Bokföringsdatum
                </label>
                <Controller
                  control={control}
                  name="verificationDate"
                  render={({ field }) => (
                    <AccountingDateField
                      id="edit-verification-date"
                      value={field.value}
                      onChange={field.onChange}
                      label="Välj bokföringsdatum"
                    />
                  )}
                />
              </div>
            </div>
          </section>

          <section className="max-w-4xl border-b border-stone-300 pb-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#985744]">
                  Kontering
                </p>
                <h3 className="mt-1 text-2xl text-stone-950">Debet och kredit</h3>
              </div>
              <p className="text-xs text-stone-500">{fields.length} {fields.length === 1 ? "rad" : "rader"}</p>
            </div>

            <div className="mt-5 space-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="border-y border-stone-200 bg-[#fbfaf7] px-3 py-4 sm:px-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">
                      Konteringsrad {index + 1}
                    </p>
                    {fields.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="inline-flex h-9 items-center px-2 text-xs font-bold text-stone-400 transition hover:text-red-700"
                      >
                        Ta bort
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(16rem,1.2fr)_minmax(15rem,.8fr)]">
                    <div className="min-w-0">
                      <label htmlFor={`edit-account-${index}`} className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.13em] text-stone-500">
                        Konto
                      </label>
                      <Controller
                        control={control}
                        name={`journalEntries.${index}.account`}
                        render={({ field: accountField }) => (
                          <ClientOnly fallback={<div className="h-[3.25rem] rounded-xl bg-stone-100" />}>
                            {() => (
                              <Select
                                instanceId={`edit-account-${index}`}
                                inputId={`edit-account-${index}`}
                                options={accounts}
                                value={accounts.find((account) => account.value === accountField.value)}
                                onChange={(option) => accountField.onChange(option?.value ?? 0)}
                                placeholder="Sök eller välj konto"
                                className="text-sm"
                                classNamePrefix="verification-account"
                              />
                            )}
                          </ClientOnly>
                        )}
                      />
                    </div>

                    <JournalEntryAmountField
                      id={`edit-journal-entry-${index}`}
                      debit={Number(currentEntries[index]?.debit || 0)}
                      credit={Number(currentEntries[index]?.credit || 0)}
                      onChange={({ debit, credit }) => {
                        setValue(`journalEntries.${index}.debit`, debit, {
                          shouldDirty: true,
                        });
                        setValue(`journalEntries.${index}.credit`, credit, {
                          shouldDirty: true,
                        });
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => append({ account: 0, debit: 0, credit: 0 })}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-dashed border-stone-300 bg-[#fffdf9] px-4 text-xs font-bold text-stone-600 transition hover:border-[#c58a79] hover:text-[#985744]"
              >
                <span aria-hidden="true" className="mr-2"><PlusMinusIcon /></span>
                Lägg till rad
              </button>
              <dl className="grid grid-cols-2 gap-x-7 text-right text-xs tabular-nums text-stone-600">
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-stone-400">Debet</dt><dd className="mt-1 font-bold text-stone-900">{money.format(totals.debit)}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-stone-400">Kredit</dt><dd className="mt-1 font-bold text-stone-900">{money.format(totals.credit)}</dd></div>
              </dl>
            </div>
            {difference >= 0.005 ? (
              <p className="mt-3 text-right text-xs font-bold text-red-700">
                Differens {money.format(difference)}
              </p>
            ) : null}
          </section>

          <section className="max-w-3xl border-b border-stone-300 pb-7">
            <label htmlFor="edit-reason" className="block text-xs font-bold text-stone-700">
              Varför ändras verifikationen?
            </label>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              Orsaken sparas i revisionshistoriken tillsammans med de tidigare värdena.
            </p>
            <textarea
              id="edit-reason"
              rows={3}
              maxLength={500}
              {...register("reason")}
              placeholder="Exempel: Fel belopp på leverantörsfakturan"
              className="mt-3 w-full resize-y rounded-xl border border-stone-300 bg-white px-4 py-3 text-base leading-6 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-[#ad644f] focus:ring-2 focus:ring-[#efd8d0] sm:text-sm"
            />
          </section>

          {actionData?.error ? (
            <p role="alert" className="max-w-3xl border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
              {actionData.error}
            </p>
          ) : null}

          <div className="accounting-form-actions flex max-w-3xl flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link to="/admin/verifications" className="accounting-cancel-action">
              Avbryt
            </Link>
            <button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="accounting-submit-action disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            >
              {isSubmitting ? "Sparar ändringen…" : "Spara ändringen"}
              {!isSubmitting ? <span aria-hidden="true"><ArrowIcon /></span> : null}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
