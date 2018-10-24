import dotenv from 'dotenv'
import SubX from 'subx'
import RingCentral from 'ringcentral-js-concise'
import fs from 'fs'
import path from 'path'
import { debounceTime } from 'rxjs/operators'
import * as R from 'ramda'

import database from '../database.json'

dotenv.config()

// Store
const Store = new SubX({
  bots: {},
  users: {},
  mappings: {}, // from userId to groupId, means the user want to monitor voicemail in that group.
  getBot (id) {
    return this.bots[id]
  },
  getUser (id) {
    return this.users[id]
  },
  addBot (bot) {
    this.bots[bot.token.owner_id] = bot
  },
  addUser (user) {
    this.users[user.token.owner_id] = user
  }
})

// Bot
export const Bot = new SubX({
  get rc () {
    const rc = new RingCentral(
      process.env.RINGCENTRAL_BOT_CLIENT_ID,
      process.env.RINGCENTRAL_BOT_CLIENT_SECRET,
      process.env.RINGCENTRAL_SERVER
    )
    rc.token(this.token)
    return rc
  },
  async authorize (code) {
    try {
      await this.rc.authorize({ code, redirectUri: process.env.RINGCENTRAL_BOT_SERVER + '/bot-oauth' })
    } catch (e) {
      console.log(e.response.data)
      throw e
    }
    this.token = this.rc.token()
  },
  async setupWebHook () {
    try {
      await this.rc.post('/restapi/v1.0/subscription', {
        eventFilters: [
          '/restapi/v1.0/glip/posts',
          '/restapi/v1.0/glip/groups'
        ],
        deliveryMode: {
          transportType: 'WebHook',
          address: process.env.RINGCENTRAL_BOT_SERVER + '/bot-webhook'
        }
      })
    } catch (e) {
      console.log(e.response.data)
      throw e
    }
  },
  async clearWebHooks () {
    const r = await this.rc.get('/restapi/v1.0/subscription')
    r.data.records.forEach(async sub => {
      await this.rc.delete(`/restapi/v1.0/subscription/${sub.id}`)
    })
  },
  async sendMessage (groupId, messageObj) {
    await this.rc.post(`/restapi/v1.0/glip/groups/${groupId}/posts`, messageObj)
  },
  async validate () {
    try {
      await this.rc.get('/restapi/v1.0/account/~/extension/~')
      return true
    } catch (e) {
      const errorCode = e.response.data.errorCode
      if (errorCode === 'OAU-232' || errorCode === 'CMN-405') {
        delete store.bots[this.token.owner_id]
        console.log(`Bot user ${this.token.owner_id} has been deleted`)
        return false
      }
      console.log(e.response.data)
      throw e
    }
  }
})

// User
export const User = new SubX({
  get rc () {
    const rc = new RingCentral(
      process.env.RINGCENTRAL_USER_CLIENT_ID,
      process.env.RINGCENTRAL_USER_CLIENT_SECRET,
      process.env.RINGCENTRAL_SERVER
    )
    rc.token(this.token)
    return rc
  },
  authorizeUri (groupId, botId) {
    return this.rc.authorizeUri(process.env.RINGCENTRAL_BOT_SERVER + '/user-oauth', {
      state: groupId + ':' + botId,
      responseType: 'code'
    })
  },
  async authorize (code) {
    try {
      await this.rc.authorize({ code, redirectUri: process.env.RINGCENTRAL_BOT_SERVER + '/user-oauth' })
    } catch (e) {
      console.log(e.response.data)
      throw e
    }
    this.token = this.rc.token()
  },
  async validate () {
    try {
      await this.rc.get('/restapi/v1.0/account/~/extension/~')
      return true
    } catch (e) {
      console.log(e.response.data)
      throw e
    }
  }
})

// load data from database
const store = new Store(database)
;(async () => {
  // init bots
  for (const k of R.keys(store.bots)) {
    const bot = new Bot(store.bots[k])
    if (await bot.validate()) {
      store.bots[k] = bot
      await bot.clearWebHooks()
      await bot.setupWebHook()
    }
  }

  // init users
  for (const k of R.keys(store.users)) {
    const user = new User(store.users[k])
    if (await user.validate()) {
      store.users[k] = user
    }
  }

  // auto save to database
  SubX.autoRun(store, () => {
    fs.writeFileSync(path.join(__dirname, '../database.json'), JSON.stringify(store, null, 2))
  }, debounceTime(1000))
})()

export default store
