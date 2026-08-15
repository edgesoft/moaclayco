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
    manualOrderAt: Date,
    orderConfirmationEmailAt: Date,
    shippingEmailAt: Date,
    checkoutToken: String,
    checkoutFingerprint: String,
    status: {
        type: String,
        enum: ['OPENED', 'PENDING', 'FAILED', 'CANCELED', 'SUCCESS', 'PAID_REVIEW', 'MANUAL_PROCESSING',  'SHIPPED']
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
    paymentIntentAliases: [String],
    paidReviewReason: String,
    discount: {
        code: String,
        percentage: Number,
        amount: Number
    }

},
{ collection: 'orders' });

OrderSchema.index({ "paymentIntent.id": 1 }, { unique: true, sparse: true });
OrderSchema.index(
    { checkoutToken: 1 },
    {
        unique: true,
        partialFilterExpression: { checkoutToken: { $type: "string" } }
    }
);
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ createdAt: -1, _id: -1 });
OrderSchema.index({ "items.itemRef": 1 });

export const Orders = mongoose.models.Orders || mongoose.model('Orders', OrderSchema);
