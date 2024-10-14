import mongoose from 'mongoose';
const { Schema } = mongoose;

const VerificationsSchema = new Schema({
    description: {
      type: String,
      required: true,
    },
    verificationNumber: {
        type: Number,
        required: true,
        unique: true,  
      },
    verificationDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
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