import { json, LoaderFunction } from "@remix-run/node";
import { Link, Outlet, useLoaderData } from "@remix-run/react";
import { Verifications } from "~/schemas/verifications";
import { ListVerification } from "~/components/admin/listVerification";
import { VerificationProps } from "~/types";
import { getDomain } from "~/utils/domain";
import { auth } from "~/services/auth.server";

export const loader: LoaderFunction = async ({ request }) => {

  const user = await auth.isAuthenticated(request, { failureRedirect: "/login" });  
  const domain =  getDomain(request);


  const verificationsPromise = Verifications.find({
    verificationDate: {
      $gte: new Date(`${user.fiscalYear}-01-01`),
      $lt: new Date(`${user.fiscalYear + 1}-01-01`),
    },
    domain: domain?.domain,
  }).sort({ verificationDate: -1 });

  const vatReportsPromise = Verifications.find({
    "metadata.key": "vatReport", // Endast momsrapporter
    verificationDate: {
      $gte: new Date(`${user.fiscalYear + 1}-01-01`), // Start januari året efter
      $lt: new Date(`${user.fiscalYear + 1}-03-01`), // Slut februari året efter
    },
    domain: domain?.domain,
  }).exec()



  // Hämta senaste verifikationsnumret
  const latestVerificationNumberPromise = Verifications.findOne({domain: domain?.domain})
    .sort({ verificationNumber: -1 }) // Sortera i fallande ordning
    .select("verificationNumber") // Hämta bara verifikationsnumret
    .exec();

  const [verifications, latestVerification, vatReports] = await Promise.all([
    verificationsPromise,
    latestVerificationNumberPromise,
    vatReportsPromise
  ]);

  // Extrahera verifikationsnumret om det finns ett resultat
  const latestVerificationNumber = latestVerification?.verificationNumber || 0;

  return json({ verifications, year: user.fiscalYear, latestVerificationNumber, vatReports });
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
  vatReports: VerificationProps[];
  latestVerificationNumber: number;
  year: number;
};

export default function VerificationsPage() {
  const { verifications, year, latestVerificationNumber, vatReports } =
    useLoaderData<LoaderData>();
  const groupedVerifications = groupByMonth(verifications);

const hasVatReport = (
  verifications: VerificationProps[],
  monthKey: string
): VerificationProps | undefined => {
  const foundInVerifications = verifications.find((verification) =>
    verification.metadata.some(
      (meta) => meta.key === "vatReport" && meta.value === monthKey
    )
  );

  // Om momsrapport hittas i vanliga verifikationer, returnera den
  if (foundInVerifications) {
    return foundInVerifications;
  }

  const foundInVatReports = vatReports.find((report) =>
    report.metadata.some(
      (meta) => meta.key === "vatReport" && meta.value === monthKey
    )
  );

  return foundInVatReports;
};

  return (
    <div className="mt-20 p-2">
      <div className="mt-4 flex items-center justify-between">
        <div>
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
            className="ml-2 bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
          >
            Balans och resultaträkning
          </Link>
          <Link
            to="/admin/verifications/settings"
            prefetch="intent"
            className="ml-2 bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
          >
            Välj bokföringsår
          </Link>
        </div>
      </div>
      <div className="mb-20 mt-10 mx-auto">
      {Object.keys(groupedVerifications).length === 0 ?
      
        <div className="-mt-6 text-sm border p-2 pt-4 pb-4 text-white border-sky-950 bg-sky-700 rounded-lg">
          Inga verifikationer för bokföringsåret {year}
          </div>
      : null }


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
