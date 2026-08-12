import { createCookieSessionStorage } from "@remix-run/node";

export const sessionSecret =
  process.env.SESSION_SECRET?.trim() ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("SESSION_SECRET is required in production");
      })()
    : "moaclayco-local-development-session-secret");

export let sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "mcc_session",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secrets: [sessionSecret],
    secure: process.env.NODE_ENV === "production",
  },
});

export let { getSession, commitSession, destroySession } = sessionStorage;
