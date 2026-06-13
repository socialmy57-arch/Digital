const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

exports.handler = async (event) => {
  // Security: only allow requests with the correct API key
  if (event.headers['x-api-key'] !== process.env.SMS_WEBHOOK_API_KEY) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { sender, content, timestamp } = body

    // Extract transaction reference (multiple patterns)
    const transMatch = content.match(/(?:Ref|TXN|FT)[:\s]*([A-Z0-9]+)/i)
    const amountMatch = content.match(/(?:ETB|Br)\s*(\d+(?:\.\d{2})?)/i)

    const transactionId = transMatch ? transMatch[1] : null
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null

    // Save SMS to logs
    const { data: smsLog, error: insertError } = await supabase
      .from('sms_logs')
      .insert({
        sender,
        content,
        transaction_id: transactionId,
        amount,
        sms_date: timestamp || new Date().toISOString(),
        raw_json: { sender, content, timestamp }
      })
      .select()
      .single()

    if (insertError) {
      // Duplicate transaction ID → ignore
      if (insertError.code === '23505') {
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'Duplicate SMS ignored' })
        }
      }
      throw insertError
    }

    // Auto-link to pending transaction
    if (transactionId) {
      const { data: transaction } = await supabase
        .from('transactions')
        .select('id')
        .eq('payment_reference', transactionId)
        .eq('status', 'pending')
        .single()

      if (transaction) {
        // Mark transaction as completed
        await supabase
          .from('transactions')
          .update({
            status: 'completed',
            sms_log_id: smsLog.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', transaction.id)

        // Mark numbers as paid
        await supabase
          .from('selected_numbers')
          .update({ status: 'paid' })
          .eq('transaction_id', transaction.id)

        // Mark SMS as processed
        await supabase
          .from('sms_logs')
          .update({
            processed: true,
            linked_transaction_id: transaction.id
          })
          .eq('id', smsLog.id)
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        smsId: smsLog.id,
        transactionId,
        amount,
        autoLinked: !!transactionId
      })
    }
  } catch (error) {
    console.error('SMS Webhook Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    }
  }
}
