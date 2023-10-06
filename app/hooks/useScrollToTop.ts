import {useEffect} from 'react'

function useScrollToTop() {
  useEffect(() => {
    try {
      window.scroll({
        top: 0,
        left: 0,
        behavior: 'auto',
      })
    } catch (error) {
      window.scrollTo(0, 0)
    }
  }, [])
}

export default useScrollToTop