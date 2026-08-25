const normalizedAddressLine = (value?: string) =>
  (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sv-SE");

export const distinctAddressLine2 = (
  postaddress?: string,
  addressLine2?: string
) => {
  const secondLine = (addressLine2 ?? "").trim();
  if (!secondLine) return "";

  return normalizedAddressLine(secondLine) === normalizedAddressLine(postaddress)
    ? ""
    : secondLine;
};
