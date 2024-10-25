import { ActionFunction, LoaderFunction, MetaFunction } from "@remix-run/node";
import { Orders } from "../schemas/orders";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { classNames } from "~/utils/classnames";
import React, { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { auth } from "~/services/auth.server";
import stripeClient from "../stripeClient";
import { sendMail } from "./webhook";
import { Template } from "~/components/mail/order";
import { Order } from "~/types";
import { Verifications } from "~/schemas/verifications";
import { generateNextEntryNumber } from "~/utils/verificationUtil";

export let loader: LoaderFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  const order = await Orders.findOne({
    _id: params.id,
  });

  const verification = await Verifications.findOne({
    "metadata.key": "orderId",
    "metadata.value": params.id,
  });

  let intent = null;

  if (order.status === "FAILED") {
    try {
      if (order.paymentIntent && order.paymentIntent.id) {
        intent = await stripeClient.paymentIntents.retrieve(
          order.paymentIntent.id
        );
      }
      return { order, intent, verification };
    } catch (e) {}
  }
  return { order, intent: null, verification };
};

export let meta: MetaFunction = ({ data }) => {
  return [
    {
      title: `Moa Clay Collection (order: ${data._id})`,
    },
    {
      name: "description",
      content: `Order: ${data._id}`,
    },
  ];
};

export let action: ActionFunction = async ({ request, params }) => {
  let body = new URLSearchParams(await request.text());
  const type = body.get("_action") || "";

  if (type === "verification") {
    const order: Order | null = await Orders.findOne({ _id: params.id }).lean();

    if (!order) return {}

    let intent = null;
    if (order.paymentIntent && order.paymentIntent.id) {
      intent = await stripeClient.paymentIntents.retrieve(
        order.paymentIntent.id,
        {
          expand: ["charges"], // Expanderar charges
        }
      );

      const chargeId = intent.latest_charge;
      const charge = await stripeClient.charges.retrieve(chargeId);

      if (typeof charge.balance_transaction === "string") {
        const balanceTransaction =
          await stripeClient.balanceTransactions.retrieve(
            charge.balance_transaction
          );

        // Totalbelopp i SEK
        const totalAmount = balanceTransaction.amount / 100; // Bruttobelopp (inklusive moms) i SEK
        const stripeFee = balanceTransaction.fee / 100; // Stripe-avgiften i SEK
        const netAmount = balanceTransaction.net / 100; // Nettobelopp att betalas ut i SEK

        // Beräkna momsbelopp baserat på bruttobeloppet
        const vatRate = 0.25; // 25% moms
        const vatAmount = (totalAmount * vatRate) / (1 + vatRate); // Momsbelopp
        const amountExVat = totalAmount - vatAmount; // Belopp exklusive moms

        await Verifications.create({
          verificationDate: order.webhookAt,
          description: `Order id: ${order._id}\r\nPayment intent id: ${intent.id}`,
          verificationNumber: await generateNextEntryNumber(),
          metadata: [
            {
              key: "orderId",
              value: `${order._id}`
            },
            {
              key: "paymentIntentId",
              value: `${intent.id}`
            },
          ],
          journalEntries: [
            {
              account: 3001, // Försäljning exkl. moms
              credit: amountExVat.toFixed(2), // Belopp exklusive moms
            },
            {
              account: 2611, // Moms
              credit: vatAmount.toFixed(2), // Momsbelopp
            },
            {
              account: 6570, // Stripe-avgifter
              debit: stripeFee.toFixed(2), // Stripe-avgift
            },
            {
              account: 1580, // Fordran på Stripe
              debit: netAmount.toFixed(2), // Nettobelopp efter avgift
            }
          ]
        });

        return {}

        /**
        const payouts = await stripeClient.payouts.list({
          limit: 10,  // Justera denna efter behov
        });

      const matchingPayout = payouts.data.find(payout => {

        return payout.arrival_date >= balanceTransaction.created;
      });

      console.log(matchingPayout.id)
      const balanceTransactions = await stripeClient.balanceTransactions.list({
        payout: matchingPayout.id,
      });


     const b =  balanceTransactions.data.find((f) => f.source === balanceTransaction.source)

      console.log(b)
       */
      }
    } else {
      if (order.manualOrderAt) {

        const vat = (order.totalSum * 0.2).toFixed(2)
        const exclVat = order.totalSum - Number(vat)

        await Verifications.create({
          verificationDate: order.manualOrderAt,
          description: `Order id: ${order._id}`,
          verificationNumber: await generateNextEntryNumber(),
          metadata: [
            {
              key: "orderId",
              value: `${order._id}`
            }
          ],
          journalEntries: [
            {
              account: 3001, // Försäljning exkl. moms
              credit: exclVat.toFixed(2), // Belopp exklusive moms
            },
            {
              account: 2611, // Moms
              credit: vat, // Momsbelopp
            },
            {
              account: 1930, // Detta kanske måste ändras
              debit: order.totalSum.toFixed(2), // Momsbelopp
            }
          ]
        });



        console.log("MANUTEL")
      }
    }

    return {};
  }

  const data = JSON.parse(body.get("on") || "");
  const order: Order | null = await Orders.findOne({ _id: params.id }).lean();

  if (order) {
    await Orders.updateOne(
      {
        _id: params.id,
      },
      {
        status: Boolean(data)
          ? "SHIPPED"
          : order.manualOrderAt
          ? "MANUAL_PROCESSING"
          : "SUCCESS",
      }
    );

    if (Boolean(data)) {
      sendMail(order, Template.SHIPPING);
    }
  }

  return {};
};

export default function OrderDetail() {
  let {
    order: {
      _id,
      customer: { firstname, lastname, email, postaddress, zipcode, city },
      totalSum,
      items,
      webhookAt,
      freightCost,
      status,
      discount,
      manualOrderAt,
    },
    intent,
    verification,
  } = useLoaderData();
  const [on, setOn] = useState(status === "SHIPPED");
  let orderFetcher = useFetcher();
  const isSubmitting = orderFetcher.state === "submitting"; // Kolla fetcher state

  let ref = useRef(null);


  return (
    <div className=" mx-auto p-2 bg-white rounded-lg shadow-xl">
      <div className="flex flex-col lg:flex-row justify-between mb-8">
        <div className="mb-6 lg:mb-0">
          <h2 className="text-2xl font-bold text-gray-700">{_id}</h2>

          <div className="mt-3">
            <p className="text-gray-600">
              Datum:{" "}
              {webhookAt ? (
                <strong>{webhookAt.substring(0, 16).replace("T", " ")}</strong>
              ) : (
                <strong>
                  {manualOrderAt.substring(0, 16).replace("T", " ")}
                </strong>
              )}
            </p>
            <p className="text-gray-600">
              Totalt: <strong>{totalSum} SEK</strong>
            </p>
            <p className="text-gray-600">
              Fraktkostnad: <strong>{freightCost} SEK</strong>
            </p>
            <p className="text-gray-600">
              Rabatt:{" "}
              <strong>
                {discount && discount.amount ? discount.amount : 0} SEK
              </strong>
            </p>
            {intent ? (
              <p className="text-gray-600">
                <span
                  className={classNames(
                    "relative mb-1 mr-1 cursor-pointer inline-flex rounded-full px-2 py-1 text-xs font-semibold leading-5 transition-all duration-200 select-none",
                    "bg-red-100 text-red-800"
                  )}
                >
                  {intent.last_payment_error.message.length > 55
                    ? `${intent.last_payment_error.message.substring(0, 54)}...`
                    : intent.last_payment_error.message}
                </span>
              </p>
            ) : null}

            {status === "SUCCESS" ||
            status === "SHIPPED" ||
            status === "MANUAL_PROCESSING" ? (
              <orderFetcher.Form ref={ref} method="post">
                <span
                  onClick={() => {
                    setOn(!on);
                    orderFetcher.submit({ on: !on }, { method: "post" });
                  }}
                  className={classNames(
                    "relative mb-1 mr-1 cursor-pointer inline-flex rounded-full px-2 py-1 text-xs font-semibold leading-5 transition-all duration-200 select-none",
                    `${
                      on
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-400"
                    }`
                  )}
                >
                  <div className={classNames("mr-1 -mt-0.5 flex")}>
                    <label className="flex cursor-pointer">
                      <input type="hidden" name="_action" value={"disable"} />
                      <input
                        type="submit"
                        name="id"
                        style={{ display: "none" }}
                      />
                      <div
                        className="relative top-1 -left-0.5"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOn(!on);
                          orderFetcher.submit({ on: !on }, { method: "post" });
                        }}
                      >
                        <input type="checkbox" className="sr-only" />
                        <div
                          className={classNames(
                            "block  h-4 w-6 rounded-full transition-all duration-200",
                            `${on ? "bg-emerald-600" : "bg-slate-400"}`
                          )}
                        ></div>
                        <AnimatePresence initial={false}>
                          <motion.div
                            transition={{
                              delay: 0.13,
                              type: "spring",
                              stiffness: 8000,
                              damping: 20,
                            }}
                            animate={{ left: on ? 3 : 12 }}
                            className={classNames(
                              "dot absolute top-1 h-2 w-2 rounded-full bg-white transition"
                            )}
                          ></motion.div>
                        </AnimatePresence>
                      </div>
                    </label>
                  </div>
                  Markerad som levererad
                </span>
                {verification  ? (
                  <div>
                  <span
                    className={`block bg-green-600 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`}
                  >
                    Verifikation: {verification.verificationNumber}
                  </span>
                  </div>
                ) :(
                  <div>
                  <button
                    onClick={(e) => {
                      orderFetcher.submit(
                        { _action: "verification" },
                        { method: "post" }
                      );
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    className={classNames(`bg-green-600 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`, 
                      isSubmitting ? 'bg-slate-400': ""

                    )}
                  >
                     {isSubmitting ? "Skapar..." : "Skapa verifikation"} {/* Ändra text under submission */}
                  </button>
                  </div>
                )}
              </orderFetcher.Form>
            ) : null}
          </div>
        </div>
        <div className="pr-6">
          <h3 className="text-xl font-semibold text-gray-700">
            Kundinformation
          </h3>
          <div className="mt-3">
            <p className="text-gray-600">
              {firstname} {lastname}
            </p>
            <p className="text-gray-600">
              <a href={`mailto: ${email}`}>{email}</a>
            </p>
            <p className="text-gray-600">{postaddress}</p>
            <p className="text-gray-600">
              {zipcode} {city}
            </p>
          </div>
        </div>
      </div>

      <div className="relative overflow-x-auto shadow-md sm:rounded-lg">
        <table className="w-full text-sm text-left text-gray-500">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50">
            <tr>
              <th scope="col" className="px-2 py-3">
                NAMN
              </th>
              <th scope="col" className="px-2 py-3">
                ANTAL
              </th>
              <th scope="col" className="px-2 py-3">
                ST PRIS
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <React.Fragment key={index}>
                <tr
                  className={classNames(
                    `bg-white hover:bg-gray-50`,
                    item.additionalItems && item.additionalItems.length > 0
                      ? ""
                      : "border-b"
                  )}
                >
                  <td className="px-2 py-4">{item.name}</td>
                  <td className="px-2 py-4">
                    <span className="inline-flex px-2 text-xs font-semibold leading-5 rounded-full text-green-800 bg-green-100">
                      {item.quantity}
                    </span>
                  </td>
                  <td className="px-2 py-4">{item.price} SEK</td>
                </tr>
                {item.additionalItems &&
                  item.additionalItems.map((a, subIndex) => {
                    // Inner map function for additionalItems
                    return (
                      <tr
                        key={`${index}-${subIndex}`}
                        className={classNames(
                          subIndex === item.additionalItems.length - 1
                            ? "border-b"
                            : ""
                        )}
                      >
                        <td className="px-2 pb-4 text-xs">
                          {a.name}
                          <br />
                          {a.packinfo}
                        </td>
                        <td className="px-2 pb-4 ">
                          <span className="inline-flex px-2 text-xs font-semibold leading-5 rounded-full text-green-800 bg-green-100">
                            1
                          </span>
                        </td>
                        <td className="px-2 pb-4 ">{a.price} SEK</td>
                      </tr>
                    );
                  })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
