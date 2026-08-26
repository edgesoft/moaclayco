import type { Config } from "@react-router/dev/config";

const productionActionOrigins = [
  "moaclayco.com",
  "www.moaclayco.com",
  "moaclayco.fly.dev",
  "moaclayco-stage.fly.dev",
];

export const actionOriginsFor = (nodeEnvironment?: string) => [
  ...(nodeEnvironment === "production"
    ? []
    : ["localhost:5175", "127.0.0.1:5175", "[::1]:5175", "null"]),
  ...productionActionOrigins,
];

export default {
  allowedActionOrigins: actionOriginsFor(process.env.NODE_ENV),
  ssr: true,
} satisfies Config;
