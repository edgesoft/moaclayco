import mongoose from 'mongoose';
const { Schema } = mongoose;

const collectionDeletionDecisionSchema = new Schema(
  {
    action: {
      type: String,
      enum: ['move', 'retire']
    },
    itemId: String,
    targetCollectionRef: String
  },
  { _id: false }
);

const collectionRemovalFields = {
  catalogStatus: {
    type: String,
    enum: ['active', 'deleted'],
    default: 'active'
  },
  deletedAt: Date,
  deletionOperationId: String,
  deletionUndoExpiresAt: Date,
  deletionDecisions: [collectionDeletionDecisionSchema]
};

const collectionSchema = new Schema({
  headline:  String,
  shortDescription: String,
  longDescription:   String,
  image: String,
  instagram: String,
  twitter: String,
  shortUrl: String,
  sortOrder: Number,
  ...collectionRemovalFields

},
{ collection: 'collections' });

collectionSchema.index({ shortUrl: 1 }, { unique: true });
collectionSchema.index({ sortOrder: 1 });
collectionSchema.index({ catalogStatus: 1, sortOrder: 1 });
collectionSchema.index({ deletionOperationId: 1 }, { sparse: true });

const cachedCollectionsModel = mongoose.models.Collections;
const collectionRemovalFieldNames = Object.keys(collectionRemovalFields);

if (
  cachedCollectionsModel &&
  collectionRemovalFieldNames.some((path) => !cachedCollectionsModel.schema.path(path))
) {
  // Vite keeps compiled Mongoose models alive between server-side hot reloads.
  // Extend existing references before replacing the cached model so new fields
  // are not silently removed from updates in an already running dev server.
  cachedCollectionsModel.schema.add(collectionRemovalFields);
  mongoose.deleteModel('Collections');
}

export const Collections = mongoose.models.Collections || mongoose.model('Collections', collectionSchema);
