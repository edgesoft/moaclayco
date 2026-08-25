import mongoose from "mongoose";

const { Schema } = mongoose;

const ImageDraftSchema = new Schema(
  {
    collectionRef: String,
    draftId: { required: true, type: String },
    expiresAt: { required: true, type: Date },
    key: { required: true, type: String },
    kind: {
      enum: ["collection", "item", "special-order"],
      required: true,
      type: String,
    },
    status: {
      default: "draft",
      enum: ["deleting", "draft"],
      required: true,
      type: String,
    },
    url: { required: true, type: String },
  },
  { collection: "imageDrafts", timestamps: true }
);

ImageDraftSchema.index({ key: 1 }, { unique: true });
ImageDraftSchema.index({ draftId: 1, kind: 1, status: 1 });
ImageDraftSchema.index({ status: 1, expiresAt: 1 });

export const ImageDrafts =
  mongoose.models.ImageDrafts ||
  mongoose.model("ImageDrafts", ImageDraftSchema);
