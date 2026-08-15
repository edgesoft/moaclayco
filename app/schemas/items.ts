import mongoose from 'mongoose';
const { Schema } = mongoose;

const itemRetirementFields = {
  catalogStatus: {
    type: String,
    enum: ['active', 'retired'],
    default: 'active'
  },
  retiredAt: Date,
  retiredFromCollection: String,
  retirementReason: String,
  lastCatalogOperationId: String
};

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
  additionalItems: [{
    name: String,
    price: Number
  }],
  ...itemRetirementFields
},
{ collection: 'items' });

ItemSchema.index({ collectionRef: 1, _id: -1 });
ItemSchema.index({ catalogStatus: 1, collectionRef: 1, _id: -1 });

const cachedItemsModel = mongoose.models.Items;
const itemRetirementFieldNames = Object.keys(itemRetirementFields);

if (
  cachedItemsModel &&
  itemRetirementFieldNames.some((path) => !cachedItemsModel.schema.path(path))
) {
  // Keep long-running Vite dev servers in sync when the schema gains fields.
  // Without this, strict Mongoose updates drop these paths without an error.
  cachedItemsModel.schema.add(itemRetirementFields);
  mongoose.deleteModel('Items');
}

export const Items = mongoose.models.Items || mongoose.model('Items', ItemSchema);
