import mongoose from 'mongoose';
const { Schema } = mongoose;

const collectionSchema = new Schema({
  domain: String,
  headline:  String,
  shortDescription: String,
  longDescription:   String,
  image: String,
  instagram: String,
  twitter: String,
  shortUrl: String,
  sortOrder: Number

},
{ collection: 'collections' });

collectionSchema.index({ domain: 1, shortUrl: 1 }, { unique: true });
collectionSchema.index({ domain: 1, sortOrder: 1 });

export const Collections = mongoose.models.Collections || mongoose.model('Collections', collectionSchema);
