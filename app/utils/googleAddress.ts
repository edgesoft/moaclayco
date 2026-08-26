export type GoogleAddressComponent = {
  longText?: string;
  long_name?: string;
  shortText?: string;
  short_name?: string;
  types?: string[];
};

export type SwedishAddress = {
  city: string;
  postaddress: string;
  zipcode: string;
};

const textOf = (component?: GoogleAddressComponent) =>
  component?.longText?.trim() || component?.long_name?.trim() || "";

const componentOf = (
  components: GoogleAddressComponent[],
  ...types: string[]
) => components.find((component) =>
  types.some((type) => component.types?.includes(type))
);

export const formatSwedishPostalCode = (value: string) => {
  const compact = value.replace(/\s/g, "");
  return /^\d{5}$/.test(compact)
    ? `${compact.slice(0, 3)} ${compact.slice(3)}`
    : value.trim();
};

export const swedishAddressFromGoogle = (
  components: GoogleAddressComponent[],
  fallbackStreet = ""
): SwedishAddress => {
  const route = textOf(componentOf(components, "route"));
  const streetNumber = textOf(componentOf(components, "street_number"));
  const postalCode = textOf(componentOf(components, "postal_code"));
  const city = textOf(
    componentOf(
      components,
      "postal_town",
      "locality",
      "administrative_area_level_2"
    )
  );

  return {
    city,
    postaddress: [route, streetNumber].filter(Boolean).join(" ") || fallbackStreet.trim(),
    zipcode: formatSwedishPostalCode(postalCode),
  };
};
