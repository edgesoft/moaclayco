import { useNavigate } from "react-router-dom";
import { Link, useLoaderData } from "@remix-run/react";
import { useCart } from "react-use-cart";
import { AnimatePresence, motion } from "framer-motion";
import React, { ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CollectionProps } from "~/types";
import useOnClickOutside from "~/hooks/useClickOutside";
import ClientOnly from "./ClientOnly";



type IndexLoadingType = {
  ENV: string;
  collections: CollectionProps[];
};

function Hamburger() {
  const [menu, setMenu] = React.useState(false);
  const ref = useRef(null);
  let data: IndexLoadingType = useLoaderData();
  useOnClickOutside(ref, () => setMenu(false));
  const history = useNavigate();
  const x = typeof window !== "undefined" ? window.innerWidth : 0;
  return (
    <>
      <AnimatePresence>
        {menu && (
          <>
            <motion.div
              exit={{ x: x, opacity: 0 }}
              initial={{ x: x, opacity: 0 }}
              animate={{ x: x - 280, opacity: 1 }}
              transition={{ ease: "easeInOut", duration: 0.3 }}
              className="fixed z-20 top-0 opacity-95 w-full border-l -right-0 sm:right-2 overflow-y-scroll"
            >
              <div
                style={{ width: 280 }}
                ref={ref}
                className="font-sans text-base md:text-sm bg-white h-screen"
              >
                <div
                  className="relative flex items-stretch cursor-pointer"
                  style={{ width: 280 }}
                  onClick={() => {
                    setMenu(false);
                  }}
                >
                  <div className="absolute right-3 top-2">
                    {" "}
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <div
                  className="flex m-2 w-full cursor-pointer"
                  onClick={() => {
                    history(`/`);
                    setMenu(false);
                  }}
                >
                  <div className="flex-shrink-0 w-12 h-12 md:w-18 md:h-18">
                    <svg
                      className="h-10 w-10"
                      viewBox="0 0 20 20"
                      fill="#F4B9A4"
                    >
                      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"></path>
                    </svg>
                  </div>
                  <span className="m-3 md:my-3">Startsida</span>
                </div>

                <div className="flex m-2 w-full">
                  <div
                    style={{ width: 255 }}
                    className="flex border-gray-600 border-b-2 px-2"
                  ></div>
                </div>
                {data &&
                  data.collections.map((d: CollectionProps, i: number) => {
                    return (
                      <div
                        key={d._id}
                        className="flex m-2 w-full"
                        onClick={() => {
                          history(`/collections/${d.shortUrl}`);
                          setMenu(false);
                        }}
                      >
                        <div className="flex-shrink-0 w-12 h-12 md:w-18 md:h-18">
                          <img
                            className="w-full h-full rounded-full  object-cover object-center"
                            src={d.image}
                            alt=""
                          />
                        </div>
                        <span className="m-3 md:my-3">{d.headline}</span>
                      </div>
                    );
                  })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {!menu && (
        <div
          className="absolute right-1 md:right-1 w-10 h-10 flex md:py-3"
          onClick={(e) => {
            setMenu(true);
          }}
        >
          <div className="flex justify-center text-gray-600 w-10 h-10 items-center">
            <svg className="h-8 w-10" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      )}
    </>
  );
}


const CartComponent = (): JSX.Element => {
  const { items } = useCart();
  const totalItems = useMemo(() => {
  return items.reduce((count, item) => item.parentId == null ? count + item.quantity : count, 0);
  }, [items]);
  const history = useNavigate();
  return (
    <div
      onClick={(e) => {
        e.preventDefault();
        if (totalItems > 0) {
          history("/cart");
        }
      }}
      className="absolute py-0 md:py-3 right-12"
    >
      {totalItems > 0 ? (
        <div className="absolute z-10 right-0 top-1 flex items-center justify-center w-5 h-5 text-gray-700 font-sans text-sm font-semibold bg-rosa rounded-full ring-1 ring-pink-200">
          {totalItems}
        </div>
      ) : null}
      <svg
        className="h-15 w-10 text-gray-600 fill-current"
        viewBox="0 0 490.057 490.057"
      >
        <g>
          <path
            d="M489.194,464l-36.4-293.4c-1-10.4-9.4-17.7-19.8-17.7h-23.9v-16.6c0-74.9-61.4-136.3-136.3-136.3c-12.6,0-24.6,1.7-35.9,5
          c-11.3-3.3-23.3-5-35.9-5c-74.9,0-136.3,61.4-136.3,136.3v16.6h-10.4c-9.4,0-18.7,7.3-19.8,17.7l-34.3,296.5
          c0,18,14.4,23.6,20.8,22.9c0,0,448.9,0,449.4,0C481.894,490.1,492.694,478.9,489.194,464z M367.394,136.3v16.6h-40.6v-16.6
          c0-36.3-11.2-67.9-30.3-91.6C337.194,55.3,367.394,92.5,367.394,136.3z M187.494,136.3c0-40.7,19.3-73,49.6-87
          c30.1,13.9,49.3,45.6,49.3,87v16.6h-98.8L187.494,136.3z M106.294,136.3c0-43.8,30.3-81,70.9-91.6c-19.1,23.7-30.3,55.3-30.3,91.6
          v16.6h-40.6V136.3z M43.894,449.4l30.2-255.9h342.3l30.2,255.9H43.894z"
          />
        </g>
      </svg>
    </div>
  );
};

const Header = (): JSX.Element | null => {
  return (
    <div
      style={{
        backgroundImage:
          "url(https://moaclayco-prod.s3.eu-north-1.amazonaws.com/background3.jpg)",
        backgroundPosition: "center left",
        backgroundRepeat: "no-repeat",
      }}
      className="space-between fixed z-10 left-0 top-0 flex p-4 min-w-full h-20 text-gray-600 font-note text-3xl bg-white border-b-2 border-gray-600 md:p-2 md:text-5xl"
    >
      <Link to="/" prefetch="intent">
        <div className="flex-grow">Moa Clay Collection</div>
      </Link>
      <ClientOnly fallback={null}>{() => <CartComponent />}</ClientOnly>
      <Hamburger />
    </div>
  );
};

export default Header;
