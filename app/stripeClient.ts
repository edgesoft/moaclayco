import Stripe from 'stripe'

const stripeClient = new Stripe(process.env.STRIPE_SRV || "", {
    apiVersion: '2023-08-16'
});


export default stripeClient