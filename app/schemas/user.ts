import mongoose from 'mongoose';
const { Schema } = mongoose;

const UserSchema = new Schema({
    firstname: String,
    lastname: String,
    email: String
},
{ collection: 'users' });

export const Users = mongoose.models.Users || mongoose.model('Users', UserSchema);