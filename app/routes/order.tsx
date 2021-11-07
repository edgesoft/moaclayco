import type {MetaFunction,  LoaderFunction} from 'remix'
import {useLoaderData} from 'remix'
import {useCart} from 'react-use-cart'
import { useEffect } from 'react'

export let loader: LoaderFunction = async ({request}) => {
  let url = new URL(await request.url);
  let body = new URLSearchParams(url.search)

  // TODO: update status
  // Update saldo?
  console.log(body)

  return {kalle: 1}
}

export let meta: MetaFunction = () => {
  return {
    title: 'Moa Clay Collection',
    description: 'Moa Clay Collection',
  }
}

export default function Index() {
  let data = useLoaderData()
  const {emptyCart} = useCart()
  useEffect(() => {
    emptyCart()
  }, [])
  
  return (
    <div className="mt-20 ml-2 mr-2">
        Tack för ditt köp!
    </div>
  )
}
