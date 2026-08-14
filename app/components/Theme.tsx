import React from "react";

type Theme = {
  title: string;
  backgroundImage: string;
  logo?: React.ReactElement;
  instagramUrl?: string;
  twitterUrl?: string;
  tiktokUrl?: string;
  pinterestUrl?: string;
  footerText: string;
  email: string;
  primaryDomain: string;
  longName: string;
  paymentMethods: string[];
  favicon: string;
};

export const theme: Theme = {
  title: "Moa Clay Co",
  longName: "Moa Clay Collection",
  backgroundImage:
    "https://moaclayco-prod.s3.eu-north-1.amazonaws.com/background3.jpg",
  logo: <span>Moa Clay Collection</span>,
  instagramUrl: "https://www.instagram.com/moaclayco/",
  twitterUrl: "https://twitter.com/moaclayco",
  tiktokUrl: "https://www.tiktok.com/@moaclayco",
  pinterestUrl: "https://www.pinterest.se/moaclayco",
  footerText: `All rights reserved © Moa Clay Co ${new Date().getFullYear()}`,
  email: "support@moaclayco.com",
  primaryDomain: "moaclayco.com",
  paymentMethods: ["swish", "klarna", "card"],
  favicon: "/favicon.png",
};
