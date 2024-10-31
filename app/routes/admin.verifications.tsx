import { z, ZodError } from "zod";
import { ActionFunction, json, LoaderFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Verifications } from "~/schemas/verifications";
import { generateNextEntryNumber } from "~/utils/verificationUtil";
import { Verification } from "~/components/admin/verification";
import { ListVerification } from "~/components/admin/listVerification";
import { VerificationProps } from "~/types";

const formSchema = z.object({
  description: z.string().min(1, "Beskrivning är obligatorisk"),
  verificationDate: z.string().nonempty("Datum är obligatoriskt"),
  journalEntries: z
    .array(
      z.object({
        account: z.number().min(1, "Konto är obligatoriskt"),
        debit: z.preprocess(
          (v) => (v === "" || v === null ? 0 : parseFloat(v as string)),
          z.number().min(0, "Debet måste vara ett tal")
        ),
        credit: z.preprocess(
          (v) => (v === "" || v === null ? 0 : parseFloat(v as string)),
          z.number().min(0, "Kredit måste vara ett tal")
        ),
      })
    )
    .min(1, "Du måste lägga till minst en journalpost")
    .refine(
      (entries) => entries.some((entry) => entry.debit > 0 || entry.credit > 0),
      {
        message: "Varje rad måste ha ett debet eller kreditvärde",
      }
    ),
  file: z
    .object({
      filePath: z.string().url(),
      label: z.string(),
    })
    .optional(), // Markera filen som valfri
});

type FormData = z.infer<typeof formSchema>;

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  // Kör båda asynkrona anropen parallellt med Promise.all()
  const verifications = await Verifications.find({
    verificationDate: {
      $gte: new Date(`${year}-01-01`),
      $lt: new Date(`${year + 1}-01-01`),
    },
  }).sort({ verificationDate: -1 });

  return json({ verifications, year });
};

export const action: ActionFunction = async ({ request, params }) => {
  const formData = await request.formData();
  const description = formData.get("description");
  const verificationDate = formData.get("verificationDate"); 
  const journalEntries = JSON.parse(formData.get("journalEntries") as string);

  // Deserialisera filinformationen om den finns
  let file = null;
  const fileData = formData.get("file");
  if (fileData) {
    try {
      file = JSON.parse(fileData as string); // Filinmatningen är JSON, deserialisera den
    } catch (error) {
      file = undefined;
      console.error("Error parsing file data:", error);
    }
  }

  const dateForDatabase = new Date(verificationDate);

  // Validera med Zod och kolla om resultatet är success
  const result = formSchema.safeParse({
    description,
    file,
    verificationDate,
    journalEntries,
  });

  if (!result.success) {
    const s = result.error as ZodError;

    return json(
      {
        success: false,
        errors: s.issues.reduce((acc, i) => {
          acc[i.path[0]] = i.message;
          return acc;
        }, {} as any),
      },
      { status: 400 }
    );
  }

  try {
    const newVerification = new Verifications({
      description,
      verificationNumber: await generateNextEntryNumber(),
      verificationDate: dateForDatabase, // Spara som Date om det behövs
      journalEntries,
      files: file ? [{ name: file.label, path: file.filePath }] : [],
    });

    await newVerification.save();

    return json({
      success: true,
      message: "Verifikation sparades framgångsrikt",
      verification: newVerification,
    });
  } catch (e) {
    return json(
      {
        success: false,
        message: "Ett fel inträffade vid sparande av verifikation",
      },
      { status: 500 }
    );
  }
};

const groupByMonth = (verifications: VerificationProps[]) => {
  const grouped = {};

  verifications.forEach((verification) => {
    const date = new Date(verification.verificationDate);
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;

    if (!grouped[monthKey]) {
      grouped[monthKey] = [];
    }

    grouped[monthKey].push(verification);
  });

  Object.keys(grouped).forEach((monthKey) => {
    grouped[monthKey].sort((a, b) => {
      const dateA = new Date(a.verificationDate).setHours(0, 0, 0, 0);
      const dateB = new Date(b.verificationDate).setHours(0, 0, 0, 0);

      if (dateA !== dateB) {
        return dateB - dateA;
      }
      return b.verificationNumber - a.verificationNumber;
    });
  });

  return grouped;
};

type LoaderData = {
  verifications: VerificationProps[];
  year: number;
};

export default function VerificationsPage() {
  const { verifications } = useLoaderData<LoaderData>();

  const groupedVerifications = groupByMonth(verifications);

  const hasVatReport = (
    verifications: VerificationProps[],
    monthKey: string
  ) => {
    return verifications.find((verification: VerificationProps) =>
      verification.metadata.some(
        (meta) => meta.key === "vatReport" && meta.value === monthKey
      )
    );
  };

  return (
    <div className="mt-20 p-2">
      <Verification />
      <Link
        to="/admin/verifications/financial-overview"
        prefetch="intent"
        className="bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
      >
        Balans och resultaträkning
      </Link>
      <div className="mb-20 mt-20 mx-auto">
        {Object.keys(groupedVerifications).map((monthKey, index) => {
          const monthHasVatReport = hasVatReport(verifications, monthKey);
          return (
            <ListVerification
              key={monthKey}
              groupedVerifications={groupedVerifications}
              vatReportVerification={monthHasVatReport}
              monthKey={monthKey}
              isExpanded={index === 0}
            />
          );
        })}
      </div>
    </div>
  );
}
