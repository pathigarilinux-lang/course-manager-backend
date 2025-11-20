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

// NEW: RESET COURSE (Delete Students & Expenses, Keep Course)
app.delete('/courses/:id/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Delete Expenses first (foreign key)
    await client.query('DELETE FROM expenses WHERE course_id = $1', [req.params.id]);
    // Delete Participants
    await client.query('DELETE FROM participants WHERE course_id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ message: "Course data reset successfully" });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// NEW: DELETE COURSE (Remove Completely)
app.delete('/courses/:id', async (req, res) => {
  try {
    // Cascading delete usually handles children, but we do it explicitly to be safe
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

// EDIT PARTICIPANT (Now includes Dhamma Seat!)
app.put('/participants/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, phone_number, status, room_no, dining_seat_no, pagoda_cell_no, conf_no, dhamma_hall_seat_no } = req.body;
  try {
    const result = await pool.query(
      "UPDATE participants SET full_name=$1, phone_number=$2, status=$3, room_no=$4, dining_seat_no=$5, pagoda_cell_no=$6, conf_no=$7, dhamma_hall_seat_no=$8 WHERE participant_id=$9 RETURNING *",
      [full_name, phone_number, status, room_no, dining_seat_no, pagoda_cell_no, conf_no, dhamma_hall_seat_no, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/participants/:id', async (req, res) => {
  try {
    await pool.query("DELETE FROM participants WHERE participant_id = $1", [req.params.id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CHECK-IN (Now includes Dhamma Seat!) ---
app.post('/check-in', async (req, res) => {
  const { courseId, participantId, roomNo, seatNo, laundryToken, mobileLocker, valuablesLocker, language, pagodaCell, laptop, confNo, dhammaSeat } = req.body;
  try {
    const query = `
      UPDATE participants 
      SET status = 'Arrived', room_no = $1, dining_seat_no = $2, laundry_token_no = $3, 
          mobile_locker_no = $4, valuables_locker_no = $5, discourse_language = $6,
          pagoda_cell_no = $7, laptop_details = $8, conf_no = $9, dhamma_hall_seat_no = $10
      WHERE participant_id = $11 AND course_id = $12 RETURNING *;
    `;
    const values = [roomNo, seatNo, laundryToken, mobileLocker, valuablesLocker, language||'English', pagodaCell, laptop, confNo, dhammaSeat, participantId, courseId];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Student not found" });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') res.status(409).json({ error: "Duplicate assignment! Room/Seat/Token taken." });
    else res.status(500).json({ error: err.message });
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
