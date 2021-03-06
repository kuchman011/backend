const mongoose = require('mongoose')
const Event = mongoose.model('Events')
const Attendee = mongoose.model('Attendees')
const User = mongoose.model('Users')
const Receiver = mongoose.model('Receivers')
const auth = require('../middleware/auth')
const asyncHandler = require('express-async-handler')
const AWS = require('aws-sdk')
const mandrill = require('mandrill-api/mandrill')
const mandrillClient = new mandrill.Mandrill(process.env.MANDRILL_API_KEY)
const { generateCertificate } = require('./attendee')
const getRawBody = require('raw-body')
const moment = require('moment')

AWS.config = {
  accessKeyId: process.env.CLIENT_ACCESS_KEY_ID,
  secretAccessKey: process.env.CLIENT_SECRET_ACCESS_KEY,
  region: process.env.CLIENT_AWS_REGION,
}

module.exports = (app) => {
  app.post('/events', auth, asyncHandler(create))
  app.put('/events', auth, asyncHandler(update))
  app.delete('/events', auth, asyncHandler(_delete))
  app.post('/events/submit', auth, asyncHandler(submit))
  app.get('/users/events/count', auth, asyncHandler(getEventCount))
  app.get('/events/attendees', auth, asyncHandler(getAttendees))
  app.post('/events/certificate', auth, asyncHandler(sendCertificate))
}

/**
 * Get the number of events owned by a user
 **/
async function getEventCount(req, res) {
  const count = await Event.countDocuments({
    user: req.user._id,
  }).exec()
  res.json({ count })
}

/**
 * Create a new Event
 **/
async function create(req, res) {
  const created = await Event.create({
    ...req.body,
    user: req.user._id,
  })
  // Create the initial sheet receiver
  const user = await User.findOne({
    _id: req.user._id,
  })
    .lean()
    .exec()
  await Receiver.create({
    email: user.email,
    eventId: created._id,
  })
  res.json(created)
}

/**
 * Update an Event document
 **/
async function update(req, res) {
  const doc = await Event.findOne({
    _id: req.body._id,
  })
    .lean()
    .exec()
  if (!doc) {
    res.status(404)
    res.send(
      'Unable to find document to update. Please supply an _id property.'
    )
    return
  }
  if (doc.user.toString() !== req.user._id.toString()) {
    res.status(401)
    res.send("You don't own this event and cannot update it.")
    return
  }
  const updated = await Event.updateOne(
    {
      _id: doc._id,
    },
    {
      ...req.body,
    }
  )
  if (updated.n !== 1) {
    res.status(500)
    res.send('No documents selected.')
    return
  }
  res.status(204)
  res.end()
}

/**
 * Delete an Event document
 **/
async function _delete(req, res) {
  if (!req.body._id) {
    res.status(400)
    res.send('No _id specified for deletion.')
    return
  }
  const doc = await Event.findOne({
    _id: req.body._id,
  })
    .lean()
    .exec()
  if (!doc) {
    res.status(404)
    res.send(
      'Unable to find document to delete. Please supply an _id property.'
    )
    return
  }
  if (doc.user.toString() !== req.user._id.toString()) {
    res.status(401)
    res.send("You don't own this event and cannot delete it.")
    return
  }
  const deleted = await Event.deleteOne({
    _id: req.body._id,
  }).exec()
  if (deleted.n !== 1) {
    res.status(500)
    res.send('No documents deleted.')
    return
  }
  res.status(204)
  res.end()
}

async function getAttendees(req, res) {
  if (!req.query.eventId) {
    res.status(400)
    res.send('Please supply an eventId to retrieve attendees for.')
    return
  }
  const attendees = await Attendee.find({
    event: req.query.eventId,
  })
    .sort({
      firstname: 1,
    })
    .lean()
    .exec()
  res.json(attendees)
}

/**
 * Send a certificate for an attendee to a specific email
 * A utility to preview the certificate
 **/
async function sendCertificate(req, res) {
  const doc = await Event.findOne({
    _id: req.body._id,
  })
    .populate('user')
    .exec()
  if (!doc) {
    res.status(404)
    res.send(
      'Unable to find document to submit. Please supply an _id property.'
    )
    return
  }
  if (doc.user._id.toString() !== req.user._id.toString()) {
    res.status(401)
    res.send("You don't own this event and cannot submit it.")
    return
  }
  const attendee = await Attendee.findOne({
    _id: mongoose.Types.ObjectId(req.body.attendeeId),
  })
    .lean()
    .exec()
  await _sendCertificate(doc, attendee, req.body.email)
  res.status(204)
  res.end()
}

/**
 * Submit and send emails
 **/
/* eslint-disable camelcase */
async function submit(req, res) {
  const doc = await Event.findOne({
    _id: req.body._id,
  })
    .populate('user')
    .exec()
  if (!doc) {
    res.status(404)
    res.send(
      'Unable to find document to submit. Please supply an _id property.'
    )
    return
  }
  if (doc.user._id.toString() !== req.user._id.toString()) {
    res.status(401)
    res.send("You don't own this event and cannot submit it.")
    return
  }
  const attendees = await Attendee.find({
    event: req.body._id,
  }).exec()

  const receivers = await Receiver.find({
    eventId: req.body._id,
  })
    .lean()
    .exec()

  /**
   * Send summary by default, specify `sendSummary` as 0 to not send
   **/
  if (req.body.sendSummary !== false) {
    await sendSummary(doc, attendees, receivers.map((r) => r.email))
  }

  /**
   * Send certificates by default, specify `sendCertificates` as 0 to not send
   **/
  if (req.body.sendCertificates !== false) {
    const promises = [
      ...attendees.map((_attendee) => {
        if (_attendee.receivedCertificate) return Promise.resolve()
        return _sendCertificate(doc, _attendee).then(() =>
          Attendee.updateOne(
            {
              _id: mongoose.Types.ObjectId(_attendee._id),
            },
            {
              receivedCertificate: true,
            }
          )
        )
      }),
    ]
    await Promise.all(promises)
  }

  await Event.updateOne(
    {
      _id: doc._id,
    },
    {
      isSubmitted: true,
    }
  )
  res.status(204)
  res.end()
}

function sendSummary(_event, attendees, emails) {
  const sheetTemplateData = {
    key: process.env.MANDRILL_API_KEY,
    template_content: [],
    message: {
      auto_text: true,
      inline_css: true,
      merge: true,
      merge_language: 'handlebars',
      to: emails.map((email) => ({ email })),
      subject: `ATTENDANCE SUMMARY - ${_event.name}`,
      global_merge_vars: [
        {
          name: 'courseNo',
          content: _event.courseNo,
        },
        {
          name: 'courseName',
          content: _event.courseName,
        },
        {
          name: 'address',
          content: _event.address,
        },
        {
          name: 'city',
          content: _event.city,
        },
        {
          name: 'state',
          content: _event.state,
        },
        {
          name: 'presenterName',
          content: _event.presenterName,
        },
        {
          name: 'attendees',
          content: attendees,
        },
        {
          name: 'TDATE',
          content: moment(_event.date).format('M/D/YYYY'),
        },
        {
          name: 'TRAININGP',
          content: _event.trainingProvider,
        },
      ],
      from_email: 'support@hojackconnections.com',
    },
    template_name: 'TEST_SUMMARY_SHEET_EMAIL',
  }
  return new Promise((rs, rj) => {
    mandrillClient.messages.sendTemplate(sheetTemplateData, (results) => {
      if (
        results.filter((r) => r.status !== 'sent' && r.status !== 'queued')
          .length
      ) rj(results)
      else rs()
    })
  })
}

async function _sendCertificate(_event, attendee, email) {
  const pdfCertificate = await getRawBody(generateCertificate(_event, attendee))
  const date = new Date(_event.date)
  const certTemplateData = {
    key: process.env.MANDRILL_API_KEY,
    template_content: [],
    template_name: 'Certificate Template',
    message: {
      to: [{ email: email || attendee.email }],
      subject: 'CERTIFICATE OF COURSE COMPLETION',
      from_email: 'support@hojackconnections.com',
      auto_text: true,
      inline_css: true,
      merge: true,
      merge_language: 'mailchimp',
      attachments: [
        {
          type: 'application/pdf',
          name: 'certificate.pdf',
          content: pdfCertificate.toString('base64'),
        },
      ],
      global_merge_vars: [
        {
          name: 'FNAME',
          content: attendee.firstname,
        },
        {
          name: 'LNAME',
          content: attendee.lastname,
        },
        {
          name: 'COURSET',
          content: _event.courseName,
        },
        {
          name: 'Presenter',
          content: _event.presenterName,
        },
        {
          name: 'ADDRESS',
          content: _event.address,
        },
        {
          name: 'TRAININGP',
          content: _event.trainingProvider,
        },
        {
          name: 'TDATE',
          content:
            date.getMonth() +
            1 +
            '/' +
            date.getDate() +
            '/' +
            date.getFullYear(),
        },
        {
          name: 'CREDITS',
          content: _event.numberOfCourseCredits,
        },
      ],
    },
  }
  return await new Promise((rs, rj) => {
    mandrillClient.messages.sendTemplate(certTemplateData, (results) => {
      if (
        results.filter((r) => r.status !== 'sent' && r.status !== 'queued')
          .length
      ) rj(results)
      else rs()
    })
  })
}
/* eslint-enable camelcase */
