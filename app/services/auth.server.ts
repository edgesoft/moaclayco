import { redirect } from "react-router";
import { sessionStorage } from "~/services/session.server";
import type { User } from "~/types";

type RedirectOptions = {
  successRedirect?: string;
  failureRedirect?: string;
  headers?: HeadersInit;
};

class SessionAuthenticator {
  readonly sessionKey = "user";

  async isAuthenticated(request: Request): Promise<User | null>;
  async isAuthenticated(
    request: Request,
    options: RedirectOptions & { failureRedirect: string }
  ): Promise<User>;
  async isAuthenticated(
    request: Request,
    options: RedirectOptions & { successRedirect: string }
  ): Promise<null>;
  async isAuthenticated(
    request: Request,
    options: RedirectOptions = {}
  ): Promise<User | null> {
    const session = await sessionStorage.getSession(
      request.headers.get("Cookie")
    );
    const user = session.get(this.sessionKey) as User | undefined;

    if (user && options.successRedirect) {
      throw redirect(options.successRedirect, { headers: options.headers });
    }
    if (!user && options.failureRedirect) {
      throw redirect(options.failureRedirect, { headers: options.headers });
    }

    return user ?? null;
  }
}

export const auth = new SessionAuthenticator();
