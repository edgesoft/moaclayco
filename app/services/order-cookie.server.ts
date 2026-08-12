import { createCookie } from "@remix-run/node";
import { sessionSecret } from "~/services/session.server";

export const orderCookie = createCookie("order", {
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 7,
  path: "/",
  sameSite: "lax",
  secrets: [sessionSecret],
  secure: process.env.NODE_ENV === "production",
});
