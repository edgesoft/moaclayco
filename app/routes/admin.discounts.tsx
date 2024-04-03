import { LoaderFunction } from "@remix-run/node";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "@remix-run/react";
import React, { useEffect } from "react";
import { auth } from "~/services/auth.server";
import { formatDateToUTC } from "~/utils/formatDateToUTC";
import { DiscountType } from "~/types";
import { IndexProps } from "~/root";

export let loader: LoaderFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  return await DiscountEntity.find({}).sort({code: 1});
};

const getLabel = (balance: number) => {
  if (!balance || balance === 0) {
    return {
      headline: `Slut`,
      color: "bg-blue-600",
    };
  }
  return { headline: `${balance}`, color: "bg-green-600" };
};

type DiscountLabelProp = {
  balance: number;
};


const DiscountLabel: React.FC<DiscountLabelProp> = ({
  balance,
}): JSX.Element | null => {
  const label = getLabel(balance);
  return (
    <span
      className={`${label.color} text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`}
    >
      {label.headline}
    </span>
  );
};

export default function Orders() {
  let data = useLoaderData<DiscountType[]>();
  let navigate = useNavigate();
  const { user } = useOutletContext<IndexProps>();

  const handleRowClick = (id: string) => {
    sessionStorage.setItem("scrollPosition", window.scrollY.toString());
    navigate(`/admin/discounts/${id}`);
  };

  useEffect(() => {
    return () => {
      const scrollY = sessionStorage.getItem("scrollPosition");
      window.scrollTo(0, scrollY ? parseInt(scrollY, 10) : 0);
    };
  }, []);

  return (
    <>
      <Outlet />

      <div className="w-full mt-20 p-1 pt-4 mb-20">
        <div className="overflow-x-auto shadow-md sm:rounded-lg">
          <table className="min-w-full text-sm text-left text-gray-500">
          <thead>
  <tr>
    <th scope="col" className="pl-2 pr-4 py-3 w-1/4 md:w-1/5 lg:w-1/4">
      KOD
    </th>
    <th scope="col" className="pr-4 py-3 w-1/4 md:w-1/5 lg:w-1/4">
      ANTAL
    </th>
    <th scope="col" className="pr-4 py-3 w-1/4 md:w-1/5 lg:w-1/4">
      PROCENT
    </th>
    <th
      scope="col"
      className="pr-4 py-3 w-1/4 md:w-1/5 lg:w-1/4 md:block hidden whitespace-nowrap"
    >
      T.O.M.
    </th>
  </tr>
</thead>
            <tbody>
              {data.map((d) => (
                <tr
                  key={d._id}
                  className="bg-white border-b border-gray-200 cursor-pointer"
                  onClick={() => handleRowClick(d._id)}
                >
                  <td className="pl-2 pr-4 py-4 w-1/4 md:w-1/5 lg:w-1/4">
                    {d.code}
                  </td>
                  <td className="pr-4 py-4 w-1/4 md:w-1/5 lg:w-1/4">
                    <DiscountLabel balance={d.balance} />
                  </td>
                  <td className="pr-4 py-4 w-1/4 md:w-1/5 lg:w-1/4">
                    {d.percentage}
                  </td>
                  <td className="pr-4 py-3 w-1/4 md:w-1/5 lg:w-1/4 md:block hidden whitespace-nowrap">
                    {d.expireAt ? formatDateToUTC(d.expireAt) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {user ? (
          <div className="fixed right-5 md:right-10 bottom-16 md:bottom-20">
            <button
              onClick={() => {
                navigate(`/admin/discounts/new`);
              }}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold p-2 rounded-full inline-flex items-center justify-center shadow-lg transform transition duration-150 ease-in-out hover:scale-110"
              style={{ width: "3rem", height: "3rem" }} // Adjust the size as needed
            >
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </div>
        ) : null}
    </>
  );
}
