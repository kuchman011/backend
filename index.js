const mongoose = require('mongoose')
require('./models/attendee')
require('./models/event')
require('./models/user')
require('./models/subscription')
require('./models/receiver')
const express = require('express')
const asyncHandler = require('express-async-handler')
const secret = require('./middleware/secret')
const app = express()

app.use(express.json())

/**
 * Establish a connection to the mongo database, then continue the request
 **/
app.use(
  asyncHandler(async (req, res, next) => {
    await mongoose.connect(process.env.DB_URI, {
      connectTimeoutMS: 5000,
      useNewUrlParser: true,
    })
    next()
  })
)

require('./routes/attendee')(app)
app.use(secret)
require('./routes/event')(app)
require('./routes/user')(app)
require('./routes/subscription')(app)
require('./routes/receiver')(app)

module.exports = app
