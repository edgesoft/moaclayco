import { useNavigate } from "react-router-dom";
import { Link, useLoaderData } from "@remix-run/react";
import { useCart } from "react-use-cart";
import { AnimatePresence, motion } from "framer-motion";
import React, { useMemo, useRef } from "react";
import { CollectionProps, User } from "~/types";
import useOnClickOutside from "~/hooks/useClickOutside";
import ClientOnly from "./ClientOnly";
import { disableBodyScroll, enableBodyScroll } from "~/utils/scroll";
import { classNames } from "~/utils/classnames";

type IndexLoadingType = {
  user: User;
  ENV: string;
  collections: CollectionProps[];
};

function Hamburger() {
  const [menu, setMenu] = React.useState(false);
  const ref = useRef(null);
  let data: IndexLoadingType = useLoaderData();
  useOnClickOutside(ref, () => {
    enableBodyScroll();
    setMenu(false);
  });

  const history = useNavigate();
  const x = typeof window !== "undefined" ? window.innerWidth : 0;

  return menu ? (
    <>
      <AnimatePresence>
        {menu && (
          <>
            <motion.div
              exit={{ x: x, opacity: 0 }}
              initial={{ x: x, opacity: 0 }}
              animate={{ x: x - 280, opacity: 1 }}
              transition={{ ease: "easeInOut", duration: 0.3 }}
              className="fixed z-20 top-0 opacity-95 bg-white  w-full border-l -right-0 sm:right-2 overflow-y-scroll"
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
                    enableBodyScroll();
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
                    enableBodyScroll();
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
                <div
                  className="flex m-2 w-full cursor-pointer"
                  onClick={() => {
                    setMenu(false);
                    enableBodyScroll();
                    history(data.user ? `/logout` : `/login`);
                  }}
                >
                  <div className="flex-shrink-0 w-12 h-12 md:w-18 md:h-18 text-green-800">
                    <svg
                      className="h-10 w-105"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"></path>
                    </svg>
                  </div>
                  <span className="m-3 md:my-3">
                    {data.user ? "Logga ut" : "Logga in"}
                  </span>
                </div>
                {data.user ? (
                  <>
                    <div
                      className="flex m-2 w-full cursor-pointer"
                      onClick={() => {
                        setMenu(false);
                        enableBodyScroll();
                        history("/admin/orders");
                      }}
                    >
                      <div className="flex-shrink-0 w-12 h-12 md:w-18 md:h-18 text-violet-500">
                        <svg
                          className="h-10 w-10"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path d="M11 17a1 1 0 001.447.894l4-2A1 1 0 0017 15V9.236a1 1 0 00-1.447-.894l-4 2a1 1 0 00-.553.894V17zM15.211 6.276a1 1 0 000-1.788l-4.764-2.382a1 1 0 00-.894 0L4.789 4.488a1 1 0 000 1.788l4.764 2.382a1 1 0 00.894 0l4.764-2.382zM4.447 8.342A1 1 0 003 9.236V15a1 1 0 00.553.894l4 2A1 1 0 009 17v-5.764a1 1 0 00-.553-.894l-4-2z"></path>
                        </svg>
                      </div>
                      <span className="m-3 md:my-3">Ordrar</span>
                    </div>
                    <div
                      className="flex m-2 w-full cursor-pointer"
                      onClick={() => {
                        setMenu(false);
                        enableBodyScroll();
                        history("/admin/verifications");
                      }}
                    >
                      <div className="flex-shrink-0 w-12 h-12 md:w-18 md:h-18 ">
                      <svg  className="h-10 w-10" viewBox="0 0 16 16" fill="#CFF09E">
  <path fillRule="evenodd" d="M5 10H3V9h10v1h-3v2h3v1h-3v2H9v-2H6v2H5v-2H3v-1h2v-2zm1 0v2h3v-2H6z"/>
  <path d="M4 0h5.5v1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h1V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z"/>
  <path d="M9.5 3V0L14 4.5h-3A1.5 1.5 0 0 1 9.5 3z"/>
</svg>
                      </div>
                      <span className="m-3 md:my-3">Bokföring</span>
                    </div>

                   


                    <div
                      className="flex m-2 w-full cursor-pointer"
                      onClick={() => {
                        setMenu(false);
                        sessionStorage.setItem("scrollPosition", "0");
                        enableBodyScroll();
                        history("/admin/discounts");
                      }}
                    >
                      <div className="flex-shrink-0 w-12 h-12 md:w-18 md:h-18 text-violet-500">
                        <svg
                          className="h-10 w-10"
                          viewBox="0 0 512 512"
                          fill="currentColor"
                        >
                          <path
                            style={{ fill: "#CFF09E" }}
                            d="M324.116,58.401h-136.23l-81.34,113.107v82.433h298.909v-82.433L324.116,58.401z M256,205.182
	c-26.704,0-48.353-21.649-48.353-48.353s21.649-48.353,48.353-48.353s48.353,21.649,48.353,48.353S282.706,205.182,256,205.182z"
                          />
                          <g>
                            <path
                              style={{ fill: "#507C5C" }}
                              d="M405.454,269.271c8.466,0,15.329-6.863,15.329-15.329v-82.433c0-3.211-1.009-6.341-2.883-8.949
		L336.561,49.452c-2.88-4.005-7.511-6.38-12.445-6.38h-52.787V15.329C271.329,6.863,264.466,0,256,0
		c-8.466,0-15.329,6.863-15.329,15.329v27.743h-52.787c-4.933,0-9.565,2.374-12.445,6.38L94.1,162.56
		c-1.875,2.607-2.883,5.738-2.883,8.949v325.162c0,8.466,6.863,15.329,15.329,15.329h298.909c8.466,0,15.329-6.863,15.329-15.329
		V341.299c0-8.466-6.863-15.329-15.329-15.329s-15.329,6.863-15.329,15.329v140.044H121.874V269.271L405.454,269.271
		L405.454,269.271z M121.874,176.448l73.867-102.719h44.93v21.295c-27.733,6.881-48.353,31.974-48.353,61.805
		c0,35.113,28.568,63.681,63.681,63.681s63.681-28.568,63.681-63.681c0-29.83-20.62-54.924-48.353-61.805V73.729h44.93
		l73.867,102.719v62.165H121.874L121.874,176.448L121.874,176.448z M256,123.805c18.209,0,33.024,14.815,33.024,33.024
		S274.209,189.853,256,189.853s-33.024-14.815-33.024-33.024C222.976,138.619,237.791,123.805,256,123.805z"
                            />
                            <path
                              style={{ fill: "#507C5C" }}
                              d="M301.48,356.141c-18.537,0-28.746,9.301-28.746,26.189v24.202c0,16.889,10.209,26.189,28.746,26.189
		c18.269,0,28.746-9.545,28.746-26.189V382.33C330.226,365.686,319.749,356.141,301.48,356.141z M296.307,382.329
		c0-3.647,1.403-5.002,5.172-5.002c4.435,0,5.344,1.999,5.344,5.002v24.202c0,3.003-0.909,5.002-5.344,5.002
		c-3.771,0-5.172-1.355-5.172-5.002V382.329z"
                            />
                            <path
                              style={{ fill: "#507C5C" }}
                              d="M284.891,294.269c-4.491,0-8.242,2.275-10.017,6.049l-59.812,122.861
		c-0.766,1.533-1.188,3.188-1.188,4.66c0,5.898,5.112,12.212,12.724,12.212c4.609,0,8.851-2.45,10.528-6.046l59.984-122.864
		c0.84-1.683,1.018-3.463,1.018-4.66C298.126,299.175,291.284,294.269,284.891,294.269z"
                            />
                            <path
                              style={{ fill: "#507C5C" }}
                              d="M210.521,301.257c-18.537,0-28.746,9.301-28.746,26.189v24.202
		c0,16.888,10.209,26.189,28.746,26.189c18.269,0,28.746-9.545,28.746-26.189v-24.202
		C239.267,310.802,228.789,301.257,210.521,301.257z M205.348,327.446c0-3.647,1.403-5.002,5.173-5.002
		c4.435,0,5.344,1.999,5.344,5.002v24.202c0,3.003-0.909,5.002-5.344,5.002c-3.771,0-5.173-1.355-5.173-5.002L205.348,327.446
		L205.348,327.446z"
                            />
                          </g>
                        </svg>
                      </div>
                      <span className="m-3 md:my-3">Rabatter</span>
                    </div>
                  </>
                ) : null}

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
                          enableBodyScroll();
                          history(`/collections/${d.shortUrl}`);
                          setMenu(false);
                        }}
                      >
                        <div
                          className={classNames(
                            "flex-shrink-0 w-12 h-12 md:w-18 md:h-18",
                            i === data.collections.length - 1 ? "mb-20" : ""
                          )}
                        >
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
    </>
  ) : (
    <div
      className="absolute right-1 md:right-1 w-10 h-10 flex md:py-3"
      onClick={(e) => {
        disableBodyScroll();
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
  );
}

const CartComponent = (): JSX.Element => {
  const { items } = useCart();
  const totalItems = useMemo(() => {
    return items.reduce(
      (count, item) =>
        item.parentId == null ? count + (item.quantity || 0) : count,
      0
    );
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
