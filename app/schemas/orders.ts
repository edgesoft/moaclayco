import mongoose from 'mongoose';
const { Schema } = mongoose;

const OrderSchema = new Schema({
    customer: {
        firstname: String,
        lastname: String,
        postaddress: String,
        zipcode: String,
        city: String,
        email: String
    },
    createdAt: Date,
    updatedAt: Date,
    webhookAt: Date,
    status: {
        type: String,
        enum: ['OPENED', 'PENDING', 'FAILED', 'CANCELED', 'SUCCESS']
    },
    items: [{
        itemRef: String,
        name: String,
        price: Number,
        quantity: Number
    }],
    totalSum: Number,
    freightCost: Number,
    paymentIntent: {
        id: String,
        client_secret: String
    }

},
{ collection: 'orders' });

export const Orders = mongoose.models.Orders || mongoose.model('Orders', OrderSchema);