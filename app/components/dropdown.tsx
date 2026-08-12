import { Option, selectStyle } from "./selectStyle";
import { useState } from "react";
import CreatableSelect from "react-select/creatable";

type DropDownProps = {
  label: string;
  name?: string;
  options: Option[];
  currentOptions: Option[];
  required: boolean;
  isMulti?: boolean;
  error?: string;
  onChange?: (value: Option | null) => void;
};

export function DropDown({
  ...props
}: DropDownProps) {
  const initialOption = props.currentOptions[0] ?? null;
  return (
    <DropDownControl
      key={`${initialOption?.label ?? ""}:${initialOption?.value ?? ""}`}
      {...props}
      initialOption={initialOption}
    />
  );
}

function DropDownControl({
  label,
  name,
  options,
  onChange = undefined,
  initialOption,
}: DropDownProps & { initialOption: Option | null }) {
  const [selectedOption, setSelectedOption] = useState<Option | null>(initialOption);

  const handleChange = (value: Option | null) => {
    setSelectedOption(value);
    onChange?.(value);
  };

  return (
    <div className="w-full">
      <CreatableSelect
        placeholder={label}
        options={options}
        value={selectedOption}
        onChange={handleChange}
        isMulti={false}
        styles={selectStyle as any}
        isClearable={true}
      ></CreatableSelect>
      <input
        type="hidden"
        name={name}
        value={selectedOption?.value ?? ""}
        readOnly
      />
    </div>
  );
}
