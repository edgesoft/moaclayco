import { useNavigate, useSearchParams, useLoaderData, useSubmit } from "@remix-run/react";
import { ActionFunction, json, LoaderFunction, redirect } from "@remix-run/node";
import { useForm } from "react-hook-form";
import { Verifications } from "~/schemas/verifications"; // Din MongoDB schema
import { classNames } from "~/utils/classnames";
import { generateNextEntryNumber } from "~/utils/verificationUtil";

// Loader-funktion för att hämta verifikationer från MongoDB för en viss månad
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // Få månaden som query param
  if (!month) {
    return json({ error: "Ingen månad specificerad" }, { status: 400 });
  }

  const [year, monthNumber] = month.split("-"); // Dela upp månad och år
// Skapa start- och slutdatum för månaden
const startOfMonth = new Date(Number(year), Number(monthNumber) - 1, 1); // Första dagen i månaden
const endOfMonth = new Date(Number(year), Number(monthNumber), 0); // Sista dagen i månaden
endOfMonth.setHours(23, 59, 59, 999); // Sätt tiden till slutet av dagen

// Hämta alla verifikationer för den angivna månaden
const verifications = await Verifications.find({
  verificationDate: {
    $gte: startOfMonth,
    $lte: endOfMonth, // Ändrat från $lt till $lte för att inkludera sista dagen
  },
});

  // Filtrera fram relevanta journal entries
  const vatSales = verifications.filter(
    (v) => v.journalEntries.some((entry) => entry.account === 3001) // Försäljning av varor
  );

  const outgoingVAT = verifications.filter(
    (v) => v.journalEntries.some((entry) => entry.account === 2611) // Utgående moms
  );

  const ingoingVAT = verifications.filter(
    (v) => v.journalEntries.some((entry) => entry.account === 2640) // Ingående moms
  );

  return json({
    vatSales,
    outgoingVAT,
    ingoingVAT,
  });
};



export const action: ActionFunction = async ({ request, params }) => {
    const formData = await request.formData();
    const submissionDate = formData.get("submissionDate");
  
    if (!submissionDate) {
      return json({ error: "Inget datum valt" }, { status: 400 });
    }
  
// Hjälpfunktion för att formatera månadens namn
const formatMonthName = (year, monthNumber) => {
    const monthNames = [
      "Januari", "Februari", "Mars", "April", "Maj", "Juni",
      "Juli", "Augusti", "September", "Oktober", "November", "December"
    ];
    return `${monthNames[parseInt(monthNumber, 10) - 1]} ${year}`;
  };


  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // Få månaden som query param
  if (!month) {
    return json({ error: "Ingen månad specificerad" }, { status: 400 });
  }

  const [year, monthNumber] = month.split("-"); // Dela upp månad och år
  const startOfMonth = new Date(`${year}-${monthNumber}-01`);
  const endOfMonth = new Date(startOfMonth);

  endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    // Format submissionDate som en Date i MongoDB
    const formattedDate = new Date(submissionDate);
  
    // Definiera konton
    const salesAccount = 3001; // Försäljning av varor
    const outgoingVatAccount = 2611; // Utgående moms
    const incomingVatAccount = 2640; // Ingående moms
    const vatDebtAccount = 2650; // Momsskuld eller fordran
    const roundingAccount = 3740; // Öres- och kronutjämning
  
    // Hämta alla verifikationer för den valda månaden
    const [yearSubmission, monthSubmissionNumber] = submissionDate.split("-");
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
  
    
  const verifications = await Verifications.find({
    verificationDate: {
      $gte: startOfMonth,
      $lt: endOfMonth,
    },
  });



  // Summera ingående moms (2640)
  let totalIncomingVat = 0;
  verifications.forEach(v => {
    v.journalEntries.forEach(entry => {
      if (entry.account === incomingVatAccount) {
        totalIncomingVat += entry.debit || 0;
        totalIncomingVat -= entry.credit || 0;
      }
    });
  });

  // Summera utgående moms (2611)
  let totalOutgoingVat = 0;
  verifications.forEach(v => {
    v.journalEntries.forEach(entry => {
      if (entry.account === outgoingVatAccount) {
        totalOutgoingVat += entry.credit || 0;
        totalOutgoingVat -= entry.debit || 0;
      }
    });
  });

  // Beräkna momsskuld eller momsfordran (skillnad mellan utgående och ingående moms)
  const vatToPayOrRefund = totalOutgoingVat - totalIncomingVat;
  const roundedVatToPayOrRefund = Math.round(vatToPayOrRefund);

  // Beräkna avrundningsskillnad för öresutjämning
  const roundingDifference = vatToPayOrRefund - roundedVatToPayOrRefund;

  // Journalposter för momsrapport
  const journalEntries = [
    {
      account: incomingVatAccount, // Ingående moms
      debit: totalIncomingVat.toFixed(2), // Totalt ingående moms
      credit: 0,
    },
    {
      account: outgoingVatAccount, // Utgående moms
      debit: 0,
      credit: totalOutgoingVat.toFixed(2), // Totalt utgående moms
    },
    {
      account: vatDebtAccount, // Momsskuld eller momsfordran
      debit: vatToPayOrRefund > 0 ? roundedVatToPayOrRefund.toFixed(2) : 0, // Skuld om positivt belopp
      credit: vatToPayOrRefund < 0 ? Math.abs(roundedVatToPayOrRefund).toFixed(2) : 0, // Fordran om negativt belopp
    },
  ];

  // Lägg till öres- och kronutjämning om det finns en skillnad efter avrundning
  if (Math.abs(roundingDifference) > 0) {
    journalEntries.push({
      account: roundingAccount, // Öres- och kronutjämning
      debit: roundingDifference > 0 ? roundingDifference.toFixed(2) : 0,
      credit: roundingDifference < 0 ? Math.abs(roundingDifference).toFixed(2) : 0,
    });
  }


    // Skapa och spara verifikationen
    const newVerification = new Verifications({
      description: `Momsrapport för ${formatMonthName(year, monthNumber)}`,
      verificationNumber: await generateNextEntryNumber(),
      verificationDate: formattedDate,
      journalEntries: journalEntries,
      metadata: [
        {
            key: "vatReport",
            value: month
        }
      ]
    });

    console.log(newVerification)
  
    await newVerification.save();
  
    return redirect('/admin/verifications')


  };

// Funktion för att formatera månadens namn
const formatMonthName = (yearMonth) => {
  const [year, month] = yearMonth.split("-");
  const monthNames = [
    "Januari",
    "Februari",
    "Mars",
    "April",
    "Maj",
    "Juni",
    "Juli",
    "Augusti",
    "September",
    "Oktober",
    "November",
    "December",
  ];
  return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
};

// Funktion för att summera belopp i en lista av journalEntries
const sumAmounts = (verifications, account) => {
  return verifications
    .reduce((total, v) => {
      const amount = v.journalEntries
        .filter((entry) => entry.account === account)
        .reduce((acc, entry) => acc + (entry.debit || entry.credit), 0);
      return total + amount;
    }, 0)
    .toFixed(2);
};

// VATReportModal-komponenten
export default function VATReportModal() {
  const navigate = useNavigate();
  const { vatSales, outgoingVAT, ingoingVAT } = useLoaderData(); // Data från loader
  const [searchParams] = useSearchParams();
  const month = searchParams.get("month");
  const submit = useSubmit();
  const { register, handleSubmit } = useForm();

  // Funktion som körs när användaren klickar på "Skapa verifikation"
  const onSubmit = (data) => {
    console.log("Skapar verifikation med följande data:", data);
    // Skicka data till servern eller utför någon åtgärd här

    submit(data, { method: "post" });
  };

  return (
    <div
      className="fixed z-10 inset-0 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-end justify-center text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>
        <span
          className="hidden sm:inline-block sm:align-middle sm:h-screen"
          aria-hidden="true"
        >
          &#8203;
        </span>
        <div className="inline-block align-bottom text-left bg-white rounded-lg shadow-xl overflow-hidden transform transition-all sm:align-middle sm:my-8 sm:w-full sm:max-w-6xl">
          <div className="bg-white px-6 py-5 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start ">
              <div className="text-center sm:ml-4 sm:text-left w-full">
                <h3
                  className="text-xl leading-6 font-bold text-gray-900"
                  id="modal-title"
                >
                  Momsrapport för {formatMonthName(month)}
                </h3>

                <div className="mt-6">
                <div className="mb-6">
                  <form
                    onSubmit={handleSubmit(onSubmit)}
                    className="flex items-center space-x-4 mt-4"
                  >
                    {/* Datumfält */}
                    <div className="flex items-center space-x-2 w-2/3">
                      <input
                        type="date"
                        id="submissionDate"
                        {...register("submissionDate", { required: true })}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    </div>

                    {/* Skapa verifikation-knapp */}
                    <button
                      type="submit"
                      className="w-1/3 inline-flex items-center justify-center px-4 py-2 text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      Skapa verifikation
                    </button>
                  </form>
                  </div>

                  {/* Resten av din komponent med Momspliktig försäljning, Utgående moms och Ingående moms */}
                  {/* Momspliktig försäljning */}
                  <div className="mb-8">
                    <h4 className="font-semibold text-lg text-gray-700">
                      Momspliktig försäljning (ej ruta 06, 07, 08)
                    </h4>
                    {vatSales.length > 0 ? (
                      <table className="w-full table-auto divide-y divide-gray-300">
                        <thead className="bg-gray-50">
                          <tr>
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Verifikationsnummer
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-3 text-right text-sm font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Belopp
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {vatSales.map((v) => (
                            <tr key={v._id}>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                                <span
                                  className={classNames(
                                    `bg-green-600 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`
                                  )}
                                >
                                  {" "}
                                  A{v.verificationNumber}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                                {v.journalEntries
                                  .filter((entry) => entry.account === 3001)
                                  .map((entry) => (
                                    <span key={entry._id}>
                                      {entry.credit.toFixed(2)} SEK
                                    </span>
                                  ))}
                              </td>
                            </tr>
                          ))}
                          <tr className="font-bold bg-gray-100">
                            <td className="px-4 py-3">Total försäljning</td>
                            <td className="px-4 py-3 text-right">
                              {sumAmounts(vatSales, 3001)} SEK
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-gray-500">
                        Ingen momspliktig försäljning
                      </p>
                    )}
                  </div>

                  {/* Utgående moms */}
                  <div className="mb-8">
                    <h4 className="font-semibold text-lg text-gray-700">
                      Utgående moms
                    </h4>
                    {outgoingVAT.length > 0 ? (
                      <table className="w-full table-auto divide-y divide-gray-300">
                        <thead className="bg-gray-50">
                          <tr>
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Verifikationsnummer
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-3 text-right text-sm font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Belopp
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {outgoingVAT.map((v) => (
                            <tr key={v._id}>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                                <span
                                  className={classNames(
                                    `bg-green-600 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`
                                  )}
                                >
                                  {" "}
                                  A{v.verificationNumber}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                                {v.journalEntries
                                  .filter((entry) => entry.account === 2611)
                                  .map((entry) => (
                                    <span key={entry._id}>
                                      {entry.credit.toFixed(2)} SEK
                                    </span>
                                  ))}
                              </td>
                            </tr>
                          ))}
                          <tr className="font-bold bg-gray-100">
                            <td className="px-4 py-3">Total utgående moms</td>
                            <td className="px-4 py-3 text-right">
                              {sumAmounts(outgoingVAT, 2611)} SEK
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-gray-500">Ingen utgående moms</p>
                    )}
                  </div>

                  {/* Ingående moms */}
                  <div className="">
                    <h4 className="font-semibold text-lg text-gray-700">
                      Ingående moms
                    </h4>
                    {ingoingVAT.length > 0 ? (
                      <table className="w-full table-auto divide-y divide-gray-300">
                        <thead className="w-full bg-gray-50">
                          <tr className="w-full">
                            <th
                              scope="col"
                              className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Verifikationsnummer
                            </th>
                            <th
                              scope="col"
                              className="px-4 py-3 text-right text-sm font-medium text-gray-500 uppercase tracking-wider"
                            >
                              Belopp
                            </th>
                          </tr>
                        </thead>
                        <tbody className="w-full bg-white divide-y divide-gray-200">
                          {ingoingVAT.map((v) => (
                            <tr key={v._id}>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                                <span
                                  className={classNames(
                                    `bg-green-600 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`
                                  )}
                                >
                                  {" "}
                                  A{v.verificationNumber}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
                                {v.journalEntries
                                  .filter((entry) => entry.account === 2640)
                                  .map((entry) => (
                                    <span key={entry._id}>
                                      {entry.debit.toFixed(2)} SEK
                                    </span>
                                  ))}
                              </td>
                            </tr>
                          ))}
                          <tr className="font-bold bg-gray-100">
                            <td className="px-4 py-3">Total ingående moms</td>
                            <td className="px-4 py-3 text-right">
                              {sumAmounts(ingoingVAT, 2640)} SEK
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-gray-500">Ingen ingående moms</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-6 py-3 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
              onClick={() => navigate(-1)}
            >
              Stäng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
