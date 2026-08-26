import mongoose from 'mongoose';
const { Schema } = mongoose;

const SpecialOrderInvitationHistorySchema = new Schema({
    action: {
        type: String,
        enum: ['REVOKED', 'REPLACED'],
        required: true
    },
    at: {
        type: Date,
        required: true
    },
    fromVersion: {
        type: Number,
        required: true
    },
    paymentIntentId: String,
    toVersion: Number
}, { _id: false });

const OrderSchema = new Schema({
    customer: {
        firstname: String,
        lastname: String,
        postaddress: String,
        addressLine2: String,
        zipcode: String,
        city: String,
        country: String,
        email: String,
        phone: String
    },
    kind: {
        type: String,
        enum: ['STOREFRONT', 'SPECIAL'],
        default: 'STOREFRONT'
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
        enum: ['DRAFT', 'AWAITING_CUSTOMER', 'OPENED', 'PENDING', 'FAILED', 'CANCELED', 'SUCCESS', 'PAID_REVIEW', 'MANUAL_PROCESSING',  'SHIPPED']
    },
    items: [{
        itemRef: String,
        templateItemRef: String,
        inventoryMode: {
            type: String,
            enum: ['TRACKED', 'UNTRACKED']
        },
        name: String,
        description: String,
        longDescription: String,
        price: Number,
        quantity: Number,
        image: String,
        finalImage: String,
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
    },
    specialOrder: {
        accessVersion: Number,
        addressConfirmedAt: Date,
        expiresAt: Date,
        expiryIncludesTime: Boolean,
        freightMode: {
            type: String,
            enum: ['AUTO', 'CUSTOM']
        },
        lockedAt: Date,
        invitationHistory: [SpecialOrderInvitationHistorySchema],
        publicOrigin: String,
        publicTokenHash: String,
        replacedAt: Date,
        revokedAt: Date,
        sentAt: Date,
        termsAcceptedAt: Date
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
OrderSchema.index(
    { "specialOrder.publicTokenHash": 1 },
    {
        unique: true,
        partialFilterExpression: {
            "specialOrder.publicTokenHash": { $type: "string" }
        }
    }
);

export const Orders = mongoose.models.Orders || mongoose.model('Orders', OrderSchema);
