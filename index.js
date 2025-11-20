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

// --- 1. COURSES ---
app.get('/courses', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM courses ORDER BY start_date DESC");
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/courses', async (req, res) => {
  try {
    const { courseName, teacherName, startDate, endDate } = req.body;
    if (!courseName) return res.status(400).json({ error: "Missing fields" });
    const result = await pool.query(
      "INSERT INTO courses (course_name, teacher_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *",
      [courseName, teacherName, startDate, endDate]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 2. PARTICIPANTS ---
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

  let added = 0;
  let skipped = 0;
  try {
    for (const s of students) {
      const name = s.name ? s.name.trim() : "";
      if (name.length < 1) continue;

      // Duplicate Check
      const check = await pool.query(
        "SELECT participant_id FROM participants WHERE course_id = $1 AND LOWER(full_name) = LOWER($2)",
        [id, name]
      );

      if (check.rows.length > 0) {
        skipped++;
      } else {
        await pool.query(
          "INSERT INTO participants (course_id, full_name, phone_number, email, status) VALUES ($1, $2, $3, $4, 'No Response')",
          [id, name, s.phone || '', s.email || '']
        );
        added++;
      }
    }
    res.json({ message: `Added: ${added}. Skipped (Duplicates): ${skipped}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. CHECK-IN ---
app.post('/check-in', async (req, res) => {
  const { courseId, participantId, roomNo, seatNo, laundryToken, mobileLocker, valuablesLocker, language } = req.body;
  try {
    const query = `
      UPDATE participants 
      SET status = 'Arrived', room_no = $1, dining_seat_no = $2, laundry_token_no = $3, 
          mobile_locker_no = $4, valuables_locker_no = $5, discourse_language = $6
      WHERE participant_id = $7 AND course_id = $8 RETURNING *;
    `;
    const values = [roomNo, seatNo, laundryToken, mobileLocker, valuablesLocker, language || 'English', participantId, courseId];
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Student not found" });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') res.status(409).json({ error: "Duplicate assignment! Room/Seat/Token taken." });
    else res.status(500).json({ error: err.message });
  }
});

// --- 4. EXPENSES (NEW!) ---

// Add an Expense
app.post('/expenses', async (req, res) => {
  const { courseId, participantId, type, amount, notes } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO expenses (course_id, participant_id, expense_type, amount, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [courseId, participantId, type, amount, notes]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Expenses for a specific student
app.get('/participants/:id/expenses', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM expenses WHERE participant_id = $1 ORDER BY recorded_at DESC", 
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
