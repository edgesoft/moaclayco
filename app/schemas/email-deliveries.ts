import mongoose from "mongoose";

const { Schema } = mongoose;

const EmailDeliverySchema = new Schema(
  {
    attempt: { default: 1, min: 1, required: true, type: Number },
    claimToken: String,
    claimedAt: Date,
    deduplicationKey: { required: true, type: String },
    kind: {
      enum: ["ORDER_CONFIRMATION", "SHIPPING", "SPECIAL_ORDER_INVITATION"],
      required: true,
      type: String,
    },
    lastError: String,
    orderRef: { index: true, required: true, type: Schema.Types.ObjectId },
    providerMessageId: String,
    recipientFingerprint: String,
    sentAt: Date,
    status: {
      default: "PENDING",
      enum: ["PENDING", "SENDING", "SENT", "FAILED", "UNKNOWN"],
      index: true,
      required: true,
      type: String,
    },
  },
  { collection: "emailDeliveries", timestamps: true }
);

EmailDeliverySchema.index({ deduplicationKey: 1 }, { unique: true });
EmailDeliverySchema.index({ status: 1, claimedAt: 1 });
EmailDeliverySchema.index({ orderRef: 1, kind: 1, attempt: -1, createdAt: -1 });

export const EmailDeliveries =
  mongoose.models.EmailDeliveries ||
  mongoose.model("EmailDeliveries", EmailDeliverySchema);
