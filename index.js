require('dotenv').config()

const express = require('express')
const app = express()

const http = require('http').Server(app)
const io = require('socket.io')(http, {
  cors: {
    origin: process.env.CORS_ORIGIN
  }
})

const bcrypt = require('bcrypt')

const { createClient } = require('redis')
const redisClient = createClient({
  url: process.env.REDIS_TLS_URL
})
redisClient.connect()

const port = process.env.PORT || 5000

const cors = require('cors')
app.use(cors({
  origin: process.env.CORS_ORIGIN
}))

app.get('/', (req, res, next) => {
  return res.status(200).json({ msg: 'YourChat API is working correctly' })
})
app.get('/channels/:channel/members', (req, res, next) => {
  const filteredMembersOfChannels = membersOfChannels.filter(({ channelName }) => channelName === req.params.channel)
  return res.status(200).json(filteredMembersOfChannels)
})
app.get('/channels/:channel/messages', async (req, res, next) => {
  let messages = await redisClient.lRange(req.params.channel, 0, -1)
  messages = messages.map((message) => {
    ({ date, name, socketId, storedId, text } = JSON.parse(message))
    return { date, name, socketId, storedId, text }
  })
  return res.status(200).json(messages)
})

let membersOfChannels = []

io.on('connection', async (socket) => {
  const storedId = await bcrypt.hash(socket.handshake.query.storedId, 2)

  function checkIfExists(channel, { edited }) {
    if (!channel) return
    channel = channel.substring(0, 12).trim()
    const filtered = membersOfChannels.filter(({ channelName }) => channelName === channel)
    const checked = filtered.map(({ memberStoredId }) => {
      return bcrypt.compareSync(socket.handshake.query.storedId, memberStoredId)
    })
    if (checked.includes(true)) {
      socket.emit(!edited ? 'is_duplicate' : 'is_edited_duplicate', { channel, isDuplicate: true })
    }
    else {
      socket.emit(!edited ? 'is_duplicate' : 'is_edited_duplicate', { channel, isDuplicate: false })
    }
  }

  socket.on('check_if_exists', (channel) => {
    checkIfExists(channel, { edited: false })
  })
  socket.on('check_if_edited_exists', (channel) => {
    checkIfExists(channel, { edited: true })
  })
  socket.on('join_channel', ({ channel, name }) => {
    if (!channel) return
    if (!name) return
    channel = channel.substring(0, 12).trim()
    name = name.substring(0, 24).trim()
    socket.channel = channel
    socket.join(channel)
    socket.emit('receive_previous_messages', channel)
    membersOfChannels.push({ channelName: channel, memberName: name, memberSocketId: socket.id, memberStoredId: storedId })
    io.to(channel).emit('receive_channel_members', membersOfChannels.filter(({ channelName }) => channelName === channel))
  })
  socket.on('change_name', ({ channel, name }) => {
    if (!channel) return
    if (!name) return
    channel = channel.substring(0, 12).trim()
    name = name.substring(0, 24).trim()
    membersOfChannels = membersOfChannels.map((memberOfChannel) => {
      if (memberOfChannel.memberSocketId === socket.id) {
        return { ...memberOfChannel, memberName: name }
      }
      return memberOfChannel
    })
    io.to(channel).emit('receive_channel_members', membersOfChannels.filter(({ channelName }) => channelName === channel))
  })
  socket.on('send_message', async ({ channel, name, text }) => {
    if (!channel) return
    if (!name) return
    if (!text) return
    channel = channel.substring(0, 12).trim()
    name = name.substring(0, 24).trim()
    text = text.substring(0, 2048).trim()
    const date = Math.floor(Date.now() / 1000)
    const firstTwoMessages = await redisClient.lRange(channel, 0, 0)
    redisClient.rPush(channel, JSON.stringify({ date, name, socketId: socket.id, storedId, text }))
    if (!firstTwoMessages.length) redisClient.expire(channel, 86400)
    io.to(channel).emit('receive_message', { date, name, socketId: socket.id, storedId, text })
  })
  socket.on('leave_channel', (channel) => {
    if (!channel) return
    channel = channel.substring(0, 12).trim()
    socket.leave(channel)
    membersOfChannels = membersOfChannels.filter(({ memberSocketId }) => memberSocketId !== socket.id)
    io.to(channel).emit('receive_channel_members', membersOfChannels.filter(({ channelName }) => channelName === channel))
  })
  socket.on('disconnecting', () => {
    let channel = socket.channel
    membersOfChannels = membersOfChannels.filter(({ memberSocketId }) => memberSocketId !== socket.id)
    io.to(channel).emit('receive_channel_members', membersOfChannels.filter(({ channelName }) => channelName === channel))
  })
})

http.listen(port, () => {
  console.log(`App is now running on port ${port}`)
})
