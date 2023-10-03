import { useNavigate } from "react-router-dom";
import { Link } from "@remix-run/react";
import { useCart } from "react-use-cart";

const Header = (): JSX.Element => {
  const { totalItems } = useCart();
  const history = useNavigate();
  return (
    <Link to="/" prefetch="intent">
      <div
        style={{
          backgroundImage:
            "url(https://moaclayco-prod.s3.eu-north-1.amazonaws.com/background3.jpg)",
          backgroundPosition: "center left",
          backgroundRepeat: "no-repeat",
        }}
        className="space-between fixed z-10 left-0 top-0 flex p-4 min-w-full h-20 text-gray-600 font-note text-3xl bg-white border-b-2 border-gray-600 md:p-2 md:text-5xl"
      >
        <div className="flex-grow">Moa Clay Collection</div>
        <div
          onClick={(e) => {
            e.preventDefault();
            if (totalItems > 0) {
              history("/cart");
            }
          }}
          className="relative py-0 md:py-3"
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
      </div>
    </Link>
  );
};

export default Header;
