export type OrderItem = {
    itemRef: string
    quantity: number,
    additionalItems: [
      {
        name: string,
        price: number,
        packinfo: string
      }
    ]
  }
  
  export type Order = {
    _id: string
    totalSum: number
    paymentIntent?: {
      id: string
      client_secret: string
    }
    customer: {
      firstname: string
      lastname: string
      email: string
    }
    discount: {
      amount: number
      percentage: number | undefined
      code: string | undefined
    }
    items: [OrderItem]
  }
  
  export type CollectionProps = {
    _id?: string
    image: string
    headline: string
    longDescription: string
    shortDescription: string
    instagram?: string
    twitter?: string
    shortUrl: string
    index?: number
  }
  
export type AdditionalItem = {
  price: number
  name: string
}

  export type ItemProps = {
    _id: string
    images: string[]
    amount: number
    price: number
    headline: string
    collectionRef: string
    productInfos?: string[]
    additionalItems?: AdditionalItem[]
    instagram?: string
    longDescription?: string
  }


  export type User = {
    firstname: string
    lastname: string
    email: string
  }