import type { Transition } from '@remix-run/react/transition'
import {useEffect, useState} from 'react'

type Fetcher = {
  state: string
}

type LoaderProps = {
  transition: Transition | Fetcher
  forceSpinner?: boolean
}

const loadingState = ["loading", "submitting"]

const hasLoadingState = ({transition}: LoaderProps): boolean => {
    return loadingState.indexOf(transition.state) !== -1
}

export default function Loader({transition, forceSpinner}: LoaderProps) {
  const [show, setShow] = useState<boolean>(false)
  let handle: NodeJS.Timeout | undefined = undefined
  useEffect(() => {
    if (forceSpinner || hasLoadingState({transition})) {
      handle = setTimeout(() => {
        if (forceSpinner || hasLoadingState({transition})) {
          setShow(true)
        }
      }, 1000)
    } else {
      setShow(false)
    }
    return () => {
      if (handle)
      clearTimeout(handle)
    }
  }, [transition, forceSpinner])


  if (!show) return null

  return (
    <div className="fixed z-20 left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
      <div className="w-32 h-32 bg-green-500 rounded-full animate-ping ring-2 ring-green-800"></div>
    </div>
  )
}
