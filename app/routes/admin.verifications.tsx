import { json, LoaderFunction } from "@remix-run/node";
import { Link, Outlet, useLoaderData } from "@remix-run/react";
import { Verifications } from "~/schemas/verifications";
import { ListVerification } from "~/components/admin/listVerification";
import { VerificationProps } from "~/types";


export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  // Kör båda asynkrona anropen parallellt med Promise.all()
  const verificationsPromise = Verifications.find({
    verificationDate: {
      $gte: new Date(`${year}-01-01`),
      $lt: new Date(`${year + 1}-01-01`),
    },
  }).sort({ verificationDate: -1 });

  // Hämta senaste verifikationsnumret
  const latestVerificationNumberPromise = Verifications.findOne()
    .sort({ verificationNumber: -1 }) // Sortera i fallande ordning
    .select("verificationNumber") // Hämta bara verifikationsnumret
    .exec();

  const [verifications, latestVerification] = await Promise.all([
    verificationsPromise,
    latestVerificationNumberPromise,
  ]);

  // Extrahera verifikationsnumret om det finns ett resultat
  const latestVerificationNumber = latestVerification?.verificationNumber || 0;

  return json({ verifications, year, latestVerificationNumber });
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
  latestVerificationNumber: number
};

export default function VerificationsPage() {
  const { verifications, latestVerificationNumber } = useLoaderData<LoaderData>();
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
      <div className="mt-4">
      <Outlet context={{ latestVerificationNumber }} />
      <Link
        to="/admin/verifications/new"
        prefetch="intent"
        className="bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
      >
        Ny verifikation
      </Link>
      <Link
        to="/admin/verifications/financial-overview"
        prefetch="intent"
        className="ml-4 bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
      >
        Balans och resultaträkning
      </Link>
      </div>
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
