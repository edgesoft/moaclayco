import mongoose from "mongoose";

const { Schema } = mongoose;

const WebhookEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ["processing", "completed", "failed"],
    },
    lastError: String,
  },
  { collection: "webhookEvents", timestamps: true }
);

WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export const WebhookEvents =
  mongoose.models.WebhookEvents ||
  mongoose.model("WebhookEvents", WebhookEventSchema);
