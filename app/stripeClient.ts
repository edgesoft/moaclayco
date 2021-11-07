import Stripe from 'stripe'

const stripeClient = new Stripe(process.env.STRIPE_SRV || "", {
    apiVersion: '2020-08-27'
});



export const clientId = process.env.STRIPE_CLIENT || ""
export  default stripeClient
