const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // Security check
  if (req.headers['x-api-key'] !== process.env.SMS_WEBHOOK_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body;
    try {
      body = JSON.parse(req.body || '{}');
    } catch (e) {
      const raw = req.body || '';
      body = {
        sender: extractValue(raw, 'sender'),
        content: extractValue(raw, 'content') || raw,
        timestamp: extractValue(raw, 'timestamp')
      };
    }

    const { sender, content, timestamp } = body;

    const transMatch = content?.match(/(?:Ref|TXN|FT)[:\s]*([A-Z0-9]+)/i);
    const amountMatch = content?.match(/(?:ETB|Br)\s*(\d+(?:\.\d{2})?)/i);
    const transactionId = transMatch ? transMatch[1] : null;
    const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

    const { data: smsLog, error: insertError } = await supabase
      .from('sms_logs')
      .insert({
        sender: sender || '',
        content: content || '',
        transaction_id: transactionId,
        amount,
        sms_date: timestamp || new Date().toISOString(),
        raw_json: body
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(200).json({ message: 'Duplicate SMS ignored' });
      }
      throw insertError;
    }

    if (transactionId) {
      const { data: transaction } = await supabase
        .from('transactions')
        .select('id')
        .eq('payment_reference', transactionId)
        .eq('status', 'pending')
        .single();

      if (transaction) {
        await supabase
          .from('transactions')
          .update({
            status: 'completed',
            sms_log_id: smsLog.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', transaction.id);

        await supabase
          .from('selected_numbers')
          .update({ status: 'paid' })
          .eq('transaction_id', transaction.id);

        await supabase
          .from('sms_logs')
          .update({
            processed: true,
            linked_transaction_id: transaction.id
          })
          .eq('id', smsLog.id);
      }
    }

    return res.status(200).json({
      success: true,
      smsId: smsLog.id,
      transactionId,
      amount,
      autoLinked: !!transactionId
    });
  } catch (error) {
    return res.status(200).json({ step: 'general', error: error.message });
  }
};

function extractValue(raw, key) {
  const patterns = [
    new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i'),
    new RegExp(`${key}\\s*=\\s*"?([^",}]+)"?`, 'i')
  ];
  for (const pat of patterns) {
    const match = raw.match(pat);
    if (match) return match[1];
  }
  return '';
}
