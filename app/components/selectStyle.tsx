import { StylesConfig } from "react-select";

const createOption = (label: string) => ({
  label,
  value: label,
});

export type Option = ReturnType<typeof createOption>;

type IsMulti = true;

export const selectStyle: StylesConfig<Option, IsMulti> = {
  multiValueRemove: (styles, { data }) => {
    return {
      ...styles,
      borderColor: "rgb(209, 250, 229)",
      borderTopRightRadius: 6,
      borderBottomRightRadius: 6,
      background: "rgb(209, 250, 229)",
      marginLeft: -1,
      color: "rgb(6, 95, 70)",
      ":hover": {
        backgroundColor: "rgb(12, 138, 102)",
        color: "white",
      },
    };
  },

  multiValue: (base, state) => ({
    ...base,
    color: "rgb(6, 95, 70)",
    borderColor: "rgb(209, 250, 229)",
    background: "rgb(209, 250, 229)",
    fontWeight: "bold",
  }),
  multiValueLabel: (base, state) => ({
    ...base,
    color: "rgb(6, 95, 70)",
    borderColor: "rgb(209, 250, 229)",
    background: "rgb(209, 250, 229)",
    borderRadius: 0,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  }),
  control: (base) => ({
    ...base,
    boxShadow: "1px",
  }),
  singleValue: (provided, state) => {
    const opacity = state.isDisabled ? 0.5 : 1;
    const transition = "opacity 300ms";

    return { ...provided, opacity, transition };
  },
};