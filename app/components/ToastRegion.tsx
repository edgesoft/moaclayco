import { ToastContainer } from "react-toastify";

export default function ToastRegion() {
  return (
    <ToastContainer
      hideProgressBar
      limit={3}
      newestOnTop
      position="top-right"
      theme="light"
    />
  );
}
