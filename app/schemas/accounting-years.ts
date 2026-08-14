import mongoose from "mongoose";

const { Schema } = mongoose;

const AccountingYearSchema = new Schema(
  {
    year: {
      type: Number,
      required: true,
      min: 2000,
      max: 2200,
      validate: Number.isInteger,
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      required: true,
      default: "open",
    },
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    closedAt: Date,
    finalIncomingBalanceVerificationNumber: Number,
  },
  {
    collection: "accountingYears",
    timestamps: true,
  }
);

AccountingYearSchema.index({ year: 1 }, { unique: true });

export const AccountingYears =
  mongoose.models.AccountingYears ||
  mongoose.model("AccountingYears", AccountingYearSchema);
