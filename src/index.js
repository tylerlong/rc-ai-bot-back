import express from 'express'
import bodyParser from 'body-parser'

import bot from './handlers/bot'
import user from './handlers/user'
import database from './database'
import Bot from './models/Bot'
import User from './models/User'

// init
(async () => {
  const json = await database.read()
  // init bots
  if (json.bots) {
    for (const k of Object.keys(json.bots)) {
      const bot = new Bot(json.bots[k])
      if (await bot.validate()) {
        await bot.clearWebHooks()
        await bot.setupWebHook()
      }
    }
  }
  // init users
  if (json.users) {
    for (const k of Object.keys(json.users)) {
      const user = new User(json.users[k])
      if (await user.validate()) {
        await user.clearWebHooks()
        if (Object.keys(user.groups).length > 0) {
          await user.setupWebHook()
        }
      }
    }
  }
})()

const app = express()
app.use(bodyParser.json())

bot.handle(app)
user.handle(app)

app.listen(3000)
