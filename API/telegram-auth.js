const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { initData } = req.body;
    if (!initData) {
      return res.status(400).json({ error: 'Missing initData' });
    }

    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) {
      return res.status(400).json({ error: 'No user in initData' });
    }

    const tgUser = JSON.parse(userStr);

    let { data: dbUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!dbUser) {
      const { data: newUser, error: createError } = await supabaseAdmin
        .from('users')
        .insert({
          telegram_id: tgUser.id,
          first_name: tgUser.first_name,
          last_name: tgUser.last_name || '',
          username: tgUser.username || '',
          is_admin: tgUser.id === 6657645905,
        })
        .select()
        .single();

      if (createError) throw createError;
      dbUser = newUser;
    } else {
      if (tgUser.id === 6657645905 && !dbUser.is_admin) {
        await supabaseAdmin
          .from('users')
          .update({ is_admin: true })
          .eq('telegram_id', tgUser.id);
        dbUser.is_admin = true;
      }
    }

    const jwt = 'bypass-token-' + dbUser.id;

    return res.status(200).json({ token: jwt, user: dbUser });
  } catch (error) {
    return res.status(200).json({ error: 'Function crashed', message: error.message });
  }
};
