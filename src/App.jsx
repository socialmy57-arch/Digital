import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState('home')

  useEffect(() => {
    initApp()
  }, [])

  const initApp = async () => {
    try {
      // Try to get Telegram user
      let tgUser = null
      
      // Check if running inside Telegram
      if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp
        tg.ready()
        tg.expand()
        
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
          tgUser = tg.initDataUnsafe.user
        }
      }

      // If no Telegram user, use test user for debugging
      if (!tgUser) {
        console.log('No Telegram user found, using test user')
        tgUser = {
          id: 6657645905,
          first_name: 'Admin',
          username: 'admin'
        }
      }

      console.log('User detected:', tgUser)

      // Check if user exists in database
      let { data: dbUser } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', tgUser.id)
        .single()

      // Create user if not exists
      if (!dbUser) {
        const { data: newUser } = await supabase
          .from('users')
          .insert({
            telegram_id: tgUser.id,
            first_name: tgUser.first_name,
            username: tgUser.username || '',
            is_admin: tgUser.id === 6657645905
          })
          .select()
          .single()
        dbUser = newUser
      }

      setUser(dbUser)
    } catch (error) {
      console.error('Init error:', error)
      // Set a default user so app works
      setUser({
        id: 'default',
        telegram_id: 6657645905,
        first_name: 'User',
        is_admin: true
      })
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', marginTop: '50%', color: 'white' }}>
        <h2>🎲 Loading...</h2>
        <p>Please wait...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ textAlign: 'center', marginTop: '50%', color: 'white', padding: '20px' }}>
        <h2>🎲 Barsanaol Lottery</h2>
        <p>Unable to load user data.</p>
        <p>Please make sure you opened this from Telegram mobile app.</p>
      </div>
    )
  }

  const isAdmin = user.telegram_id === 6657645905 || user.is_admin

  return (
    <div className="app">
      {currentPage === 'home' && (
        <HomePage 
          user={user} 
          isAdmin={isAdmin}
          onNavigate={(page) => setCurrentPage(page)}
        />
      )}
      {currentPage === 'dashboard' && (
        <Dashboard 
          user={user}
          onBack={() => setCurrentPage('home')}
        />
      )}
      {currentPage === 'admin' && isAdmin && (
        <AdminPanel 
          user={user}
          onBack={() => setCurrentPage('home')}
        />
      )}
    </div>
  )
}

// HOME PAGE
function HomePage({ user, isAdmin, onNavigate }) {
  const [activeRound, setActiveRound] = useState(null)
  const [selectedNumbers, setSelectedNumbers] = useState([])
  const [soldNumbers, setSoldNumbers] = useState([])
  const [showPayment, setShowPayment] = useState(false)
  const [transactionRef, setTransactionRef] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const { data: round } = await supabase
        .from('lottery_rounds')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (round) {
        setActiveRound(round)
        const { data: numbers } = await supabase
          .from('selected_numbers')
          .select('number')
          .eq('round_id', round.id)
          .in('status', ['reserved', 'paid', 'confirmed'])
        setSoldNumbers((numbers || []).map(n => n.number))
      }
    } catch (error) {
      console.error('Load error:', error)
    }
  }

  const handleNumberClick = (number) => {
    if (soldNumbers.includes(number)) return
    
    setSelectedNumbers(prev => {
      if (prev.includes(number)) {
        return prev.filter(n => n !== number)
      }
      if (prev.length >= 10) return prev
      return [...prev, number]
    })
  }

  const handleSubmit = async () => {
    if (!transactionRef) {
      alert('Please enter transaction reference number')
      return
    }

    const totalAmount = selectedNumbers.length * (activeRound?.ticket_price || 200)

    try {
      const { data: transaction } = await supabase
        .from('transactions')
        .insert({
          user_id: user.id,
          round_id: activeRound.id,
          numbers_selected: selectedNumbers,
          total_amount: totalAmount,
          payment_reference: transactionRef,
          status: 'pending'
        })
        .select()
        .single()

      if (transaction) {
        const numbersToInsert = selectedNumbers.map(num => ({
          round_id: activeRound.id,
          user_id: user.id,
          number: num,
          status: 'reserved',
          transaction_id: transaction.id
        }))

        await supabase.from('selected_numbers').insert(numbersToInsert)
        setSubmitted(true)
      }
    } catch (error) {
      alert('Error: ' + error.message)
    }
  }

  const resetForm = () => {
    setSelectedNumbers([])
    setTransactionRef('')
    setShowPayment(false)
    setSubmitted(false)
    loadData()
  }

  return (
    <div>
      <div className="header">
        <h1>🎲 Barsanaol Lottery</h1>
        <p>Welcome, {user.first_name}!</p>
        <div className="nav-buttons">
          <button onClick={() => onNavigate('dashboard')} className="nav-btn">
            📊 My Dashboard
          </button>
          {isAdmin && (
            <button onClick={() => onNavigate('admin')} className="nav-btn admin-btn">
              ⚙️ Admin
            </button>
          )}
        </div>
      </div>

      {!activeRound ? (
        <div className="card no-round">
          <h2>No Active Lottery Round</h2>
          <p>Please check back later!</p>
          {isAdmin && (
            <button onClick={() => onNavigate('admin')} className="btn-orange" style={{marginTop: '15px'}}>
              Go to Admin to Create Round
            </button>
          )}
        </div>
      ) : !submitted ? (
        <>
          <div className="card round-info">
            <h2>Round #{activeRound.round_number}</h2>
            <p>💰 {activeRound.ticket_price} ETB per number</p>
            <p>⏰ Ends: {new Date(activeRound.end_date).toLocaleDateString()}</p>
            <p>📊 {soldNumbers.length}/100 numbers sold</p>
          </div>

          {!showPayment ? (
            <>
              <div className="numbers-section">
                <h3>Select Numbers (Max 10)</h3>
                <p className="selected-count">{selectedNumbers.length} selected</p>
                
                <div className="number-legend">
                  <span><span className="dot available"></span> Available</span>
                  <span><span className="dot selected"></span> Selected</span>
                  <span><span className="dot sold"></span> Sold</span>
                </div>

                <div className="numbers-grid">
                  {Array.from({ length: 100 }, (_, i) => i + 1).map(num => {
                    const isSold = soldNumbers.includes(num)
                    const isSelected = selectedNumbers.includes(num)
                    
                    return (
                      <button
                        key={num}
                        className={`num-btn ${isSold ? 'sold' : ''} ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleNumberClick(num)}
                        disabled={isSold}
                      >
                        {num}
                      </button>
                    )
                  })}
                </div>
              </div>

              {selectedNumbers.length > 0 && (
                <div className="card selected-numbers">
                  <p>Selected: {selectedNumbers.sort((a, b) => a - b).join(', ')}</p>
                  <p>Total: {selectedNumbers.length * (activeRound?.ticket_price || 200)} ETB</p>
                  <button onClick={() => setShowPayment(true)} className="continue-btn">
                    Continue to Payment →
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="card payment-section">
              <h3>Payment Information</h3>
              
              <div className="payment-summary">
                <p>Numbers: {selectedNumbers.sort((a, b) => a - b).join(', ')}</p>
                <p>Total: <strong>{selectedNumbers.length * (activeRound?.ticket_price || 200)} ETB</strong></p>
              </div>

              <div className="bank-details">
                <h4>Pay to any account:</h4>
                <div className="bank-card">
                  <strong>🏦 Cooperative Bank of Oromia</strong>
                  <p className="account-num">1012000223249</p>
                </div>
                <div className="bank-card">
                  <strong>🏦 Bank of Abyssinia</strong>
                  <p className="account-num">165669398</p>
                </div>
                <div className="bank-card">
                  <strong>📱 Telebirr</strong>
                  <p className="account-num">0923294064</p>
                </div>
              </div>

              <div className="reference-input">
                <label>Transaction Reference Number:</label>
                <input
                  type="text"
                  placeholder="Enter reference from payment SMS"
                  value={transactionRef}
                  onChange={(e) => setTransactionRef(e.target.value)}
                />
              </div>

              <div className="payment-buttons">
                <button onClick={() => setShowPayment(false)} className="back-btn">
                  ← Back
                </button>
                <button onClick={handleSubmit} className="submit-btn">
                  ✅ I've Paid - Submit
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card success-section">
          <h2>✅ Reservation Submitted!</h2>
          <p>Numbers reserved pending verification.</p>
          <p><strong>Reference:</strong> {transactionRef}</p>
          <button onClick={resetForm} className="new-btn">
            Buy More Numbers
          </button>
        </div>
      )}
    </div>
  )
}

// DASHBOARD
function Dashboard({ user, onBack }) {
  const [transactions, setTransactions] = useState([])
  const [myNumbers, setMyNumbers] = useState([])

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    const { data: tx } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setTransactions(tx || [])

    const { data: nums } = await supabase
      .from('selected_numbers')
      .select('*, lottery_rounds(*)')
      .eq('user_id', user.id)
      .order('selected_at', { ascending: false })
    setMyNumbers(nums || [])
  }

  const stats = {
    purchases: transactions.length,
    numbers: myNumbers.length,
    totalSpent: transactions.reduce((sum, t) => sum + (t.total_amount || 0), 0)
  }

  return (
    <div>
      <div className="header">
        <button onClick={onBack} className="back-btn">← Back</button>
        <h1>My Dashboard</h1>
      </div>

      <div className="card">
        <h3>📊 My Statistics</h3>
        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-number">{stats.purchases}</div>
            <div className="stat-label">Purchases</div>
          </div>
          <div className="stat-box">
            <div className="stat-number">{stats.numbers}</div>
            <div className="stat-label">Numbers</div>
          </div>
          <div className="stat-box">
            <div className="stat-number">{stats.totalSpent}</div>
            <div className="stat-label">Total ETB</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>🎫 My Numbers</h3>
        {myNumbers.length > 0 ? (
          myNumbers.slice(0, 20).map(n => (
            <div key={n.id} className="number-item">
              <span>Round #{n.lottery_rounds?.round_number} - Number {n.number}</span>
              <span className={`badge badge-${n.status}`}>{n.status}</span>
            </div>
          ))
        ) : (
          <p>No numbers purchased yet</p>
        )}
      </div>

      <div className="card">
        <h3>💳 Transactions</h3>
        {transactions.length > 0 ? (
          transactions.map(tx => (
            <div key={tx.id} className="transaction-item">
              <div>
                <p>Numbers: {tx.numbers_selected?.join(', ')}</p>
                <p>{tx.total_amount} ETB | Ref: {tx.payment_reference}</p>
                <small>{new Date(tx.created_at).toLocaleDateString()}</small>
              </div>
              <span className={`badge badge-${tx.status}`}>{tx.status}</span>
            </div>
          ))
        ) : (
          <p>No transactions yet</p>
        )}
      </div>
    </div>
  )
}

// ADMIN PANEL
function AdminPanel({ user, onBack }) {
  const [activeTab, setActiveTab] = useState('rounds')
  const [roundNumber, setRoundNumber] = useState(1)
  const [endDate, setEndDate] = useState('')
  const [prize, setPrize] = useState('')
  const [transactions, setTransactions] = useState([])
  const [smsLogs, setSmsLogs] = useState([])
  const [winners, setWinners] = useState([])
  const [stats, setStats] = useState({})

  useEffect(() => {
    loadTabData()
  }, [activeTab])

  const loadTabData = async () => {
    if (activeTab === 'transactions') {
      const { data } = await supabase
        .from('transactions')
        .select('*, users(*)')
        .order('created_at', { ascending: false })
      setTransactions(data || [])
    }
    if (activeTab === 'sms') {
      const { data } = await supabase
        .from('sms_logs')
        .select('*')
        .order('received_at', { ascending: false })
        .limit(50)
      setSmsLogs(data || [])
    }
    if (activeTab === 'winners') {
      const { data } = await supabase
        .from('winners')
        .select('*, lottery_rounds(*), users(*)')
        .order('drawn_at', { ascending: false })
      setWinners(data || [])
    }
    if (activeTab === 'stats') {
      const [u, r, t, s, w] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('lottery_rounds').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('transactions').select('*', { count: 'exact', head: true }),
        supabase.from('sms_logs').select('*', { count: 'exact', head: true }),
        supabase.from('winners').select('*', { count: 'exact', head: true }).eq('announced', true)
      ])
      setStats({
        users: u.count || 0,
        activeRounds: r.count || 0,
        transactions: t.count || 0,
        sms: s.count || 0,
        winners: w.count || 0
      })
    }
  }

  const createRound = async () => {
    if (!endDate) { alert('Please select end date'); return }
    await supabase.from('lottery_rounds').insert({
      round_number: roundNumber,
      start_date: new Date().toISOString(),
      end_date: new Date(endDate).toISOString(),
      status: 'active',
      ticket_price: 200,
      created_by: user.telegram_id
    })
    alert('Round created!')
    setRoundNumber(prev => prev + 1)
    setEndDate('')
  }

  const drawWinner = async (roundId) => {
    const { data: numbers } = await supabase
      .from('selected_numbers')
      .select('*')
      .eq('round_id', roundId)
      .in('status', ['paid', 'confirmed'])
    if (!numbers || numbers.length === 0) { alert('No paid numbers!'); return }
    const randomPick = numbers[Math.floor(Math.random() * numbers.length)]
    await supabase.from('winners').insert({
      round_id: roundId,
      number: randomPick.number,
      user_id: randomPick.user_id,
      prize: prize || 'Prize',
      announced: false
    })
    alert(`Winner drawn: Number ${randomPick.number}!`)
    setPrize('')
    loadTabData()
  }

  const announceWinner = async (winnerId) => {
    await supabase.from('winners').update({ 
      announced: true, announced_at: new Date().toISOString()
    }).eq('id', winnerId)
    alert('Winner announced!')
    loadTabData()
  }

  const verifyPayment = async (transactionId) => {
    await supabase.from('transactions').update({ status: 'completed' }).eq('id', transactionId)
    await supabase.from('selected_numbers').update({ status: 'paid' }).eq('transaction_id', transactionId)
    loadTabData()
    alert('Payment verified!')
  }

  const exportCSV = (type) => {
    let data = type === 'transactions' ? transactions : winners
    if (!data || data.length === 0) { alert('No data'); return }
    const csv = Object.keys(data[0]).join(',') + '\n' + data.map(row => Object.values(row).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}.csv`
    a.click()
  }

  const tabs = [
    { key: 'rounds', label: '🎯 Rounds' },
    { key: 'winners', label: '🏆 Winners' },
    { key: 'transactions', label: '💳 Payments' },
    { key: 'sms', label: '📱 SMS' },
    { key: 'stats', label: '📊 Stats' }
  ]

  return (
    <div>
      <div className="header">
        <button onClick={onBack} className="back-btn">← Back</button>
        <h1>Admin Panel</h1>
      </div>

      <div className="admin-tabs">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'rounds' && (
        <div>
          <div className="card">
            <h3>Create New Round</h3>
            <div><label>Round Number</label><input type="number" value={roundNumber} onChange={(e) => setRoundNumber(parseInt(e.target.value))} /></div>
            <div><label>End Date</label><input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            <button onClick={createRound} className="btn-green">Create Round</button>
          </div>
          <div className="card">
            <h3>Draw Winner (Enter Round ID)</h3>
            <div><label>Prize</label><input type="text" value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="e.g., 10,000 ETB" /></div>
            <button onClick={() => { const id = prompt('Enter Round ID:'); if (id) drawWinner(id) }} className="btn-orange">🎲 Draw Winner</button>
          </div>
        </div>
      )}

      {activeTab === 'winners' && (
        <div>
          <h3>Winners</h3>
          {winners.map(w => (
            <div key={w.id} className="card">
              <p>Round #{w.lottery_rounds?.round_number} | Number: <strong>{w.number}</strong></p>
              <p>User: {w.users?.first_name} | Prize: {w.prize}</p>
              <span className={`badge ${w.announced ? 'badge-completed' : 'badge-pending'}`}>{w.announced ? 'Announced' : 'Pending'}</span>
              {!w.announced && <button onClick={() => announceWinner(w.id)} className="btn-orange">📢 Announce</button>}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'transactions' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3>Transactions</h3>
            <button onClick={() => exportCSV('transactions')} className="btn-small">📥 Export</button>
          </div>
          {transactions.map(tx => (
            <div key={tx.id} className="card">
              <p>User: {tx.users?.first_name || 'Unknown'} | Amount: {tx.total_amount} ETB</p>
              <p>Numbers: {tx.numbers_selected?.join(', ')} | Ref: {tx.payment_reference}</p>
              <span className={`badge badge-${tx.status}`}>{tx.status}</span>
              {tx.status === 'pending' && <button onClick={() => verifyPayment(tx.id)} className="btn-blue">✅ Verify</button>}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'sms' && (
        <div>
          <h3>SMS Logs</h3>
          {smsLogs.map(sms => (
            <div key={sms.id} className="card">
              <p><strong>From:</strong> {sms.sender}</p>
              <p className="sms-content">{sms.content}</p>
              {sms.transaction_id && <p>TX: {sms.transaction_id}</p>}
              {sms.amount && <p>Amount: {sms.amount} ETB</p>}
              <small>{new Date(sms.received_at).toLocaleString()}</small>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="stats-grid">
          {[{ label: 'Users', value: stats.users }, { label: 'Active Rounds', value: stats.activeRounds }, { label: 'Transactions', value: stats.transactions }, { label: 'SMS', value: stats.sms }, { label: 'Winners', value: stats.winners }].map(s => (
            <div key={s.label} className="card stat-card"><h2>{s.value}</h2><p>{s.label}</p></div>
          ))}
        </div>
      )}
    </div>
  )
}

export default App
