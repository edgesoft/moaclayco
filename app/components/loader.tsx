import { useTransition } from "remix"

export default function Loader() {
  return (
    <div className="fixed left-1/2 top-1/2 z-20 transform -translate-x-1/2 -translate-y-1/2">
      <div className="w-32 h-32 text-green-900 bg-green-500 rounded-full animate-ping ring-2 ring-green-900"></div>
    </div>
  )
}
