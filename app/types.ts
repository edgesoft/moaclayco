export type OrderItem = {
    itemRef: string
    quantity: number
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
  
  export type ItemProps = {
    _id: string
    images: string[]
    amount: number
    price: number
    productInfos?: string[]
    headline: string
    collectionRef: string
    instagram?: string
    longDescription?: string
  }