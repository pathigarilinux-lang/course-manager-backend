require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// --- MIDDLEWARE (CRITICAL) ---
app.use(cors());
app.use(express.json()); // <--- This line is REQUIRED for "Create Course" to work!

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- API ROUTES ---

app.get('/', (req, res) => res.send('Backend is Live!'));

// 1. GET ALL COURSES
app.get('/courses', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM courses ORDER BY start_date DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2. CREATE NEW COURSE (The missing/broken part)
app.post('/courses', async (req, res) => {
  try {
    const { courseName, teacherName, startDate, endDate } = req.body;
    
    // Validation check
    if (!courseName || !startDate || !endDate) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const result = await pool.query(
      "INSERT INTO courses (course_name, teacher_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *",
      [courseName, teacherName, startDate, endDate]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Create Course Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. GET STUDENTS FOR A COURSE
app.get('/courses/:id/participants', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM participants WHERE course_id = $1 ORDER BY full_name ASC", [id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. BULK IMPORT STUDENTS
app.post('/courses/:id/import', async (req, res) => {
  const { id } = req.params;
  const { students } = req.body;

  if (!students || !Array.isArray(students)) {
    return res.status(400).json({ error: "Invalid data format" });
  }

  try {
    for (const s of students) {
      if (s.name && s.name.trim() !== "") {
        // Insert ignoring errors if phone/email is missing
        await pool.query(
          "INSERT INTO participants (course_id, full_name, phone_number, email, status) VALUES ($1, $2, $3, $4, 'No Response')",
          [id, s.name, s.phone || '', s.email || '']
        );
      }
    }
    res.json({ message: "Import successful" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 5. CHECK-IN STUDENT
app.post('/check-in', async (req, res) => {
  const { courseId, participantId, roomNo, seatNo, laundryToken, mobileLocker, valuablesLocker, language } = req.body;
  
  try {
    const query = `
      UPDATE participants 
      SET status = 'Arrived', room_no = $1, dining_seat_no = $2, laundry_token_no = $3, 
          mobile_locker_no = $4, valuables_locker_no = $5, discourse_language = $6
      WHERE participant_id = $7 AND course_id = $8
      RETURNING *;
    `;
    const values = [roomNo, seatNo, laundryToken, mobileLocker, valuablesLocker, language || 'English', participantId, courseId];
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') { 
      res.status(409).json({ error: "Duplicate assignment! Room/Seat/Token already taken." });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
