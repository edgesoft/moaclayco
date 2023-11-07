import Select, { ActionMeta } from "react-select";
import { Option, selectStyle } from "./selectStyle";
import { useEffect, useRef, useState } from "react";
import CreatableSelect from 'react-select/creatable';

type DropDownProps = {
  label: string;
  name: string;
  options: Option[];
  currentOptions: Option[];
  required: boolean;
  isMulti?: boolean;
  error?: string;
  onChange?: (value: ReadonlyArray<Option> | Readonly<Option>) => void;
};

export function DropDown({
  label,
  name,
  options,
  currentOptions,
  required = false,
  isMulti = false,
  error = undefined,
  onChange = undefined,
}: DropDownProps) {
  const [selectedOptions, setSelectedOptions] =
    useState<ReadonlyArray<Option>>(currentOptions);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.value = currentOptions
        .map((option) => option.value)
        .join(", ");
    }
  }, []);

  const handleChange = (
    value: ReadonlyArray<Option>,
    meta: ActionMeta<Option>
  ) => {
    if (ref && ref.current) {
      if (isMulti) {
        setSelectedOptions(value);
        ref.current.value = value.map((option) => option.value).join(",");
        onChange && onChange(value);
      } else {
        let option = (meta.option || []) as ReadonlyArray<Option>;
        setSelectedOptions(option);
        ref.current.value = meta.option?.value || "";
        onChange && onChange(option);
      }
    }
  };

  return (
   <div className="w-full">
      <CreatableSelect
        placeholder={label}
        options={options}
        value={selectedOptions}
        onChange={handleChange}
        isMulti
        styles={selectStyle}
        isClearable={true}
      ></CreatableSelect>
      <input type="hidden" name={name} id="name" ref={ref} />
      </div>
  );
}