export const domains = [
  {
    domain: "moaclayco",
    hosts: [
      "www.moaclayco.com",
      "moaclayco.com",
      "localhost",
      "127.0.0.1",
      "moaclayco-stage.fly.dev",
      "moaclayco.fly.dev",
    ],
  },
];

export function getDomain(input: Request | string) {
  // Kontrollera om input är en Request eller en string
  let url: URL;
  let hostname: string | null = null;
  if (input instanceof Request) {
    url = new URL(input.url);
     hostname = url.hostname;
  } else if (typeof input === "string") {

    if (input.includes("http")) {
      url = new URL(input);
      hostname = url.hostname;
    } else {
      hostname = input
    }
  
  } else {
    throw new Error("Invalid input: expected a Request or a string");
  }

  // Hämta hostname och hitta matchande domän

  if (!hostname) {
    return undefined;
  }

  const resolvedHostname = hostname;
  return domains.find((domain) => domain.hosts.includes(resolvedHostname));
}
