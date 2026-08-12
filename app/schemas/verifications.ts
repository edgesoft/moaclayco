import mongoose from 'mongoose';
import { normalizeJournalEntries } from '~/utils/verificationValidation';
const { Schema } = mongoose;

const VerificationsSchema = new Schema({
    recordType: {
      type: String,
      enum: ["journal", "vatReport", "incomingBalance"],
      required: true,
      default: "journal",
    },
    domain: {
      type: String,
      required: true,
      default: "moaclayco"
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    verificationNumber: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isInteger,
      },
    idempotencyKey: String,
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

VerificationsSchema.pre("validate", function (next) {
  try {
    if (
      (this.recordType === "vatReport" ||
        this.recordType === "incomingBalance") &&
      (!Array.isArray(this.journalEntries) ||
        this.journalEntries.every(
          (entry: any) =>
            Number(entry?.debit || 0) === 0 && Number(entry?.credit || 0) === 0
        ))
    ) {
      this.journalEntries = [] as any;
      next();
      return;
    }
    this.journalEntries = normalizeJournalEntries(this.journalEntries) as any;
    next();
  } catch (error) {
    next(error as Error);
  }
});

VerificationsSchema.index({ domain: 1, verificationNumber: 1 }, { unique: true });
VerificationsSchema.index(
  { domain: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);
VerificationsSchema.index({ domain: 1, verificationDate: 1 });
VerificationsSchema.index({ domain: 1, recordType: 1, verificationDate: 1 });
VerificationsSchema.index({ domain: 1, "metadata.key": 1, "metadata.value": 1 });
VerificationsSchema.index({ domain: 1, "metadata.key": 1, verificationDate: 1 });

export const Verifications = mongoose.models.Verifications || mongoose.model('Verifications', VerificationsSchema);
