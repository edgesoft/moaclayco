import mongoose from "mongoose";

const { Schema } = mongoose;

const VerificationCounterSchema = new Schema(
  {
    domain: { type: String, required: true, unique: true },
    sequence: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: "verificationCounters" }
);

export const VerificationCounters =
  mongoose.models.VerificationCounters ||
  mongoose.model("VerificationCounters", VerificationCounterSchema);
