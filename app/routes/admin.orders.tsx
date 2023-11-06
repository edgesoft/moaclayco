import { LoaderFunction } from "@remix-run/node";
import { Orders as OrderEntity } from "../schemas/orders";
import {
  Outlet,
  useLoaderData,
  useNavigate,
  useParams,
} from "@remix-run/react";
import React, { useEffect, useState } from "react";

export let loader: LoaderFunction = async ({ params }) => {
  return OrderEntity.find(
    {
      status: { $in: ["SUCCESS", "FAILED", "SHIPPED", "CANCELLED"] },
    },
    { status: 1, createdAt: 1, customer: 1, _id: 1, totalSum: 1 }
  )
    .sort({ createdAt: -1 })
    .limit(100);
};

enum Status {
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  SHIPPED = "SHIPPED",
  CANCELLED = "CANCELLED",
}

const getLabel = (status: Status) => {
  switch (status) {
    case Status.SUCCESS:
      return {
        headline: "Betald",
        color: "bg-blue-600",
      };
    case Status.FAILED:
      return { headline: "Fel", color: "bg-red-600" };
    case Status.SHIPPED:
      return { headline: "Levererad", color: "bg-green-600" };
    default:
      return {
        headline: "Betald",
        color: "bg-blue-600",
      };
  }
};

type OrderLabelProp = {
  status: Status;
};

export type Order = {
  status: Status;
  _id: string;
  createdAt: string;
  customer: {
    firstname: string;
    lastname: string;
  };
  totalSum: number;
};

const OrderLabel: React.FC<OrderLabelProp> = ({
  status,
}): JSX.Element | null => {
  const label = getLabel(status);
  return (
    <span
      className={`${label.color} text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`}
    >
      {label.headline}
    </span>
  );
};

function formatSwedishPrice(amount: number) {
  return amount
    .toLocaleString("sv-SE", {
      style: "currency",
      currency: "SEK",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(" kr", " kr"); // Replace non-breaking space with a regular space before "kr"
}

export default function Orders() {
  let data: Order[] = useLoaderData();
  let navigate = useNavigate();
  let { id } = useParams();
  let [showDetail, setShowDetail] = useState(id)

  // Store the scroll position before navigation
  const handleRowClick = (orderId: string) => {
    sessionStorage.setItem("scrollPosition", window.scrollY.toString());
    if (showDetail && showDetail === orderId) {
        setShowDetail(undefined)
        navigate(`/admin/orders`)
    } else {
        setShowDetail(orderId)
        navigate(`/admin/orders/${orderId}`);
    }
   
  };

  // Restore the scroll position after navigation
  useEffect(() => {
    if (id) {
      const element = document.getElementById(id);
      if (element) {
        const y =
          element.getBoundingClientRect().top +
          window.scrollY -
          element.getBoundingClientRect().height -
          20;

        window.scrollTo({ top: y });
      }
    }
  }, [id]); // Dependency on `id` ensures scroll restoration when a new row is clicked

  return (
    <div className="w-full mt-20 p-1 pt-4">
      <div className="overflow-x-auto shadow-md sm:rounded-lg">
        <table className="min-w-full text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50">
            <tr>
              <th scope="col" className="max-w-xs pl-2 pr-2 py-3">
                ORDER NR
              </th>
              <th
                scope="col"
                className="pr-2 py-3 w-32"
              >
                STATUS
              </th>
              <th scope="col" className="w-36 py-3 tracking-wider">
                DATUM
              </th>
              <th
                scope="col"
                className="pr-4 py-3 tracking-wider hidden sm:table-cell"
              >
                NAMN
              </th>
              <th
                scope="col"
                className="pr-4 py-3 tracking-wider hidden sm:table-cell"
              >
                PRIS
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => {
              return (
                <React.Fragment key={d._id}>
                  <tr
                    id={d._id}
                    className="bg-white border-b border-gray-200"
                    onClick={() => handleRowClick(d._id)}
                  >
                    <td className="max-w-xs pl-2 pr-2 py-4 tracking-wider">
                      {d._id.substring(0, 10)}{" "}
                    </td>
                    <td className="pr-2 py-4 w-32">
                      <OrderLabel status={d.status} />
                    </td>
                    <td className="w-36 py-4 tracking-wider">
                      {d.createdAt.substring(0, 16).replace("T", " ")}
                    </td>
                    <td className="pr-4 py-4 tracking-wider  hidden sm:table-cell">
                      {`${d.customer.firstname} ${d.customer.lastname}`}
                    </td>
                    <td className="pr-4 py-4 tracking-wider  hidden sm:table-cell">
                      {`${formatSwedishPrice(d.totalSum)}`}
                    </td>
                  </tr>
                  {id === d._id ? (
                    <tr>
                      <td colSpan={5}>
                        <Outlet />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
