import mongoose from 'mongoose';
const { Schema } = mongoose;

const discountSchema = new Schema({
  code: String,
  used: Boolean,
  usedAt: Date,
  percentage: Number
},
{ collection: 'discounts' });

export const Discounts = mongoose.models.Discounts || mongoose.model('Discounts', discountSchema);