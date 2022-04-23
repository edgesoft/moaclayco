import mongoose from 'mongoose';
const { Schema } = mongoose;

const ItemSchema = new Schema({
  headline:  String,
  price: Number,
  productInfos: [String],
  images: [String],
  instagram: String,
  collectionRef: String,
  amount: Number,
  longDescription: String,
  sortOrder: Number,

},
{ collection: 'items' });

export const Items = mongoose.models.Items || mongoose.model('Items', ItemSchema);