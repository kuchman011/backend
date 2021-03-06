const mongoose = require('mongoose')
const { Schema } = mongoose

const UserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
    },
    firstname: {
      type: String,
      required: true,
    },
    lastname: {
      type: String,
      required: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: false,
    },
  },
  {
    collection: 'users',
  }
)

mongoose.model('Users', UserSchema)
