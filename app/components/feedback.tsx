import {useEffect, useState} from 'react'
import {classNames} from '~/utils/classnames'
import {AnimatePresence, motion} from 'framer-motion'

type FeedbackProp = {
  type: 'error' | 'success'
  headline: string
  onHandleClick?: () => void
  message?: string | undefined
  forceInvisble?: boolean
  visibleInMillis?: number
}

const initialYValue = 20

const Feedback: React.FC<FeedbackProp> = ({
  headline,
  message,
  type,
  onHandleClick,
  forceInvisble = false,
  visibleInMillis,
}): JSX.Element | null => {
  const [value, setValue] = useState<string | undefined>(undefined)

  useEffect(() => {
    let handle: NodeJS.Timeout | null = null
    setValue(headline)
    if (visibleInMillis) {
      handle = setTimeout(() => {
        setValue(undefined)
      }, visibleInMillis)
    }
    return () => {
      if (handle) {
        clearTimeout(handle)
      }
    }
  }, [visibleInMillis, headline, message])

  return (
    <AnimatePresence>
      {!forceInvisble && value ? (
        <motion.div
          exit={{y: initialYValue, opacity: 0}}
          initial={{y: initialYValue, opacity: 0}}
          animate={{y: 0, opacity: 1}}
          transition={{ease: 'easeInOut', duration: 0.3}}
          className="fixed z-10 bottom-2 left-0 w-screen opacity-95"
        >
          <div
            onClick={() => {
              onHandleClick && onHandleClick()
            }}
          >
            <div
              className={classNames(
                'relative flex m-1 px-4 py-2 border-t-4 rounded-b shadow-md',
                type === 'error'
                  ? 'text-red-900 bg-red-100 border-red-500 '
                  : 'text-green-900 bg-green-100 border-t-4 border-green-500 ',
              )}
            >
              <div className="py-1">
                <svg
                  className={classNames(
                    'mr-4 w-6 h-6 fill-current',
                    type === 'error' ? 'text-red-500' : 'text-green-500',
                  )}
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                >
                  <path d="M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z" />
                </svg>
              </div>
              <div>
                <p className="font-bold">{value}</p>
                <p className="text-sm">{message}</p>
              </div>
            </div>
            {!visibleInMillis ? (
              <button
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  setValue(undefined)
                }}
                className={classNames(
                  'absolute right-2 top-2 mr-1 text-2xl font-normal leading-none bg-transparent outline-none focus:outline-none',
                  type === 'error' ? 'text-red-900' : 'text-green-900',
                )}
              >
                <span>×</span>
              </button>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export default Feedback