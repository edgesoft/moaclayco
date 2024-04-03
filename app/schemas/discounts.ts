import mongoose from 'mongoose';
const { Schema } = mongoose;

const discountSchema = new Schema({
  code: String,
  expireAt: Date,
  percentage: Number,
  balance: Number,
},
{ collection: 'discounts' });

export const Discounts = mongoose.models.Discounts || mongoose.model('Discounts', discountSchema);