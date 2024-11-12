import { createCookie } from "@remix-run/node"; // or cloudflare/deno
import { VerificationDomain } from "~/types";

export const cookieVerificationDomain = createCookie("verification-domain", {
  path: "/",
});


export async function getVerificationDomain(request: Request): Promise<VerificationDomain> {
  const cookieHeader = request.headers.get("Cookie");
  const cookie =  (await cookieVerificationDomain.parse(cookieHeader)) || {};

  return !cookie.domain ? {domain: "moaclayco", verificationYear: new Date().getFullYear()}: cookie
}