import React from "react";

function useStickyState(defaultValue: string, key: string) {
    const [value, setValue] = React.useState(() => {
      const stickyValue = window.localStorage.getItem(`clay.${key}`);
      return stickyValue !== null
        ? JSON.parse(stickyValue)
        : defaultValue;
    });
    React.useEffect(() => {
      window.localStorage.setItem(`clay.${key}`, JSON.stringify(value));
    }, [key, value]);
    return [value, setValue];
  }

  export default useStickyState