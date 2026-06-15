const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
  }

  try {
    const { initData } = JSON.parse(event.body || '{}')

    if (!initData) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing initData' }) }
    }

    // Validate initData and include debug info
    const validation = validateTelegramData(initData, BOT_TOKEN)
    if (!validation.isValid) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Invalid Telegram data',
          reason: validation.reason,
          hashReceived: validation.hashReceived,
          hashComputed: validation.hashComputed,
          botTokenFirstChars: BOT_TOKEN ? BOT_TOKEN.substring(0, 5) + '...' : 'MISSING'
        })
      }
    }

    const params = new URLSearchParams(initData)
    const userStr = params.get('user')
    if (!userStr) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No user in initData' }) }
    }
    const tgUser = JSON.parse(userStr)

    // Find or create user in Supabase
    let { data: dbUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('telegram_id', tgUser.id)
      .single()

    if (!dbUser) {
      const { data: newUser, error: createError } = await supabaseAdmin
        .from('users')
        .insert({
          telegram_id: tgUser.id,
          first_name: tgUser.first_name,
          last_name: tgUser.last_name || '',
          username: tgUser.username || '',
          is_admin: tgUser.id === 6657645905
        })
        .select()
        .single()

      if (createError) throw createError
      dbUser = newUser
    } else {
      if (tgUser.id === 6657645905 && !dbUser.is_admin) {
        await supabaseAdmin
          .from('users')
          .update({ is_admin: true })
          .eq('telegram_id', tgUser.id)
        dbUser.is_admin = true
      }
    }

    // Generate JWT
    const jwt = generateSupabaseJWT(dbUser.telegram_id, dbUser.id)

    return {
      statusCode: 200,
      body: JSON.stringify({ token: jwt, user: dbUser })
    }
  } catch (error) {
    return {
      statusCode: 200,
      body: JSON.stringify({ error: 'Function crashed', message: error.message })
    }
  }
}

function validateTelegramData(initData, botToken) {
  if (!botToken) {
    return { isValid: false, reason: 'Bot token is missing', hashReceived: null, hashComputed: null }
  }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) {
    return { isValid: false, reason: 'No hash in initData', hashReceived: null, hashComputed: null }
  }
  params.delete('hash')

  const dataCheckArr = []
  for (const [key, value] of params.entries()) {
    dataCheckArr.push(`${key}=${value}`)
  }
  dataCheckArr.sort()
  const dataCheckString = dataCheckArr.join('\n')

  try {
    const secretKey = crypto.createHash('sha256').update(botToken).digest()
    const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
    const isValid = hmac === hash
    return {
      isValid,
      reason: isValid ? null : 'Hash mismatch',
      hashReceived: hash ? (hash.substring(0, 10) + '...') : null,
      hashComputed: hmac ? (hmac.substring(0, 10) + '...') : null
    }
  } catch (e) {
    return { isValid: false, reason: 'Crypto error: ' + e.message, hashReceived: null, hashComputed: null }
  }
}

function generateSupabaseJWT(telegramId, userId) {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET || process.env.VITE_SUPABASE_ANON_KEY
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    sub: userId,
    telegram_id: telegramId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600
  }
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url')
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url')

  return `${base64Header}.${base64Payload}.${signature}`
}
