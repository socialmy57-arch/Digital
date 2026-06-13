const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

exports.handler = async (event) => {
  // Temporary debug: log all headers and return them
  console.log('Incoming headers:', JSON.stringify(event.headers));
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Debug: headers received',
      headers: event.headers,
      apiKeyReceived: event.headers['x-api-key'] || 'MISSING',
      expectedKey: process.env.SMS_WEBHOOK_API_KEY ? 'EXISTS' : 'MISSING'
    })
  };
};
