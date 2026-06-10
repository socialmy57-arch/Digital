const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

exports.handler = async (event) => {
  if (event.headers['x-api-key'] !== process.env.SMS_WEBHOOK_API_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { sender, content, timestamp } = body

    // Enhanced SMS parsing - multiple patterns
    const patterns = [
      /(?:Ref|TXN|FT|Transaction|Reference)[:\s]*([A-Z0-9]{6,})/i,
      /(?:ID|No)[:\s]*([A-Z0-9]{6,})/i,
      /([A-Z]{2,3}\d{6,})/i
    ]
    
    let transactionId = null
    for (const pattern of patterns) {
      const match = content.match(pattern)
      if (match) {
        transactionId = match[1] || match[0]
        break
      }
    }

    const amountPatterns = [
      /(?:ETB|Br|Birr)\s*(\d+(?:\.\d{2})?)/i,
      /(\d+(?:\.\d{2})?)\s*(?:ETB|Br|Birr)/i,
      /(?:amount|amt)[:\s]*(\d+(?:\.\d{2})?)/i
    ]
    
    let amount = null
    for (const pattern of amountPatterns) {
      const match = content.match(pattern)
      if (match) {
        amount = parseFloat(match[1])
        break
      }
    }

    // Check for duplicate
    if (transactionId) {
      const { data: existing } = await supabase
        .from('sms_logs')
        .select('id')
        .eq('transaction_id', transactionId)
        .single()
      
      if (existing) {
        return { statusCode: 200, body: JSON.stringify({ message: 'Duplicate SMS' }) }
      }
    }

    // Store SMS
    const { data: smsLog, error } = await supabase
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

    if (error) throw error

    // Auto-link to transaction
    if (transactionId) {
      const { data: transaction } = await supabase
        .from('transactions')
        .select('id')
        .eq('payment_reference', transactionId)
        .eq('status', 'pending')
        .single()

      if (transaction) {
        await supabase
          .from('transactions')
          .update({ 
            status: 'completed', 
            sms_log_id: smsLog.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', transaction.id)

        await supabase
          .from('selected_numbers')
          .update({ status: 'paid' })
          .eq('transaction_id', transaction.id)

        // Update SMS as processed
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
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) }
  }
}
