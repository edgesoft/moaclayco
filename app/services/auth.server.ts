import { Authenticator } from "remix-auth";
import { EmailLinkStrategy, VerifyEmailFunction } from "remix-auth-email-link";
import { sessionStorage } from "~/services/session.server";
import { User } from "~/types";
import { sendEmail } from "./email.server";
import { Users } from "~/schemas/user";

let secret = process.env.MAGIC_LINK_SECRET;
if (!secret) throw new Error("Missing MAGIC_LINK_SECRET env variable.");

export let auth = new Authenticator<User>(sessionStorage);

export let verifyEmailAddress: VerifyEmailFunction = async (email) => {
  if (!email) throw new Error("Invalid email address.");

  try {
    let user = await Users.findOne({
      email,
    });
    if (!user) throw new Error("Email address not found.");
  } catch (e) {
    throw new Error("Email address not found.");
  }
};

auth.use(
  new EmailLinkStrategy(
    { verifyEmailAddress, sendEmail, secret, callbackURL: "/magic" },
    async ({ email }: { email: string }) => {
      return new Promise<User>(async (resolve, reject) => {
        let user = await Users.findOne({
          email,
        });
        if (user) {
          resolve(user);
        } else {
          reject(user);
        }
      });
    }
  )
);
