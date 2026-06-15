const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

// Supabase client with service role (bypass RLS for user management)
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Your bot token from @BotFather (add this to Netlify env vars!)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const { initData } = JSON.parse(event.body)

    if (!initData) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing initData' }) }
    }

    // Verify Telegram initData
    const isValid = validateTelegramData(initData, BOT_TOKEN)
    if (!isValid) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Invalid Telegram data' }) }
    }

    // Extract user from initData
    const params = new URLSearchParams(initData)
    const userStr = params.get('user')
    if (!userStr) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No user in initData' }) }
    }
    const tgUser = JSON.parse(userStr)

    // Find or create user in Supabase (using admin privileges)
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
      // Ensure admin flag is correct
      if (tgUser.id === 6657645905 && !dbUser.is_admin) {
        await supabaseAdmin
          .from('users')
          .update({ is_admin: true })
          .eq('telegram_id', tgUser.id)
        dbUser.is_admin = true
      }
    }

    // Generate Supabase JWT with user's Telegram ID in claims
    const jwt = generateSupabaseJWT(dbUser.telegram_id, dbUser.id)

    return {
      statusCode: 200,
      body: JSON.stringify({
        token: jwt,
        user: dbUser
      })
    }
  } catch (error) {
    console.error('Auth error:', error)
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
  }
}

// Verify Telegram initData using HMAC-SHA256
function validateTelegramData(initData, botToken) {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  params.delete('hash')

  // Sort keys alphabetically
  const dataCheckArr = []
  for (const [key, value] of params.entries()) {
    dataCheckArr.push(`${key}=${value}`)
  }
  dataCheckArr.sort()
  const dataCheckString = dataCheckArr.join('\n')

  // Create secret key from bot token
  const secretKey = crypto.createHash('sha256').update(botToken).digest()

  // Compute HMAC
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  return hmac === hash
}

// Generate a simple Supabase-compatible JWT (RS256 would require private key; we'll use HS256 for simplicity)
function generateSupabaseJWT(telegramId, userId) {
  // We'll use the anon key as the secret for HS256 – not ideal for production, but sufficient for this use case.
  // For production, generate an RS256 key pair in Supabase.
  const jwtSecret = process.env.SUPABASE_JWT_SECRET || process.env.VITE_SUPABASE_ANON_KEY

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }

  const payload = {
    sub: userId,
    telegram_id: telegramId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  }

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url')
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url')

  return `${base64Header}.${base64Payload}.${signature}`
}
