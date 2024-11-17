export const domains = [
  {
    domain: "sgwoods",
    hosts: [
      "sgwoods.se",
      "localhost",
      "sgwoods-stage.fly.dev",
      "sgwoods.fly.dev",
    ],
  },
  {
    domain: "moaclayco",
    hosts: ["moaclayco.com", "moaclayco-stage.fly.dev", "moaclayco.fly.dev"],
  },
];

export function getDomain(input: Request | string) {
  // Kontrollera om input är en Request eller en string
  let url: URL;
  let hostname = null
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

  return domains.find((d) => d.hosts.includes(hostname));
}