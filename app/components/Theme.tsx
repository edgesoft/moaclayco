import React, { createContext, ReactNode, use, useMemo } from "react";
import { getDomain } from "~/utils/domain";

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

type ThemeProviderProps = {
  hostname: string;
  children: ReactNode;
};

export const themes: Record<string, Theme> = {
  moaclayco: {
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
  },
};

const ThemeContext = createContext<Theme | null>(null);

export function getTheme(hostname: string): Theme {
  const domain = getDomain(hostname);
  return themes[domain?.domain ?? "moaclayco"];
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  hostname,
  children,
}) => {
  const theme = useMemo(() => getTheme(hostname), [hostname]);

  return <ThemeContext value={theme}>{children}</ThemeContext>;
};

export const useTheme = () => use(ThemeContext);
