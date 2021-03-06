const mongoose = require('mongoose')
const { Schema } = mongoose

const AttendeeSchema = new Schema(
  {
    firstname: {
      type: String,
      required: true,
    },
    lastname: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: false,
    },
    signature: {
      type: String,
      required: false,
    },
    receivedCertificate: {
      type: Boolean,
      required: true,
      default: false,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Events',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: false,
    },
  },
  {
    collection: 'attendees',
  }
)

mongoose.model('Attendees', AttendeeSchema)
