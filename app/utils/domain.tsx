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

export function getDomain(request: Request) {
  let url = new URL(request.url);
  let hostname = url.hostname;
  return domains.find((d) => d.hosts.includes(hostname));
}
