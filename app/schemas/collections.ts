import mongoose from 'mongoose';
const { Schema } = mongoose;

const collectionSchema = new Schema({
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

export const Collections = mongoose.models.Collections || mongoose.model('Collections', collectionSchema);