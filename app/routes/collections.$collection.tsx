import { MetaFunction, LoaderFunction } from "@remix-run/node";
import {
  useNavigation,
  useLoaderData,
  useOutletContext,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import { useSwipeable } from "react-swipeable";
import { Items } from "../schemas/items";
import { useCart } from "react-use-cart";
import { classNames } from "../utils/classnames";
import { ItemProps } from "~/types";
import Loader from "../components/loader";
import AdditionalCartItem, {
  AdditionCartItemType,
} from "~/components/item/additionalItem";
import Magnifier from "~/components/item/magnifier";

export let loader: LoaderFunction = async ({ params }) => {
  return Items.find({ collectionRef: params.collection }).sort({ _id: -1 });
};

export let meta: MetaFunction = (d) => {
  const data = d.data as ItemProps[];
  return [
    {
      title: "Moa Clay Collection - artiklar",
    },
    {
      name: "description",
      content: data.map((d: ItemProps) => d.headline).join(", "),
    },
  ];
};

const Item: React.FC<ItemProps> = ({
  _id,
  images,
  headline,
  amount,
  price,
  productInfos,
  additionalItems,
  collectionRef,
  instagram,
  longDescription,
}): JSX.Element => {
  const [showInfo, setShowInfo] = useState(false);
  const [showImage, setShowImage] = useState<string | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [additions, setAdditions] = useState<AdditionCartItemType[]>([]);
  const { addItem, getItem, items } = useCart();
  const handlers = useSwipeable({
    onSwiped: (eventData) => {
      if (eventData.dir === "Right") {
        setIndex(index - 1 < 0 ? images.length - 1 : index - 1);
      }

      if (eventData.dir === "Left") {
        setIndex(index + 1 === images.length ? 0 : index + 1);
      }
    },
  });

  return (
    <>
      <Magnifier imageUrl={showImage} close={setShowImage} />
      <div
        id={_id}
        className="flex flex-col w-full bg-gray-50 rounded-lg shadow-lg overflow-hidden md:flex-row"
      >
        <div
          className={classNames(
            "relative w-full h-80 md:w-2/5",
            showInfo ? "bg-gray-900 relative" : ""
          )}
        >
          <img
            {...handlers}
            className={classNames(
              "w-full h-full object-cover object-center",
              showInfo ? "mix-blend-overlay" : ""
            )}
            src={images[index]}
            loading="lazy"
          />
          <div
            className="absolute bottom-1 right-1 text-white"
            onClick={() => {
              setShowImage(images[index]);
            }}
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
              <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
            </svg>
          </div>
          {showInfo ? (
            <div className="absolute left-1 top-1 flex flex-col p-3 text-white font-medium">
              <span className="text-2xl font-bold">Produktinfo</span>
              {productInfos?.map((p, i) => {
                return (
                  <span
                    key={i}
                    className={classNames("text-lg", i === 0 ? "mt-5" : "")}
                  >
                    {p}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-grow items-center -my-5">
              <div className="flex flex-grow justify-center">
                {images.length > 1 &&
                  images.map((_, i) => {
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          if (index !== i) {
                            setIndex(i);
                          }
                        }}
                        className={classNames(
                          "mx-2 w-2 h-2  rounded-full ring-1 ring-offset-2",
                          index === i ? "bg-green-500" : "bg-white"
                        )}
                      ></div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        <div className="relative p-6 w-full text-left space-y-2 md:p-4 md:w-3/5">
          <div className="flex">
            <p className="text-gray-700 text-2xl font-bold">{headline}</p>

            {amount === 0 ? (
              <span className="ml-1 p-1 text-green-800 bg-green-100 rounded">
                Slut i lager
              </span>
            ) : null}
          </div>
          {longDescription ? (
            <p className="text-gray-500 text-base font-normal leading-relaxed">
              {longDescription}
            </p>
          ) : null}
          <p className="text-gray-700 text-lg font-bold">{price} SEK</p>
          <div className="flex justify-start space-x-2">
            {productInfos && productInfos.length > 0 ? (
              <svg
                onClick={() => {
                  setShowInfo(!showInfo);
                }}
                className="w-6 h-6 text-gray-500 hover:text-pink-600 fill-current"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            ) : null}
            {instagram ? (
              <svg
                onClick={(e) => {
                  window.open(instagram, "_blank");
                }}
                className="w-6 h-6 hover:animate-ping"
                aria-hidden="true"
                fill="#C13584"
                viewBox="0 0 24 24"
              >
                <path
                  fillRule="evenodd"
                  d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
                  clipRule="evenodd"
                ></path>
              </svg>
            ) : null}
          </div>
          <div className={additionalItems ? `pb-10` : ``}>
            {additionalItems
              ? additionalItems.map((item, index) => {
                  return (
                    <div key={index}>
                      <AdditionalCartItem
                        item={item}
                        additionalIndex={index}
                        handleSwitch={(item, on, additionalIndex) => {
                          if (on) {
                            // add
                            additions.push({ item, additionalIndex, index });
                          } else {
                            // remove
                            const i = additions.findIndex(
                              (item) => item.index === index
                            );
                            additions.splice(i, 1);
                          }
                          setAdditions(additions);
                        }}
                      />
                    </div>
                  );
                })
              : null}
          </div>
          {amount > 0 ? (
            <button
              onClick={() => {
                const item = getItem(_id);
                const itemIndex = item ? item.quantity : 0;

                addItem({
                  id: _id,
                  parentId: null,
                  price,
                  balance: amount,
                  image: images[0],
                  headline,
                  collectionRef,
                });

                additions.forEach((a) => {
                  addItem({
                    id: `${_id}_${itemIndex}_${a.additionalIndex}`,
                    parentId: _id,
                    price: a.item.price,
                    index: itemIndex,
                    image: null,
                    headline: a.item.name,
                    collectionRef: null,
                  });
                });
              }}
              className="absolute bottom-2 right-2 flex-row-reverse px-4 py-2 text-gray-800 hover:text-white font-medium hover:bg-gray-500 bg-rosa rounded"
            >
              Lägg i kundvagn
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
};

const hash = typeof window === "undefined" ? "" : window.location.hash;

function useScroll(hash: string) {
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, []);
}

export default function Collection() {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  useScroll(hash);
  let data: ItemProps[] = useLoaderData();
  const parentData = useOutletContext();
  let transition = useNavigation();
  return (
    <>
      <Loader transition={transition} />
      <section className="mx-auto px-4 py-5 max-w-6xl sm:px-6 lg:px-4">
        <div className="grid gap-6 grid-cols-1 my-20 lg:grid-cols-2">
          {data.map((item: ItemProps) => (
            <Item key={item._id} {...item} />
          ))}
        </div>
        {parentData && parentData.user ? (
          <div className="fixed right-5 md:right-10 bottom-16 md:bottom-20">
            <button
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold p-2 rounded-full inline-flex items-center justify-center shadow-lg transform transition duration-150 ease-in-out hover:scale-110"
              style={{ width: "3rem", height: "3rem" }} // Adjust the size as needed
            >
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}
