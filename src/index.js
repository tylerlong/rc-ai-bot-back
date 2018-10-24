import dotenv from 'dotenv'
import express from 'express'
import bodyParser from 'body-parser'
import store, { Bot, User, Subscription } from './store'

dotenv.config()

const app = express()
app.use(bodyParser.json())

// add bot to Glip
app.get('/bot-oauth', async (req, res) => {
  const bot = new Bot()
  await bot.authorize(req.query.code)
  store.addBot(bot)
  await bot.setupWebHook()
  res.send('Bot added')
})

// user authorize bot
app.get('/user-oauth', async (req, res) => {
  const user = new User()
  await user.authorize(req.query.code)
  store.addUser(user)
  const [groupId, botId] = req.query.state.split(':')
  const bot = store.getBot(botId)
  await bot.sendMessage(groupId, { text: `![:Person](${user.token.owerner_id}), You have successfully authorized me to access your RingCentral data! Please reply "![:Person](${botId}) monitor" if you want me to monitor your voicemail.` })
  res.send('You have authorized the bot to access your RingCentral data! Please close this page and get back to Glip.')
})

// bot receive message from Glip
app.post('/bot-webhook', async (req, res) => {
  const message = req.body
  console.log('Message received via bot WebHook:', message)
  const botId = message.ownerId
  const body = message.body
  if (body) {
    switch (body.eventType) {
      case 'GroupJoined':
        if (body.type === 'PrivateChat') {
          const bot = store.getBot(botId)
          await bot.sendMessage(body.id, { text: `Hello, I am a chatbot. Please mention me if you want to talk to me.` })
        }
        break
      case 'PostAdded':
        if (body.creatorId === botId || body.text.indexOf(`![:Person](${botId})`) === -1) {
          break
        }
        const bot = store.getBot(botId)
        if (/\bmonitor\b/i.test(body.text)) { // monitor voicemail
          const user = store.getUser(body.creatorId)
          if (user) {
            if (!store.subscriptions[body.creatorId]) {
              const subscription = new Subscription({ userId: body.creatorId, groups: { [body.groupId]: true } })

              await subscription.setupWebHook()

              store.addSubscription(body.creatorId, subscription)
            } else {
              store.subscriptions[body.creatorId].groups[body.groupId] = true
            }
            await bot.sendMessage(body.groupId, { text: `![:Person](${body.creatorId}), now your voicemail is monitored!` })
          } else {
            const user = new User()
            const authorizeUri = user.authorizeUri(body.groupId, botId)
            await bot.sendMessage(body.groupId, {
              text: `![:Person](${body.creatorId}), [click here](${authorizeUri}) to authorize me to access your RingCentral data first.`
            })
          }
        } else {
          await bot.sendMessage(body.groupId, {
            text: `If you want me to monitor your voicemail, please reply "![:Person](${botId}) monitor"`
          })
        }
        break
      default:
        break
    }
  }
  res.header('validation-token', req.header('validation-token'))
  res.send('/bot-webhook replied')
})

// user receive message from Platform
app.post('/user-webhook', async (req, res) => {
  const message = req.body
  console.log('Message received via user WebHook:', message)
  res.header('validation-token', req.header('validation-token'))
  res.send('/user-webhook replied')
})

app.listen(3000)
