import dotenv from "dotenv"
dotenv.config()

import express from "express"
import cors from "cors"
//app.use(cors())
import { createClient } from "@supabase/supabase-js"
import { Bot } from "grammy"

console.log("STARTING SERVER...")

import crypto from "crypto"

// --- EXPRESS ---
const app = express()
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

app.get('/', (req, res) => {
  res.send('CRM работает 🚀')
})

app.get('/users', async (req, res) => {
  const { data, error } = await supabase.from('users').select('*')
  res.json({ data, error })
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log("Server running on port " + PORT)
})

// endpoint на beckend
app.post("/auth", async (req, res) => {
  const { initData } = req.body

  try {
    const params = new URLSearchParams(initData)
    const hash = params.get("hash")
    params.delete("hash")

    const dataCheckString = [...params.entries()]
      .sort()
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")

    const secret = crypto
      .createHash("sha256")
      .update(process.env.BOT_TOKEN)
      .digest()

    const hmac = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex")

    if (hmac !== hash) {
      return res.status(403).json({ error: "Invalid auth" })
    }

    const user = JSON.parse(params.get("user"))
    console.log("AUTH USER:", user)

    res.json({
      telegram_id: user.id.toString(),
      name: user.first_name
    })
  } catch (e) {
    console.log(e)
    res.status(500).json({ error: "Auth failed" })
  }
})

// --- TELEGRAM BOT ---
const bot = new Bot(process.env.BOT_TOKEN)

const userStates = {}

bot.command("start", async (ctx) => {
  const telegramId = ctx.from.id.toString()
  const name = ctx.from.first_name

  await supabase
    .from("users")
    .upsert(
      [
        {
          telegram_id: telegramId,
          name: name
        }
      ],
      { onConflict: "telegram_id" }
    )

  ctx.reply("Добро пожаловать в CRM 🚀", {
    reply_markup: {
      keyboard: [
        [
          {
            text: "🚀 Открыть CRM",
            web_app: {
              url: "https://mini-crm-app-sigma.vercel.app/"
            }
          }
        ],
        ["➕ Добавить клиента"],
        ["➕ Добавить проект"],
        ["📊 Мои клиенты"],
        ["📁 Мои проекты"]
      ],
      resize_keyboard: true
    }
  })
})

// ➕ Добавить клиента
bot.hears(/Добавить клиента/, (ctx) => {
  userStates[ctx.from.id] = "waiting_client_name"
  ctx.reply("Введи имя клиента:")
})

// + Добавить проект
bot.hears("➕ Добавить проект", (ctx) => {
  userStates[ctx.from.id] = { step: "client_name" }
  ctx.reply("Введи имя клиента:")
})

// 📊 Мои клиенты
bot.hears(/Мои клиенты/, async (ctx) => {
  console.log("Кнопка 'Мои клиенты' нажата")

  const telegram_id = ctx.from.id.toString()

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("telegram_id", telegram_id)

  if (error) {
    console.log(error)
    return ctx.reply("Ошибка 😢")
  }

  if (!data || data.length === 0) {
    return ctx.reply("У тебя пока нет клиентов 🤷‍♂️")
  }

  let message = "Твои клиенты:\n\n"

  data.forEach((client, index) => {
    message += `${index + 1}. ${client.name}\n`
  })

  ctx.reply(message)
})

// Мои проекты
bot.hears("📁 Мои проекты", async (ctx) => {
  const telegram_id = ctx.from.id.toString()

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("telegram_id", telegram_id)

  if (error) {
    console.log(error)
    return ctx.reply("Ошибка 😢")
  }

  if (!data || data.length === 0) {
    return ctx.reply("У тебя пока нет проектов 🤷‍♂️")
  }

  let message = "📁 Твои проекты:\n\n"

  data.forEach((p, i) => {
    message +=
`#${i + 1}
👤 Клиент: ${p.client_name}
📌 Проект: ${p.title}
💰 Бюджет: ${p.budget}
📅 Дедлайн: ${p.deadline}
📊 Статус: ${p.status}

`
  })

  ctx.reply(message)
})

// обработка ввода текста (для добавления клиента)
bot.on("message:text", async (ctx) => {
  const telegram_id = ctx.from.id.toString()
  const state = userStates[telegram_id]

  if (!state) return

  // 1. клиент
  if (state.step === "client_name") {
    state.client_name = ctx.message.text
    state.step = "title"

    return ctx.reply("Название проекта?")
  }

  // 2. название
  if (state.step === "title") {
    state.title = ctx.message.text
    state.step = "budget"

    return ctx.reply("Бюджет?")
  }

  // 3. бюджет
  if (state.step === "budget") {
    state.budget = parseInt(ctx.message.text)
    state.step = "deadline"

    return ctx.reply("Дедлайн? (2026-05-01)")
  }

  // 4. дедлайн → сохраняем
  if (state.step === "deadline") {
    state.deadline = ctx.message.text

   const { error } = await supabase.from("projects").insert([
    {
    telegram_id: telegram_id.toString(),
    client_name: state.client_name,
    title: state.title,
    budget: Number(state.budget),
    deadline: state.deadline,
    status: "active"
    }
    ])

  userStates[telegram_id] = null

  if (error) {
  console.log(error)
  return ctx.reply("Ошибка при сохранении проекта 😢")
  }

  return ctx.reply("Проект добавлен 🚀")
  }
  })

bot.start()