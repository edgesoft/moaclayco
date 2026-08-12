import { Option, selectStyle } from "./selectStyle";
import { useEffect, useRef, useState } from "react";
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
  label,
  name,
  options,
  currentOptions,
  onChange = undefined,
}: DropDownProps) {
  const [selectedOption, setSelectedOption] = useState<Option | null>(
    currentOptions[0] ?? null
  );
  const ref = useRef<HTMLInputElement>(null);
  const currentLabel = currentOptions[0]?.label ?? "";
  const currentValue = currentOptions[0]?.value ?? "";

  useEffect(() => {
    setSelectedOption(
      currentValue ? { label: currentLabel, value: currentValue } : null
    );
    if (ref.current) {
      ref.current.value = currentValue;
    }
  }, [currentLabel, currentValue]);

  const handleChange = (value: Option | null) => {
    if (ref && ref.current) {
      setSelectedOption(value);
      ref.current.value = value?.value ?? "";
      onChange?.(value);
    }
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
      <input type="hidden" name={name} ref={ref} />
    </div>
  );
}
