export type OrderItem = {
    itemRef: string
    quantity: number
}


export type Order = {
    _id: string
    customer: {
        firstname: string
        lastname: string
        email: string

    }
    
}

