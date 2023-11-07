import { createCookieSessionStorage } from "@remix-run/node";

export let sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "RTM_session",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secrets: [process.env.SESSION_SECRET || ""], 
    secure: process.env.NODE_ENV === "production",
  },
});

export let { getSession, commitSession, destroySession } = sessionStorage;