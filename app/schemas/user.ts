import mongoose from 'mongoose';
import { accountingYear } from "~/utils/accountingDates";
const { Schema } = mongoose;

const UserSchema = new Schema({
    firstname: String,
    lastname: String,
    email: { type: String, lowercase: true, trim: true },
    fiscalYear: {
        type: Number,
        default: () => accountingYear(new Date()) ?? new Date().getUTCFullYear()
    },
    googleSubject: { type: String, unique: true, sparse: true },
    authProvider: String,
},
{ collection: 'users' });

export const Users = mongoose.models.Users || mongoose.model('Users', UserSchema);
