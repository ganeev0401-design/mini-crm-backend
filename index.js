import dotenv from "dotenv"
dotenv.config()

import express from "express"
import cors from "cors"
import { createClient } from "@supabase/supabase-js"
import { Bot } from "grammy"
import crypto from "crypto"

console.log("STARTING SERVER...")

// --- EXPRESS ---
const app = express()
app.use(express.json())
app.use(cors({
  origin: "https://mini-crm-app-sigma.vercel.app"
}))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const bot = new Bot(process.env.BOT_TOKEN)
const userStates = {}

// -------------------- AUTH --------------------
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

    res.json({
      telegram_id: user.id.toString(),
      name: user.first_name
    })
  } catch (e) {
    console.log(e)
    res.status(500).json({ error: "Auth failed" })
  }
})

// -------------------- DEADLINES --------------------
async function checkDeadlines() {
  const { data: projects } = await supabase
    .from("projects")
    .select("*")

  const now = new Date()

  if (!projects) return

  for (const p of projects) {
    if (p.paid) continue

    const deadline = new Date(p.deadline)

    // ❌ ПРОСРОЧКА
    if (deadline < now) {
    const last = p.last_notified_at ? new Date(p.last_notified_at) : null

    const diffHours = last
      ? (now - last) / (1000 * 60 * 60)
      : 999

    // если не уведомляли или прошло больше 24 часов
   try {
    await bot.api.sendMessage(
      p.telegram_id,
      `⚠️ ПРОСРОЧКА\n\nПроект: ${p.title}\nКлиент: ${p.client_name}\nСумма: ${p.budget}₽`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "💸 Оплачен", callback_data: `paid_${p.id}` }],
            [{ text: "📨 Написать клиенту", callback_data: `write_${p.id}` }],
            [{ text: "⏰ +3 дня", callback_data: `shift_${p.id}` }]
          ]
        }
      }
    )

    // обновляем только если отправка успешна
    await supabase
      .from("projects")
      .update({ last_notified_at: new Date() })
      .eq("id", p.id)

  } catch (err) {
    console.log("Ошибка отправки:", p.telegram_id, err.message)
  }
}

    // 📅 дедлайн скоро
    const diff = (deadline - now) / (1000 * 60 * 60 * 24)

      if (diff > 0 && diff < 1) {
        const last = p.last_notified_at ? new Date(p.last_notified_at) : null

        const diffHours = last
          ? (now - last) / (1000 * 60 * 60)
          : 999

        if (!last || diffHours > 24) {
          try {
            await bot.api.sendMessage(
        p.telegram_id,
        `📅 ДЕДЛАЙН СКОРО\n\nПроект: ${p.title}\nОсталось < 24 часов`
      )

      await supabase
        .from("projects")
        .update({ last_notified_at: new Date() })
        .eq("id", p.id)

    } catch (err) {
      console.log("Ошибка дедлайна:", err.message)
    }
  }
}

  }
}

setInterval(checkDeadlines, 60 * 1000)

// -------------------- EXPRESS ROUTES --------------------
app.get("/", (req, res) => {
  res.send("CRM работает 🚀")
})

app.get("/users", async (req, res) => {
  const { data, error } = await supabase.from("users").select("*")
  res.json({ data, error })
})

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log("Server running on port " + PORT)
})

// -------------------- BOT --------------------
bot.command("start", async (ctx) => {
  const telegram_id = ctx.from.id.toString()
  const name = ctx.from.first_name

  await supabase.from("users").upsert(
    [{ telegram_id, name }],
    { onConflict: "telegram_id" }
  )

  ctx.reply("Добро пожаловать в CRM 🚀", {
    reply_markup: {
      keyboard: [
        [{ text: "🚀 Открыть CRM", web_app: { url: "https://mini-crm-app-sigma.vercel.app/" } }],
        ["➕ Добавить клиента"],
        ["➕ Добавить проект"],
        ["📊 Мои клиенты"],
        ["📁 Мои проекты"],
        ["🔥 Приоритет"]
      ],
      resize_keyboard: true
    }
  })
})

// -------------------- CLIENTS --------------------
bot.hears(/Мои клиенты/, async (ctx) => {
  const telegram_id = ctx.from.id.toString()

  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("telegram_id", telegram_id)

  if (!data?.length) {
    return ctx.reply("У тебя пока нет клиентов 🤷‍♂️")
  }

  let msg = "Твои клиенты:\n\n"
  data.forEach((c, i) => {
    msg += `${i + 1}. ${c.name}\n`
  })

  ctx.reply(msg)
})

// -------------------- PROJECTS --------------------
bot.hears(/Мои деньги|💰 Мои деньги/, async (ctx) => {
  const telegram_id = ctx.from.id.toString()

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("telegram_id", telegram_id)

  if (!projects || projects.length === 0) {
    return ctx.reply("Пока нет данных 📭")
  }

  let total = 0
  let paid = 0
  let unpaid = 0

  for (const p of projects) {
    total += Number(p.budget || 0)

    if (p.paid) {
      paid += Number(p.budget || 0)
    } else {
      unpaid += Number(p.budget || 0)
    }
  }

  ctx.reply(
`💰 Финансы:

📊 Всего проектов: ${projects.length}
💸 Всего денег: ${total}₽
✅ Получено: ${paid}₽
⚠️ В ожидании: ${unpaid}₽`
  )
})


bot.hears("📁 Мои проекты", async (ctx) => {
  const telegram_id = ctx.from.id.toString()

  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("telegram_id", telegram_id)

  if (!data?.length) {
    return ctx.reply("У тебя пока нет проектов 🤷‍♂️")
  }

  let msg = "📁 Твои проекты:\n\n"

  data.forEach((p, i) => {
    msg += `#${i + 1}
👤 ${p.client_name}
📌 ${p.title}
💰 ${p.budget}
📅 ${p.deadline}
\n`
  })

  ctx.reply(msg)
})

bot.hears("🔥 Приоритет", async (ctx) => {
  const telegram_id = ctx.from.id.toString()

  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .eq("telegram_id", telegram_id)

  if (error || !projects) {
    return ctx.reply("Ошибка 😢")
  }

  if (projects.length === 0) {
    return ctx.reply("Нет проектов 🤷‍♂️")
  }

  const now = new Date()

  const scored = projects.map(p => {
    const deadline = new Date(p.deadline)
    const diffDays = Math.floor((now - deadline) / (1000 * 60 * 60 * 24))

    let score = 0

    if (diffDays > 0) {
      score += 100 + diffDays // просрочка
    }

    score += Number(p.budget) / 1000 // вес денег

    return { ...p, score, diffDays }
  })

  // сортировка по важности
  scored.sort((a, b) => b.score - a.score)

  let message = "🔥 ТОП приоритетов:\n\n"

  scored.slice(0, 5).forEach((p, i) => {
    message +=
`#${i + 1}
👤 ${p.client_name}
📌 ${p.title}
💰 ${p.budget}₽
📅 ${p.deadline}
⚠️ ${p.diffDays > 0 ? "Просрочен " + p.diffDays + " дн." : "Ок"}

`
  })

  ctx.reply(message)
})

// -------------------- CREATE PROJECT FLOW --------------------
bot.hears("➕ Добавить проект", (ctx) => {
  userStates[ctx.from.id] = { step: "client_name" }
  ctx.reply("Введи имя клиента:")
})

bot.on("message:text", async (ctx) => {
  const telegram_id = ctx.from.id.toString()
  const state = userStates[ctx.from.id]

  if (!state) return

  if (state.step === "client_name") {
    state.client_name = ctx.message.text
    state.step = "title"
    return ctx.reply("Название проекта?")
  }

  if (state.step === "title") {
    state.title = ctx.message.text
    state.step = "budget"
    return ctx.reply("Бюджет?")
  }

  if (state.step === "budget") {
    state.budget = Number(ctx.message.text)
    state.step = "phone"

    return ctx.reply("Телефон клиента? (например 79991234567)")
  }
  if (state.step === "phone") {
    state.client_phone = ctx.message.text
    state.step = "deadline"

    return ctx.reply("Дедлайн?")
  }



  if (state.step === "deadline") {
    state.deadline = ctx.message.text

    const { error } = await supabase.from("projects").insert([
      {
        telegram_id,
        client_name: state.client_name,
        client_phone: state.client_phone,
        title: state.title,
        budget: state.budget,
        deadline: state.deadline,
        status: "active"
      }
    ])

    userStates[ctx.from.id] = null

    if (error) {
      console.log(error)
      return ctx.reply("Ошибка при сохранении проекта 😢")
    }

    return ctx.reply("Проект добавлен 🚀")
  }
})

// -------------------- CALLBACKS --------------------
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data

  if (data.startsWith("paid_")) {
    const id = data.split("_")[1]

    await supabase
      .from("projects")
      .update({ paid: true })
      .eq("id", id)

    return ctx.answerCallbackQuery("Оплачено 💸")
  }

  if (data.startsWith("shift_")) {
    const id = data.split("_")[1]

    const newDate = new Date()
    newDate.setDate(newDate.getDate() + 3)

    await supabase
      .from("projects")
      .update({ deadline: newDate.toISOString().split("T")[0] })
      .eq("id", id)

    return ctx.answerCallbackQuery("Перенесено ⏰")
  }

    if (data.startsWith("write_")) {
    const id = data.split("_")[1]

    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single()

    if (!project) {
      return ctx.reply("Проект не найден 😢")
    }

    const message = 
    `Привет!

    Напоминаю про оплату проекта "${project.title}" 🙂

    💰 Сумма: ${project.budget}₽
    📅 Дедлайн был: ${project.deadline}

    Буду благодарен за оплату 🙌`

    const phone = project.client_phone

    if (!phone) {
      return ctx.reply("У клиента нет телефона 😢")
    }

    const text = encodeURIComponent(
    `Привет!

    Напоминаю про оплату проекта "${project.title}" 🙂

    💰 Сумма: ${project.budget}₽
    📅 Дедлайн был: ${project.deadline}

    Буду благодарен за оплату 🙌`
    )

    const link = `https://t.me/+${phone}?text=${text}`

    return ctx.reply("📨 Написать клиенту:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Открыть чат", url: link }]
        ]
      }
    })

  }
})

// --------------------
bot.start()