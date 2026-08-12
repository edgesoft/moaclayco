import mongoose from 'mongoose';
const { Schema } = mongoose;

const UserSchema = new Schema({
    firstname: String,
    lastname: String,
    email: { type: String, lowercase: true, trim: true },
    fiscalYear: { type: Number, default: new Date().getFullYear() },
    googleSubject: { type: String, unique: true, sparse: true },
    authProvider: String,
},
{ collection: 'users' });

export const Users = mongoose.models.Users || mongoose.model('Users', UserSchema);
