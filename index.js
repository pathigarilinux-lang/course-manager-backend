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

// --- COURSES ---
app.get('/courses', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM courses ORDER BY start_date DESC");
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
    res.json({ message: "Course data reset" });
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

app.post('/courses/:id/import', async (req, res) => {
  const { id } = req.params;
  const { students } = req.body;
  if (!students || !Array.isArray(students)) return res.status(400).json({ error: "Invalid data" });
  let added = 0, skipped = 0;
  try {
    for (const s of students) {
      const name = s.name ? s.name.trim() : "";
      if (name.length < 1) continue;
      const check = await pool.query("SELECT participant_id FROM participants WHERE course_id = $1 AND LOWER(full_name) = LOWER($2)", [id, name]);
      if (check.rows.length > 0) { skipped++; } else {
        await pool.query("INSERT INTO participants (course_id, full_name, phone_number, email, status) VALUES ($1, $2, $3, $4, 'No Response')", [id, name, s.phone||'', s.email||'']);
        added++;
      }
    }
    res.json({ message: `Added: ${added}. Skipped: ${skipped}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/participants/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, phone_number, status, room_no, dining_seat_no, pagoda_cell_no, conf_no, dhamma_hall_seat_no } = req.body;
  try {
    const _room = room_no || null; const _seat = dining_seat_no || null; const _pagoda = pagoda_cell_no || null; const _conf = conf_no || null; const _dhamma = dhamma_hall_seat_no || null;
    const result = await pool.query(
      "UPDATE participants SET full_name=$1, phone_number=$2, status=$3, room_no=$4, dining_seat_no=$5, pagoda_cell_no=$6, conf_no=$7, dhamma_hall_seat_no=$8 WHERE participant_id=$9 RETURNING *",
      [full_name, phone_number, status, _room, _seat, _pagoda, _conf, _dhamma, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    // Error Handling for Edit
    if (err.code === '23505') {
       const detail = err.detail || "";
       if (detail.includes('room_no')) return res.status(409).json({ error: "⚠️ Room already taken" });
       if (detail.includes('dining_seat_no')) return res.status(409).json({ error: "⚠️ Seat already taken" });
       return res.status(409).json({ error: "Duplicate data found" });
    }
    res.status(500).json({ error: err.message }); 
  }
});

app.delete('/participants/:id', async (req, res) => {
  try {
    await pool.query("DELETE FROM participants WHERE participant_id = $1", [req.params.id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CHECK-IN (SMARTER ERROR HANDLING) ---
app.post('/check-in', async (req, res) => {
  const { courseId, participantId, roomNo, seatNo, laundryToken, mobileLocker, valuablesLocker, language, pagodaCell, laptop, confNo, dhammaSeat } = req.body;
  try {
    // Clean empty strings to NULL
    const _room = roomNo || null;
    const _seat = seatNo || null;
    const _laundry = laundryToken || null;
    const _mobile = mobileLocker || null;
    const _val = valuablesLocker || null;
    const _pagoda = pagodaCell || null;
    const _conf = confNo || null;
    const _dhamma = dhammaSeat || null;

    const query = `
      UPDATE participants 
      SET status = 'Arrived', room_no = $1, dining_seat_no = $2, laundry_token_no = $3, 
          mobile_locker_no = $4, valuables_locker_no = $5, discourse_language = $6,
          pagoda_cell_no = $7, laptop_details = $8, conf_no = $9, dhamma_hall_seat_no = $10
      WHERE participant_id = $11 AND course_id = $12 RETURNING *;
    `;
    const values = [_room, _seat, _laundry, _mobile, _val, language||'English', _pagoda, laptop, _conf, _dhamma, participantId, courseId];
    
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Student not found" });
    res.json(result.rows[0]);

  } catch (err) {
    console.error("CheckIn Error:", err);

    if (err.code === '23505') {
      const detail = err.detail || "";
      // Parse the backend error "Key (course_id, dining_seat_no)=(2, 12) already exists."
      // We use Regex to find which column failed
      
      let msg = "Duplicate assignment found.";
      if (detail.includes('room_no')) msg = `⚠️ Room '${roomNo}' is already occupied!`;
      else if (detail.includes('dining_seat_no')) msg = `⚠️ Dining Seat '${seatNo}' is already taken!`;
      else if (detail.includes('laundry_token_no')) msg = `⚠️ Laundry Token '${laundryToken}' is already assigned!`;
      else if (detail.includes('pagoda_cell_no')) msg = `⚠️ Pagoda Cell '${pagodaCell}' is already assigned!`;
      else if (detail.includes('conf_no')) msg = `⚠️ Conf No '${confNo}' already exists!`;
      else if (detail.includes('mobile_locker_no')) msg = `⚠️ Mobile Locker '${mobileLocker}' is in use!`;
      else if (detail.includes('valuables_locker_no')) msg = `⚠️ Valuables Locker '${valuablesLocker}' is in use!`;
      
      return res.status(409).json({ error: msg });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- EXPENSES ---
app.post('/expenses', async (req, res) => {
  const { courseId, participantId, type, amount } = req.body;
  try {
    const result = await pool.query("INSERT INTO expenses (course_id, participant_id, expense_type, amount) VALUES ($1, $2, $3, $4) RETURNING *", [courseId, participantId, type, amount]);
    res.json(result.rows[0]);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
