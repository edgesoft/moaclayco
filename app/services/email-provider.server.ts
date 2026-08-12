import nodemailer from "nodemailer";

const emailPort = (value: string | undefined) => {
  if (!value?.trim()) return 465;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("EMAIL_PORT must be an integer between 1 and 65535");
  }
  return port;
};

const emailSecure = (value: string | undefined, port: number) => {
  if (!value?.trim()) return port === 465;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error('EMAIL_SECURE must be either "true" or "false"');
};

export const emailTransportOptions = (
  environment: NodeJS.ProcessEnv = process.env
) => {
  const port = emailPort(environment.EMAIL_PORT);
  const username = environment.EMAIL_USERNAME?.trim();
  const password = environment.EMAIL_PASSWORD?.trim();
  if (Boolean(username) !== Boolean(password)) {
    throw new Error(
      "EMAIL_USERNAME and EMAIL_PASSWORD must both be configured or both be empty"
    );
  }

  return {
    host: environment.EMAIL_HOST?.trim() || "send.one.com",
    port,
    secure: emailSecure(environment.EMAIL_SECURE, port),
    ...(username && password
      ? { auth: { user: username, pass: password } }
      : {}),
  };
};

export const transporter = nodemailer.createTransport(emailTransportOptions());
