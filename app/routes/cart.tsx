import {useEffect, useRef} from 'react'
import {useNavigate} from 'react-router'
import {useCart} from 'react-use-cart'
import {ActionFunction, json, MetaFunction, redirect, useFetcher} from 'remix'

import {Items} from '~/schemas/items'
import {Orders} from '~/schemas/orders'

function classNames(...classes: Array<string>) {
  return classes.filter(Boolean).join(' ')
}

export let meta: MetaFunction = () => {
  return {
    title: 'Moa Clay Collection',
    description: 'Moa Clay Collection',
  }
}

type Rule = {
  name: string
  validator: () => boolean
  error: string
}

interface MinRule extends Rule {
  minLength: number
}

const CoreValidator = (rule: Rule, body: URLSearchParams) => {
  if (!rule.name) return false
  if (!rule.validator) return false
  if (!body.get(rule.name)) return false
  return true
}

const minLengthValidator = (rule: MinRule, body: URLSearchParams) => {
  if (!body) return false
  if (!rule) return false

  if (CoreValidator(rule, body)) {
    const d = body.get(rule.name)
    if (!rule.minLength) return false
    if (!d) return false
    if (d.length < rule.minLength) return false

    return true
  }

  return false
}

const validators = [
  {
    name: 'firstname',
    minLength: 1,
    validator: minLengthValidator,
    error: 'Förnamn får inte vara tomt',
  },
  {
    name: 'lastname',
    minLength: 1,
    validator: minLengthValidator,
    error: 'Efternamn får inte vara tomt',
  },
  {
    name: 'postaddress',
    minLength: 1,
    validator: minLengthValidator,
    error: 'Postadress får inte vara tomt',
  },
  {
    name: 'zipcode',
    minLength: 1,
    validator: minLengthValidator,
    error: 'Postnummer får inte vara tomt',
  },
  {
    name: 'city',
    minLength: 1,
    validator: minLengthValidator,
    error: 'Ort får inte vara tomt',
  },
]

type ErrorVal = {
  [key: string]: {
    error: string
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

  const errors = validators
    .filter(v => {
      return !v.validator(v as MinRule, body)
    })
    .reduce<ErrorVal>((acc, e) => {
      acc[e.name] = {error: e.error}
      return acc
    }, {})

  if (Object.keys(errors).length > 0) {
    return json({errors})
  }

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

  const order = await Orders.create({
    createdAt: new Date(),
    items: data.map((d: any) => {
      return {
        itemRef: d.id,
        name: d.headline,
        ...d,
      }
    }),
    status: 'OPENED',
    customer: {
      firstname: body.get('firstname'),
      lastname: body.get('lastname'),
      postaddress: body.get('postaddress'),
      zipcode: body.get('zipcode'),
      city: body.get('city'),
    },
    totalSum: totalSum + freightCost,
    freightCost,
  })

  return redirect(`/checkout?order=${order._id}`)
}

const getFreightCost = (totalSum: number) => {
  return totalSum >= 299 ? 0 : 24
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

export default function Index() {
  const {items, updateItemQuantity, cartTotal} = useCart()
  let cartFetcher = useFetcher()
  let ref = useRef(null)
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
    <div className="flex flex-col mt-20 pl-1 pr-1 pt-4">
      {cartTotal > 0 ? (
        <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <div className="inline-block align-middle p-3 py-2 min-w-full">
              <div className="min-w-full border-b border-gray-200 shadow overflow-hidden sm:rounded-lg">
                <table className="min-w-full divide-gray-200 divide-y">
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        scope="col"
                        className="flex-grow px-2 py-3 text-left text-gray-500 text-xs font-medium tracking-wider uppercase"
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
                          <td className="px-2 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 w-12 h-12 md:w-20 md:h-20">
                                <img
                                  className="w-full h-full rounded-full object-cover object-center"
                                  src={item.image}
                                  alt=""
                                />
                              </div>
                              <div className="ml-4">
                                <div className="flex-grow text-gray-900 text-sm font-medium">
                                  {item.headline}
                                </div>
                                {(error && error.type === ItemError.BALANCE) ||
                                item.balance < (item.quantity || 0) ? (
                                  <div>
                                    <div className="p-0.5 text-red-800 text-sm bg-red-100 rounded">
                                      Max{' '}
                                      {error ? error.serverValue : item.balance}{' '}
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
                      <input
                        type="text"
                        name="firstname"
                        className={classNames(
                          'focus:shadow-outline px-3 py-2 w-full text-gray-700 leading-tight border rounded focus:outline-none appearance-none',
                          checkError('firstname') ? 'border-red-400' : '',
                        )}
                        placeholder="Förnamn"
                      />
                    </div>
                    <div className="mt-2">
                      <label className="text-base">Efternamn</label>
                      <input
                        type="text"
                        name="lastname"
                        className={classNames(
                          'focus:shadow-outline px-3 py-2 w-full text-gray-700 leading-tight border rounded focus:outline-none appearance-none',
                          checkError('lastname') ? 'border-red-400' : '',
                        )}
                        placeholder="Efternamn"
                      />
                    </div>

                    <div className="mt-2">
                      <label className="text-base">Postadress</label>
                      <input
                        type="text"
                        name="postaddress"
                        className={classNames(
                          'focus:shadow-outline px-3 py-2 w-full text-gray-700 leading-tight border rounded focus:outline-none appearance-none',
                          checkError('postaddress') ? 'border-red-400' : '',
                        )}
                        placeholder="Postadress"
                      />
                    </div>
                    <div className="flex mt-2">
                      <div className="w-1/3">
                        <label className="">Postnummer</label>
                        <input
                          name="zipcode"
                          defaultValue={1234}
                          type="number"
                          className={classNames(
                            'focus:shadow-outline px-3 py-2 w-full text-gray-700 leading-tight border rounded focus:outline-none appearance-none',
                            checkError('zipcode') ? 'border-red-400' : '',
                          )}
                          placeholder="Postnr"
                        />
                      </div>
                      <div className="pl-2 w-2/3">
                        <label className="">Ort</label>
                        <input
                          name="city"
                          type="text"
                          className={classNames(
                            'focus:shadow-outline px-3 py-2 w-full text-gray-700 leading-tight border rounded focus:outline-none appearance-none',
                            checkError('city') ? 'border-red-400' : '',
                          )}
                          placeholder="Ort"
                        />
                      </div>
                    </div>
                    <div className="flex flex-row-reverse flex-grow my-4">
                      <input
                        type="hidden"
                        name="items"
                        value={JSON.stringify(items)}
                      />
                      <button className="p-2 text-gray-700 font-medium bg-rosa rounded">
                        Till betalningen
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </cartFetcher.Form>
        </div>
      ) : null}
    </div>
  )
}
