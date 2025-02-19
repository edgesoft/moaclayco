import mongoose from 'mongoose';
const { Schema } = mongoose;

const OrderSchema = new Schema({
    domain: {
        type: String,
        required: true,
        default: "moaclayco"
    },
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
    manualOrderAt: Date,
    status: {
        type: String,
        enum: ['OPENED', 'PENDING', 'FAILED', 'CANCELED', 'SUCCESS', 'MANUAL_PROCESSING',  'SHIPPED']
    },
    items: [{
        itemRef: String,
        name: String,
        price: Number,
        quantity: Number,
        image: String,
        additionalItems: [
            {
                name: String,
                price: Number,
                packinfo: String
            }
        ]
    }],
    totalSum: Number,
    freightCost: Number,
    paymentIntent: {
        id: String,
        client_secret: String
    },
    discount: {
        code: String,
        percentage: Number,
        amount: Number
    }

},
{ collection: 'orders' });

export const Orders = mongoose.models.Orders || mongoose.model('Orders', OrderSchema);