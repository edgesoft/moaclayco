import {useEffect, useRef, useState} from 'react'
import {useNavigate} from 'react-router'
import {useCart} from 'react-use-cart'
import {
  ActionFunction,
  json,
  MetaFunction,
  redirect,
  useFetcher,
  createCookie,
} from 'remix'

import {Items} from '~/schemas/items'
import {Orders} from '~/schemas/orders'
import {classNames} from '~/utils/classnames'
import {FREE_FREIGHT, FREIGHT_COST} from '~/utils/constants'
import useStickyState from '../hooks/useStickyState'

export let meta: MetaFunction = () => {
  return {
    title: 'Moa Clay Collection',
    description: 'Moa Clay Collection',
  }
}


type Id = {
  id: string
}

enum ItemError {
  PRICE,
  BALANCE,
}

type ErrorItemVal = {
  [key: string]: {
    error: string
    clientValue: string
    serverValue: string
    type: ItemError
  }
}

export let action: ActionFunction = async ({request}) => {
  let body = new URLSearchParams(await request.text())

  const data = JSON.parse(body.get('items') || '')
  const items = await Items.find(
    {_id: {$in: data.map((d: Id) => d.id)}},
    {amount: 1, price: 1},
  )

  if (items.length !== data.length) {
    return json({errors: {items: true}}) // TODO: what to do?
  }

  const itemErrors = items.reduce<ErrorItemVal>((acc, item) => {
    const s = data.find((d: Id) => d.id === item.id)
    if (s.price !== item.price) {
      acc[s.id] = {
        error: `Priset är uppdaterat`,
        clientValue: `${s.price}`,
        serverValue: `${item.price}`,
        type: ItemError.PRICE,
      }
    }

    if (s.quantity > item.amount) {
      acc[s.id] = {
        error: `Saldot överstiger`,
        clientValue: `${s.quantity}`,
        serverValue: `${item.amount}`,
        type: ItemError.BALANCE,
      }
    }
    return acc
  }, {})

  if (Object.keys(itemErrors).length > 0)
    return json({errors: {items: itemErrors}})

  const totalSum = data.reduce((acc: number, item: any) => {
    acc += item.price * item.quantity
    return acc
  }, 0)

  const freightCost = getFreightCost(totalSum)

  const cookie = createCookie('order', {
    maxAge: 604_800, // one week
  })

  let value = (await cookie.parse(request.headers.get('Cookie'))) || ''

  const customer = {
    firstname: body.get('firstname'),
    lastname: body.get('lastname'),
    postaddress: body.get('postaddress'),
    zipcode: body.get('zipcode'),
    city: body.get('city'),
  }

  const mappedItems = data.map((d: any) => {
    return {
      itemRef: d.id,
      name: d.headline,
      ...d,
    }
  })

  if (value) {
    const order = await Orders.findOne({_id: value})
    if (order) {
      await Orders.updateOne(
        {_id: value},
        {
          updatedAt: new Date(),
          customer,
          items: mappedItems,
          totalSum: totalSum + freightCost,
          freightCost,
        },
      )
      return redirect(`/checkout?order=${order._id}`, {
        headers: {
          'Set-Cookie': await cookie.serialize(order._id),
        },
      })
    }
  }
  const order = await Orders.create({
    createdAt: new Date(),
    items: mappedItems,
    status: 'OPENED',
    customer,
    totalSum: totalSum + freightCost,
    freightCost,
  })
  return redirect(`/checkout?order=${order._id}`, {
    headers: {
      'Set-Cookie': await cookie.serialize(order._id),
    },
  })
}

const getFreightCost = (totalSum: number) => {
  return totalSum >= FREE_FREIGHT ? 0 : FREIGHT_COST
}

const scrollToTop = () => {
  try {
    window.scroll({
      top: 0,
      left: 0,
      behavior: 'auto',
    })
  } catch (error) {
    window.scrollTo(0, 0)
  }
}

type InputProps = {
  name: string
  placeholder: string
  showError: boolean
}

const Input: React.FC<InputProps> = ({
  name,
  placeholder
}): JSX.Element => {
  const [value, setValue] = useStickyState('', name)
  const [invalid, setInvalid] = useState(false)

  return (
    <input
      type="text"
      name={name}
      value={value}
      required={true}
      onInvalid={() => {
        setInvalid(true)
      }}
      onChange={e => {
        setValue(e.target.value)
      }}
      className={classNames(
        'focus:shadow-outline px-3 py-2 w-full text-gray-700 leading-tight border rounded focus:outline-none appearance-none',
        invalid ? 'border-red-400' : '',
      )}
      placeholder={placeholder}
    />
  )
}

export default function Index() {
  const {items, updateItemQuantity, cartTotal} = useCart()
  let cartFetcher = useFetcher()
  let ref = useRef(null)
  const [closeFreight, setCloseFreight] = useState(false)
  let navigation = useNavigate()

  const checkError = (key: string) =>
    cartFetcher.data && cartFetcher.data.errors && cartFetcher.data.errors[key]

  const hasItemsError = () =>
    cartFetcher.data && cartFetcher.data.errors && cartFetcher.data.errors.items

  const hasItemError = (key: string) =>
    cartFetcher.data &&
    cartFetcher.data.errors &&
    cartFetcher.data.errors.items &&
    cartFetcher.data.errors.items[key]

  useEffect(() => {
    scrollToTop()
  }, [])

  useEffect(() => {
    if (hasItemsError()) {
      scrollToTop()
    }
  }, [cartFetcher])

  useEffect(() => {
    if (cartTotal === 0) {
      navigation('/')
    }
  }, [cartTotal])

  const freightCost = getFreightCost(cartTotal)

  return (
    <>
      <div className="flex flex-col mt-20 pl-1 pr-1 pt-4">
        {cartTotal > 0 ? (
          <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
            <div className="overflow auto">
              <div className="inline-block align-middle p-3 py-2 min-w-full">
                <div className="min-w-full border-b border-gray-200 shadow overflow-hidden sm:rounded-lg">
                  <table className="min-w-full divide-gray-200 divide-y">
                    <thead className="bg-gray-50">
                      <tr>
                        <th
                          scope="col"
                          className="flex-wrap px-2 py-3 text-left text-gray-500 text-xs font-medium uppercase"
                        >
                          Namn
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-3 text-left text-gray-500 text-xs font-medium tracking-wider uppercase"
                        >
                          Antal
                        </th>
                        <th
                          scope="col"
                          className="px-2 py-3 text-left text-gray-500 whitespace-nowrap text-xs font-medium tracking-wider uppercase"
                        >
                          St pris
                        </th>
                        <th scope="col" className="relative px-1 py-3">
                          <span className="sr-only">Edit</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-gray-200 divide-y">
                      {items.map(item => {
                        const error = hasItemError(item.id)

                        return (
                          <tr key={item.id}>
                            <td className="px-2 py-4">
                              <div className="flex items-center">
                                <div className="flex-shrink-0 w-12 h-12 md:w-20 md:h-20">
                                  <img
                                    className="w-full h-full rounded-full object-cover object-center"
                                    src={item.image}
                                    alt=""
                                  />
                                </div>
                                <div className="ml-4">
                                  <div className="flex-wrap text-gray-900 text-sm font-medium">
                                    {item.headline}
                                  </div>
                                  {(error &&
                                    error.type === ItemError.BALANCE) ||
                                  item.balance < (item.quantity || 0) ? (
                                    <div>
                                      <div className="p-0.5 text-red-800 text-sm bg-red-100 rounded">
                                        Max{' '}
                                        {error
                                          ? error.serverValue
                                          : item.balance}{' '}
                                        st
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-4 whitespace-nowrap">
                              <span
                                className={classNames(
                                  'inline-flex px-2 text-xs font-semibold leading-5 rounded-full',
                                  (error && error.type === ItemError.BALANCE) ||
                                    item.balance < (item.quantity || 0)
                                    ? 'text-red-800 bg-red-100'
                                    : 'text-green-800 bg-green-100',
                                )}
                              >
                                {item.quantity}
                              </span>
                            </td>
                            <td
                              className={classNames(
                                'px-2 py-4 text-gray-500 whitespace-nowrap text-sm',
                                error && error.type === ItemError.PRICE
                                  ? 'text-red-800'
                                  : '',
                              )}
                            >
                              {item.price}
                            </td>
                            <td className="px-1 py-4 text-right whitespace-nowrap text-base font-medium">
                              <button
                                onClick={() => {
                                  updateItemQuantity(
                                    item.id,
                                    (item.quantity || 0) - 1,
                                  )
                                }}
                                className="px-2 py-0 text-gray-700 hover:text-indigo-900 bg-rosa rounded md:px-4 md:py-1 md:text-lg"
                              >
                                -
                              </button>
                              <button
                                onClick={() => {
                                  updateItemQuantity(
                                    item.id,
                                    (item.quantity || 0) + 1,
                                  )
                                }}
                                className="mx-1 px-2 py-0 text-gray-700 hover:text-indigo-900 bg-rosa rounded md:px-4 md:py-1 md:text-lg"
                              >
                                +
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td className="px-2 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 w-12 h-12 md:w-20 md:h-20"></div>
                            <div className="ml-4">
                              <div className="text-gray-900 text-sm font-medium">
                                Frakt
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-4 whitespace-nowrap">
                          <span
                            className={classNames(
                              'inline-flex px-2 text-green-800 text-xs font-semibold leading-5 bg-green-100 rounded-full',
                            )}
                          >
                            1
                          </span>
                        </td>
                        <td className="px-2 py-4 text-gray-500 whitespace-nowrap text-sm">
                          {freightCost === 0 ? 'Fri frakt' : freightCost}
                        </td>
                        <td className="px-2 py-4 text-right whitespace-nowrap text-base font-medium"></td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="flex flex-row-reverse flex-grow mb-2 px-2">
                    Totalt: {cartTotal + freightCost} SEK
                  </div>
                </div>
              </div>
            </div>
            <cartFetcher.Form ref={ref} method="post">
              <div className="overflow-x-auto">
                <div className="inline-block align-middle p-3 py-2 min-w-full">
                  <div className="mb-20 border-b border-gray-200 shadow overflow-hidden sm:rounded-lg">
                    <div className="p-2 bg-gray-50">
                      <div className="mb-1 text-gray-700 text-xl">
                        Leveransadress
                      </div>

                      <div className="mt-2">
                        <label>Förnamn</label>
                        <Input
                          name="firstname"
                          placeholder="Förnamn"
                          showError={checkError('firstname')}
                        />
                      </div>
                      <div className="mt-2">
                        <label className="text-base">Efternamn</label>
                        <Input
                          name="lastname"
                          placeholder="Efternamn"
                          showError={checkError('lastname')}
                        />
                      </div>

                      <div className="mt-2">
                        <label className="text-base">Postadress</label>
                        <Input
                          name="postaddress"
                          placeholder="Postaddress"
                          showError={checkError('postaddress')}
                        />
                      </div>
                      <div className="flex mt-2">
                        <div className="w-1/3">
                          <label className="">Postnummer</label>
                          <Input
                            name="zipcode"
                            placeholder="Postnr"
                            showError={checkError('zipcode')}
                          />
                        </div>
                        <div className="pl-2 w-2/3">
                          <label className="">Ort</label>
                          <Input
                            name="city"
                            placeholder="Ort"
                            showError={checkError('city')}
                          />
                        </div>
                      </div>
                      <div className="flex flex-row-reverse flex-grow my-4">
                        <input
                          type="hidden"
                          name="items"
                          value={JSON.stringify(items)}
                        />
                        <button
                          disabled={cartFetcher.state !== 'idle'}
                          className="p-2 text-gray-800 hover:text-white font-medium hover:bg-gray-500 bg-rosa rounded"
                        >
                          Till betalningen
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </cartFetcher.Form>
            {closeFreight || cartTotal >= FREE_FREIGHT ? null : (
              <div className="fixed z-10 bottom-2 left-0 w-screen opacity-95">
                <div
                  onClick={() => {
                    navigation('/')
                  }}
                  className="relative flex m-1 px-4 py-2 text-green-900 bg-green-100 border-t-4 border-green-500 rounded-b shadow-md"
                >
                  <div className="py-1">
                    <svg
                      className="mr-4 w-6 h-6 text-green-500 fill-current"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                    >
                      <path d="M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold">
                      Köp för {FREE_FREIGHT - cartTotal} till och du får fri
                      frakt
                    </p>
                    <p className="text-sm">Titta på fler kollektioner</p>
                  </div>
                </div>
                <button  onClick={() => {
                  setCloseFreight(true)
                }} className="absolute right-2 top-2 mr-1 text-green-900 text-2xl font-normal leading-none bg-transparent outline-none focus:outline-none">
                  <span>×</span>
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
      {cartFetcher.state === 'submitting' ? (
        <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <div className="w-32 h-32 bg-blue-300 border-blue-500 rounded-full animate-ping ring-2 ring-blue-800"></div>
        </div>
      ) : null}
    </>
  )
}
