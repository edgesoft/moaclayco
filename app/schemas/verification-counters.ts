import mongoose from "mongoose";

const { Schema } = mongoose;

const VerificationCounterSchema = new Schema(
  {
    key: {
      type: String,
      enum: ["global"],
      required: true,
      default: "global",
    },
    sequence: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: "verificationCounters" }
);

VerificationCounterSchema.index({ key: 1 }, { unique: true });

export const VerificationCounters =
  mongoose.models.VerificationCounters ||
  mongoose.model("VerificationCounters", VerificationCounterSchema);
