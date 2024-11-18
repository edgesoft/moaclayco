import mongoose from 'mongoose';
const { Schema } = mongoose;

const VerificationsSchema = new Schema({
    domain: {
      type: String,
      required: true,
      default: "moaclayco"
    },
    description: {
      type: String,
      required: true,
    },
    verificationNumber: {
        type: Number,
        required: true
      },
    verificationDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    metadata: [
      {
        key: String, // payment intent id, order id, payout id
        value: String
      }
    ],
    files: [{
      name: String,
      path: String
    }],
    journalEntries: [
      {
        account: {
          type: Number,
          required: true,
        },
        debit: {
          type: Number,
          default: 0, 
        },
        credit: {
          type: Number,
          default: 0,  
        },
      }
    ]
  },
{ collection: 'verifications' });

export const Verifications = mongoose.models.Verifications || mongoose.model('Verifications', VerificationsSchema);