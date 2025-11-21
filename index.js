require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get('/', (req, res) => res.send('Backend is Live!'));

// --- ROOM MANAGEMENT (NEW) ---
app.get('/rooms', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM rooms ORDER BY room_no ASC");
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/rooms', async (req, res) => {
  const { roomNo, type } = req.body;
  try {
    const result = await pool.query("INSERT INTO rooms (room_no, gender_type) VALUES ($1, $2) RETURNING *", [roomNo, type]);
    res.json(result.rows[0]);
  } catch (err) { 
    if (err.code === '23505') return res.status(409).json({ error: "Room already exists" });
    res.status(500).json({ error: err.message }); 
  }
});

app.delete('/rooms/:id', async (req, res) => {
  try {
    await pool.query("DELETE FROM rooms WHERE room_id = $1", [req.params.id]);
    res.json({ message: "Room deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- COURSES ---
app.get('/courses', async (req, res) => {
  try {
    const query = `
      SELECT c.*, 
        COUNT(CASE WHEN p.status = 'Arrived' THEN 1 END)::int as arrived,
        COUNT(CASE WHEN p.status = 'No Response' THEN 1 END)::int as pending,
        COUNT(CASE WHEN p.status = 'Cancelled' THEN 1 END)::int as cancelled
      FROM courses c
      LEFT JOIN participants p ON c.course_id = p.course_id
      GROUP BY c.course_id
      ORDER BY c.start_date DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/courses', async (req, res) => {
  try {
    const { courseName, teacherName, startDate, endDate } = req.body;
    const result = await pool.query("INSERT INTO courses (course_name, teacher_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *", [courseName, teacherName, startDate, endDate]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/courses/:id/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM expenses WHERE course_id = $1', [req.params.id]);
    await client.query('DELETE FROM participants WHERE course_id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ message: "Course reset" });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); } finally { client.release(); }
});

app.delete('/courses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE course_id = $1', [req.params.id]);
    await pool.query('DELETE FROM participants WHERE course_id = $1', [req.params.id]);
    await pool.query('DELETE FROM courses WHERE course_id = $1', [req.params.id]);
    res.json({ message: "Course deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- PARTICIPANTS ---
app.get('/courses/:id/participants', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM participants WHERE course_id = $1 ORDER BY full_name ASC", [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/participants', async (req, res) => {
  const { courseId, fullName, coursesInfo, email, age, gender, confNo } = req.body;
  try {
    const check = await pool.query("SELECT participant_id FROM participants WHERE course_id = $1 AND LOWER(full_name) = LOWER($2)", [courseId, fullName]);
    if (check.rows.length > 0) return res.status(409).json({ error: "Student already exists." });

    await pool.query(
      "INSERT INTO participants (course_id, full_name, courses_info, email, age, gender, conf_no, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'No Response')",
      [courseId, fullName, coursesInfo, email, age, gender, confNo]
    );
    res.json({ message: "Student added successfully" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/courses/:id/import', async (req, res) => {
  const { id } = req.params;
  const { students } = req.body;
  if (!students || !Array.isArray(students)) return res.status(400).json({ error: "Invalid data" });
  let added = 0, skipped = 0;
  try {
    for (const s of students) {
      const name = s.name ? s.name.trim() : "";
      if (name.length < 1) continue;
      const check = await pool.query("SELECT participant_id FROM participants WHERE course_id = $1 AND (LOWER(full_name) = LOWER($2) OR (conf_no IS NOT NULL AND conf_no = $3))", [id, name, s.confNo]);
      if (check.rows.length > 0) { skipped++; } else {
        await pool.query(
          "INSERT INTO participants (course_id, full_name, phone_number, email, status, age, gender, courses_info, conf_no) VALUES ($1, $2, $3, $4, 'No Response', $5, $6, $7, $8)", 
          [id, name, s.phone||'', s.email||'', s.age||null, s.gender||null, s.courses||null, s.confNo||null]
        );
        added++;
      }
    }
    res.json({ message: `Added: ${added}. Skipped: ${skipped}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/participants/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, phone_number, status, room_no, dining_seat_no, pagoda_cell_no, conf_no, dhamma_hall_seat_no, special_seating } = req.body;
  try {
    const clean = (val) => (val && ['na','n/a','none'].includes(val.toLowerCase())) ? null : (val || null);
    const result = await pool.query(
      "UPDATE participants SET full_name=$1, phone_number=$2, status=$3, room_no=$4, dining_seat_no=$5, pagoda_cell_no=$6, conf_no=$7, dhamma_hall_seat_no=$8, special_seating=$9 WHERE participant_id=$10 RETURNING *",
      [full_name, phone_number, status, clean(room_no), clean(dining_seat_no), clean(pagoda_cell_no), clean(conf_no), clean(dhamma_hall_seat_no), clean(special_seating), id]
    );
    res.json(result.rows[0]);
  } catch (err) { if (err.code === '23505') return res.status(409).json({ error: "Duplicate data found." }); res.status(500).json({ error: err.message }); }
});

app.delete('/participants/:id', async (req, res) => {
  try {
    await pool.query("DELETE FROM participants WHERE participant_id = $1", [req.params.id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CHECK-IN ---
app.post('/check-in', async (req, res) => {
  const { courseId, participantId, roomNo, seatNo, laundryToken, mobileLocker, valuablesLocker, language, pagodaCell, laptop, confNo, dhammaSeat, specialSeating } = req.body;
  try {
    const clean = (val) => (val && typeof val === 'string' && ['na', 'n/a', 'no', 'none', '-'].includes(val.trim().toLowerCase())) ? null : (val || null);
    const query = `
      UPDATE participants 
      SET status = 'Arrived', room_no = $1, dining_seat_no = $2, laundry_token_no = $3, 
          mobile_locker_no = $4, valuables_locker_no = $5, discourse_language = $6,
          pagoda_cell_no = $7, laptop_details = $8, conf_no = $9, dhamma_hall_seat_no = $10,
          special_seating = $11
      WHERE participant_id = $12 AND course_id = $13 RETURNING *;
    `;
    const values = [ clean(roomNo), clean(seatNo), clean(laundryToken), clean(mobileLocker), clean(valuablesLocker), language||'English', clean(pagodaCell), laptop, clean(confNo), clean(dhammaSeat), clean(specialSeating), participantId, courseId ];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Student not found" });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const detail = err.detail || "";
      if (detail.includes('room_no')) return res.status(409).json({ error: `⚠️ Room '${roomNo}' occupied!` });
      if (detail.includes('dining_seat_no')) return res.status(409).json({ error: `⚠️ Seat '${seatNo}' taken!` });
      if (detail.includes('laundry_token_no')) return res.status(409).json({ error: `⚠️ Token '${laundryToken}' assigned!` });
      if (detail.includes('conf_no')) return res.status(409).json({ error: `⚠️ Conf No '${confNo}' exists!` });
      return res.status(409).json({ error: "Duplicate data detected." });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- STATS ---
app.get('/courses/:id/stats', async (req, res) => {
  try {
    const result = await pool.query("SELECT status, conf_no, gender FROM participants WHERE course_id = $1", [req.params.id]);
    const stats = { arrived: 0, no_response: 0, cancelled: 0, om: 0, of: 0, nm: 0, nf: 0, sm: 0, sf: 0, arrived_m: 0, arrived_f: 0, pending_m: 0, pending_f: 0, cancelled_m: 0, cancelled_f: 0, languages: [] };
    
    result.rows.forEach(p => {
      const isMale = p.gender && p.gender.toLowerCase() === 'male';
      if (p.status === 'Arrived') { stats.arrived++; if(isMale) stats.arrived_m++; else stats.arrived_f++; }
      else if (p.status === 'No Response') { stats.no_response++; if(isMale) stats.pending_m++; else stats.pending_f++; }
      else if (p.status === 'Cancelled') { stats.cancelled++; if(isMale) stats.cancelled_m++; else stats.cancelled_f++; }
      
      if (p.status === 'Arrived' && p.conf_no) {
        const code = p.conf_no.trim().toUpperCase();
        if (code.startsWith('OM')) stats.om++; else if (code.startsWith('OF')) stats.of++;
        else if (code.startsWith('NM')) stats.nm++; else if (code.startsWith('NF')) stats.nf++;
        else if (code.startsWith('SM')) stats.sm++; else if (code.startsWith('SF')) stats.sf++;
      }
    });
    const langResult = await pool.query("SELECT discourse_language, COUNT(*) as total, COUNT(CASE WHEN LOWER(gender) = 'male' THEN 1 END)::int as male_count, COUNT(CASE WHEN LOWER(gender) = 'female' THEN 1 END)::int as female_count FROM participants WHERE course_id = $1 AND status = 'Arrived' GROUP BY discourse_language ORDER BY total DESC", [req.params.id]);
    stats.languages = langResult.rows;
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- EXPENSES ---
app.post('/expenses', async (req, res) => {
  const { courseId, participantId, type, amount } = req.body;
  try {
    const result = await pool.query("INSERT INTO expenses (course_id, participant_id, expense_type, amount) VALUES ($1, $2, $3, $4) RETURNING *", [courseId, participantId, type, amount]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/expenses/:id', async (req, res) => {
  const { expense_type, amount } = req.body;
  try {
    const result = await pool.query("UPDATE expenses SET expense_type=$1, amount=$2 WHERE expense_id=$3 RETURNING *", [expense_type, amount, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/expenses/:id', async (req, res) => {
  try {
    await pool.query("DELETE FROM expenses WHERE expense_id = $1", [req.params.id]);
    res.json({ message: "Expense deleted" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/participants/:id/expenses', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM expenses WHERE participant_id = $1 ORDER BY recorded_at DESC", [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/courses/:id/financial-report', async (req, res) => {
  try {
    const query = `SELECT p.full_name, p.room_no, p.dining_seat_no, COALESCE(SUM(e.amount), 0) as total_due FROM participants p LEFT JOIN expenses e ON p.participant_id = e.participant_id WHERE p.course_id = $1 GROUP BY p.participant_id, p.full_name, p.room_no, p.dining_seat_no HAVING SUM(e.amount) > 0 ORDER BY p.full_name ASC`;
    const result = await pool.query(query, [req.params.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/integration/add-student', async (req, res) => {
  const { apiKey, courseId, student } = req.body;
  if (apiKey !== (process.env.INTEGRATION_KEY || "vridhamma_secret_key_123")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const check = await pool.query("SELECT participant_id FROM participants WHERE course_id = $1 AND LOWER(full_name) = LOWER($2)", [courseId, student.fullName]);
    if (check.rows.length > 0) return res.json({ message: "Student already exists" });
    await pool.query("INSERT INTO participants (course_id, full_name, phone_number, email, age, gender, conf_no, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'No Response')", [courseId, student.fullName, student.phone, student.email, student.age, student.gender, student.confNo]);
    res.json({ message: "Student added" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
