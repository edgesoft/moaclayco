import React, { createContext, ReactNode, useContext, useMemo } from "react";
import { domains } from "~/utils/domain";

type Theme = {
  title: string
  backgroundImage: string
  logo?: React.ReactElement,
  instagramUrl?: string
  twitterUrl?: string
  tiktokUrl?: string
  pinterestUrl?: string
  footerText: string
  email: string,
  primaryDomain: string
  longName: string
};

type ThemeProviderProps = {
  hostname: string;
  children: ReactNode;
};

export const themes: { [key: string]: Theme } = {
    "moaclayco": {
      title: "Moa Clay Co",
      longName: "Moa Clay Collection",
      backgroundImage: "https://moaclayco-prod.s3.eu-north-1.amazonaws.com/background3.jpg",
      logo: <span>Moa Clay Collection</span>,
      instagramUrl: "https://www.instagram.com/moaclayco/",
      twitterUrl: "https://twitter.com/moaclayco",
      tiktokUrl: "https://www.tiktok.com/@moaclayco",
      pinterestUrl: "https://www.pinterest.se/moaclayco",
      footerText: `All rights reserved © Moa Clay Co ${new Date().getFullYear()}`,
      email: "support@moaclayco.com",
      primaryDomain: "moaclayco.com"
    },
    "sgwoods": {
      title: "SG Woods",
      longName: "SG Woods",
      backgroundImage: "/sgwoods_banner.webp",
      instagramUrl: "https://www.instagram.com/sgwoods00/",
      logo:  <svg
      className="absolute transform -translate-x-1/2 -translate-y-1/2 top-6 left-6 sm:top-6 sm:left-6 md:top-8 md:left-8  lg:top-8 lg:left-8 w-[110px] h-[110px]"
      viewBox={`0 0 1024.000000 1024.000000`}
    >
      <g
        transform="translate(0.000000,1024.000000) scale(0.100000,-0.100000)"
        fill="#166534"
        stroke="none"
      >
        <path
          d="M4817 8360 c-313 -24 -628 -99 -921 -217 -265 -107 -400 -179 -651 -351 -173 -117 -269 -199 -425 -358 -227 -232 -348 -387 -507 -654 -301 -503 -438 -1019 -438 -1650 0 -273 10 -375 60 -625 102 -509 332 -978 690 -1408 609 -730 1515 -1158 2460 -1160 546 -1 1202 179 1633 449 419 262 739 556 995 916 213 299 337 544 450 893 109 335 164 784 138 1122 -34 438 -110 761 -267 1131 -139 327 -423 745 -660 973 -362 348 -680 563 -1049 711 -295 118 -523 177 -825 213 -158 19 -529 27 -683 15z m528 -260 c381 -35 702 -121 1013 -271 257 -124 410 -224 641 -418 163 -138 299 -283 433 -462 146 -195 222 -318 308 -494 206 -420 300 -836 300 -1321 0 -465 -102 -889 -315 -1314 -49 -98 -259 -448 -283 -472 -4 -4 -48 18 -97 50 -129 84 -459 251 -621 315 -270 106 -563 191 -839 242 -93 17 -153 34 -181 50 -53 31 -143 129 -182 197 -75 133 -118 361 -109 583 11 254 50 358 182 490 44 44 106 95 137 113 126 75 288 106 422 83 84 -15 217 -94 320 -192 69 -65 69 -66 77 -133 15 -122 78 -196 166 -196 56 0 96 21 122 64 33 52 45 60 75 44 13 -7 41 -35 61 -61 54 -71 108 -107 162 -107 92 0 143 55 143 153 l0 57 98 0 c124 0 155 15 195 91 23 44 27 63 23 102 -10 92 -56 136 -191 186 -44 16 -84 36 -90 45 -7 11 -3 35 14 84 30 85 25 141 -15 183 -63 65 -148 64 -290 -5 -121 -58 -140 -59 -154 -7 -31 115 -126 141 -244 66 -128 -81 -212 -107 -436 -130 -161 -17 -338 -52 -436 -85 -32 -11 -61 -20 -65 -20 -13 0 58 110 100 154 47 50 152 119 238 156 37 15 78 37 91 48 41 37 21 133 -34 163 -22 11 -102 9 -134 -5 -14 -6 -15 2 -12 56 3 55 1 66 -17 83 -31 27 -84 25 -117 -5 -14 -14 -43 -59 -64 -100 -73 -147 -154 -296 -200 -370 -64 -101 -85 -144 -145 -289 -55 -134 -76 -160 -101 -126 -24 31 -14 281 15 400 62 252 124 395 226 522 82 103 142 155 219 193 84 41 120 45 225 25 106 -20 127 -17 176 30 37 34 37 35 33 105 l-4 70 119 0 c102 0 124 3 152 20 40 25 65 74 65 130 0 55 -19 89 -81 142 l-52 45 21 39 c67 119 84 165 85 227 1 41 -5 73 -16 95 -41 77 -160 124 -259 102 -71 -15 -114 -44 -145 -98 -34 -60 -53 -82 -70 -82 -8 0 -37 19 -64 41 -39 33 -58 43 -96 46 -71 6 -131 -27 -162 -91 -26 -53 -26 -65 10 -226 16 -75 7 -110 -29 -110 -51 0 -106 -22 -139 -55 -39 -39 -42 -76 -18 -190 23 -106 21 -112 -46 -195 -76 -92 -147 -197 -184 -270 -45 -88 -57 -104 -67 -87 -4 8 -12 73 -17 145 -11 152 -24 186 -77 201 -91 25 -116 -25 -122 -241 -2 -87 -8 -158 -13 -158 -5 0 -21 23 -37 51 -43 82 -161 257 -230 343 -84 104 -86 111 -66 212 10 50 14 97 9 120 -10 53 -59 99 -128 119 -72 21 -76 35 -48 158 12 51 21 106 21 122 0 39 -29 86 -75 121 -31 24 -47 28 -97 29 -57 0 -60 -1 -105 -48 -53 -55 -51 -56 -124 39 -55 71 -120 104 -206 104 -129 0 -213 -79 -213 -200 0 -55 15 -95 70 -185 22 -36 40 -69 40 -74 0 -5 -24 -29 -53 -54 -91 -78 -109 -158 -50 -227 43 -52 70 -60 199 -60 116 0 116 0 109 -22 -4 -13 -9 -46 -12 -75 -5 -48 -3 -54 25 -83 26 -25 38 -30 81 -30 27 0 80 7 116 15 81 19 154 8 225 -33 54 -30 155 -125 209 -196 100 -130 209 -376 236 -535 21 -122 25 -345 6 -388 -24 -59 -33 -47 -86 112 -51 151 -81 209 -220 425 -23 36 -72 125 -109 197 -72 142 -99 173 -152 173 -53 0 -77 -31 -71 -88 3 -26 8 -59 12 -75 l7 -27 -53 25 c-57 26 -117 32 -151 14 -22 -12 -48 -66 -48 -103 0 -39 30 -65 113 -96 141 -52 261 -140 342 -250 36 -48 48 -83 22 -61 -16 12 -175 55 -262 70 -33 6 -136 17 -230 26 -261 24 -353 50 -468 133 -42 30 -60 37 -99 37 -58 0 -86 -24 -108 -93 -19 -59 -45 -65 -121 -26 -133 67 -216 86 -276 63 -54 -20 -113 -92 -113 -139 0 -11 14 -48 30 -80 39 -77 32 -92 -55 -119 -121 -38 -170 -73 -200 -143 -34 -83 -5 -183 65 -219 22 -12 70 -21 133 -25 l97 -7 0 -59 c0 -75 20 -112 77 -139 74 -36 111 -22 214 77 51 49 96 84 108 84 12 0 34 -17 53 -41 57 -71 109 -85 182 -49 55 26 93 86 102 159 3 31 13 71 21 88 26 56 131 144 248 207 124 66 169 75 297 57 237 -33 408 -150 502 -344 27 -54 52 -124 61 -169 18 -90 20 -358 5 -458 -23 -146 -88 -296 -172 -398 -60 -74 -109 -105 -198 -127 -36 -9 -92 -25 -125 -35 -33 -10 -101 -25 -150 -34 -176 -33 -513 -138 -749 -235 -123 -51 -323 -156 -431 -226 -45 -29 -106 -67 -136 -84 l-55 -30 -33 57 c-19 31 -46 73 -61 92 -46 61 -191 311 -237 410 -138 295 -224 619 -252 945 -14 155 -14 458 0 605 21 233 122 646 214 870 35 87 114 245 146 295 15 22 50 78 80 125 61 98 133 194 272 361 301 363 821 710 1296 863 200 65 478 121 686 139 93 8 398 6 500 -3z m795 -960 c34 -18 42 -46 26 -84 -18 -44 -309 -334 -344 -343 -20 -5 -30 0 -49 21 -28 33 -29 51 -2 96 27 46 241 255 298 292 52 32 47 31 71 18z m-2035 -18 c48 -30 315 -304 322 -331 5 -19 -1 -31 -26 -53 -17 -15 -39 -28 -48 -28 -22 0 -298 274 -330 328 -26 45 -24 56 17 89 20 17 30 16 65 -5z m-446 -1538 c50 -64 18 -91 -183 -154 -88 -28 -206 -67 -262 -86 -120 -41 -147 -42 -179 -9 -60 59 -30 82 230 171 222 75 312 102 352 103 12 1 31 -10 42 -25z m3084 -21 c157 -47 357 -121 380 -141 21 -19 22 -60 1 -90 -21 -31 -60 -28 -157 12 -45 18 -156 57 -247 86 -91 28 -173 59 -183 68 -35 31 3 102 55 102 16 0 84 -16 151 -37z m-1048 -2002 c349 -42 591 -102 904 -223 282 -109 381 -159 381 -193 0 -7 -14 -31 -31 -54 -36 -51 -35 -51 -182 16 -195 88 -382 153 -609 212 -358 93 -671 127 -1093 118 -663 -14 -1197 -116 -1615 -307 -58 -26 -115 -51 -127 -55 -57 -16 -103 39 -83 100 14 42 43 60 185 118 313 128 748 233 1105 267 246 24 346 28 660 26 260 -3 361 -7 505 -25z m-232 -502 c281 -17 470 -48 707 -115 186 -53 238 -87 219 -144 -15 -40 -52 -63 -92 -55 -18 4 -88 25 -157 46 -288 91 -555 124 -1015 124 -443 -1 -783 -37 -1065 -115 -80 -22 -155 -40 -167 -40 -49 0 -73 116 -30 144 66 44 457 117 774 145 240 22 576 26 826 10z"
          fill="#052e16"
        />
        <path
          fill="#166534"
          d="M5025 7785 c-46 -25 -63 -44 -81 -91 -12 -31 -15 -58 -10 -92 9 -72 -9 -92 -86 -92 -55 0 -63 -3 -94 -34 -31 -31 -34 -40 -34 -91 l0 -57 70 -67 c39 -36 70 -71 70 -78 0 -6 -15 -23 -32 -38 -92 -77 -74 -169 43 -225 33 -15 87 -53 119 -84 43 -41 66 -56 87 -56 37 0 89 32 106 67 23 44 48 60 106 67 30 4 63 12 73 17 26 14 49 64 51 111 1 38 -3 45 -51 87 -29 25 -52 52 -52 59 0 8 32 44 70 81 67 65 70 70 70 114 0 37 -6 53 -29 79 -26 30 -35 33 -100 36 -39 2 -71 5 -72 6 0 0 -4 45 -8 99 -8 103 -19 130 -73 170 -35 26 -105 32 -143 12z m106 -374 c23 -18 24 -25 24 -143 -1 -150 -16 -198 -63 -198 -63 0 -92 55 -92 175 0 84 15 136 45 163 32 27 55 28 86 3z"
        />
        <path d="M3375 6728 c-28 -16 -43 -38 -50 -74 -10 -56 -23 -59 -128 -23 -117 40 -169 36 -225 -16 -35 -31 -37 -37 -37 -93 0 -75 21 -107 94 -143 29 -14 61 -35 72 -45 19 -20 19 -20 -11 -67 -33 -53 -38 -93 -15 -137 38 -74 110 -89 217 -45 90 36 111 34 133 -16 37 -81 109 -103 176 -54 75 55 93 63 150 69 66 8 92 26 115 82 21 50 17 85 -14 135 -37 57 -90 107 -177 166 -66 45 -71 52 -95 119 -15 39 -35 83 -46 97 -36 49 -113 71 -159 45z m133 -328 c39 -18 81 -43 93 -56 20 -21 21 -27 10 -48 -24 -45 -51 -51 -133 -30 -40 11 -93 33 -118 49 -39 26 -45 35 -43 63 0 18 7 40 14 48 20 24 92 13 177 -26z" />
        <path d="M6673 6720 c-37 -22 -56 -55 -83 -144 -22 -71 -33 -83 -109 -121 -61 -30 -165 -124 -188 -169 -28 -54 3 -147 60 -177 11 -7 48 -11 80 -10 57 2 61 0 106 -42 97 -91 198 -83 231 19 14 43 43 45 124 9 72 -32 143 -33 180 -4 59 46 73 126 32 176 -36 44 -46 66 -35 86 6 9 18 17 27 17 9 0 40 11 69 24 39 19 57 34 72 65 78 152 -70 249 -265 176 -76 -29 -86 -25 -111 37 -8 21 -27 47 -41 58 -33 27 -106 27 -149 0z m186 -286 c30 -38 27 -78 -6 -102 -46 -31 -179 -82 -217 -82 -62 0 -89 75 -43 118 25 23 190 91 224 92 12 0 31 -12 42 -26z" />
        <path d="M4027 5251 c-98 -6 -99 -6 -133 -43 -42 -47 -45 -89 -9 -142 17 -25 21 -38 12 -40 -6 -2 -38 -9 -69 -16 -41 -8 -63 -19 -78 -37 -24 -31 -25 -45 -4 -103 l16 -45 -36 -54 c-41 -60 -46 -102 -20 -157 31 -65 137 -94 219 -60 19 8 57 35 83 60 59 55 83 58 149 16 53 -34 72 -36 111 -16 49 25 82 103 94 219 5 56 21 135 34 176 28 86 30 121 9 161 -22 42 -77 66 -180 79 -50 6 -92 10 -95 9 -3 -1 -49 -4 -103 -7z m163 -203 c38 -41 27 -73 -54 -154 -58 -58 -80 -74 -103 -74 -32 0 -73 32 -73 57 0 43 80 126 165 172 22 11 41 21 42 21 1 0 11 -10 23 -22z" />
        <path d="M5908 5251 c-61 -9 -114 -41 -144 -87 -24 -35 -19 -91 12 -159 25 -52 28 -73 30 -166 2 -119 13 -165 48 -198 40 -37 92 -38 160 -2 54 29 62 31 95 20 19 -7 58 -33 86 -59 63 -60 83 -70 137 -70 120 0 177 133 105 247 l-26 41 19 25 c64 81 22 131 -149 177 l-43 11 25 27 c63 66 55 141 -18 173 -50 22 -242 33 -337 20z m205 -260 c42 -43 77 -82 77 -85 0 -4 -7 -22 -14 -41 -12 -27 -21 -35 -41 -35 -38 0 -76 23 -123 74 -51 55 -57 102 -17 141 13 14 28 25 33 25 5 0 43 -35 85 -79z" />
      </g>
    </svg>,
      footerText: `All rights reserved © SG Woods ${new Date().getFullYear()}`,
       email: "support@sgwoods.se",
       primaryDomain: "sgwoods.se"
    }
  };

const ThemeContext = createContext<Theme | null>(null);

export function getTheme(hostname: string): Theme {
  
 const domain = domains.find(d => d.hosts.includes(hostname))

  return themes[domain?.domain || ""];
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  hostname,
  children,
}) => {
    const theme = useMemo(() => getTheme(hostname), [hostname]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);