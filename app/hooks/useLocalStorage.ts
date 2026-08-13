import { useCallback, useMemo, useSyncExternalStore } from "react";

const localStorageChangeEvent = "moaclayco:local-storage-change";
const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;
const getServerStorageSnapshot = () => null;

const parseStoredValue = <T,>(rawValue: string | null, initialValue: T): T => {
  if (rawValue === null) return initialValue;
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return initialValue;
  }
};

function useLocalStorage<T>(key: string, initialValue: T) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === key) onStoreChange();
      };
      const handleLocalChange = (event: Event) => {
        if ((event as CustomEvent<string>).detail === key) onStoreChange();
      };
      window.addEventListener("storage", handleStorage);
      window.addEventListener(localStorageChangeEvent, handleLocalChange);
      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(localStorageChangeEvent, handleLocalChange);
      };
    },
    [key]
  );

  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);

  const rawValue = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerStorageSnapshot
  );
  const storedValue = useMemo(
    () => parseStoredValue(rawValue, initialValue),
    [rawValue, initialValue]
  );
  const loaded = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot
  );

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore =
        typeof value === "function"
          ? (value as (currentValue: T) => T)(storedValue)
          : value;
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
      window.dispatchEvent(
        new CustomEvent(localStorageChangeEvent, { detail: key })
      );
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue, loaded] as const;
}

export default useLocalStorage;
