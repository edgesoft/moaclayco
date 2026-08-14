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
    editHistory: [
      {
        editedAt: { type: Date, required: true },
        editedBy: String,
        reason: { type: String, required: true, trim: true, maxlength: 500 },
        previousDescription: { type: String, required: true },
        previousVerificationDate: { type: Date, required: true },
        previousJournalEntries: [
          {
            account: { type: Number, required: true },
            debit: { type: Number, default: 0 },
            credit: { type: Number, default: 0 },
          },
        ],
      },
    ],
    fileHistory: [
      {
        action: {
          type: String,
          enum: ["removed"],
          required: true,
        },
        changedAt: { type: Date, required: true },
        changedBy: String,
        name: { type: String, required: true },
        path: { type: String, required: true },
      },
    ],
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

VerificationsSchema.pre("validate", function () {
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
    return;
  }

  this.journalEntries = normalizeJournalEntries(this.journalEntries) as any;
});

VerificationsSchema.index({ verificationNumber: 1 }, { unique: true });
VerificationsSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);
VerificationsSchema.index({ verificationDate: 1, verificationNumber: 1 });
VerificationsSchema.index({ recordType: 1, verificationDate: 1 });
VerificationsSchema.index({ "metadata.key": 1, "metadata.value": 1 });
VerificationsSchema.index({ "metadata.key": 1, verificationDate: 1 });

export const Verifications = mongoose.models.Verifications || mongoose.model('Verifications', VerificationsSchema);
