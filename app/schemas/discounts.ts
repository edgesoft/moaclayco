import mongoose from 'mongoose';
const { Schema } = mongoose;

const discountSchema = new Schema({
  domain: String,
  code: String,
  expireAt: Date,
  percentage: Number,
  balance: Number,
},
{ collection: 'discounts' });

discountSchema.index({ domain: 1, code: 1 }, { unique: true });

export const Discounts = mongoose.models.Discounts || mongoose.model('Discounts', discountSchema);
